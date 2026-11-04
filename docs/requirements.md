# Last Order 需求记录

更新日期：2026-11-04。状态：核心服务、TUI、VSCode 安装版和 Codex 真实模型闭环已验证。

## 产品与命名

- 产品与项目名称按使用限制分级：人类可见名称优先 `Last Order`；必须无空格时使用 `last-order`；只有冻结的兼容标识使用 `last-order` / `Last Order`。
- VSCode `displayName`、视图标题和命令标题使用 `Last Order`；扩展 `name`、命令 ID、npm 包名、CLI、目录和环境变量按各自限制使用 slug。
- 已安装 VSCode 扩展标识 `local.last-order-vscode` 为兼容历史安装保持冻结，不随显示名变化。
- Mission Control：Last Order 内部的项目级调度、状态和 worker 管理服务。
- CLI 主入口：`bin/last-order.js`，命令为 `last-order` / `lo`。
- 数据目录：`.git/last-order`。
- Worker worktree：`.last-order-workspaces`。
- 分支：`last-order/worker/*`、`last-order/delivery/*`。

## 核心目标

- 一个 manager 对用户负责，理解需求、拆解任务、调度 worker、处理回调并汇报。
- worker 执行实现、验收、集成或只读探索任务。
- 任务、消息、通知、审批和状态由 Mission Control 持久化。
- manager 不直接修改项目文件，不自行执行实现或验收。

## Provider

支持 Claude Code、Codex、DeepSeek Harness 和 OpenCode。每个 staff 可配置 provider、model 和 effort。

## Worker 类型

- `implement`：实现用户要求的功能或修复。
- `review`：独立验收，不得修复实现；失败时必须提供证据。
- `integrate`：处理分支或交付冲突。
- `explore`：只读仓库探索、架构梳理、工具链和 test/CI 现状调研；不要求提交，不创建交付分支，结果通过 summary/evidence 回传。

manager 可把仓库探索和概念调研委派给 explore worker，避免长时间由 manager 自己执行命令。

## Mission Control 任务模型

- manager 通过 `start_worker` 启动一个独立 worker 任务。
- 互不依赖的任务可以并行；依赖任务必须等待前一个成功。
- `input_worker_id` 使新 worker 从上一个 worker 的提交继续。
- manager-only notes 通过 `update_worker_notes` 修改，只在完成/失败回调中返回。
- worker 必须调用 `report_result`；进程退出不能隐式视为成功。
- worker 完成、失败、提问或静默时通知 manager。

## TUI

- Manager 和 Workers 两个主界面；Workers 同时显示列表和详情。
- 支持对话、工作区、Git、审批、问题、monitor、settings、checkpoint 和原生会话命令。
- 对话文本支持 Markdown 渲染：标题、粗体、斜体、行内代码、代码块、列表、引用和链接；链接使用 OSC 8，xterm 点击后交给 VSCode 打开。
- 输入框维护 Unicode 光标位置。
- 输入非空时 `←/→` 移动光标，`Home/End` 到行首/行尾。
- `Shift+←/→` 选择输入内容，`Ctrl+A` 全选，`Ctrl+C` 优先复制输入选区。
- 输入、粘贴、Backspace、Delete 可替换当前选区。
- 长输入按显示宽度软换行，输入区动态占用多行。
- Enter 始终执行当前输入或提交消息；Ctrl+Enter 在输入框内插入硬换行。Tab 单独负责补全填入，避免无参数命令被 Enter 补全阻塞。
- TUI 启用 bracketed paste；多行粘贴作为一次 input insertion 处理，不经过 Enter/Return keypress，因此不会误发送。VSCode xterm 原生粘贴也覆盖该路径。
- Manager 忙碌时，新消息进入独立的“排队发送”列表，不混入普通对话；开始处理后自动移出队列并回到正常对话时间线。
- Manager 主界面只显示用户与 Manager 的对话；worker 工具调用、后台检查、内部通信不会混入消息区。顶部状态行展示 Manager 阶段、活动/排队/等待/完成 worker 数、用户待处理消息和 worker 回调数。
- Manager 与用户对话期间到达的 worker 回调不会抢占当前 turn，而是保留在通知队列中，在当前 turn 结束后自动进入下一轮。
- `/memory new`（别名 `/memory clear`）停止当前 Manager runtime 并清除 manager.sessionId/lastTurnId，使下一条消息创建新的 native Codex thread。AGENTS、managerPrompt、Mission Control 状态、worker、checkpoint 和审计事件均保留；旧 thread 只是不再被 Last Order 引用。
- Manager 消息按 `memoryEpoch` 分区；`/memory new` 后消息区只显示新 epoch 的对话，旧消息仍保留在审计事件中。
- `Ctrl+Tab` 切换 Manager/Workers；Tab 只用于命令补全，不再负责页面切换。VSCode 注册了相同快捷键并转发给虚拟 TUI。
- VSCode Webview 在 window capture 阶段拦截 `Ctrl+Tab`，并兼容 `event.key`/`event.code`；Webview 聚焦时设置 `missionControl.managerFocus` context key，keybinding 同时匹配该键、`webviewId`、`focusedView` 和 `activeWebviewPanelId`。
- Workers 或辅助面板中按 Esc 自动返回 Manager 页面；补全打开时 Esc 仍先关闭补全。
- 顶部状态栏不再显示 provider/model/staff 信息；单行合并显示 Manager 阶段、待处理任务数和正在工作的 Worker 数。
- 页面标题只显示 `Last Order · Manager` 或 `Last Order · Workers`。
- `/interrupt` 可无参数执行，只停止 Manager 当前 turn，不发送消息、不自动重试 active 请求；保留未处理排队消息，下一条用户消息到达后继续。
- Ctrl+↑/↓ 逐行滚动，Shift+↑/↓ 跳到顶部/底部；滚轮等同 Ctrl+↑/↓，只滚动当前对话或详情，不改变 worker 选择和输入历史。
- Home/End 只控制输入框光标，不再滚动内容。
- 单次 Ctrl+C 永不退出；退出使用 `/quit`、`Ctrl+D` 或 `/shutdown`。
- `/reload` 在 CLI 中由 supervisor 重启新的 Last Order Node 进程；在 VSCode 中停止 Mission Control 后自动执行 Reload Window，重新加载扩展代码、manifest、图标和 bundled backend，并自动重新打开 Manager。
- TUI 原生选区复制和应用层选区复制都必须过滤消息边框。

## 原生会话版本

- Codex 接入 `thread/turns/list`、`thread/fork`、`thread/revert` 和 `thread/resume`。
- 支持列出 native turns、从 turn fork、回退 native 对话历史。
- Codex revert 只修改对话历史，文件恢复由 Last Order checkpoint 负责。
- Claude Code、OpenCode 和 DSH 按各自原生能力继续接入。

## Unified Skills

- Last Order 维护 provider-neutral Skill Registry，扫描 repo/user 下的 `.agents/skills`、`.claude/skills`、`.codex/skills` 以及 Codex system skills。
- Skill 列表常驻上下文只包含 name、description、scope 和 path，不主动加载所有 SKILL.md。
- 用户输入 `$skill-name` 时，Last Order 明确选中该 skill，并把完整 SKILL.md 注入 Manager prompt。
- Manager/Worker 可通过 `use_skill(name)` 工具按需加载完整 skill 指令。
- Skill 选择不依赖 Codex/Claude 等载体的原生命令系统，用户不需要关心 Manager provider。
- TUI `/skills` 查看统一 registry；输入 `$` 动态补全已安装 skills。

## Worker Completion Reporting

- `worker_finished` 与 `worker_failed` 被视为用户可见的前台通知，不再把 Manager 的完成汇报自动标为 background。
- Manager 系统规则要求每次完成/失败回调都做出明确的用户汇报决策：要么汇报结果、证据、行为变化和风险，要么明确说明为什么不需要用户操作。
- Manager 可通过 `inspect_worker_history(worker_id, before_seq, limit, types)` 分页读取 worker 事件历史。

## Worker Archiving

- Worker 列表默认隐藏已归档 worker；`/workers all` 一次性显示全部 worker，返回 Manager 后恢复默认隐藏。
- `/archive [worker_id]` 允许用户手动归档已停止 worker；归档后禁止 message、resume、retry，并保留历史、结果、commit 和证据。
- Worker 不会自动归档。
- 默认无自定义 staff 指导时，Manager 亲自处理需求澄清、范围协商、歧义消解、用户决策、验收标准和持续交互；自包含的探索、明确需求实现、独立审查、验证和集成交给 Worker。
- Manager 在 worker 完成后必须询问用户是归档该 worker 还是提供新需求；只有用户明确确认后才能调用 `archive_worker`。

## Markdown Includes

- 消息支持显式文件片段指令：`{{include path="src/app.ts" lines="10-30" lang="ts"}}`。
- Include 仅允许项目根目录内的普通文本文件，拒绝绝对路径、目录、越界路径、symlink 逃逸、二进制文件和超大文件。
- 展开结果保存为 fenced code block，并记录相对路径、实际行号和内容 SHA-256 前缀；生成后固定写入事件，避免渲染时内容漂移。

## Checkpoint

- Checkpoint 同时保存 manager/worker native session/turn 引用和 worker worktree snapshot。
- 使用隐藏 ref 保留 snapshot commit。
- 可只恢复文件、只 fork 对话，或联合恢复。
- TUI 命令：`/checkpoint`、`/checkpoints`、`/restore`、`/turns`、`/fork`、`/revert`。
- VSCode 命令：`Last Order: Create Checkpoint`、`Last Order: Restore Checkpoint`。

## Git 安全与自动初始化

- Last Order 自动为 Git 命令注入精确的 `-c safe.directory=<cwd>`，不修改全局 Git 配置。
- 空目录、已有文件的非 Git 目录和 unborn 仓库都可自动初始化。
- 初始化创建空 main 基线，用户文件通过临时 index 进入 working-tree snapshot。
- 用户文件不进入 main 提交，也不修改真实暂存区。
- dirty working tree snapshot 不改变原分支、原 index 或原文件。
- 每个 worker 使用独立 worktree 和分支，交付不自动 merge 到用户分支。

## VSCode

- VSCode 是单一产品入口，统一管理 Mission Control 生命周期。
- 左侧 Activity Bar 提供 worker 树。
- 右侧辅助侧栏使用 xterm WebviewView 承载现有 TUI。
- Worker monitor 使用编辑器区终端页签。
- 扩展包含内置 backend，可作为 VSIX 安装。
- 支持编辑器上下文、原生 diff、worker notes、接管/交还、checkpoint 和 monitor。

## 安全与权限

- manager 使用只读限制。
- Codex explore worker 使用只读 sandbox；Claude explore worker 禁止 Edit/Write/Notebook/Agent/Task。
- 原生审批请求必须由用户或配置的自动审批策略处理，不能绕过。
- worker 不得调用 manager 工具。

## 验证

- 当前自动化测试：119 项。
- 覆盖 adapter 映射、原生审批、任务回调、并发、恢复、Git worktree、checkpoint、输入编辑、VSCode control API 和 VSIX backend。
- Codex 已完成真实 manager、实现 worker、独立验收 worker、审批、恢复和交付闭环。

## 当前限制

- hunk 级文件应用/回滚尚未实现。
- Linux、Remote SSH 和正式签名/发布流程尚未完成。
- Claude Code、OpenCode、DSH 的原生 fork/checkpoint 能力尚未全部接入。
- Codex native fork/revert 目前只有协议夹具验证，尚未进行真实模型 turn 联调。
- 外部系统副作用无法通过 checkpoint 回滚。

## 相关文档

- [系统设计](architecture.md)
- [术语表](glossary.md)
- [ADR](adr/)
- [Codex 真实联调](integration/codex-live.md)
