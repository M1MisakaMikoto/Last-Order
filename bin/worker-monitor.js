#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { emitKeypressEvents } from 'node:readline';
import { fit } from '../src/conversation-view.js';
import { monitorFrame, readWorkerSnapshot } from '../src/core/monitor.js';

const { values } = parseArgs({ options: { 'data-directory': { type: 'string' }, worker: { type: 'string' } } });
if (!values['data-directory'] || !values.worker) throw new Error('worker-monitor requires --data-directory and --worker');

let stopped = false, timer, scrollTop = null, expanded = false, lastFrame = { maxTop: 0, bodyHeight: 1 };
const restore = () => {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdout.write('\x1b[?25h\x1b[?1049l');
};
const render = () => {
  if (stopped) return;
  const columns = Math.max(40, (process.stdout.columns ?? 100) - 1);
  const rows = Math.max(12, process.stdout.rows ?? 30);
  let frame;
  try {
    const snapshot = readWorkerSnapshot(values['data-directory'], values.worker);
    frame = monitorFrame(snapshot, {
      columns, rows, scrollTop,
      expandedActors: expanded ? new Set([values.worker]) : new Set(),
      expandedGroups: new Set(),
      collapsedGroups: new Set()
    });
  } catch (error) {
    const lines = ['Last Order Worker Monitor', '', `监视失败：${error.message}`, '窗口会继续重试；按 Ctrl+C 关闭。'];
    frame = { lines: [...lines, ...Array(Math.max(0, rows - lines.length - 1)).fill(''), 'Ctrl+C 关闭'], maxTop: 0, bodyHeight: Math.max(1, rows - 4) };
  }
  lastFrame = frame;
  process.stdout.write('\x1b[H' + frame.lines.slice(0, rows).map(line => fit(line, columns)).join('\n') + '\x1b[J');
};
const scroll = delta => {
  const current = scrollTop ?? lastFrame.maxTop;
  scrollTop = Math.max(0, Math.min(lastFrame.maxTop, current + delta));
  if (scrollTop === lastFrame.maxTop) scrollTop = null;
  render();
};
const stop = () => { restore(); process.exit(0); };

process.stdout.write('\x1b[?1049h\x1b[?25l');
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true); process.stdin.resume();
  emitKeypressEvents(process.stdin);
  process.stdin.on('keypress', (text, key) => {
    if (key.ctrl && key.name === 'c') return stop();
    if (key.name === 'up') return scroll(-1);
    if (key.name === 'down') return scroll(1);
    if (key.name === 'pageup') return scroll(-lastFrame.bodyHeight);
    if (key.name === 'pagedown') return scroll(lastFrame.bodyHeight);
    if (key.name === 'home') { scrollTop = 0; render(); return; }
    if (key.name === 'end') { scrollTop = null; render(); return; }
    if (key.name === 'f5') { expanded = !expanded; scrollTop = null; render(); }
  });
}
process.stdout.on('resize', render);
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('exit', restore);
render();
timer = setInterval(render, 500);
