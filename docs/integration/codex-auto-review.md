# Codex 原生自动审批联调

日期：2026-11-03。使用现有本机 Codex 配置，实际调用模型和原生自动审批器。

- `node scripts/probe-codex.js`：创建临时线程并确认返回 `approvalsReviewer: "auto_review"`，未启动模型轮次。
- `node scripts/probe-codex-approval.js`：在 `.tmp/auto-review-F6sQX3` 隔离仓库中，让真实 worker 通过原生审批执行一次空 Git 提交。
- 审批器返回 approved（low risk / high authorization），Git 命令退出码 0，提交为 `d7bc865`；没有人工审批请求。
- 联调发现 Codex 同时通过 `guardianWarning` 发布自动批准摘要。已将这种明确的成功通知归入过程日志；拒绝与未知警告仍直接显示。
- 新建和恢复 worker 线程默认启用自动审批；manager 只读权限、手动模式和请求映射由自动化测试覆盖。

原始结果见 [codex-auto-review.json](codex-auto-review.json)。
