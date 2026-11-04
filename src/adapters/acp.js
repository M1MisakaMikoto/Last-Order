import { fileURLToPath } from 'node:url';
import { StdioRpc } from './rpc.js';

export class DeepSeekRuntime {
  static async create(context, command = 'dsh') {
    const r = new DeepSeekRuntime(context, command);
    context.registerRuntime?.(r);
    try { await r.initialize(); return r; } catch (e) { await r.stop(); throw e; }
  }
  constructor(context, command) {
    this.context = context;
    this.rpc = new StdioRpc(command, ['--profile', 'acp'], { cwd: context.cwd }, (m, p) => this.request(m, p), (m, p) => this.notification(m, p));
  }
  async initialize() {
    const init = await this.rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'last-order', version: '0.1.0' }, clientCapabilities: {} });
    if (init.protocolVersion !== 1) throw new Error('Unsupported DSH ACP version');
    const params = { cwd: this.context.cwd, mcpServers: [{ name: 'schedule', command: process.execPath, args: [fileURLToPath(new URL('../../bin/mcp.js', import.meta.url))], env: [{ name: 'LO_ENDPOINT', value: this.context.endpoint }, { name: 'LO_TOKEN', value: this.context.token }] }] };
    const session = this.context.sessionId
      ? await this.rpc.request('session/resume', { ...params, sessionId: this.context.sessionId })
      : await this.rpc.request('session/new', params);
    this.sessionId = session.sessionId ?? this.context.sessionId;
    if (!this.sessionId) throw new Error('DSH returned no session identifier');
    await this.context.emit({ type: 'session', id: this.sessionId });
  }
  async request(method, params) {
    if (method !== 'session/request_permission') throw new Error('Unsupported ACP request: ' + method);
    const managerWrite = this.context.actor === 'manager' && ['edit', 'delete', 'move', 'execute'].includes(params.toolCall?.kind);
    const allow = managerWrite ? false : await this.context.emit({ type: 'approval', detail: params });
    const choice = params.options.find(x => x.kind === (allow ? 'allow_once' : 'reject_once'));
    return choice ? { outcome: { outcome: 'selected', optionId: choice.optionId } } : { outcome: { outcome: 'cancelled' } };
  }
  async notification(method, params) {
    await this.context.emit({ type: 'activity', method });
    if (method !== 'session/update') return;
    const update = params.update;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') await this.context.emit({ type: 'message', text: update.content.text });
    else if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) await this.context.emit({ type: 'message', role: 'tool', text: `${update.title ?? update.toolCallId}: ${update.status ?? ''}` });
  }
  async run(prompt) {
    const result = await this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: [{ type: 'text', text: this.context.instructions + '\n\n' + prompt }] }, 0);
    if (result.stopReason !== 'end_turn') throw new Error('DSH prompt stopped: ' + result.stopReason);
  }
  async stop() { await this.rpc.stop(); }
}
