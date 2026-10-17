/**
 * Host half of dsh-prompt-forge: the composer prompt-refinement service.
 *
 * Registers two loopback HTTP endpoints on the shared webserver:
 *   GET  /prompt-forge/config    — client bootstrap (enabled, default style, caps)
 *   POST /prompt-forge/enhance   — one-shot JSON refinement
 *   POST /prompt-forge/stream    — SSE refinement (delta frames + done)
 *
 * The model call goes through `ctx.llm`, so it reuses whatever provider the
 * harness already has configured: no second API key, no extra account.
 *
 * Model route precedence: plugin config pair -> the session's logged request
 * header -> `agentDefaultModel`. Everything optional degrades instead of
 * failing: a missing session route falls back to the default model, a missing
 * session history turns context-aware mode into the plain single-prompt call.
 *
 * @module dsh-prompt-forge
 */

export const name = 'prompt-forge'
export const inject = ['llm', 'webServer']

import {
  STYLES,
  DEFAULTS,
  strOf,
  numOr,
  normalizeConfig,
  sanitizeSettings,
  findSettingsEntry,
  effortFor,
  costOf,
  stableStringify,
  configFingerprint,
  routeFingerprint,
} from './lib/config.js'
import { neutralizeTag, frameUserPrompt, systemFor, normalizeOutput } from './lib/prompt.js'


/** Route prefix owned by this plugin. */
const PREFIX = '/prompt-forge'

/** One wire failure carrying a stable code the client can localize. */
class ForgeError extends Error {
  constructor(code, message, params) {
    super(message ?? code)
    this.name = 'ForgeError'
    this.code = code
    this.params = params
  }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function isLoopback(req) {
  const address = req.socket && req.socket.remoteAddress
  if (address === undefined) return true
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1' || address.startsWith('127.')
}

/** POST bodies must be JSON; a missing header is a client bug, not a pass. */
function isJsonRequest(req) {
  const contentType = req.headers['content-type']
  return typeof contentType === 'string' && contentType.toLowerCase().startsWith('application/json')
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function fail(res, status, code, message, params) {
  const error = { code }
  if (message !== undefined) error.message = message
  if (params !== undefined) error.params = params
  writeJson(res, status, { ok: false, error })
}

function readJson(req, cap) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid json'))
      }
    })
    req.on('error', reject)
  })
}

function openSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  if (typeof res.flushHeaders === 'function') res.flushHeaders()
  return {
    frame(event, data) {
      if (res.writableEnded) return false
      return res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    end() {
      if (!res.writableEnded && !res.destroyed) {
        try { res.end() } catch { /* half-closed socket */ }
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

/** Narrow an untrusted {provider, model} pair into a route. */
function routeOf(candidate) {
  if (candidate === null || candidate === undefined) return undefined
  const provider = strOf(candidate.provider)
  const model = strOf(candidate.model)
  if (provider === '' || model === '') return undefined
  return { provider, model }
}

/** Look up one entry of a Map-like service without letting a throw escape. */
function serviceEntry(ctx, service, key) {
  try {
    const holder = ctx.get(service)
    if (holder === null || holder === undefined || typeof holder.get !== 'function') return undefined
    return holder.get(key)
  } catch {
    return undefined
  }
}

/** The session's logged request route (provider/model of its last header). */
function sessionRouteOf(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const session = serviceEntry(ctx, 'sessions', sessionId)
  if (session === undefined || session === null) return undefined
  try {
    const header = typeof session.requestHeader === 'function' ? session.requestHeader() : session.requestHeader
    return routeOf(header === null || header === undefined ? undefined : header.config)
  } catch {
    return undefined
  }
}

/** The harness-wide default model selection. */
function defaultRouteOf(ctx) {
  try {
    const service = ctx.get('agentDefaultModel')
    if (service !== null && service !== undefined && typeof service.currentSelection === 'function') {
      const selection = service.currentSelection()
      const route = routeOf(selection)
      if (route !== undefined) return route
    }
  } catch {
    // Fall through to the next source.
  }
  return routeOf(serviceEntry(ctx, 'settings', 'agent-default-model'))
}

/** Explicit config pair, else the session route, else the harness default. */
function resolveRoute(config, sessionRoute, defaultRoute) {
  if (config.provider !== '' && config.model !== '') return { provider: config.provider, model: config.model }
  return sessionRoute ?? defaultRoute
}

// ---------------------------------------------------------------------------
// Conversation context
// ---------------------------------------------------------------------------

function countChars(text) {
  let n = 0
  for (const _ of text) n += 1
  return n
}

function cutChars(text, max) {
  if (max <= 0) return ''
  let out = ''
  let n = 0
  for (const ch of text) {
    if (n >= max) break
    out += ch
    n += 1
  }
  return out
}

function messageText(message) {
  const content = message === null || message === undefined ? undefined : message.content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    if (block.type !== 'text' || typeof block.text !== 'string') continue
    const text = block.text.trim()
    if (text !== '') parts.push(text)
  }
  return parts.join('\n')
}

/** Select the newest turns that fit the configured window, chronological. */
function selectTurns(messages, maxMessages, maxChars, draft) {
  if (maxMessages <= 0 || maxChars <= 0 || !Array.isArray(messages)) return []
  const turns = []
  for (const message of messages) {
    if (message === null || typeof message !== 'object') continue
    if (message.role !== 'user' && message.role !== 'assistant') continue
    const text = messageText(message)
    if (text === '') continue
    turns.push({ role: message.role, text })
  }
  const trimmed = typeof draft === 'string' ? draft.trim() : ''
  if (trimmed !== '') {
    for (let index = turns.length - 1; index >= 0; index -= 1) {
      if (turns[index].role === 'user' && turns[index].text === trimmed) {
        turns.splice(index, 1)
        break
      }
    }
  }
  const windowed = turns.slice(-maxMessages)
  const kept = []
  let used = 0
  for (let index = windowed.length - 1; index >= 0; index -= 1) {
    const turn = windowed[index]
    const length = countChars(turn.text)
    if (used + length > maxChars) {
      const room = maxChars - used
      if (kept.length === 0 && room > 60) {
        kept.unshift({ role: turn.role, text: `${cutChars(turn.text, room - 24).trimEnd()} …（已截断）` })
      }
      break
    }
    used += length
    kept.unshift(turn)
  }
  return kept
}

/**
 * Build the grounding snippet.
 * @returns {{ block: string, turns: number } | undefined} undefined when there
 *   is nothing usable, so the call falls back to the plain single-prompt form.
 */
function conversationContext(ctx, config, sessionId, draft) {
  if (!config.contextAware) return undefined
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const session = serviceEntry(ctx, 'sessions', sessionId)
  if (session === undefined || session === null || typeof session.deriveMessages !== 'function') return undefined
  let messages
  try {
    messages = session.deriveMessages()
  } catch {
    return undefined
  }
  const turns = selectTurns(messages, config.contextMaxMessages, config.contextMaxChars, draft)
  if (turns.length === 0) return undefined
  const body = turns.map((turn) => `[${turn.role}] ${neutralizeTag(turn.text, 'conversation_context')}`).join('\n')
  return { block: `<conversation_context>\n${body}\n</conversation_context>`, turns: turns.length }
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

/** Map one provider failure code onto a stable, localizable wire code. */
function finishErrorCode(code) {
  switch (code) {
    case 'AUTH':
    case 'INVALID_CREDENTIAL':
      return 'auth'
    case 'QUOTA_EXCEEDED':
      return 'quota'
    case 'CONTEXT_WINDOW_EXCEEDED':
      return 'context-window'
    case 'NO_ADAPTER':
      return 'unconfigured'
    default:
      return 'upstream'
  }
}

function mapFinish(reason) {
  if (reason === null || reason === undefined) return undefined
  switch (reason.kind) {
    case 'stop':
      return undefined
    case 'max-tokens':
      return new ForgeError('upstream', 'output token limit reached; raise maxOutputTokens or shorten the draft')
    case 'tool-calls':
      return new ForgeError('upstream', 'the model requested a tool call; refinement needs plain text')
    case 'error':
    case 'aborted': {
      const failure = reason.failure ?? {}
      return new ForgeError(finishErrorCode(failure.code), failure.message, { providerCode: failure.code })
    }
    default:
      return new ForgeError('internal', `unexpected finish reason: ${String(reason.kind)}`)
  }
}

/**
 * Run one refinement.
 * @returns {Promise<{text:string, style:string, provider:string, model:string, elapsedMs:number}>}
 */
async function enhance(ctx, config, options) {
  const started = Date.now()
  const route = resolveRoute(config, sessionRouteOf(ctx, options.sessionId), defaultRouteOf(ctx))
  if (route === undefined) throw new ForgeError('unconfigured')
  const llm = ctx.get('llm')
  if (llm === null || llm === undefined || typeof llm.stream !== 'function') throw new ForgeError('internal')
  const effort = effortFor(config, options.style)

  // A caller may switch grounding off for one call without touching config.
  const contextInfo = options.context === false ? undefined : conversationContext(ctx, config, options.sessionId, options.text)
  const context = contextInfo === undefined ? undefined : contextInfo.block
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.timeoutMs)
  const onCallerAbort = () => controller.abort()
  if (options.signal !== undefined) {
    options.signal.addEventListener('abort', onCallerAbort, { once: true })
    if (options.signal.aborted) controller.abort()
  }

  const aborted = new Promise((_, reject) => {
    const failAbort = () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      reject(error)
    }
    if (controller.signal.aborted) failAbort()
    else controller.signal.addEventListener('abort', failAbort, { once: true })
  })
  // Keep the rejection from surfacing as an unhandled rejection when the call
  // completes before the deadline.
  aborted.catch(() => {})

  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      system: systemFor(options.style, context !== undefined, config),
      messages: [{ role: 'user', content: [{ type: 'text', text: frameUserPrompt(options.text, context) }] }],
      temperature: config.temperature,
      maxTokens: config.maxOutputTokens,
      reasoningEffort: effort,
      signal: controller.signal,
      ...(typeof options.sessionId === 'string' && options.sessionId !== '' ? { sessionId: options.sessionId } : {}),
    })
    const iterator = stream[Symbol.asyncIterator]()
    let text = ''
    let finish
    let usage
    let exhausted = false
    try {
      for (;;) {
        const next = await Promise.race([iterator.next(), aborted])
        if (next.done === true) {
          exhausted = true
          break
        }
        const chunk = next.value
        if (chunk === null || typeof chunk !== 'object') continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text
          if (options.onDelta !== undefined) {
            try { options.onDelta(chunk.text) } catch { /* display path must never fail the call */ }
          }
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        } else if (chunk.type === 'usage' && chunk.usage !== null && chunk.usage !== undefined) {
          usage = chunk.usage
        }
      }
    } finally {
      if (!exhausted && typeof iterator.return === 'function') {
        void Promise.resolve(iterator.return()).catch(() => {})
      }
    }
    const finishError = mapFinish(finish)
    if (finishError !== undefined) throw finishError
    const normalized = normalizeOutput(text)
    if (normalized === '') throw new ForgeError('upstream', 'the model returned an empty response')
    return {
      text: normalized,
      style: options.style,
      provider: route.provider,
      model: route.model,
      reasoningEffort: effort,
      usage: usage === undefined ? null : {
        inputTokens: numOr(usage.inputTokens, 0),
        outputTokens: numOr(usage.outputTokens, 0),
        cacheReadTokens: numOr(usage.cacheReadTokens, 0),
        cacheWriteTokens: numOr(usage.cacheWriteTokens, 0),
        reasoningTokens: numOr(usage.reasoningTokens, 0),
      },
      cost: costOf(config.pricing, route.provider, route.model, usage),
      context: {
        used: context !== undefined,
        turns: contextInfo === undefined ? 0 : contextInfo.turns,
      },
      elapsedMs: Date.now() - started,
    }
  } catch (error) {
    if (error instanceof ForgeError) throw error
    if (timedOut) throw new ForgeError('timeout', `refinement timed out after ${Math.ceil(config.timeoutMs / 1000)}s`)
    if (error !== null && typeof error === 'object' && error.name === 'AbortError') throw new ForgeError('aborted')
    throw new ForgeError('internal', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    if (options.signal !== undefined) options.signal.removeEventListener('abort', onCallerAbort)
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

function createHandler(ctx, readConfig) {
  const gate = { stamps: [], active: 0 }

  function admit(config) {
    const now = Date.now()
    const cut = now - 60000
    while (gate.stamps.length > 0 && gate.stamps[0] < cut) gate.stamps.shift()
    if (gate.stamps.length >= config.rateLimitPerMinute) {
      // The window is bounded, so the oldest surviving stamp tells exactly when
      // a slot frees up: hand that to the client instead of a bare "too many".
      const oldest = gate.stamps[0] ?? now
      const retryAfterSeconds = Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000))
      return new ForgeError('rate-limit', `at most ${config.rateLimitPerMinute} refinements per minute`, {
        limit: config.rateLimitPerMinute,
        retryAfterSeconds,
      })
    }
    if (gate.active >= config.maxConcurrent) {
      return new ForgeError('concurrency', `at most ${config.maxConcurrent} refinements may run at once`, {
        max: config.maxConcurrent,
      })
    }
    return undefined
  }

  async function handle(req, res) {
    const requestUrl = new URL(req.url ?? '/', 'http://local')
    const path = requestUrl.pathname
    const config = readConfig()
    if (!isLoopback(req)) {
      fail(res, 403, 'forbidden', 'loopback only')
      return
    }
    if (path === `${PREFIX}/route`) {
      if (req.method !== 'GET') {
        fail(res, 405, 'method', 'GET only')
        return
      }
      const requested = requestUrl.searchParams.get('session')
      const route = resolveRoute(config, sessionRouteOf(ctx, requested === null ? undefined : requested), defaultRouteOf(ctx))
      writeJson(res, 200, {
        ok: true,
        value: {
          provider: route === undefined ? '' : route.provider,
          model: route === undefined ? '' : route.model,
          key: routeFingerprint(config, route),
        },
      })
      return
    }
    if (path === `${PREFIX}/config`) {
      if (req.method !== 'GET') {
        fail(res, 405, 'method', 'GET only')
        return
      }
      writeJson(res, 200, {
        ok: true,
        value: {
          enabled: config.enabled,
          defaultStyle: config.defaultStyle,
          directStyle: config.directStyle,
          compareStyle: config.compareStyle,
          toastDurationMs: config.toastDurationMs,
          shortcutOpensPreview: config.shortcutOpensPreview,
          maxInputChars: config.maxInputChars,
          styles: STYLES.slice(),
          contextAware: config.contextAware,
          streaming: config.streaming,
          directApply: config.directApply,
          routeKey: configFingerprint(config),
        },
      })
      return
    }
    if (path === `${PREFIX}/settings`) {
      const editor = ctx.get('configEditor')
      if (editor === null || editor === undefined || typeof editor.edit !== 'function' || typeof editor.entries !== 'function') {
        fail(res, 503, 'unavailable', 'the profile config editor is not mounted')
        return
      }
      const entry = findSettingsEntry(editor)
      if (entry === undefined) {
        fail(res, 409, 'unreadable', 'the prompt-forge row is not addressable in this profile')
        return
      }
      if (req.method === 'GET') {
        writeJson(res, 200, {
          ok: true,
          value: {
            editable: true,
            entryId: entry.options !== undefined && entry.options !== null && typeof entry.options.id === 'string' ? entry.options.id : 'prompt-forge',
            config: readConfig(),
          },
        })
        return
      }
      if (req.method !== 'POST') {
        fail(res, 405, 'method', 'GET or POST only')
        return
      }
      if (!isJsonRequest(req)) {
        fail(res, 415, 'content-type', 'application/json required')
        return
      }
      let body
      try {
        body = await readJson(req, 64 * 1024)
      } catch (error) {
        fail(res, 422, 'bad-body', error instanceof Error ? error.message : String(error))
        return
      }
      if (body === null || typeof body !== 'object') {
        fail(res, 422, 'bad-body', 'expected { config } or { reset: true }')
        return
      }
      try {
        // Reset drops the profile override entirely. Otherwise persist only the
        // fields that differ from the built-in defaults, so plugin upgrades can
        // still move defaults the user never touched.
        await editor.edit(entry, (_current, inherited) => {
          if (body.reset === true) return inherited
          const next = sanitizeSettings(body.config)
          const base = normalizeConfig({})
          const diff = {}
          for (const [key, value] of Object.entries(next)) {
            if (stableStringify(value) !== stableStringify(base[key])) diff[key] = value
          }
          return diff
        })
        writeJson(res, 200, { ok: true, value: { saved: true } })
      } catch (error) {
        fail(res, 422, 'invalid', error instanceof Error ? error.message : String(error))
      }
      return
    }
    if (path !== `${PREFIX}/enhance` && path !== `${PREFIX}/stream`) {
      fail(res, 404, 'not-found')
      return
    }
    if (req.method !== 'POST') {
      fail(res, 405, 'method', 'POST only')
      return
    }
    if (!isJsonRequest(req)) {
      fail(res, 415, 'content-type', 'application/json required')
      return
    }
    if (!config.enabled) {
      fail(res, 403, 'disabled', 'prompt refinement is disabled in the plugin config')
      return
    }
    const cap = config.maxInputChars * 6 + 4096
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > cap) {
      fail(res, 413, 'too-large', 'request body exceeds the limit')
      return
    }
    let body
    try {
      body = await readJson(req, cap)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(res, message === 'body too large' ? 413 : 422, 'bad-body', message)
      return
    }
    if (body === null || typeof body !== 'object' || typeof body.text !== 'string') {
      fail(res, 422, 'bad-body', 'expected { text, style?, sessionId? }')
      return
    }
    const text = body.text
    const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : undefined
    const style = STYLES.includes(body.style) ? body.style : config.defaultStyle
    if (text.trim() === '') {
      fail(res, 422, 'empty', 'the draft is empty')
      return
    }
    if (countChars(text) > config.maxInputChars) {
      fail(res, 422, 'too-long', `the draft exceeds ${config.maxInputChars} characters`)
      return
    }
    const rejected = admit(config)
    if (rejected !== undefined) {
      fail(res, 429, rejected.code, rejected.message, rejected.params)
      return
    }

    gate.active += 1
    // Every attempt consumes the minute quota, not just successful ones: a
    // failing call still reaches the provider and costs tokens.
    gate.stamps.push(Date.now())
    const callerAbort = new AbortController()
    const onClose = () => {
      if (!res.writableEnded) callerAbort.abort()
    }
    res.on('close', onClose)
    const stream = path === `${PREFIX}/stream`
    const sse = stream ? openSse(res) : undefined
    const sseFrame = (event, data) => {
      if (sse === undefined || res.writableEnded || res.destroyed) return
      try { sse.frame(event, data) } catch { /* the client went away first */ }
    }
    const sseFinish = () => {
      if (sse === undefined || res.writableEnded || res.destroyed) return
      try { sse.end() } catch { /* the client went away first */ }
    }
    try {
      let displayed = false
      const options = {
        text,
        style,
        sessionId,
        context: body.context === false ? false : undefined,
        signal: callerAbort.signal,
        ...(sse === undefined ? {} : {
          onDelta: (delta) => {
            displayed = true
            sseFrame('delta', { type: 'delta', text: delta })
          },
        }),
      }
      const value = await enhance(ctx, config, options)
      if (sse === undefined) {
        writeJson(res, 200, { ok: true, value })
      } else {
        if (!displayed && value.text !== '') sseFrame('delta', { type: 'delta', text: value.text })
        sseFrame('done', { type: 'done', value })
        sseFinish()
      }
      console.info(`[prompt-forge] ok style=${style} in=${countChars(text)} out=${countChars(value.text)} ${value.elapsedMs}ms`)
    } catch (error) {
      const wire = error instanceof ForgeError ? error : new ForgeError('internal', error instanceof Error ? error.message : String(error))
      if (sse !== undefined) {
        sseFrame('error', { type: 'error', error: { code: wire.code, message: wire.message, params: wire.params } })
        sseFinish()
        if (wire.code !== 'aborted') console.info(`[prompt-forge] fail ${wire.code}`)
      } else {
        const status = wire.code === 'timeout' ? 504
          : wire.code === 'unconfigured' ? 409
            : wire.code === 'rate-limit' || wire.code === 'concurrency' ? 429
              : 502
        if (wire.code !== 'aborted') {
          console.info(`[prompt-forge] fail ${wire.code}`)
          fail(res, status, wire.code, wire.message, wire.params)
        }
      }
    } finally {
      res.off('close', onClose)
      gate.active -= 1
    }
  }

  return handle
}

/**
 * Mount the host half.
 * @param ctx - registrant context.
 * @param rawConfig - the bundle row's config.
 */
export function apply(ctx, rawConfig) {
  const readConfig = () => normalizeConfig(rawConfig)
  const handle = createHandler(ctx, readConfig)
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: handle }))
}
