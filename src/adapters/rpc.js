import { createInterface } from 'node:readline';
import { launch, terminate } from '../core/process.js';

export function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

export class StdioRpc {
  constructor(command, args, options, handleRequest, handleNotification) {
    this.nextId = 0; this.pending = new Map(); this.closed = false;
    this.child = launch(command, args, { ...options, guard: true });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.once('error', error => this.fail(error));
    this.child.once('exit', (code, signal) => this.fail(new Error(`Agent process exited (${code ?? signal})`)));
    this.child.stderr.on('data', data => { this.stderr = ((this.stderr ?? '') + data).slice(-6000); });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      try {
        if (line.length > 8_000_000) throw new Error('RPC line too large');
        const msg = JSON.parse(line);
        if (msg.method && msg.id !== undefined) {
          Promise.resolve(handleRequest(msg.method, msg.params ?? {})).then(result => this.write({ id: msg.id, result }), error => this.write({ id: msg.id, error: { code: -32000, message: error.message } }));
        } else if (msg.method) Promise.resolve(handleNotification(msg.method, msg.params ?? {})).catch(error => this.onError?.(error));
        else if (this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id); clearTimeout(p.timer);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        }
      } catch (error) { this.fail(new Error('Invalid agent protocol: ' + error.message)); }
    });
  }
  write(msg) { if (!this.closed) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n'); }
  request(method, params, timeout = 30_000) {
    if (this.closed) return Promise.reject(new Error('Agent transport closed: ' + (this.stderr ?? '')));
    const id = ++this.nextId, p = deferred();
    if (timeout) p.timer = setTimeout(() => { this.pending.delete(id); p.reject(new Error(method + ' timed out')); }, timeout);
    this.pending.set(id, p); this.write({ id, method, params }); return p.promise;
  }
  notify(method, params) { this.write({ method, params }); }
  fail(error) {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error(error.message + (this.stderr ? '\n' + this.stderr : ''))); }
    this.pending.clear(); this.onError?.(error);
  }
  async stop() { this.fail(new Error('Agent stopped')); await terminate(this.child); this.lines.close(); }
}
