"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitService = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const model_1 = require("./model");
const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_REPOSITORY_SEARCH_DEPTH = 6;
const MAX_SCANNED_DIRECTORIES = 20_000;
const SKIPPED_REPOSITORY_SCAN_DIRECTORIES = new Set([
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "dist",
    "build",
    "out",
    "target",
    "coverage",
    "vendor",
    ".next",
    ".cache",
]);
class GitService {
    async discoverRepositories(workspaceFolders, options = {}) {
        const roots = new Set();
        const requestedDepth = options.maxDepth ?? DEFAULT_REPOSITORY_SEARCH_DEPTH;
        const maxDepth = Number.isFinite(requestedDepth)
            ? Math.max(0, Math.floor(requestedDepth))
            : DEFAULT_REPOSITORY_SEARCH_DEPTH;
        const scanState = { remaining: MAX_SCANNED_DIRECTORIES };
        for (const folder of workspaceFolders) {
            const absoluteFolder = path.resolve(folder);
            const containingRoot = await this.resolveContainingRepository(absoluteFolder);
            if (containingRoot) {
                roots.add(containingRoot);
            }
            await this.scanForRepositories(absoluteFolder, 0, maxDepth, roots, scanState);
        }
        for (const knownRoot of options.knownRoots ?? []) {
            const absoluteRoot = path.resolve(knownRoot);
            if (await this.isDirectory(absoluteRoot)) {
                roots.add(absoluteRoot);
            }
        }
        const unique = new Map();
        const repositories = await Promise.all(Array.from(roots).map(async (root) => {
            const branch = await this.getBranch(root);
            return {
                root,
                name: path.basename(root) || root,
                branch,
            };
        }));
        for (const repository of repositories) {
            const key = normalizePathKey(repository.root);
            if (!unique.has(key)) {
                unique.set(key, repository);
            }
        }
        return Array.from(unique.values()).sort((left, right) => left.name.localeCompare(right.name) ||
            left.root.localeCompare(right.root));
    }
    async getChanges(repoRoot, comparison) {
        const changes = new Map();
        if (comparison.mode === "index") {
            const raw = await this.runGit(["diff", "--name-status", "-z", "-M", "--no-ext-diff", "--"], repoRoot);
            this.collectChanges(raw, changes);
            await this.collectUntracked(repoRoot, changes);
            return sortChanges(changes);
        }
        if (comparison.mode === "refs") {
            const baseRef = comparison.baseRef ?? "HEAD";
            const targetRef = comparison.targetRef ?? "HEAD";
            const raw = await this.runGit([
                "diff",
                "--name-status",
                "-z",
                "-M",
                "--no-ext-diff",
                baseRef,
                targetRef,
                "--",
            ], repoRoot);
            this.collectChanges(raw, changes);
            return sortChanges(changes);
        }
        const baseRef = comparison.baseRef ?? "HEAD";
        const headExists = await this.refExists(repoRoot, "HEAD");
        if (baseRef === "HEAD" && !headExists) {
            const tracked = await this.runGit(["ls-files", "-z", "--cached"], repoRoot);
            for (const filePath of splitNulPaths(tracked)) {
                changes.set(filePath, {
                    status: "A",
                    oldPath: filePath,
                    path: filePath,
                });
            }
            await this.collectUntracked(repoRoot, changes);
            return sortChanges(changes);
        }
        const raw = await this.runGit([
            "diff",
            "--name-status",
            "-z",
            "-M",
            "--no-ext-diff",
            baseRef,
            "--",
        ], repoRoot);
        this.collectChanges(raw, changes);
        await this.collectUntracked(repoRoot, changes);
        return sortChanges(changes);
    }
    async getAllFiles(repoRoot, comparison) {
        const raw = comparison.mode === "refs"
            ? await this.runGit([
                "ls-tree",
                "-r",
                "--name-only",
                "-z",
                comparison.targetRef ?? "HEAD",
                "--",
            ], repoRoot)
            : await this.runGit([
                "ls-files",
                "-z",
                "--cached",
                "--others",
                "--exclude-standard",
            ], repoRoot);
        return Array.from(new Set(splitNulPaths(raw))).sort((left, right) => left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: "base",
        }));
    }
    async getRefItems(repoRoot) {
        const refsOutput = await this.runGit([
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)%00%(objectname:short)%00%(subject)%00%(refname)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ], repoRoot);
        const refs = [];
        for (const line of refsOutput.split(/\r?\n/)) {
            if (!line) {
                continue;
            }
            const [label, hash, subject, fullRef] = line.split("\0");
            if (!label || !fullRef) {
                continue;
            }
            let kind = "commit";
            if (fullRef.startsWith("refs/heads/")) {
                kind = "branch";
            }
            else if (fullRef.startsWith("refs/remotes/")) {
                if (fullRef.endsWith("/HEAD")) {
                    continue;
                }
                kind = "remote";
            }
            else if (fullRef.startsWith("refs/tags/")) {
                kind = "tag";
            }
            refs.push({
                ref: fullRef,
                label,
                description: [hash, subject].filter(Boolean).join(" · "),
                kind,
            });
        }
        let commitsOutput = "";
        try {
            commitsOutput = await this.runGit([
                "log",
                "--all",
                "--max-count=40",
                "--date=short",
                "--pretty=format:%H%x00%h%x00%s%x00%cd",
            ], repoRoot);
        }
        catch {
            // A repository can be initialized without any commit yet.
        }
        const seenCommits = new Set();
        for (const line of commitsOutput.split(/\r?\n/)) {
            if (!line) {
                continue;
            }
            const [fullHash, shortHash, subject, date] = line.split("\0");
            if (!fullHash || seenCommits.has(fullHash)) {
                continue;
            }
            seenCommits.add(fullHash);
            refs.push({
                ref: fullHash,
                label: shortHash || fullHash.slice(0, 8),
                description: [date, subject].filter(Boolean).join(" · "),
                kind: "commit",
            });
        }
        return refs;
    }
    async refExists(repoRoot, ref) {
        try {
            await this.runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repoRoot);
            return true;
        }
        catch {
            return false;
        }
    }
    async resolveRef(repoRoot, ref) {
        try {
            const output = await this.runGit(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot);
            return output.trim();
        }
        catch {
            return undefined;
        }
    }
    async getRefContent(repoRoot, ref, filePath) {
        return this.runGit(["show", "--no-ext-diff", `${ref}:${filePath}`], repoRoot);
    }
    async getIndexContent(repoRoot, filePath) {
        return this.runGit(["show", "--no-ext-diff", `:${filePath}`], repoRoot);
    }
    async getBranch(repoRoot) {
        try {
            const branch = await this.runGit(["symbolic-ref", "--short", "-q", "HEAD"], repoRoot);
            return branch.trim() || "detached";
        }
        catch {
            return "无提交";
        }
    }
    async resolveContainingRepository(folder) {
        try {
            const topLevel = await this.runGit(["rev-parse", "--show-toplevel"], folder);
            return path.resolve(topLevel.trim());
        }
        catch {
            return undefined;
        }
    }
    async scanForRepositories(directory, depth, maxDepth, roots, scanState) {
        if (scanState.remaining <= 0) {
            return;
        }
        scanState.remaining -= 1;
        if (await this.hasGitMetadata(directory)) {
            roots.add(path.resolve(directory));
        }
        if (depth >= maxDepth) {
            return;
        }
        let entries;
        try {
            entries = await node_fs_1.promises.readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() ||
                entry.isSymbolicLink() ||
                SKIPPED_REPOSITORY_SCAN_DIRECTORIES.has(entry.name)) {
                continue;
            }
            await this.scanForRepositories(path.join(directory, entry.name), depth + 1, maxDepth, roots, scanState);
        }
    }
    async hasGitMetadata(directory) {
        try {
            const stat = await node_fs_1.promises.stat(path.join(directory, ".git"));
            return stat.isDirectory() || stat.isFile();
        }
        catch {
            return false;
        }
    }
    async isDirectory(target) {
        try {
            return (await node_fs_1.promises.stat(target)).isDirectory();
        }
        catch {
            return false;
        }
    }
    collectChanges(raw, changes) {
        for (const change of (0, model_1.parseNameStatus)(raw)) {
            changes.set(change.path, change);
        }
    }
    async collectUntracked(repoRoot, changes) {
        const output = await this.runGit(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot);
        for (const filePath of splitNulPaths(output)) {
            if (!changes.has(filePath)) {
                changes.set(filePath, {
                    status: "A",
                    oldPath: filePath,
                    path: filePath,
                });
            }
        }
    }
    runGit(args, cwd) {
        return new Promise((resolve, reject) => {
            (0, node_child_process_1.execFile)("git", args, {
                cwd,
                encoding: "utf8",
                maxBuffer: MAX_BUFFER,
                windowsHide: true,
                env: {
                    ...process.env,
                    GIT_OPTIONAL_LOCKS: "0",
                },
            }, (error, stdout, stderr) => {
                if (error) {
                    const detail = stderr.trim() || error.message;
                    reject(new Error(`git ${args[0]} 失败：${detail}`));
                    return;
                }
                resolve(stdout);
            });
        });
    }
}
exports.GitService = GitService;
function splitNulPaths(output) {
    return output.split("\0").filter(Boolean);
}
function sortChanges(changes) {
    return Array.from(changes.values()).sort((left, right) => left.path.localeCompare(right.path, undefined, {
        numeric: true,
        sensitivity: "base",
    }));
}
function normalizePathKey(repoRoot) {
    const resolved = path.resolve(repoRoot);
    return process.platform === "win32"
        ? resolved.toLowerCase()
        : resolved;
}
//# sourceMappingURL=git.js.map