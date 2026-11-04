import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { monitorFrame, monitorLines, readWorkerSnapshot } from '../src/core/monitor.js';
import { temporary, cleanup } from './helpers.js';

test('worker monitor reads a live SQLite snapshot and formats tool results', async t => {
  const directory = await temporary('monitor-');
  const store = new Store(directory, {
    schemaVersion: 1,
    requests: {},
    pipelines: { p1: { id: 'p1', title: 'Build feature' } },
    workers: { w1: { id: 'w1', status: 'running', pipelineId: 'p1', provider: 'codex', kind: 'implement' } },
    notifications: [],
    manager: { sessionId: null, pending: [], epoch: 1 }
  });
  t.after(async () => { store.close(); await cleanup(directory); });
  store.commit('message', {
    role: 'tool',
    text: 'inspect 完成',
    tool: { id: 'call_1', name: 'inspect', status: 'completed', arguments: { id: 'w1' }, result: { ok: true } }
  }, () => {}, 'w1');

  const snapshot = readWorkerSnapshot(directory, 'w1');
  assert.equal(snapshot.worker.status, 'running');
  assert.equal(snapshot.pipeline.title, 'Build feature');
  const expandedActors = new Set(['w1']);
  const text = monitorLines(snapshot, 100, { expandedActors }).join('\n');
  assert.match(text, /Last Order · Worker Monitor · w1 · 运行中/);
  assert.match(text, /╭─ − 后台过程 #1 · 1 条 · inspect/);
  assert.match(text, /工具 · inspect · 完成 · call_1/);
  assert.match(text, /参数：[\s\S]*"id": "w1"/);
  assert.match(text, /"ok": true/);
  const frame = monitorFrame(snapshot, { columns: 100, rows: 20, expandedActors });
  assert.equal(frame.lines.length, 20);
  assert.match(frame.lines.at(-1), /跟随最新/);
});
