// Protocol fixture only: deterministic subprocess, no model or real agent execution.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const args = process.argv.slice(2);
const mode = args[0] === 'app-server' ? 'codex' : args[0] === '--profile' ? 'dsh' : args[0] === 'serve' ? 'opencode' : 'claude';
const output = message => process.stdout.write(JSON.stringify(message) + '\n');
const result = { status: 'succeeded', summary: 'Fixture completed', evidence: 'Protocol fixture, not a real CLI' };
let env, turnId = 'turn-fixture', permissionResponse;
async function callTool() {
  const response = await fetch(env.LO_ENDPOINT + '/call', { method: 'POST', headers: { authorization: 'Bearer ' + env.LO_TOKEN }, body: JSON.stringify({ name: 'report_result', arguments: result }) });
  if (!response.ok) throw new Error(await response.text());
}
if (mode === 'opencode') {
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT); env = config.mcp.schedule.environment; let events;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64')) { res.writeHead(401).end(); return; }
    const url = new URL(req.url, 'http://localhost'); let body = ''; for await (const data of req) body += data;
    if (url.pathname === '/event') { events = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"type":"server.connected"}\n\n'); return; }
    res.setHeader('content-type', 'application/json');
    if (url.pathname === '/provider') return res.end(JSON.stringify({ connected: ['fixture'], all: [] }));
    if (url.pathname === '/session' || (url.pathname === '/session/session-fixture' && req.method === 'GET')) return res.end(JSON.stringify({ id: 'session-fixture' }));
    if (url.pathname.endsWith('/message')) {
      if (!JSON.parse(body).parts[0].text) throw new Error('Missing prompt');
      events.write('data: ' + JSON.stringify({ type: 'permission.asked', properties: { id: 'permission-fixture', sessionID: 'session-fixture', permission: 'bash', patterns: ['fixture'] } }) + '\n\n');
      const decision = await new Promise(resolve => { permissionResponse = resolve; });
      if (decision !== 'once') { res.statusCode = 400; return res.end('{}'); }
      await callTool(); return res.end(JSON.stringify({ info: { role: 'assistant' }, parts: [{ type: 'text', text: 'Fixture done' }] }));
    }
    if (url.pathname === '/permission/permission-fixture/reply') { permissionResponse(JSON.parse(body).reply); return res.end('{}'); }
    res.writeHead(404).end('{}');
  });
  server.listen(0, '127.0.0.1', () => console.log('opencode server listening on http://127.0.0.1:' + server.address().port));
} else {
  if (mode === 'claude') {
    const config = JSON.parse(readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8')); env = config.mcpServers.schedule.env;
  }
  const lines = createInterface({ input: process.stdin });
  lines.on('line', line => handle(JSON.parse(line)).catch(error => { console.error(error); process.exitCode = 1; }));
  async function handle(msg) {
    if (mode === 'claude') {
      if (msg.type === 'control_request') {
        output({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: {} } });
        output({ type: 'system', subtype: 'init', session_id: 'session-fixture' });
      }
      if (msg.type === 'user') output({ type: 'control_request', request_id: 'approval-fixture', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'echo fixture' } } });
      if (msg.type === 'control_response') {
        if (msg.response.response.behavior !== 'allow') throw new Error('Fixture was denied');
        await callTool(); output({ type: 'assistant', message: { content: [{ type: 'text', text: 'Fixture done' }] } }); output({ type: 'result', is_error: false, session_id: 'session-fixture' });
      }
      return;
    }
    const reply = result => output({ jsonrpc: '2.0', id: msg.id, result });
    if (msg.method === 'initialize') { reply(mode === 'codex' ? { userAgent: 'fixture' } : { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } }); return; }
    if (['thread/start', 'thread/resume'].includes(msg.method)) { reply({ thread: { id: 'session-fixture' } }); return; }
    if (['session/new', 'session/resume'].includes(msg.method)) { env = Object.fromEntries(msg.params.mcpServers[0].env.map(x => [x.name, x.value])); reply({ sessionId: 'session-fixture' }); return; }
    if (msg.method === 'turn/start') {
      reply({ turn: { id: turnId } });
      output({ id: 'approval-fixture', method: 'item/commandExecution/requestApproval', params: { threadId: 'session-fixture', turnId, command: 'echo fixture' } }); return;
    }
    if (msg.method === 'session/prompt') {
      turnId = msg.id;
      output({ jsonrpc: '2.0', id: 'approval-fixture', method: 'session/request_permission', params: { sessionId: 'session-fixture', toolCall: { title: 'fixture command' }, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } }); return;
    }
    if (msg.id === 'approval-fixture') {
      if (mode === 'codex') {
        if (msg.result.decision !== 'accept') throw new Error('Approval mapping incorrect');
        output({ id: 'tool-fixture', method: 'item/tool/call', params: { threadId: 'session-fixture', turnId, callId: 'report', tool: 'report_result', arguments: result } });
      } else {
        if (msg.result.outcome.optionId !== 'yes') throw new Error('ACP approval mapping incorrect');
        await callTool(); output({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'session-fixture', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Fixture done' } } } }); output({ jsonrpc: '2.0', id: turnId, result: { stopReason: 'end_turn' } });
      }
    }
    if (msg.id === 'tool-fixture') {
      if (!msg.result.success) throw new Error('Tool callback failed');
      output({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Fixture done' } } }); output({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } });
    }
  }
}
