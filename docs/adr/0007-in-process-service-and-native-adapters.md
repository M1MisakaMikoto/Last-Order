# ADR 0007：Node.js 中央服务、SQLite 与原生协议适配器

- 日期：2026-11-02
- 状态：首版工程实现选择；不是新增用户需求

## 选择

采用 Node.js 24+ 的 JavaScript ESM，使用内置 SQLite、HTTP、子进程和终端接口，不增加第三方运行依赖。schedule_table_service 是 TUI 当前应用内的中央模块，生命周期与界面绑定。

SQLite 事务保存状态和事件；同项目使用锁文件阻止第二个服务。每个 CLI 进程由监督进程托管，父连接中断时回收 CLI 树。停止服务会等待仍在运行或回收中的执行任务。

状态存于 Git common directory 下；worker 工作文件位于项目根目录的 `.schedule-agents-workspaces/`，经本地 `info/exclude` 排除并记录归属，避免将工作文件置于受 CLI 特别保护的 Git 元数据目录。不会改写项目 `.gitignore`。

四个原生接入方向：Codex app-server stdio JSON-RPC 与动态工具；Claude 双向 stream-json/control 与 MCP；DSH ACP 与 MCP；OpenCode 本机受认证服务、事件流与 MCP。MCP 桥只暴露 actor 对应的 manager 或 worker 工具，使用短期本机 token，不开放未认证调用。

## 原因

当前开发环境支持 Node.js 24，内置组件足以实现可运行原型。统一事件模型便于测试自动推进、审批和恢复，同时保留原生 CLI 的登录、模型配置和权限处理。

## 取舍与边界

- 自行绘制终端界面，首版提供只读文件预览和按需刷新的 Git 视图，不是完整编辑器。
- 原工作区需干净且已有 Git 初始提交，避免静默忽略未提交内容；不自动替用户清理或提交。
- CLI 适配器的受控协议测试已通过；后续 Codex 真实模型轮次、manager/worker 实现与验收、原生审批、恢复及交付已通过，见 `docs/integration/codex-live.md`。其他载体尚未完成真实模型闭环。
- DSH manager 的严格原生工具白名单仍待验证，不能将角色指令声称为通用操作系统沙箱。
- 默认返工预算为 3，manager 注册管线时可指定 0–20；默认 4 个运行阶段和 10 分钟静默阈值，可配置。
- 交付仅创建或快进需求交付分支引用；产生合并与解决冲突的操作仍由 worker 执行。
