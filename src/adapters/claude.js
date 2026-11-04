import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launch, terminate } from '../core/process.js';
import { deferred } from './rpc.js';

export function claudeArgs(context, configPath) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--permission-prompt-tool', 'stdio', '--mcp-config', configPath, '--append-system-prompt', context.instructions];
  if (context.model) args.push('--model', context.model);
  if (context.effort) args.push('--effort', context.effort);
  if (context.sessionId) args.push('--resume', context.sessionId);
  if (context.actor === 'manager') args.push('--disallowedTools', 'Bash,Edit,Write,NotebookEdit,Agent,Task');
  else if (context.readOnly) args.push('--disallowedTools', 'Edit,Write,NotebookEdit,Agent,Task');
  return args;
}

export class ClaudeRuntime {
  static async create(context, command = 'claude') {
    const configDirectory = path.join(context.dataDirectory, 'native'); await mkdir(configDirectory, { recursive: true });
    const configPath = path.join(configDirectory, `${context.actor}-${context.epoch}.json`);
    await writeFile(configPath, JSON.stringify({ mcpServers: { schedule: { command: process.execPath, args: [fileURLToPath(new URL('../../bin/mcp.js', import.meta.url))], env: { LO_ENDPOINT: context.endpoint, LO_TOKEN: context.token } } } }), { mode: 0o600 });
    const args = claudeArgs(context, configPath);
    const runtime = new ClaudeRuntime(context, command, args);
    context.registerRuntime?.(runtime);
    try { await runtime.initialize(); return runtime; } catch (e) { await runtime.stop(); throw e; }
  }
  constructor(context, command, args) {
    this.context = context; this.controls = new Map();
    this.child = launch(command, args, { cwd: context.cwd, guard: true });
    this.child.stdin.on('error', e => this.fail(e));
    this.child.once('error', e => this.fail(e));
    this.child.once('exit', code => this.fail(new Error(`Claude exited (${code}) ${this.stderr ?? ''}`)));
    this.child.stderr.on('data', b => { this.stderr = ((this.stderr ?? '') + b).slice(-4000); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try { const message = JSON.parse(line); Promise.resolve(this.message(message)).catch(e => this.fail(e)); }
      catch (e) { this.fail(new Error('Invalid Claude protocol: ' + e.message)); }
    });
  }
  write(message) { if (!this.closed) this.child.stdin.write(JSON.stringify(message) + '\n'); }
  async initialize() {
    const requestId = randomUUID(), p = deferred();
    const timer = setTimeout(() => p.reject(new Error('Claude initialize timed out; check CLI version')), 30_000);
    this.controls.set(requestId, p);
    this.write({ type: 'control_request', request_id: requestId, request: { subtype: 'initialize' } });
    try { await p.promise; } finally { clearTimeout(timer); this.controls.delete(requestId); }
  }
  async message(msg) {
    await this.context.emit({ type: 'activity', method: msg.type });
    if (msg.type === 'control_response') {
      const p = this.controls.get(msg.response.request_id);
      if (msg.response.subtype === 'error') p?.reject(new Error(msg.response.error)); else p?.resolve(msg.response.response);
    }
    if (msg.type === 'system' && msg.session_id) { this.sessionId = msg.session_id; await this.context.emit({ type: 'session', id: msg.session_id }); }
    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') await this.context.emit({ type: 'message', text: block.text });
        if (block.type === 'tool_use') await this.context.emit({ type: 'message', role: 'tool', text: `${block.name}: ${JSON.stringify(block.input).slice(0, 4000)}` });
      }
    }
    if (msg.type === 'result') {
      if (msg.session_id) await this.context.emit({ type: 'session', id: msg.session_id });
      msg.is_error ? this.turn?.reject(new Error(msg.result ?? msg.errors?.join('\n') ?? 'Claude turn failed')) : this.turn?.resolve();
    }
    if (msg.type === 'control_request') {
      if (msg.request.subtype !== 'can_use_tool') {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: msg.request_id, error: 'Unsupported control request: ' + msg.request.subtype } }); return;
      }
      const r = msg.request;
      let response;
      if (r.tool_name.startsWith('mcp__schedule__')) response = { behavior: 'allow', updatedInput: r.input };
      else if (r.tool_name === 'AskUserQuestion') {
        const answer = await this.context.emit({ type: 'question', detail: r.input });
        response = { behavior: 'allow', updatedInput: { ...r.input, answers: Object.fromEntries((r.input.questions ?? []).map(q => [q.question, answer])) } };
      } else if (this.context.actor === 'manager' && !['Read', 'Glob', 'Grep', 'ToolSearch', 'ListMcpResourcesTool', 'ReadMcpResourceTool'].includes(r.tool_name)) {
        response = { behavior: 'deny', message: 'Manager only schedules and inspects. Delegate implementation and verification to workers.' };
      } else {
        const allowed = await this.context.emit({ type: 'approval', detail: { tool: r.tool_name, input: r.input, reason: r.decision_reason } });
        response = allowed ? { behavior: 'allow', updatedInput: r.input } : { behavior: 'deny', message: 'User denied this request' };
      }
      this.write({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } });
    }
  }
  fail(error) { if (this.closed) return; this.closed = true; this.turn?.reject(error); for (const p of this.controls.values()) p.reject(error); }
  async run(prompt) {
    if (this.closed) throw new Error('Claude transport closed');
    if (this.turn) throw new Error('Claude turn already active');
    this.turn = deferred();
    this.write({ type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null, session_id: this.sessionId ?? '' });
    try { await this.turn.promise; } finally { this.turn = null; }
  }
  async stop() { this.fail(new Error('Claude stopped')); await terminate(this.child); this.lines.close(); }
}
