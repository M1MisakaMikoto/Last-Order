# Codex 真实联调报告

日期：2026-11-02。载体：本机已配置的 Codex CLI `0.164.0`。以下结论来自真实模型轮次。

## 结果

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| `hello` | manager 直接回复，不创建任务 | 新增 worker 0、管线 0、工具调用 0 |
| `你好` | manager 直接回复 | 新增 worker 0、管线 0、工具调用 0 |
| `谢谢` | manager 直接回复 | 新增 worker 0、管线 0、工具调用 0 |
| 询问 manager 能帮什么 | 直接介绍职责 | 新增 worker 0、管线 0、工具调用 0 |
| 明确“先别执行，只讨论” | 讨论，不派工 | 新增 worker 0、管线 0、工具调用 0 |
| `hello，帮我实现 sum(values)…` | 识别实际工作并委派实现和独立验收 | 1 条管线、2 个不同 worker，成功交付 |
| 完成后说“谢谢，暂时没有新任务” | 回复，保留历史，不重新派工 | worker 总数保持 2、管线总数保持 1 |
| 在真实 TUI 中输入 `hello` | 界面与调度一致，不新建工作 | 直接回复，worker 总数 2、活动 0、管线仍为 1 |

任务实现要求：新增 `src/sum.js`；空数组返回 0；仅接受有限 number 组成的数组；非法输入抛 TypeError；不修改输入，并添加 node:test 测试。

实现 worker 产生 7 项测试；独立验收 worker 另外新增 11 项对抗性测试。全量 **18/18 通过**。验收检查包含类型限制、NaN/Infinity、稀疏数组、跨 realm 数组、冻结数组、输入不变性与自定义迭代器等。

最终提交：`65d69e1a79a7e20c0f340c4d28bd6279d2970725`。交付分支：`sa/delivery/request_2ddbaaae`。原 `main` 保持初始提交，未合入产物。测试脚本还从交付提交读取函数，独立断言正常、非法输入与冻结数组行为。

## 原生交互与恢复

- 实现和验收 worker 均遇到 Git common directory 的原生写入审批。由测试操作者逐项批准指定测试仓库中的 git add/commit，不开启永久放行，不关闭沙箱。
- 管线中断后，沿用原有 worker、分支和原生会话继续完成；最终仍只有原来的 1 条管线、2 个 worker。
- manager 检查 worker 的真实命令输出，识别提交失败，督促 worker 按原生权限流程处理；实现与测试仍由 worker 执行。

## 修复的偏差

1. 旧模拟入口已按用户要求彻底删除，所有应用会话都接入真实 CLI。真实 manager 对问候、感谢、能力介绍和仅讨论只回复；不明确的输入先澄清，带问候的实际任务仍执行。
2. 真实 manager 的能力介绍曾触发多余文档查询。明确项目 manager 职责和纯对话边界后，五种对话场景均为零工具调用。
3. Windows npm 启动器现可安全解析原生 `.exe` 入口，无需通过 shell 拼接命令。
4. 原验收校验拒绝任何新提交，与“可新增验收测试、不改实现”冲突。现校验实际 Git 差异：仅允许新增普通测试文件，禁止修改已有实现、配置、已有测试或删除文件。
5. 验收返工遇到分叉时，保留旧验收分支并为新输入建立新分支，不丢弃旧证据。
6. Codex 工具输出现保留命令退出信息和输出，隐藏空的内部 userMessage/reasoning 条目；拒绝审批时遵循原生 offered decisions。
7. 联调脚本的执行超时不计算等待人工审批的时间，避免把用户决策时间算作任务卡死。

## 证据与复现

- [纯对话原始结果](codex-conversation.json)
- [真实实现与验收结果](codex-task.json)
- [交付后的感谢与数量断言](codex-post-task.json)
- [真实 TUI 问候、历史数量与退出记录](codex-tui.json)：退出探针记录子应用退出码为 0，无 stderr；服务锁已释放。
- 原始对话、命令输出和工作区保留在 `.tmp/live-codex-BwqABU/project` 的服务数据库与 worker worktree 中。

```powershell
node scripts/live-integration.js --provider codex --scenario greetings
node scripts/live-integration.js --provider codex --scenario full
```

脚本使用隔离 Git 仓库，沿用本机 CLI 认证与模型配置，发起真实请求。支持 `--resume-project` 恢复自己生成的测试仓库，支持 `--approval-dir` 以逐项请求/响应文件交互。普通 TUI 的权限审批仍由用户操作。

本次真实联调时应用自动化测试 **31 项通过**，语法检查通过。后续删除模拟入口及对应测试后，当前测试集为 **30 项通过**。并未穷举所有并发、失败返工和原生工具版本组合。

Claude Code、DSH、OpenCode 已安装，分别遇到认证或额度阻塞；用户随后明确当前只用 Codex 测试，故未继续配置其他载体。未复制或导出任何密钥。
