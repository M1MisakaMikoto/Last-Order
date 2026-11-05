import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMANDS, commandCompletions } from '../src/commands.js';

test('slash prefixes discover commands with descriptions and free text is preserved', () => {
  assert.equal(commandCompletions('/').items.length, COMMANDS.length);
  assert.deepEqual(commandCompletions('/app').items.map(i => i.value), ['/approval ', '/approve ']);
  assert.equal(commandCompletions('/w').items[0].value, '/w ', 'an exact command takes precedence over a longer command sharing its prefix');
  assert.ok(commandCompletions('/w').items.find(i => i.value === '/w ').description.includes('需先选择 worker'));
  assert.equal(commandCompletions('hello /approve').items.length, 0);
  assert.equal(commandCompletions('/interrupt 请先检查不要改代码').items.length, 0);
  assert.match(commandCompletions('/interrupt 请先检查不要改代码').hint, /中止 Manager|打断 Manager/);
  assert.match(commandCompletions('/missing').hint, /没有匹配命令/);
});

test('parameter suggestions use live requests and worker context without completing answer text', () => {
  const context = { workers: [{ id: 'worker_1', provider: 'codex', kind: 'review', status: 'running', pipelineId: 'p' }], pipelines: { p: { title: '检查计算器' } }, approvals: [{ id: 'approval_1', actor: 'worker_1', detail: { reason: '运行测试' } }], questions: [{ id: 'question_1', actor: 'worker_1' }], groups: [{ events: [1, 2] }] };
  assert.match(commandCompletions('/select worker', context).items[0].description, /检查计算器/);
  assert.equal(commandCompletions('/approve approval', context).items[0].value, '/approve approval_1');
  assert.equal(commandCompletions('/answer question', context).items[0].value, '/answer question_1 ');
  assert.equal(commandCompletions('/answer question_1 使用中文', context).items.length, 0);
  context.approvals = []; assert.equal(commandCompletions('/approve ', context).items.length, 0);
  assert.match(commandCompletions('/approve ', context).hint, /无待审批/);
  assert.deepEqual(commandCompletions('/expand ', context).items.map(i => i.value), ['/expand all', '/expand 1']);
  assert.deepEqual(commandCompletions('/diff ', context).items.map(i => i.value), ['/diff task', '/diff uncommitted']);
  assert.equal(commandCompletions('/monitor worker', context).items[0].value, '/monitor worker_1');
});

test('installed skills provide contextual completions', () => {
  const skills = [
    { name: 'pdf', description: 'Read PDF documents', enabled: true, scope: 'repo' },
    { name: 'pytest', description: 'Run Python tests', enabled: true, scope: 'user' }
  ];
  assert.equal(commandCompletions('$p', { skills }).items[0].value, '$pdf ');
  assert.equal(commandCompletions('请使用 $py', { skills }).items[0].value, '请使用 $pytest ');
});

test('project prefixes provide contextual -A/-B completions', () => {
  const projects = [
    { code: 'A', root: 'D:/workspaces/alpha', active: false },
    { code: 'B', root: 'D:/workspaces/beta', active: true }
  ];
  assert.deepEqual(commandCompletions('-', { projects }).items.map(item => item.value), ['-A ', '-B ']);
  assert.deepEqual(commandCompletions('-b', { projects }).items.map(item => item.value), ['-B ']);
});

test('memory action completion offers clear but not duplicate new', () => {
  assert.deepEqual(commandCompletions('/mem').items.map(item => item.value), ['/memory ']);
  assert.deepEqual(commandCompletions('/memory c').items.map(item => item.value), ['/memory clear']);
  assert.deepEqual(commandCompletions('/memory s').items.map(item => item.value), ['/memory status']);
});

test('file completion supports Windows separators, Unicode and spaces while excluding symlinks', () => {
  const context = { files: [{ name: '中文 页面.html' }, { name: 'nested', directory: true }, { name: 'outside', symlink: true }] };
  assert.equal(commandCompletions('/open src\\中', context).items[0].value, '/open src/中文 页面.html');
  assert.equal(commandCompletions('/open src/n', context).items[0].value, '/open src/nested/');
  assert.equal(commandCompletions('/open src/o', context).items.length, 0);
});
