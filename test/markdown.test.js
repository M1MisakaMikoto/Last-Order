import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, styledWidth, stripFormatting } from '../src/markdown.js';

test('markdown renders ANSI formatting, lists, code blocks and OSC 8 links', () => {
  const lines = renderMarkdown([
    '## Result',
    '',
    '**bold** and `inline`',
    '',
    '- first',
    '- second',
    '',
    '[OpenAI](https://openai.com/docs)',
    '',
    '```js',
    'const answer = 42;',
    '```'
  ].join('\n'), 32);
  const text = lines.join('\n');
  assert.match(text, /\x1b\[1m\x1b\[4mResult/);
  assert.match(text, /\x1b\[1mbold/);
  assert.match(text, /\x1b\[36minline/);
  assert.match(text, /• first/);
  assert.match(text, /\x1b\]8;;https:\/\/openai\.com\/docs\x1b\\/);
  assert.match(text, /┌─ js/);
  assert.match(text, /const answer = 42/);
  assert.match(text, /lastorder-copy:/);
  assert.match(text, /\[copy code\]/);
  for (const line of lines) assert.ok(styledWidth(line) <= 32);
});

test('file mentions render as underlined clickable paths with line anchors', () => {
  const text = renderMarkdown('See {{file:src/app.ts#L10-L20}} and `src/other.ts:3`.', 100).join('\n');
  assert.match(text, /src\/app\.ts#L10-L20/);
  assert.match(text, /src\/other\.ts#L3/);
  assert.match(text, /\x1b\[4m/);
});

test('markdown allows relative file links but strips dangerous protocols', () => {
  const relative = renderMarkdown('[file](docs/requirements.md)', 80).join('\n');
  assert.match(relative, /\x1b\]8;;docs\/requirements\.md\x1b\\/);
  const unsafe = renderMarkdown('[bad](javascript:alert(1))', 80).join('\n');
  assert.doesNotMatch(unsafe, /\x1b\]8;;javascript/);
  assert.match(stripFormatting(unsafe), /bad/);
});
