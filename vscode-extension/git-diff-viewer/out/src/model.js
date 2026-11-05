"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptySummary = createEmptySummary;
exports.addToSummary = addToSummary;
exports.mergeSummaries = mergeSummaries;
exports.directoryStateText = directoryStateText;
exports.directoryCountsText = directoryCountsText;
exports.fileStatusLabel = fileStatusLabel;
exports.fileStatusBadge = fileStatusBadge;
exports.comparisonLabel = comparisonLabel;
exports.comparisonSideLabels = comparisonSideLabels;
exports.displayRef = displayRef;
exports.parseNameStatus = parseNameStatus;
exports.buildChangeTree = buildChangeTree;
exports.collectChangedDirectories = collectChangedDirectories;
exports.treeNodeId = treeNodeId;
exports.removeExpandedSubtree = removeExpandedSubtree;
exports.buildFileTree = buildFileTree;
const STATUS_ALIASES = {
    A: "A",
    M: "M",
    D: "D",
    R: "R",
    C: "C",
    T: "T",
    U: "U",
};
function createEmptySummary() {
    return {
        added: 0,
        modified: 0,
        deleted: 0,
        renamed: 0,
        total: 0,
    };
}
function addToSummary(summary, change) {
    summary.total += 1;
    switch (change.status) {
        case "A":
            summary.added += 1;
            break;
        case "D":
            summary.deleted += 1;
            break;
        case "R":
        case "C":
            summary.renamed += 1;
            break;
        default:
            summary.modified += 1;
            break;
    }
}
function mergeSummaries(target, source) {
    target.added += source.added;
    target.modified += source.modified;
    target.deleted += source.deleted;
    target.renamed += source.renamed;
    target.total += source.total;
}
function directoryStateText(summary) {
    if (summary.total === 0) {
        return "无变化";
    }
    if (summary.added === summary.total) {
        return "新增";
    }
    if (summary.added > 0) {
        return "修改 + 新增";
    }
    return "修改";
}
function directoryCountsText(summary) {
    const parts = [];
    if (summary.modified > 0) {
        parts.push(`修改 ${summary.modified}`);
    }
    if (summary.added > 0) {
        parts.push(`新增 ${summary.added}`);
    }
    if (summary.deleted > 0) {
        parts.push(`删除 ${summary.deleted}`);
    }
    if (summary.renamed > 0) {
        parts.push(`重命名 ${summary.renamed}`);
    }
    return parts.join(" · ");
}
function fileStatusLabel(status) {
    switch (status) {
        case "A":
            return "新增";
        case "M":
            return "修改";
        case "D":
            return "删除";
        case "R":
            return "重命名";
        case "C":
            return "复制";
        case "T":
            return "类型变更";
        case "U":
            return "冲突";
        default:
            return status;
    }
}
function fileStatusBadge(status) {
    return status;
}
function comparisonLabel(state) {
    switch (state.mode) {
        case "working":
            return `${displayRef(state.baseRef ?? "HEAD")} ↔ 工作区`;
        case "refs":
            return `${displayRef(state.baseRef ?? "HEAD")} ↔ ${displayRef(state.targetRef ?? "HEAD")}`;
        case "index":
            return "暂存区 ↔ 工作区";
        default:
            return "未知对比";
    }
}
function comparisonSideLabels(state) {
    switch (state.mode) {
        case "working":
            return { base: displayRef(state.baseRef ?? "HEAD"), target: "工作区" };
        case "refs":
            return {
                base: displayRef(state.baseRef ?? "HEAD"),
                target: displayRef(state.targetRef ?? "HEAD"),
            };
        case "index":
            return { base: "暂存区", target: "工作区" };
        default:
            return { base: "基准", target: "目标" };
    }
}
function displayRef(ref) {
    return ref
        .replace(/^refs\/heads\//, "")
        .replace(/^refs\/remotes\//, "")
        .replace(/^refs\/tags\//, "");
}
function parseNameStatus(raw) {
    if (!raw) {
        return [];
    }
    if (!raw.includes("\0")) {
        return parseLineSeparatedNameStatus(raw);
    }
    const fields = raw.split("\0");
    const changes = [];
    let index = 0;
    while (index < fields.length) {
        let token = fields[index++];
        while (token === "" && index < fields.length) {
            token = fields[index++];
        }
        if (!token) {
            break;
        }
        const parsedStatus = parseStatusToken(token);
        const { status, similarity } = parsedStatus;
        if (status === "R" || status === "C") {
            const oldPath = fields[index++];
            const path = fields[index++];
            if (oldPath === undefined || path === undefined) {
                break;
            }
            changes.push({ status, oldPath, path, similarity });
            continue;
        }
        const path = fields[index++];
        if (path === undefined) {
            break;
        }
        changes.push({
            status,
            oldPath: path,
            path,
            similarity,
        });
    }
    return changes;
}
function parseLineSeparatedNameStatus(raw) {
    const changes = [];
    for (const line of raw.split(/\r?\n/)) {
        if (!line) {
            continue;
        }
        const fields = line.split("\t");
        const statusToken = fields.shift();
        if (!statusToken) {
            continue;
        }
        const { status, similarity } = parseStatusToken(statusToken);
        const path = fields[0];
        if (!path) {
            continue;
        }
        if (status === "R" || status === "C") {
            const oldPath = fields[0];
            const renamedPath = fields[1];
            if (oldPath && renamedPath) {
                changes.push({
                    status,
                    oldPath,
                    path: renamedPath,
                    similarity,
                });
            }
            continue;
        }
        changes.push({
            status,
            oldPath: path,
            path,
            similarity,
        });
    }
    return changes;
}
function parseStatusToken(token) {
    const statusCode = token[0]?.toUpperCase() ?? "M";
    const status = STATUS_ALIASES[statusCode] ?? "M";
    const similarityMatch = token.match(/\d+/);
    const similarity = similarityMatch
        ? Number.parseInt(similarityMatch[0], 10)
        : undefined;
    return { status, similarity };
}
function buildChangeTree(changes, repoRoot, rootName) {
    return buildFileTree(changes.map((change) => change.path), changes, repoRoot, rootName);
}
function collectChangedDirectories(nodes) {
    const directories = [];
    const visit = (treeNodes) => {
        for (const node of treeNodes) {
            if (node.kind !== "directory") {
                continue;
            }
            if (node.summary.total > 0) {
                directories.push(node);
            }
            visit(node.children);
        }
    };
    visit(nodes);
    return directories;
}
function treeNodeId(node) {
    switch (node.kind) {
        case "repository":
            return `repo:${node.snapshot.repository.root}`;
        case "directory":
            return `dir:${node.repoRoot}:${node.relativePath}`;
        case "file":
            return `file:${node.repoRoot}:${node.filePath}`;
        default:
            return undefined;
    }
}
function removeExpandedSubtree(expandedNodeIds, node) {
    const id = treeNodeId(node);
    if (!id) {
        return;
    }
    expandedNodeIds.delete(id);
    let childPrefix;
    if (node.kind === "repository") {
        childPrefix = `dir:${node.snapshot.repository.root}:`;
    }
    else if (node.kind === "directory") {
        childPrefix = `${id}/`;
    }
    if (!childPrefix) {
        return;
    }
    for (const expandedId of expandedNodeIds) {
        if (expandedId.startsWith(childPrefix)) {
            expandedNodeIds.delete(expandedId);
        }
    }
}
function buildFileTree(filePaths, changes, repoRoot, rootName) {
    const root = {
        name: "",
        relativePath: "",
        directories: new Map(),
        files: [],
        summary: createEmptySummary(),
    };
    const entries = new Map();
    for (const filePath of filePaths) {
        const normalizedPath = normalizeGitPath(filePath);
        if (normalizedPath) {
            entries.set(normalizedPath, { path: normalizedPath });
        }
    }
    for (const change of changes) {
        const normalizedPath = normalizeGitPath(change.path);
        if (normalizedPath) {
            entries.set(normalizedPath, { path: normalizedPath, change });
        }
    }
    for (const entry of entries.values()) {
        const normalizedPath = entry.path;
        const segments = normalizedPath.split("/").filter(Boolean);
        if (segments.length === 0) {
            continue;
        }
        let directory = root;
        if (entry.change) {
            addToSummary(directory.summary, entry.change);
        }
        for (let segmentIndex = 0; segmentIndex < segments.length - 1; segmentIndex++) {
            const segment = segments[segmentIndex];
            let child = directory.directories.get(segment);
            if (!child) {
                const relativePath = directory.relativePath
                    ? `${directory.relativePath}/${segment}`
                    : segment;
                child = {
                    name: segment,
                    relativePath,
                    directories: new Map(),
                    files: [],
                    summary: createEmptySummary(),
                };
                directory.directories.set(segment, child);
            }
            if (entry.change) {
                addToSummary(child.summary, entry.change);
            }
            directory = child;
        }
        directory.files.push({
            kind: "file",
            repoRoot,
            rootName,
            filePath: normalizedPath,
            change: entry.change,
        });
    }
    const toTreeNodes = (directory) => {
        const directories = Array.from(directory.directories.values())
            .sort((left, right) => compareNames(left.name, right.name))
            .map((child) => ({
            kind: "directory",
            repoRoot,
            rootName,
            name: child.name,
            relativePath: child.relativePath,
            children: toTreeNodes(child),
            summary: child.summary,
        }));
        const files = directory.files
            .slice()
            .sort((left, right) => compareNames(left.filePath, right.filePath));
        return [...directories, ...files];
    };
    return toTreeNodes(root);
}
function normalizeGitPath(filePath) {
    return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}
function compareNames(left, right) {
    return left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
    });
}
//# sourceMappingURL=model.js.map