# 四类 CLI 接入调研

日期：2026-11-02。四类适配器已实现并通过受控协议测试；Codex 真实模型闭环已通过，当前按用户范围只继续 Codex 联调。详见 `docs/integration/codex-live.md`。

## 当前环境

- Node.js：v24.22.1。
- npm：11.19.1。
- Git：2.56.0.windows.4。
- Codex `0.164.0` 可用；经用户授权安装 Claude Code `2.1.316`、dsh `0.2.1-rc.5`、OpenCode `1.19.5`，全部已确认可启动。
- Codex 已完成真实问候与讨论、实际实现、独立验收、原生 Git 审批、中断恢复与交付分支闭环；未读取或输出密钥。
- 已读取下列公开官方资料。文档中的能力仍需针对实际安装版本验证。

## Claude Code

官方资料：<https://code.claude.com/docs/en/headless>。

文档确认：

- `claude -p` 可非交互运行。
- `--output-format stream-json --verbose` 提供 JSON 行事件；可使用 `--include-partial-messages`。
- JSON 结果含会话标识；`--resume <session_id>` 可继续指定会话。
- 文档还涉及结构化输出、双向流式输入和权限处理，具体能力与版本相关。

接入建议：使用支持双向消息和控制请求的官方接口，保留 session_id；不要把仅能收集最终 stdout 的一次性进程包装声称为完整的交互与审批接入。

已验证：Windows 原生 npm 启动器、版本和双向 control 初始化。真实问候返回未登录；按用户范围暂不继续 Claude 认证。真实任务、审批、中断和恢复仍有验证缺口。

## Codex

证据：当前机器本机 CLI 帮助；CLI 提供 `exec`、`app-server`、会话继续与 JSON 协议 schema 生成能力。

帮助确认：

- `codex exec --json` 输出 JSONL；`--output-schema` 可约束最终结果。
- `exec resume` 是继续已有会话的子命令。
- `codex app-server --stdio` 提供原生 stdio 接入。
- `app-server generate-json-schema` / `generate-ts` 可导出该版本协议定义。
- CLI 提供 read-only/workspace-write 等原生沙箱选项；manager 与 worker 的具体工具权限仍需按协议实现。

接入建议：优先验证 app-server 的会话、轮次、中断、审批和事件接口。exec 适合单次任务验证，不能仅凭 exec 的存在就认为所有交互控制已实现。

已验证：本机 CLI `0.164.0` 的真实初始化、动态工具、五种纯对话、manager/worker 模型轮次、两个独立 worker、Git 原生审批、同会话恢复和交付后的感谢。实现与对抗性验收共 18 项测试通过；原工作分支未合入交付。`scripts/probe-codex.js` 仍是零模型轮次的协议检查；真实调用脚本是 `scripts/live-integration.js`。

验证边界：未穷举所有模型配置、并发和故障组合；原生在途工具调用中断与多链并发仍需更完整的真实场景覆盖。

## DeepSeek Harness

已确认官方项目：<https://github.com/deepseek-ai/deepseek-harness>，默认分支为 `master`，命令为 `dsh`，npm 包为 `@deepseek-ai/dsh`。

官方资料：

- <https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md>
- <https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md>
- <https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md>

文档确认：

- `dsh --profile headless "任务"` 是一次性执行入口，创建新持久化会话，stdout 输出最终文本。
- `dsh --profile sdk` 用 stdio 提供 JSON-RPC；`sdk-minimal` 提供相同协议的最小 agent 配置。
- `dsh --profile acp` 用 stdio 提供 ACP。
- profile 与插件配置决定能力；CLI 不是与 Claude Code 相同的 `-p --output-format` 接口。
- 官方说明目前为 developer preview，接口需要按版本验证。

接入建议：优先评估 SDK 或 ACP 作为双向控制入口。headless 文本输出可以验证基本启动，不能单独满足实时对话、审批、中断和原生会话恢复。

已验证：Windows 原生命令、ACP 初始化、创建会话与 MCP 发现。真实问候返回缺少 DeepSeek provider API key；按用户当前范围暂不配置。真实模型任务、审批和恢复仍待验证。

## OpenCode

官方资料：<https://opencode.ai/docs/cli/>。

文档确认：

- `opencode run` 支持非交互运行。
- `--format json` 输出原始 JSON 事件。
- `--session <id>` 继续指定会话，`--agent` 选择 agent。
- `opencode serve` 配合 `run --attach` 可复用服务。

接入建议：评估原生服务 API 的消息、事件和审批接口，再由本应用监督其生命周期；不能让其变成本产品退出后仍常驻的无管理后台。

已验证：Windows 原生命令、本机认证服务、provider 预检、SSE 事件与 MCP 加载。实际问候返回免费额度耗尽；错误现及时回传，临时 rate limit 仍保留原生重试。按用户当前范围暂不配置新 provider；真实任务、审批和恢复仍待验证。

## 统一适配器能力草案

建议接口覆盖 `probe`、`startSession`、`sendMessage`、`interrupt`、`respondApproval`、`stop`、`resume`，并输出结构化消息、进展、阻塞、结果和原生会话标识。

各适配器应报告已验证的 capabilities 和版本。进程退出码、模型结束一轮、worker 任务完成、验收通过是不同事件；后续阶段只依据显式的有效阶段结果推进。

首版目标仍是四种载体都可作为 manager 和默认 worker；接口调研并不等于满足此目标。不得以四个可配置命令名称代替真实适配器。

## 实现与测试对应

| 载体 | 源码 | 当前验证 |
| --- | --- | --- |
| Codex | src/adapters/codex.js | 真实纯对话零派工、实现/验收、原生审批、恢复与交付通过 |
| Claude Code | src/adapters/claude.js | 协议夹具通过；原生命令/control 启动通过；真实模型受登录阻塞 |
| DeepSeek Harness | src/adapters/acp.js | 协议夹具通过；原生 ACP/MCP 启动通过；真实模型缺 key |
| OpenCode | src/adapters/opencode.js | 协议夹具通过；真实服务/SSE/额度错误上报通过；真实回答缺可用额度 |

DSH 官方 ACP 细节见 <https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md>：支持 `session/resume`，明确不支持 `session/load`。实现采用 resume，不套用其他 ACP 实现的 load 方法。OpenCode 服务端资料为 <https://opencode.ai/docs/server/>。
