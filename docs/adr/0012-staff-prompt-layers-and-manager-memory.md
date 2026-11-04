# ADR 0012: Staff 提示词分层与 Manager AGENTS.md 记忆

日期：2026-11-03

## 背景

manager/worker 需要可配置的工作偏好，但代码中的角色边界、安全规则和权限约束不能被用户配置覆盖。同时，用户会要求 manager 长期记住某些习惯或工作流程，这需要持久化且可追踪的记忆，而不是塞进每轮对话或项目源码。

## 决定

- 默认 staff：manager/worker 均使用 `codex`、`deepseek-flash`、`high`。
- 代码生成的角色、安全和权限规则作为固定系统提示词。
- `managerPrompt` 和 `workerPrompt` 作为用户可编辑 staff 提示词，追加到对应 runtime 指令，并明确标注从属于系统规则。
- Mission Control 的 `inspect`/prompt payload 暴露 `prompt_config`，manager 可以读取当前 staff 提示词和记忆路径。
- manager 在用户要求记住习惯、规范或流程时调用 `remember_manager_guidance`。
- 记忆写入 `.git/last-order/AGENTS.md`，不修改项目源码或项目根目录 AGENTS.md。
- manager AGENTS.md 与固定系统提示词、managerPrompt/workerPrompt 明确分区。

## 影响

- 人工配置和 manager 记忆都不会静默覆盖安全与角色规则。
- 用户可通过 `/settings` 编辑 staff 提示词，通过 `/reload` 应用。
- manager 记忆位于项目内部但属于 Mission Control 数据目录，不进入业务工作树。
