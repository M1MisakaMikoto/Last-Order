# ADR 0003：每个 worker 使用独立 Git worktree 和分支

- 日期：2026-11-02
- 状态：已接受
- 依据：用户明确选择“每个 worker 使用独立 Git worktree 和分支”。

## 决定

为每个 worker 分配独立 Git worktree 和分支。worker 在自己的工作区中执行实现任务，TUI 可按 worker 展示对应的文件和 Git 改动。

## 影响

- 不同 worker 的工作目录修改可分别查看；不能用共享目录中的整体 diff 冒充单个 worker 的改动。
- 中央服务需要记录 worker 与工作区、分支之间的对应关系；具体数据模型尚未确定。
- worktree 隔离文件修改，不自动隔离端口、外部服务、数据库和其他运行时资源。
- worker 完成不自动代表其代码已进入用户目标分支；后续已确认由 manager 委派 worker 负责集成、解决冲突和验证，见 ADR 0004。

## 后续问题

集成责任见 ADR 0004。基础分支、已有脏工作区、非 Git 项目、任务与 worker 的复用关系、提交时机、diff 比较基准和 worktree 清理策略尚未确定。
