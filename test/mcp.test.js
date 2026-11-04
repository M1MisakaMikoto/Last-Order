import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MissionControlService } from '../src/core/service.js';
import { StdioRpc } from '../src/adapters/rpc.js';
import { temporary, cleanup } from './helpers.js';

test('MCP bridge exposes role-scoped tools and rejects unauthenticated local requests', async t => {
  const directory = await temporary('mcp-');
  const service = new MissionControlService({ directory, root: directory }, async () => { throw new Error('No model should run'); });
  let rpc;
  t.after(async () => { await rpc?.stop(); await service.stop(); await cleanup(directory); });
  await service.start(); const c = service.context('manager', service.state.manager.epoch, '', directory, null);
  rpc = new StdioRpc(process.execPath, [fileURLToPath(new URL('../bin/mcp.js', import.meta.url))], { cwd: directory, env: { ...process.env, LO_ENDPOINT: c.endpoint, LO_TOKEN: c.token } }, async () => {}, () => {});
  const init = await rpc.request('initialize', { protocolVersion: '2024-11-05', clientInfo: { name: 'test', version: '1' }, capabilities: {} });
  assert.equal(init.serverInfo.name, 'schedule-table');
  const tools = await rpc.request('tools/list', {});
  assert.ok(tools.tools.some(t => t.name === 'start_worker'));
  assert.ok(tools.tools.some(t => t.name === 'update_worker_notes'));
  assert.ok(tools.tools.some(t => t.name === 'remember_manager_guidance'));
  assert.ok(!tools.tools.some(t => t.name === 'register_pipeline'));
  assert.ok(!tools.tools.some(t => t.name === 'report_result'));
  const output = await rpc.request('tools/call', { name: 'inspect', arguments: {} }); assert.equal(JSON.parse(output.content[0].text).schemaVersion, 1);
  const denied = await rpc.request('tools/call', { name: 'report_result', arguments: { status: 'succeeded', summary: 'unauthorized' } }); assert.equal(denied.isError, true);
  const unauthorized = await fetch(service.endpoint + '/tools', { method: 'POST', body: '{}' }); assert.equal(unauthorized.status, 401);
});
