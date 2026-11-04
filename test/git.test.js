import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { GitWorkspace } from '../src/core/git.js';
import { capture } from '../src/core/process.js';
import { temporary, cleanup } from './helpers.js';

test('an empty new project can bootstrap Git and create a real worker worktree', async t => {
  const root = await temporary('new-project-'); t.after(() => cleanup(root));
  await assert.rejects(GitWorkspace.open(root), /项目尚未初始化 Git/);
  assert.deepEqual(await readdir(root), [], 'opening without initialization must not create data');
  const ws = await GitWorkspace.open(root, { initializeEmpty: true });
  const initial = await ws.head();
  assert.equal(await ws.git(['ls-tree', '-r', '--name-only', 'HEAD']), '', 'initial commit contains no project files');
  assert.equal(await ws.git(['branch', '--show-current']), 'main');
  const worker = { id: 'first', branch: 'last-order/worker/first' };
  worker.workspace = await ws.create(worker, initial);
  assert.equal(await ws.head(worker.workspace), initial);
  assert.equal(await ws.git(['status', '--porcelain']), '');
  assert.equal(await (await GitWorkspace.open(root, { initializeEmpty: true })).head(), initial, 'restart must not create another commit');
});

test('startup auto-initializes existing files and unborn repositories without committing user files', async t => {
  const root = await temporary('existing-project-'); t.after(() => cleanup(root));
  await writeFile(path.join(root, 'user.txt'), 'keep this');
  const workspace = await GitWorkspace.open(root, { initializeEmpty: true });
  assert.equal(await workspace.git(['ls-tree', '-r', '--name-only', 'HEAD']), '', 'user files are not committed to main');
  assert.equal(await workspace.git(['diff', '--cached', '--name-only']), '', 'user files are not staged');
  assert.equal(await readFile(path.join(root, 'user.txt'), 'utf8'), 'keep this');
  const worker = { id: 'existing_files', branch: 'last-order/worker/existing-files' };
  worker.workspace = await workspace.create(worker, workspace.baseCommit);
  assert.equal(await readFile(path.join(worker.workspace, 'user.txt'), 'utf8'), 'keep this');

  const unborn = await temporary('unborn-project-'); t.after(() => cleanup(unborn));
  await writeFile(path.join(unborn, 'staged.txt'), 'staged but not committed');
  await capture('git', ['init', '-b', 'main'], { cwd: unborn });
  await capture('git', ['add', 'staged.txt'], { cwd: unborn });
  const unbornWorkspace = await GitWorkspace.open(unborn, { initializeEmpty: true });
  assert.ok(await unbornWorkspace.head());
  assert.equal(await unbornWorkspace.git(['ls-tree', '-r', '--name-only', 'HEAD']), '', 'unborn repository receives an empty baseline');
  assert.equal(await unbornWorkspace.git(['diff', '--cached', '--name-only']), 'staged.txt', 'user index is preserved');
  assert.equal(await readFile(path.join(unborn, 'staged.txt'), 'utf8'), 'staged but not committed');
  await assert.rejects(GitWorkspace.open(path.join(root, 'missing'), { initializeEmpty: true }), /目录不存在/);
  await assert.rejects(GitWorkspace.open(path.join(root, 'user.txt'), { initializeEmpty: true }), /不是目录/);
});

test('legacy Schedule Agents data directories migrate to Last Order paths', async t => {
  const root = await temporary('last-order-migration-');
  t.after(() => cleanup(root));
  const git = args => capture('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'seed.txt'), 'seed');
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', 'commit', '-m', 'seed']);
  const common = path.join(root, '.git');
  await mkdir(path.join(common, 'schedule-agents'), { recursive: true });
  await writeFile(path.join(common, 'schedule-agents', 'config.json'), '{"legacy":true}');
  await mkdir(path.join(root, '.schedule-agents-workspaces'), { recursive: true });
  await writeFile(path.join(root, '.schedule-agents-workspaces', '.owner'), path.join(common, 'schedule-agents'));

  const workspace = await GitWorkspace.open(root);
  assert.equal(workspace.directory, path.join(common, 'last-order'));
  assert.equal(await readFile(path.join(workspace.directory, 'config.json'), 'utf8'), '{"legacy":true}');
  assert.equal(workspace.worktreeDirectory, path.join(root, '.last-order-workspaces'));
  await assert.rejects(readFile(path.join(common, 'schedule-agents', 'config.json')), /ENOENT/);
  await assert.rejects(readFile(path.join(root, '.schedule-agents-workspaces', '.owner')), /ENOENT/);
});

test('legacy lastorder data directories migrate to canonical last-order paths', async t => {
  const root = await temporary('last-order-legacy-');
  t.after(() => cleanup(root));
  const git = args => capture('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'seed.txt'), 'seed');
  await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', 'commit', '-m', 'seed']);
  const common = path.join(root, '.git');
  await mkdir(path.join(common, 'lastorder'), { recursive: true });
  await writeFile(path.join(common, 'lastorder', 'config.json'), '{"legacy":true}');
  await mkdir(path.join(root, '.lastorder-workspaces'), { recursive: true });
  await writeFile(path.join(root, '.lastorder-workspaces', '.owner'), path.join(common, 'lastorder'));

  const workspace = await GitWorkspace.open(root);
  assert.equal(workspace.directory, path.join(common, 'last-order'));
  assert.equal(await readFile(path.join(workspace.directory, 'config.json'), 'utf8'), '{"legacy":true}');
  assert.equal(workspace.worktreeDirectory, path.join(root, '.last-order-workspaces'));
  assert.equal(await readFile(path.join(workspace.worktreeDirectory, '.owner'), 'utf8'), workspace.directory);
  await assert.rejects(readFile(path.join(common, 'lastorder', 'config.json')), /ENOENT/);
});

test('dirty project content is snapshotted without changing the user branch or index', async t => {
  const root = await temporary('dirty-project-');
  t.after(() => cleanup(root));
  const git = args => capture('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'tracked.txt'), 'committed\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Last Order Test', '-c', 'user.email=last-order@example.invalid', 'commit', '-m', 'initial']);
  const head = (await git(['rev-parse', 'HEAD'])).trim();
  await writeFile(path.join(root, 'tracked.txt'), 'working change\n');
  await writeFile(path.join(root, 'untracked.txt'), 'untracked content\n');

  const workspace = await GitWorkspace.open(root);
  assert.equal(workspace.workingTreeDirty, true);
  assert.notEqual(workspace.baseCommit, head);
  assert.equal((await git(['rev-parse', 'HEAD'])).trim(), head);
  assert.equal((await git(['diff', '--cached', '--name-only'])).trim(), '');
  assert.match(await git(['status', '--porcelain']), /tracked\.txt/);
  assert.match(await git(['status', '--porcelain']), /untracked\.txt/);

  const worker = { id: 'snapshot_worker', branch: 'last-order/worker/snapshot', baseCommit: workspace.baseCommit };
  worker.workspace = await workspace.create(worker, workspace.baseCommit);
  assert.equal((await readFile(path.join(worker.workspace, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'working change\n');
  assert.equal((await readFile(path.join(worker.workspace, 'untracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'untracked content\n');
});

test('worker checkpoint snapshots and restores tracked and untracked files', async t => {
  const root = await temporary('worker-checkpoint-');
  t.after(() => cleanup(root));
  const git = args => capture('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'tracked.txt'), 'base\n');
  await git(['add', '.']);
  await git(['-c', 'user.name=Last Order Test', '-c', 'user.email=last-order@example.invalid', 'commit', '-m', 'initial']);
  const workspace = await GitWorkspace.open(root), base = await workspace.head();
  const worker = { id: 'checkpoint_worker', branch: 'last-order/worker/checkpoint', baseCommit: base };
  worker.workspace = await workspace.create(worker, base);
  await writeFile(path.join(worker.workspace, 'tracked.txt'), 'checkpoint content\n');
  await writeFile(path.join(worker.workspace, 'untracked.txt'), 'snapshot untracked\n');
  const snapshot = await workspace.snapshotWorker(worker, 'checkpoint_test');
  assert.equal(snapshot.dirty, true);
  assert.notEqual(snapshot.commit, snapshot.head);
  assert.equal((await workspace.git(['rev-parse', 'refs/last-order/checkpoints/checkpoint_test/workers/checkpoint_worker'], worker.workspace)).trim(), snapshot.commit);

  await writeFile(path.join(worker.workspace, 'tracked.txt'), 'later content\n');
  await writeFile(path.join(worker.workspace, 'later.txt'), 'remove me\n');
  await workspace.restoreWorker(worker, snapshot);
  assert.equal((await readFile(path.join(worker.workspace, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'checkpoint content\n');
  assert.equal((await readFile(path.join(worker.workspace, 'untracked.txt'), 'utf8')).replace(/\r\n/g, '\n'), 'snapshot untracked\n');
  await assert.rejects(readFile(path.join(worker.workspace, 'later.txt'), 'utf8'), /ENOENT/);
});

test('real Git worktrees isolate output and preserve the original branch; previews reject escapes', async t => {
  const root = await temporary('git-中文 ');
  t.after(() => cleanup(root));
  const git = args => capture('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await writeFile(path.join(root, 'original.txt'), 'original\n');
  await git(['add', '.']); await git(['-c', 'user.name=Last Order Test', '-c', 'user.email=last-order@example.invalid', 'commit', '-m', 'initial']);
  const workspace = await GitWorkspace.open(root), base = await workspace.head();
  const a = { id: 'worker_a', branch: 'last-order/worker/a', baseCommit: base };
  a.workspace = await workspace.create(a, base);
  assert.equal(await workspace.create(a, base), a.workspace, 'worktree created before a crash can be adopted');
  const b = { id: 'worker_b', branch: 'last-order/worker/b', baseCommit: base };
  b.workspace = await workspace.create(b, base);
  assert.equal(await workspace.git(['status', '--porcelain']), '', 'local workspace exclusion must not dirty the original project');
  assert.ok(!a.workspace.startsWith(path.dirname(workspace.directory)), 'worker files must not live inside protected Git metadata');
  await writeFile(path.join(a.workspace, 'new.txt'), 'worker a\n');
  await assert.rejects(workspace.result(a), /uncommitted/);
  await workspace.git(['add', 'new.txt'], a.workspace);
  await workspace.git(['-c', 'user.name=Last Order Test', '-c', 'user.email=last-order@example.invalid', 'commit', '-m', 'worker output'], a.workspace);
  const commit = await workspace.result(a); await workspace.deliver('last-order/delivery/test', commit);
  assert.equal(await workspace.head(root), base); assert.equal(await workspace.head(b.workspace), base);
  assert.match(await workspace.diff(a), /worker a/);
  assert.deepEqual(await workspace.changedFiles(a), [{ path: 'new.txt', status: 'A' }]);
  assert.equal(await workspace.fileContent(a, 'new.txt', 'worktree'), 'worker a\n');
  assert.equal(await workspace.fileContent(a, 'new.txt', 'base'), '');
  await assert.rejects(workspace.files(a, '../../..'), /outside/);
  assert.equal(await workspace.files(a, 'new.txt'), 'worker a\n');
  await workspace.ensureInput(b, commit); assert.equal(await workspace.head(b.workspace), commit);
  assert.equal((await workspace.git(['branch', '--show-current'], b.workspace)), b.branch);
});

test('delivery refuses divergent commits rather than overwriting another pipeline', async t => {
  const root = await temporary('divergence-');
  t.after(() => cleanup(root));
  const run = args => capture('git', args, { cwd: root });
  await run(['init', '-b', 'main']); await writeFile(path.join(root, 'seed'), 'seed');
  await run(['add', '.']); await run(['-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', 'commit', '-m', 'seed']);
  const ws = await GitWorkspace.open(root), base = await ws.head();
  const commits = [];
  for (const name of ['a', 'b']) {
    const worker = { id: name, branch: 'last-order/worker/' + name }; worker.workspace = await ws.create(worker, base);
    await writeFile(path.join(worker.workspace, name), name); await ws.git(['add', name], worker.workspace);
    await ws.git(['-c', 'user.name=Test', '-c', 'user.email=t@example.invalid', 'commit', '-m', name], worker.workspace);
    commits.push(await ws.head(worker.workspace));
  }
  await ws.deliver('last-order/delivery/test', commits[0]);
  await assert.rejects(ws.deliver('last-order/delivery/test', commits[1]));
  assert.equal(await ws.git(['rev-parse', 'last-order/delivery/test']), commits[0]);
});

test('review accepts new tests, rejects implementation edits, and preserves old review commits on rework', async t => {
  const root = await temporary('review-output-'); t.after(() => cleanup(root));
  const run = args => capture('git', args, { cwd: root });
  await run(['init', '-b', 'main']); await run(['config', 'user.name', 'Last Order Test']); await run(['config', 'user.email', 'test@example.invalid']);
  await writeFile(path.join(root, 'implementation.js'), 'export const value = 1;\n');
  await run(['add', '.']); await run(['commit', '-m', 'implementation']);
  const ws = await GitWorkspace.open(root), input = await ws.head();
  const reviewer = { id: 'reviewer', branch: 'last-order/worker/reviewer', baseCommit: input }; reviewer.workspace = await ws.create(reviewer, input);
  await mkdir(path.join(reviewer.workspace, 'test')); await writeFile(path.join(reviewer.workspace, 'test', 'acceptance.test.js'), 'import test from "node:test";\n');
  await ws.git(['add', '.'], reviewer.workspace); await ws.git(['commit', '-m', 'acceptance evidence'], reviewer.workspace);
  const reviewCommit = await ws.head(reviewer.workspace); await ws.validateReviewOutput(reviewer, input, reviewCommit);
  await writeFile(path.join(reviewer.workspace, 'implementation.js'), 'export const value = 99;\n');
  await ws.git(['add', '.'], reviewer.workspace); await ws.git(['commit', '-m', 'forbidden implementation edit'], reviewer.workspace);
  const forbidden = await ws.head(reviewer.workspace);
  await assert.rejects(ws.validateReviewOutput(reviewer, input, forbidden), /Reviewer changed/);
  const implementer = { id: 'implementer', branch: 'last-order/worker/implementer' }; implementer.workspace = await ws.create(implementer, input);
  await writeFile(path.join(implementer.workspace, 'implementation.js'), 'export const value = 2;\n');
  await ws.git(['add', '.'], implementer.workspace); await ws.git(['commit', '-m', 'implementation rework'], implementer.workspace);
  const reworked = await ws.head(implementer.workspace), prepared = await ws.ensureInput(reviewer, reworked);
  assert.notEqual(prepared.branch, reviewer.branch); assert.equal(await ws.head(reviewer.workspace), reworked);
  assert.equal(await ws.git(['rev-parse', reviewer.branch]), forbidden, 'prior review commits remain recoverable');
  assert.equal((await readFile(path.join(reviewer.workspace, 'implementation.js'), 'utf8')).replace(/\r\n/g, '\n'), 'export const value = 2;\n');
  assert.equal(await ws.head(root), input, 'original work branch is untouched');
});
