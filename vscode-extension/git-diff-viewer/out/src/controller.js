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
exports.DiffViewerController = void 0;
const node_fs_1 = require("node:fs");
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const contentProvider_1 = require("./contentProvider");
const git_1 = require("./git");
const codexState_1 = require("./codexState");
const codexSetup_1 = require("./codexSetup");
const model_1 = require("./model");
const treeProvider_1 = require("./treeProvider");
const VIEW_ID = "missionControl.diff";
const COMPARISON_STATE_KEY = "gitDiffViewer.comparisonStates";
const SELECTED_REPOSITORY_KEY = "gitDiffViewer.selectedRepositoryRoot";
const CODEX_CONFIGURED_CONTEXT = "gitDiffViewer.codexConfigured";
const ALL_COLLAPSED_CONTEXT = "gitDiffViewer.allCollapsed";
const COLLAPSE_ALL_ENABLED_CONTEXT = "treeView.gitDiffViewer.changes.toggleCollapseAll";
const COLLAPSE_ALL_COMMAND = "workbench.actions.treeView.gitDiffViewer.changes.collapseAll";
const MAX_CODEX_DIFF_CHARS = 100_000;
const DEFAULT_COMPARISON = {
    mode: "working",
    baseRef: "HEAD",
};
class DiffViewerController {
    context;
    git = new git_1.GitService();
    contentProvider;
    treeProvider;
    treeView;
    disposables = [];
    snapshots = new Map();
    expandedNodeIds = new Set();
    comparisonStates = new Map();
    repositories = [];
    selectedRepositoryRoot;
    codexStateFile = (0, codexState_1.codexStateFilePath)();
    activeView;
    activeDiff;
    selectedFile;
    activeViewGeneration = 0;
    codexStateWrite = Promise.resolve();
    disposed = false;
    loading = false;
    allCollapsed = true;
    refreshGeneration = 0;
    refreshTimer;
    fileWatcher;
    constructor(context) {
        this.context = context;
        this.contentProvider = new contentProvider_1.GitContentProvider(this.git);
        this.treeProvider = new treeProvider_1.ChangesTreeProvider({
            getRepositories: () => this.repositories,
            getSnapshot: (root) => this.snapshots.get(root),
            getSelectedRepositoryRoot: () => this.selectedRepositoryRoot,
            isLoading: () => this.loading,
        });
        this.treeView = vscode.window.createTreeView(VIEW_ID, {
            treeDataProvider: this.treeProvider,
            showCollapseAll: false,
        });
        this.loadSavedState();
        this.disposables.push(this.contentProvider, this.treeProvider, this.treeView, this.treeView.onDidChangeSelection((event) => {
            this.handleTreeSelection(event.selection[0]);
        }), this.treeView.onDidExpandElement((event) => {
            this.handleExpansionChange(event.element, true);
        }), this.treeView.onDidCollapseElement((event) => {
            this.handleExpansionChange(event.element, false);
        }), vscode.workspace.registerTextDocumentContentProvider(contentProvider_1.GIT_DIFF_SCHEME, this.contentProvider), vscode.commands.registerCommand("gitDiffViewer.refresh", () => this.refresh()), vscode.commands.registerCommand("gitDiffViewer.chooseRepository", () => this.chooseRepository()), vscode.commands.registerCommand("gitDiffViewer.setupCodex", () => this.setupCodex()), vscode.commands.registerCommand("gitDiffViewer.chooseComparison", (node) => this.chooseComparison(node)), vscode.commands.registerCommand("gitDiffViewer.expandChangedDirectories", () => this.expandChangedDirectories()), vscode.commands.registerCommand("gitDiffViewer.collapseAll", () => this.collapseAll()), vscode.commands.registerCommand("gitDiffViewer.compareHead", (node) => this.compareHead(node)), vscode.commands.registerCommand("gitDiffViewer.compareWithVersion", (node) => this.compareWithVersion(node)), vscode.commands.registerCommand("gitDiffViewer.compareVersions", (node) => this.compareVersions(node)), vscode.commands.registerCommand("gitDiffViewer.compareIndex", (node) => this.compareIndex(node)), vscode.commands.registerCommand("gitDiffViewer.openDiff", (node) => this.openDiff(node)), vscode.commands.registerCommand("gitDiffViewer.openFile", (node) => this.openFile(node)), vscode.commands.registerCommand("gitDiffViewer.copyPath", (node) => this.copyPath(node)), vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()), vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()), vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("gitDiffViewer.autoRefresh")) {
                this.configureWatcher();
            }
            if (event.affectsConfiguration("gitDiffViewer.repositorySearchDepth")) {
                void this.refresh();
            }
        }));
        void vscode.commands.executeCommand("setContext", CODEX_CONFIGURED_CONTEXT, false);
        this.updateCollapseToggleContext(true);
        void this.registerGitExtensionWatcher();
        void this.detectCodexConfiguration();
        this.configureWatcher();
        void this.refresh();
    }
    async refresh() {
        const generation = ++this.refreshGeneration;
        this.loading = true;
        this.treeProvider.refresh();
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [];
            const knownRoots = await this.getGitExtensionRepositoryRoots();
            const searchDepth = vscode.workspace
                .getConfiguration("gitDiffViewer")
                .get("repositorySearchDepth", 6);
            const repositories = await this.git.discoverRepositories(workspaceFolders, {
                knownRoots,
                maxDepth: searchDepth,
            });
            if (generation !== this.refreshGeneration) {
                return;
            }
            this.repositories = repositories;
            if (this.selectedRepositoryRoot &&
                !this.findRepositoryByRoot(this.selectedRepositoryRoot)) {
                this.selectedRepositoryRoot = undefined;
                await this.persistSelectedRepository();
            }
            const nextSnapshots = new Map();
            await Promise.all(repositories.map(async (repository) => {
                const comparison = this.getComparison(repository.root);
                try {
                    const [changes, filePaths] = await Promise.all([
                        this.git.getChanges(repository.root, comparison),
                        this.git.getAllFiles(repository.root, comparison),
                    ]);
                    const roots = filePaths.length > 0 || changes.length > 0
                        ? (0, model_1.buildFileTree)(filePaths, changes, repository.root, repository.name)
                        : [
                            {
                                kind: "message",
                                label: "仓库中没有可浏览的文件",
                                description: (0, model_1.comparisonLabel)(comparison),
                                icon: "info",
                                command: {
                                    command: "gitDiffViewer.chooseComparison",
                                    title: "选择对比范围",
                                },
                            },
                        ];
                    nextSnapshots.set(repository.root, {
                        repository,
                        comparison,
                        changes,
                        roots,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    nextSnapshots.set(repository.root, {
                        repository,
                        comparison,
                        changes: [],
                        roots: [
                            {
                                kind: "message",
                                label: "读取 Git 差异失败",
                                description: message,
                                icon: "error",
                                command: {
                                    command: "gitDiffViewer.chooseComparison",
                                    title: "选择对比范围",
                                },
                            },
                        ],
                        error: message,
                    });
                }
            }));
            if (generation !== this.refreshGeneration) {
                return;
            }
            this.snapshots.clear();
            for (const [root, snapshot] of nextSnapshots) {
                this.snapshots.set(root, snapshot);
            }
            this.contentProvider.clearCache();
            this.pruneExpandedNodeIds();
            await vscode.commands.executeCommand("setContext", "gitDiffViewer.hasRepository", repositories.length > 0);
            this.updateViewChrome();
            if (this.activeView) {
                const snapshot = this.snapshots.get(this.activeView.node.repoRoot);
                if (snapshot) {
                    this.activeView = { ...this.activeView, snapshot };
                    this.activeViewGeneration += 1;
                    void this.captureActiveDiff(this.activeView.node, snapshot);
                }
            }
            void this.persistCodexViewState();
        }
        finally {
            if (generation === this.refreshGeneration) {
                this.loading = false;
                this.treeProvider.refresh();
            }
        }
    }
    dispose() {
        this.disposed = true;
        void node_fs_1.promises.unlink(this.codexStateFile).catch(() => undefined);
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.fileWatcher?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }
    async chooseRepository() {
        if (this.repositories.length === 0) {
            const action = await vscode.window.showWarningMessage("当前工作区中没有找到 Git 仓库。", "刷新");
            if (action === "刷新") {
                await this.refresh();
            }
            return;
        }
        const selectedRepository = this.getSelectedRepository();
        const choices = [
            {
                label: "$(repo) 全部仓库",
                description: `${this.repositories.length} 个仓库`,
                repositoryRoot: null,
                picked: selectedRepository === undefined,
            },
            ...this.repositories.map((repository) => ({
                label: repository.name,
                description: repository.branch,
                detail: repository.root,
                repositoryRoot: repository.root,
                picked: selectedRepository?.root === repository.root,
            })),
        ];
        const selected = await vscode.window.showQuickPick(choices, {
            title: "选择 Git 仓库",
            placeHolder: "选择要显示的仓库，或同时浏览全部仓库",
            matchOnDescription: true,
            matchOnDetail: true,
        });
        if (!selected) {
            return;
        }
        this.selectedRepositoryRoot = selected.repositoryRoot ?? undefined;
        await this.persistSelectedRepository();
        this.updateViewChrome();
        this.treeProvider.refresh();
        void this.persistCodexViewState();
    }
    async expandChangedDirectories() {
        const selectedRepository = this.getSelectedRepository();
        const repositories = selectedRepository
            ? [selectedRepository]
            : this.repositories;
        const entries = repositories.flatMap((repository) => (0, model_1.collectChangedDirectories)(this.snapshots.get(repository.root)?.roots ?? []).map((directory) => ({ repository, directory })));
        for (const { repository, directory } of entries) {
            try {
                await this.treeView.reveal(directory, {
                    expand: true,
                    select: false,
                    focus: false,
                });
                const directoryId = (0, model_1.treeNodeId)(directory);
                if (directoryId) {
                    this.expandedNodeIds.add(directoryId);
                }
                if (!selectedRepository && this.repositories.length > 1) {
                    const snapshot = this.snapshots.get(repository.root);
                    const repositoryId = snapshot
                        ? (0, model_1.treeNodeId)({ kind: "repository", snapshot })
                        : undefined;
                    if (repositoryId) {
                        this.expandedNodeIds.add(repositoryId);
                    }
                }
                this.updateCollapseToggleContext();
            }
            catch {
                // A refresh can replace tree data while the expansion is running.
            }
        }
    }
    async collapseAll() {
        await vscode.commands.executeCommand("setContext", COLLAPSE_ALL_ENABLED_CONTEXT, true);
        try {
            await vscode.commands.executeCommand(COLLAPSE_ALL_COMMAND);
        }
        finally {
            await vscode.commands.executeCommand("setContext", COLLAPSE_ALL_ENABLED_CONTEXT, false);
        }
    }
    handleExpansionChange(element, expanded) {
        if (expanded) {
            const id = (0, model_1.treeNodeId)(element);
            if (id) {
                this.expandedNodeIds.add(id);
            }
        }
        else {
            (0, model_1.removeExpandedSubtree)(this.expandedNodeIds, element);
        }
        this.updateCollapseToggleContext();
    }
    pruneExpandedNodeIds() {
        const currentIds = this.treeProvider.getExpandableNodeIds();
        for (const id of this.expandedNodeIds) {
            if (!currentIds.has(id)) {
                this.expandedNodeIds.delete(id);
            }
        }
        this.updateCollapseToggleContext();
    }
    updateCollapseToggleContext(force = false) {
        const allCollapsed = this.expandedNodeIds.size === 0;
        if (!force && allCollapsed === this.allCollapsed) {
            return;
        }
        this.allCollapsed = allCollapsed;
        void vscode.commands.executeCommand("setContext", ALL_COLLAPSED_CONTEXT, allCollapsed);
    }
    async detectCodexConfiguration() {
        const configured = await (0, codexSetup_1.isCodexMcpConfigured)();
        if (!this.disposed) {
            await vscode.commands.executeCommand("setContext", CODEX_CONFIGURED_CONTEXT, configured);
        }
    }
    async setupCodex() {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "配置 Codex 集成",
                cancellable: false,
            }, async (progress) => {
                progress.report({ message: "正在注册本地 MCP 服务…" });
                const serverScript = this.context.asAbsolutePath(path.join("git-diff-viewer", "out", "src", "codexMcpServer.js"));
                await (0, codexSetup_1.configureCodexMcpServer)(serverScript);
                await this.persistCodexViewState();
            });
            await vscode.commands.executeCommand("setContext", CODEX_CONFIGURED_CONTEXT, true);
            vscode.window.showInformationMessage("Codex 集成已配置。新开一个 Codex 会话即可读取当前 Git Diff Viewer 视图。");
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`配置 Codex 集成失败：${message}`);
        }
    }
    handleTreeSelection(node) {
        if (node?.kind !== "file") {
            this.selectedFile = undefined;
        }
        else {
            this.selectedFile = fileReference(node);
        }
        void this.persistCodexViewState();
    }
    async chooseComparison(node) {
        const repository = await this.resolveRepository(node);
        if (!repository) {
            return;
        }
        const current = this.getComparison(repository.root);
        const choices = [
            {
                label: "$(history) 工作区与 HEAD 对比",
                description: current.mode === "working" && current.baseRef === "HEAD"
                    ? "当前"
                    : undefined,
                action: "head",
            },
            {
                label: "$(git-compare) 工作区与指定版本对比…",
                description: current.mode === "working" && current.baseRef !== "HEAD"
                    ? `当前：${current.baseRef}`
                    : undefined,
                action: "working",
            },
            {
                label: "$(versions) 两个版本对比…",
                description: current.mode === "refs" ? (0, model_1.comparisonLabel)(current) : undefined,
                action: "refs",
            },
            {
                label: "$(diff) 暂存区与工作区对比",
                description: current.mode === "index" ? "当前" : undefined,
                action: "index",
            },
        ];
        const selected = await vscode.window.showQuickPick(choices, {
            title: `选择对比范围 · ${repository.name}`,
            placeHolder: "选择要浏览的 Git 差异范围",
        });
        if (!selected) {
            return;
        }
        switch (selected.action) {
            case "head":
                await this.setComparison(repository, {
                    mode: "working",
                    baseRef: "HEAD",
                });
                break;
            case "working": {
                const ref = await this.pickRef(repository, "工作区与指定版本对比", "选择作为基准的版本");
                if (ref) {
                    await this.setComparison(repository, {
                        mode: "working",
                        baseRef: ref,
                    });
                }
                break;
            }
            case "refs":
                await this.pickTwoRefs(repository);
                break;
            case "index":
                await this.setComparison(repository, { mode: "index" });
                break;
        }
    }
    async compareHead(node) {
        const repository = await this.resolveRepository(node);
        if (!repository) {
            return;
        }
        await this.setComparison(repository, {
            mode: "working",
            baseRef: "HEAD",
        });
    }
    async compareWithVersion(node) {
        const repository = await this.resolveRepository(node);
        if (!repository) {
            return;
        }
        const ref = await this.pickRef(repository, "工作区与指定版本对比", "选择作为基准的版本");
        if (ref) {
            await this.setComparison(repository, {
                mode: "working",
                baseRef: ref,
            });
        }
    }
    async compareVersions(node) {
        const repository = await this.resolveRepository(node);
        if (!repository) {
            return;
        }
        await this.pickTwoRefs(repository);
    }
    async compareIndex(node) {
        const repository = await this.resolveRepository(node);
        if (!repository) {
            return;
        }
        await this.setComparison(repository, { mode: "index" });
    }
    async pickTwoRefs(repository) {
        const baseRef = await this.pickRef(repository, "两个版本对比", "选择左侧（基准）版本");
        if (!baseRef) {
            return;
        }
        const targetRef = await this.pickRef(repository, "两个版本对比", "选择右侧（目标）版本", baseRef);
        if (!targetRef) {
            return;
        }
        await this.setComparison(repository, {
            mode: "refs",
            baseRef,
            targetRef,
        });
    }
    async pickRef(repository, title, placeHolder, excludedRef) {
        let refs = [];
        try {
            refs = await this.git.getRefItems(repository.root);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`无法读取版本列表：${message}`);
        }
        const items = [
            {
                label: "$(git-commit) HEAD",
                description: `${repository.branch} · 当前提交`,
                ref: "HEAD",
                alwaysShow: true,
            },
        ];
        appendRefGroup(items, "本地分支", refs.filter((ref) => ref.kind === "branch"));
        appendRefGroup(items, "远程分支", refs.filter((ref) => ref.kind === "remote"));
        appendRefGroup(items, "标签", refs.filter((ref) => ref.kind === "tag"));
        appendRefGroup(items, "最近提交", refs.filter((ref) => ref.kind === "commit").slice(0, 40));
        items.push({
            label: "$(edit) 输入提交、分支或标签…",
            action: "input",
            alwaysShow: true,
        });
        const filteredItems = excludedRef === undefined
            ? items
            : items.filter((item) => item.action === "input" ||
                item.kind === vscode.QuickPickItemKind.Separator ||
                item.ref !== excludedRef);
        const selected = await vscode.window.showQuickPick(filteredItems, {
            title: `选择版本 · ${repository.name}`,
            placeHolder,
            matchOnDescription: true,
            ignoreFocusOut: true,
        });
        if (!selected) {
            return undefined;
        }
        if (selected.action === "input") {
            const input = await vscode.window.showInputBox({
                title,
                prompt: "输入提交哈希、分支名、标签或类似 HEAD~1 的版本表达式",
                placeHolder: "例如：main、v1.2.0、a1b2c3d、HEAD~2",
                ignoreFocusOut: true,
                validateInput: async (value) => {
                    const trimmed = value.trim();
                    if (!trimmed) {
                        return "版本不能为空";
                    }
                    if (trimmed === excludedRef) {
                        return "请选择与左侧不同的版本";
                    }
                    return (await this.git.refExists(repository.root, trimmed))
                        ? undefined
                        : "找不到该提交、分支或标签";
                },
            });
            return input?.trim();
        }
        return selected.ref;
    }
    async setComparison(repository, comparison) {
        this.comparisonStates.set(repository.root, comparison);
        await this.persistComparisonStates();
        await this.refresh();
    }
    async openDiff(node) {
        if (!node || node.kind !== "file") {
            return;
        }
        if (!node.change) {
            await this.openFile(node);
            return;
        }
        const snapshot = this.snapshots.get(node.repoRoot);
        if (!snapshot) {
            vscode.window.showWarningMessage("变更数据已过期，请刷新后重试。");
            return;
        }
        const diff = this.createDiffUris(node, snapshot);
        if (!diff) {
            return;
        }
        this.setActiveView(node, snapshot);
        const labels = (0, model_1.comparisonSideLabels)(snapshot.comparison);
        await vscode.commands.executeCommand("vscode.diff", diff.left, diff.right, (0, treeProvider_1.diffTitle)(node.filePath, labels.base, labels.target), {
            preview: false,
            preserveFocus: false,
        });
        void this.captureActiveDiff(node, snapshot);
    }
    async openFile(node) {
        if (!node || node.kind !== "file") {
            return;
        }
        const snapshot = this.snapshots.get(node.repoRoot);
        if (!snapshot) {
            return;
        }
        if (node.change?.status === "D") {
            vscode.window.showInformationMessage("该文件在当前目标版本中已删除。");
            return;
        }
        this.setActiveView(node, snapshot);
        if (snapshot.comparison.mode === "refs") {
            const uri = (0, contentProvider_1.createVirtualContentUri)({
                source: "ref",
                repoRoot: node.repoRoot,
                filePath: node.filePath,
                ref: snapshot.comparison.targetRef ?? "HEAD",
            });
            await vscode.window.showTextDocument(uri, { preview: true });
            return;
        }
        const fileUri = vscode.Uri.file(path.join(node.repoRoot, node.filePath));
        try {
            await vscode.window.showTextDocument(fileUri, { preview: true });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`无法打开文件：${message}`);
        }
    }
    async copyPath(node) {
        if (!node || node.kind !== "file") {
            return;
        }
        await vscode.env.clipboard.writeText(node.filePath);
    }
    createDiffUris(node, snapshot) {
        const comparison = snapshot.comparison;
        const change = node.change;
        if (!change) {
            return undefined;
        }
        const empty = (filePath) => (0, contentProvider_1.createVirtualContentUri)({
            source: "empty",
            repoRoot: node.repoRoot,
            filePath,
        });
        let left;
        if (change.status === "A") {
            left = empty(change.oldPath);
        }
        else if (comparison.mode === "index") {
            left = (0, contentProvider_1.createVirtualContentUri)({
                source: "index",
                repoRoot: node.repoRoot,
                filePath: change.oldPath,
            });
        }
        else {
            left = (0, contentProvider_1.createVirtualContentUri)({
                source: "ref",
                repoRoot: node.repoRoot,
                filePath: change.oldPath,
                ref: comparison.baseRef ?? "HEAD",
            });
        }
        let right;
        if (change.status === "D") {
            right = empty(change.path);
        }
        else if (comparison.mode === "refs") {
            right = (0, contentProvider_1.createVirtualContentUri)({
                source: "ref",
                repoRoot: node.repoRoot,
                filePath: change.path,
                ref: comparison.targetRef ?? "HEAD",
            });
        }
        else {
            right = vscode.Uri.file(path.join(node.repoRoot, change.path));
        }
        return { left, right };
    }
    setActiveView(node, snapshot) {
        this.activeView = { node, snapshot };
        this.activeDiff = undefined;
        this.activeViewGeneration += 1;
        void this.persistCodexViewState();
    }
    async captureActiveDiff(node, snapshot) {
        if (!node.change) {
            return;
        }
        const generation = this.activeViewGeneration;
        const labels = (0, model_1.comparisonSideLabels)(snapshot.comparison);
        try {
            const [left, right] = await Promise.all([
                this.readDiffSide(node, snapshot, "left"),
                this.readDiffSide(node, snapshot, "right"),
            ]);
            if (generation !== this.activeViewGeneration ||
                !this.isActiveFile(node)) {
                return;
            }
            const truncated = left.length > MAX_CODEX_DIFF_CHARS ||
                right.length > MAX_CODEX_DIFF_CHARS;
            this.activeDiff = {
                repositoryRoot: node.repoRoot,
                repositoryName: snapshot.repository.name,
                filePath: node.filePath,
                oldPath: node.change.oldPath,
                status: node.change.status,
                baseLabel: labels.base,
                targetLabel: labels.target,
                left: truncate(left, MAX_CODEX_DIFF_CHARS),
                right: truncate(right, MAX_CODEX_DIFF_CHARS),
                truncated,
            };
        }
        catch (error) {
            if (generation !== this.activeViewGeneration ||
                !this.isActiveFile(node)) {
                return;
            }
            this.activeDiff = {
                repositoryRoot: node.repoRoot,
                repositoryName: snapshot.repository.name,
                filePath: node.filePath,
                oldPath: node.change.oldPath,
                status: node.change.status,
                baseLabel: labels.base,
                targetLabel: labels.target,
                left: "",
                right: "",
                error: error instanceof Error ? error.message : String(error),
            };
        }
        await this.persistCodexViewState();
    }
    isActiveFile(node) {
        return (this.activeView?.node.repoRoot === node.repoRoot &&
            this.activeView.node.filePath === node.filePath);
    }
    async readDiffSide(node, snapshot, side) {
        const change = node.change;
        if (!change) {
            return "";
        }
        if (side === "left") {
            if (change.status === "A") {
                return "";
            }
            if (snapshot.comparison.mode === "index") {
                return this.git.getIndexContent(node.repoRoot, change.oldPath);
            }
            return this.git.getRefContent(node.repoRoot, snapshot.comparison.baseRef ?? "HEAD", change.oldPath);
        }
        if (change.status === "D") {
            return "";
        }
        if (snapshot.comparison.mode === "refs") {
            return this.git.getRefContent(node.repoRoot, snapshot.comparison.targetRef ?? "HEAD", change.path);
        }
        return node_fs_1.promises.readFile(path.join(node.repoRoot, change.path), "utf8");
    }
    async persistCodexViewState() {
        const selectedRepository = this.getSelectedRepository();
        const visibleRepositories = selectedRepository
            ? [selectedRepository]
            : this.repositories;
        const visibleChanges = visibleRepositories.flatMap((repository) => (this.snapshots.get(repository.root)?.changes ?? []).map((change) => ({
            repositoryRoot: repository.root,
            repositoryName: repository.name,
            filePath: change.path,
            oldPath: change.oldPath,
            status: change.status,
        })));
        const state = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            windowId: String(process.pid),
            workspaceFolders: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
            repositories: this.repositories,
            visibleRepositories,
            comparisons: visibleRepositories.map((repository) => ({
                repositoryRoot: repository.root,
                comparison: this.getComparison(repository.root),
            })),
            visibleChanges,
            selectedFile: this.selectedFile,
            activeFile: this.activeView
                ? fileReference(this.activeView.node)
                : undefined,
            activeDiff: this.activeDiff,
        };
        this.codexStateWrite = this.codexStateWrite
            .catch(() => undefined)
            .then(() => (0, codexState_1.writeCodexViewState)(state, this.codexStateFile))
            .catch((error) => {
            console.warn("Failed to write Codex view state", error);
        });
        await this.codexStateWrite;
    }
    async resolveRepository(node) {
        if (node?.kind === "repository") {
            return node.snapshot.repository;
        }
        if (node?.kind === "file" || node?.kind === "directory") {
            const root = node.repoRoot;
            return this.repositories.find((repository) => repository.root === root);
        }
        if (this.repositories.length === 0) {
            const action = await vscode.window.showWarningMessage("当前工作区中没有找到 Git 仓库。", "刷新");
            if (action === "刷新") {
                await this.refresh();
            }
            return undefined;
        }
        const selectedRepository = this.getSelectedRepository();
        if (selectedRepository) {
            return selectedRepository;
        }
        if (this.repositories.length === 1) {
            return this.repositories[0];
        }
        const selected = await vscode.window.showQuickPick(this.repositories.map((repository) => ({
            label: repository.name,
            description: repository.branch,
            detail: repository.root,
            repository,
        })), {
            title: "选择 Git 仓库",
            placeHolder: "选择要查看差异的仓库",
        });
        return selected?.repository;
    }
    getComparison(repoRoot) {
        return this.comparisonStates.get(repoRoot) ?? DEFAULT_COMPARISON;
    }
    getSelectedRepository() {
        return this.selectedRepositoryRoot
            ? this.findRepositoryByRoot(this.selectedRepositoryRoot)
            : undefined;
    }
    findRepositoryByRoot(repoRoot) {
        return this.repositories.find((repository) => samePath(repository.root, repoRoot));
    }
    updateViewChrome() {
        const selectedRepository = this.getSelectedRepository();
        if (selectedRepository) {
            const snapshot = this.snapshots.get(selectedRepository.root);
            this.treeView.description = snapshot
                ? `${selectedRepository.name} · ${(0, model_1.comparisonLabel)(snapshot.comparison)}`
                : selectedRepository.name;
        }
        else if (this.repositories.length === 1) {
            const snapshot = this.snapshots.get(this.repositories[0].root);
            this.treeView.description = snapshot
                ? (0, model_1.comparisonLabel)(snapshot.comparison)
                : undefined;
        }
        else if (this.repositories.length > 1) {
            this.treeView.description = `${this.repositories.length} 个仓库`;
        }
        else {
            this.treeView.description = undefined;
        }
        const visibleRoots = selectedRepository
            ? new Set([selectedRepository.root])
            : new Set(this.repositories.map((repository) => repository.root));
        const total = Array.from(this.snapshots.entries()).reduce((count, [root, snapshot]) => visibleRoots.has(root) ? count + snapshot.changes.length : count, 0);
        const hasChangedDirectories = Array.from(visibleRoots).some((root) => {
            const snapshot = this.snapshots.get(root);
            return snapshot
                ? (0, model_1.collectChangedDirectories)(snapshot.roots).length > 0
                : false;
        });
        void vscode.commands.executeCommand("setContext", "gitDiffViewer.hasChanges", total > 0);
        void vscode.commands.executeCommand("setContext", "gitDiffViewer.hasChangedDirectories", hasChangedDirectories);
        this.treeView.badge =
            total > 0
                ? {
                    value: total,
                    tooltip: `${total} 个变更文件`,
                }
                : undefined;
    }
    scheduleRefresh() {
        if (!vscode.workspace.getConfiguration("gitDiffViewer").get("autoRefresh", true)) {
            return;
        }
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refresh();
        }, 250);
    }
    configureWatcher() {
        this.fileWatcher?.dispose();
        this.fileWatcher = undefined;
        if (!vscode.workspace.getConfiguration("gitDiffViewer").get("autoRefresh", true)) {
            return;
        }
        this.fileWatcher = vscode.workspace.createFileSystemWatcher("**/*");
        this.fileWatcher.onDidCreate(() => this.scheduleRefresh());
        this.fileWatcher.onDidChange(() => this.scheduleRefresh());
        this.fileWatcher.onDidDelete(() => this.scheduleRefresh());
    }
    async getGitExtensionApi() {
        const extension = vscode.extensions.getExtension("vscode.git");
        if (!extension) {
            return undefined;
        }
        try {
            const exports = extension.isActive
                ? extension.exports
                : await extension.activate();
            return exports?.getAPI(1);
        }
        catch {
            return undefined;
        }
    }
    async getGitExtensionRepositoryRoots() {
        const api = await this.getGitExtensionApi();
        return (api?.repositories.map((repository) => repository.rootUri.fsPath) ?? []);
    }
    async registerGitExtensionWatcher() {
        const api = await this.getGitExtensionApi();
        if (!api || this.disposed) {
            return;
        }
        if (api.onDidOpenRepository) {
            this.disposables.push(api.onDidOpenRepository(() => this.scheduleRefresh()));
        }
        if (api.onDidCloseRepository) {
            this.disposables.push(api.onDidCloseRepository(() => this.scheduleRefresh()));
        }
    }
    loadSavedState() {
        this.loadSavedComparisonStates();
        const root = this.context.workspaceState.get(SELECTED_REPOSITORY_KEY);
        this.selectedRepositoryRoot = root || undefined;
    }
    loadSavedComparisonStates() {
        const saved = this.context.workspaceState.get(COMPARISON_STATE_KEY);
        if (!saved) {
            return;
        }
        for (const [repoRoot, comparison] of Object.entries(saved)) {
            if (comparison &&
                (comparison.mode === "working" ||
                    comparison.mode === "refs" ||
                    comparison.mode === "index")) {
                this.comparisonStates.set(repoRoot, comparison);
            }
        }
    }
    async persistSelectedRepository() {
        await this.context.workspaceState.update(SELECTED_REPOSITORY_KEY, this.selectedRepositoryRoot);
    }
    async persistComparisonStates() {
        const serialized = {};
        for (const [repoRoot, comparison] of this.comparisonStates) {
            serialized[repoRoot] = comparison;
        }
        await this.context.workspaceState.update(COMPARISON_STATE_KEY, serialized);
    }
}
exports.DiffViewerController = DiffViewerController;
function fileReference(node) {
    return {
        repositoryRoot: node.repoRoot,
        filePath: node.filePath,
        oldPath: node.change?.oldPath,
        status: node.change?.status,
    };
}
function truncate(value, maxLength) {
    return value.length > maxLength
        ? `${value.slice(0, maxLength)}\n\n[truncated]`
        : value;
}
function samePath(left, right) {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === "win32"
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}
function appendRefGroup(items, title, refs) {
    if (refs.length === 0) {
        return;
    }
    items.push({
        label: title,
        kind: vscode.QuickPickItemKind.Separator,
    });
    for (const ref of refs) {
        items.push({
            label: ref.label,
            description: ref.description,
            ref: ref.ref,
        });
    }
}
//# sourceMappingURL=controller.js.map
