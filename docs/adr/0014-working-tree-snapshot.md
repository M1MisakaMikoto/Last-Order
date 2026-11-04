# ADR 0014: 未提交工作区快照

日期：2026-11-03

## 背景

VSCode 用户经常带着未提交修改开始工作。要求 Git 工作区完全干净会显著降低 Mission Control 替代 VSCode + Codex 工作流的可用性。

## 决定

- Git 工作区不干净时，Mission Control 使用临时 `GIT_INDEX_FILE` 创建 working-tree snapshot commit。
- snapshot 包含 tracked 未提交修改和未忽略的 untracked 文件。
- 不修改用户 HEAD、当前分支、真实暂存区或原工作区文件。
- worker worktree 从 snapshot commit 建立。
- snapshot commit 是 Mission Control 的只读基线，用户原工作树仍由用户自行提交或继续编辑。

## 影响

- VSCode 用户可以带着未提交修改启动 worker。
- worker 输出可以基于用户当前实际工作区内容。
- 原生 diff 的 base 端使用 worker 的 snapshot baseCommit。
- 大文件和二进制文件仍受现有预览/差异限制。
- 后续需要为 snapshot 保留策略和清理策略补文档。
