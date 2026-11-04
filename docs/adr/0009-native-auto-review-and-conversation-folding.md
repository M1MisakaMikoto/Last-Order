# ADR 0009：Codex 默认自动审批与对话过程折叠

- 日期：2026-11-03
- 状态：已接受并实现
- 依据：用户要求 Codex 默认使用 Approve for me；不直接关联用户消息的过程默认折叠，相邻过程成组。

## 决定

Codex worker 的新会话与恢复会话使用 `approvalPolicy: "on-request"` 和 `approvalsReviewer: "auto_review"`。通过原生审批器决定是否允许操作，保留 `workspace-write` 沙箱。manager 保留只读角色与拒绝提权的行为。提供 `--codex-approvals user|auto_review` 并持久化项目选择；既有配置缺少此字段时默认自动审批。其余 CLI 保持原有权限流程。

自动审批的开始与通过结果记入过程日志；拒绝、超时、失败与原生警告作为可见错误显示。仍交给客户端的交互请求继续通过 TUI 处理。

对话按事件构建连续过程组。工具调用、命令输出、worker 进度事件，以及仅由后台通知触发的 manager 进度回复默认折叠。manager 处理轮次记录后台来源，避免依靠消息文字猜测。用户输入、正式答复、最终交付、问题与错误保持可见。`F5` 控制当前对话的全部过程，`/expand N` 和 `/collapse N` 控制单组；不改变持久化日志。

## 依据与验证

- [OpenAI 官方权限文档](https://developers.openai.com/codex/agent-approvals-security#automatic-approval-reviews)
- [OpenAI 配置参考](https://developers.openai.com/codex/config-reference#approvals_reviewer)
- 本机 app-server JSON Schema：`ApprovalsReviewer` 支持 `auto_review`；原生线程初始化返回该设置。
- 自动化覆盖新建/恢复会话、manager 权限、审批结果展示、后台来源、连续分组、展开状态与问题/错误可见性。
