import test from 'node:test';
import assert from 'node:assert/strict';
import { finished } from 'node:stream/promises';
import { emitKeypressEvents } from 'node:readline';
import { once } from 'node:events';
import { TerminalInput } from '../src/terminal-input.js';

test('split SGR wheel and click reports never become typed input', async () => {
  const scrolls = [], output = [];
  const input = new TerminalInput(delta => scrolls.push(delta));
  input.on('data', chunk => output.push(chunk));
  for (const part of ['draft', '\x1b[<6', '4;10;', '5M', '\x1b[<65;10;5M', '\x1b[<0;10;5M', '\x1b[<0;10;5m', '\x1b[<66;10;5M', 'tail']) input.write(part);
  input.end(); await finished(input);
  assert.deepEqual(scrolls, [-3, 3]);
  assert.equal(Buffer.concat(output).toString(), 'drafttail');
});

test('mouse filtering preserves split UTF-8 and keyboard navigation and handles legacy wheels', async () => {
  const scrolls = [], keys = [], input = new TerminalInput(delta => scrolls.push(delta));
  emitKeypressEvents(input); input.on('keypress', (text, key) => keys.push(key));
  const chinese = Buffer.from('你好');
  input.write(chinese.subarray(0, 2)); input.write(chinese.subarray(2));
  input.write('\x1b'); input.write('[A'); input.write('\x1b[1;2A'); input.write('\x1b[1;2B'); input.write('\x1b[6~');
  input.write('\x1b[M' + String.fromCharCode(96, 42, 37));
  input.end('\x1b[M' + String.fromCharCode(97, 42, 37)); await finished(input);
  assert.deepEqual(keys.map(key => key.name ?? key.sequence), ['你', '好', 'up', 'up', 'down', 'pagedown']);
  assert.deepEqual(keys.slice(3, 5).map(key => key.shift), [true, true]);
  assert.deepEqual(scrolls, [-3, 3]);
});

test('a standalone Escape is delivered so command suggestions can be dismissed', async () => {
  const input = new TerminalInput(() => {});
  emitKeypressEvents(input, { escapeCodeTimeout: 30 });
  const key = once(input, 'keypress');
  input.write('\x1b');
  const [, result] = await key;
  assert.equal(result.name, 'escape');
  input.end(); await finished(input);
});

test('SGR mouse drag events preserve moving coordinates while wheel stays separate', async () => {
  const scrolls = [], mouse = [], input = new TerminalInput(delta => scrolls.push(delta), event => mouse.push(event));
  input.resume();
  input.write('\x1b[<0;5;3M');
  input.write('\x1b[<32;9;4M');
  input.write('\x1b[<0;9;4m');
  input.write('\x1b[<65;9;4M');
  input.end(); await finished(input);
  assert.deepEqual(mouse.map(event => [event.type, event.x, event.y]), [['down', 5, 3], ['drag', 9, 4], ['up', 9, 4]]);
  assert.deepEqual(scrolls, [3]);
});

test('bracketed paste preserves multiline text without becoming Enter keypresses', async () => {
  const pastes = [], output = [], keys = [];
  const input = new TerminalInput(() => {}, () => {}, text => pastes.push(text));
  emitKeypressEvents(input); input.on('keypress', (_text, key) => keys.push(key));
  input.on('data', chunk => output.push(chunk));
  for (const part of ['before', '\x1b[20', '0~line1\r\nline', '2', '\x1b[20', '1~after']) input.write(part);
  input.end(); await finished(input);
  assert.deepEqual(pastes, ['line1\r\nline2']);
  assert.equal(Buffer.concat(output).toString(), 'beforeafter');
  assert.equal(keys.some(key => key.name === 'return'), false);
});
