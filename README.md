# pi-notice-control

[简体中文](#zh-cn) | [English](#en)

<a id="zh-cn"></a>

## 简体中文

为 [Pi](https://pi.dev/) 扩展通知提供规则过滤：隐藏已知的重复提醒，保留其他通知，并随时查看最近的处理记录。

只接管 `ctx.ui.notify()`，不修改 Pi 或 `pi-sandbox` 的源码，也不更改沙箱权限或系统代理。没有额外的运行时依赖，不注册模型工具。

### 功能

- 按通知原文进行全文匹配或包含匹配，可附加 `info`、`warning`、`error` 等级条件。
- 按顺序执行规则：第一条命中生效，未命中原样放行。
- 支持 `hide`（隐藏）和 `show`（放行），可临时关闭过滤或重新加载配置。
- 保留最近 100 条内存记录，包括时间、原文、等级、处理结果和命中规则。
- 配置无效或过滤异常时停止过滤，保留原通知并显示诊断。

> 隐藏安全提醒不等于改变安全策略。示例规则只隐藏“允许所有域名”的提示，`allowedDomains: ["*"]` 仍然允许所有域名。

### 安装

面向 **Pi >=1.5.0**，开发依赖固定 **1.5.2**；已在 **1.5.0、1.5.2** 和向后兼容目标 **1.4.0**、Node.js 24 上通过类型检查及本地回归。Pi 直接加载 TypeScript 扩展，无需单独构建。开发依赖的固定版本不是运行时版本上限。

#### 方式一：从 GitHub 全局安装（推荐）

仓库：[llc2214926/pi-notice-control](https://github.com/llc2214926/pi-notice-control)

```sh
pi install git:github.com/llc2214926/pi-notice-control
```

Pi 会管理仓库下载，并将包登记到个人 `settings.json` 的 `packages` 列表中，默认对所有项目生效，**不需要手动注册 `extensions`**。

如果需要隐藏 `pi-sandbox` 的启动提醒，请将 `git:github.com/llc2214926/pi-notice-control` 放在 `packages` 列表中 `npm:pi-sandbox` 之前，保留其余条目。安装后还需完成下面的规则初始化。

#### 方式二：本地目录安装与手动注册

适合本地开发，或需要早于包内扩展接管通知的场景。

1. 将仓库保存在固定目录，例如 `/absolute/path/to/pi-notice-control`。保留 `index.ts` 及同目录的 `rules.ts`；日常使用无需安装开发依赖。
2. 在个人 Pi 配置的 `extensions` 列表首位加入 `index.ts` 的绝对路径。默认配置文件为 `~/.pi/agent/settings.json`：

   ```json
   {
     "extensions": [
       "/absolute/path/to/pi-notice-control/index.ts"
     ]
   }
   ```

   请合并到已有配置，保留其他扩展、包和设置，不要整文件覆盖。

两种安装方式选一种即可，避免同时加载不同目录中的副本。不要移动或删除正在使用的本地安装目录。

#### 初始化规则（两种方式都需要）

1. 将[示例规则](notice-control.example.json)的内容保存到 `~/.pi/agent/notice-control.json`；也可使用下方“配置”中的完整 JSON。已有规则文件时，只合并需要的规则，不要直接覆盖。
2. 在 Pi 中运行 `/reload`，或重启 Pi。

`PI_CODING_AGENT_DIR` 会同时改变个人 `settings.json` 和 `notice-control.json` 所在的 agent 目录。扩展不会自动创建规则文件；文件缺失时会显示诊断并保持通知放行。

#### 启动顺序

必须在通知发出前安装过滤。Pi 1.5.0 / 1.5.2 按以下顺序解析扩展：

1. 命令行 `-e` 扩展。
2. 项目显式扩展，然后是项目自动发现的扩展。
3. 用户显式扩展，然后是用户自动发现的扩展。
4. 包内扩展，项目包先于用户包；同一作用域内按包列表顺序加载。
5. 内置扩展。

GitHub 安装属于包内扩展：将它放在 `pi-sandbox` 之前，可以处理后者的启动通知，但无法捕获更早的项目或用户显式、自动发现扩展的启动通知。本地手动注册的优先级更高，仍晚于项目扩展。

如果需要更早安装过滤，可将本地副本作为第一个 `-e` 参数：

```sh
pi -e /absolute/path/to/pi-notice-control/index.ts
```

不要仅依赖 `00-` 文件名前缀；包列表顺序只能控制同一作用域的包，不能改变上述来源优先级。

### 命令

| 命令 | 作用 |
| --- | --- |
| `/notices` | 查看最近通知，最新的在前；选中后显示记录详情 |
| `/notices off` | 本次会话暂停过滤，仍然记录通知 |
| `/notices on` | 本次会话开启过滤，需要有效配置和已安装的拦截入口 |
| `/notices reload` | 重读规则，并用配置中的 `enabled` 重置临时开关 |

按 Escape 取消选择。`/notices on` 和 `/notices off` 不修改配置文件。修改规则用 `/notices reload`；修改扩展源码或安装路径用 Pi 的 `/reload`。

### 配置

只读取个人 agent 目录中的 `notice-control.json`，不读取项目规则，以免仓库配置自行屏蔽安全提醒。使用严格 JSON，不支持注释。

默认示例只隐藏这条沙箱通知：

```json
{
  "enabled": true,
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

| 字段 | 说明 |
| --- | --- |
| `enabled` | 顶层总开关或单条规则开关，可省略，默认 `true` |
| `rules` | 必填数组；空数组表示全部放行 |
| `id` | 必填、唯一、非空白字符串，长度不超过 64 个 UTF-16 码元 |
| `match.exact` | 与整条原文完全相同，区分大小写 |
| `match.contains` | 原文包含指定文字，区分大小写 |
| `match.type` | 可选，限定为 `info`、`warning` 或 `error` |
| `action` | 必填，只允许 `hide` 或 `show` |

匹配行为：

- `exact` 和 `contains` 必须且只能设置一个，不能是空白文字。暂不支持正则表达式。
- 规则按数组顺序匹配，禁用规则跳过。需要保留例外时，将 `show` 规则放在更宽泛的 `hide` 规则之前。
- 未传等级的通知按 `info` 匹配；放行时仍保留调用方的原始参数。
- 匹配完整原文，不包括 Pi 渲染时追加的 `Warning:` 或 `Error:` 前缀，不自动移除 ANSI 样式。
- 未知字段、无效值、重复 ID 或空匹配会使整份配置失效，而不是部分应用。
- 配置缺失、解析失败或过滤异常时停止过滤。修复后运行 `/notices reload`。

### 记录与隐私

- 同时记录隐藏和放行的通知；每个扩展运行时最多保留 100 条，超过后淘汰最旧记录。
- 单条原文最多保留前 4096 个 UTF-16 码元，超出部分标注截断；规则匹配仍使用截断前的完整文字。
- 记录只在内存中保存，本扩展不将其写入磁盘或发送给模型。主动查看详情会在 Pi 界面显示该记录。
- 记录详情会移除 ANSI 样式及部分控制字符；本扩展的管理提示不再进入记录，避免递归。
- `/notices reload` 不清空记录；Pi 的 `/reload`、新建或切换会话、退出会清空记录。

### 兼容性与限制

- 当前包装宿主共享、可写的 `ctx.ui.notify`，已验证 Pi 1.5.0 / 1.5.2，并保留 1.4.0 兼容。这不是官方通知中间件接口；不锁定补丁版本，但未来宿主改变此契约时仍需重新适配。
- 支持 TUI 与 RPC 的通知接口；无 UI 的 print/JSON 模式不安装拦截。
- 不处理 Pi 内部直接渲染的提示、聊天消息、工具结果、权限确认框、状态栏或桌面通知，也不移除已经显示的提示。
- `notify()` 没有传递来源扩展信息，因此不提供按来源匹配。
- 清理时不覆盖其他扩展后来安装的包装；其他扩展如果直接替换入口或提前保存旧引用，仍可能绕过过滤。
- **扩展自身的界面文案目前是中文。双语仅指本文档，不代表已实现界面语言切换。**

### 开发与验证

开发时安装依赖并检查类型：

```sh
npm install
npm run check
```

本地已有测试文件时，可使用 Node.js 24 运行：

```sh
npm test
```

`tests/` 中的测试及夹具只在本地保留，不暂存、不提交、不分发，因此普通克隆不会包含这些文件。`.local/` 中的验证产物和 `node_modules/` 同样被忽略。

现有本地验证覆盖 15 项检查，包括匹配、透传、开关、重载、历史上限、会话清理及原始沙箱通知函数的调用。集成验证使用真实 Pi 扩展运行器，并确认接管后目标通知隐藏、其他警告保留。

验证环境的沙箱拒绝嵌套 Unix socket，因此没有在其中完成另一层 `pi-sandbox` 的完整启动测试，也没有绕过限制。完整 TUI 启动效果仍需在正常 Pi 会话中确认。

### 许可证

[MIT](LICENSE) © 2026 LLC。

---

<a id="en"></a>

## English

Rule-based notification filtering for [Pi](https://pi.dev/) extensions: hide known, repetitive notices, preserve other notifications, and inspect recent filtering decisions.

The extension only wraps `ctx.ui.notify()`. It does not modify Pi or `pi-sandbox` source code, change sandbox permissions or system proxies, add runtime dependencies, or register model-callable tools.

### Features

- Match the full notification text or a substring, optionally restricted to `info`, `warning`, or `error`.
- Evaluate rules in order: the first match wins, and unmatched notifications pass through unchanged.
- Use `hide` and `show` actions, pause filtering for the current session, and reload configuration.
- Keep the latest 100 notifications in memory, including timestamps, text, levels, decisions, and matching rules.
- Stop filtering and display a diagnostic when configuration is invalid or filtering fails, preserving the original notifications.

> Hiding a security warning does not change the security policy. The example rule only hides the “all domains allowed” notice; `allowedDomains: ["*"]` still allows all domains.

### Installation

Targets **Pi >=1.5.0**, with development dependencies pinned to **1.5.2**. Type checks and local regressions pass on **1.5.0, 1.5.2**, and the backward-compatibility target **1.4.0**, using Node.js 24. Pi loads TypeScript extensions directly; no separate build is required. The development pin is not a runtime upper-version limit.

#### Option 1: Global installation from GitHub (recommended)

Repository: [llc2214926/pi-notice-control](https://github.com/llc2214926/pi-notice-control)

```sh
pi install git:github.com/llc2214926/pi-notice-control
```

Pi manages the repository download and adds the package to the `packages` list in your personal `settings.json`. Installation is global by default, applying across projects; **no manual `extensions` registration is needed**.

To hide the `pi-sandbox` startup warning, place `git:github.com/llc2214926/pi-notice-control` before `npm:pi-sandbox` in the `packages` list, preserving the other entries. After installation, complete the rules setup below.

#### Option 2: Local directory and manual registration

Use this for local development or when filtering must be installed before package extensions.

1. Keep the repository in a stable directory, such as `/absolute/path/to/pi-notice-control`. Keep `index.ts` and `rules.ts` together. Normal use does not require installing development dependencies.
2. Add the absolute path to `index.ts` as the first entry in your personal Pi `extensions` list. The default settings file is `~/.pi/agent/settings.json`:

   ```json
   {
     "extensions": [
       "/absolute/path/to/pi-notice-control/index.ts"
     ]
   }
   ```

   Merge this entry into your existing configuration. Preserve other extensions, packages, and settings; do not replace the whole file.

Choose one installation method to avoid loading copies from different directories. Do not move or delete a local installation directory while it is in use.

#### Rules setup (required for both methods)

1. Save the contents of the [example rules](notice-control.example.json) as `~/.pi/agent/notice-control.json`, or use the complete JSON in the Configuration section below. If a rules file already exists, merge only the rules you need rather than overwriting it.
2. Run `/reload` in Pi, or restart Pi.

`PI_CODING_AGENT_DIR` changes the agent directory containing both your personal `settings.json` and `notice-control.json`. The extension does not create the rules file automatically. If it is missing, a diagnostic is displayed and notifications remain visible.

#### Startup order

Filtering must be installed before a notification is emitted. Pi 1.5.0 / 1.5.2 resolves extensions in this order:

1. Command-line `-e` extensions.
2. Explicit project extensions, followed by auto-discovered project extensions.
3. Explicit user extensions, followed by auto-discovered user extensions.
4. Package extensions, with project packages before user packages; packages within the same scope follow their list order.
5. Built-in extensions.

A GitHub installation is a package extension. Placing it before `pi-sandbox` lets it handle that package’s startup notices, but not earlier notices from explicit or auto-discovered project or user extensions. Manual local registration has higher priority, but still runs after project extensions.

For earlier interception, supply a local copy as the first `-e` argument:

```sh
pi -e /absolute/path/to/pi-notice-control/index.ts
```

Do not rely solely on a `00-` filename prefix. Package list order only controls packages within the same scope; it does not override the source priorities above.

### Commands

| Command | Behavior |
| --- | --- |
| `/notices` | Browse recent notifications, newest first; select one to display its details |
| `/notices off` | Pause filtering for this session while continuing to record notifications |
| `/notices on` | Enable filtering for this session; requires valid configuration and an installed wrapper |
| `/notices reload` | Reload rules and reset the temporary switch to the configured `enabled` value |

Press Escape to cancel the selector. `/notices on` and `/notices off` do not modify the configuration file. Use `/notices reload` after changing rules, and Pi’s `/reload` after changing extension code or its installation path.

### Configuration

The extension reads only `notice-control.json` in your personal agent directory. It does not read project-level rules, preventing repository configuration from silently suppressing security notices. Use strict JSON without comments.

The default example hides only this sandbox notice:

```json
{
  "enabled": true,
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

| Field | Description |
| --- | --- |
| `enabled` | Optional global or per-rule switch; defaults to `true` |
| `rules` | Required array; an empty array allows every notification through |
| `id` | Required, unique, non-blank string of at most 64 UTF-16 code units |
| `match.exact` | Case-sensitive match against the entire original message |
| `match.contains` | Case-sensitive substring match against the original message |
| `match.type` | Optional restriction to `info`, `warning`, or `error` |
| `action` | Required; either `hide` or `show` |

Matching behavior:

- Specify exactly one of `exact` and `contains`, using non-blank text. Regular expressions are not supported.
- Rules are evaluated in array order, skipping disabled rules. Put a `show` exception before a broader `hide` rule to keep that notification visible.
- A notification without an explicit level is matched as `info`; pass-through preserves the caller’s original arguments.
- Matching uses the complete original text, without Pi’s rendered `Warning:` or `Error:` prefix. ANSI formatting is not stripped before matching.
- Unknown fields, invalid values, duplicate IDs, and empty matches invalidate the entire configuration rather than applying it partially.
- Missing configuration, parse errors, or filtering errors stop filtering. Fix the problem and run `/notices reload`.

### History and privacy

- Hidden and visible notifications are both recorded. Each extension runtime retains up to 100 entries, evicting the oldest when full.
- Each message retains at most its first 4096 UTF-16 code units, with a truncation marker when needed. Rules still match against the complete, untruncated message.
- History stays in memory. This extension does not write it to disk or send it to the model. Selecting an entry displays its details in Pi’s UI.
- Detail views remove ANSI formatting and some control characters. The extension’s own management notices do not enter history again, avoiding recursion.
- `/notices reload` keeps history. Pi’s `/reload`, creating or switching sessions, and exit clear it.

### Compatibility and limitations

- The implementation wraps the host's shared, writable `ctx.ui.notify`, verified on Pi 1.5.0 / 1.5.2 with 1.4.0 compatibility retained. This is not an official notification middleware API. No patch-version pin is enforced, but future changes to this contract may require adaptation.
- TUI and RPC notification interfaces are supported. No wrapper is installed in print/JSON modes without a UI.
- It does not filter notices rendered directly by Pi internals, chat messages, tool results, permission dialogs, status bars, or desktop notifications. It cannot remove notices already displayed.
- `notify()` provides no source-extension metadata, so matching by source is not supported.
- Cleanup preserves wrappers installed later by other extensions. An extension that replaces the entry point or retains an older `notify` reference may bypass filtering.
- **The extension’s own UI text is currently Chinese. This bilingual README does not imply a UI language-switching feature.**

### Development and validation

Install development dependencies and check types:

```sh
npm install
npm run check
```

If the local test files are available, run them with Node.js 24:

```sh
npm test
```

Tests and fixtures under `tests/` are local-only: they are not staged, committed, or distributed, so a normal clone does not include them. Verification artifacts under `.local/` and `node_modules/` are also ignored.

Existing local validation covers 15 checks, including matching, pass-through, switches, reloads, history limits, session cleanup, and calls to the original sandbox notification function. Integration validation uses Pi’s actual extension runner and confirms that the target notice is hidden while other warnings remain visible.

The validation environment blocks nested Unix sockets, so a complete nested `pi-sandbox` startup was not tested, and no sandbox restrictions were bypassed. Full TUI startup behavior still needs confirmation in a normal Pi session.

### License

[MIT](LICENSE) © 2026 LLC.
