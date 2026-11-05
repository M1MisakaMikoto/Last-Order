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
exports.codexStateFilePath = codexStateFilePath;
exports.writeCodexViewState = writeCodexViewState;
exports.readCodexViewState = readCodexViewState;
const node_fs_1 = require("node:fs");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const STATE_DIRECTORY = path.join(os.tmpdir(), "git-diff-viewer", "codex-state");
function codexStateFilePath(windowId = String(process.pid)) {
    return path.join(STATE_DIRECTORY, `state-${windowId}.json`);
}
async function writeCodexViewState(state, filePath = codexStateFilePath(state.windowId)) {
    await node_fs_1.promises.mkdir(path.dirname(filePath), {
        recursive: true,
        mode: 0o700,
    });
    await node_fs_1.promises.writeFile(filePath, JSON.stringify(state), {
        encoding: "utf8",
        mode: 0o600,
    });
}
async function readCodexViewState(cwd = process.cwd(), explicitPath = process.env.GIT_DIFF_VIEWER_STATE_PATH) {
    if (explicitPath) {
        return readStateFile(explicitPath);
    }
    let entries;
    try {
        entries = await node_fs_1.promises.readdir(STATE_DIRECTORY);
    }
    catch {
        return undefined;
    }
    const states = (await Promise.all(entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => readStateFile(path.join(STATE_DIRECTORY, entry))))).filter((state) => state !== undefined);
    if (states.length === 0) {
        return undefined;
    }
    const matchingWorkspace = states.filter((state) => state.workspaceFolders.some((folder) => isWithin(folder, cwd)));
    return matchingWorkspace.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
}
async function readStateFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== 1 ||
            typeof parsed.updatedAt !== "string" ||
            !Array.isArray(parsed.workspaceFolders) ||
            !Array.isArray(parsed.repositories) ||
            !Array.isArray(parsed.visibleRepositories) ||
            !Array.isArray(parsed.comparisons) ||
            !Array.isArray(parsed.visibleChanges)) {
            return undefined;
        }
        return parsed;
    }
    catch {
        return undefined;
    }
}
function isWithin(parent, child) {
    const normalizedParent = normalizePath(parent);
    const normalizedChild = normalizePath(child);
    const relative = path.relative(normalizedParent, normalizedChild);
    return (relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative)));
}
function normalizePath(target) {
    const resolved = path.resolve(target);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
//# sourceMappingURL=codexState.js.map