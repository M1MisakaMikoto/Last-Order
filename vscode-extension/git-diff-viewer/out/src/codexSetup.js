"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODEX_MCP_SERVER_NAME = void 0;
exports.isCodexMcpConfigured = isCodexMcpConfigured;
exports.configureCodexMcpServer = configureCodexMcpServer;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
exports.CODEX_MCP_SERVER_NAME = "git-diff-viewer";
async function isCodexMcpConfigured() {
    try {
        const output = await runCodex(["mcp", "list"]);
        return output.includes(exports.CODEX_MCP_SERVER_NAME);
    }
    catch {
        return false;
    }
}
async function configureCodexMcpServer(serverScriptPath) {
    await node_fs_1.promises.access(serverScriptPath);
    await runCodex(["mcp", "remove", exports.CODEX_MCP_SERVER_NAME]).catch(() => undefined);
    await runCodex([
        "mcp",
        "add",
        exports.CODEX_MCP_SERVER_NAME,
        "--",
        "node",
        serverScriptPath,
    ]);
}
function runCodex(args) {
    return new Promise((resolve, reject) => {
        const options = {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            windowsHide: true,
        };
        if (process.platform !== "win32") {
            (0, node_child_process_1.execFile)("codex", args, options, (error, stdout, stderr) => {
                if (error) {
                    reject(new Error(stderr.trim() || error.message));
                    return;
                }
                resolve(stdout);
            });
            return;
        }
        const command = ["codex", ...args.map(quoteForCmd)].join(" ");
        (0, node_child_process_1.execFile)(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", command], options, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }
            resolve(stdout);
        });
    });
}
function quoteForCmd(value) {
    if (!/[\s"&|<>^()]/.test(value)) {
        return value;
    }
    return `"${value.replace(/"/g, '""')}"`;
}
//# sourceMappingURL=codexSetup.js.map