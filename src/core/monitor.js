import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fit, renderConversation } from '../conversation-view.js';

const statusLabel = status => ({ queued: '排队', starting: '启动中', running: '运行中', waiting_approval: '等待审批', paused: '已暂停', cancelled: '已取消', failed: '失败', blocked: '阻塞', succeeded: '已完成' })[status] ?? status;

export function monitorLines(snapshot, columns = 100, options = {}) {
  const worker = snapshot.worker, pipeline = snapshot.pipeline;
  return [
    `Last Order · Worker Monitor · ${worker.id} · ${statusLabel(worker.status)}`,
    `任务：${worker.title ?? pipeline?.title ?? worker.pipelineId ?? ''} · ${worker.provider ?? ''} / ${worker.kind ?? ''}`,
    '─'.repeat(Math.max(1, columns)),
    ...renderConversation(snapshot.events, worker.id, columns, options)
  ];
}

export function monitorFrame(snapshot, { columns = 100, rows = 30, scrollTop = null, ...options } = {}) {
  const all = monitorLines(snapshot, columns, options);
  const header = all.slice(0, 3), content = all.slice(3);
  const bodyHeight = Math.max(1, rows - 4);
  const maxTop = Math.max(0, content.length - bodyHeight);
  const top = scrollTop === null ? maxTop : Math.max(0, Math.min(scrollTop, maxTop));
  const visible = content.slice(top, top + bodyHeight);
  while (visible.length < bodyHeight) visible.push('');
  const range = content.length ? `${top + 1}–${Math.min(content.length, top + bodyHeight)}/${content.length}` : '0/0';
  const footer = `${range} · ${scrollTop === null ? '跟随最新' : '历史'} · ↑↓/PgUp/PgDn 滚动 · Home/End · F5 过程 · Ctrl+C 关闭`;
  return { lines: [...header, ...visible, footer], top, maxTop, bodyHeight };
}

export function readWorkerSnapshot(dataDirectory, workerId) {
  const db = new DatabaseSync(path.join(dataDirectory, 'schedule.sqlite'), { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout=1000');
    const row = db.prepare('SELECT value FROM state WHERE id=1').get();
    if (!row) throw new Error('未找到调度状态');
    const state = JSON.parse(row.value), worker = state.workers[workerId];
    if (!worker) throw new Error(`找不到 worker：${workerId}`);
    const events = db.prepare('SELECT * FROM events WHERE actor=? ORDER BY seq DESC LIMIT 300').all(workerId).reverse()
      .map(event => ({ ...event, data: JSON.parse(event.data) }));
    return { worker, pipeline: state.pipelines[worker.pipelineId] ?? null, events };
  } finally {
    db.close();
  }
}

export function openWorkerMonitor(worker, dataDirectory, cwd = process.cwd()) {
  const script = fileURLToPath(new URL('../../bin/worker-monitor.js', import.meta.url));
  if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      const helper = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$p = Start-Process -FilePath $env:LO_MONITOR_NODE -ArgumentList @($env:LO_MONITOR_SCRIPT,\'--data-directory\',$env:LO_MONITOR_DATA,\'--worker\',$env:LO_MONITOR_WORKER) -WorkingDirectory $env:LO_MONITOR_CWD -WindowStyle Normal -PassThru; $p.Id'
      ], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LO_MONITOR_NODE: process.execPath,
          LO_MONITOR_SCRIPT: script,
          LO_MONITOR_DATA: dataDirectory,
          LO_MONITOR_WORKER: worker.id,
          LO_MONITOR_CWD: cwd
        }
      });
      let stdout = '', stderr = '';
      helper.stdout.on('data', chunk => { stdout += chunk; });
      helper.stderr.on('data', chunk => { stderr += chunk; });
      helper.once('error', reject);
      helper.once('close', code => code === 0 ? resolve(Number(stdout.trim()) || null) : reject(new Error(stderr.trim() || `启动监视窗口失败，退出码 ${code}`)));
    });
  }
  const child = spawn(process.execPath, [script, '--data-directory', dataDirectory, '--worker', worker.id], { cwd, detached: true, stdio: 'ignore' });
  child.unref();
  return Promise.resolve(child.pid);
}
