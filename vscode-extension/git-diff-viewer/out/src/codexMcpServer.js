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
const readline = __importStar(require("node:readline"));
const codexState_1 = require("./codexState");
const TOOLS = [
    {
        name: "get_view_context",
        description: "Read the Git Diff Viewer view currently open in VS Code. Returns the selected repository, comparison range, visible changes, selected file, and active file metadata. Use this before answering questions about what the user is viewing.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
    {
        name: "get_active_diff",
        description: "Return the left and right text currently shown in the native VS Code diff opened from Git Diff Viewer. Returns an error when no diff is active or the extension is not running.",
        inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
        },
    },
];
const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
});
input.on("line", (line) => {
    if (!line.trim()) {
        return;
    }
    void handleLine(line);
});
async function handleLine(line) {
    let request;
    try {
        request = JSON.parse(line);
    }
    catch {
        writeMessage({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
        });
        return;
    }
    if (request.id === undefined) {
        return;
    }
    try {
        const result = await handleRequest(request);
        writeMessage({
            jsonrpc: "2.0",
            id: request.id,
            result,
        });
    }
    catch (error) {
        writeMessage({
            jsonrpc: "2.0",
            id: request.id,
            error: {
                code: -32603,
                message: error instanceof Error ? error.message : String(error),
            },
        });
    }
}
async function handleRequest(request) {
    switch (request.method) {
        case "initialize":
            return {
                protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: {
                    name: "git-diff-viewer",
                    version: "0.1.0",
                },
                instructions: "Provides read-only context from the Git Diff Viewer VS Code extension. Call get_view_context before answering questions about the user's current view.",
            };
        case "ping":
            return {};
        case "resources/list":
            return { resources: [] };
        case "prompts/list":
            return { prompts: [] };
        case "tools/list":
            return { tools: TOOLS };
        case "tools/call":
            return callTool(request.params?.name);
        default:
            throw new Error(`Unsupported method: ${request.method}`);
    }
}
async function callTool(name) {
    const state = await (0, codexState_1.readCodexViewState)();
    if (!state) {
        return toolError("No Git Diff Viewer state is available. Open the Git Diff Viewer view in VS Code, then try again.");
    }
    if (name === "get_view_context") {
        const { activeDiff, ...context } = state;
        return toolText({
            ...context,
            activeDiff: activeDiff
                ? {
                    repositoryRoot: activeDiff.repositoryRoot,
                    filePath: activeDiff.filePath,
                    oldPath: activeDiff.oldPath,
                    status: activeDiff.status,
                    baseLabel: activeDiff.baseLabel,
                    targetLabel: activeDiff.targetLabel,
                    leftLength: activeDiff.left.length,
                    rightLength: activeDiff.right.length,
                    error: activeDiff.error,
                    truncated: activeDiff.truncated,
                }
                : undefined,
        });
    }
    if (name === "get_active_diff") {
        if (!state.activeDiff) {
            return toolError("No diff is active in Git Diff Viewer. Open a changed file in the extension, then try again.");
        }
        if (state.activeDiff.error) {
            return toolError(state.activeDiff.error);
        }
        return toolText(state.activeDiff);
    }
    return toolError(`Unknown tool: ${name ?? "(missing name)"}`);
}
function toolText(value) {
    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(value, null, 2),
            },
        ],
    };
}
function toolError(message) {
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}
function writeMessage(message) {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}
//# sourceMappingURL=codexMcpServer.js.map