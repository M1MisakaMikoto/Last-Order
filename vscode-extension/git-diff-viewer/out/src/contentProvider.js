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
exports.GitContentProvider = exports.GIT_DIFF_SCHEME = void 0;
exports.createVirtualContentUri = createVirtualContentUri;
const vscode = __importStar(require("vscode"));
exports.GIT_DIFF_SCHEME = "git-diff-viewer";
function createVirtualContentUri(query) {
    const encodedQuery = Buffer.from(JSON.stringify(query), "utf8").toString("base64url");
    return vscode.Uri.from({
        scheme: exports.GIT_DIFF_SCHEME,
        authority: "content",
        path: `/${query.filePath}`,
        query: encodedQuery,
    });
}
class GitContentProvider {
    git;
    cache = new Map();
    constructor(git) {
        this.git = git;
    }
    async provideTextDocumentContent(uri) {
        const query = parseQuery(uri);
        if (!query) {
            return "无法解析该版本文件地址。";
        }
        if (query.source === "empty") {
            return "";
        }
        const cacheKey = uri.toString();
        const cached = this.cache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }
        try {
            const content = query.source === "index"
                ? await this.git.getIndexContent(query.repoRoot, query.filePath)
                : await this.git.getRefContent(query.repoRoot, query.ref ?? "HEAD", query.filePath);
            this.cache.set(cacheKey, content);
            return content;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `无法读取 ${query.ref ?? "暂存区"}:${query.filePath}\n\n${message}`;
        }
    }
    clearCache() {
        this.cache.clear();
    }
    dispose() {
        this.clearCache();
    }
}
exports.GitContentProvider = GitContentProvider;
function parseQuery(uri) {
    try {
        const raw = Buffer.from(uri.query, "base64url").toString("utf8");
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=contentProvider.js.map