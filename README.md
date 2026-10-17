# dsh-prompt-forge

输入框一键提示词增强（DeepSeek Harness Web / Desktop）。

在输入框里写一句草稿，点 ✨ → 模型把它改写成更清晰、可直接执行的提示词 → 在输入框上方的卡片里对比原文与结果 → 选择替换、复制、换风格重写或撤销。**只有你点"替换草稿"才会改动输入框，永不自动发送。**

## 安装

本项目是 DeepSeek Harness 的 bundle 插件包（Host + Web Client），任选一种方式安装：

- **源码目录**：克隆本仓库，在 DSH 的 Plugin Manager（插件管理）中用 `install_bundle` 安装该目录；
- **Release 包**：从 [Releases](https://github.com/Aliboder/dsh-prompt-forge/releases) 下载 `dsh-prompt-forge-<version>.tgz`，通过 Plugin Manager 安装。

安装或更新后**完整重启 DSH**（Host 代码与默认配置需要重启生效），刷新页面即可在发送键旁看到 ✨。禁用或卸载请在 Plugin Manager 中操作。

## 交互

| 位置 | 内容 |
|---|---|
| `conversation.input.activity` | ✨ 触发按钮（发送键旁；无草稿 / 含 @引用或命令 / 过长 / 会话忙时置灰并提示原因） |
| `conversation.input.overlay` | 按钮旁的浮动小窗：原文、增强后、替换 / 替换并发送 / 复制 / 重试 / 撤销 |

快捷键 `Ctrl+Alt+E` 打开或关闭当前会话的小窗（草稿为空、含命令芯片或会话忙时忽略）。

小窗以按钮为锚点首次定位（上方空间够就向上弹，否则向下）。**可拖动标题移动、拖右下角缩放**，尺寸与拖动后的位置会记在 `localStorage`（`dsh.prompt-forge.layout.v1`），下次打开、重开会话甚至重启后都沿用；双击标题恢复默认位置和尺寸。点击外部或 `Esc` 关闭（原文编辑区里按 `Esc` 会先落盘再关闭）；标题栏的「钉住」可让点击外部不再关闭。**每个会话各有一份小窗**，切换会话不会互相覆盖。打开时焦点进入小窗、关闭时回到 ✨。

**流式生成**：默认边生成边显示（`/prompt-forge/stream`，SSE），首字出现后就不再是干等转圈；流式展示会吞掉模型多包的 ``` 围栏，完成时不再"跳一下"，最终以完整归一化结果为准。可在配置里用 `streaming: false` 退回一次性返回。

**原文可直接编辑**：小窗里的原文是输入框草稿的实时镜像。在面板里改字会（防抖 120ms）写回输入框，反之在输入框里改字面板也会跟着变。结果始终对应"发起请求时那一版原文"；编辑原文后会出现「草稿已改动」提示，点风格按钮或重试即可用新文本重新生成。点「替换草稿」后原文编辑区收起，只留结果提示与撤销；**撤销记录会持久化**，关掉小窗后重新打开、只要输入框仍是替换后的文本，就能用「撤销上次替换」还原。会话处于提交中（命令芯片、正在发送）时原文只读并给出提示。

**替换并发送**：结果栏的「替换并发送」会先写入草稿，**等输入框真正反映新文本后再提交**（最多等 600ms，超时则保留替换结果、让你手动发送），避免把替换前的草稿发出去。

**直接替换模式**：设置里打开「点击按钮直接替换草稿」后，点 ✨ 不再弹窗，而是直接请求并写回输入框；默认使用设置中的「直接替换使用的风格」（留空跟随默认风格，不会沿用你在弹窗里临时切过的风格）。写入是**流式**的：生成过程中输入框里的文字会逐段刷新（约 60ms 一批），不用等整段生成完；生成期间按钮旁显示「生成中 · 风格」。如果你在生成过程中自己改动了输入框，插件会立即停止写入、保留你的改动，并把完整结果放进预览窗口（同时飘出「草稿已变化」提示）。替换成功后 ✨ 上方会飘出一个费用提示：显示本次估算金额（悬停标注「按本插件配置的单价估算」与 token 信息），没有价格数据时退回显示 token；显示时长由 `toastDurationMs` 控制（默认 2.6 秒）。按钮旁同时出现「已替换 · 撤销」的一步撤销。失败时会飘出「生成失败，已打开预览」并打开错误窗口。`Ctrl+Alt+E` 默认始终打开预览窗口（作为对照入口）；在设置里关闭「快捷键始终打开预览」后，直接模式下快捷键也会直接替换。

**今日花费**：每次真实生成（不含缓存命中）会把估算费用累计到本机 `localStorage`（按日重置、按货币分别累计），可以在设置页「用量统计」看到今日估算花费与次数并清除；直接替换的费用提示悬停时也会带上今日累计。

**上下文感知**：Host 读取本会话最近若干轮对话用于消解指代、补全术语；结果标注「参考了 N 轮」。标题栏的「上下文」是一个**开关**：关掉后下一次请求不读取上下文（开关状态会记住，但不写回插件配置）。

**结果缓存**：同一份草稿 + 同一风格 + 同一**会话路由与配置指纹**的增强结果会缓存（`dsh.prompt-forge.results.v2`，最多 40 条），关掉再打开会直接显示上次结果并标注「沿用上次」和生成它的模型；缓存命名空间由 Host 的 `/route`（按会话解析 provider/model）与 `/config` 共同决定，换模型、换会话模型或改配置都会让旧缓存失效。点「重试」强制重新生成；草稿改动后 key 变化。设置页「最近结果」可以浏览这些缓存条目（按时间倒序，查看原文/结果全文、复制、删除、清空），全部只读写本机 `localStorage`。

三种风格（按按钮顺序）：**极简**（默认；≤1.5 倍，只把模糊动词变具体）、**详细**（缺的信息用「待补充」占位、列待确认清单，不臆造）、**规格化**（角色、目标、约束、步骤、输出格式、验收标准）。

**提示词模板**：可以在设置里用自定义指令覆盖改写模型的行为——「追加」把指令加到内置规则之后，「替换」则只用你的指令（会丢失内置的保真/不扩写约束，慎用）。模板参与缓存指纹，改模板后旧缓存自动失效。

**多候选对比**：在设置里选一个「对比风格」后，预览窗口会并行生成两版（当前风格 + 对比风格）；第二版以普通请求完成，带「使用这个 / 复制」操作，选中即替换草稿。两版各自参与缓存与费用统计，成本约为单候选的两倍；直接替换模式仍只生成一版。

**错误提示**：鉴权失败 / 额度不足 / 上下文超限 / 限流 / 并发 各给一条可操作的本地化提示；限流额外显示「请 N 秒后再试」，provider 的原始报错折叠在「技术详情」里，不再直接糊在脸上。

## 模型

默认跟随当前会话已选定的 provider/model；会话尚无请求记录时回落到 agent 默认模型。**不需要任何第二套 API Key**——调用走 `ctx.llm`，复用 DSH 已配置的凭据。

**完全独立**：只使用核心服务（`llm`、`webServer`）和输入框槽位 props，不读取、不依赖任何第三方插件（不接 cost-meter、不读别人的价表或配置）。

## 设置页

**设置 → 提示词增强**（位于设置侧栏「工作伙伴」之后）提供可视化配置：启用插件、默认风格、**直接替换风格**、**对比风格**、流式、**点击按钮的行为（直接替换 / 弹出窗口）**、费用提示时长、快捷键行为、模型覆盖、**提示词模板（追加/替换 + 自定义指令）**、三档思考强度（全局 + 按风格）、上下文预算、生成限制、费用估算单价、**最近结果**（浏览/复制/删除本机缓存的历史结果）以及**用量统计**（今日估算花费与增强次数，仅存本机、可清除）。保存会通过宿主 `configEditor` 写入当前 profile 的 patch，并立即热重载生效；「恢复默认」会移除该覆盖。若 profile 未启用配置编辑器，页面会提示改用手工编辑 `cordis.patch.yml`。

保存只写**与内置默认值不同的字段**；未写出的字段回落到内置默认值（`lib/config.js` 的 `DEFAULTS`），而不是 bundle patch 里的值——这是宿主「profile 覆盖会替换整条 `config`」的语义决定的。因此 bundle patch 只应用于没有 profile 覆盖的情况；要让某项始终生效，把它写进默认值或写进 profile 覆盖。保存后页面会轮询到新值真正生效才显示「已保存并生效」，热重载导致的重挂载也不会丢掉这条状态提示。数字字段在提交前就按范围校验，避免被服务端静默夹紧。表单按分组折叠（默认收起思考强度、生成限制、单价），保存条吸底常驻，长表单不必滚到底才能保存。

> 设置页写入的是**部分覆盖**：只包含你改过的字段。一旦存在覆盖行，未列出的字段使用内置默认值；`contextAware` 默认即为 `true`，不会因为一次保存被静默关闭。

## 配置

也可以直接编辑 bundle 的 `cordis.patch.yml`（或在你自己的 profile patch 里用 `- id: prompt-forge` 覆盖）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关，关闭后按钮隐藏、接口拒绝 |
| `defaultStyle` | `brief` | 点 ✨ 时使用的风格：`brief`（极简）/ `clarify`（详细）/ `spec`（规格化） |
| `directStyle` | 空 | 直接替换模式使用的风格；空=跟随 `defaultStyle` |
| `compareStyle` | 空 | 设置后预览窗口会并行生成第二个风格用于对比；空=单候选 |
| `streaming` | `true` | 边生成边显示；设 `false` 退回一次性 JSON 返回 |
| `directApply` | `false` | `true`：点击 ✨ 直接把增强结果替换进输入框（不弹窗，按钮旁出现一步「撤销」）；`false`：弹出预览窗口 |
| `toastDurationMs` | `2600` | 直接替换后费用提示的显示时长（800–10000 毫秒） |
| `shortcutOpensPreview` | `true` | `true`：`Ctrl+Alt+E` 始终打开预览；`false`：直接替换模式下快捷键也直接替换 |
| `systemPrompt` | 空 | 自定义指令（最多 8000 字符）；留空使用内置指令 |
| `promptMode` | `append` | `append`：自定义指令追加在内置规则之后；`replace`：只使用自定义指令（参考对话的说明仍会自动追加） |
| `provider` / `model` | 空 | 成对填写可固定模型；留空跟随会话 |
| `temperature` | `0.3` | 低温改写更忠实原意 |
| `maxOutputTokens` | `2048` | 单次输出上限 |
| `maxInputChars` | `12000` | 草稿字数上限，超限拒绝而不截断 |
| `timeoutMs` | `60000` | 单次超时 |
| `reasoningEffort` | 空 | 全局思考强度覆盖：`off`/`low`/`high`/`max`；留空走下面的按风格映射 |
| `reasoningByStyle` | `brief=off, spec=low, clarify=high` | 按风格分档的思考强度 |
| `pricing` | 官方人民币价（空闲时段） | 本插件自带的单价表（元/百万 token），按官方 API 规则估算；高峰时段自动 ×2 |
| `maxConcurrent` | `2` | 并发上限 |
| `rateLimitPerMinute` | `10` | 每分钟次数上限 |
| `contextAware` | `true` | 上下文感知：读取本会话最近若干轮对话用于消解指代、补全已确立的术语与约束（只读会话文本，不读文件） |
| `contextMaxMessages` | `8` | 上下文最多参考多少条 user/assistant 轮次 |
| `contextMaxChars` | `4000` | 上下文片段的字符预算 |

> 关于按钮位置：✨ 占用 `conversation.input.activity` 这个**单座位**（发送键旁）。如果其它插件也注册同一座位，二者只能有一个显示；这是宿主座位语义，不是本插件的可配置项。

### 思考强度

「极简」不思考（最快）、「详细」高思考、「规格化」低思考——按风格自动选择，也可用 `reasoningEffort` 全局覆盖：

```yaml
- id: prompt-forge
  config:
    reasoningEffort: low      # off / low / high / max；覆盖所有风格
    reasoningByStyle:         # 不写 reasoningEffort 时按风格走
      spec: low
      brief: off
      clarify: high
```

### 费用估算（按官方 API 规则，人民币）

每次调用后，面板显示输入/输出 token 与估算费用，单位统一为人民币（`¥`）。计价规则参照 [DeepSeek 官方 API 价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：

- 费用 = 缓存命中输入 token × 缓存命中单价 + 缓存未命中输入 token × 未命中单价 + 输出 token × 输出单价；
- 配置里的单价是**北京时间空闲时段**单价；**高峰时段**（周一至周五 9:00–12:00、14:00–18:00，法定节假日除外）按官方口径 **2 倍**计费；
- 默认内置 `deepseek-flash`（空闲：命中 0.02、未命中 1、输出 4 元/百万 tok）与 `deepseek-v4-pro`（空闲：命中 0.15、未命中 4.5、输出 13.5 元/百万 tok）两套价格。

```yaml
- id: prompt-forge
  config:
    pricing:
      currency: CNY
      inputPerMTok: 1          # 空闲时段，缓存未命中
      outputPerMTok: 4         # 空闲时段，输出
      cachedInputPerMTok: 0.02 # 空闲时段，缓存命中
      peakAware: true          # 关闭后按空闲价固定估算
      peakMultiplier: 2
      holidays: ['2026-10-01'] # 可选：中国法定节假日，按空闲时段计费
      models:                  # 可按模型名或 provider/model 覆盖
        deepseek-v4-pro:
          inputPerMTok: 4.5
          outputPerMTok: 13.5
          cachedInputPerMTok: 0.15
```

设置页「费用估算单价」只暴露空闲时段的三个单价（高峰自动 ×2，不改字段）；`peakAware`、`holidays`、`models` 等高级项仍可在配置里覆盖。法定节假日无法自动识别，需要的话把日期填进 `holidays`。估算只用于参考，实际扣费以官方账单为准。

## 发布与打包

```bash
npm test             # 45 项纯逻辑断言 + Host 路由测试
npm run check        # node --check 全部 Host/Client 源文件
npm run pack:check   # 确认打包清单包含 lib/**、locale、icon、patch
npm pack             # 产出 dsh-prompt-forge-<version>.tgz
```

`files` 必须包含 `lib/**/*.js`：Host 通过相对路径导入它们，漏掉会让打包后的插件加载失败。已验证解包后 `index.js` 能正常导入 `lib/**`。

发布前的人工检查（本仓库已配置 MIT 许可证与 `repository` 字段）：

1. 完整重启 DSH，使新的 Host 代码与配置默认值生效；
2. 刷新页面实测设置页、小窗浮层与费用提示（浮层在座位内渲染，需要视觉回归）；
3. 在干净 profile 里安装 tarball 验证一次；
4. `git tag v1.0.0 && git push --tags`，再执行 `gh release create v1.0.0 --notes-file CHANGELOG.md`（可附带 tarball）。

## License

MIT © Aliboder

## 接口（仅本机）

- `GET  /prompt-forge/config` — 客户端启动配置（含缓存指纹 `routeKey`）
- `GET  /prompt-forge/route?session=<id>` — 解析该会话实际使用的 provider/model 并返回缓存命名空间
- `GET  /prompt-forge/settings` / `POST /prompt-forge/settings` — 设置页读写（`{ config }` 或 `{ reset: true }`）
- `POST /prompt-forge/enhance` — `{ text, style?, sessionId?, context? }`
- `POST /prompt-forge/stream` — 同一请求的 SSE 版本（`delta` / `done` / `error` 帧）

全部 loopback 校验 + `application/json` 校验 + 请求体上限；失败返回 `{ ok: false, error: { code, message?, params? } }`。

## 开发

纯 JS 零依赖；改 `client.js` 刷新页面即可，改 `index.js` 或 `lib/**` 需要完整重启 DSH。

```
index.js         Host 路由与模型调用（约 650 行）
lib/config.js    纯配置逻辑：默认值、normalize/sanitize、费用、指纹
lib/prompt.js    纯提示词组装：内置指令、风格说明、上下文规则、输出归一化
client.js        浏览器端：按钮、预览窗、设置页（字段由 CONFIG_FIELDS 描述表驱动）
test/host.test.mjs  路由级集成测试（stub ctx）
test/lib.test.mjs   纯模块单元测试
```

运行测试（Node 24）：

```
node test/lib.test.mjs
node test/host.test.mjs
```
