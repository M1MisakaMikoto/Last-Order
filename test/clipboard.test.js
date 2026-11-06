import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText, readClipboard } from '../src/clipboard.js';

test('Linux clipboard explains SSH and headless sessions without a graphical display', async () => {
  for (const action of [
    () => copyText('clipboard text', 'linux', {}),
    () => readClipboard('linux', {})
  ]) {
    await assert.rejects(action, error => {
      assert.match(error.message, /DISPLAY/);
      assert.match(error.message, /WAYLAND_DISPLAY/);
      assert.match(error.message, /Ctrl\+Shift\+V/);
      return true;
    });
  }
});
