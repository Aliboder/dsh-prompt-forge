/**
 * Browser half of dsh-prompt-forge.
 *
 * Seats:
 *   conversation.input.activity  -> the ✨ trigger
 *   conversation.input.overlay   -> the floating review popover
 *
 * Features: live draft mirror with debounced write-back, streaming rewrite,
 * per-session popovers, cached results keyed by config fingerprint, replace /
 * replace-and-send / copy / retry / undo, context-aware grounding with a
 * per-run switch, and a Ctrl+Alt+E shortcut.
 *
 * Module id MUST equal the package name, otherwise the loader refuses the
 * bundle ("loaded without registering <id>").
 */
window.__ModuleLoader__.load({
  id: 'dsh-prompt-forge',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'prompt-forge'
    const STYLES = ['brief', 'clarify', 'spec']
    const ENDPOINT = '/prompt-forge'
    const GAP = 8
    const DEFAULT_WIDTH = 440
    const DEFAULT_HEIGHT = 380
    const MIN_WIDTH = 300
    const MIN_HEIGHT = 200
    const EDGE = 8
    const EDIT_DEBOUNCE_MS = 120
    const LAYOUT_KEY = 'dsh.prompt-forge.layout.v1'
    const SETTINGS_SAVED_KEY = 'dsh.prompt-forge.settings-saved'
    const CACHE_KEY = 'dsh.prompt-forge.results.v2'
    const UNDO_KEY = 'dsh.prompt-forge.undo.v1'
    const CACHE_LIMIT = 40
    const PANEL_LIMIT = 20

    // Timers created outside a component effect; cleared when the plugin unloads.
    const unloadTimers = new Set()

    function later(callback, ms) {
      const id = setTimeout(() => {
        unloadTimers.delete(id)
        callback()
      }, ms)
      unloadTimers.add(id)
      return id
    }

    function clearUnloadTimers() {
      for (const id of unloadTimers) clearTimeout(id)
      unloadTimers.clear()
    }

    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max))
    }

    // -----------------------------------------------------------------------
    // Locale dictionaries (registered into the client locale service)
    // -----------------------------------------------------------------------
    const STRINGS = {
      zh: {
        'button.title': '增强提示词（Ctrl+Alt+E）',
        'menu.title': '用此风格增强',
        'button.busy': '正在增强…',
        'button.hintEmpty': '先写一句草稿',
        'button.hintChips': '草稿含 @引用或命令，无法安全改写',
        'button.hintTooLong': '草稿过长，无法增强',
        'panel.title': '提示词增强',
        'panel.dragHint': '拖动标题移动 · 右下角缩放 · 双击标题复位',
        'panel.original': '原文',
        'panel.result': '增强后',
        'panel.cached': '沿用上次',
        'panel.chars': '{count} 字',
        'panel.loading': '正在改写草稿…',
        'panel.streaming': '正在生成…',
        'panel.applied': '已替换输入框草稿',
        'panel.stale': '草稿在请求后改动过，替换将覆盖当前内容',
        'panel.apply': '替换草稿',
        'panel.applySend': '替换并发送',
        'panel.copy': '复制',
        'panel.copied': '已复制',
        'panel.retry': '重试',
        'panel.cancel': '停止',
        'panel.undo': '撤销替换',
        'panel.undoLast': '撤销上次替换',
        'panel.close': '关闭',
        'panel.context': '上下文',
        'panel.contextOn': '本次启用上下文感知（点击关闭）',
        'panel.contextOff': '本次不读取上下文（点击开启）',
        'panel.contextUsed': '参考了 {turns} 轮',
        'panel.compare': '对比',
        'panel.useThis': '使用这个',
        'panel.unpin': '取消钉住',
        'panel.pin': '钉住',
        'panel.tokens': '输入 {input} · 输出 {output} tok',
        'panel.seconds': '{value} 秒',
        'panel.cost': '≈ {amount}',
        'panel.costEstimate': '按本插件配置的单价估算',
        'panel.ratePeak': '高峰时段',
        'panel.rateOffPeak': '空闲时段',
        'panel.length': '{before}→{after} 字',
        'panel.editable': '可直接修改，会实时同步到输入框',
        'panel.locked': '会话正在提交，暂不能编辑草稿',
        'settings.label': '提示词增强',
        'settings.enabled': '启用插件',
        'settings.currentRoute': '当前生效模型',
        'settings.billingPeriod': '计费时段',
        'settings.routeUnset': '跟随会话（服务端未解析到默认模型）',
        'settings.modelPairRequired': 'Provider 与模型名需同时填写，或同时留空',
        'settings.intro': '这些设置会写入当前 profile 的 patch，保存后立即生效（插件会热重载）。',
        'settings.basic': '基本',
        'settings.directApply': '点击按钮直接替换草稿',
        'settings.directApplyHint': '开启：点 ✨ 直接改写输入框；关闭：弹出预览窗口（默认）。',
        'settings.directStyle': '直接替换使用的风格',
        'settings.directStyleDefault': '跟随默认风格',
        'settings.compareStyle': '对比风格',
        'settings.compareStyleOff': '关闭（单候选）',
        'settings.compareStyleHint': '设置后预览会并行生成第二个风格，可对比挑选（成本翻倍）。',
        'settings.toastDurationMs': '费用提示时长（毫秒）',
        'settings.shortcutOpensPreview': '快捷键始终打开预览',
        'settings.shortcutOpensPreviewHint': '关闭后，直接替换模式下 Ctrl+Alt+E 也直接替换。',
        'settings.usage': '用量统计',
        'settings.prompt': '提示词模板',
        'settings.promptMode': '模板模式',
        'settings.promptModeAppend': '追加到内置指令',
        'settings.promptModeReplace': '替换内置指令',
        'settings.promptModeHint': '追加：自定义指令加在内置规则之后；替换：只使用你的指令（参考对话的说明仍会自动追加）。',
        'settings.systemPrompt': '自定义指令',
        'settings.systemPromptHint': '留空使用内置指令；最多 8000 字符。',
        'settings.history': '最近结果',
        'settings.historyEmpty': '还没有可浏览的历史结果。',
        'settings.copy': '复制',
        'settings.copied': '已复制',
        'settings.delete': '删除',
        'settings.expand': '展开',
        'settings.hide': '收起',
        'settings.clearHistory': '清空历史',
        'settings.original': '原文',
        'settings.spendToday': '今日估算花费',
        'settings.runsToday': '今日增强次数',
        'settings.clearSpend': '清除统计',
        'settings.savedPending': '已保存，等待插件重载…',
        'settings.invalid': '有字段超出允许范围',
        'toast.draftChanged': '草稿已变化，结果已放入预览',
        'toast.failed': '生成失败，已打开预览',
        'toast.today': '今日累计',
        'direct.running': '生成中 · {style}',
        'direct.stop': '停止',
        'toast.stopped': '已停止，草稿已还原',
        'toast.cost': '本次约 {amount}',
        'toast.done': '已替换草稿',
        'button.applied': '已替换',
        'button.undo': '撤销',
        'settings.defaultStyle': '默认风格',
        'settings.streaming': '流式显示',
        'settings.model': '模型',
        'settings.provider': 'Provider',
        'settings.modelName': '模型名',
        'settings.modelHint': '留空表示跟随当前会话模型；两项需同时填写。',
        'settings.effort': '思考强度',
        'settings.effortGlobal': '全局覆盖',
        'settings.effortByStyle': '按风格',
        'settings.context': '上下文感知',
        'settings.contextMessages': '最多参考轮数',
        'settings.contextChars': '上下文字符预算',
        'settings.limits': '生成限制',
        'settings.temperature': '温度',
        'settings.maxOutputTokens': '最大输出 token',
        'settings.maxInputChars': '草稿字数上限',
        'settings.timeoutMs': '超时（毫秒）',
        'settings.maxConcurrent': '并发上限',
        'settings.rateLimit': '每分钟次数上限',
        'settings.pricing': '费用估算单价（每百万 token）',
        'settings.currency': '货币',
        'settings.currencyPlaceholder': 'USD',
        'settings.inputPerMTok': '输入单价（缓存未命中，元/百万 tok）',
        'settings.outputPerMTok': '输出单价（元/百万 tok）',
        'settings.cachedInputPerMTok': '输入单价（缓存命中，元/百万 tok）',
        'settings.pricingHint': '按官方 API 计费：以上为北京时间空闲时段单价，高峰时段（工作日 9–12、14–18 点）按 2 倍计费。',
        'settings.follow': '跟随会话',
        'settings.save': '保存',
        'settings.reset': '恢复默认',
        'settings.saved': '已保存，正在应用…',
        'settings.applied': '已保存并生效',
        'settings.failed': '保存失败',
        'settings.loadFailed': '读取设置失败',
        'settings.loading': '正在读取…',
        'settings.unavailable': '当前 profile 未启用配置编辑器，暂时只能手动编辑 cordis.patch.yml。',
        'settings.on': '开',
        'settings.off': '关',
        'style.spec': '规格化',
        'style.brief': '极简',
        'style.clarify': '详细',
        'effort.off': '不思考',
        'effort.low': '低思考',
        'effort.high': '高思考',
        'effort.max': '最深思考',
        'error.empty': '草稿是空的。',
        'error.tooLong': '草稿超过长度上限，请精简后再试。',
        'error.chips': '草稿含 @引用或命令芯片，改写会破坏它们；请先移除。',
        'error.busy': '已有一次增强在进行中。',
        'error.disabled': '提示词增强已在插件配置中关闭。',
        'error.unconfigured': '没有可用的模型：请先在本会话发送一条消息，或在插件配置里填写 provider / model。',
        'error.timeout': '增强超时，可以重试；原草稿未改动。',
        'error.rateLimit': '请求过于频繁，请稍后再试。',
        'error.concurrency': '同时进行的增强太多，请等一个完成后再试。',
        'error.retryAfter': '请 {seconds} 秒后再试。',
        'error.details': '技术详情',
        'error.auth': '模型鉴权失败：请检查该 provider 的 API Key 配置。',
        'error.quota': '模型服务额度或余额不足，请检查账户。',
        'error.contextWindow': '输入超出模型上下文窗口，请精简草稿或更换模型。',
        'error.aborted': '已取消。',
        'error.upstream': '模型服务返回错误，请重试；原草稿未改动。',
        'error.internal': '增强失败，请重试；原草稿未改动。',
      },
      en: {
        'button.title': 'Refine prompt (Ctrl+Alt+E)',
        'menu.title': 'Refine with style',
        'button.busy': 'Refining…',
        'button.hintEmpty': 'Type a draft first',
        'button.hintChips': 'The draft has @references or a command chip; refining would break them',
        'button.hintTooLong': 'The draft is too long to refine',
        'panel.title': 'Prompt refinement',
        'panel.dragHint': 'Drag the title to move · resize from the bottom-right corner · double-click the title to reset',
        'panel.original': 'Original',
        'panel.result': 'Refined',
        'panel.cached': 'from cache',
        'panel.chars': '{count} chars',
        'panel.loading': 'Rewriting the draft…',
        'panel.streaming': 'Writing…',
        'panel.applied': 'Draft replaced',
        'panel.stale': 'The draft changed after this request; applying will overwrite it',
        'panel.apply': 'Replace draft',
        'panel.applySend': 'Replace & send',
        'panel.copy': 'Copy',
        'panel.copied': 'Copied',
        'panel.retry': 'Retry',
        'panel.cancel': 'Stop',
        'panel.undo': 'Undo',
        'panel.undoLast': 'Undo last replace',
        'panel.close': 'Close',
        'panel.context': 'Context',
        'panel.contextOn': 'Context awareness is on for this run (click to turn off)',
        'panel.contextOff': 'Context is off for this run (click to turn on)',
        'panel.contextUsed': 'grounded in {turns} turns',
        'panel.pin': 'Pin',
        'panel.compare': 'Compare',
        'panel.useThis': 'Use this',
        'panel.unpin': 'Unpin',
        'panel.tokens': 'in {input} · out {output} tok',
        'panel.seconds': '{value}s',
        'panel.cost': '≈ {amount}',
        'panel.costEstimate': 'Estimated from this plugin\'s configured rates',
        'panel.ratePeak': 'peak hours',
        'panel.rateOffPeak': 'off-peak',
        'panel.length': '{before}→{after} chars',
        'panel.editable': 'Editable; changes sync to the composer live',
        'panel.locked': 'The session is submitting; the draft cannot be edited right now',
        'settings.label': 'Prompt Forge',
        'settings.enabled': 'Enable the plugin',
        'settings.currentRoute': 'Active model',
        'settings.billingPeriod': 'Billing period',
        'settings.routeUnset': 'Follows the session (no default model resolved on the host)',
        'settings.modelPairRequired': 'Provider and model must be filled together, or both left empty',
        'settings.intro': 'Saved to the active profile patch and applied immediately (the plugin hot-reloads).',
        'settings.basic': 'Basics',
        'settings.directApply': 'Replace the draft on click',
        'settings.directApplyHint': 'On: clicking ✨ rewrites the composer directly; off: opens the review popover (default).',
        'settings.directStyle': 'Style used by direct replace',
        'settings.directStyleDefault': 'Follow the default style',
        'settings.compareStyle': 'Comparison style',
        'settings.compareStyleOff': 'Off (single candidate)',
        'settings.compareStyleHint': 'When set, the preview generates a second style in parallel for comparison (double cost).',
        'settings.toastDurationMs': 'Cost toast duration (ms)',
        'settings.shortcutOpensPreview': 'Shortcut always opens the preview',
        'settings.shortcutOpensPreviewHint': 'When off, Ctrl+Alt+E replaces directly in direct mode.',
        'settings.usage': 'Usage',
        'settings.prompt': 'Prompt template',
        'settings.promptMode': 'Template mode',
        'settings.promptModeAppend': 'Append to built-in instructions',
        'settings.promptModeReplace': 'Replace built-in instructions',
        'settings.promptModeHint': 'Append: your instructions follow the built-in rules. Replace: only your instructions are used (conversation-context guidance is still appended).',
        'settings.systemPrompt': 'Custom instructions',
        'settings.systemPromptHint': 'Leave empty to use the built-in instructions; up to 8000 characters.',
        'settings.history': 'Recent results',
        'settings.historyEmpty': 'No results to browse yet.',
        'settings.copy': 'Copy',
        'settings.copied': 'Copied',
        'settings.delete': 'Delete',
        'settings.expand': 'Expand',
        'settings.hide': 'Collapse',
        'settings.clearHistory': 'Clear history',
        'settings.original': 'Draft',
        'settings.spendToday': "Today's estimated spend",
        'settings.runsToday': 'Enhancements today',
        'settings.clearSpend': 'Clear',
        'settings.applied': 'Saved and applied',
        'settings.savedPending': 'Saved, waiting for the plugin reload…',
        'settings.invalid': 'A field is out of range',
        'toast.draftChanged': 'Draft changed; the result was moved to the preview',
        'toast.failed': 'Generation failed; opened the preview',
        'toast.today': 'Today',
        'direct.running': 'Generating · {style}',
        'direct.stop': 'Stop',
        'toast.stopped': 'Stopped; draft restored',
        'toast.cost': '≈ {amount} (estimate)',
        'toast.done': 'Draft replaced',
        'button.applied': 'Replaced',
        'button.undo': 'Undo',
        'settings.defaultStyle': 'Default style',
        'settings.streaming': 'Stream output',
        'settings.model': 'Model',
        'settings.provider': 'Provider',
        'settings.modelName': 'Model name',
        'settings.modelHint': 'Leave both empty to follow the session model; fill both or neither.',
        'settings.effort': 'Thinking effort',
        'settings.effortGlobal': 'Global override',
        'settings.effortByStyle': 'Per style',
        'settings.context': 'Context awareness',
        'settings.contextMessages': 'Recent turns',
        'settings.contextChars': 'Context character budget',
        'settings.limits': 'Generation limits',
        'settings.temperature': 'Temperature',
        'settings.maxOutputTokens': 'Max output tokens',
        'settings.maxInputChars': 'Draft character cap',
        'settings.timeoutMs': 'Timeout (ms)',
        'settings.maxConcurrent': 'Concurrency',
        'settings.rateLimit': 'Requests per minute',
        'settings.pricing': 'Cost estimate rates (per 1M tokens)',
        'settings.currency': 'Currency',
        'settings.currencyPlaceholder': 'USD',
        'settings.inputPerMTok': 'Input (cache miss, CNY / 1M tok)',
        'settings.outputPerMTok': 'Output (CNY / 1M tok)',
        'settings.cachedInputPerMTok': 'Input (cache hit, CNY / 1M tok)',
        'settings.pricingHint': 'Official API billing: these are off-peak rates; peak hours (Beijing weekdays 09:00-12:00, 14:00-18:00) bill at 2x.',
        'settings.follow': 'Follow session',
        'settings.save': 'Save',
        'settings.reset': 'Reset to defaults',
        'settings.saved': 'Saved, applying…',
        'settings.failed': 'Save failed',
        'settings.loadFailed': 'Could not load settings',
        'settings.loading': 'Loading…',
        'settings.unavailable': 'The profile config editor is not mounted; edit cordis.patch.yml by hand for now.',
        'settings.on': 'On',
        'settings.off': 'Off',
        'style.spec': 'Spec',
        'style.brief': 'Concise',
        'style.clarify': 'Detailed',
        'effort.off': 'no thinking',
        'effort.low': 'low thinking',
        'effort.high': 'high thinking',
        'effort.max': 'max thinking',
        'error.empty': 'The draft is empty.',
        'error.tooLong': 'The draft exceeds the length cap.',
        'error.chips': 'The draft contains @references or a command chip; refining would break them.',
        'error.busy': 'Another refinement is already running.',
        'error.disabled': 'Prompt refinement is disabled in the plugin config.',
        'error.unconfigured': 'No model route: send one message in this session first, or set provider / model in the plugin config.',
        'error.timeout': 'Refinement timed out; retry when ready. The draft was not touched.',
        'error.rateLimit': 'Too many requests; try again shortly.',
        'error.concurrency': 'Too many refinements in flight; wait for one to finish.',
        'error.retryAfter': 'Retry in {seconds}s.',
        'error.details': 'Technical details',
        'error.auth': 'Model authentication failed: check the provider API key.',
        'error.quota': 'The model service quota or balance is exhausted.',
        'error.contextWindow': 'The input exceeds the model context window; shorten the draft or switch models.',
        'error.aborted': 'Cancelled.',
        'error.upstream': 'The model service returned an error; retry. The draft was not touched.',
        'error.internal': 'Refinement failed; retry. The draft was not touched.',
      },
    }

    // -----------------------------------------------------------------------
    // Store: one popover per session
    // -----------------------------------------------------------------------
    const panels = new Map()

    /** Bound the per-session panel map; never evict the running or current one. */
    function putPanel(sessionId, panel) {
      panels.set(sessionId, panel)
      if (panels.size <= PANEL_LIMIT) return
      for (const [key, value] of panels) {
        if (key === sessionId || value.phase === 'loading') continue
        panels.delete(key)
        if (panels.size <= PANEL_LIMIT) return
      }
    }
    let panelToken = 0
    let version = 0
    const listeners = new Set()
    const anchors = new Map()
    const remoteConfig = {
      enabled: true,
      defaultStyle: 'brief',
      directStyle: '',
      compareStyle: '',
      maxInputChars: 12000,
      contextAware: false,
      streaming: true,
      directApply: false,
      toastDurationMs: 2600,
      shortcutOpensPreview: true,
      routeKey: '',
    }
    let configLoaded = false
    // Per-run context switch, remembered across popover opens and reloads.
    const CONTEXT_KEY = 'dsh.prompt-forge.context-off'
    let contextOff = (() => {
      try { return localStorage.getItem(CONTEXT_KEY) === '1' } catch { return false }
    })()
    // Pin: while pinned, a pointer press outside the popover leaves it open.
    let pinned = false
    // Locale translator bound in apply(); also used by the settings page.
    let translate = (key) => key

    function subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    }

    function getVersion() {
      return version
    }

    function bump() {
      version += 1
      for (const listener of [...listeners]) listener()
    }

    function useStore() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, getVersion, getVersion)
      }
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return version
    }

    function loadConfig() {
      if (configLoaded) return
      configLoaded = true
      fetch(`${ENDPOINT}/config`, { headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .then((payload) => {
          if (payload !== null && typeof payload === 'object' && payload.ok === true && payload.value !== undefined) {
            Object.assign(remoteConfig, payload.value)
            bump()
          }
        })
        .catch(() => {})
    }

    // -----------------------------------------------------------------------
    // Result cache: draft + style + config fingerprint; exact text verified
    // -----------------------------------------------------------------------
    let resultCache = null

    function cacheStore() {
      if (resultCache !== null) return resultCache
      resultCache = new Map()
      try {
        const raw = localStorage.getItem(CACHE_KEY)
        if (raw !== null) {
          const list = JSON.parse(raw)
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item === null || typeof item !== 'object') continue
              if (typeof item.key !== 'string' || typeof item.text !== 'string') continue
              const entry = { text: item.text, routeKey: typeof item.routeKey === 'string' ? item.routeKey : '', result: item.result, savedAt: typeof item.savedAt === 'number' ? item.savedAt : 0 }
              if (entry.result === null || typeof entry.result !== 'object' || typeof entry.result.text !== 'string') continue
              resultCache.set(item.key, entry)
            }
          }
        }
      } catch {
        // Corrupt or unavailable storage: start with an empty cache.
      }
      return resultCache
    }

    function hashText(text) {
      let hash = 5381
      for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
      return (hash >>> 0).toString(36)
    }

    /** Stable stringify (sorted object keys) for structural comparisons. */
    function stableStringify(value) {
      if (value === null || typeof value !== 'object') return JSON.stringify(value)
      if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
      const keys = Object.keys(value).sort()
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
    }

    function cacheRouteKey() {
      return typeof remoteConfig.routeKey === 'string' ? remoteConfig.routeKey : ''
    }

    function cacheKeyOf(style, text, routeKey) {
      return `${style}|${text.length}|${hashText(text)}|${routeKey}`
    }

    function readCache(style, text, routeKey) {
      const key = routeKey === undefined ? cacheRouteKey() : routeKey
      const entry = cacheStore().get(cacheKeyOf(style, text, key))
      if (entry === undefined) return undefined
      if (entry.text !== text || entry.routeKey !== key) return undefined
      return entry.result
    }

    function writeCache(style, text, value, routeKey) {
      const key = routeKey === undefined ? cacheRouteKey() : routeKey
      const store = cacheStore()
      store.set(cacheKeyOf(style, text, key), { text, routeKey: key, result: value, savedAt: Date.now() })
      while (store.size > CACHE_LIMIT) {
        const oldest = store.keys().next()
        if (oldest.done === true) break
        store.delete(oldest.value)
      }
      persistCache()
    }

    /** Persist the in-memory result cache; storage failures degrade silently. */
    function persistCache() {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify([...cacheStore()].map(([key, entry]) => ({
          key,
          text: entry.text,
          routeKey: entry.routeKey,
          result: entry.result,
          savedAt: entry.savedAt ?? 0,
        }))))
      } catch {
        // Storage full or unavailable: the in-memory cache still serves this page.
      }
    }

    /** Recent results, newest first, for the settings page history list. */
    function readHistory(limit) {
      return [...cacheStore().entries()]
        .map(([key, entry]) => ({
          key,
          style: key.split('|')[0],
          text: entry.text,
          result: entry.result,
          savedAt: typeof entry.savedAt === 'number' ? entry.savedAt : 0,
        }))
        .filter((entry) => entry.result !== null && entry.result !== undefined && typeof entry.result.text === 'string')
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, limit === undefined ? 12 : limit)
    }

    // -----------------------------------------------------------------------
    // Local spend ledger: today's estimated cost, browser-only
    // -----------------------------------------------------------------------
    const SPEND_KEY = 'dsh.prompt-forge.spend.v1'

    function todayKey() {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    }

    function readSpend() {
      try {
        const raw = localStorage.getItem(SPEND_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object' && parsed.day === todayKey()) {
            return {
              day: parsed.day,
              totals: parsed.totals !== null && typeof parsed.totals === 'object' ? parsed.totals : {},
              runs: typeof parsed.runs === 'number' ? parsed.runs : 0,
            }
          }
        }
      } catch {
        // Unreadable ledger: start a fresh one.
      }
      return { day: todayKey(), totals: {}, runs: 0 }
    }

    function writeSpend(spend) {
      try { localStorage.setItem(SPEND_KEY, JSON.stringify(spend)) } catch { /* storage unavailable */ }
    }

    function recordSpend(cost) {
      if (cost === null || cost === undefined || typeof cost.amount !== 'number' || !Number.isFinite(cost.amount)) return
      const spend = readSpend()
      const currency = typeof cost.currency === 'string' && cost.currency !== '' ? cost.currency : 'USD'
      spend.totals[currency] = (spend.totals[currency] ?? 0) + cost.amount
      spend.runs += 1
      writeSpend(spend)
    }

    function spendSummary() {
      const spend = readSpend()
      const entries = Object.entries(spend.totals).filter(([, amount]) => typeof amount === 'number' && amount > 0)
      if (entries.length === 0) return null
      return {
        text: entries.map(([currency, amount]) => formatCost({ amount, currency })).filter((part) => part !== null).join(' · '),
        runs: spend.runs,
      }
    }

    function clearSpend() {
      try { localStorage.removeItem(SPEND_KEY) } catch { /* storage unavailable */ }
    }

    // -----------------------------------------------------------------------
    // Last-replace record, so undo survives closing the popover
    // -----------------------------------------------------------------------
    let undoStore = null

    function undoMap() {
      if (undoStore !== null) return undoStore
      undoStore = new Map()
      try {
        const raw = localStorage.getItem(UNDO_KEY)
        if (raw !== null) {
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object') {
            for (const [sessionId, entry] of Object.entries(parsed)) {
              if (entry === null || typeof entry !== 'object') continue
              if (typeof entry.original !== 'string' || typeof entry.applied !== 'string') continue
              undoStore.set(sessionId, { original: entry.original, applied: entry.applied })
            }
          }
        }
      } catch {
        // Ignore corrupt storage.
      }
      return undoStore
    }

    function persistUndo() {
      try {
        localStorage.setItem(UNDO_KEY, JSON.stringify(Object.fromEntries(undoMap())))
      } catch {
        // Quota/unavailable: the in-memory map still serves this page.
      }
    }

    function rememberUndo(sessionId, original, applied) {
      undoMap().set(sessionId, { original, applied })
      persistUndo()
      bump()
    }

    function forgetUndo(sessionId) {
      undoMap().delete(sessionId)
      persistUndo()
      bump()
    }

    function undoFor(sessionId, draft) {
      const entry = undoMap().get(sessionId)
      if (entry === undefined) return undefined
      if (entry.applied !== draft) return undefined
      return entry
    }

    // -----------------------------------------------------------------------
    // Persisted layout
    // -----------------------------------------------------------------------
    function readSavedLayout() {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY)
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return null
        const width = typeof parsed.width === 'number' && Number.isFinite(parsed.width) ? parsed.width : undefined
        const height = typeof parsed.height === 'number' && Number.isFinite(parsed.height) ? parsed.height : undefined
        const x = typeof parsed.x === 'number' && Number.isFinite(parsed.x) ? parsed.x : undefined
        const y = typeof parsed.y === 'number' && Number.isFinite(parsed.y) ? parsed.y : undefined
        return { width, height, x, y }
      } catch {
        return null
      }
    }

    function writeSavedLayout(next) {
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
    }

    function initialBox() {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const saved = readSavedLayout()
      const width = clamp(saved !== null && saved.width !== undefined ? saved.width : DEFAULT_WIDTH, MIN_WIDTH, Math.max(MIN_WIDTH, viewportWidth - EDGE * 2))
      const height = clamp(saved !== null && saved.height !== undefined ? saved.height : DEFAULT_HEIGHT, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - EDGE * 2))
      if (saved !== null && saved.x !== undefined && saved.y !== undefined) {
        return {
          mode: 'manual',
          width,
          height,
          left: clamp(saved.x, EDGE, viewportWidth - width - EDGE),
          top: clamp(saved.y, EDGE, viewportHeight - height - EDGE),
        }
      }
      return autoBox(width, height)
    }

    function autoBox(width, height) {
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const anchor = anchors.get('__current__')
      if (anchor === undefined) {
        return { mode: 'auto', width, height, left: clamp(viewportWidth - width - 16, EDGE, viewportWidth - width - EDGE), top: 80 }
      }
      const rect = anchor.getBoundingClientRect()
      const above = rect.top - GAP - EDGE
      const top = above >= height + 8 ? rect.top - GAP - height : rect.bottom + GAP
      const left = clamp(rect.right - width, EDGE, Math.max(EDGE, viewportWidth - width - EDGE))
      return {
        mode: 'auto',
        width,
        height,
        left,
        top: clamp(top, EDGE, Math.max(EDGE, viewportHeight - height - EDGE)),
      }
    }

    // -----------------------------------------------------------------------
    // Panel lifecycle
    // -----------------------------------------------------------------------
    function closePanel(sessionId) {
      const current = panels.get(sessionId)
      if (current === undefined) return
      if (typeof current.abort === 'function') {
        try { current.abort() } catch { /* already settled */ }
      }
      panels.delete(sessionId)
      bump()
    }

    function openError(sessionId, original, style, code, message, params) {
      putPanel(sessionId, {
        token: ++panelToken,
        sessionId,
        phase: 'error',
        original,
        requestText: original,
        style,
        error: { code, message, params },
      })
      bump()
    }

    function settle(sessionId, value) {
      const current = panels.get(sessionId)
      if (current === undefined || current.phase !== 'loading') return
      writeCache(current.style, current.requestText, value, current.cacheKey)
      recordSpend(value === null || value === undefined ? null : value.cost)
      putPanel(sessionId, { ...current, phase: 'result', result: value, resultSource: current.requestText, abort: undefined, streaming: undefined })
      bump()
    }

    function reject(sessionId, error) {
      const current = panels.get(sessionId)
      if (current === undefined || current.phase !== 'loading') return
      putPanel(sessionId, { ...current, phase: 'error', error, abort: undefined, streaming: undefined })
      bump()
    }

    function makeError(code, message, params) {
      return {
        code: typeof code === 'string' ? code : 'internal',
        message: typeof message === 'string' ? message : undefined,
        params: params !== null && typeof params === 'object' ? params : undefined,
      }
    }

    // Coalesce streaming deltas so a fast model does not re-render per token.
    let streamScheduled = false

    /**
     * Withhold a leading code fence while streaming: the final text is
     * normalized server-side, so showing the fence first would make the text
     * jump when the result settles. Fenced answers simply stream as nothing
     * and appear complete at the end.
     */
    function createDisplayFilter() {
      let raw = ''
      let emitted = 0
      let mode = 'unknown'
      return {
        push(delta) {
          raw += delta
          if (mode === 'unknown') {
            const head = raw.replace(/^\s+/u, '')
            if (head.length < 3) return ''
            mode = head.startsWith('```') ? 'fenced' : 'plain'
          }
          if (mode !== 'plain') return ''
          const out = raw.slice(emitted)
          emitted = raw.length
          return out
        },
      }
    }

    function appendStream(sessionId, delta) {
      const current = panels.get(sessionId)
      if (current === undefined || current.phase !== 'loading') return
      const shown = current.display === undefined ? delta : current.display.push(delta)
      if (shown === '') return
      putPanel(sessionId, { ...current, streaming: `${current.streaming ?? ''}${shown}` })
      if (streamScheduled) return
      streamScheduled = true
      queueMicrotask(() => {
        streamScheduled = false
        bump()
      })
    }

    /** The cache namespace for one session: config fingerprint + resolved route. */
    async function fetchRouteKey(sessionId) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 1000)
      try {
        const query = typeof sessionId === 'string' && sessionId !== '' ? `?session=${encodeURIComponent(sessionId)}` : ''
        const response = await fetch(`${ENDPOINT}/route${query}`, {
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        const payload = await response.json()
        if (payload !== null && typeof payload === 'object' && payload.ok === true && payload.value !== undefined) {
          if (typeof payload.value.key === 'string' && payload.value.key !== '') return payload.value.key
        }
      } catch {
        // A slow or missing route endpoint falls back to the config fingerprint.
      } finally {
        clearTimeout(timer)
      }
      return cacheRouteKey()
    }

    async function requestJson(body, signal) {
      const response = await fetch(`${ENDPOINT}/enhance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal,
      })
      let payload
      try { payload = await response.json() } catch { payload = undefined }
      if (payload !== null && payload !== undefined && payload.ok === true && payload.value !== undefined) return payload.value
      const error = payload !== null && payload !== undefined && payload.error !== undefined ? payload.error : undefined
      throw makeError(error === undefined ? 'internal' : error.code, error === undefined ? undefined : error.message, error === undefined ? undefined : error.params)
    }

    /** Read one SSE response, forwarding deltas to `onDelta`, returning the value. */
    async function readSse(response, body, signal, onDelta) {
      if (!response.ok) {
        let payload
        try { payload = await response.json() } catch { payload = undefined }
        const error = payload !== null && payload !== undefined && payload.error !== undefined ? payload.error : undefined
        throw makeError(error === undefined ? 'internal' : error.code, error === undefined ? undefined : error.message, error === undefined ? undefined : error.params)
      }
      if (response.body === null || response.body === undefined) return requestJson(body, signal)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let value
      for (;;) {
        const { value: chunk, done } = await reader.read()
        if (done === true) break
        buffer += decoder.decode(chunk, { stream: true })
        let boundary = buffer.indexOf('\n\n')
        while (boundary >= 0) {
          const block = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          boundary = buffer.indexOf('\n\n')
          for (const line of block.split('\n')) {
            if (!line.startsWith('data:')) continue
            let frame
            try { frame = JSON.parse(line.slice(5).trim()) } catch { continue }
            if (frame === null || typeof frame !== 'object') continue
            if (frame.type === 'delta' && typeof frame.text === 'string') onDelta(frame.text)
            else if (frame.type === 'done') value = frame.value
            else if (frame.type === 'error') throw makeError(frame.error?.code, frame.error?.message, frame.error?.params)
          }
        }
      }
      if (value === undefined) throw makeError('internal', 'the stream ended without a result')
      return value
    }

    /** Stream into the preview panel for one session. */
    async function requestStream(body, signal, sessionId) {
      const response = await fetch(`${ENDPOINT}/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
      })
      return readSse(response, body, signal, (text) => appendStream(sessionId, text))
    }

    /** Stream with a caller-supplied delta handler (direct apply mode). */
    async function requestStreamDirect(body, signal, onDelta) {
      const response = await fetch(`${ENDPOINT}/stream`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
      })
      return readSse(response, body, signal, onDelta)
    }

    // Guards the route lookup so a double click cannot open two requests.
    const starting = new Set()
    // Sessions whose direct (no-popover) run is in flight: sessionId -> { style }.
    const directRuns = new Map()

    // Direct mode has no popover, so it surfaces a transient cost toast.
    let toast = null
    let toastTimer = null

    function showToast(text, title) {
      const configured = Number.isFinite(remoteConfig.toastDurationMs) ? remoteConfig.toastDurationMs : 2600
      const duration = Math.min(10000, Math.max(800, configured))
      toast = { text, title, id: (toast === null ? 0 : toast.id) + 1 }
      if (toastTimer !== null) clearTimeout(toastTimer)
      toastTimer = later(() => {
        toastTimer = null
        toast = null
        bump()
      }, duration)
      bump()
    }

    /**
     * Open the popover for one session.
     * @param force - skip the cache and call the model (Retry).
     * @param options.runContextOff - run this call without conversation context.
     */
    async function start(sessionId, text, style, force, options) {
      const current = panels.get(sessionId)
      if (current !== undefined && current.phase === 'loading') return
      if (starting.has(sessionId)) return
      starting.add(sessionId)
      let cacheKey
      try {
        cacheKey = await fetchRouteKey(sessionId)
      } finally {
        starting.delete(sessionId)
      }
      const runContextOff = options !== undefined && options.runContextOff === true
      const compareStyle = typeof remoteConfig.compareStyle === 'string'
        && remoteConfig.compareStyle !== ''
        && remoteConfig.compareStyle !== style
        ? remoteConfig.compareStyle
        : ''
      if (force !== true) {
        const cached = readCache(style, text, cacheKey)
        if (cached !== undefined) {
          const token = ++panelToken
          putPanel(sessionId, {
            token,
            sessionId,
            phase: 'result',
            original: text,
            requestText: text,
            resultSource: text,
            style,
            result: cached,
            cached: true,
            cacheKey,
            runContextOff,
            ...(compareStyle === '' ? {} : { compare: { style: compareStyle, phase: 'loading' } }),
          })
          bump()
          if (compareStyle !== '') startCompare(sessionId, token, text, compareStyle, cacheKey, runContextOff)
          return
        }
      }
      const controller = new AbortController()
      const token = ++panelToken
      putPanel(sessionId, {
        token,
        sessionId,
        phase: 'loading',
        original: text,
        requestText: text,
        style,
        streaming: '',
        display: createDisplayFilter(),
        cacheKey,
        runContextOff,
        abort: () => controller.abort(),
        ...(compareStyle === '' ? {} : { compare: { style: compareStyle, phase: 'loading' } }),
      })
      bump()
      if (compareStyle !== '') startCompare(sessionId, token, text, compareStyle, cacheKey, runContextOff)
      const body = { sessionId, text, style }
      if (runContextOff) body.context = false
      const pending = remoteConfig.streaming === false
        ? requestJson(body, controller.signal)
        : requestStream(body, controller.signal, sessionId)
      pending
        .then((value) => settle(sessionId, value))
        .catch((error) => {
          if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
            const live = panels.get(sessionId)
            if (live !== undefined && live.phase === 'loading') {
              panels.delete(sessionId)
              bump()
            }
            return
          }
          reject(sessionId, makeError(error?.code, error?.message, error?.params))
        })
    }

    /**
     * Comparison candidate: one extra non-streamed request for a second style.
     * Results land on `panel.compare` so the primary candidate keeps streaming.
     */
    function startCompare(sessionId, token, text, style, cacheKey, runContextOff) {
      const cached = readCache(style, text, cacheKey)
      if (cached !== undefined) {
        const live = panels.get(sessionId)
        if (live === undefined || live.token !== token) return
        putPanel(sessionId, { ...live, compare: { style, phase: 'result', result: cached, cached: true } })
        bump()
        return
      }
      const body = { sessionId, text, style }
      if (runContextOff) body.context = false
      const controller = new AbortController()
      requestJson(body, controller.signal)
        .then((value) => {
          const live = panels.get(sessionId)
          if (live === undefined || live.token !== token) return
          writeCache(style, text, value, cacheKey)
          recordSpend(value.cost)
          putPanel(sessionId, { ...live, compare: { style, phase: 'result', result: value } })
          bump()
        })
        .catch((error) => {
          const live = panels.get(sessionId)
          if (live === undefined || live.token !== token) return
          if (error !== null && typeof error === 'object' && error.name === 'AbortError') return
          putPanel(sessionId, {
            ...live,
            compare: { style, phase: 'error', error: makeError(error?.code, error?.message, error?.params) },
          })
          bump()
        })
    }

    /**
     * Direct mode: refine without a popover, then replace the composer draft.
     * Failures open the popover in its error state so the user still gets a
     * retry path and the reason.
     */
    async function startDirect(sessionId, text, style, inputActions, readDraft) {
      if (directRuns.has(sessionId) || starting.has(sessionId)) return
      const currentPanel = panels.get(sessionId)
      if (currentPanel !== undefined && currentPanel.phase === 'loading') return
      starting.add(sessionId)
      directRuns.set(sessionId, { style })
      bump()
      let cacheKey
      try {
        cacheKey = await fetchRouteKey(sessionId)
      } finally {
        starting.delete(sessionId)
      }
      const canWrite = inputActions !== undefined && typeof inputActions.setDraft === 'function'
      const read = () => (typeof readDraft === 'function' ? readDraft() : text)
      let lastWritten = text
      let diverted = false
      const controller = new AbortController()
      const run = directRuns.get(sessionId)
      if (run !== undefined) run.controller = controller
      try {
        let value = readCache(style, text, cacheKey)
        if (value === undefined) {
          const body = { sessionId, text, style }
          if (contextOff) body.context = false
          if (remoteConfig.streaming !== false && canWrite) {
            // Stream into the composer so the wait is visible. Writes are
            // coalesced (~60ms) and stop as soon as the user edits the draft.
            const display = createDisplayFilter()
            let shown = ''
            let pending = null
            let mismatches = 0
            const flush = () => {
              pending = null
              if (diverted) return
              if (read() !== lastWritten) {
                mismatches += 1
                if (mismatches >= 2) diverted = true
                return
              }
              mismatches = 0
              lastWritten = shown
              inputActions.setDraft(shown)
            }
            const onDelta = (delta) => {
              const visible = display.push(delta)
              if (visible === '') return
              shown += visible
              if (pending === null) pending = setTimeout(flush, 60)
            }
            try {
              value = await requestStreamDirect(body, controller.signal, onDelta)
            } finally {
              if (pending !== null) {
                clearTimeout(pending)
                pending = null
              }
            }
            if (!diverted && read() !== lastWritten) {
              mismatches += 1
              if (mismatches >= 2) diverted = true
            }
          } else {
            value = await requestJson(body, controller.signal)
          }
          writeCache(style, text, value, cacheKey)
          recordSpend(value.cost)
        }
        const liveText = read()
        const ours = liveText === text || liveText === lastWritten
        if (diverted || !ours) {
          // The composer moved on while we were generating: never overwrite a
          // newer draft silently. Show the result for review instead.
          showToast(translate('toast.draftChanged'))
          putPanel(sessionId, {
            token: ++panelToken,
            sessionId,
            phase: 'result',
            original: text,
            requestText: text,
            resultSource: text,
            style,
            result: value,
            cacheKey,
          })
          bump()
          return
        }
        rememberUndo(sessionId, text, value.text)
        if (canWrite) inputActions.setDraft(value.text)
        const costText = formatCost(value.cost)
        if (costText !== null) {
          const estimated = value.cost !== null && value.cost !== undefined && value.cost.estimated === true
          const titleParts = []
          if (estimated) titleParts.push(translate('panel.costEstimate'))
          if (value.cost.period === 'peak') titleParts.push(translate('panel.ratePeak'))
          else if (value.cost.period === 'off-peak') titleParts.push(translate('panel.rateOffPeak'))
          const spend = spendSummary()
          if (spend !== null) titleParts.push(`${translate('toast.today')} ${spend.text}`)
          showToast(
            translate('toast.cost').replace('{amount}', costText),
            titleParts.length === 0 ? undefined : titleParts.join(' · '),
          )
        } else {
          const tokenText = tokensText(translate, value.usage)
          showToast(tokenText !== null ? tokenText : translate('toast.done'))
        }
      } catch (error) {
        if (error !== null && typeof error === 'object' && error.name === 'AbortError') {
          // Explicit stop: put the original draft back and say so.
          if (!diverted && lastWritten !== text && canWrite) inputActions.setDraft(text)
          showToast(translate('toast.stopped'))
          return
        }
        // A failed stream may have left partial text in the composer; restore
        // the user's original draft unless they edited it themselves.
        if (!diverted && lastWritten !== text && canWrite) inputActions.setDraft(text)
        showToast(translate('toast.failed'))
        openError(sessionId, text, style, error?.code, error?.message, error?.params)
      } finally {
        directRuns.delete(sessionId)
        bump()
      }
    }
    // -----------------------------------------------------------------------
    // Shared UI helpers
    // -----------------------------------------------------------------------
    function charCount(text) {
      return Array.from(text).length
    }

    const CSS = `
.pfgo-btn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;flex:none}
.pfgo-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pfgo-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pfgo-btn:disabled{opacity:.35;cursor:default}
.pfgo-btn[data-busy="true"]{opacity:.55;cursor:progress}
.pfgo-direct{display:inline-flex;align-items:center;gap:2px;margin-left:0;padding:0 4px 0 7px;height:20px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.pfgo-direct-text{line-height:1}
.pfgo-direct-undo{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font-size:10.5px;font-family:inherit;cursor:pointer;padding:0 2px;border-radius:4px}
.pfgo-direct-undo:hover{text-decoration:underline}
.pfgo-direct--busy{color:var(--dsw-alias-label-secondary)}
.pfgo-direct{border:0;font-family:inherit}
.pfgo-direct--stop{cursor:pointer}
.pfgo-direct--stop:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.pfgo-anchor-wrap{position:relative;display:inline-flex;align-items:center;gap:4px;flex:none}
.pfgo-menu{position:absolute;right:0;bottom:calc(100% + 6px);z-index:95;display:flex;flex-direction:column;gap:2px;min-width:150px;padding:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 8px 24px rgb(0 0 0 / 18%)}
.pfgo-menu-title{padding:2px 6px 4px;font-size:10.5px;color:var(--dsw-alias-label-secondary)}
.pfgo-menu-item{border:0;background:transparent;text-align:left;font-family:inherit;font-size:12.5px;color:var(--dsw-alias-label-primary);padding:6px 8px;border-radius:7px;cursor:pointer}
.pfgo-menu-item:hover,.pfgo-menu-item:focus-visible{background:var(--dsw-alias-bg-layer-2);outline:none}
.pfgo-toast{position:absolute;right:0;bottom:calc(100% + 8px);z-index:90;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-overlay);box-shadow:0 6px 20px rgb(0 0 0 / 16%);color:var(--dsw-alias-label-primary);font-size:12px;pointer-events:none;white-space:nowrap;animation:pfgo-toast-in .16s ease-out}
@keyframes pfgo-toast-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.pfgo-toast{animation:none}}
.pfgo-pop{position:fixed;z-index:80;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 12px 32px rgb(0 0 0 / 16%),0 2px 8px rgb(0 0 0 / 8%);color:var(--dsw-alias-label-primary);font-size:12.5px;overflow:hidden}
.pfgo-pop:focus{outline:none}
.pfgo-head{display:flex;align-items:center;gap:6px;padding:9px 10px 9px 12px;cursor:grab;user-select:none;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:nowrap;min-width:0}
.pfgo-head:active{cursor:grabbing}
.pfgo-title{font-weight:600;font-size:13px;margin-right:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfgo-chip{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:0 8px;font-size:11px;line-height:19px;cursor:pointer;font-family:inherit;flex:none}
.pfgo-chip:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.pfgo-chip[data-active="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.pfgo-chip:disabled{opacity:.5;cursor:default}
.pfgo-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pfgo-switch{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;padding:1px 2px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:10.5px;line-height:1;color:var(--dsw-alias-label-secondary);flex:none}
.pfgo-switch:hover{color:var(--dsw-alias-label-primary)}
.pfgo-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pfgo-switch:disabled{opacity:.5;cursor:default}
.pfgo-switch-text{white-space:nowrap}
.pfgo-switch-track{position:relative;display:inline-block;width:26px;height:14px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);transition:background .15s ease,border-color .15s ease}
.pfgo-switch:hover .pfgo-switch-track{border-color:var(--dsw-alias-border-l2)}
.pfgo-switch-track[data-on="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}
.pfgo-switch-knob{position:absolute;top:1px;left:1px;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-secondary);transition:transform .15s ease,background .15s ease}
.pfgo-switch-track[data-on="true"] .pfgo-switch-knob{transform:translateX(12px);background:var(--dsw-alias-bg-base)}
@media (prefers-reduced-motion: reduce){.pfgo-switch-track,.pfgo-switch-knob{transition:none}}
.pfgo-spacer{flex:1 1 auto;min-width:8px}
.pfgo-close{border:0;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:15px;line-height:1;padding:1px 5px;border-radius:6px;flex:none}
.pfgo-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pfgo-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pfgo-body{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:10px 12px 8px;overscroll-behavior:contain}
.pfgo-section{display:flex;flex-direction:column;gap:3px;flex:0 0 auto;min-height:auto}
.pfgo-shead{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.pfgo-smeta{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.pfgo-tag{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;line-height:18px;padding:0 7px;border-radius:999px;font-weight:500;white-space:nowrap}
.pfgo-tag--muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pfgo-tag--brand{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.pfgo-badge{font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.pfgo-original{display:block;width:100%;box-sizing:border-box;border:0;border-left:3px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:1.5;padding:8px 10px;min-height:50px;max-height:140px;resize:vertical;outline:none;overflow:auto}
.pfgo-original::placeholder{color:var(--dsw-alias-label-secondary)}
.pfgo-original:focus{border-left-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-1)}
.pfgo-improved{border-left:3px solid var(--dsw-alias-brand-primary);border-radius:6px;padding:8px 10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.62;white-space:pre-wrap;overflow-wrap:anywhere}
.pfgo-arrow{display:flex;justify-content:center;align-items:center;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;margin:-4px 0 -2px;opacity:.7}
.pfgo-loading{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--dsw-alias-label-secondary);padding:2px 0}
.pfgo-spinner{width:12px;height:12px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:pfgo-spin .8s linear infinite;display:inline-block;flex:none}
.pfgo-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-state-error-primary);white-space:pre-wrap}
.pfgo-error-title{font-weight:600;margin-bottom:2px}
.pfgo-error-detail{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:10.5px}
.pfgo-error-detail summary{cursor:pointer;user-select:none}
.pfgo-error-detail-body{margin-top:3px;max-height:80px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
.pfgo-applied{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-state-success-primary);padding:2px 0}
.pfgo-hint{font-size:11px;color:var(--dsw-alias-state-warn-primary)}
.pfgo-foot{display:flex;flex-direction:column;align-items:stretch;gap:5px;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l1)}
.pfgo-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pfgo-primary{border:0;border-radius:8px;padding:5px 13px;font-size:12.5px;font-weight:500;cursor:pointer;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);font-family:inherit}
.pfgo-primary:hover{filter:brightness(1.06)}
.pfgo-primary:disabled{opacity:.5;cursor:default}
.pfgo-primary:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.pfgo-ghost{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);font-family:inherit}
.pfgo-ghost:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.pfgo-ghost:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.pfgo-meta{flex:0 0 auto;text-align:right;font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pfgo-grip{position:absolute;right:2px;bottom:2px;width:16px;height:16px;cursor:nwse-resize;opacity:.45;touch-action:none}
.pfgo-grip:hover{opacity:.9}
.pfgo-grip::before{content:"";position:absolute;right:3px;bottom:3px;width:8px;height:8px;border-right:2px solid var(--dsw-alias-label-secondary);border-bottom:2px solid var(--dsw-alias-label-secondary);border-radius:0 0 3px 0}
@keyframes pfgo-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.pfgo-spinner{animation:none}}
.pfgo-set{display:flex;flex-direction:column;gap:18px;padding:4px 2px 18px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:640px}
.pfgo-set-title{font-size:15px;font-weight:600;margin:0}
.pfgo-set-intro{margin:0;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
.pfgo-set-section{margin:0 0 6px;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}
.pfgo-set-group{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.pfgo-set-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.pfgo-set-label{display:flex;flex-direction:column;gap:2px;font-size:12.5px}
.pfgo-set-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);max-width:320px}
.pfgo-set-control{display:flex;align-items:center;gap:6px;flex:none}
.pfgo-set-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;padding:5px 8px;width:150px;outline:none}
.pfgo-set-input:focus{border-color:var(--dsw-alias-brand-primary)}
.pfgo-set-input--wide{width:190px}
.pfgo-set-input--num{width:96px}
.pfgo-set-textarea{box-sizing:border-box;width:100%;min-height:110px;resize:vertical;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12.5px;line-height:1.6;padding:8px 10px;outline:none}
.pfgo-set-textarea:focus{border-color:var(--dsw-alias-brand-primary)}
.pfgo-set-field{display:flex;flex-direction:column;gap:6px;padding-top:4px}
.pfgo-set-history{display:flex;flex-direction:column;gap:8px}
.pfgo-set-history-item{display:flex;flex-direction:column;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-base)}
.pfgo-set-history-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.pfgo-set-history-meta{font-size:11px;color:var(--dsw-alias-label-secondary)}
.pfgo-set-history-actions{display:flex;gap:6px}
.pfgo-set-history-text{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-primary);word-break:break-word}
.pfgo-set-history-full{margin:0;max-height:180px;overflow:auto;white-space:pre-wrap;font-family:inherit;font-size:12px;line-height:1.6}
.pfgo-set-history-original{font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-word}
.pfgo-ghost--sm{font-size:11px;padding:2px 6px}
.pfgo-cmp-actions{display:flex;gap:6px;padding-top:6px}
.pfgo-set-actions{display:flex;align-items:center;gap:10px}
.pfgo-set-group[hidden]{display:none}
.pfgo-set-sec-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);text-align:left}
.pfgo-set-sec-toggle:hover{color:var(--dsw-alias-label-primary)}
.pfgo-set-sec-toggle::after{content:'▾';font-size:10px;transition:transform .15s ease}
.pfgo-set-sec-toggle[aria-expanded="false"]::after{transform:rotate(-90deg)}
.pfgo-set-sticky{position:sticky;bottom:0;z-index:2;flex-wrap:wrap;background:var(--dsw-alias-bg-base);padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px}
@media (prefers-reduced-motion: reduce){.pfgo-set-sec-toggle::after{transition:none}}
.pfgo-set-status{font-size:12px;color:var(--dsw-alias-label-secondary)}
.pfgo-set-status[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.pfgo-set-msg{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
/* --- settings panel polish (visual only) --- */
.pfgo-set-hint[data-tone="error"]{color:var(--dsw-alias-state-error-primary)}
.pfgo-set-info{display:flex;flex-wrap:wrap;gap:8px 20px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.pfgo-set-info-item{display:inline-flex;align-items:center;gap:6px;min-width:0}
.pfgo-set-info-label{color:var(--dsw-alias-label-secondary);white-space:nowrap}
.pfgo-set-info-value{color:var(--dsw-alias-label-primary);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:320px}
.pfgo-set{gap:22px;padding:8px 4px 26px;max-width:660px}
.pfgo-set-title{font-size:17px;font-weight:650;letter-spacing:-.01em}
.pfgo-set-intro{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;line-height:1.65}
.pfgo-set-sec-toggle{padding:2px 2px 2px 0;font-weight:600;letter-spacing:.06em;transition:color .15s ease}
.pfgo-set-sec-toggle::after{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);transition:transform .18s ease,background .18s ease,border-color .18s ease}
.pfgo-set-sec-toggle:hover::after{border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1)}
.pfgo-set-group{padding:6px 14px;gap:0;border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgb(0 0 0 / 5%);border-color:var(--dsw-alias-border-l1)}
.pfgo-set-row{align-items:center;gap:18px;padding:11px 0;border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent)}
.pfgo-set-row:first-of-type{border-top:0}
.pfgo-set-row:hover .pfgo-set-label{color:var(--dsw-alias-label-primary)}
.pfgo-set-label{font-size:13px;font-weight:500}
.pfgo-set-hint{font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary);opacity:.92}
.pfgo-set-input{border-radius:8px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);border-color:transparent;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.pfgo-set-input:not(:focus){border-color:var(--dsw-alias-border-l1)}
.pfgo-set-input:hover{border-color:var(--dsw-alias-border-l2)}
.pfgo-set-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.pfgo-set-textarea{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);transition:border-color .15s ease,box-shadow .15s ease}
.pfgo-set-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-brand-primary) 16%, transparent)}
.pfgo-set-field{padding:12px 0 4px;border-top:1px solid color-mix(in srgb, var(--dsw-alias-border-l1) 55%, transparent)}
.pfgo-switch-track{width:28px;height:16px}
.pfgo-switch-knob{width:12px;height:12px}
.pfgo-switch-track[data-on="true"] .pfgo-switch-knob{transform:translateX(12px)}
.pfgo-primary{border-radius:9px;padding:7px 15px;font-weight:600;box-shadow:0 1px 2px rgb(0 0 0 / 10%);transition:filter .15s ease,opacity .15s ease}
.pfgo-primary:hover:not(:disabled){filter:brightness(1.06)}
.pfgo-primary:disabled{opacity:.55;cursor:default}
.pfgo-set-actions .pfgo-ghost{border-radius:9px;padding:6px 12px}
.pfgo-set-sticky{background:linear-gradient(to top, var(--dsw-alias-bg-base) 60%, transparent);backdrop-filter:blur(6px);border-top:0;margin-top:0;padding:14px 0 6px}
.pfgo-set-sticky::before{content:'';position:absolute;left:0;right:0;top:0;height:1px;background:linear-gradient(to right, transparent, var(--dsw-alias-border-l1), transparent)}
.pfgo-set-status{flex:1;text-align:right;font-variant-numeric:tabular-nums}
.pfgo-set-history-item{border-radius:10px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s ease,box-shadow .15s ease}
.pfgo-set-history-item:hover{border-color:var(--dsw-alias-brand-primary);box-shadow:0 2px 10px rgb(0 0 0 / 7%)}
.pfgo-set-history-meta{font-variant-numeric:tabular-nums}
.pfgo-set-stat{display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);font-size:12px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}
`

    function SparkleIcon() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true',
      },
      h('path', {
        d: 'M8 1.5l1.15 3.1a3 3 0 0 0 1.75 1.75L14 7.5l-3.1 1.15a3 3 0 0 0-1.75 1.75L8 13.5l-1.15-3.1a3 3 0 0 0-1.75-1.75L2 7.5l3.1-1.15a3 3 0 0 0 1.75-1.75L8 1.5z',
        fill: 'currentColor',
      }),
      h('circle', { cx: 12.6, cy: 3.4, r: 1.05, fill: 'currentColor', opacity: 0.7 }))
    }

    function errorText(t, error) {
      switch (error.code) {
        case 'empty': return t('error.empty')
        case 'too-long': return t('error.tooLong')
        case 'chips': return t('error.chips')
        case 'busy': return t('error.busy')
        case 'disabled': return t('error.disabled')
        case 'unconfigured': return t('error.unconfigured')
        case 'timeout': return t('error.timeout')
        case 'rate-limit': return t('error.rateLimit')
        case 'concurrency': return t('error.concurrency')
        case 'auth': return t('error.auth')
        case 'quota': return t('error.quota')
        case 'context-window': return t('error.contextWindow')
        case 'aborted': return t('error.aborted')
        case 'upstream': return t('error.upstream')
        default: return t('error.internal')
      }
    }

    function errorHint(t, error) {
      const params = error.params
      if (params === null || params === undefined) return null
      if (typeof params.retryAfterSeconds === 'number' && params.retryAfterSeconds > 0) {
        return t('error.retryAfter').replace('{seconds}', String(Math.ceil(params.retryAfterSeconds)))
      }
      return null
    }

    function effortText(t, effort) {
      switch (effort) {
        case 'off': return t('effort.off')
        case 'high': return t('effort.high')
        case 'max': return t('effort.max')
        default: return t('effort.low')
      }
    }

    function effortForStyle(style) {
      return style === 'brief' ? 'off' : style === 'clarify' ? 'high' : 'low'
    }

    function formatCost(cost) {
      if (cost === null || cost === undefined || typeof cost.amount !== 'number' || !Number.isFinite(cost.amount)) return null
      const symbol = cost.currency === 'CNY' ? '¥' : cost.currency === 'USD' ? '$' : `${cost.currency} `
      const digits = cost.amount > 0 && cost.amount < 0.01 ? 4 : cost.amount < 1 ? 3 : 2
      return `${symbol}${cost.amount.toFixed(digits)}`
    }

    /**
     * Client-side mirror of the host's billing period, used to keep the settings
     * readout working before the host is restarted with the new /config field.
     */
    function billingPeriodNow(pricing) {
      if (pricing === null || pricing === undefined || pricing.peakAware === false) return 'off-peak'
      const shifted = new Date(Date.now() + 8 * 3600 * 1000)
      const dayKey = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
      if (Array.isArray(pricing.holidays) && pricing.holidays.includes(dayKey)) return 'off-peak'
      const weekday = shifted.getUTCDay()
      if (weekday === 0 || weekday === 6) return 'off-peak'
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
      return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60) ? 'peak' : 'off-peak'
    }

    function tokensText(t, usage) {
      if (usage === null || usage === undefined) return null
      return t('panel.tokens')
        .replace('{input}', String(usage.inputTokens ?? 0))
        .replace('{output}', String(usage.outputTokens ?? 0))
    }

    function copyText(text) {
      if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text).then(() => true, () => false)
      }
      return Promise.resolve(false)
    }

    // -----------------------------------------------------------------------
    // Trigger button
    // -----------------------------------------------------------------------
    function EnhanceButton(props) {
      const { t } = props
      const sessionId = props.sessionId
      const inputActions = props.inputActions
      const useInput = typeof props.useInput === 'function' ? props.useInput : () => undefined
      const draft = useInput((state) => (state !== null && state !== undefined && typeof state.draft === 'string' ? state.draft : ''))
      const phase = useInput((state) => (state !== null && state !== undefined ? state.phase : undefined))
      const chipCount = useInput((state) => (state !== null && state !== undefined && Array.isArray(state.occurrences) ? state.occurrences.length : 0))
      const buttonRef = React.useRef(null)
      const draftRef = React.useRef('')
      draftRef.current = typeof draft === 'string' ? draft : ''
      const [menuOpen, setMenuOpen] = React.useState(false)
      useStore()
      React.useEffect(loadConfig, [])

      React.useEffect(() => {
        const element = buttonRef.current
        if (element === null) return undefined
        anchors.set(sessionId, element)
        anchors.set('__current__', element)
        return () => {
          if (anchors.get(sessionId) === element) anchors.delete(sessionId)
          if (anchors.get('__current__') === element) anchors.delete('__current__')
        }
      }, [sessionId])

      const directInfo = directRuns.get(sessionId)
      const directRun = directInfo !== undefined
      const busy = directRun || (panels.get(sessionId) !== undefined && panels.get(sessionId).phase === 'loading')
      const otherBusy = [...panels.values()].some((entry) => entry.phase === 'loading' && entry.sessionId !== sessionId)
      const trimmed = typeof draft === 'string' ? draft.trim() : ''
      const tooLong = charCount(trimmed) > remoteConfig.maxInputChars
      const hasChips = chipCount > 0
      const usable = remoteConfig.enabled && trimmed !== '' && !hasChips && !tooLong && phase === 'plain' && !otherBusy
      const hint = busy ? t('button.busy')
        : !remoteConfig.enabled ? t('error.disabled')
          : otherBusy ? t('error.busy')
            : trimmed === '' ? t('button.hintEmpty')
              : hasChips ? t('button.hintChips')
                : tooLong ? t('button.hintTooLong')
                  : t('button.title')

      /** @param style - explicit style from the context menu, or null for the defaults. */
      const begin = (style) => {
        const previewStyle = style === null ? remoteConfig.defaultStyle : style
        if (busy) return
        if (!remoteConfig.enabled) { openError(sessionId, draft ?? '', previewStyle, 'disabled'); return }
        if (trimmed === '') { openError(sessionId, draft ?? '', previewStyle, 'empty'); return }
        if (hasChips) { openError(sessionId, draft ?? '', previewStyle, 'chips'); return }
        if (tooLong) { openError(sessionId, draft ?? '', previewStyle, 'too-long'); return }
        if (phase !== 'plain') { openError(sessionId, draft ?? '', previewStyle, 'busy'); return }
        if (remoteConfig.directApply === true) {
          const directStyle = style !== null
            ? style
            : typeof remoteConfig.directStyle === 'string' && remoteConfig.directStyle !== ''
              ? remoteConfig.directStyle
              : remoteConfig.defaultStyle
          void startDirect(sessionId, draft, directStyle, inputActions, () => draftRef.current)
          return
        }
        start(sessionId, draft, previewStyle, false, { runContextOff: contextOff })
      }

      const click = () => begin(null)

      const openMenu = (event) => {
        event.preventDefault()
        if (busy || !usable) return
        setMenuOpen(true)
      }

      // Close the style menu on outside press or Escape.
      React.useEffect(() => {
        if (!menuOpen) return undefined
        const close = (event) => {
          if (event.type === 'keydown') {
            if (event.key === 'Escape') setMenuOpen(false)
            return
          }
          const target = event.target
          if (target instanceof Element && target.closest('.pfgo-menu') !== null) return
          setMenuOpen(false)
        }
        document.addEventListener('pointerdown', close, true)
        document.addEventListener('keydown', close, true)
        return () => {
          document.removeEventListener('pointerdown', close, true)
          document.removeEventListener('keydown', close, true)
        }
      }, [menuOpen])

      const stopDirect = () => {
        const info = directRuns.get(sessionId)
        if (info !== undefined && info.controller !== undefined) info.controller.abort()
      }

      // Direct mode has no popover, so it surfaces the one-step undo inline.
      const undoEntry = remoteConfig.directApply === true ? undoFor(sessionId, draft) : undefined
      const undoDirect = () => {
        if (undoEntry === undefined) return
        forgetUndo(sessionId)
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(undoEntry.original)
      }

      return h(React.Fragment, null,
        h('style', null, CSS),
        h('span', { className: 'pfgo-anchor-wrap' },
          h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'pfgo-btn',
          title: hint,
          'aria-label': hint,
          'data-busy': busy ? 'true' : undefined,
          disabled: !usable && !busy,
          onClick: click,
          onContextMenu: openMenu,
        }, h(SparkleIcon)),
        menuOpen
          ? h('div', { className: 'pfgo-menu', role: 'menu', 'aria-label': t('menu.title') },
            h('div', { className: 'pfgo-menu-title', 'aria-hidden': 'true' }, t('menu.title')),
            STYLES.map((style) => h('button', {
              key: style,
              type: 'button',
              role: 'menuitem',
              className: 'pfgo-menu-item',
              onClick: () => {
                setMenuOpen(false)
                begin(style)
              },
            }, t(`style.${style}`))))
          : null,
        directInfo === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'pfgo-direct pfgo-direct--busy pfgo-direct--stop',
            onClick: stopDirect,
            title: t('direct.stop'),
            'aria-label': t('direct.stop'),
            'aria-live': 'polite',
          }, `${t('direct.running').replace('{style}', t(`style.${directInfo.style}`))} · ${t('direct.stop')}`),
        undoEntry === undefined
          ? null
          : h('span', { className: 'pfgo-direct' },
            h('span', { className: 'pfgo-direct-text' }, t('button.applied')),
            h('button', { type: 'button', className: 'pfgo-direct-undo', onClick: undoDirect }, t('button.undo'))),
        toast === null
          ? null
          : h('div', {
            key: 'toast',
            className: 'pfgo-toast',
            role: 'status',
            'aria-live': 'polite',
            title: toast.title,
          }, toast.text)))
    }

    // -----------------------------------------------------------------------
    // Review popover
    // -----------------------------------------------------------------------
    function ForgePanel(props) {
      const { t } = props
      const sessionId = props.sessionId
      const useInput = typeof props.useInput === 'function' ? props.useInput : () => undefined
      const currentDraft = useInput((state) => (state !== null && state !== undefined && typeof state.draft === 'string' ? state.draft : ''))
      const inputPhase = useInput((state) => (state !== null && state !== undefined ? state.phase : undefined))
      const inputActions = props.inputActions
      const [copied, setCopied] = React.useState(false)
      const [box, setBox] = React.useState(null)
      const [draftState, setDraftState] = React.useState({ token: 0, text: '' })
      const draftTextRef = React.useRef('')
      const pendingRef = React.useRef(null)
      const pendingValueRef = React.useRef(null)
      const popRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const wasOpenRef = React.useRef(false)
      const composerDraftRef = React.useRef('')
      React.useEffect(() => {
        composerDraftRef.current = currentDraft
      }, [currentDraft])
      useStore()

      const mine = panels.get(sessionId)
      const open = mine !== undefined
      const currentBox = box !== null ? box : open ? initialBox() : null

      // Editable original per panel generation.
      const token = open ? mine.token : 0
      if (open && draftState.token !== token) {
        setDraftState({ token, text: mine.original })
        draftTextRef.current = mine.original
      }
      const draftText = !open ? '' : draftState.token === token ? draftState.text : mine.original
      React.useEffect(() => {
        draftTextRef.current = draftText
      }, [draftText])

      /** Flush the debounced write-back into the composer. */
      const flushEdit = React.useCallback(() => {
        if (pendingRef.current !== null) {
          clearTimeout(pendingRef.current)
          pendingRef.current = null
        }
        const value = pendingValueRef.current
        if (value === null) return
        pendingValueRef.current = null
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(value)
      }, [inputActions])

      const editDraft = (value) => {
        if (inputPhase !== 'plain') return
        setDraftState({ token, text: value })
        draftTextRef.current = value
        pendingValueRef.current = value
        if (pendingRef.current !== null) clearTimeout(pendingRef.current)
        pendingRef.current = setTimeout(() => {
          pendingRef.current = null
          const pending = pendingValueRef.current
          pendingValueRef.current = null
          if (pending !== null && inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(pending)
        }, EDIT_DEBOUNCE_MS)
      }

      React.useEffect(() => () => {
        if (pendingRef.current !== null) clearTimeout(pendingRef.current)
      }, [])

      // Composer → panel mirror, but never while local edits are unflushed.
      React.useEffect(() => {
        if (!open) return
        if (mine !== undefined && mine.phase === 'applied') return
        if (pendingValueRef.current !== null) return
        if (typeof currentDraft !== 'string' || currentDraft === draftTextRef.current) return
        setDraftState({ token, text: currentDraft })
      }, [currentDraft, open, token])

      React.useLayoutEffect(() => {
        if (!open || box !== null || currentBox === null) return
        setBox(currentBox)
      }, [open, box, currentBox])

      React.useLayoutEffect(() => {
        if (!open) return undefined
        const onResize = () => {
          setBox((previous) => {
            if (previous === null) return previous
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight
            const width = clamp(previous.width, MIN_WIDTH, Math.max(MIN_WIDTH, viewportWidth - EDGE * 2))
            const height = clamp(previous.height, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - EDGE * 2))
            const left = clamp(previous.left, EDGE, Math.max(EDGE, viewportWidth - width - EDGE))
            const top = clamp(previous.top, EDGE, Math.max(EDGE, viewportHeight - height - EDGE))
            if (width === previous.width && height === previous.height && left === previous.left && top === previous.top) return previous
            return { ...previous, width, height, left, top }
          })
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [open])

      React.useEffect(() => {
        if (!open) return undefined
        const onKeyDown = (event) => {
          if (event.isComposing === true || event.defaultPrevented === true) return
          if (event.key === 'Escape') {
            event.preventDefault()
            closePanel(sessionId)
          }
        }
        const onPointerDown = (event) => {
          if (pinned) return
          const target = event.target
          if (!(target instanceof Node)) return
          if (popRef.current !== null && popRef.current.contains(target)) return
          const anchor = anchors.get(sessionId)
          if (anchor !== undefined && anchor.contains(target)) return
          closePanel(sessionId)
        }
        document.addEventListener('keydown', onKeyDown)
        document.addEventListener('pointerdown', onPointerDown, true)
        return () => {
          document.removeEventListener('keydown', onKeyDown)
          document.removeEventListener('pointerdown', onPointerDown, true)
        }
      }, [open, sessionId])

      // Move focus into the popover when it opens, and back to the trigger
      // when it closes, so keyboard users are never stranded.
      React.useEffect(() => {
        if (open && !wasOpenRef.current) {
          const node = popRef.current
          if (node !== null) node.focus({ preventScroll: true })
        } else if (!open && wasOpenRef.current) {
          const anchor = anchors.get(sessionId)
          if (anchor !== undefined) anchor.focus({ preventScroll: true })
        }
        wasOpenRef.current = open
      }, [open, sessionId])
      React.useEffect(() => {
        const onShortcut = (event) => {
          if (event.isComposing === true) return
          if (!(event.ctrlKey && event.altKey)) return
          if (event.key !== 'e' && event.key !== 'E') return
          if (event.target instanceof Element && event.target.closest('.pfgo-pop') !== null) return
          event.preventDefault()
          if (panels.get(sessionId) !== undefined) {
            closePanel(sessionId)
            return
          }
          if (!remoteConfig.enabled) return
          const text = draftTextRef.current
          if (typeof text !== 'string' || text.trim() === '' || text.trimStart().startsWith('/')) return
          if (chipCount > 0) return
          if (charCount(text.trim()) > remoteConfig.maxInputChars) return
          if (inputPhase !== 'plain') return
          if (remoteConfig.directApply === true && remoteConfig.shortcutOpensPreview === false) {
            const directStyle = typeof remoteConfig.directStyle === 'string' && remoteConfig.directStyle !== ''
              ? remoteConfig.directStyle
              : remoteConfig.defaultStyle
            void startDirect(sessionId, text, directStyle, inputActions, () => draftTextRef.current)
            return
          }
          start(sessionId, text, remoteConfig.defaultStyle, false, { runContextOff: contextOff })
        }
        document.addEventListener('keydown', onShortcut, true)
        return () => document.removeEventListener('keydown', onShortcut, true)
      }, [sessionId, inputPhase])

      const persistBox = React.useCallback((current) => {
        if (current === null || current === undefined) return
        const next = { width: Math.round(current.width), height: Math.round(current.height) }
        if (current.mode === 'manual') {
          next.x = Math.round(current.left)
          next.y = Math.round(current.top)
        }
        writeSavedLayout(next)
      }, [])

      const startDrag = (event) => {
        if (event.button !== 0 || currentBox === null) return
        const target = event.target
        if (target instanceof Element && target.closest('button') !== null) return
        event.preventDefault()
        const origin = { x: event.clientX, y: event.clientY, left: currentBox.left, top: currentBox.top, width: currentBox.width, height: currentBox.height }
        const movedBox = (moveEvent) => {
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const left = clamp(origin.left + moveEvent.clientX - origin.x, EDGE, Math.max(EDGE, viewportWidth - origin.width - EDGE))
          const top = clamp(origin.top + moveEvent.clientY - origin.y, EDGE, Math.max(EDGE, viewportHeight - origin.height - EDGE))
          return { mode: 'manual', width: origin.width, height: origin.height, left, top }
        }
        dragRef.current = 'move'
        const onMove = (moveEvent) => { setBox(movedBox(moveEvent)) }
        const onUp = (upEvent) => {
          dragRef.current = null
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          const settled = movedBox(upEvent)
          setBox(settled)
          persistBox(settled)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      const startResize = (event) => {
        if (event.button !== 0 || currentBox === null) return
        event.preventDefault()
        event.stopPropagation()
        const origin = {
          x: event.clientX, y: event.clientY,
          width: currentBox.width, height: currentBox.height,
          left: currentBox.left, top: currentBox.top,
          mode: currentBox.mode,
        }
        const resizedBox = (moveEvent) => {
          const viewportWidth = window.innerWidth
          const viewportHeight = window.innerHeight
          const width = clamp(origin.width + moveEvent.clientX - origin.x, MIN_WIDTH, Math.max(MIN_WIDTH, viewportWidth - origin.left - EDGE))
          const height = clamp(origin.height + moveEvent.clientY - origin.y, MIN_HEIGHT, Math.max(MIN_HEIGHT, viewportHeight - origin.top - EDGE))
          return { ...origin, width, height }
        }
        dragRef.current = 'resize'
        const onMove = (moveEvent) => { setBox(resizedBox(moveEvent)) }
        const onUp = (upEvent) => {
          dragRef.current = null
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.removeEventListener('pointercancel', onUp)
          const settled = resizedBox(upEvent)
          setBox(settled)
          persistBox(settled)
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        document.addEventListener('pointercancel', onUp)
      }

      const resetBox = () => {
        const next = autoBox(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        setBox(next)
        writeSavedLayout({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT })
      }

      if (mine === undefined) return null

      const copy = () => {
        const text = mine.phase === 'result' && mine.result !== undefined ? mine.result.text : draftText
        copyText(text).then((ok) => {
          if (!ok) return
          setCopied(true)
          later(() => setCopied(false), 1500)
        })
      }

      const runAgain = (style) => {
        flushEdit()
        start(sessionId, draftText, style ?? mine.style, true, { runContextOff: contextOff })
      }

      const applyResult = () => {
        if (mine.phase !== 'result' || mine.result === undefined) return
        flushEdit()
        rememberUndo(sessionId, draftText, mine.result.text)
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(mine.result.text)
        putPanel(sessionId, { ...mine, phase: 'applied' })
        bump()
      }

      /** Adopt the comparison candidate; aborts the primary request if needed. */
      const applyCandidate = (candidate) => {
        if (candidate === undefined || candidate === null || typeof candidate.text !== 'string') return
        flushEdit()
        if (mine.phase === 'loading' && typeof mine.abort === 'function') mine.abort()
        rememberUndo(sessionId, draftText, candidate.text)
        if (inputActions !== undefined && typeof inputActions.setDraft === 'function') inputActions.setDraft(candidate.text)
        putPanel(sessionId, { ...mine, phase: 'applied', result: candidate, resultSource: draftText, abort: undefined, streaming: undefined })
        bump()
      }

      const copyCandidate = (text) => {
        try { void navigator.clipboard.writeText(text) } catch { /* clipboard unavailable */ }
      }

      const applyAndSend = () => {
        if (mine.phase !== 'result' || mine.result === undefined) return
        if (inputPhase !== 'plain') return
        flushEdit()
        if (inputActions === undefined) return
        const target = mine.result.text
        if (typeof inputActions.setDraft === 'function') inputActions.setDraft(target)
        closePanel(sessionId)
        // Wait for the composer to reflect the replacement before submitting:
        // an immediate submit could send the pre-replacement draft.
        const startedAt = Date.now()
        const attempt = () => {
          if (composerDraftRef.current === target) {
            if (typeof inputActions.submit === 'function') inputActions.submit()
            return
          }
          if (Date.now() - startedAt > 600) return // draft stays replaced; the user can send manually
          later(attempt, 24)
        }
        later(attempt, 0)
      }

      const undo = () => {
        const entry = undoMap().get(sessionId)
        forgetUndo(sessionId)
        if (entry !== undefined && inputActions !== undefined && typeof inputActions.setDraft === 'function') {
          inputActions.setDraft(entry.original)
        }
        closePanel(sessionId)
      }

      const undoEntry = undoFor(sessionId, currentDraft)
      const resultSource = typeof mine.resultSource === 'string' ? mine.resultSource : mine.original
      const stale = mine.phase === 'result' && draftText !== resultSource
      const originalCount = t('panel.chars').replace('{count}', String(charCount(draftText)))

      const header = h('div', {
        className: 'pfgo-head',
        title: t('panel.dragHint'),
        onPointerDown: startDrag,
        onDoubleClick: resetBox,
      },
      h('span', { className: 'pfgo-title' }, t('panel.title')),
      STYLES.map((style) => h('button', {
        key: style,
        type: 'button',
        className: 'pfgo-chip',
        'data-active': mine.style === style ? 'true' : undefined,
        disabled: mine.phase === 'loading',
        onClick: () => {
          if (mine.phase === 'loading') return
          flushEdit()
          start(sessionId, draftText, style, false, { runContextOff: contextOff })
        },
      }, t(`style.${style}`))),
      remoteConfig.contextAware
        ? h('button', {
          key: 'context',
          type: 'button',
          className: 'pfgo-switch',
          role: 'switch',
          'aria-checked': contextOff ? 'false' : 'true',
          'aria-label': t('panel.context'),
          title: contextOff ? t('panel.contextOff') : t('panel.contextOn'),
          disabled: mine.phase === 'loading',
          onClick: () => {
            contextOff = !contextOff
            try { localStorage.setItem(CONTEXT_KEY, contextOff ? '1' : '0') } catch { /* storage unavailable */ }
            bump()
          },
        },
        h('span', { className: 'pfgo-switch-text' }, t('panel.context')),
        h('span', { className: 'pfgo-switch-track', 'data-on': contextOff ? undefined : 'true' },
          h('span', { className: 'pfgo-switch-knob' })))
        : null,
      h('button', {
        key: 'pin',
        type: 'button',
        className: 'pfgo-chip',
        'data-active': pinned ? 'true' : undefined,
        title: pinned ? t('panel.unpin') : t('panel.pin'),
        onClick: () => {
          pinned = !pinned
          bump()
        },
      }, t('panel.pin')),
      h('span', { className: 'pfgo-spacer' }),
      h('button', {
        type: 'button',
        className: 'pfgo-close',
        title: t('panel.close'),
        'aria-label': t('panel.close'),
        onClick: () => closePanel(sessionId),
      }, '×'))

      const body = []
      if (mine.phase !== 'applied') {
        body.push(h('section', { key: 'original', className: 'pfgo-section' },
          h('div', { className: 'pfgo-shead' },
            h('span', { className: 'pfgo-tag pfgo-tag--muted' }, t('panel.original')),
            h('span', { className: 'pfgo-smeta' }, originalCount)),
          h('textarea', {
            className: 'pfgo-original',
            value: draftText,
            rows: 2,
            spellCheck: false,
            readOnly: inputPhase !== 'plain',
            'aria-label': t('panel.original'),
            title: inputPhase === 'plain' ? t('panel.editable') : t('panel.locked'),
            onChange: (event) => editDraft(event.target.value),
            onBlur: flushEdit,
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                flushEdit()
                closePanel(sessionId)
              }
            },
          }),
          inputPhase !== 'plain' ? h('div', { className: 'pfgo-hint' }, t('panel.locked')) : null))
        body.push(h('div', { key: 'arrow', className: 'pfgo-arrow', 'aria-hidden': 'true' }, '↓'))
      }

      if (mine.phase === 'loading') {
        const streamed = typeof mine.streaming === 'string' ? mine.streaming : ''
        body.push(h('section', { key: 'loading', className: 'pfgo-section', 'aria-live': 'polite' },
          h('div', { className: 'pfgo-shead' },
            h('span', { className: 'pfgo-tag pfgo-tag--brand' }, t('panel.result')),
            h('span', { className: 'pfgo-smeta' },
              h('span', null, effortText(t, effortForStyle(mine.style))),
              streamed === '' ? null : h('span', null, t('panel.streaming')))),
          streamed === ''
            ? h('div', { className: 'pfgo-loading' }, h('span', { className: 'pfgo-spinner' }), t('panel.loading'))
            : h('div', { className: 'pfgo-improved' }, streamed)))
      }

      if (mine.phase === 'result' && mine.result !== undefined) {
        const metaParts = []
        if (typeof mine.result.model === 'string' && mine.result.model !== '') {
          metaParts.push(h('span', {
            key: 'model',
            className: 'pfgo-badge',
            title: `${mine.result.provider ?? ''}/${mine.result.model}`,
          }, mine.result.model))
        }
        if (mine.cached === true) metaParts.push(h('span', { key: 'cached', className: 'pfgo-badge' }, t('panel.cached')))
        if (mine.result.context !== undefined && mine.result.context.used === true) {
          metaParts.push(h('span', { key: 'context', className: 'pfgo-badge' },
            t('panel.contextUsed').replace('{turns}', String(mine.result.context.turns))))
        }
        metaParts.push(h('span', { key: 'effort' }, effortText(t, mine.result.reasoningEffort ?? effortForStyle(mine.style))))
        metaParts.push(h('span', { key: 'time' }, t('panel.seconds').replace('{value}', String(Math.max(1, Math.round((mine.result.elapsedMs ?? 0) / 100) / 10)))))
        body.push(h('section', { key: 'result', className: 'pfgo-section', 'aria-live': 'polite' },
          h('div', { className: 'pfgo-shead' },
            h('span', { className: 'pfgo-tag pfgo-tag--brand' }, t('panel.result')),
            h('span', { className: 'pfgo-smeta' }, metaParts)),
          h('div', { className: 'pfgo-improved' }, mine.result.text)))
        if (stale) body.push(h('div', { key: 'stale', className: 'pfgo-hint' }, t('panel.stale')))
      }

      if (mine.compare !== undefined) {
        const compare = mine.compare
        const compareMeta = []
        if (compare.phase === 'result' && compare.result !== undefined) {
          if (compare.cached === true) compareMeta.push(h('span', { key: 'cached', className: 'pfgo-badge' }, t('panel.cached')))
          if (typeof compare.result.model === 'string' && compare.result.model !== '') {
            compareMeta.push(h('span', { key: 'model', className: 'pfgo-badge', title: `${compare.result.provider ?? ''}/${compare.result.model}` }, compare.result.model))
          }
          compareMeta.push(h('span', { key: 'time' }, t('panel.seconds').replace('{value}', String(Math.max(1, Math.round((compare.result.elapsedMs ?? 0) / 100) / 10)))))
        }
        body.push(h('section', { key: 'compare', className: 'pfgo-section' },
          h('div', { className: 'pfgo-shead' },
            h('span', { className: 'pfgo-tag' }, `${t('panel.compare')} · ${t(`style.${compare.style}`)}`),
            h('span', { className: 'pfgo-smeta' }, compareMeta)),
          compare.phase === 'loading' ? h('div', { className: 'pfgo-hint' }, t('panel.loading')) : null,
          compare.phase === 'error' ? h('div', { className: 'pfgo-error' }, errorText(t, compare.error)) : null,
          compare.phase === 'result' && compare.result !== undefined
            ? h('div', { className: 'pfgo-improved' }, compare.result.text)
            : null,
          compare.phase === 'result' && compare.result !== undefined
            ? h('div', { className: 'pfgo-cmp-actions' },
              h('button', { type: 'button', className: 'pfgo-ghost pfgo-ghost--sm', onClick: () => applyCandidate(compare.result) }, t('panel.useThis')),
              h('button', { type: 'button', className: 'pfgo-ghost pfgo-ghost--sm', onClick: () => copyCandidate(compare.result.text) }, t('panel.copy')))
            : null))
      }

      if (mine.phase === 'applied') {
        body.push(h('section', { key: 'applied', className: 'pfgo-section' },
          h('div', { className: 'pfgo-applied' },
            h('span', { 'aria-hidden': 'true' }, '✓'),
            h('span', null, t('panel.applied')))))
      }

      if (mine.phase === 'error') {
        const error = mine.error ?? { code: 'internal' }
        const hint = errorHint(t, error)
        body.push(h('section', { key: 'error', className: 'pfgo-section', role: 'alert' },
          h('div', { className: 'pfgo-error' },
            h('div', { className: 'pfgo-error-title' }, errorText(t, error)),
            hint === null ? null : h('div', { className: 'pfgo-error-detail' }, hint),
            error.message !== undefined
              ? h('details', { className: 'pfgo-error-detail' },
                h('summary', null, t('error.details')),
                h('div', { className: 'pfgo-error-detail-body' }, error.message))
              : null)))
      }

      const actions = []
      const meta = []
      if (mine.phase === 'result') {
        actions.push(h('button', { key: 'apply', type: 'button', className: 'pfgo-primary', onClick: applyResult }, t('panel.apply')))
        actions.push(h('button', {
          key: 'send',
          type: 'button',
          className: 'pfgo-ghost',
          disabled: inputPhase !== 'plain',
          onClick: applyAndSend,
        }, t('panel.applySend')))
        actions.push(h('button', { key: 'copy', type: 'button', className: 'pfgo-ghost', onClick: copy }, copied ? t('panel.copied') : t('panel.copy')))
        actions.push(h('button', { key: 'retry', type: 'button', className: 'pfgo-ghost', onClick: () => runAgain() }, t('panel.retry')))
        actions.push(h('button', { key: 'cancel', type: 'button', className: 'pfgo-ghost', onClick: () => closePanel(sessionId) }, t('panel.close')))
        if (mine.result !== undefined) {
          meta.push(t('panel.length')
            .replace('{before}', String(charCount(resultSource)))
            .replace('{after}', String(charCount(mine.result.text))))
          if (tokensText(t, mine.result.usage) !== null) meta.push(tokensText(t, mine.result.usage))
          if (formatCost(mine.result.cost) !== null) meta.push(t('panel.cost').replace('{amount}', formatCost(mine.result.cost)))
        }
      } else if (mine.phase === 'loading') {
        actions.push(h('button', { key: 'cancel', type: 'button', className: 'pfgo-ghost', onClick: () => closePanel(sessionId) }, t('panel.cancel')))
        meta.push(effortText(t, effortForStyle(mine.style)))
      } else if (mine.phase === 'applied') {
        actions.push(h('button', { key: 'undo', type: 'button', className: 'pfgo-ghost', onClick: undo }, t('panel.undo')))
        actions.push(h('button', { key: 'close', type: 'button', className: 'pfgo-ghost', onClick: () => closePanel(sessionId) }, t('panel.close')))
      } else {
        actions.push(h('button', { key: 'retry', type: 'button', className: 'pfgo-primary', onClick: () => runAgain() }, t('panel.retry')))
        if (undoEntry !== undefined) actions.push(h('button', { key: 'undoLast', type: 'button', className: 'pfgo-ghost', onClick: undo }, t('panel.undoLast')))
        actions.push(h('button', { key: 'close', type: 'button', className: 'pfgo-ghost', onClick: () => closePanel(sessionId) }, t('panel.close')))
      }

      const footer = [h('div', { key: 'actions', className: 'pfgo-actions' }, actions)]
      if (meta.length > 0) {
        const resultCost = mine.result === undefined ? undefined : mine.result.cost
        const costTitle = resultCost === undefined || resultCost === null
          ? t('panel.costEstimate')
          : `${t('panel.costEstimate')} · ${resultCost.period === 'peak' ? t('panel.ratePeak') : t('panel.rateOffPeak')}`
        footer.push(h('span', { key: 'meta', className: 'pfgo-meta', title: costTitle }, meta.join(' · ')))
      }

      const style = currentBox === null
        ? { left: 16, top: 80, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
        : { left: currentBox.left, top: currentBox.top, width: currentBox.width, height: currentBox.height }

      const card = h('div', {
        ref: popRef,
        className: 'pfgo-pop',
        role: 'dialog',
        tabIndex: -1,
        'aria-label': t('panel.title'),
        style,
      },
      h('style', null, CSS),
      header,
      h('div', { className: 'pfgo-body' }, body),
      h('div', { className: 'pfgo-foot' }, footer),
      h('div', {
        className: 'pfgo-grip',
        title: t('panel.dragHint'),
        onPointerDown: startResize,
      }))

      return card
    }

    // -----------------------------------------------------------------------
    // Settings page (Settings → Prompt Forge)
    // -----------------------------------------------------------------------
    function SettingsRow(props) {
      return h('div', { className: 'pfgo-set-row' },
        h('div', { className: 'pfgo-set-label' },
          h('span', null, props.label),
          props.hint === undefined
            ? null
            : h('span', { className: 'pfgo-set-hint', 'data-tone': props.hintTone }, props.hint)),
        h('div', { className: 'pfgo-set-control' }, props.control))
    }

    function SettingsSwitch(props) {
      return h('button', {
        type: 'button',
        className: 'pfgo-switch',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: () => props.onChange(!props.checked),
      },
      h('span', { className: 'pfgo-switch-track', 'data-on': props.checked ? 'true' : undefined },
        h('span', { className: 'pfgo-switch-knob' })))
    }

    function SettingsSelect(props) {
      return h('select', {
        className: 'pfgo-set-input',
        value: props.value,
        'aria-label': props.label,
        onChange: (event) => props.onChange(event.target.value),
      }, props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)))
    }

    function SettingsNumber(props) {
      return h('input', {
        className: 'pfgo-set-input pfgo-set-input--num',
        type: 'number',
        value: String(props.value),
        min: props.min,
        max: props.max,
        step: props.step,
        'aria-label': props.label,
        onChange: (event) => {
          const parsed = Number(event.target.value)
          props.onChange(Number.isFinite(parsed) ? parsed : props.value)
        },
      })
    }

    function SettingsText(props) {
      return h('input', {
        className: 'pfgo-set-input pfgo-set-input--wide',
        type: 'text',
        value: props.value,
        placeholder: props.placeholder,
        'aria-label': props.label,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    function SettingsTextArea(props) {
      return h('textarea', {
        className: 'pfgo-set-textarea',
        value: props.value,
        rows: props.rows === undefined ? 6 : props.rows,
        maxLength: 8000,
        placeholder: props.placeholder,
        'aria-label': props.label,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    // -----------------------------------------------------------------------
    // Settings field table: labels, ranges and compare keys live here only.
    // -----------------------------------------------------------------------
    const CONFIG_FIELDS = [
      { key: 'enabled', group: 'basic', kind: 'switch', label: 'settings.enabled', default: true },
      { key: 'defaultStyle', group: 'basic', kind: 'select', label: 'settings.defaultStyle', options: 'styles' },
      { key: 'directStyle', group: 'basic', kind: 'select', label: 'settings.directStyle', options: 'stylesWithEmpty', emptyLabel: 'settings.directStyleDefault' },
      { key: 'compareStyle', group: 'basic', kind: 'select', label: 'settings.compareStyle', hint: 'settings.compareStyleHint', options: 'stylesWithEmpty', emptyLabel: 'settings.compareStyleOff' },
      { key: 'streaming', group: 'basic', kind: 'switch', label: 'settings.streaming', default: true },
      { key: 'directApply', group: 'basic', kind: 'switch', label: 'settings.directApply', hint: 'settings.directApplyHint', default: false },
      { key: 'toastDurationMs', group: 'basic', kind: 'number', label: 'settings.toastDurationMs', min: 800, max: 10000, step: 100, default: 2600 },
      { key: 'shortcutOpensPreview', group: 'basic', kind: 'switch', label: 'settings.shortcutOpensPreview', hint: 'settings.shortcutOpensPreviewHint', default: true },
      { key: 'provider', group: 'model', kind: 'text', label: 'settings.provider', placeholder: 'settings.follow' },
      { key: 'model', group: 'model', kind: 'text', label: 'settings.modelName', hint: 'settings.modelHint', placeholder: 'settings.follow' },
      { key: 'contextAware', group: 'context', kind: 'switch', label: 'settings.context', default: false },
      { key: 'contextMaxMessages', group: 'context', kind: 'number', label: 'settings.contextMessages', min: 0, max: 50, step: 1, default: 8 },
      { key: 'contextMaxChars', group: 'context', kind: 'number', label: 'settings.contextChars', min: 0, max: 100000, step: 100, default: 4000 },
      { key: 'temperature', group: 'limits', kind: 'number', label: 'settings.temperature', min: 0, max: 1, step: 0.1, default: 0.3 },
      { key: 'maxOutputTokens', group: 'limits', kind: 'number', label: 'settings.maxOutputTokens', min: 128, max: 32768, step: 128, default: 2048 },
      { key: 'maxInputChars', group: 'limits', kind: 'number', label: 'settings.maxInputChars', min: 100, max: 200000, step: 100, default: 12000 },
      { key: 'timeoutMs', group: 'limits', kind: 'number', label: 'settings.timeoutMs', min: 5000, max: 600000, step: 1000, default: 60000 },
      { key: 'maxConcurrent', group: 'limits', kind: 'number', label: 'settings.maxConcurrent', min: 1, max: 16, step: 1, default: 2 },
      { key: 'rateLimitPerMinute', group: 'limits', kind: 'number', label: 'settings.rateLimit', min: 1, max: 600, step: 1, default: 10 },
      { key: 'pricing.currency', group: 'pricing', kind: 'text', label: 'settings.currency', placeholder: 'settings.currencyPlaceholder' },
      { key: 'pricing.inputPerMTok', group: 'pricing', kind: 'number', label: 'settings.inputPerMTok', min: 0, max: 10000, step: 0.01, default: 1 },
      { key: 'pricing.outputPerMTok', group: 'pricing', kind: 'number', label: 'settings.outputPerMTok', hint: 'settings.pricingHint', min: 0, max: 10000, step: 0.01, default: 4 },
      { key: 'pricing.cachedInputPerMTok', group: 'pricing', kind: 'number', label: 'settings.cachedInputPerMTok', min: 0, max: 10000, step: 0.01, default: 0.02 },
    ]
    const NUMERIC_FIELDS = CONFIG_FIELDS.filter((field) => field.kind === 'number')
    const SETTINGS_COMPARE_KEYS = [
      ...CONFIG_FIELDS.map((field) => field.key),
      'systemPrompt',
      'promptMode',
      'reasoningEffort',
    ]

    /** Read a dotted path from a plain config object. */
    function readPath(object, path) {
      return path.split('.').reduce((current, key) => (current === null || current === undefined ? undefined : current[key]), object)
    }

    function PromptForgeSettings(props) {
      const t = typeof props.t === 'function' ? props.t : translate
      const [config, setConfig] = React.useState(null)
      const [status, setStatus] = React.useState('')
      const [failed, setFailed] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [loading, setLoading] = React.useState(true)
      // Collapsed-by-default groups keep the long form scannable.
      const [openSections, setOpenSections] = React.useState({ prompt: false, effort: false, limits: false, pricing: false, history: false })
      const [spendInfo, setSpendInfo] = React.useState(() => spendSummary())
      const [history, setHistory] = React.useState(() => readHistory())
      const [expanded, setExpanded] = React.useState({})
      const [copiedKey, setCopiedKey] = React.useState('')
      const [liveInfo, setLiveInfo] = React.useState(null)
      const [liveTick, setLiveTick] = React.useState(0)

      // Async callbacks may outlive the panel; ignore their results then.
      const aliveRef = React.useRef(true)
      React.useEffect(() => () => { aliveRef.current = false }, [])

      const load = React.useCallback(() => {
        setLoading(true)
        setFailed(false)
        setStatus('')
        fetch(`${ENDPOINT}/settings`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            let payload
            try { payload = await response.json() } catch { payload = undefined }
            if (!response.ok || payload === undefined || payload === null || payload.ok !== true) {
              const reason = payload !== undefined && payload !== null && payload.error !== undefined ? payload.error.message : `HTTP ${response.status}`
              const error = new Error(typeof reason === 'string' ? reason : `HTTP ${response.status}`)
              error.unavailable = response.status === 503 || response.status === 409
              throw error
            }
            if (!aliveRef.current) return
            setConfig(payload.value.config)
            setLiveTick((current) => current + 1)
          })
          .catch((error) => {
            if (!aliveRef.current) return
            setFailed(true)
            setStatus(error.unavailable === true ? t('settings.unavailable') : `${t('settings.loadFailed')}: ${error.message}`)
          })
          .finally(() => {
            if (aliveRef.current) setLoading(false)
          })
      }, [t])
      React.useEffect(load, [load])

      // Read the resolved default route and the current billing period; this is
      // a read-only diagnostic row, refreshed after every settings load/save.
      React.useEffect(() => {
        let cancelled = false
        const readJson = (url) => fetch(url, { headers: { accept: 'application/json' } }).then((response) => response.json())
        Promise.all([readJson(`${ENDPOINT}/route`), readJson(`${ENDPOINT}/config`)])
          .then(([routePayload, configPayload]) => {
            if (cancelled || !aliveRef.current) return
            const route = routePayload !== null && routePayload !== undefined && routePayload.ok === true ? routePayload.value : {}
            const live = configPayload !== null && configPayload !== undefined && configPayload.ok === true ? configPayload.value : {}
            setLiveInfo({
              provider: typeof route.provider === 'string' ? route.provider : '',
              model: typeof route.model === 'string' ? route.model : '',
              period: typeof live.pricingPeriod === 'string' ? live.pricingPeriod : '',
            })
          })
          .catch(() => {
            // The readout is optional; the form keeps working without it.
          })
        return () => { cancelled = true }
      }, [liveTick])

      const patch = (next) => setConfig((previous) => (previous === null ? previous : { ...previous, ...next }))
      const patchEffort = (style, value) => setConfig((previous) => {
        if (previous === null) return previous
        return { ...previous, reasoningByStyle: { ...(previous.reasoningByStyle ?? {}), [style]: value } }
      })

      // Ranges and compare keys come from CONFIG_FIELDS, so the form, its
      // validation and the "did it apply" check cannot drift apart.
      const validateSettings = (candidate) => {
        for (const field of NUMERIC_FIELDS) {
          const value = readPath(candidate, field.key)
          if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) {
            return `${t('settings.invalid')}: ${t(field.label)} (${field.min}–${field.max})`
          }
        }
        const provider = typeof candidate.provider === 'string' ? candidate.provider.trim() : ''
        const model = typeof candidate.model === 'string' ? candidate.model.trim() : ''
        if ((provider === '') !== (model === '')) return t('settings.modelPairRequired')
        return null
      }
      const sameSettings = (a, b) => SETTINGS_COMPARE_KEYS.every((key) => stableStringify(a?.[key]) === stableStringify(b?.[key]))
        && stableStringify(a?.reasoningByStyle) === stableStringify(b?.reasoningByStyle)
        && stableStringify(a?.pricing) === stableStringify(b?.pricing)

      /** Poll until the host reports the saved values, so "saved" means applied. */
      const confirmApplied = async (target) => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          await new Promise((resolve) => { setTimeout(resolve, 300) })
          if (!aliveRef.current) return
          try {
            const response = await fetch(`${ENDPOINT}/settings`, { headers: { accept: 'application/json' } })
            const payload = await response.json()
            if (payload !== null && payload.ok === true && payload.value !== undefined) {
              if (target === null || sameSettings(payload.value.config, target)) {
                setStatus(t('settings.applied'))
                setConfig(payload.value.config)
                try { localStorage.removeItem(SETTINGS_SAVED_KEY) } catch { /* storage unavailable */ }
                return
              }
            }
          } catch {
            // Keep polling: the plugin may be reloading.
          }
        }
        if (!aliveRef.current) return
        setStatus(t('settings.savedPending'))
        later(load, 1200)
      }

      // A reload remounts this component; the marker keeps the outcome visible.
      React.useEffect(() => {
        try {
          const raw = localStorage.getItem(SETTINGS_SAVED_KEY)
          if (raw === null) return
          localStorage.removeItem(SETTINGS_SAVED_KEY)
          const at = Number(raw)
          if (Number.isFinite(at) && Date.now() - at < 20000) setStatus(t('settings.applied'))
        } catch {
          // Storage unavailable: nothing to restore.
        }
      }, [t])

      const snippet = (value, max) => {
        const flat = String(value ?? '').replace(/\s+/g, ' ').trim()
        return flat.length > max ? `${flat.slice(0, max)}…` : flat
      }
      const copyHistory = (text, key) => {
        void copyText(text)
        setCopiedKey(key)
        later(() => setCopiedKey((current) => (current === key ? '' : current)), 1400)
      }
      const removeHistory = (key) => {
        cacheStore().delete(key)
        persistCache()
        setHistory(readHistory())
      }
      const clearHistory = () => {
        cacheStore().clear()
        persistCache()
        setHistory(readHistory())
      }

      const save = async (reset) => {
        if (busy || config === null) return
        if (reset !== true) {
          const invalid = validateSettings(config)
          if (invalid !== null) {
            setFailed(true)
            setStatus(invalid)
            return
          }
        }
        setBusy(true)
        setStatus('')
        setFailed(false)
        try {
          const response = await fetch(`${ENDPOINT}/settings`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(reset ? { reset: true } : { config }),
          })
          let payload
          try { payload = await response.json() } catch { payload = undefined }
          if (!response.ok || payload === undefined || payload === null || payload.ok !== true) {
            const reason = payload !== undefined && payload !== null && payload.error !== undefined ? payload.error.message : `HTTP ${response.status}`
            throw new Error(typeof reason === 'string' ? reason : `HTTP ${response.status}`)
          }
          setStatus(t('settings.saved'))
          try { localStorage.setItem(SETTINGS_SAVED_KEY, String(Date.now())) } catch { /* storage unavailable */ }
          await confirmApplied(reset === true ? null : config)
        } catch (error) {
          if (!aliveRef.current) return
          setFailed(true)
          setStatus(`${t('settings.failed')}: ${error.message}`)
        } finally {
          if (aliveRef.current) setBusy(false)
        }
      }

      const routeText = liveInfo === null || liveInfo.provider === '' || liveInfo.model === ''
        ? t('settings.routeUnset')
        : `${liveInfo.provider}/${liveInfo.model}`
      const periodText = liveInfo !== null && liveInfo.period !== ''
        ? liveInfo.period === 'peak' ? t('panel.ratePeak') : t('panel.rateOffPeak')
        : config !== null && config.pricing !== undefined
          ? billingPeriodNow(config.pricing) === 'peak' ? t('panel.ratePeak') : t('panel.rateOffPeak')
          : '—'

      const header = h(React.Fragment, null,
        h('style', null, CSS),
        h('h3', { className: 'pfgo-set-title' }, t('settings.label')),
        h('p', { className: 'pfgo-set-intro' }, t('settings.intro')),
        h('div', { className: 'pfgo-set-info' },
          h('span', { className: 'pfgo-set-info-item' },
            h('span', { className: 'pfgo-set-info-label' }, t('settings.currentRoute')),
            h('span', { className: 'pfgo-set-info-value' }, routeText)),
          h('span', { className: 'pfgo-set-info-item' },
            h('span', { className: 'pfgo-set-info-label' }, t('settings.billingPeriod')),
            h('span', { className: 'pfgo-set-info-value' }, periodText))))

      if (loading && config === null) {
        return h('div', { className: 'pfgo-set' }, header, h('div', { className: 'pfgo-set-msg' }, t('settings.loading')))
      }
      if (config === null) {
        return h('div', { className: 'pfgo-set' }, header,
          h('div', { className: 'pfgo-set-msg', 'data-tone': failed ? 'error' : undefined }, status),
          h('div', { className: 'pfgo-set-actions' },
            h('button', { type: 'button', className: 'pfgo-primary', onClick: load }, t('settings.loadFailed'))))
      }

      const styleOptions = STYLES.map((style) => ({ value: style, label: t(`style.${style}`) }))
      const effortOptions = [
        { value: '', label: t('settings.follow') },
        { value: 'off', label: t('effort.off') },
        { value: 'low', label: t('effort.low') },
        { value: 'high', label: t('effort.high') },
        { value: 'max', label: t('effort.max') },
      ]

      const patchField = (path, value) => setConfig((previous) => {
        if (previous === null) return previous
        const dot = path.indexOf('.')
        if (dot < 0) return { ...previous, [path]: value }
        const head = path.slice(0, dot)
        const tail = path.slice(dot + 1)
        return { ...previous, [head]: { ...(previous[head] ?? {}), [tail]: value } }
      })

      const renderField = (field) => {
        const label = t(field.label)
        const providerValue = typeof config.provider === 'string' ? config.provider.trim() : ''
        const modelValue = typeof config.model === 'string' ? config.model.trim() : ''
        const pairMismatch = (providerValue === '') !== (modelValue === '')
        const pairField = field.key === 'provider' || field.key === 'model'
        const hintKey = pairMismatch && pairField ? 'settings.modelPairRequired' : field.hint
        const hint = hintKey === undefined ? undefined : t(hintKey)
        const hintTone = pairMismatch && pairField ? 'error' : undefined
        const value = readPath(config, field.key)
        let control
        if (field.kind === 'switch') {
          control = h(SettingsSwitch, {
            label,
            checked: field.default === true ? value !== false : value === true,
            onChange: (next) => patchField(field.key, next),
          })
        } else if (field.kind === 'select') {
          const options = field.options === 'styles'
            ? styleOptions
            : [{ value: '', label: t(field.emptyLabel) }, ...styleOptions]
          control = h(SettingsSelect, {
            label,
            value: typeof value === 'string' ? value : '',
            options,
            onChange: (next) => patchField(field.key, next),
          })
        } else if (field.kind === 'number') {
          control = h(SettingsNumber, {
            label,
            value: typeof value === 'number' ? value : (field.default === undefined ? 0 : field.default),
            min: field.min,
            max: field.max,
            step: field.step,
            onChange: (next) => patchField(field.key, next),
          })
        } else {
          control = h(SettingsText, {
            label,
            value: typeof value === 'string' ? value : '',
            placeholder: field.placeholder === undefined ? undefined : t(field.placeholder),
            onChange: (next) => patchField(field.key, next),
          })
        }
        return h(SettingsRow, { key: field.key, label, hint, hintTone, control })
      }

      const section = (key, titleKey, children) => h('section', { key },
        h('button', {
          type: 'button',
          className: 'pfgo-set-sec-toggle',
          'aria-expanded': openSections[key] === false ? 'false' : 'true',
          onClick: () => setOpenSections((previous) => ({ ...previous, [key]: previous[key] === false })),
        }, t(titleKey)),
        h('div', { className: 'pfgo-set-group', hidden: openSections[key] === false }, children))

      const group = (name) => CONFIG_FIELDS.filter((field) => field.group === name).map(renderField)

      return h('div', { className: 'pfgo-set' },
        header,
        section('basic', 'settings.basic', group('basic')),
        section('model', 'settings.model', group('model')),
        h('section', { key: 'prompt' },
          h('button', {
            type: 'button',
            className: 'pfgo-set-sec-toggle',
            'aria-expanded': openSections.prompt === false ? 'false' : 'true',
            onClick: () => setOpenSections((previous) => ({ ...previous, prompt: previous.prompt === false })),
          }, t('settings.prompt')),
          h('div', { className: 'pfgo-set-group', hidden: openSections.prompt === false },
            h(SettingsRow, { label: t('settings.promptMode'), hint: t('settings.promptModeHint'), control: h(SettingsSelect, {
              label: t('settings.promptMode'),
              value: config.promptMode ?? 'append',
              options: [
                { value: 'append', label: t('settings.promptModeAppend') },
                { value: 'replace', label: t('settings.promptModeReplace') },
              ],
              onChange: (value) => patch({ promptMode: value }),
            }) }),
            h('div', { className: 'pfgo-set-field' },
              h('span', { className: 'pfgo-set-label' }, t('settings.systemPrompt')),
              h(SettingsTextArea, {
                label: t('settings.systemPrompt'),
                value: config.systemPrompt ?? '',
                placeholder: t('settings.systemPromptHint'),
                onChange: (value) => patch({ systemPrompt: value }),
              }),
              h('span', { className: 'pfgo-set-hint' }, t('settings.systemPromptHint'))))),
        h('section', { key: 'effort' },
          h('button', {
            type: 'button',
            className: 'pfgo-set-sec-toggle',
            'aria-expanded': openSections.effort === false ? 'false' : 'true',
            onClick: () => setOpenSections((previous) => ({ ...previous, effort: previous.effort === false })),
          }, t('settings.effort')),
          h('div', { className: 'pfgo-set-group', hidden: openSections.effort === false },
            h(SettingsRow, { label: t('settings.effortGlobal'), control: h(SettingsSelect, {
              label: t('settings.effortGlobal'),
              value: config.reasoningEffort ?? '',
              options: effortOptions,
              onChange: (value) => patch({ reasoningEffort: value }),
            }) }),
            STYLES.map((style) => h(SettingsRow, {
              key: style,
              label: `${t('settings.effortByStyle')} · ${t(`style.${style}`)}`,
              control: h(SettingsSelect, {
                label: `${t('settings.effortByStyle')} ${t(`style.${style}`)}`,
                value: (config.reasoningByStyle ?? {})[style] ?? 'low',
                options: effortOptions.slice(1),
                onChange: (value) => patchEffort(style, value),
              }),
            })))),
        section('context', 'settings.context', group('context')),
        section('limits', 'settings.limits', group('limits')),
        section('pricing', 'settings.pricing', group('pricing')),
        h('section', { key: 'history' },
          h('button', {
            type: 'button',
            className: 'pfgo-set-sec-toggle',
            'aria-expanded': openSections.history === false ? 'false' : 'true',
            onClick: () => setOpenSections((previous) => ({ ...previous, history: previous.history === false })),
          }, t('settings.history')),
          h('div', { className: 'pfgo-set-group', hidden: openSections.history === false },
            history.length === 0
              ? h('div', { className: 'pfgo-set-msg' }, t('settings.historyEmpty'))
              : h('div', { className: 'pfgo-set-history' },
                history.map((entry) => h('div', { key: entry.key, className: 'pfgo-set-history-item' },
                  h('div', { className: 'pfgo-set-history-head' },
                    h('span', { className: 'pfgo-set-history-meta' }, [
                      t(`style.${entry.style}`),
                      entry.result.model,
                      entry.savedAt > 0 ? new Intl.DateTimeFormat(document.documentElement.lang || undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.savedAt)) : '',
                    ].filter((part) => typeof part === 'string' && part !== '').join(' · ')),
                    h('div', { className: 'pfgo-set-history-actions' },
                      h('button', {
                        type: 'button',
                        className: 'pfgo-ghost pfgo-ghost--sm',
                        onClick: () => copyHistory(entry.result.text, entry.key),
                      }, copiedKey === entry.key ? t('settings.copied') : t('settings.copy')),
                      h('button', {
                        type: 'button',
                        className: 'pfgo-ghost pfgo-ghost--sm',
                        onClick: () => removeHistory(entry.key),
                      }, t('settings.delete')),
                      h('button', {
                        type: 'button',
                        className: 'pfgo-ghost pfgo-ghost--sm',
                        onClick: () => setExpanded((previous) => ({ ...previous, [entry.key]: previous[entry.key] !== true })),
                      }, expanded[entry.key] === true ? t('settings.hide') : t('settings.expand')))),
                  h('div', { className: 'pfgo-set-history-text' },
                    expanded[entry.key] === true
                      ? h('pre', { className: 'pfgo-set-history-full' }, entry.result.text)
                      : snippet(entry.result.text, 140)),
                  h('div', { className: 'pfgo-set-history-original' }, `${t('settings.original')}: ${snippet(entry.text, 80)}`))))
            ,
            history.length === 0
              ? null
              : h('div', { className: 'pfgo-set-actions' },
                h('button', { type: 'button', className: 'pfgo-ghost', onClick: clearHistory }, t('settings.clearHistory'))))),
        h('section', { key: 'usage' },
          h('button', {
            type: 'button',
            className: 'pfgo-set-sec-toggle',
            'aria-expanded': openSections.usage === false ? 'false' : 'true',
            onClick: () => setOpenSections((previous) => ({ ...previous, usage: previous.usage === false })),
          }, t('settings.usage')),
          h('div', { className: 'pfgo-set-group', hidden: openSections.usage === false },
            h(SettingsRow, { label: t('settings.spendToday'), control: h('span', { className: 'pfgo-set-stat' }, spendInfo === null ? '—' : spendInfo.text) }),
            h(SettingsRow, { label: t('settings.runsToday'), control: h('span', { className: 'pfgo-set-stat' }, String(spendInfo === null ? 0 : spendInfo.runs)) }),
            h('div', { className: 'pfgo-set-actions' },
              h('button', {
                type: 'button',
                className: 'pfgo-ghost',
                onClick: () => {
                  clearSpend()
                  setSpendInfo(null)
                },
              }, t('settings.clearSpend'))))),
        h('div', { key: 'actions', className: 'pfgo-set-actions pfgo-set-sticky' },
          h('button', { type: 'button', className: 'pfgo-primary', disabled: busy, onClick: () => void save(false) }, t('settings.save')),
          h('button', { type: 'button', className: 'pfgo-ghost', disabled: busy, onClick: () => void save(true) }, t('settings.reset')),
          h('span', { className: 'pfgo-set-status', 'data-tone': failed ? 'error' : undefined }, status)))
    }

    // -----------------------------------------------------------------------
    // Plugin
    // -----------------------------------------------------------------------
    function apply(ctx) {
      // Per-component <style> elements are the supported path for statically
      // loaded modules: this client half has no `styles.insert` builtin.
      ctx.effect(() => () => {
        clearUnloadTimers()
        toast = null
        toastTimer = null
      })
      ctx.effect(() => {
        translate = ctx.locale.bind(NS)
        return () => { translate = (key) => key }
      })
      ctx.effect(() => ctx.locale.register(NS, STRINGS))
      ctx.effect(() => ctx.slots.inject('conversation.input.activity', () => ctx.slots.register({
        name: 'conversation.input.activity',
        id: 'prompt-forge-button',
        locale: NS,
      }, EnhanceButton)))
      ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
        name: 'conversation.input.overlay',
        id: 'prompt-forge-popover',
        locale: NS,
      }, ForgePanel)))
      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'prompt-forge',
        order: 47,
        label: () => translate('settings.label'),
        locale: NS,
      }, PromptForgeSettings)))
    }

    return { name: NS, inject: ['slots', 'locale'], apply }
  },
})
