/**
 * Local harness for the host half: drives one request through the registered
 * route with a stubbed `webServer`/`llm` context, so config, effort mapping,
 * usage capture and cost math can be checked without restarting the harness.
 */
import { EventEmitter } from 'node:events'
import { apply } from '../index.js'

let hostFailures = 0
function expect(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  hostFailures += 1
  console.log(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

function fakeContext(handlerRef, chunks, selection, model) {
  const spec = model === undefined ? {} : model
  let captured
  const attempts = []
  const webServer = {
    register(route) {
      handlerRef.handler = route.handler
      return () => {}
    },
  }
  const ctx = {
    webServer,
    effect(fn) {
      fn()
    },
    get(name) {
      if (name === 'webServer') return webServer
      if (name === 'llm') {
        const llm = {
          stream(options) {
            captured = options
            attempts.push(options.reasoningEffort)
            if (Array.isArray(spec.strictEfforts)
              && options.reasoningEffort !== undefined
              && !spec.strictEfforts.includes(options.reasoningEffort)) {
              return (async function* reject() {
                yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT', message: 'unsupported effort', status: 400 } } }
              })()
            }
            return (async function* generate() {
              for (const chunk of chunks) yield chunk
            })()
          },
        }
        // Omitting the property models an older core: the plugin must degrade
        // instead of assuming resolveModelInfo exists.
        if (spec.reasoning !== undefined) {
          llm.resolveModelInfo = async () => (spec.reasoning === null ? {} : { reasoning: spec.reasoning })
        }
        return llm
      }
      if (name === 'agentDefaultModel') return { currentSelection: () => selection }
      if (name === 'sessions') return { get: () => undefined }
      return undefined
    },
  }
  return { ctx, options: () => captured, attempts: () => attempts }
}

function fakeRequest(body, url = '/prompt-forge/enhance') {
  const req = new EventEmitter()
  req.url = url
  req.method = 'POST'
  req.headers = { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }
  req.socket = { remoteAddress: '127.0.0.1' }
  queueMicrotask(() => {
    req.emit('data', Buffer.from(body))
    req.emit('end')
  })
  return req
}

function fakeResponse() {
  const res = new EventEmitter()
  res.status = 0
  res.payload = ''
  res.writableEnded = false
  res.destroyed = false
  res.writeHead = (status) => {
    res.status = status
  }
  res.end = (data) => {
    res.writableEnded = true
    if (typeof data === 'string') res.payload += data
  }
  res.write = (data) => {
    res.payload += data
    return true
  }
  return res
}

const chunks = [
  { type: 'text-delta', text: 'Role: tester\n\nGoal: verify.\n\nSteps:\n1. one\n2. two\n' },
  { type: 'usage', usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 } },
  { type: 'finish', reason: { kind: 'stop' } },
]
const holder = { handler: null }
const { ctx, options } = fakeContext(holder, chunks, { provider: 'deepseek-account', model: 'deepseek-flash' })

apply(ctx, { reasoningByStyle: { spec: 'low', brief: 'off', clarify: 'high' }, pricing: { peakAware: false } })

const res = fakeResponse()
await holder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'spec' })), res)

const payload = JSON.parse(res.payload)
if (payload.ok !== true) console.log('payload:', JSON.stringify(payload))
const sent = options()
console.log('status:', res.status)
console.log('reasoningEffort sent:', sent.reasoningEffort)
console.log('temperature sent:', sent.temperature, 'maxTokens:', sent.maxTokens)
console.log('usage:', JSON.stringify(payload.value?.usage))
console.log('cost:', JSON.stringify(payload.value?.cost))
console.log('elapsedMs:', payload.value?.elapsedMs)
console.log('text:', JSON.stringify(payload.value?.text))

// Official CNY off-peak rates (deepseek-flash): 800 miss * 1 + 200 cache * 0.02 + 500 out * 4
const expected = (800 * 1 + 200 * 0.02 + 500 * 4) / 1e6
console.log('cost expected:', expected, 'currency:', payload.value?.cost?.currency,
  'period:', payload.value?.cost?.period,
  'match:', Math.abs(payload.value.cost.amount - expected) < 1e-12)

// brief must run without thinking
const res2 = fakeResponse()
await holder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'brief' })), res2)
console.log('brief effort:', options().reasoningEffort)

// clarify must run at high
const res3 = fakeResponse()
await holder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'clarify' })), res3)
console.log('clarify effort:', options().reasoningEffort)

// --- model-aware effort ---------------------------------------------------
// deepseek-v4.1-flash exposes low/high/max but not off: the default "brief"
// style must degrade to low instead of sending an unsupported level.
const flashHolder = { handler: null }
const flashScope = fakeContext(flashHolder, chunks, { provider: 'p', model: 'm' }, {
  reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' }] },
})
apply(flashScope.ctx, { reasoningByStyle: { spec: 'low', brief: 'off', clarify: 'high' }, pricing: { peakAware: false } })
const flashRes = fakeResponse()
await flashHolder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'brief' })), flashRes)
const flashBody = JSON.parse(flashRes.payload)
expect('brief sends the cheapest supported effort', flashScope.options().reasoningEffort === 'low', String(flashScope.options().reasoningEffort))
expect('the response reports the adjusted effort', flashBody.ok === true
  && flashBody.value?.reasoningEffort === 'low'
  && flashBody.value?.reasoningRequested === 'off'
  && flashBody.value?.reasoningFallback === true, JSON.stringify(flashBody.value))

// A model without reasoning metadata must receive no reasoning field at all.
const plainHolder = { handler: null }
const plainScope = fakeContext(plainHolder, chunks, { provider: 'p', model: 'm' }, { reasoning: null })
apply(plainScope.ctx, { reasoningByStyle: { brief: 'off' } })
const plainRes = fakeResponse()
await plainHolder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'brief' })), plainRes)
const plainBody = JSON.parse(plainRes.payload)
expect('omits reasoning on a model without levels', plainScope.options().reasoningEffort === undefined, String(plainScope.options().reasoningEffort))
expect('reports no effort and no fallback', plainBody.ok === true
  && plainBody.value?.reasoningEffort === null
  && plainBody.value?.reasoningFallback === false, JSON.stringify(plainBody.value))

// Last-resort seam: an older core cannot describe the model, so the host sends
// the configured level, the provider rejects it, and the request is retried
// once without the field instead of failing in the user's face.
const retryHolder = { handler: null }
const retryScope = fakeContext(retryHolder, chunks, { provider: 'p', model: 'm' }, { strictEfforts: [] })
apply(retryScope.ctx, { reasoningByStyle: { brief: 'off' } })
const retryRes = fakeResponse()
await retryHolder.handler(fakeRequest(JSON.stringify({ text: 'hello there', style: 'brief' })), retryRes)
const retryBody = JSON.parse(retryRes.payload)
expect('retries once without the rejected effort', retryScope.attempts().length === 2
  && retryScope.attempts()[0] === 'off'
  && retryScope.attempts()[1] === undefined, JSON.stringify(retryScope.attempts()))
expect('the retry succeeds and reports the fallback', retryBody.ok === true
  && retryBody.value?.reasoningEffort === null
  && retryBody.value?.reasoningFallback === true, JSON.stringify(retryBody))

// The settings readout asks for the level catalog explicitly; the cache-key
// lookup must stay free of adapter work.
const routeModelHolder = { handler: null }
const routeModelScope = fakeContext(routeModelHolder, [], { provider: 'p', model: 'm' }, {
  reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' },
})
apply(routeModelScope.ctx, {})
const routeFullRes = fakeResponse()
await routeModelHolder.handler(fakeGet('/prompt-forge/route?reasoning=1'), routeFullRes)
const routeFull = JSON.parse(routeFullRes.payload).value
expect('route exposes reasoning levels on demand', Array.isArray(routeFull?.reasoning?.efforts)
  && routeFull.reasoning.efforts.length === 2
  && routeFull.reasoning.defaultEffort === 'low', JSON.stringify(routeFull))
const routeLeanRes = fakeResponse()
await routeModelHolder.handler(fakeGet('/prompt-forge/route'), routeLeanRes)
const routeLean = JSON.parse(routeLeanRes.payload).value
expect('route omits the catalog on the cache-key path', routeLean?.reasoning === undefined, JSON.stringify(routeLean))


// --- P0 checks ------------------------------------------------------------

function fakeGet(url) {
  const req = new EventEmitter()
  req.url = url
  req.method = 'GET'
  req.headers = {}
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}

// /config must publish the cache fingerprint
const configRes = fakeResponse()
await holder.handler(fakeGet('/prompt-forge/config'), configRes)
const configBody = JSON.parse(configRes.payload)
console.log('config routeKey:', configBody.value?.routeKey, '| non-empty:', typeof configBody.value?.routeKey === 'string' && configBody.value.routeKey.length > 0, '| directApply:', configBody.value?.directApply)

// rate limit must carry retryAfterSeconds
const holder2 = { handler: null }
const scope2 = fakeContext(holder2, [{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }], { provider: 'p', model: 'm' })
apply(scope2.ctx, { rateLimitPerMinute: 1 })
await holder2.handler(fakeRequest(JSON.stringify({ text: 'one' })), fakeResponse())
const limited = fakeResponse()
await holder2.handler(fakeRequest(JSON.stringify({ text: 'two' })), limited)
const limitedBody = JSON.parse(limited.payload)
console.log('rate-limit:', limited.status, limitedBody.error?.code, 'retryAfterSeconds:', limitedBody.error?.params?.retryAfterSeconds)

// Failed attempts must consume the minute quota too.
const holderFailQuota = { handler: null }
const scopeFailQuota = fakeContext(holderFailQuota, [{ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key', status: 401 } } }], { provider: 'p', model: 'm' })
apply(scopeFailQuota.ctx, { rateLimitPerMinute: 1 })
const firstFailure = fakeResponse()
await holderFailQuota.handler(fakeRequest(JSON.stringify({ text: 'fail once' })), firstFailure)
const blockedAfterFailure = fakeResponse()
await holderFailQuota.handler(fakeRequest(JSON.stringify({ text: 'again' })), blockedAfterFailure)
console.log('failure counts toward quota:', firstFailure.status, '->', blockedAfterFailure.status,
  JSON.parse(blockedAfterFailure.payload).error?.code)

// A missing content-type header is rejected instead of being parsed anyway.
const holderNoType = { handler: null }
const scopeNoType = fakeContext(holderNoType, [], { provider: 'p', model: 'm' })
apply(scopeNoType.ctx, {})
const noType = fakeRequest(JSON.stringify({ text: 'hello' }))
delete noType.headers['content-type']
const noTypeRes = fakeResponse()
await holderNoType.handler(noType, noTypeRes)
console.log('missing content-type:', noTypeRes.status, JSON.parse(noTypeRes.payload).error?.code)

// provider failure codes map onto localizable codes
const holder3 = { handler: null }
const scope3 = fakeContext(holder3, [{ type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: 'bad key', status: 401 } } }], { provider: 'p', model: 'm' })
apply(scope3.ctx, {})
const authRes = fakeResponse()
await holder3.handler(fakeRequest(JSON.stringify({ text: 'auth test' })), authRes)
const authBody = JSON.parse(authRes.payload)
console.log('auth:', authRes.status, authBody.error?.code, 'providerCode:', authBody.error?.params?.providerCode)

// --- P1 checks ------------------------------------------------------------

// SSE endpoint: deltas then a done frame carrying the value
const holder4 = { handler: null }
const scope4 = fakeContext(holder4, [
  { type: 'text-delta', text: 'A' },
  { type: 'text-delta', text: 'B' },
  { type: 'finish', reason: { kind: 'stop' } },
], { provider: 'p', model: 'm' })
apply(scope4.ctx, {})
const streamRes = fakeResponse()
await holder4.handler(fakeRequest(JSON.stringify({ text: 'stream me' }), '/prompt-forge/stream'), streamRes)
const frames = streamRes.payload.split('\n\n').filter((block) => block.trim() !== '')
console.log('stream frames:', frames.length,
  '| has done:', frames.some((block) => block.startsWith('event: done')),
  '| deltas:', frames.filter((block) => block.startsWith('event: delta')).length)

// Context grounding: turns are reported; `context:false` opts out per call
function withSession(scope) {
  const baseGet = scope.ctx.get
  scope.ctx.get = (name) => name === 'sessions'
    ? { get: () => ({ deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'earlier turn' }] }] }) }
    : baseGet(name)
}

const holder5 = { handler: null }
const scope5 = fakeContext(holder5, [{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }], { provider: 'p', model: 'm' })
withSession(scope5)
apply(scope5.ctx, { contextAware: true })
const groundedRes = fakeResponse()
await holder5.handler(fakeRequest(JSON.stringify({ text: 'continue the task', sessionId: 's1' })), groundedRes)
console.log('context on:', JSON.stringify(JSON.parse(groundedRes.payload).value?.context))

const holder6 = { handler: null }
const scope6 = fakeContext(holder6, [{ type: 'text-delta', text: 'ok' }, { type: 'finish', reason: { kind: 'stop' } }], { provider: 'p', model: 'm' })
withSession(scope6)
apply(scope6.ctx, { contextAware: true })
const offRes = fakeResponse()
await holder6.handler(fakeRequest(JSON.stringify({ text: 'continue the task', sessionId: 's1', context: false })), offRes)
console.log('context off:', JSON.stringify(JSON.parse(offRes.payload).value?.context))

// Route endpoint: resolves the session route and namespaces the cache key
const holder7 = { handler: null }
const scope7 = fakeContext(holder7, [], { provider: 'default-provider', model: 'default-model' })
const baseGet7 = scope7.ctx.get
scope7.ctx.get = (name) => name === 'sessions'
  ? { get: () => ({ requestHeader: () => ({ config: { provider: 'session-provider', model: 'session-model' } }) }) }
  : baseGet7(name)
apply(scope7.ctx, {})

const sessionRouteRes = fakeResponse()
await holder7.handler(fakeGet('/prompt-forge/route?session=s1'), sessionRouteRes)
const sessionRoute = JSON.parse(sessionRouteRes.payload).value
console.log('route (session):', JSON.stringify(sessionRoute))

const defaultRouteRes = fakeResponse()
await holder7.handler(fakeGet('/prompt-forge/route'), defaultRouteRes)
const defaultRoute = JSON.parse(defaultRouteRes.payload).value
console.log('route (default):', JSON.stringify(defaultRoute))
console.log('route keys differ:', sessionRoute?.key !== defaultRoute?.key)

// --- Settings page host routes -------------------------------------------

const settingsCalls = []
const fakeEditor = {
  entries: () => [{ options: { id: 'prompt-forge', name: 'dsh-prompt-forge', config: { enabled: true } } }],
  edit: async (_entry, change) => {
    settingsCalls.push(change({ enabled: true }, { enabled: true, defaultStyle: 'brief' }))
  },
}
const holder8 = { handler: null }
const scope8 = fakeContext(holder8, [], { provider: 'p', model: 'm' })
const baseGet8 = scope8.ctx.get
scope8.ctx.get = (name) => (name === 'configEditor' ? fakeEditor : baseGet8(name))
apply(scope8.ctx, {})

const settingsGet = fakeResponse()
await holder8.handler(fakeGet('/prompt-forge/settings'), settingsGet)
const settingsGetBody = JSON.parse(settingsGet.payload)
console.log('settings GET:', settingsGet.status, '| enabled:', settingsGetBody.value?.config?.enabled, '| editable:', settingsGetBody.value?.editable)

const nextConfig = {
  enabled: false,
  defaultStyle: 'spec',
  directStyle: 'clarify',
  compareStyle: 'spec',
  streaming: false,
  directApply: true,
  toastDurationMs: 4000,
  shortcutOpensPreview: false,
  systemPrompt: 'Answer in Chinese.',
  promptMode: 'replace',
  temperature: 0.5,
  maxOutputTokens: 2048,
  maxInputChars: 5000,
  timeoutMs: 30000,
  reasoningEffort: 'high',
  reasoningByStyle: { spec: 'max', brief: 'off', clarify: 'low' },
  pricing: { currency: 'cny', inputPerMTok: 2, outputPerMTok: 8, cachedInputPerMTok: 0.5 },
  contextAware: true,
  contextMaxMessages: 3,
  contextMaxChars: 2000,
  maxConcurrent: 2,
  rateLimitPerMinute: 5,
  provider: '',
  model: '',
}
const settingsPost = fakeResponse()
await holder8.handler(fakeRequest(JSON.stringify({ config: nextConfig }), '/prompt-forge/settings'), settingsPost)
const written = settingsCalls[0] ?? {}
console.log('settings POST:', settingsPost.status, '| saved:', JSON.parse(settingsPost.payload).value?.saved)
console.log('written:', JSON.stringify({
  defaultStyle: written.defaultStyle,
  directStyle: written.directStyle,
  compareStyle: written.compareStyle,
  streaming: written.streaming,
  directApply: written.directApply,
  toastDurationMs: written.toastDurationMs,
  shortcutOpensPreview: written.shortcutOpensPreview,
  systemPrompt: written.systemPrompt,
  promptMode: written.promptMode,
  contextAware: written.contextAware,
  reasoningEffort: written.reasoningEffort,
  currency: written.pricing?.currency,
  provider: written.provider,
  model: written.model,
}))
console.log('defaults omitted:', 'maxOutputTokens' in written === false, 'maxConcurrent' in written === false, 'contextAware' in written === false)

const settingsReset = fakeResponse()
await holder8.handler(fakeRequest(JSON.stringify({ reset: true }), '/prompt-forge/settings'), settingsReset)
console.log('settings reset:', settingsReset.status, '| next is inherited:', JSON.stringify(settingsCalls[1]))

const holder9 = { handler: null }
const scope9 = fakeContext(holder9, [], { provider: 'p', model: 'm' })
apply(scope9.ctx, {})
const unavailable = fakeResponse()
await holder9.handler(fakeGet('/prompt-forge/settings'), unavailable)
console.log('settings unavailable:', unavailable.status, JSON.parse(unavailable.payload).error?.code)

// A custom prompt template must invalidate the cache fingerprint
const holder10 = { handler: null }
const scope10 = fakeContext(holder10, [], { provider: 'p', model: 'm' })
apply(scope10.ctx, {})
const baseConfig = fakeResponse()
await holder10.handler(fakeGet('/prompt-forge/config'), baseConfig)
const baseKey = JSON.parse(baseConfig.payload).value?.routeKey

const holder11 = { handler: null }
const scope11 = fakeContext(holder11, [], { provider: 'p', model: 'm' })
apply(scope11.ctx, { systemPrompt: 'Use a formal tone.' })
const customConfig = fakeResponse()
await holder11.handler(fakeGet('/prompt-forge/config'), customConfig)
const customKey = JSON.parse(customConfig.payload).value?.routeKey
console.log('prompt fingerprint differs:', baseKey !== customKey)

// --- summary --------------------------------------------------------------
if (hostFailures > 0) {
  console.log(`\n${hostFailures} host check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall host checks passed')
}
