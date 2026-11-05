import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverGitRepositories, projectCode } from '../src/core/projects.js';
import { MultiProjectService } from '../src/core/multi-project-service.js';
import { temporary, cleanup } from './helpers.js';

test('workspace scanning discovers Git repositories and assigns stable project codes', async t => {
  const root = await temporary('projects-');
  t.after(() => cleanup(root));
  for (const name of ['beta', 'alpha', 'nested/gamma']) {
    const directory = path.join(root, name);
    await mkdir(path.join(directory, '.git'), { recursive: true });
    await writeFile(path.join(directory, 'README.md'), name, 'utf8');
  }
  const repositories = await discoverGitRepositories(root);
  assert.deepEqual(repositories.map(repository => [repository.code, path.basename(repository.root)]), [
    ['A', 'alpha'], ['B', 'beta'], ['C', 'gamma']
  ]);
  assert.equal(projectCode(0), 'A');
  assert.equal(projectCode(25), 'Z');
  assert.equal(projectCode(26), 'AA');
});

test('multi-project service routes manager messages by -A/-B prefix and lazily starts projects', async t => {
  const root = await temporary('projects-hub-');
  t.after(() => cleanup(root));
  const projects = [
    { code: 'A', name: 'a', root: path.join(root, 'a') },
    { code: 'B', name: 'b', root: path.join(root, 'b') }
  ];
  const sent = [];
  const started = [];
  const makeClient = code => {
    const client = new EventEmitter();
    client.state = { workers: {}, pipelines: {}, requests: {}, notifications: [], manager: { pending: [] }, approvals: [], questions: [] };
    client.config = { manager: 'codex', worker: 'codex' };
    client.store = { history: () => [] };
    client.git = { root: projects.find(project => project.code === code).root };
    client.approvals = new Map(); client.questions = new Map();
    client.sendManagerMessage = async text => sent.push([code, text]);
    client.stop = async () => {}; client.shutdown = async () => {};
    client.health = async () => true;
    return client;
  };
  const hub = new MultiProjectService(projects, async project => {
    started.push(project.code);
    return { client: makeClient(project.code), dataDirectory: path.join(project.root, '.git', 'last-order'), configPath: '' };
  });
  await hub.start();
  assert.equal(hub.snapshot().manager.pending.length, 0);
  await hub.sendManagerMessage('-B inspect this');
  assert.deepEqual(started, ['A', 'B']);
  assert.equal(hub.activeProject.code, 'B');
  assert.deepEqual(sent, [['B', 'inspect this']]);
  assert.deepEqual(hub.routeInput('-A follow up'), { project: 'A', text: 'follow up' });
  await hub.stop();
});
