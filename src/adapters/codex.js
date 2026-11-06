import { StdioRpc, deferred } from './rpc.js';
import { randomUUID } from 'node:crypto';

const TOOL_ITEM_TYPES = ['commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'];
function toolDetail(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.type === 'mcpToolCall' ? `${item.server}.${item.tool}` : item.tool ?? (item.command ? 'command' : item.type),
    status: item.status ?? 'running',
    arguments: item.arguments ?? (item.command ? { command: item.command, cwd: item.cwd } : item.action ?? null),
    result: item.contentItems ?? item.result ?? item.aggregatedOutput ?? null,
    error: item.error?.message ?? item.error ?? null,
    exitCode: item.exitCode,
    durationMs: item.durationMs,
    changes: item.changes
  };
}

export class CodexRuntime {
  static async create(context, command = 'codex') {
    const runtime = new CodexRuntime(context, command);
    context.registerRuntime?.(runtime);
    try { await runtime.initialize(); return runtime; } catch (error) { await runtime.stop(); throw error; }
  }
  constructor(context, command) {
    this.context = context;
    this.agentMessageStreams = new Map();
    this.agentMessagePhases = new Map();
    this.lastPartialAnswer = null;
    this.lastFinalAnswer = null;
    this.finalAnswerStreamId = null;
    this.sawFinalAnswer = false;
    this.rpc = new StdioRpc(command, ['app-server', '--stdio'], { cwd: context.cwd }, (m, p) => this.request(m, p), (m, p) => this.notification(m, p));
    this.rpc.onError = e => this.turn?.reject(e);
  }
  async initialize() {
    await this.rpc.request('initialize', { clientInfo: { name: 'last-order', title: 'Last Order', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.rpc.notify('initialized', {});
    const options = {
      cwd: this.context.cwd, developerInstructions: this.context.instructions,
      approvalPolicy: 'on-request', approvalsReviewer: this.context.actor === 'manager' ? 'user' : this.context.codexApprovals ?? 'auto_review',
      sandbox: this.context.actor === 'manager' || this.context.readOnly ? 'read-only' : 'workspace-write',
      ...(this.context.model ? { model: this.context.model } : {}),
      ...(this.context.effort ? { config: { model_reasoning_effort: this.context.effort } } : {})
    };
    let response;
    if (this.context.sessionId) {
      try {
        response = await this.rpc.request('thread/resume', { ...options, threadId: this.context.sessionId });
      } catch (error) {
        const stale = /no rollout found|thread.*not found|unknown thread/i.test(error.message);
        const paginatedUnsupported = /paginated_threads.*not supported|not supported.*paginated_threads/i.test(error.message);
        if (!stale && !paginatedUnsupported) throw error;
        if (paginatedUnsupported) {
          await this.context.emit({
            type: 'message', role: 'warning',
            text: `The installed Codex CLI cannot resume this paginated thread (${error.message}). Starting a new native thread; Last Order history and task state are preserved.`
          });
          await this.context.emit({ type: 'activity', method: 'thread/resume/paginated-unsupported' });
        } else {
          await this.context.emit({ type: 'activity', method: 'thread/resume/stale' });
        }
        response = await this.rpc.request('thread/start', { ...options, dynamicTools: this.context.tools.map(t => ({ type: 'function', ...t })) });
      }
    } else {
      response = await this.rpc.request('thread/start', { ...options, dynamicTools: this.context.tools.map(t => ({ type: 'function', ...t })) });
    }
    this.threadId = response.thread.id;
    await this.context.emit({ type: 'session', id: this.threadId });
  }
  async request(method, params) {
    if (method === 'item/tool/call') {
      try { const result = await this.context.callTool(params.tool, params.arguments, params.callId); return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] }; }
      catch (e) { return { success: false, contentItems: [{ type: 'inputText', text: e.message }] }; }
    }
    if (/requestApproval$/.test(method)) {
      // Managers cannot escalate native writes/commands beyond their read-only role.
      const allow = this.context.actor === 'manager' ? false : await this.context.emit({ type: 'approval', detail: { method, ...params } });
      if (method === 'item/permissions/requestApproval') return { permissions: allow ? params.permissions : {}, scope: 'turn' };
      const denial = Array.isArray(params.availableDecisions) && !params.availableDecisions.includes('decline') && params.availableDecisions.includes('cancel') ? 'cancel' : 'decline';
      return { decision: allow ? 'accept' : denial };
    }
    if (method === 'item/tool/requestUserInput') {
      const answer = await this.context.emit({ type: 'question', detail: params });
      return { answers: Object.fromEntries(params.questions.map(q => [q.id, { answers: [answer] }])) };
    }
    if (method === 'currentTime/read') return { time: new Date().toISOString() };
    throw new Error('Unsupported Codex server request: ' + method);
  }
  async notification(method, params) {
    await this.context.emit({ type: 'activity', method });
    if (method === 'item/started' && params.item?.type === 'agentMessage') {
      this.agentMessagePhases.set(params.item.id, params.item.phase ?? null);
    }
    if (method === 'item/agentMessage/delta') {
      const text = (this.agentMessageStreams.get(params.itemId) ?? '') + params.delta;
      const phase = this.agentMessagePhases.get(params.itemId) ?? null;
      this.agentMessageStreams.set(params.itemId, text);
      if (phase === 'partial_answer') this.lastPartialAnswer = { id: params.itemId, text };
      if (phase === 'final_answer') {
        this.finalAnswerStreamId ??= randomUUID();
        this.lastFinalAnswer = { id: this.finalAnswerStreamId, text };
      }
      await this.context.emit({
        type: 'message', id: phase === 'final_answer' ? this.finalAnswerStreamId : params.itemId,
        text, role: 'assistant', streaming: true,
        background: phase === 'commentary' || phase === 'partial_answer'
      });
    }
    if (method === 'item/completed' && params.item?.type === 'agentMessage') {
      const id = params.item.id;
      const phase = params.item.phase ?? this.agentMessagePhases.get(id) ?? null;
      const text = params.item.text ?? this.agentMessageStreams.get(id) ?? '';
      if (phase === 'final_answer') {
        this.sawFinalAnswer = true;
        this.finalAnswerStreamId ??= randomUUID();
        this.lastFinalAnswer = { id: this.finalAnswerStreamId, text };
      }
      if (phase === 'partial_answer') this.lastPartialAnswer = { id, text };
      if (phase === 'final_answer') {
        // Keep the terminal stream open so multiple final-answer items in one
        // turn commit only the last one at turn completion.
      } else if (id && this.agentMessageStreams.has(id)) {
        this.agentMessageStreams.delete(id);
        await this.context.emit({
          type: 'message', id, text, role: 'assistant', streaming: false,
          background: phase === 'commentary' || phase === 'partial_answer'
        });
      } else {
        await this.context.emit({ type: 'message', text, background: phase === 'commentary' || phase === 'partial_answer' });
      }
      this.agentMessagePhases.delete(id);
    }
    if (TOOL_ITEM_TYPES.includes(params.item?.type) && ['item/started', 'item/completed'].includes(method)) {
      const phase = method === 'item/started' ? '开始' : '完成';
      await this.context.emit({ type: 'message', role: 'tool', text: `${params.item.type} ${phase}`, tool: toolDetail(params.item) });
    }
    if (method === 'item/autoApprovalReview/started') await this.context.emit({ type: 'message', role: 'tool', text: `Codex 自动审批中：${JSON.stringify(params.action)}` });
    if (method === 'item/autoApprovalReview/completed') {
      const review = params.review ?? {}, approved = review.status === 'approved';
      await this.context.emit({ type: 'message', role: approved ? 'tool' : 'error', text: `Codex 自动审批${approved ? '通过' : '未通过'} (${review.status})：${review.rationale ?? ''}\n${JSON.stringify(params.action)}` });
    }
    if (method === 'guardianWarning') await this.context.emit({ type: 'message', role: /^Automatic approval review approved\b/i.test(params.message) ? 'tool' : 'error', text: params.message });
    if (method === 'turn/completed') {
      if (params.turn.status === 'completed') {
        if (this.lastFinalAnswer) {
          await this.context.emit({
            type: 'message', id: this.lastFinalAnswer.id, text: this.lastFinalAnswer.text,
            role: 'assistant', streaming: false, background: false
          });
        } else if (this.lastPartialAnswer && !this.sawFinalAnswer) {
          await this.context.emit({ type: 'message', text: this.lastPartialAnswer.text });
        }
        this.turn?.resolve();
      }
      else this.turn?.reject(new Error(params.turn.error?.message ?? 'Turn ' + params.turn.status));
    }
    if (method === 'error' && !params.willRetry) this.turn?.reject(new Error(params.error?.message ?? 'Codex error'));
  }
  async run(prompt, options = {}) {
    if (this.turn) throw new Error('Codex turn already active');
    this.lastPartialAnswer = null; this.lastFinalAnswer = null; this.finalAnswerStreamId = null;
    this.sawFinalAnswer = false; this.agentMessagePhases?.clear();
    this.turn = deferred();
    // Attach a rejection handler before the start response can race a failure.
    this.turn.promise.catch(() => {});
    try {
      const r = await this.rpc.request('turn/start', {
        threadId: this.threadId,
        input: [
          { type: 'text', text: prompt },
          ...(options.attachments ?? []).map(image => ({ type: 'localImage', path: image.path }))
        ]
      });
      this.turnId = r.turn.id; await this.turn.promise;
      await this.context.emit({ type: 'turn', id: this.turnId });
    } finally {
      this.agentMessageStreams?.clear(); this.agentMessagePhases?.clear();
      this.lastPartialAnswer = null; this.lastFinalAnswer = null; this.finalAnswerStreamId = null; this.sawFinalAnswer = false;
      this.turn = null;
    }
  }
  async listTurns({ limit = 50, sortDirection = 'desc', itemsView = 'summary' } = {}) {
    if (!this.threadId) throw new Error('Codex thread is not initialized');
    return this.rpc.request('thread/turns/list', {
      threadId: this.threadId, limit, sortDirection, itemsView
    });
  }
  async forkThread({ threadId, lastTurnId, beforeTurnId, ephemeral = false } = {}) {
    if (!this.threadId) throw new Error('Codex thread is not initialized');
    if (lastTurnId && beforeTurnId) throw new Error('Use either lastTurnId or beforeTurnId, not both');
    const response = await this.rpc.request('thread/fork', {
      threadId: threadId ?? this.threadId,
      ...(lastTurnId ? { lastTurnId } : {}),
      ...(beforeTurnId ? { beforeTurnId } : {}),
      ephemeral,
      excludeTurns: true
    });
    if (response.thread?.id) {
      this.threadId = response.thread.id;
      await this.context.emit({ type: 'session', id: this.threadId });
    }
    return response.thread ?? response;
  }
  async revertThread({ beforeTurnId } = {}) {
    if (!this.threadId) throw new Error('Codex thread is not initialized');
    if (!beforeTurnId) throw new Error('beforeTurnId is required');
    return this.rpc.request('thread/revert', { threadId: this.threadId, beforeTurnId });
  }
  async stop() { await this.rpc.stop(); }
}
