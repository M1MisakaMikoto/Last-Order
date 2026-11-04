# ADR 0001：以 schedule_table_service 作为中央信息管理服务

- 日期：2026-11-02
- 状态：已确认中央服务方向；具体边界待澄清
- 依据：用户明确要求“schedule_table_service 作为中央服务管理信息”。

## 背景

manager 需要委派任务、记录 worker、注册完成回调并检查执行结果。用户还需要在 TUI 查看全部 worker 的状态，以及某个 worker 的对话、工作区和 Git 改动。这些视图和调度动作需要一致的信息来源。

## 已确定的决定

使用名为 `schedule_table_service` 的中央服务管理信息。manager 的 schedule-table 工具和 worker 状态界面围绕这一服务设计。

manager 负责对用户交付、调度和初步验收；worker 负责具体实现。

后续已确认服务随 TUI 启停，见 ADR 0002；worker 各用独立 Git worktree 和分支，见 ADR 0003。

## 尚未确定

- 服务的具体进程布局；生命周期已经确定随 TUI 启停。
- 进程管理、事件持久化、工作区管理、Git 查询是否全部由此服务承担。
- TUI 与服务、CLI 与服务、manager 工具与服务之间的协议。
- 存储、消息投递语义、恢复策略、访问控制和实现技术栈。

## 设计约束

实现时必须明确 worker 执行完成和 manager 验收通过的区别，并能将 worker 完成的消息传递给 manager。具体事件模型和可靠性机制在后续 ADR 中确定。
