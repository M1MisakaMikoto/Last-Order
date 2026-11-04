# 术语表

更新日期：2026-11-02。未确认的术语边界在说明中标注。

| 术语 | 当前含义 |
| --- | --- |
| Last Order | 本产品与项目名称；CLI 主命令为 `last-order` / `lo`。 |
| TUI | 终端中的交互界面，承载用户对话和 worker 状态查看。 |
| Agent 载体 / Provider | 实际运行 agent 的 CLI 工具：Claude Code、Codex、DeepSeek Harness CLI（dshcli）或 OpenCode；具体接入协议待验证。 |
| Staff | Manager 和 worker 运行时的统称；每个 staff 配置包含 provider、model 和 effort。 |
| Manager | 接收用户请求、决定 worker 任务顺序、编写自用备注、处理完成回调与阻塞并向用户汇报的 agent；可读代码和看结果，实现、验收执行和集成均委派给 worker。 |
| 默认 Worker | 未单独指定时，用于执行委派任务的 agent 类型；不是指系统只能运行一个 worker。 |
| Worker 实例 | 一次受管理的 agent 执行实例；与任务、进程和可恢复会话的对应关系待确认。 |
| 集成 Worker | manager 委派的、负责集成各 worker 改动、解决冲突并验证的 worker 职责；是否复用已有 worker 实例待设计。 |
| 验收 Worker | 根据 manager 的要求执行验收的 worker；与实现职责分开，发现问题提供证据并交由实现 worker 返工，不自行代替实现 worker 修复。 |
| 对抗性验收 | worker 按 manager 的要求检查实现；未通过时提供证据，再由 manager 安排实现 worker 返工与验收 worker 复验。主动寻找反例、遗漏和失败路径属于建议，具体标准待明确。 |
| Staff 提示词 | managerPrompt/workerPrompt 配置，由用户人工编辑并追加到对应 staff 指令，但不覆盖代码系统规则。 |
| Manager 记忆 | Mission Control 在 `.git/last-order/AGENTS.md` 保存的 manager 专属长期工作习惯和规范，由 remember_manager_guidance 写入。 |
| Worker 任务 | manager 通过 Mission Control 启动的一次独立 worker 执行；不自动推进到下一任务。有关联的任务由 manager 在完成回调后使用 `input_worker_id` 依次启动。 |
| 返工复验 | 对抗性验收失败后，由 manager 安排实现 worker 修改，再交验收 worker 复验；循环上限由 manager 管理。 |
| 纯对话 | 问候、感谢、闲聊、能力介绍和明确仅讨论方案等没有实际执行任务的输入；manager 直接响应，不因它们注册管线或启动 worker。带有问候的具体实现请求仍是实际任务。 |
| 普通发送 / 立即打断 | 用户给 manager 发送消息的两种方式；普通发送在忙碌时等待，立即打断请求中断 manager 当前轮次并处理新消息，具体 CLI 实现待验证。 |
| 用户原始请求 | manager 据以委派和初步验收的用户需求；后续修改如何形成版本待确认。 |
| Manager 备注 | manager 写给自己的任务提醒，不发送给 worker，在对应 worker 完成或失败回调中返回。 |
| 任务 | 交给单个 worker 的工作单元；任务依赖由 manager 在完成回调后决定，不自动推进。 |
| Mission Control | Last Order 使用的中央信息管理服务；拥有任务、worker、回调、状态与生命周期控制。 |
| Mission Control 工具 | manager 用来启动独立 worker、更新自用备注、检查状态和处理完成回调的工具集合。 |
| 完成回调 | worker 结束工作后，Mission Control 向 manager 发送结果、提交版本和 manager 备注的通知；不代表验收已通过。 |
| 初步验收 | 最初描述为 manager 检查结果；后续明确由 manager 定义要求并委派 worker 执行，再由 manager 根据结果推进和汇报。最终用户确认规则待明确。 |
| 技术方案阻塞 | 执行中遇到技术或工作流问题，由 manager 督促 worker 检查自身工作流。 |
| 需求方案阻塞 | 缺少业务或需求决定，需要 manager 向用户提问并将答复交回 worker。 |
| 工作区 | worker 执行任务和读写项目文件的目录；每个 worker 使用独立 Git worktree 和分支。 |
| Git worktree | 同一 Git 仓库的独立检出目录；本产品用其隔离 worker 文件修改，不能据此假设运行时资源也已经隔离。 |
| Git 改动 | 查看选定 agent 对应工作区中的改动；比较基准以及合并后的归属展示规则待确认。 |
| 需求交付分支 | 汇总本次需求改动的分支，用户决定何时合入原工作分支；manager 委派 worker 执行集成。 |
| 自动恢复 | 退出后保留记录与工作区，重开时自动继续未完成任务；不意味着保留已停止的进程，具体会话恢复机制待设计。 |
