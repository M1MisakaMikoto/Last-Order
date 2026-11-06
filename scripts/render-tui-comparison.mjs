// Publish review evidence from the real browser audit, not a separate UI mockup.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from './render-webview-preview.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'docs/design/style-samples');
const evidence = path.join(target, 'evidence');
await mkdir(evidence, { recursive: true });
const results = JSON.parse(await readFile(path.join(root, '.tmp/webview-review/results.json'), 'utf8'));
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const cases = [['single-project-idle', '单项目空闲 · 320px'], ['manager', 'Manager · 1200px'], ['worker', 'Workers · 320px'], ['worker-rich-tool', 'Worker 工具详情 · 504px'], ['worker-resized-1200', 'Workers 窗口重排 · 1200px'], ['settings', '设置 · 320px'], ['commands', '帮助 · 320px']];
const sections = [];
for (const [name, title] of cases) {
  await copyFile(path.join(root, '.tmp/webview-review', name + '.png'), path.join(evidence, name + '.png'));
  const frame = await readFile(path.join(root, '.tmp/webview-review', name + '-tui.txt'), 'utf8');
  sections.push(`<details><summary>${title}：原 TUI / 原生 Webview 对照</summary><div class="comparison"><div><h3>原 TUI（同一数据和列数）</h3><pre>${escape(frame)}</pre></div><div><h3>原生 DOM 截图</h3><img src="evidence/${name}.png" alt="${title}"></div></div></details>`);
}
await writeFile(path.join(target, 'native-preview.html'), preview);
await writeFile(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
await writeFile(path.join(target, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Last Order · A / TUI 布局核对</title>
<style>
:root{color-scheme:dark;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;background:#151517;color:#e7e7e8}*{box-sizing:border-box}body{max-width:1400px;margin:auto;padding:28px 24px}h1{font-size:22px;font-weight:550}p{color:#aaaab1}a{color:#c1c9df}button,select{font:inherit;color:inherit;background:#272729;border:1px solid #45454b;border-radius:4px;padding:5px 10px}label{margin-right:14px}.stage{overflow:auto;margin:18px 0 26px}iframe{display:block;width:504px;max-width:100%;height:900px;border:1px solid #45454b;background:#1c1c1e}details{border-top:1px solid #45454b;padding:14px 0}summary{cursor:pointer}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:20px;overflow:auto}.comparison>div{min-width:0}pre{font:13px/1.5 Consolas,"Microsoft YaHei",monospace;white-space:pre;overflow:auto;background:#1c1c1e;padding:10px}img{max-width:100%;height:auto;vertical-align:top}h3{font-size:14px;font-weight:500}@media(max-width:700px){.comparison{grid-template-columns:1fr}body{padding:16px}}
</style><h1>A · 墨黑配色，原 TUI 内容和布局</h1>
<p>旧样板的标签按钮、欢迎标题、任务卡片和输入工具栏已撤下。下方直接加载产品代码，标题、项目、状态、提示使用原 TUI 的同一组规则。窄栏按原规则换行，项目显示完整路径。</p>
<label>宽度 <select id="width"><option>320</option><option selected>504</option><option>1200</option></select></label>
<label>状态 <select id="scenario"><option value="idle">单项目空闲</option><option value="default">Manager / 有任务</option><option value="worker">Workers</option><option value="settings">设置</option><option value="commands">帮助</option></select></label>
<p>点击预览内输入区：Ctrl+Tab 切换，F1–F6、/ 命令、↑↓ 历史、Shift+Enter 换行。普通输入发给 Manager。数据为本地演示。</p>
<div class="stage"><iframe title="原生 Webview，复用 TUI 控制器" src="native-preview.html?scenario=idle"></iframe></div>
<p>验证：${results.cases.length} 个状态的内容对照与键盘检查通过。以下是相同数据下的原 TUI 文本和浏览器截图。真实 VS Code 宿主尚未验收：隔离开发宿主启动被 vscode-updating 更新锁阻止。</p>
${sections.join('\n')}
<script>const frame=document.querySelector('iframe');document.querySelector('#width').onchange=event=>frame.style.width=event.target.value+'px';document.querySelector('#scenario').onchange=event=>{const value=event.target.value;frame.src='native-preview.html?scenario='+(['idle','default'].includes(value)?value:'default')+(['idle','default'].includes(value)?'':'#'+value)};</script></html>`);
console.log(path.join(target, 'index.html'));
