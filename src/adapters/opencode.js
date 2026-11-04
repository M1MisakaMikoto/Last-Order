import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launch, terminate } from '../core/process.js';

export class OpenCodeRuntime {
  static async create(context, command = 'opencode') {
    const r = new OpenCodeRuntime(context, command);
    context.registerRuntime?.(r);
    try { await r.initialize(); return r; } catch (e) { await r.stop(); throw e; }
  }
  constructor(context, command) {
    this.context = context; this.abort = new AbortController();
    const password = randomBytes(24).toString('hex');
    this.auth = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
    this.agent = context.actor === 'manager' ? 'last-order-manager' : 'last-order-worker';
    const config = {
      agent: {
        [this.agent]: {
          mode: 'primary', description: 'Mission Control managed role', prompt: context.instructions,
          ...(context.model ? { model: context.model } : {}),
          ...(context.actor === 'manager' ? { permission: { edit: 'deny', bash: 'deny', task: 'deny' } } : {})
        }
      },
      mcp: { schedule: { type: 'local', command: [process.execPath, fileURLToPath(new URL('../../bin/mcp.js', import.meta.url))], environment: { LO_ENDPOINT: context.endpoint, LO_TOKEN: context.token }, enabled: true } }
    };
    this.child = launch(command, ['serve', '--hostname', '127.0.0.1', '--port', '0'], { cwd: context.cwd, env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, guard: true });
    this.ready = new Promise((resolve, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('OpenCode server startup timed out')), 30_000);
      const read = b => { output = (output + b).slice(-8000); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timer); this.url = match[0]; resolve(); } };
      this.child.stdout.on('data', read); this.child.stderr.on('data', read);
      this.child.once('error', e => { clearTimeout(timer); reject(e); });
      this.child.once('exit', code => { clearTimeout(timer); this.abort.abort(); reject(new Error(`OpenCode server exited (${code}): ${output}`)); });
    });
  }
  async request(method, route, body) {
    const response = await fetch(this.url + route + (route.includes('?') ? '&' : '?') + 'directory=' + encodeURIComponent(this.context.cwd), { method, headers: { authorization: this.auth, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: this.abort.signal });
    if (!response.ok) { const error = new Error(`OpenCode ${route}: ${response.status} ${(await response.text()).slice(0, 2000)}`); error.status = response.status; throw error; }
    return response.status === 204 ? null : response.json();
  }
  async initialize() {
    await this.ready;
    const providers = await this.request('GET', '/provider');
    if (Array.isArray(providers.connected) && !providers.connected.length) throw new Error('OpenCode has no configured model provider. Run opencode auth login or configure a provider before retrying.');
    const session = this.context.sessionId ? await this.request('GET', '/session/' + encodeURIComponent(this.context.sessionId)) : await this.request('POST', '/session', { title: this.context.actor });
    this.sessionId = session.id; await this.context.emit({ type: 'session', id: this.sessionId });
    const response = await fetch(this.url + '/event?directory=' + encodeURIComponent(this.context.cwd), { headers: { authorization: this.auth }, signal: this.abort.signal });
    if (!response.ok) throw new Error('OpenCode event subscription failed');
    this.events = this.readEvents(response).catch(error => { if (!this.abort.signal.aborted) { this.eventError = error; this.abort.abort(); } });
  }
  async readEvents(response) {
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').filter(x => x.startsWith('data:')).map(x => x.slice(5).trimStart()).join('\n');
        if (data) this.event(JSON.parse(data)).catch(e => { this.eventError = e; this.abort.abort(); });
      }
    }
    if (!this.abort.signal.aborted) throw new Error('OpenCode event stream disconnected; stopping to preserve approvals');
  }
  async event(event) {
    const e = event.payload ?? event, p = e.properties ?? {};
    const sessionId = p.sessionID ?? p.part?.sessionID ?? p.info?.sessionID;
    if (sessionId && sessionId !== this.sessionId) return;
    await this.context.emit({ type: 'activity', method: e.type });
    if (e.type === 'session.error') throw new Error('OpenCode session error: ' + JSON.stringify(p.error ?? p));
    if (e.type === 'session.status' && p.status?.type === 'retry') {
      const message = p.status.message ?? JSON.stringify(p.status);
      await this.context.emit({ type: 'message', role: 'system', text: 'OpenCode retry: ' + message });
      if (/free usage exceeded|insufficient[_ ]quota|credit balance|payment required|quota.*(?:exhausted|exceeded)/iu.test(message)) throw new Error('OpenCode provider requires usable quota or credentials: ' + message);
    }
    if (e.type === 'permission.asked' || e.type === 'permission.updated') {
      const allowed = await this.context.emit({ type: 'approval', detail: p });
      if (e.type === 'permission.asked') {
        try { await this.request('POST', '/permission/' + encodeURIComponent(p.id) + '/reply', { reply: allowed ? 'once' : 'reject' }); return; }
        catch (error) { if (error.status !== 404) throw error; }
      }
      await this.request('POST', `/session/${this.sessionId}/permissions/${encodeURIComponent(p.id)}`, { response: allowed ? 'once' : 'reject', remember: false });
    }
    if (e.type === 'question.asked') {
      const answer = await this.context.emit({ type: 'question', detail: p });
      await this.request('POST', '/question/' + encodeURIComponent(p.id) + '/reply', { answers: (p.questions ?? [null]).map(() => [answer]) });
    }
    if (e.type === 'message.part.updated' && p.part?.type === 'tool') await this.context.emit({ type: 'message', role: 'tool', text: `${p.part.tool}: ${p.part.state?.status}` });
  }
  async run(prompt) {
    let output;
    try { output = await this.request('POST', '/session/' + this.sessionId + '/message', { agent: this.agent, parts: [{ type: 'text', text: prompt }] }); }
    catch (error) { throw this.eventError ?? error; }
    if (this.eventError) throw this.eventError;
    if (output.info?.error) throw new Error(JSON.stringify(output.info.error));
    for (const part of output.parts ?? []) if (part.type === 'text') await this.context.emit({ type: 'message', text: part.text });
  }
  async stop() { this.abort.abort(); await terminate(this.child); await this.events; }
}
