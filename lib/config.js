/**
 * Pure configuration logic for dsh-prompt-forge.
 *
 * Everything here is side-effect free: defaults, normalization of the mounted
 * config, sanitization of a settings-form submission, cost estimation and the
 * cache fingerprints. Both the Host route handler and the tests import it, so
 * this file must stay free of Cordis/Node services.
 */

/** The three rewrite styles the panel exposes. */
export const STYLES = ['spec', 'brief', 'clarify']

/** Reasoning efforts the DeepSeek adapter accepts. */
export const EFFORTS = ['off', 'low', 'high', 'max']

/** Config defaults; the bundle patch may override any of them. */
export const DEFAULTS = {
  enabled: true,
  provider: '',
  model: '',
  temperature: 0.3,
  maxOutputTokens: 2048,
  maxInputChars: 12000,
  timeoutMs: 60000,
  // Empty means "use the per-style map"; a value here overrides every style.
  reasoningEffort: '',
  // Thinking is worth it for gap-finding, not for a terse rewrite.
  reasoningByStyle: { spec: 'low', brief: 'off', clarify: 'high' },
  // Estimated cost of one call. Defaults follow the official DeepSeek API prices
  // (CNY per 1M tokens, see https://api-docs.deepseek.com/zh-cn/quick_start/pricing):
  // the configured rates are the off-peak ones, and peak hours bill at 2x.
  // Peak hours are Beijing time Mon-Fri 09:00-12:00 and 14:00-18:00; Chinese
  // public holidays can be listed in `pricing.holidays` to bill them off-peak.
  pricing: {
    currency: 'CNY',
    inputPerMTok: 1,
    outputPerMTok: 4,
    cachedInputPerMTok: 0.02,
    peakAware: true,
    peakMultiplier: 2,
    holidays: [],
    models: {
      'deepseek-flash': { inputPerMTok: 1, outputPerMTok: 4, cachedInputPerMTok: 0.02 },
      'deepseek-v4-pro': { inputPerMTok: 4.5, outputPerMTok: 13.5, cachedInputPerMTok: 0.15 },
    },
  },
  // Grounding is on by default: resolving pronouns and reusing established
  // terminology makes rewrites more useful. The panel keeps a per-run switch.
  contextAware: true,
  contextMaxMessages: 8,
  contextMaxChars: 4000,
  defaultStyle: 'brief',
  // Empty follows defaultStyle; otherwise the style used by direct mode.
  directStyle: '',
  // When set, the preview also generates this second style for comparison.
  compareStyle: '',
  // Custom instructions for the rewriting model: appended or replacing the base.
  systemPrompt: '',
  promptMode: 'append',
  // Stream the rewrite token by token instead of one JSON answer.
  streaming: true,
  // true: clicking ✨ replaces the draft directly; false: opens the review popover.
  directApply: false,
  // How long the direct-mode cost toast stays on screen.
  toastDurationMs: 2600,
  // true: Ctrl+Alt+E always opens the preview; false: it follows direct mode.
  shortcutOpensPreview: true,
  maxConcurrent: 2,
  rateLimitPerMinute: 10,
}

export function intIn(value, fallback, min, max) {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export function strOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function numOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function effortOf(value, fallback) {
  return EFFORTS.includes(value) ? value : fallback
}

/**
 * Normalize the local price table. Nothing is read from other plugins: the
 * rates live in this bundle's config (CNY per 1M tokens by default, matching
 * the official DeepSeek API off-peak prices) and every field is optional,
 * falling back to the built-in reference values.
 */
export function normalizePricing(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const currency = strOf(input.currency) !== '' ? strOf(input.currency).toUpperCase() : DEFAULTS.pricing.currency
  const base = {
    currency,
    inputPerMTok: numOr(input.inputPerMTok, DEFAULTS.pricing.inputPerMTok),
    outputPerMTok: numOr(input.outputPerMTok, DEFAULTS.pricing.outputPerMTok),
    cachedInputPerMTok: numOr(input.cachedInputPerMTok, DEFAULTS.pricing.cachedInputPerMTok),
    peakAware: input.peakAware !== false,
    peakMultiplier: numOr(input.peakMultiplier, DEFAULTS.pricing.peakMultiplier) || DEFAULTS.pricing.peakMultiplier,
    holidays: Array.isArray(input.holidays)
      ? input.holidays.filter((day) => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)).slice(0, 400)
      : [],
  }
  const models = {}
  const source = input.models !== null && typeof input.models === 'object' ? input.models : {}
  for (const [key, value] of Object.entries(source)) {
    if (value === null || typeof value !== 'object') continue
    models[key] = {
      currency: strOf(value.currency) !== '' ? strOf(value.currency).toUpperCase() : base.currency,
      inputPerMTok: numOr(value.inputPerMTok, base.inputPerMTok),
      outputPerMTok: numOr(value.outputPerMTok, base.outputPerMTok),
      cachedInputPerMTok: numOr(value.cachedInputPerMTok, base.cachedInputPerMTok),
    }
  }
  return { ...base, models }
}

/** Merge the deployed config over the defaults; never throws at request time. */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const provider = strOf(input.provider)
  const model = strOf(input.model)
  const pair = provider !== '' && model !== '' ? { provider, model } : { provider: '', model: '' }
  const style = STYLES.includes(input.defaultStyle) ? input.defaultStyle : DEFAULTS.defaultStyle
  const temperature = typeof input.temperature === 'number' && Number.isFinite(input.temperature)
    ? Math.min(1, Math.max(0, input.temperature))
    : DEFAULTS.temperature
  const byStyleInput = input.reasoningByStyle !== null && typeof input.reasoningByStyle === 'object' ? input.reasoningByStyle : {}
  return {
    enabled: input.enabled !== false,
    provider: pair.provider,
    model: pair.model,
    temperature,
    maxOutputTokens: intIn(input.maxOutputTokens, DEFAULTS.maxOutputTokens, 128, 32768),
    maxInputChars: intIn(input.maxInputChars, DEFAULTS.maxInputChars, 100, 200000),
    timeoutMs: intIn(input.timeoutMs, DEFAULTS.timeoutMs, 5000, 600000),
    reasoningEffort: EFFORTS.includes(input.reasoningEffort) ? input.reasoningEffort : '',
    reasoningByStyle: {
      spec: effortOf(byStyleInput.spec, DEFAULTS.reasoningByStyle.spec),
      brief: effortOf(byStyleInput.brief, DEFAULTS.reasoningByStyle.brief),
      clarify: effortOf(byStyleInput.clarify, DEFAULTS.reasoningByStyle.clarify),
    },
    pricing: normalizePricing(input.pricing),
    contextAware: typeof input.contextAware === 'boolean' ? input.contextAware : DEFAULTS.contextAware,
    contextMaxMessages: intIn(input.contextMaxMessages, DEFAULTS.contextMaxMessages, 0, 50),
    contextMaxChars: intIn(input.contextMaxChars, DEFAULTS.contextMaxChars, 0, 100000),
    defaultStyle: style,
    directStyle: STYLES.includes(input.directStyle) ? input.directStyle : '',
    compareStyle: STYLES.includes(input.compareStyle) ? input.compareStyle : '',
    systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt.trim().slice(0, 8000) : '',
    promptMode: input.promptMode === 'replace' ? 'replace' : 'append',
    streaming: input.streaming !== false,
    directApply: input.directApply === true,
    toastDurationMs: intIn(input.toastDurationMs, DEFAULTS.toastDurationMs, 800, 10000),
    shortcutOpensPreview: input.shortcutOpensPreview !== false,
    maxConcurrent: intIn(input.maxConcurrent, DEFAULTS.maxConcurrent, 1, 16),
    rateLimitPerMinute: intIn(input.rateLimitPerMinute, DEFAULTS.rateLimitPerMinute, 1, 600),
  }
}

/** The effort one style runs at: the global override, else the per-style map. */
export function effortFor(config, style) {
  if (config.reasoningEffort !== '') return config.reasoningEffort
  return config.reasoningByStyle[style] ?? config.reasoningByStyle.spec
}

/**
 * Normalize one settings-form submission into a complete raw config. Values
 * are clamped and unknown fields dropped, so a hand-crafted request cannot
 * write arbitrary data into the profile patch.
 */
export function sanitizeSettings(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const provider = strOf(input.provider)
  const model = strOf(input.model)
  const style = STYLES.includes(input.defaultStyle) ? input.defaultStyle : DEFAULTS.defaultStyle
  const byStyle = input.reasoningByStyle !== null && typeof input.reasoningByStyle === 'object' ? input.reasoningByStyle : {}
  const pricing = normalizePricing(input.pricing)
  const config = {
    enabled: input.enabled !== false,
    defaultStyle: style,
    directStyle: STYLES.includes(input.directStyle) ? input.directStyle : '',
    compareStyle: STYLES.includes(input.compareStyle) ? input.compareStyle : '',
    systemPrompt: typeof input.systemPrompt === 'string' ? input.systemPrompt.trim().slice(0, 8000) : '',
    promptMode: input.promptMode === 'replace' ? 'replace' : 'append',
    streaming: input.streaming !== false,
    directApply: input.directApply === true,
    toastDurationMs: intIn(input.toastDurationMs, DEFAULTS.toastDurationMs, 800, 10000),
    shortcutOpensPreview: input.shortcutOpensPreview !== false,
    temperature: typeof input.temperature === 'number' && Number.isFinite(input.temperature)
      ? Math.min(1, Math.max(0, input.temperature))
      : DEFAULTS.temperature,
    maxOutputTokens: intIn(input.maxOutputTokens, DEFAULTS.maxOutputTokens, 128, 32768),
    maxInputChars: intIn(input.maxInputChars, DEFAULTS.maxInputChars, 100, 200000),
    timeoutMs: intIn(input.timeoutMs, DEFAULTS.timeoutMs, 5000, 600000),
    reasoningEffort: EFFORTS.includes(input.reasoningEffort) ? input.reasoningEffort : '',
    reasoningByStyle: {
      spec: effortOf(byStyle.spec, DEFAULTS.reasoningByStyle.spec),
      brief: effortOf(byStyle.brief, DEFAULTS.reasoningByStyle.brief),
      clarify: effortOf(byStyle.clarify, DEFAULTS.reasoningByStyle.clarify),
    },
    pricing,
    contextAware: typeof input.contextAware === 'boolean' ? input.contextAware : DEFAULTS.contextAware,
    contextMaxMessages: intIn(input.contextMaxMessages, DEFAULTS.contextMaxMessages, 0, 50),
    contextMaxChars: intIn(input.contextMaxChars, DEFAULTS.contextMaxChars, 0, 100000),
    maxConcurrent: intIn(input.maxConcurrent, DEFAULTS.maxConcurrent, 1, 16),
    rateLimitPerMinute: intIn(input.rateLimitPerMinute, DEFAULTS.rateLimitPerMinute, 1, 600),
  }
  // An empty pair means "follow the session"; omit the keys so the inherited
  // configuration keeps deciding instead of pinning empty strings.
  if (provider !== '' && model !== '') {
    config.provider = provider
    config.model = model
  }
  return config
}

/** The loader entry that owns this plugin's row, when the profile exposes it. */
export function findSettingsEntry(editor) {
  try {
    for (const entry of editor.entries()) {
      const options = entry === null || entry === undefined ? undefined : entry.options
      if (options === null || options === undefined) continue
      if (options.name === 'dsh-prompt-forge' || options.id === 'prompt-forge') return entry
    }
  } catch {
    // A shape change degrades to "not addressable" instead of throwing.
  }
  return undefined
}

/**
 * Price one usage against the local table. `inputTokens` includes cache reads,
 * so the reads are charged at their own rate and the remainder at the miss
 * rate. Returns null when the adapter reported no usage.
 */
/** Beijing-time calendar parts (UTC+8, no DST). */
export function beijingParts(date) {
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000)
  return {
    weekday: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    dayKey: `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`,
  }
}

/**
 * Official DeepSeek peak windows: Beijing time Mon-Fri 09:00-12:00 and
 * 14:00-18:00, excluding Chinese public holidays (listed in `pricing.holidays`).
 */
export function billingPeriod(pricing, date) {
  if (pricing !== null && pricing !== undefined && pricing.peakAware === false) return 'off-peak'
  const parts = beijingParts(date)
  if (pricing !== null && pricing !== undefined && Array.isArray(pricing.holidays) && pricing.holidays.includes(parts.dayKey)) {
    return 'off-peak'
  }
  if (parts.weekday === 0 || parts.weekday === 6) return 'off-peak'
  const peakWindow = (parts.minutes >= 9 * 60 && parts.minutes < 12 * 60)
    || (parts.minutes >= 14 * 60 && parts.minutes < 18 * 60)
  return peakWindow ? 'peak' : 'off-peak'
}

/**
 * Price one usage against the local table, following the official API billing
 * rule: cache-hit input, cache-miss input and output are billed at their own
 * rates, and the configured rates are off-peak; peak hours multiply them.
 * Returns null when the adapter reported no usage.
 */
export function costOf(pricing, provider, model, usage, date) {
  if (usage === null || usage === undefined || typeof usage !== 'object') return null
  const entry = pricing.models[`${provider}/${model}`] ?? pricing.models[model] ?? pricing
  const input = numOr(usage.inputTokens, 0)
  const output = numOr(usage.outputTokens, 0)
  const cached = Math.min(numOr(usage.cacheReadTokens, 0), input)
  const missed = Math.max(0, input - cached)
  const period = billingPeriod(pricing, date === undefined ? new Date() : date)
  const multiplier = period === 'peak' ? (pricing.peakMultiplier ?? 2) : 1
  const amount = (missed * entry.inputPerMTok + cached * entry.cachedInputPerMTok + output * entry.outputPerMTok) * multiplier / 1e6
  return { amount, currency: entry.currency ?? pricing.currency, estimated: true, period }
}

export function hashString(text) {
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  return (hash >>> 0).toString(36)
}

/** Stable stringify (sorted object keys) for structural comparisons. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

/**
 * Stable short fingerprint of every setting that changes what a cached result
 * means. The browser bakes this into its cache key, so editing the model,
 * style defaults, context window or pricing invalidates old entries instead of
 * serving a result produced under different conditions.
 */
export function configFingerprint(config) {
  const material = JSON.stringify({
    provider: config.provider,
    model: config.model,
    defaultStyle: config.defaultStyle,
    contextAware: config.contextAware,
    contextMaxMessages: config.contextMaxMessages,
    contextMaxChars: config.contextMaxChars,
    reasoningEffort: config.reasoningEffort,
    reasoningByStyle: config.reasoningByStyle,
    systemPrompt: config.systemPrompt,
    promptMode: config.promptMode,
    pricing: config.pricing,
  })
  return hashString(material)
}

/** Cache namespace for one resolved route under the current configuration. */
export function routeFingerprint(config, route) {
  const identity = route === undefined ? 'unresolved' : `${route.provider}/${route.model}`
  return hashString(`${identity}|${configFingerprint(config)}`)
}
