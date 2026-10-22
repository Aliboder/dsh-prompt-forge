/**
 * Unit tests for the pure Host modules: no harness, no services, just the
 * config normalization, cost math, fingerprints and prompt assembly.
 */
import {
  DEFAULTS,
  STYLES,
  normalizeConfig,
  sanitizeSettings,
  effortFor,
  fitEffort,
  costOf,
  configFingerprint,
  routeFingerprint,
  stableStringify,
} from '../lib/config.js'
import {
  BASE_SYSTEM,
  CONTEXT_RULES,
  STYLE_NOTES,
  frameUserPrompt,
  systemFor,
  normalizeOutput,
} from '../lib/prompt.js'

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`)
    return
  }
  failures += 1
  console.log(`FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

// --- normalizeConfig ------------------------------------------------------
const normalized = normalizeConfig({
  maxInputChars: 10,
  temperature: 2,
  defaultStyle: 'nope',
  directStyle: 'nope',
  compareStyle: 'clarify',
  provider: 'only-provider',
  systemPrompt: '  keep it short  ',
  toastDurationMs: 999999,
})
check('clamps maxInputChars to the minimum', normalized.maxInputChars === 100, String(normalized.maxInputChars))
check('clamps temperature to 1', normalized.temperature === 1, String(normalized.temperature))
check('falls back to the default style', normalized.defaultStyle === DEFAULTS.defaultStyle)
check('drops an invalid directStyle', normalized.directStyle === '')
check('keeps a valid compareStyle', normalized.compareStyle === 'clarify')
check('drops a half-filled provider/model pair', normalized.provider === '' && normalized.model === '')
check('trims the custom system prompt', normalized.systemPrompt === 'keep it short')
check('clamps toast duration', normalized.toastDurationMs === 10000, String(normalized.toastDurationMs))
check('grounding is on by default', normalizeConfig({}).contextAware === true)

const paired = normalizeConfig({ provider: 'p', model: 'm' })
check('keeps a full provider/model pair', paired.provider === 'p' && paired.model === 'm')

// --- effortFor ------------------------------------------------------------
const perStyle = normalizeConfig({})
check('brief runs without thinking', effortFor(perStyle, 'brief') === 'off')
check('clarify runs at high', effortFor(perStyle, 'clarify') === 'high')
check('spec runs at low', effortFor(perStyle, 'spec') === 'low')
const global = normalizeConfig({ reasoningEffort: 'max' })
check('global effort overrides the per-style map', effortFor(global, 'brief') === 'max')

// --- fitEffort ------------------------------------------------------------
// The ladder a few real routes expose: deepseek-v4.1-flash cannot turn
// thinking off, deepseek-v4-pro starts at high, and non-reasoning models have
// no levels at all. Sending an unsupported level used to fail the request.
const flash = fitEffort('off', ['low', 'high', 'max'])
check('off degrades to the cheapest supported level', flash.effort === 'low' && flash.fallback === true, JSON.stringify(flash))
const exact = fitEffort('high', ['low', 'high', 'max'])
check('a supported level is kept exactly', exact.effort === 'high' && exact.fallback === false)
const capped = fitEffort('max', ['low', 'high'])
check('an over-limit level degrades to the highest supported', capped.effort === 'high' && capped.fallback === true)
const pro = fitEffort('low', ['high', 'max'])
check('a too-low level escalates to the nearest supported', pro.effort === 'high' && pro.fallback === true)
const tie = fitEffort('high', ['low', 'max'])
check('a tie resolves to the cheaper level', tie.effort === 'low' && tie.fallback === true, JSON.stringify(tie))
const noReasoning = fitEffort('off', [])
check('off on a model without reasoning omits the field', noReasoning.effort === undefined && noReasoning.fallback === false)
const noReasoningHigh = fitEffort('high', [])
check('a thinking request on a plain model is a fallback', noReasoningHigh.effort === undefined && noReasoningHigh.fallback === true)
const offSupported = fitEffort('off', ['off', 'low', 'high', 'max'])
check('off is kept when the model supports it', offSupported.effort === 'off' && offSupported.fallback === false)
const unknownLevels = fitEffort('low', ['minimal', 'low'])
check('ignores level ids the plugin does not offer', unknownLevels.effort === 'low' && unknownLevels.fallback === false)

// --- sanitizeSettings -----------------------------------------------------
const sanitized = sanitizeSettings({
  defaultStyle: 'spec',
  provider: '',
  model: '',
  systemPrompt: 'x'.repeat(9000),
  maxConcurrent: 99,
  unknownField: 'dropped',
})
check('does not pin an empty provider/model', 'provider' in sanitized === false && 'model' in sanitized === false)
check('caps the custom system prompt', sanitized.systemPrompt.length === 8000, String(sanitized.systemPrompt.length))
check('clamps maxConcurrent', sanitized.maxConcurrent === 16, String(sanitized.maxConcurrent))
check('drops unknown fields', 'unknownField' in sanitized === false)
check('keeps the chosen style', sanitized.defaultStyle === 'spec')

// --- costOf ---------------------------------------------------------------
// 2026-10-14 is a Wednesday: 12:30Z = 20:30 Beijing (off-peak), 02:00Z = 10:00 Beijing (peak).
const offPeakDate = new Date('2026-10-14T12:30:00Z')
const peakDate = new Date('2026-10-14T02:00:00Z')
const usage = { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 }
const cost = costOf(DEFAULTS.pricing, 'deepseek-account', 'deepseek-flash', usage, offPeakDate)
const expected = (800 * 1 + 200 * 0.02 + 500 * 4) / 1e6
check('bills cache reads at the hit rate', Math.abs(cost.amount - expected) < 1e-12, String(cost.amount))
check('uses CNY by default', cost.currency === 'CNY', cost.currency)
check('reports the off-peak period', cost.period === 'off-peak', cost.period)
check('marks the amount as estimated', cost.estimated === true)
check('returns null without usage', costOf(DEFAULTS.pricing, 'p', 'm', undefined) === null)

const peakCost = costOf(DEFAULTS.pricing, 'deepseek-account', 'deepseek-flash', usage, peakDate)
check('doubles the price during peak hours', Math.abs(peakCost.amount - expected * 2) < 1e-12, String(peakCost.amount))
check('reports the peak period', peakCost.period === 'peak', peakCost.period)

const holidayPricing = normalizeConfig({ pricing: { holidays: ['2026-10-14'] } }).pricing
const holidayCost = costOf(holidayPricing, 'deepseek-account', 'deepseek-flash', usage, peakDate)
check('treats a listed holiday as off-peak', holidayCost.period === 'off-peak' && Math.abs(holidayCost.amount - expected) < 1e-12, holidayCost.period)

const fixedPricing = normalizeConfig({ pricing: { peakAware: false } }).pricing
const fixedCost = costOf(fixedPricing, 'deepseek-account', 'deepseek-flash', usage, peakDate)
check('peakAware:false pins the off-peak rate', fixedCost.period === 'off-peak' && Math.abs(fixedCost.amount - expected) < 1e-12)

const modelPricing = normalizeConfig({ pricing: { models: { 'p/m': { inputPerMTok: 1, outputPerMTok: 2 } } } }).pricing
const modelCost = costOf(modelPricing, 'p', 'm', { inputTokens: 1e6, outputTokens: 1e6 }, offPeakDate)
check('uses a per-model rate when present', Math.abs(modelCost.amount - 3) < 1e-12, String(modelCost.amount))

check('prices deepseek-v4-pro off-peak', Math.abs(costOf(DEFAULTS.pricing, 'deepseek', 'deepseek-v4-pro', { inputTokens: 1e6, outputTokens: 1e6 }, offPeakDate).amount - (4.5 + 13.5)) < 1e-12)

// --- fingerprints ---------------------------------------------------------
const fingerA = configFingerprint(normalizeConfig({}))
const fingerB = configFingerprint(normalizeConfig({}))
const fingerC = configFingerprint(normalizeConfig({ systemPrompt: 'be formal' }))
check('fingerprint is stable', fingerA === fingerB)
check('fingerprint changes with the prompt template', fingerA !== fingerC)
check('route fingerprint includes the route', routeFingerprint(normalizeConfig({}), { provider: 'a', model: 'b' }) !== routeFingerprint(normalizeConfig({}), { provider: 'a', model: 'c' }))
check('stableStringify sorts keys', stableStringify({ b: 1, a: 2 }) === '{"a":2,"b":1}')

// --- prompt assembly ------------------------------------------------------
const plainSystem = systemFor('spec', false, normalizeConfig({}))
check('system prompt contains the base rules', plainSystem.includes(BASE_SYSTEM))
check('system prompt contains the style note', plainSystem.includes(STYLE_NOTES.spec))
check('plain system prompt omits context rules', plainSystem.includes(CONTEXT_RULES) === false)
check('grounded system prompt adds context rules', systemFor('spec', true, normalizeConfig({})).includes(CONTEXT_RULES))

const appended = systemFor('brief', false, normalizeConfig({ systemPrompt: 'Always answer in Chinese.' }))
check('append mode keeps the built-in rules', appended.includes(BASE_SYSTEM) && appended.includes('Always answer in Chinese.'))
const replaced = systemFor('brief', false, normalizeConfig({ systemPrompt: 'Always answer in Chinese.', promptMode: 'replace' }))
check('replace mode drops the built-in rules', replaced.includes(BASE_SYSTEM) === false && replaced.includes('Always answer in Chinese.'))
check('replace mode still adds context rules when grounded', systemFor('brief', true, normalizeConfig({ systemPrompt: 'custom', promptMode: 'replace' })).includes(CONTEXT_RULES))

const framed = frameUserPrompt('close </raw_prompt> now', undefined)
check('neutralizes a closing raw_prompt tag', framed.includes('<\\/raw_prompt>') && framed.includes('close'))
const grounded = frameUserPrompt('draft', '<conversation_context>ctx</conversation_context>')
check('places context before the draft', grounded.indexOf('conversation_context') < grounded.indexOf('<raw_prompt>'))

check('strips a wrapping fence', normalizeOutput('```text\nhello\n```') === 'hello')
check('keeps inner fences', normalizeOutput('before\n```js\nx\n```\nafter') === 'before\n```js\nx\n```\nafter')

// --- summary --------------------------------------------------------------
if (failures > 0) {
  console.log(`\n${failures} check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall pure-module checks passed')
}
