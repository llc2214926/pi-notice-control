# pi-notice-control

[简体中文](#zh-cn) | [English](#en)

<a id="zh-cn"></a>

## 简体中文

为 [Pi](https://pi.dev/) 提供通知过滤和三级折叠：隐藏重复提醒，精简单条工具、收起连续工具组，再将用户输入、模型正文和 `todo` 之间的过程合并为 `task process`。

仅改变显示，不修改工具执行、返回给模型的结果、沙箱权限或系统代理。不注册模型工具，无需额外运行时依赖。

### 功能

- 按通知原文进行全文或包含匹配，可附加 `info`、`warning`、`error` 等级条件；首条规则命中生效，未命中原样放行。
- 保留最近 100 条通知记录，支持临时暂停过滤、查看详情和重载 JSON。
- 工具调用折叠为一行：`write` / `edit` 显示工具名和路径，`bash` 显示命令首行，`search` 系列显示搜索词及省略查询数；`read_symbol`、`module_report` 等工具同样精简，展开后恢复原显示。
- 用户输入、模型正文和 Pi 原生状态提示保持可见；过程内容按段折为 `task process`。压缩后的会话同样逐段折叠，不改写 Pi 原生摘要或消息。thinking 和 `todo` 沿用原生渲染器。
- 连续 `read`、连续 `edit/write`、其他连续工具调用分别自动折为二级摘要；展开组后仍可单独展开工具。
- 成功结果默认隐藏，也可配置最大显示行数；shell、`agent_browser`、`fetch`、`search` 系列的错误默认最多 5 行，shell 错误保留 `Command exited with code N`。
- 展开工具后恢复原渲染器的完整显示；配置无效时停止过滤和精简，避免沿用旧的隐藏策略。

> 隐藏安全提醒不等于改变安全策略。示例只隐藏“允许所有域名”的通知，`allowedDomains: ["*"]` 仍然允许所有域名。

### 安装

要求 **Pi >=1.5.0**，不支持更早版本。二/三级折叠适配 Pi 1.5.2 / 1.6.0 的 TUI；其他布局无法接入时保留单条工具显示。Pi 直接加载 TypeScript，无需单独构建。

#### 从 GitHub 全局安装（推荐）

```sh
pi install git:github.com/llc2214926/pi-notice-control
```

Pi 会将包登记到个人 `settings.json` 的 `packages` 列表，默认对所有项目生效，无需再注册 `extensions`。

要隐藏 `pi-sandbox` 的启动通知，请把 `git:github.com/llc2214926/pi-notice-control` 放在 `packages` 列表中 `npm:pi-sandbox` 之前，保留其余条目。

#### 本地目录安装

将仓库保存在固定目录，在个人 `~/.pi/agent/settings.json` 的 `extensions` 列表首位加入：

```json
{
  "extensions": ["/absolute/path/to/pi-notice-control/index.ts"]
}
```

合并到已有配置，不要覆盖其他扩展或设置。保留同目录的 `index.ts`、`rules.ts`、`tool-display.ts` 和 `tool-groups.ts`；日常使用无需安装开发依赖。两种安装方式选一种，避免加载多个副本。

#### 初始化与迁移

1. 将 [notice-control.example.json](notice-control.example.json) 保存到 `~/.pi/agent/notice-control.json`。已有文件只合并需要的字段或规则，不要覆盖原配置。
2. 如果之前加载了 `~/.pi/agent/extensions/pi-minimal-write-edit.ts`，请停用它，避免两个渲染器叠加。自动发现目录里的文件可移出该目录保存；手动注册的文件则移除对应配置条目。
3. 在 Pi 中运行 `/reload` 或重启。

`PI_CODING_AGENT_DIR` 会同时改变个人 `settings.json` 和 `notice-control.json` 所在的 agent 目录。扩展不自动创建配置文件；文件缺失时显示诊断并保持原始显示。

#### 启动顺序

通知过滤必须先于通知生产者加载。Pi 1.5 的顺序为：命令行 `-e`、项目扩展、用户扩展、包内扩展、内置扩展。项目和用户扩展各自先显式注册、后自动发现；包内扩展先项目包、后用户包，同一作用域按包列表顺序。

GitHub 安装无法捕获更早的项目或用户扩展启动通知。需要更早接管时，可将本地副本作为第一个 `-e` 参数：

```sh
pi -e /absolute/path/to/pi-notice-control/index.ts
```

不要仅依赖 `00-` 文件名前缀；包列表顺序不能改变不同来源的优先级。

### 配置

只读取个人 agent 目录中的 `notice-control.json`，不读取项目配置，以免仓库自行屏蔽安全提醒。使用严格 JSON，不支持注释。

下面的配置隐藏指定沙箱通知，并启用工具精简：

```json
{
  "enabled": true,
  "toolDisplay": {
    "enabled": true,
    "maxLines": 0,
    "collapseConsecutive": true,
    "collapseTaskProcess": true,
    "collapseCommandErrors": true,
    "errorMaxLines": 5
  },
  "rules": [
    {
      "id": "sandbox-all-domains",
      "enabled": true,
      "match": {
        "type": "warning",
        "contains": "Network sandbox allows all domains because network.allowedDomains contains \"*\""
      },
      "action": "hide"
    }
  ]
}
```

只需要工具折叠时，可将 `rules` 设为 `[]`。**旧配置省略 `toolDisplay` 时保持原有行为，不自动启用工具精简。**

#### 工具显示

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `toolDisplay.enabled` | `true` | 工具精简开关；仅在提供 `toolDisplay` 对象时生效，`false` 恢复原显示 |
| `toolDisplay.maxLines` | `0` | 折叠时成功结果最多显示的行数；`0` 隐藏普通结果，保留调用行及完整输出保存失败警告 |
| `toolDisplay.collapseConsecutive` | `true` | 按类别折叠至少两条连续工具调用；`false` 关闭二级工具分组，不影响三级 |
| `toolDisplay.collapseTaskProcess` | `true` | 折叠用户输入、模型正文和 `todo` 之间的全部过程；`false` 关闭三级折叠 |
| `toolDisplay.collapseCommandErrors` | `true` | 折叠 shell、`agent_browser`、`fetch`、`search` 系列的失败输出；`false` 使用原渲染器显示错误 |
| `toolDisplay.errorMaxLines` | `5` | 折叠错误的最大行数；至少 `1`，shell 有退出码时优先显示退出码，保存失败警告仍保留 |

- 行数必须是安全整数，按终端自动换行后的**实际显示行**计算。上限包含省略提示和退出码，不包含调用行及 Pi 外框留白。行数太少时优先显示正文或退出码，不额外显示省略提示；窄终端中退出码缩写为 `exit N`，其他单行可能被截短。
- Bash / PowerShell 的完整输出保存失败时，折叠结果保留一行 `Could not save the full output: ...` 警告，即使 `maxLines: 0` 也可见。警告和退出码同时存在时至少显示两行；工具组及过程摘要显示 `output save failed N`，以警告色提示。
- 成功结果保留开头，shell 结果保留末尾；shell 错误保留末尾和已有的 `Command exited with code N`。超时、终止等没有退出码的失败不伪造退出码。浏览器、抓取、搜索错误保留原渲染器输出的开头。
- `search` 系列包括 `search`、`web_search`、`symbol_search`、`ast_grep_search` 等名称为 `search`、以 `_search` 结尾或以 `search_` 开头的工具；调用摘要支持 `query`、`queries`、`pattern`。
- 其他工具的调用标题也限制为一行；没有调用标题的渲染器以工具名、路径和符号名（若有）显示。展开后恢复原渲染器；没有调用渲染器时显示完整 JSON 参数。`todo` 不受这一限制。
- 错误折叠还覆盖 `agent_browser` 及 `agent_browser_*`、`fetch`、`fetch_*`、以 `_fetch` 结尾的工具和 `get_search_content`。其他工具的单条错误不主动隐藏或限行。
- Ctrl+O（默认工具展开快捷键）或在支持鼠标的模式中点击单条工具可展开；展开后不受本扩展的行数限制。修改过快捷键时以 Pi 当前绑定为准。
- 此功能只改变工具渲染，不截断模型结果或会话记录；宿主自身的结果截断仍然存在，超长输出按原提示读取完整文件。
- 顶层 `enabled` 和 `/notices on|off` 只控制通知过滤，**不控制工具显示**。

折叠效果示例（`errorMaxLines: 5`，终端宽度足够时）：

```text
write src/config.ts

$ npm run check
… (42 lines hidden; ctrl+o to expand)
最后几行错误信息
更多错误信息
检查失败
Command exited with code 1
```

#### 连续工具二级折叠

提供 `toolDisplay` 后默认启用（已有工具配置也会启用），可用 `collapseConsecutive: false` 关闭。只折叠至少两条连续的同类别调用，类别为 `read`、`edit/write`（可混合）、其他工具。可见的聊天文字、思考、通知等会打断分组；仅包含工具调用的空助手消息不打断。

```text
▶ read × 3 · /tool-groups
▶ edit/write × 4 · /tool-groups
▶ tool calls × 2 · web_search × 1, fetch_content × 1 · /tool-groups
▶ tool calls × 4 · failed 3, agent_browser × 4 · /tool-groups
```

- 在支持鼠标的模式下点击组标题，或运行 `/tool-groups` 选择一组展开/折叠。展开组只显示现有单条折叠行，不自动展开各条结果。
- `/tool-groups expand` / `/tool-groups collapse` 批量开合组。Ctrl+O 仍可展开全部组和工具结果，再按一次收起。
- 摘要实时显示 `running`、`failed` 和 `output save failed` 数量，有工具失败时标红，仅完整输出保存失败时使用警告色；**折叠组会同时隐藏成功和失败工具的详情**。展开组后，异常仍遵循单条错误行数配置，可继续展开单条查看完整输出。
- 分组折叠状态在当前 Pi 进程内按会话保存；含稳定消息/工具 ID 的组在历史重建和 `/reload` 后保留，切换会话或重启 Pi 后重置。关闭二级折叠不会修改单条展开状态。

#### task process 三级折叠

提供 `toolDisplay` 后默认启用，可用 `collapseTaskProcess: false` 单独关闭。**用户输入、模型正文和 Pi 原生状态提示保持可见，作为分段边界**；中间的过程内容一起收起。重载、模型切换、警告等 Pi 提示不会随过程折叠。正在执行、尚未出现下一段正文的过程也可折叠。第一条边界之前的启动内容不折叠；纯留白或不可见内容不生成空组。

Pi compact 后，**原生压缩摘要和后续消息均不改写，也不回放 Pi 已省略的旧记录**。摘要后的过程按原有边界逐段折叠；`todo` 保持 Pi 原生显示、分隔前后过程，不并入 `task process`。没有压缩摘要时也是如此。

若当前 TUI 还保留摘要前的旧 transcript（包括 `pi-visible-scrollbar` 0.2.4 提供的归档），会单独折为 `earlier history`；展开后左侧缩进显示主题强调色竖线 `│`，不额外占用内容宽度。内部每段 `task process`、二级工具组和单条结果仍默认收起，可逐层展开。`todo` 保持原生显示并位于 `task process` 之外；收起整个 `earlier history` 时它也随历史归档收起，展开历史后仍可见。不修改归档内容或原生摘要；展开历史后仍可使用滚动条的用户输入定位。摘要前只有原生留白时不生成空组。使用 `/earlier-history` 选择或批量开合，不影响内部过程或工具的开合状态。

```text
用户输入
▼ task process · /task-process
  thinking...
  ▼ read × 2 · /tool-groups
    read a.ts
    read b.ts
todo（原生任务列表）
▶ task process · failed 1, read × 2, bash × 1, thinking × 2 · /task-process
模型正文
Reloaded keybindings, extensions, skills, prompts, themes, and context files
```

- 只有 `task process` 标题一行使用独立背景：深色主题为金棕色，浅色主题为浅金色。展开内容保留各自背景，工具成功、失败状态色不变。
- 外层三级保持当前对齐；二级（thinking、工具组等）额外缩进 2 列，一级单条工具额外缩进 4 列。窄屏自动减少缩进，避免超出宽度。
- 点击标题，或用 `/task-process` 选择一组开合；`/task-process expand` / `collapse` 批量开合三级组。展开三级不改变内部二级组或单条工具的开合状态。
- thinking 与工具组同属二级内容，**不另加 thinking 分组、不改写其显示策略**：保留 Pi 自带的标题、鼠标开合与 Ctrl+T。`todo` 不加入工具组，也不受本扩展的单条结果隐藏或行数限制。
- Ctrl+O 同步开合三级、二级工具组及单条工具；thinking 仍保持自己的原生状态。过程摘要按逗号列出 `failed` / `running` / `output save failed` 数量、各工具调用数及 `thinking` 数量，不再另显示冗余的工具总数；有工具失败时标红。
- 同一条模型消息中混合的正文与 thinking 也分别归类；正文不随过程隐藏。若宿主助手组件布局不兼容，保留该消息的原始显示。

#### 通知规则

| 字段 | 说明 |
| --- | --- |
| `enabled` | 顶层通知过滤开关或单条规则开关，可省略，默认 `true` |
| `rules` | 必填数组；空数组表示所有通知放行 |
| `id` | 必填、唯一、非空白字符串，不超过 64 个 UTF-16 码元 |
| `match.exact` | 与整条原文完全相同，区分大小写 |
| `match.contains` | 原文包含指定文字，区分大小写 |
| `match.type` | 可选，只允许 `info`、`warning` 或 `error` |
| `action` | 必填，只允许 `hide` 或 `show` |

`exact` 和 `contains` 必须且只能设置一个，不能是空白文字，不支持正则。规则按数组顺序匹配，禁用规则跳过；要保留例外，请把 `show` 规则放在更宽泛的 `hide` 规则之前。

未传等级的通知按 `info` 匹配，放行时保留原始参数。匹配使用完整原文，不包括 Pi 追加的 `Warning:` / `Error:` 前缀，不自动移除 ANSI 样式。

未知字段、无效值、重复 ID 或空匹配使整份配置失效，停止通知过滤和工具精简；修复后运行 `/notices reload`。

### 命令

| 命令 | 作用 |
| --- | --- |
| `/notices` | 查看最近通知，最新的在前；选中显示详情，Escape 取消 |
| `/notices off` | 本次会话暂停通知过滤，仍然记录通知 |
| `/notices on` | 本次会话开启通知过滤，需要有效配置和可用的通知入口 |
| `/notices reload` | 重读全部配置，并用顶层 `enabled` 重置通知过滤的临时开关 |
| `/tool-groups` | 选择连续工具组并切换展开/折叠 |
| `/tool-groups expand` / `collapse` | 展开/折叠全部连续工具组 |
| `/task-process` | 选择一个三级过程组并切换展开/折叠 |
| `/task-process expand` / `collapse` | 展开/折叠全部三级过程组 |
| `/earlier-history` | 选择 compact 摘要前的旧历史并切换折叠 |
| `/earlier-history expand` / `collapse` | 展开/折叠 compact 前的 earlier history |
| `/fold-all` | 重新扫描聊天并折叠所有过程组、工具组和工具输出 |

命令不修改 JSON。修改配置用 `/notices reload`，工具显示同步刷新；修改扩展代码或安装路径请用 Pi 的 `/reload`。

### 隐私与限制

- 最近 100 条通知只保存在内存，不写磁盘、不发给模型。单条最多保留前 4096 个 UTF-16 码元，超出标记截断；规则仍匹配完整原文。
- 查看通知详情时移除 ANSI 样式及部分控制字符；管理提示不进入历史。`/notices reload` 保留记录，Pi `/reload`、会话替换或退出清空记录。
- 通知过滤支持 TUI / RPC 的 `ctx.ui.notify()`；工具折叠面向 TUI。无 UI 的 print/JSON 模式不接管。
- 不过滤 Pi 内部提示、聊天消息、权限确认框、状态栏或桌面通知，不移除已显示的通知。`notify()` 没有来源信息，不能按来源扩展匹配。
- 原生 `!` / `!!` 用户 shell 输出不受单条工具折叠或工具分组配置影响，但位于过程内时会随 `task process` 收起。图片不受单条文本行数限制，但会随整组收起；展开组恢复显示。没有可用工具渲染器的历史条目保留单条宿主显示。
- 二/三级折叠依赖 Pi 的 TUI 布局；无法接入时保留单条折叠，不影响执行。
- 其他扩展若提前保存或替换通知入口，可能绕过过滤；其他工具渲染器也可能影响最终显示。宿主接口变化时可能需要适配。
- 扩展自身的界面文案目前是中文；双语仅指本文档。

### 许可证

[MIT](LICENSE) © 2026 LLC。

---

<a id="en"></a>

## English

Notification filtering and three-level folding for [Pi](https://pi.dev/). Simplify individual tools, group consecutive calls, and collapse everything between user input, assistant text, and `todo` into `task process`, without changing execution, model results, sandbox permissions, or system proxies.

### Installation

Requires **Pi >=1.5.0**; earlier versions are unsupported. Group folding targets Pi 1.5.2 / 1.6.0's TUI; other layouts retain per-tool display if attachment is unavailable. No build or additional runtime dependency is required.

```sh
pi install git:github.com/llc2214926/pi-notice-control
```

Pi adds the package to your personal `settings.json`. To filter `pi-sandbox` startup notices, place this package before `npm:pi-sandbox` in `packages`.

For a local installation, add the absolute path to `index.ts` first in your personal `extensions` list. Keep `index.ts`, `rules.ts`, `tool-display.ts`, and `tool-groups.ts` together. Choose one installation method and preserve existing settings.

Save [notice-control.example.json](notice-control.example.json) as `~/.pi/agent/notice-control.json`, merging rather than overwriting existing rules. Disable the standalone `pi-minimal-write-edit.ts` if installed, then run `/reload` or restart Pi. Auto-discovered copies can be moved outside the extensions directory; remove explicit registrations if applicable.

`PI_CODING_AGENT_DIR` changes the directory containing both personal settings and this configuration. Missing configuration produces a warning and leaves normal display intact.

Filtering must load before notice producers. Pi 1.5 loads command-line extensions, project extensions, user extensions, package extensions, then built-ins. Project/user scopes load explicit entries before auto-discovered ones; project packages precede user packages, and each package list retains its order. For earlier interception, pass the local entry as the first `-e` argument:

```sh
pi -e /absolute/path/to/pi-notice-control/index.ts
```

### Configuration

Only the personal `notice-control.json` is read, never project rules. Use strict JSON without comments. The linked example combines one sandbox-notice rule with tool folding. For tool folding alone:

```json
{
  "enabled": true,
  "rules": [],
  "toolDisplay": {
    "enabled": true,
    "maxLines": 0,
    "collapseConsecutive": true,
    "collapseTaskProcess": true,
    "collapseCommandErrors": true,
    "errorMaxLines": 5
  }
}
```

**Omitting `toolDisplay` preserves the old notification-only behavior.** An empty `toolDisplay` object enables the defaults above.

| Tool display field | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Enable compact tool rendering; `false` restores the original display |
| `maxLines` | `0` | Maximum collapsed success-result lines; `0` hides ordinary output while retaining full-output save warnings |
| `collapseConsecutive` | `true` | Group two or more consecutive calls by category; `false` disables level-two tool groups |
| `collapseTaskProcess` | `true` | Collapse all process content between user input, assistant text, and `todo`; `false` disables level three |
| `collapseCommandErrors` | `true` | Fold shell, browser, fetch, and search errors; `false` uses the original error renderer |
| `errorMaxLines` | `5` | Maximum collapsed error lines; minimum `1` preserves a shell exit status when present |

Limits count **wrapped terminal rows**, including the omission hint and exit status, excluding the call header and Pi's outer padding. Values must be safe integers (`maxLines >= 0`, `errorMaxLines >= 1`). When space is tight, content or exit status takes priority over the omission hint. Narrow terminals abbreviate the status to `exit N`; other single lines may be shortened.

Collapsed `write` / `edit` calls show the tool name and path. `bash` shows its first command line and an omitted-line count. Search tools (`search`, names ending in `_search` or starting with `search_`) show `query`, the first of `queries` plus a count, or `pattern`. Other call headers, including `read_symbol` and `module_report`, also collapse to one row. Renderers without a call header show the tool name, path, and symbol when available. Expanding restores the original renderer, or complete JSON arguments if it has no call renderer. `todo` is exempt.

Shell full-output save failures retain one `Could not save the full output: ...` warning row, even with `maxLines: 0`. A warning and exit status together use at least two rows. Tool-group and process summaries show `output save failed N` in the warning color unless a tool error takes priority.

Success previews keep the beginning, shell previews keep the end. Shell errors pin an existing `Command exited with code N`; other shell failures retain trailing errors without inventing an exit code. Browser/fetch/search errors keep the beginning of the original renderer output. Error folding covers `bash`, `powershell`, search tools, `agent_browser` / `agent_browser_*`, `fetch` / `fetch_*` / names ending in `_fetch`, and `get_search_content`. Other tools' errors retain their original per-tool rendering.

Expand with Ctrl+O (the default binding) or click one tool where mouse support is available. Expanded views use the original renderer without this extension's line cap. Model results and session records are unchanged; Pi's own truncation and full-output file references still apply.

The top-level `enabled` and `/notices on|off` control **notification filtering only**, independently of tool display.

#### Consecutive tool groups

Enabled by default when `toolDisplay` is present, including existing tool configurations. Set `collapseConsecutive: false` to disable it. Two or more consecutive calls are grouped as `read`, mixed `edit/write`, or other tools. Visible chat text, thinking, and notices break groups; empty tool-only assistant messages do not.

Click a group title where mouse support is available, or use `/tool-groups` to choose and toggle one group. `/tool-groups expand` and `/tool-groups collapse` operate on all groups. Opening a group preserves each tool's independent expansion state. Ctrl+O still expands all groups and results, and collapses them on the next press.

Summaries update `running`, `failed`, and `output save failed` counts; tool failures turn red and output-save failures use the warning color. **Collapsed groups hide both successful and failed tool details.** Opening a group keeps per-tool error limits; expand an individual tool to see its full output. Fold state for groups with stable message/tool IDs is kept per session in memory, survives transcript rebuilds and `/reload`, and resets when the session changes or Pi restarts.

#### task process (level three)

Enabled by default when `toolDisplay` is present. Set `collapseTaskProcess: false` to disable it independently. **User input, assistant text, and native Pi status notices remain visible as boundaries**; process content between them collapses into `task process`. Reload, model-switch, and warning notices do not disappear with a process. An ongoing process can fold before its next text boundary. Startup content before the first boundary stays visible, and blank content does not create empty groups.

After compaction, **Pi's native summary and subsequent messages are not rewritten, and omitted history is not replayed**. Each post-summary process segment folds at its normal boundaries. `todo` keeps its native display, separates surrounding processes, and stays outside `task process`, both before and after compaction.

Any pre-summary transcript still present in the current TUI, including archives provided by `pi-visible-scrollbar` 0.2.4, is grouped separately as `earlier history`. Expanded history replaces its left indentation with an accent-colored `│` rail without consuming additional content width. Each inner `task process`, consecutive-tool group, and individual result starts collapsed and can be expanded independently. `todo` remains native and outside `task process`; it is hidden with the collapsed earlier-history archive and visible when that archive is expanded. Archive content and Pi's native summary stay unchanged; input navigation remains available when history is expanded. Native spacing alone never creates an empty earlier-history group. Use `/earlier-history` to select or batch-toggle it without changing inner process or tool states.

Only the `task process` heading row gets a dedicated gold-brown background in dark themes and pale gold in light themes. Child backgrounds and native tool success/error colors are unchanged. Level three keeps its existing alignment; level-two thinking/tool groups add two columns of indentation, and level-one individual tools add four. Narrow terminals reduce indentation as needed.

Click the title or use `/task-process` to select and toggle a group. `/task-process expand` and `/task-process collapse` open or close all process groups without changing their inner tool expansion states.

Thinking is a level-two item using Pi's native label, mouse handling, and Ctrl+T—no extra thinking group or display policy. `todo` keeps its original renderer and is exempt from per-tool result hiding and line limits. Ctrl+O opens/closes process groups, tool groups, and tool results while leaving thinking in its native state. Process summaries list failure/running/output-save-failure counts, per-tool call counts, and thinking-block counts separated by commas, without a redundant total tool-call count; failed processes turn red.

Mixed assistant text/thinking messages are split at their native text boundaries; text never disappears with the process. If the host assistant layout is incompatible, that message retains its original display.

#### Notification rules

| Field | Behavior |
| --- | --- |
| Top-level / rule `enabled` | Optional, defaults to `true` |
| `rules` | Required array; `[]` allows every notice |
| `id` | Unique, non-blank string, at most 64 UTF-16 code units |
| `match.exact` / `match.contains` | Exactly one required, non-blank, case-sensitive; no regex |
| `match.type` | Optional `info`, `warning`, or `error` restriction |
| `action` | Required `hide` or `show` |

The first enabled matching rule wins. Put `show` exceptions before broader `hide` rules. Matching uses the full original text, including ANSI styling but excluding Pi's added `Warning:` / `Error:` prefix. Omitted levels match as `info`; pass-through preserves the original arguments.

Unknown fields, invalid values, duplicate IDs, or empty matches invalidate the entire configuration. Filtering and compact display stop rather than retaining old hiding rules. Fix the JSON and run `/notices reload`.

### Commands

| Command | Behavior |
| --- | --- |
| `/notices` | Browse the latest notices and select details; Escape cancels |
| `/notices off` | Pause notification filtering for this session; keep recording |
| `/notices on` | Enable notification filtering with valid configuration and an available notification hook |
| `/notices reload` | Reload all configuration and reset the notification switch to top-level `enabled` |
| `/tool-groups` | Choose a consecutive-tool group and toggle it |
| `/tool-groups expand` / `collapse` | Expand/collapse all consecutive-tool groups |
| `/task-process` | Select and toggle a level-three process group |
| `/task-process expand` / `collapse` | Expand/collapse all process groups |
| `/earlier-history` | Select and toggle the retained transcript before the compaction summary |
| `/earlier-history expand` / `collapse` | Expand/collapse all earlier-history groups |
| `/fold-all` | Re-scan the transcript and collapse all process groups, tool groups, and tool outputs |

Commands do not modify JSON. Configuration reload refreshes tool display immediately. Use Pi's `/reload` after changing extension code or installation paths.

### Privacy and limitations

- Up to 100 notices stay in memory only, never written to disk or sent to the model. Each retains at most 4096 UTF-16 code units; matching uses the full text. Details strip ANSI and some control characters.
- Management notices do not enter history. Configuration reload preserves history; Pi reload, session replacement, and exit clear it.
- Notification filtering supports TUI / RPC `ctx.ui.notify()`; tool folding targets TUI. Print/JSON modes without a UI are unaffected.
- Internal Pi notices, chat messages, permission dialogs, status bars, and desktop notifications are not filtered. Already displayed notices cannot be removed. Source-extension matching is unavailable.
- Native `!` / `!!` shell output is unaffected by per-tool limits and tool grouping, but collapses with `task process` when inside a process. Images are outside per-tool text limits but are hidden with a collapsed group and restored on expansion. Historical tools without an available renderer keep host per-tool rendering.
- Group folding depends on Pi's TUI layout; if attachment is unavailable, per-tool display and execution remain intact.
- Other extensions that replace or retain notification hooks may bypass filtering; other tool renderers may affect the final display. Future host API changes may require adaptation.
- Hiding a sandbox warning does not change its security policy. The extension's own UI text is currently Chinese; only this README is bilingual.

### License

[MIT](LICENSE) © 2026 LLC.
