# Last Order Webview 交接

更新时间：2026-11-06。当前候选：0.1.80，未发布，真实 VS Code / Remote 验收尚未完成。

## 用户要求

## 当前安装状态

本机当前安装登记为 Last Order 0.1.77；工作区候选已升级并打包为 0.1.80，但尚未安装到用户当前窗口。0.1.77 安装目录只与当时源码一致，不代表包含当前流式输出、中间回复合并、快捷键和消息边框改动。

独立测试宿主启动失败不说明当前用户窗口不可用，也不能作为要求用户处理 VS Code 更新或系统权限的依据。后续需要核对用户当前实际界面的截图/可访问 DOM；当前工具没有直接访问该 Webview 的能力。

用户选择 A 的墨黑视觉，但内容设计、区域布局和键盘交互必须与原 TUI 一样。换 Webview 只为解决性能问题。不得继续沿用早期 Codex 风格重构建议、欢迎标题、活动卡片、独立标签按钮、项目下拉框、设置弹窗或发送工具栏。

用户指出旧版把 Last Order、Manager/Workers、SA、Ready、计数分散排列，确实未严格还原。`SA` 来自截取项目目录名，原 TUI 显示的是完整路径。0.1.74–0.1.76 的“已复刻”结论作废。

## 当前实现

- `vscode-extension/ui-runtime.cjs` 直接打包 `src/ui.js` 及其内容模块，去掉 Node 终端传输；Webview 使用原控制器的键盘、命令、设置、标题、项目、状态与提示规则。无需维护第二套命令逻辑，不使用 eval。
- `webview/manager.html`、`style.css`、`app.js` 用原生 DOM 呈现原 TUI 区域；无 xterm/终端 host。消息按键复用节点，保留选区、工具展开和滚动。
- 顶部直接使用 `headerLines`；显示完整项目路径和最多三行项目窗口；没有 Manager/Workers 标签按钮。窄栏沿用原规则换行。
- Manager 保持原消息过滤、角色/序号/时间和 Markdown；Workers 保持列表与详情，宽屏左右、窄屏上下。审批/问题、队列、共享输入仍在原位置。
- 设置、帮助、请求详情在主区域内展示；普通输入始终发给 Manager，仅 `/msg` 发给 Worker。F1–F6、Ctrl+Tab、历史、补全、引用、审批、settings、turns/fork/revert/checkpoint/skills 复用原控制器。
- 移除独立 Attach image 按钮，改为在输入框直接粘贴剪贴板图片；保留附件预览/移除与宿主侧校验。
- `frame()` 只在浏览器本地计算语义行数/页脚；不绘制终端帧，不通过 IPC 传输帧。
- 修复原 TUI `labeledLines` 前缀测宽错误，避免窄栏状态/快捷键丢字；修复项目切换清理浏览器历史缓存，避免旧项目内容残留。

## 证据与检查

- [当前 A 样板与并排对照](docs/design/style-samples/index.html)：共用产品代码的本地交互预览，以及原 TUI 文本/原生 DOM 截图。旧风格画廊已经撤下。
- [差异逐项记录](docs/integration/webview-ui-0.1.77.md)。
- `npm.cmd test`：156 项通过；`node scripts/check.js` 通过。
- `node scripts/verify-webview.mjs`：57 个原 TUI/DOM 内容对照通过，含真实 CDP 键盘操作、三行项目窗口、项目切换/路由、文件预览、附件增删/发送、发送期间继续输入/重复提交、发送错误、工具记录全部内容、文件/代码复制链接、选区引用、Worker 选中项可见、宽窄窗口重排和长消息角色提示。
- 续查修复：工具折叠/展开使用与 TUI 相同的 `conversationPresentation` 和 Markdown，保留链接；Worker 键盘选择自动滚入可见区；宽窄布局先重排再测量正文宽度；长消息角色标签固定在可视区顶部；Tab 无候选时不转移输入焦点；Shift+Enter 插入换行，Enter 提交。
- `.tmp/webview-review` 包含每个场景的 PNG、原 TUI 文本和 `results.json`。性能只是本地模拟样本，不能当作 Remote 性能结论。
- 生成预览：`node scripts/render-webview-preview.mjs`。
- 更新可提交对照页：先运行浏览器核对，再 `node scripts/render-tui-comparison.mjs`。
- 打包：在 `vscode-extension` 中运行 `npm.cmd run package`，确认包含 `ui-runtime.cjs` 和最新 backend。

## 必须保留的验收限制

隔离 VS Code 开发宿主使用 `.tmp/start-parity-host.cjs` 启动，独立 profile / extension / workspace 均在 `.tmp/tui-parity-host`。VS Code 更新锁 `vscode-updating` 仍阻止启动，等待约 31 秒后退出，未加载真实工作台、未取得真实 Webview 截图。

日志：`.tmp/tui-parity-host/startup.log`。不要绕过更新锁，不要把浏览器 mock 对照说成真实宿主/Remote 验收。尚未安装候选到用户当前窗口或 Remote。需要在宿主可用后继续真实数据/任务、窗口尺寸、键盘焦点和性能验证。

2026-11-06 08:01 UTC 再次核实：隔离宿主 PID 20412 等待 31380ms 后仍遇到相同更新锁，最终 `Host exit: 1`。同一外部条件连续阻塞三轮；独立可完成的代码、浏览器对照和打包工作已完成。目标进入受阻状态，不能宣称完整验收。待 VS Code 更新正常完成并释放锁后，恢复真实宿主验收。逐项完成审计见 `docs/integration/webview-ui-0.1.77.md`。

## 工作区注意事项

2026-11-06 16:16（北京时间）恢复检查：两次提升权限启动请求均因自动权限审查超时而未执行，不能据此判断 VS Code 更新锁是否仍存在。随后以普通沙箱权限启动隔离宿主，PID 24472 因安装目录 ACL 不允许沙箱读取而终止，`Host exit: 2147483651`。没有更改安装目录 ACL、关闭沙箱或修改用户窗口。当前仍缺少真实宿主证据；更新锁状态本次未获确认。此次恢复属于新一轮阻塞审计的第一轮。

目录内有大量本轮及此前的未提交改动，必须保留；不要重置/清理。没有 git commit。旧文档和历史截图仅作历史证据，当前用户要求和本交接优先。
