#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
const endpoint = process.env.LO_ENDPOINT, token = process.env.LO_TOKEN;
const nonce = randomUUID();
async function rpc(route, data = {}) {
  const result = await fetch(endpoint + route, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const body = await result.json(); if (body.error) throw new Error(body.error); return body.result;
}
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  let message;
  try {
    if (line.length > 1_000_000) throw new Error('MCP request too large');
    message = JSON.parse(line); if (message.id === undefined) continue;
    let result;
    if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'schedule-table', version: '0.1.0' } };
    else if (message.method === 'ping') result = {};
    else if (message.method === 'tools/list') result = { tools: await rpc('/tools') };
    else if (message.method === 'tools/call') {
      try { result = { content: [{ type: 'text', text: JSON.stringify(await rpc('/call', { ...message.params, callId: nonce + ':' + message.id })) }] }; }
      catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
    } else throw new Error('Unsupported MCP method: ' + message.method);
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
  } catch (error) { if (message?.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: error.message } }) + '\n'); }
}
