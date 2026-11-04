# ADR 0011: Staff provider、model 与 effort 配置

日期：2026-11-03

## 背景

manager 和 worker 不只是可以选择 CLI 载体，还需要按任务选择具体模型和推理强度。不同 provider 的原生参数不同，不能假定一个统一的模型名或 effort 枚举。

## 决定

- manager 和 worker 统称为 staff。
- 每个 staff 分别持久化 `provider`、`model`、`effort`。
- `/settings` 支持文本编辑 model/effort；CLI 提供对应覆盖参数。
- `start_worker` 允许对单个 worker 覆盖 provider/model/effort。
- 适配器负责将统一字段映射到原生参数：
  - Codex：thread `model` 和 `config.model_reasoning_effort`
  - Claude Code：`--model` 和 `--effort`
  - OpenCode：agent `model`
  - DSH：当前 ACP 能力未暴露，暂不传递

## 影响

- 配置值保持 provider-specific 字符串，不在 Mission Control 层强制枚举。
- UI 显示当前 staff 配置，但不校验 provider 是否支持某个模型或 effort；无效值由原生 CLI 报错。
- 后续需要为 OpenCode effort 和 DSH model/effort 补充协议支持。
