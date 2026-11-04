import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeRuntime } from '../src/adapters/opencode.js';

test('OpenCode exhausted quota is surfaced instead of remaining in an endless retry', async () => {
  const messages = [];
  const runtime = { sessionId: 'test-session', context: { emit: async event => messages.push(event) } };
  await assert.rejects(OpenCodeRuntime.prototype.event.call(runtime, { type: 'session.status', properties: { sessionID: 'test-session', status: { type: 'retry', message: 'Free usage exceeded, subscribe to Go' } } }), /requires usable quota/);
  assert.ok(messages.some(e => e.type === 'message' && e.text.includes('Free usage exceeded')));
});
test('temporary OpenCode rate limiting retains the native retry behavior', async () => {
  const runtime = { sessionId: 'test-session', context: { emit: async () => {} } };
  await assert.doesNotReject(OpenCodeRuntime.prototype.event.call(runtime, { type: 'session.status', properties: { sessionID: 'test-session', status: { type: 'retry', message: 'Temporary rate limit; retry in 5 seconds' } } }));
});
