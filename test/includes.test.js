import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandIncludes } from '../src/core/includes.js';
import { temporary, cleanup } from './helpers.js';

test('include directives expand safe line ranges into fenced code with a content hash', async t => {
  const root = await temporary('includes-');
  t.after(() => cleanup(root));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.ts'), ['line1', 'line2', 'line3', 'line4'].join('\n'), 'utf8');
  const expanded = expandIncludes('Before\n{{include path="src/app.ts" lines="2-3" lang="ts"}}\nAfter', root);
  assert.match(expanded, /Before/);
  assert.match(expanded, /`src\/app\.ts:2-3` · sha256:[0-9a-f]{12}/);
  assert.match(expanded, /```ts\nline2\nline3\n```/);
  assert.match(expanded, /After/);
});

test('include directives reject traversal and binary content', async t => {
  const root = await temporary('includes-unsafe-');
  t.after(() => cleanup(root));
  await writeFile(path.join(root, 'binary.txt'), Buffer.from([0, 1, 2, 3]));
  const traversal = expandIncludes('{{include path="../outside.txt"}}', root);
  assert.match(traversal, /Include error/);
  const binary = expandIncludes('{{include path="binary.txt"}}', root);
  assert.match(binary, /binary file is not supported/);
});
