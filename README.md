# pi-notice-control

[简体中文](#zh-cn) | [English](#en)

<a id="zh-cn"></a>

## 简体中文

为 [Pi](https://pi.dev/) 提供通知过滤和工具输出折叠：隐藏重复提醒，精简 `write` / `edit` / `bash` 的显示，并限制命令失败输出的高度。

仅改变显示，不修改工具执行、返回给模型的结果、沙箱权限或系统代理。不注册模型工具，无需额外运行时依赖。

### 功能

- 按通知原文进行全文或包含匹配，可附加 `info`、`warning`、`error` 等级条件；首条规则命中生效，未命中原样放行。
- 保留最近 100 条通知记录，支持临时暂停过滤、查看详情和重载 JSON。
- 工具折叠时，`write` / `edit` 只显示工具名和路径；`bash` 只显示命令首行，多行命令附带省略行数。
- 成功结果默认隐藏，也可配置最大显示行数；命令错误默认最多 5 行，保留 `Command exited with code N`。
- 展开工具后恢复原渲染器的完整显示；配置无效时停止过滤和精简，避免沿用旧的隐藏策略。

> 隐藏安全提醒不等于改变安全策略。示例只隐藏“允许所有域名”的通知，`allowedDomains: ["*"]` 仍然允许所有域名。

### 安装

要求 **Pi >=1.5.0**，所有功能均不支持更早版本。Pi 直接加载 TypeScript，无需单独构建。

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

合并到已有配置，不要覆盖其他扩展或设置。保留同目录的 `index.ts`、`rules.ts` 和 `tool-display.ts`；日常使用无需安装开发依赖。两种安装方式选一种，避免加载多个副本。

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
| `toolDisplay.maxLines` | `0` | 折叠时成功结果最多显示的行数；`0` 完全隐藏结果，只保留调用行 |
| `toolDisplay.collapseCommandErrors` | `true` | 是否折叠 `bash` / `powershell` 的失败输出；`false` 使用原渲染器显示错误 |
| `toolDisplay.errorMaxLines` | `5` | 折叠命令错误的最大行数；至少 `1`，设为 `1` 时有退出码就只显示退出码 |

- 行数必须是安全整数，按终端自动换行后的**实际显示行**计算。上限包含省略提示和退出码，不包含调用行及 Pi 外框留白。行数太少时优先显示正文或退出码，不额外显示省略提示；窄终端中退出码缩写为 `exit N`，其他单行可能被截短。
- 成功结果保留开头，shell 结果保留末尾；命令错误优先保留末尾，并固定显示已有的 `Command exited with code N`。超时、终止等没有退出码的失败保留末尾错误信息，不伪造退出码。
- 其他工具的错误不主动隐藏或限行；调用行保留原渲染器的参数显示。
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

命令不修改 JSON。修改配置用 `/notices reload`；工具设置在下一次渲染时应用，已显示的工具可切换展开状态刷新。修改扩展代码或安装路径请用 Pi 的 `/reload`。

### 隐私与限制

- 最近 100 条通知只保存在内存，不写磁盘、不发给模型。单条最多保留前 4096 个 UTF-16 码元，超出标记截断；规则仍匹配完整原文。
- 查看通知详情时移除 ANSI 样式及部分控制字符；管理提示不进入历史。`/notices reload` 保留记录，Pi `/reload`、会话替换或退出清空记录。
- 通知过滤支持 TUI / RPC 的 `ctx.ui.notify()`；工具折叠面向 TUI。无 UI 的 print/JSON 模式不接管。
- 不过滤 Pi 内部提示、聊天消息、权限确认框、状态栏或桌面通知，不移除已显示的通知。`notify()` 没有来源信息，不能按来源扩展匹配。
- 原生 `!` / `!!` 用户 shell 输出不是模型的 `bash` 工具调用，不在此折叠配置范围内。图片由 Pi 单独绘制，不受文本行数限制。没有可用工具渲染器的历史条目保持宿主显示。
- 其他扩展若提前保存或替换通知入口，可能绕过过滤；其他工具渲染器也可能影响最终显示。宿主接口变化时可能需要适配。
- 扩展自身的界面文案目前是中文；双语仅指本文档。

### 许可证

[MIT](LICENSE) © 2026 LLC。

---

<a id="en"></a>

## English

Notification filtering and compact tool output for [Pi](https://pi.dev/). Hide repetitive notices, simplify `write` / `edit` / `bash` calls, and bound failed-command output without changing tool execution, model results, sandbox permissions, or system proxies.

### Installation

Requires **Pi >=1.5.0** for all features; earlier versions are unsupported. No build or additional runtime dependency is required.

```sh
pi install git:github.com/llc2214926/pi-notice-control
```

Pi adds the package to your personal `settings.json`. To filter `pi-sandbox` startup notices, place this package before `npm:pi-sandbox` in `packages`.

For a local installation, add the absolute path to `index.ts` first in your personal `extensions` list. Keep `index.ts`, `rules.ts`, and `tool-display.ts` together. Choose one installation method and preserve existing settings.

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
    "collapseCommandErrors": true,
    "errorMaxLines": 5
  }
}
```

**Omitting `toolDisplay` preserves the old notification-only behavior.** An empty `toolDisplay` object enables the defaults above.

| Tool display field | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Enable compact tool rendering; `false` restores the original display |
| `maxLines` | `0` | Maximum collapsed success-result lines; `0` hides the result entirely |
| `collapseCommandErrors` | `true` | Fold failed `bash` / `powershell` results; `false` leaves errors to the original renderer |
| `errorMaxLines` | `5` | Maximum collapsed command-error lines; minimum `1` preserves the exit status when present |

Limits count **wrapped terminal rows**, including the omission hint and exit status, excluding the call header and Pi's outer padding. Values must be safe integers (`maxLines >= 0`, `errorMaxLines >= 1`). When space is tight, content or exit status takes priority over the omission hint. Narrow terminals abbreviate the status to `exit N`; other single lines may be shortened.

Collapsed `write` / `edit` calls show only the tool name and path. `bash` shows its first command line and an omitted-line count. Other calls keep their original parameter display. Success previews keep the beginning, shell previews keep the end. Failed commands pin an existing `Command exited with code N`; timeouts and other failures keep trailing error text without inventing an exit code. Other tools' errors are not additionally hidden or capped.

Expand with Ctrl+O (the default binding) or click one tool where mouse support is available. Expanded views use the original renderer without this extension's line cap. Model results and session records are unchanged; Pi's own truncation and full-output file references still apply.

The top-level `enabled` and `/notices on|off` control **notification filtering only**, independently of tool display.

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

Commands do not modify JSON. Tool settings apply on the next render; toggle an existing row's expansion to refresh it. Use Pi's `/reload` after changing extension code or installation paths.

### Privacy and limitations

- Up to 100 notices stay in memory only, never written to disk or sent to the model. Each retains at most 4096 UTF-16 code units; matching uses the full text. Details strip ANSI and some control characters.
- Management notices do not enter history. Configuration reload preserves history; Pi reload, session replacement, and exit clear it.
- Notification filtering supports TUI / RPC `ctx.ui.notify()`; tool folding targets TUI. Print/JSON modes without a UI are unaffected.
- Internal Pi notices, chat messages, permission dialogs, status bars, and desktop notifications are not filtered. Already displayed notices cannot be removed. Source-extension matching is unavailable.
- Native `!` / `!!` user shell output is not a model tool call and is not covered. Pi renders images separately from these text limits. Historical entries without an available tool renderer retain host rendering.
- Other extensions that replace or retain notification hooks may bypass filtering; other tool renderers may affect the final display. Future host API changes may require adaptation.
- Hiding a sandbox warning does not change its security policy. The extension's own UI text is currently Chinese; only this README is bilingual.

### License

[MIT](LICENSE) © 2026 LLC.
