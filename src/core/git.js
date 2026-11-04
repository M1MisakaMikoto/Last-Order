import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, realpath, readFile, writeFile, stat, access, unlink, rename } from 'node:fs/promises';
import { capture } from './process.js';
import {
  BRANCH_PREFIX, DATA_DIRECTORY_NAME, LEGACY_DATA_DIRECTORY_NAME, PRODUCT_NAME,
  WORKTREE_DIRECTORY_NAME, LEGACY_WORKTREE_DIRECTORY_NAME
} from './identity.js';

async function migrateDirectory(from, to) {
  try { await access(to); return; } catch {}
  try { await access(from); await rename(from, to); } catch {}
}

async function createEmptyBaseline(root) {
  const gitDirectory = (await capture('git', ['rev-parse', '--absolute-git-dir'], { cwd: root })).trim();
  const indexPath = path.join(gitDirectory, `last-order-bootstrap-${randomUUID()}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  try {
    await capture('git', ['read-tree', '--empty'], { cwd: root, env });
    const tree = (await capture('git', ['write-tree'], { cwd: root, env })).trim();
    const commit = (await capture('git', [
      '-c', `user.name=${PRODUCT_NAME}`, '-c', 'user.email=last-order@localhost',
      '-c', 'commit.gpgSign=false', 'commit-tree', tree, '-m', `Initialize project for ${PRODUCT_NAME}`
    ], { cwd: root, env })).trim();
    const branch = (await capture('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root })).trim();
    await capture('git', ['update-ref', `refs/heads/${branch}`, commit], { cwd: root });
    return commit;
  } finally {
    await unlink(indexPath).catch(() => {});
  }
}

export class GitWorkspace {
  constructor(root, dataDirectory) {
    this.root = root; this.directory = dataDirectory; this.worktreeDirectory = path.join(root, WORKTREE_DIRECTORY_NAME);
    this.baseCommit = null; this.workingTreeDirty = false;
  }
  static async open(directory, { initializeEmpty = false } = {}) {
    directory = path.resolve(directory);
    let info;
    try { info = await stat(directory); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error(`项目目录不存在：${directory}\n请先创建目录，再使用 --project 指向它。`);
    }
    if (!info.isDirectory()) throw new Error(`项目路径不是目录：${directory}`);
    let root;
    let localRepository = false;
    try { await access(path.join(directory, '.git')); localRepository = true; } catch {}
    if (!localRepository && initializeEmpty) {
      await capture('git', ['init', '-b', 'main'], { cwd: directory });
      await createEmptyBaseline(directory);
      localRepository = true;
    }
    if (!localRepository) {
      throw new Error(`项目尚未初始化 Git：${directory}\n可使用 --project 启动 Last Order 自动初始化。`);
    }
    try { root = (await capture('git', ['rev-parse', '--show-toplevel'], { cwd: directory })).trim(); } catch (error) {
      if (!/not a git repository/i.test(error.message)) throw error;
      throw new Error(`项目尚未初始化 Git：${directory}\n可使用 --project 启动 Last Order 自动初始化。`);
    }
    try { await capture('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root }); } catch {
      if (!initializeEmpty) throw new Error(`Git 仓库尚无可用的初始提交：${root}\n可使用 --project 启动 Last Order 自动建立空基线。`);
      await createEmptyBaseline(root);
    }
    const common = (await capture('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root })).trim();
    const dataDirectory = path.join(common, DATA_DIRECTORY_NAME);
    await migrateDirectory(path.join(common, 'schedule-agents'), dataDirectory);
    await migrateDirectory(path.join(common, LEGACY_DATA_DIRECTORY_NAME), dataDirectory);
    const workspace = new GitWorkspace(root, dataDirectory);
    await workspace.prepareWorktreeDirectory();
    await workspace.snapshotWorkingTree();
    return workspace;
  }
  async git(args, cwd = this.root) { return (await capture('git', args, { cwd })).trimEnd(); }
  async snapshotWorkingTree() {
    const head = await this.head();
    const dirty = (await this.git(['status', '--porcelain'])).trim();
    if (!dirty) { this.baseCommit = head; this.workingTreeDirty = false; return head; }
    await mkdir(this.directory, { recursive: true });
    const indexPath = path.join(this.directory, `snapshot-${randomUUID()}.index`);
    const env = { ...process.env, GIT_INDEX_FILE: indexPath };
    try {
      await capture('git', ['read-tree', head], { cwd: this.root, env });
      await capture('git', ['add', '-A', '--', '.'], { cwd: this.root, env });
      const tree = (await capture('git', ['write-tree'], { cwd: this.root, env })).trim();
      const commit = (await capture('git', [
        '-c', 'user.name=Mission Control', '-c', 'user.email=mission-control@localhost',
        '-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', head, '-m', 'Last Order working tree snapshot'
      ], { cwd: this.root, env })).trim();
      this.baseCommit = commit; this.workingTreeDirty = true;
      return commit;
    } finally {
      await unlink(indexPath).catch(() => {});
    }
  }
  async snapshotWorker(worker, checkpointId) {
    if (!worker?.workspace) throw new Error('Worker workspace is not ready');
    const head = await this.git(['rev-parse', 'HEAD'], worker.workspace);
    const dirty = (await this.git(['status', '--porcelain'], worker.workspace)).trim();
    let commit = head;
    if (dirty) {
      await mkdir(this.directory, { recursive: true });
      const indexPath = path.join(this.directory, `checkpoint-${randomUUID()}.index`);
      const env = { ...process.env, GIT_INDEX_FILE: indexPath };
      try {
        await capture('git', ['read-tree', head], { cwd: worker.workspace, env });
        await capture('git', ['add', '-A', '--', '.'], { cwd: worker.workspace, env });
        const tree = (await capture('git', ['write-tree'], { cwd: worker.workspace, env })).trim();
        commit = (await capture('git', [
          '-c', 'user.name=Mission Control', '-c', 'user.email=mission-control@localhost',
          '-c', 'commit.gpgSign=false', 'commit-tree', tree, '-p', head, '-m', `Last Order checkpoint ${checkpointId}`
        ], { cwd: worker.workspace, env })).trim();
      } finally {
        await unlink(indexPath).catch(() => {});
      }
    }
    await this.git(['update-ref', `refs/last-order/checkpoints/${checkpointId}/workers/${worker.id}`, commit], worker.workspace);
    return { commit, head, branch: worker.branch, dirty: Boolean(dirty) };
  }
  async restoreWorker(worker, snapshot) {
    if (!worker?.workspace) throw new Error('Worker workspace is not ready');
    if (!snapshot?.commit) throw new Error('Checkpoint has no worker snapshot');
    await this.git(['reset', '--hard', snapshot.commit], worker.workspace);
    await this.git(['clean', '-fd'], worker.workspace);
    return this.head(worker.workspace);
  }
  async prepareWorktreeDirectory() {
    if (this.preparation) return this.preparation;
    this.preparation = (async () => {
      await migrateDirectory(path.join(this.root, '.schedule-agents-workspaces'), this.worktreeDirectory);
      await migrateDirectory(path.join(this.root, LEGACY_WORKTREE_DIRECTORY_NAME), this.worktreeDirectory);
      const marker = path.join(this.worktreeDirectory, '.owner');
      let entries;
      try { entries = await readdir(this.worktreeDirectory); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (entries?.length) {
        let owner; try { owner = await readFile(marker, 'utf8'); } catch { throw new Error('Workspace container already exists without an ownership marker; no files changed'); }
        const legacyOwner = path.join(path.dirname(this.directory), 'schedule-agents');
        const legacyDataOwner = path.join(path.dirname(this.directory), LEGACY_DATA_DIRECTORY_NAME);
        if (owner !== this.directory && owner !== legacyOwner && owner !== legacyDataOwner) throw new Error('Workspace container belongs to another project');
        if (owner !== this.directory) await writeFile(marker, this.directory, { mode: 0o600 });
      }
      const info = path.join(path.dirname(this.directory), 'info'); await mkdir(info, { recursive: true });
      const excludePath = path.join(info, 'exclude'); let exclude = '';
      try { exclude = await readFile(excludePath, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      const entry = `/${WORKTREE_DIRECTORY_NAME}/`;
      if (!exclude.split(/\r?\n/).includes(entry)) await writeFile(excludePath, exclude + (exclude.endsWith('\n') || !exclude ? '' : '\n') + entry + '\n');
      await mkdir(this.worktreeDirectory, { recursive: true });
      await writeFile(marker, this.directory, { mode: 0o600 });
    })();
    return this.preparation;
  }
  async create(worker, base) {
    await this.prepareWorktreeDirectory();
    const directory = path.join(this.worktreeDirectory, worker.id);
    let exists = false; try { await access(directory); exists = true; } catch { /* new workspace */ }
    if (exists) {
      // Recover a crash between `git worktree add` and persisting its path.
      const branch = await this.git(['branch', '--show-current'], directory);
      const common = await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir'], directory);
      const expected = await this.git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
      if (branch !== worker.branch || path.resolve(common).toLowerCase() !== path.resolve(expected).toLowerCase()) throw new Error('Existing workspace does not match this worker');
      return directory;
    }
    await this.git(['worktree', 'add', '-b', worker.branch, directory, base]);
    return directory;
  }
  async head(cwd = this.root) { return this.git(['rev-parse', '--verify', 'HEAD'], cwd); }
  async ensureInput(worker, commit) {
    const head = await this.head(worker.workspace);
    if (head === commit) return { branch: worker.branch, baseCommit: commit };
    if (await this.git(['status', '--porcelain'], worker.workspace)) throw new Error('Worker worktree has changes; will not overwrite them');
    // Keep already-committed review additions when resuming the same input.
    try { await this.git(['merge-base', '--is-ancestor', commit, head], worker.workspace); return { branch: worker.branch, baseCommit: commit }; } catch { /* new input */ }
    let fastForward = false;
    try { await this.git(['merge-base', '--is-ancestor', head, commit], worker.workspace); fastForward = true; } catch { /* diverged review branch */ }
    if (fastForward) { await this.git(['merge', '--ff-only', commit], worker.workspace); return { branch: worker.branch, baseCommit: commit }; }
    // Preserve the old acceptance commit on its branch; do not reset or merge
    // it into a new implementation under review.
    const branch = `${BRANCH_PREFIX}/worker/${worker.id}-review-${randomUUID().slice(0, 8)}`;
    await this.git(['switch', '-c', branch, commit], worker.workspace);
    return { branch, baseCommit: commit };
  }
  async validateReviewOutput(worker, input, output) {
    if (input === output) return;
    await this.git(['merge-base', '--is-ancestor', input, output], worker.workspace);
    const fields = (await this.git(['diff', '--raw', '--no-renames', '-z', input, output, '--'], worker.workspace)).split('\0');
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const metadata = fields[i].trim().split(/\s+/), file = fields[i + 1];
      const mode = metadata[1], status = metadata.at(-1);
      const testFile = /\.(?:test|spec)\.[cm]?[jt]sx?$/iu.test(file) || /(?:^|\/)(?:test|tests|__tests__)\/.*\.[cm]?[jt]sx?$/iu.test(file);
      if (status !== 'A' || !['100644', '100755'].includes(mode) || !testFile) throw new Error('Reviewer changed implementation/configuration or existing files: ' + file + '. Only new independent acceptance test files may be committed.');
    }
  }
  async result(worker) {
    const dirty = await this.git(['status', '--porcelain'], worker.workspace);
    if (dirty) throw new Error('Commit the task output before reporting success; uncommitted files are preserved in ' + worker.workspace);
    return this.head(worker.workspace);
  }
  async deliver(branch, commit) {
    let previous;
    try { previous = await this.git(['rev-parse', '--verify', 'refs/heads/' + branch]); } catch { /* new delivery branch */ }
    if (previous && previous !== commit) await this.git(['merge-base', '--is-ancestor', previous, commit]);
    await this.git(['update-ref', 'refs/heads/' + branch, commit, previous || '0'.repeat(commit.length)]);
  }
  async diff(worker, mode = 'task') {
    if (!worker.workspace) return 'Workspace is being prepared.';
    const status = await this.git(['status', '--short'], worker.workspace);
    const args = mode === 'uncommitted' ? ['diff', 'HEAD', '--'] : ['diff', worker.baseCommit, '--'];
    const diff = await this.git(['--no-pager', ...args], worker.workspace);
    return `Branch: ${worker.branch}\nBase: ${worker.baseCommit}\n${status}\n\n${diff || '(no tracked diff)'}\nUntracked files appear in status; open them in Files.`;
  }
  normalizeRepoPath(relative = '') {
    const value = String(relative).replaceAll('\\', '/');
    if (!value || path.isAbsolute(value) || value.split('/').includes('..') || value.split('/').includes('.git')) throw new Error('Invalid repository path');
    return value;
  }
  async changedFiles(worker) {
    if (!worker.workspace) return [];
    const files = new Map();
    const output = await this.git(['diff', '--name-status', '--no-renames', worker.baseCommit, '--'], worker.workspace);
    for (const line of output.split(/\r?\n/).filter(Boolean)) {
      const [status, ...parts] = line.split('\t'), file = parts.join('\t');
      if (file) files.set(file, status.slice(0, 1));
    }
    const untracked = await this.git(['ls-files', '--others', '--exclude-standard'], worker.workspace);
    for (const file of untracked.split(/\r?\n/).filter(Boolean)) files.set(file, '?');
    return [...files].map(([file, status]) => ({ path: file, status })).sort((a, b) => a.path.localeCompare(b.path));
  }
  async fileContent(worker, relative, ref = 'worktree') {
    const file = this.normalizeRepoPath(relative);
    if (ref === 'base' || ref === 'head') {
      const revision = ref === 'base' ? worker.baseCommit : 'HEAD';
      try {
        const content = await this.git(['show', `${revision}:${file}`], worker.workspace);
        if (Buffer.byteLength(content) > 256_000) throw new Error('Diff preview supports files up to 256 KB');
        return content;
      } catch (error) {
        if (/does not exist|exists on disk|path .* not in/i.test(error.message)) return '';
        throw error;
      }
    }
    try {
      const target = await this.safePath(worker, file);
      const info = await stat(target);
      if (!info.isFile() || info.size > 256_000) throw new Error('Diff preview supports regular files up to 256 KB');
      const data = await readFile(target);
      if (data.includes(0)) throw new Error('Binary file diff is unavailable');
      return data.toString('utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  }
  async files(worker, relative = '') {
    const target = await this.safePath(worker, relative);
    const info = await stat(target);
    if (info.isDirectory()) {
      return (await readdir(target, { withFileTypes: true })).filter(e => e.name !== '.git').map(e => ({ name: e.name, directory: e.isDirectory(), symlink: e.isSymbolicLink() }));
    }
    if (!info.isFile() || info.size > 256_000) throw new Error('Preview supports regular files up to 256 KB');
    const data = await readFile(target);
    if (data.includes(0)) throw new Error('Binary file preview is unavailable');
    return data.toString('utf8');
  }
  async safePath(worker, relative) {
    const root = await realpath(worker.workspace);
    const target = await realpath(path.resolve(root, relative));
    const rel = path.relative(root, target);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel) || rel.split(path.sep).includes('.git')) throw new Error('Path is outside worker workspace');
    return target;
  }
}
