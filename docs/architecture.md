# 首版系统设计

日期：2026-11-02。本文将已确认的产品决定组织成系统设计；标为“建议”的细节尚不是用户决定。首版实现已存在，具体工程选择和限制见 ADR 0007 与 README；未实现的草案能力不能当作现有接口。

## 当前 Mission Control 任务模型（2026-11-03）

当前产品路径已取消 manager 注册并自动推进的程序化多阶段管线。Mission Control 只管理独立 worker 任务、manager 备注、完成回调和持久化。

- manager 用 `start_worker` 启动单个任务，并用 `update_worker_notes` 维护只给自己看的提醒。
- worker 完成或失败时，Mission Control 回调 manager，附带结果、提交版本、worker 标题和备注。
- 有先后依赖的任务由 manager 在回调后调用 `start_worker`，并通过 `input_worker_id` 指定上一个 worker 的提交作为新 worktree 基线。
- 互不依赖的任务仍可并行；Mission Control 不替 manager 推导依赖图。
- 内部单阶段任务记录继续复用 worktree、Git 交付、审批、恢复和事务存储能力。

下文早期关于“链表管线自动推进”的内容保留为设计历史，已被本节和 ADR 0010 取代。

## 客户端与服务边界

Mission Control 通过 `bin/mission-control.js` 作为独立项目级服务运行。TUI 和 VSCode 扩展都是客户端，通过 `.git/last-order/control.json` 连接。

VSCode 扩展和 TUI 都通过同一 control API 工作。TUI 使用 ServiceClient 轮询状态和历史；`/quit` 只停止客户端，Mission Control 继续运行，`/shutdown` 才停止整个系统。

VSCode 是单一产品入口并管理 Mission Control 生命周期。左侧 Activity Bar 提供 Mission Control worker 树；右侧辅助侧栏的 Manager WebviewView 使用 xterm 承载现有 TUI，虚拟终端 Host 负责 ANSI/键盘桥接；Worker monitor 使用编辑器区终端页签。扩展不重写 Manager/Worker 对话 UI，所有管理界面共享同一 control API 和 TUI 渲染。


Codex adapter 提供原生会话版本能力：	hread/turns/list、	hread/fork、	hread/revert。Mission Control 通过 /conversation/turns、/conversation/fork、/conversation/revert 暴露统一接口；/checkpoints、/checkpoints/:id/restore 保存 native session/turn 引用与 worker worktree snapshot，并可恢复 Last Order 管理的文件状态。原生 revert 不负责文件恢复。

## 产品范围

Windows CLI/TUI；一次启动管理一个 Git 项目、一个 manager 和多个独立 worker 任务。manager 和默认 worker 均可从 Claude Code、Codex、DeepSeek Harness、OpenCode 中选择。

manager 理解用户需求、决定 worker 任务顺序、维护仅自己可见的备注、处理完成回调和异常并对用户汇报。实现、对抗性验收、返工、集成和验证由 worker 执行。

Mission Control 是状态与调度的中央服务。独立 worker 完成、失败或阻塞时，Mission Control 把结果、提交版本和 manager 备注回传给 manager，由 manager 决定下一步。worker 主动汇报进展或长时间未响应时也提供状态通知。Mission Control 不推导依赖图，也不自动启动后续 worker。

服务随 TUI 启停，退出停止全部执行，记录与 worktree 保留；重开自动恢复未完成任务。代码汇总到需求交付分支，是否合入原工作分支由用户决定。

## 组成与职责

| 组成 | 职责 | 边界 |
| --- | --- | --- |
| TUI | manager 对话；worker 列表；选中 worker 的对话、工作区与 Git；直接消息、暂停、取消、重试 | 展示与发出操作，状态以中央服务为准 |
| Mission Control | 独立 worker 任务、manager 备注、消息、回调和进度管理；持久化与恢复 | 不自动推导任务依赖，不承担实现或验收的模型推理 |
| Manager runtime | 用选定 CLI 承载 manager；接收用户消息和需决策的事件 | 实现、验收执行和集成均委派 |
| Worker runtime | 运行选定 CLI；转发对话、工具、阻塞和结果 | 每个 worker 有独立 worktree 与分支 |
| CLI adapter | 将各 CLI 的启动、输入、事件、审批、中断与恢复映射为统一能力 | 不假定四种 CLI 的参数和协议相同 |
| Workspace/Git 层 | 分配和查询 worktree；记录基础版本与结果版本；展示改动 | 合并、冲突解决由 worker 执行；原工作分支不自动改写 |
| 持久化层 | 保存原始需求、链进度、消息、产物和通知处理进度 | 建议使用本地事务存储；具体技术尚未确定 |

首版选择应用内中央服务，随 TUI 启停，见 ADR 0007。“中央”表示信息和调度的权威来源，不要求部署成常驻后台服务。

## 领域对象（建议）

| 对象 | 关键字段与关联 |
| --- | --- |
| Project | 根目录、Git 仓库身份、原工作分支、配置 |
| ManagerSession | provider、原生会话标识、忙碌状态、消息队列 |
| Request | 用户原始需求、后续补充、manager 的阶段目标、交付分支 |
| Pipeline | 所属 Request、首阶段、当前阶段、运行状态 |
| Stage | 类型、要求、指定 provider 或默认 worker、next_stage_id、输入产物、当前执行尝试 |
| Worker | provider、会话、worktree、分支、当前阶段与进程关联 |
| Attempt | 一次实际执行、版本号、开始与结束时间、结果或阻塞原因 |
| Artifact | worker 提交的 Git 版本、工作总结、测试证据、验收结论 |
| Message/Event | 来源、接收方、序号、所属请求与 worker、正文或结构化内容 |
| Callback/Inbox | 订阅事件、待送达通知、是否已交给 manager 处理 |

任务、worker 实例、CLI 会话、操作系统进程分别记录。一个进程退出不能直接推导出需求已完成。

一条管线只有顺序的 next 关系，允许单阶段管线；同项目可运行多条链。返工由 manager 明确安排新的执行尝试和复验，不扩展成通用依赖图。管线链条的新增、替换或重跑应记录变更原因。

## Mission Control 工具

manager 当前可用：`start_worker`、`update_worker_notes`、`remember_manager_guidance`、`inspect`、`send_worker_message`、`control_worker`、`ask_user`、`answer_worker_question`。worker 当前可用：`report_progress`、`report_result`、`inspect`。

`start_worker` 接受标题、任务要求、provider/kind、可选 `request_id`、`input_worker_id` 和 manager 备注。`update_worker_notes` 替换指定 worker 的备注数组。备注不会发送给 worker，只进入 manager 的完成/失败回调。`remember_manager_guidance` 将用户要求长期记住的习惯、规范或流程追加到 `.git/last-order/AGENTS.md`，与代码系统提示词及 managerPrompt/workerPrompt 分区。

## 自动推进与结果

1. manager 将原始需求和每个阶段的要求登记到服务。
2. 服务分配 worker、独立 worktree 和分支，启动当前阶段。
3. worker 持续输出对话或进展，显式报告结果、技术阻塞或需求阻塞。
4. 服务保存结果与产物；当前阶段满足登记的成功条件时，自动启动已注册的下一阶段。
5. 链结束时通知 manager 汇报或安排后续工作；失败或阻塞时停止这条链的自动推进并通知 manager。
6. manager 处理技术阻塞时督促 worker 检查自身工作流；处理需求阻塞时向用户提问。

验收 worker 给出未通过结论时，服务不得把“验收进程正常退出”当作阶段成功并进入集成。验收证据送给 manager，由其安排实现 worker 返工，再由验收 worker 复验，循环上限由 manager 管理。

中间阶段完成事件保存在服务中供 TUI 查看；是否需要唤醒 manager 与是否记录事件是两个不同动作。无需为每条输出或每次成功交接启动一次 manager 模型轮次。

## 状态建议

| 状态 | 含义 | 自动进入后续阶段 |
| --- | --- | --- |
| queued | 等待前置阶段完成或执行资源 | 否 |
| starting | 工作区和 CLI 正在准备 | 否 |
| running | 当前执行尝试运行中 | 否 |
| waiting_approval | 等待 TUI 中的用户批准或拒绝 CLI 权限请求 | 否 |
| blocked_technical | 技术或工作流阻塞，需要 manager 督促自查 | 否 |
| blocked_requirements | 需求问题，需要 manager 向用户提问 | 否 |
| paused | 用户或 manager 显式暂停 | 否 |
| interrupted | 退出系统或意外中断，需要恢复 | 否，先恢复当前阶段 |
| succeeded | 当前阶段结果满足成功条件 | 是，有已登记下一阶段时 |
| review_failed | 验收发现问题并提供证据 | 否，交 manager 安排返工 |
| failed | 进程或执行失败 | 否，通知 manager |
| cancelled | 显式取消 | 否 |

建议状态变更以执行尝试编号校验，旧进程晚到的结果不能覆盖暂停、重试或新尝试。具体状态名不构成已确认的产品文案。

## worktree、产物和交付

每个 worker 使用独立 worktree 与分支。建议创建时保存基础提交，Git 页面同时区分“本次任务累计改动”和“当前未提交修改”，避免提交后 diff 变空让用户误认为没有改动。

后续阶段需要接收前一阶段的明确实现版本；建议以提交版本交接，而非从仍在变化的目录拷贝文件。验收 worker 在自己的 worktree 检查该版本，结果关联被验收的提交；返工后复验必须切换到新版本。交接方案尚需实际接入验证。

多条链共同完成一个需求时，manager 可委派集成 worker 汇总到该需求的交付分支、处理冲突并验证。单阶段简单任务的交付可以更简洁，但同样需要能指出准确的代码版本和交付位置。

交付分支完成不意味着已合入用户原工作分支。用户决定何时合入。首版是否支持已有未提交修改以及非 Git 项目尚未确定；独立 worktree 依赖 Git。

## 用户消息与控制

- 普通发送：保存消息；manager 待命时立即处理，忙碌时显示等待状态。
- 立即打断：用户明确请求中断 manager 当前轮次并优先处理新消息。需要验证原生 CLI 支持，并处理在途工具调用，不能撤销已经完成的调度动作。
- 直接操作 worker：用户可发消息、暂停、取消、重试；操作记录同步给 manager。
- 建议 worker 暂停或取消时不启动其下游阶段；重试保留前次证据。对已启动后续阶段的回溯修改需显式使旧验收结果失效，具体机制待设计。
- manager 忙碌不会隐式停止其他管线。

## 持久化、退出与恢复

建议中央服务使用事务存储保存状态与待处理通知；完成结果、阶段推进意图和通知记录应能一起落盘，避免重启后漏掉交接。通知采用可重复投递并去重的设计，不声称进程与磁盘之间存在天然的“恰好一次”。

退出建议先冻结新调度，再停止 manager 与 worker，保存未完成阶段为可恢复的中断状态，最后退出服务。Windows 必须覆盖子进程树回收；具体使用 Job Object、监督进程或其他机制需验证，不能只停止最外层启动器。

重开后自动核对工作区、已有提交、阶段结果和原生会话，再继续未完成任务。建议显式暂停或取消的任务保持原状态，避免自动恢复违背用户的控制意图。原生会话不能继续、工作区缺失或关键动作状态不明时的策略尚需明确。

## TUI 信息布局建议

主区域提供 manager 对话和所有 worker 列表，列表展示管线、阶段、载体、运行状态和最近进展。选中 worker 后切换：

- 对话：结构化消息、工具调用、进展、阻塞和结果，保留原始输出供排错。
- 工作区：根路径、文件树、选中文件内容；当前要求是查看，编辑能力未获要求。
- Git：分支、基础版本、变更文件、累计 diff 与未提交 diff。

常驻显示 manager 待命/工作中状态、待处理消息及问题。普通发送与立即打断提供明确区分；退出时展示停止过程，重开时展示恢复结果。

## 技术选择建议与验证顺序

当前环境可用 Node.js 24、npm、Git 与四类 CLI；后三类在联调阶段经用户授权安装，当前只继续 Codex 的真实模型测试。首版采用 JavaScript ESM/Node.js、内置 SQLite 和 ANSI 终端界面，无第三方运行依赖；这是工程选择而非用户指定技术栈，见 ADR 0007。

验证优先级：

1. 四种载体的版本、启动、消息、结束、审批、中断和恢复能力。
2. 无真实模型调用的调度与状态测试：自动推进、失败不推进、返工、重复回调、暂停/取消、重启恢复。
3. 临时 Git 仓库中的多 worktree 与版本交接测试，确认原工作分支不被自动改写。
4. TUI 的列表、对话、工作区、diff 和发送模式。
5. 已安装且已登录的真实 CLI 联调；未完成真实验证的适配器必须明确标识。

督促触发和审批归属已确认：worker 完成、汇报进展或长期未响应时交 manager 检查，CLI 权限请求交用户批准或拒绝。剩余重点是各载体的实际版本兼容性和恢复能力；CLI 调研证据见 `docs/cli-integration.md`。
