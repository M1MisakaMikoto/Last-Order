# ADR 0013: Mission Control 独立服务与 VSCode 客户端

日期：2026-11-03

## 背景

TUI 同时承担界面和服务生命周期，无法让 VSCode 扩展自然接入。为了复用 Mission Control 的多 worker 状态和调度能力，前端必须成为客户端，而不是复制服务逻辑。

## 决定

- Mission Control 提供独立 Node 服务入口 `bin/mission-control.js`。
- 服务通过本机 token 保护的 HTTP control API 暴露状态、历史、消息、worker 控制、备注、审批和问题接口。
- 服务启动后发布 `.git/last-order/control.json`，包含 URL、token、PID、项目和配置信息。
- TUI 已迁移为 ServiceClient，通过 control API 附着或启动独立 Mission Control。
- VSCode 扩展是并行客户端，可自行启动服务或附着到已运行服务。
- VSCode 是单一产品入口：左侧 Mission Control 树，右侧辅助侧栏 Manager WebviewView 使用 xterm 承载现有 TUI，Worker monitor 使用编辑器区终端页签。虚拟终端 Host 转发 ANSI 输出和键盘输入，扩展不重写 Manager/Worker 对话 UI，并统一管理 Mission Control 生命周期及编辑器上下文、原生 diff、备注编辑、人工接管/交还、worktree 和 monitor。
- Mission Control 不运行在 VSCode extension host 内。

## 影响

- TUI 和 VSCode 可以共享同一个 Mission Control，而不需要复制状态。
- 扩展退出时默认停止自己启动的服务，也可以配置继续运行。
- TUI 的 `/quit` 只停止客户端，Mission Control 保持运行；`/shutdown` 才停止整个系统。
- 后续可增加 WebSocket/SSE、hunk 级 diff、接管/交还和 Remote SSH。
