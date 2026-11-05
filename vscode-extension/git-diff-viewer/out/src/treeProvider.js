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
exports.ChangesTreeProvider = void 0;
exports.diffTitle = diffTitle;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const model_1 = require("./model");
class ChangesTreeProvider {
    host;
    changed = new vscode.EventEmitter();
    onDidChangeTreeData = this.changed.event;
    constructor(host) {
        this.host = host;
    }
    refresh() {
        this.changed.fire();
    }
    getChildren(element) {
        if (!element) {
            const repositories = this.host.getRepositories();
            if (repositories.length === 0) {
                if (this.host.isLoading()) {
                    return [
                        {
                            kind: "message",
                            label: "正在读取 Git 仓库…",
                            icon: "info",
                        },
                    ];
                }
                return [
                    {
                        kind: "message",
                        label: "未找到 Git 仓库",
                        description: "请打开包含 Git 仓库的工作区",
                        icon: "warning",
                        command: {
                            command: "gitDiffViewer.refresh",
                            title: "刷新",
                        },
                    },
                ];
            }
            const selectedRoot = this.host.getSelectedRepositoryRoot();
            const selectedRepository = selectedRoot === undefined
                ? undefined
                : repositories.find((repository) => samePath(repository.root, selectedRoot));
            if (selectedRepository) {
                return this.snapshotRoots(selectedRepository.root);
            }
            if (repositories.length === 1) {
                return this.snapshotRoots(repositories[0].root);
            }
            return repositories.map((repository) => ({
                kind: "repository",
                snapshot: this.host.getSnapshot(repository.root) ?? {
                    repository,
                    comparison: { mode: "working", baseRef: "HEAD" },
                    changes: [],
                    roots: [],
                },
            }));
        }
        if (element.kind === "repository") {
            return this.snapshotRoots(element.snapshot.repository.root);
        }
        if (element.kind === "directory") {
            return element.children;
        }
        return [];
    }
    getParent(element) {
        if (element.kind === "repository") {
            return undefined;
        }
        if (element.kind === "message") {
            for (const repository of this.host.getRepositories()) {
                const snapshot = this.host.getSnapshot(repository.root);
                if (snapshot?.roots.includes(element)) {
                    return this.snapshotRootsAreTopLevel(repository.root)
                        ? undefined
                        : { kind: "repository", snapshot };
                }
            }
            return undefined;
        }
        const snapshot = this.host.getSnapshot(element.repoRoot);
        if (!snapshot) {
            return undefined;
        }
        const parent = findParentNode(snapshot.roots, element);
        if (parent) {
            return parent;
        }
        return this.snapshotRootsAreTopLevel(element.repoRoot)
            ? undefined
            : { kind: "repository", snapshot };
    }
    getTreeItem(element) {
        switch (element.kind) {
            case "repository":
                return this.repositoryTreeItem(element);
            case "directory":
                return this.directoryTreeItem(element);
            case "file":
                return this.fileTreeItem(element);
            case "message":
                return this.messageTreeItem(element);
            default:
                return new vscode.TreeItem("未知节点");
        }
    }
    dispose() {
        this.changed.dispose();
    }
    getExpandableNodeIds() {
        const ids = new Set();
        const visit = (nodes) => {
            for (const node of nodes) {
                if (node.kind !== "repository" && node.kind !== "directory") {
                    continue;
                }
                const id = (0, model_1.treeNodeId)(node);
                if (id) {
                    ids.add(id);
                }
                visit(this.getChildren(node));
            }
        };
        visit(this.getChildren());
        return ids;
    }
    snapshotRoots(repoRoot) {
        const snapshot = this.host.getSnapshot(repoRoot);
        if (!snapshot) {
            return [
                {
                    kind: "message",
                    label: this.host.isLoading() ? "正在读取变更…" : "暂无变更数据",
                    icon: "info",
                },
            ];
        }
        return snapshot.roots;
    }
    snapshotRootsAreTopLevel(repoRoot) {
        const selectedRoot = this.host.getSelectedRepositoryRoot();
        return ((selectedRoot !== undefined && samePath(repoRoot, selectedRoot)) ||
            this.host.getRepositories().length === 1);
    }
    repositoryTreeItem(node) {
        const snapshot = node.snapshot;
        const item = new vscode.TreeItem(snapshot.repository.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = (0, model_1.treeNodeId)(node);
        item.description = snapshot.error
            ? "读取失败"
            : (0, model_1.comparisonLabel)(snapshot.comparison);
        item.contextValue = "gitDiffViewer.repository";
        item.iconPath = new vscode.ThemeIcon("repo");
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${snapshot.repository.name}**  \n`);
        tooltip.appendCodeblock(snapshot.repository.root, "text");
        tooltip.appendMarkdown(`分支：${snapshot.repository.branch}  \n`);
        tooltip.appendMarkdown(`对比：${(0, model_1.comparisonLabel)(snapshot.comparison)}  \n`);
        tooltip.appendMarkdown(`变更文件：${snapshot.changes.length}`);
        item.tooltip = tooltip;
        return item;
    }
    directoryTreeItem(node) {
        const stateText = (0, model_1.directoryStateText)(node.summary);
        const countsText = (0, model_1.directoryCountsText)(node.summary);
        const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.id = (0, model_1.treeNodeId)(node);
        item.description =
            node.summary.total > 0
                ? `${stateText} · ${node.summary.total}`
                : undefined;
        item.contextValue = "gitDiffViewer.directory";
        item.iconPath = directoryIcon(node.summary);
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${node.relativePath}/**  \n\n`);
        tooltip.appendMarkdown(`**${stateText}**  \n`);
        if (node.summary.total > 0) {
            tooltip.appendMarkdown(`${countsText}  \n`);
            tooltip.appendMarkdown(`共 ${node.summary.total} 个变更文件`);
        }
        else {
            tooltip.appendMarkdown("该目录没有 Git 差异");
        }
        item.tooltip = tooltip;
        return item;
    }
    fileTreeItem(node) {
        const change = node.change;
        const filename = node.filePath.split("/").pop() ?? node.filePath;
        const item = new vscode.TreeItem(filename, vscode.TreeItemCollapsibleState.None);
        item.id = (0, model_1.treeNodeId)(node);
        item.resourceUri = vscode.Uri.file(path.join(node.repoRoot, node.filePath));
        if (!change) {
            item.contextValue = "gitDiffViewer.file";
            item.command = {
                command: "gitDiffViewer.openFile",
                title: "打开文件",
                arguments: [node],
            };
            const tooltip = new vscode.MarkdownString();
            tooltip.appendMarkdown(`**${filename}**  \n`);
            tooltip.appendCodeblock(node.filePath, "text");
            tooltip.appendMarkdown("无 Git 差异，点击打开文件。");
            item.tooltip = tooltip;
            return item;
        }
        const statusLabel = (0, model_1.fileStatusLabel)(change.status);
        const badge = change.similarity !== undefined && change.status === "R"
            ? `${(0, model_1.fileStatusBadge)(change.status)}${change.similarity}%`
            : (0, model_1.fileStatusBadge)(change.status);
        item.description = `${badge} · ${statusLabel}`;
        item.contextValue = "gitDiffViewer.changedFile";
        item.iconPath = fileIcon(change.status);
        item.command = {
            command: "gitDiffViewer.openDiff",
            title: "打开差异",
            arguments: [node],
        };
        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${filename}**  \n`);
        tooltip.appendCodeblock(node.filePath, "text");
        tooltip.appendMarkdown(`状态：${statusLabel} (${badge})  \n`);
        if ((change.status === "R" || change.status === "C") &&
            change.oldPath !== change.path) {
            tooltip.appendMarkdown(`原路径：`);
            tooltip.appendCodeblock(change.oldPath, "text");
        }
        tooltip.appendMarkdown("点击打开原生 Git diff。");
        item.tooltip = tooltip;
        return item;
    }
    messageTreeItem(node) {
        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.description = node.description;
        item.iconPath = new vscode.ThemeIcon(node.icon === "error"
            ? "error"
            : node.icon === "warning"
                ? "warning"
                : "info");
        if (node.command) {
            item.command = node.command;
        }
        return item;
    }
}
exports.ChangesTreeProvider = ChangesTreeProvider;
function fileIcon(status) {
    switch (status) {
        case "A":
            return new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
        case "D":
            return new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
        case "R":
        case "C":
            return new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
        case "U":
            return new vscode.ThemeIcon("warning", new vscode.ThemeColor("gitDecoration.conflictingResourceForeground"));
        default:
            return new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
    }
}
function directoryIcon(summary) {
    if (summary.total === 0) {
        return new vscode.ThemeIcon("folder");
    }
    if (summary.added === summary.total) {
        return new vscode.ThemeIcon("folder", new vscode.ThemeColor("gitDecoration.addedResourceForeground"));
    }
    if (summary.deleted === summary.total) {
        return new vscode.ThemeIcon("folder", new vscode.ThemeColor("gitDecoration.deletedResourceForeground"));
    }
    return new vscode.ThemeIcon("folder", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground"));
}
function diffTitle(changePath, baseLabel, targetLabel) {
    return `${path.posix.basename(changePath)} (${baseLabel} ↔ ${targetLabel})`;
}
function samePath(left, right) {
    const normalizedLeft = path.resolve(left);
    const normalizedRight = path.resolve(right);
    return process.platform === "win32"
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}
function findParentNode(nodes, target) {
    for (const node of nodes) {
        if (node.kind !== "directory") {
            continue;
        }
        if (node.children.includes(target)) {
            return node;
        }
        const parent = findParentNode(node.children, target);
        if (parent) {
            return parent;
        }
    }
    return undefined;
}
//# sourceMappingURL=treeProvider.js.map