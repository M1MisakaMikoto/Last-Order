# ADR 0015: 产品名 Last Order，Mission Control 为服务名

日期：2026-11-03

## 决定

- 产品与项目名称统一为 **Last Order**。
- **Mission Control** 只表示 Last Order 内部的中央调度与状态服务。
- CLI 主入口为 `bin/last-order.js`，提供 `last-order` 和 `lo`。
- 项目数据目录由 `.git/schedule-agents` 迁移到 `.git/last-order`。
- Worker worktree 容器由 `.schedule-agents-workspaces` 迁移到 `.last-order-workspaces`。
- 新分支使用 `last-order/worker/*` 和 `last-order/delivery/*`。
- 用户可配置 provider 命令使用 `LO_<PROVIDER>_COMMAND`。

## 影响

- 用户界面、VSCode 扩展、包名、文档和默认路径统一使用 Last Order。
- Mission Control 代码、control API 和扩展命令命名保持服务语义。
- 旧项目目录自动迁移，已有任务和历史数据不需要手工搬运。
