# ADR 0010: Mission Control 独立 worker 任务与 manager 备注

日期：2026-11-03

## 背景

链表管线适合预先明确的固定阶段，但实际工作中经常存在同一模块的连续改造：后一项需求依赖前一位 worker 的结果，且中间需要 manager 根据完成情况重新判断下一步。自动推进链条会把这些决策固化在注册时，增加 manager 心智负担。

## 决定

- 中央服务正式命名为 Mission Control。
- 向 manager 取消 `register_pipeline`，改为 `start_worker` 启动独立 worker 任务。
- 新增 `update_worker_notes`：备注只供 manager 自己使用，不发送给 worker。
- worker 完成、失败或阻塞时，Mission Control 回调 worker 状态、结果、提交版本和备注。
- manager 在回调后决定下一步；有先后依赖时，通过 `input_worker_id` 从上一 worker 的提交启动新 worker。
- 互不依赖的 worker 仍可并行。
- 内部单阶段任务记录继续复用现有 worktree、Git 交付、审批、恢复和 SQLite 持久化能力。

## 影响

- manager 的排序和检查策略不再预先固化为自动阶段链。
- 备注必须持久化，并在完成/失败通知中完整返回。
- 回调后是否启动下一 worker 由 manager 决定。
- 旧版链表 API 保留为内部兼容实现，但不再暴露给 manager；后续可在数据迁移完成后删除。
