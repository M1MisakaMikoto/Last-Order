import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, styledWidth, stripFormatting } from '../src/markdown.js';
import { fitStyled } from '../src/conversation-view.js';

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

test('styled fitting preserves OSC 8 links while respecting visible width', () => {
  const styled = '\x1b]8;;docs/app.ts#L3\x1b\\\x1b[4mapp.ts\x1b[0m\x1b]8;;\x1b\\ tail';
  const fitted = fitStyled(styled, 12);
  assert.match(fitted, /\x1b\]8;;docs\/app\.ts#L3/);
  assert.match(fitted, /\x1b\[4m/);
  assert.ok(styledWidth(fitted) <= 12);
});

test('markdown tables render with borders, wrapping and Chinese width handling', () => {
  const source = [
    '| | git worktree | 复制整个仓库 |',
    '|---|---|---|',
    '| Git 历史 | 与原仓库共享 | 复制一份，成为独立仓库 |',
    '| 依赖目录 | 新 worktree 需要重新安装 | 如果连 node_modules 一起复制，可能已有 |'
  ].join('\n');
  const lines = renderMarkdown(source, 72);
  const text = lines.join('\n');
  assert.match(text, /┌/);
  assert.match(text, /git worktree/);
  assert.match(text, /与原仓库共享/);
  assert.doesNotMatch(text, /\|---\|---\|---\|/);
  for (const line of lines) assert.ok(styledWidth(line) <= 72);
});

test('markdown allows relative file links but strips dangerous protocols', () => {
  const relative = renderMarkdown('[file](docs/requirements.md)', 80).join('\n');
  assert.match(relative, /\x1b\]8;;docs\/requirements\.md\x1b\\/);
  const unsafe = renderMarkdown('[bad](javascript:alert(1))', 80).join('\n');
  assert.doesNotMatch(unsafe, /\x1b\]8;;javascript/);
  assert.match(stripFormatting(unsafe), /bad/);
});
