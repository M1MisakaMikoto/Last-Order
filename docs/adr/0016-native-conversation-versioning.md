# ADR 0016: 优先接入 Provider 原生会话版本

日期：2026-11-04

## 背景

Codex app-server 已提供原生 `thread/turns/list`、`thread/fork`、`thread/revert` 和 `thread/resume`。Last Order 不应复制 provider 已经维护的对话历史。

## 决定

- Provider adapter 通过统一方法暴露原生会话版本能力：
  - `listTurns`
  - `forkThread`
  - `revertThread`
- Mission Control 增加统一的 conversation version 协调层：
  - `listConversationTurns(actor)`
  - `forkConversation(actor, options)`
  - `revertConversation(actor, options)`
- Control API 增加 `/conversation/turns`、`/conversation/fork`、`/conversation/revert`。
- Codex 原生 `thread/fork` 会得到新 thread id，并更新对应 manager/worker 的 `sessionId`。
- Codex `thread/revert` 只修改对话历史，不恢复本地文件；文件恢复仍由 Last Order workspace checkpoint 负责。
- Provider 不支持某个方法时返回明确错误，不用静默 fallback。

## 影响

- Last Order 不再为 Codex 自建 conversation DAG。
- Workspace snapshot 与 native turn/thread id 已由 checkpoint 记录关联；worker snapshot 使用隐藏 refs 保留，restore 可恢复文件并 fork 原生对话。
- Claude Code、OpenCode 和 DSH 继续按各自能力逐步接入。
