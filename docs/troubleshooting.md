# Troubleshooting

Use **Commands → Version** in the native Manager Webview, or `/version` in the standalone CLI TUI, to confirm the active Last Order build, Mission Control protocol and PID, provider configuration, Node version, and project path.

The Manager Webview uses the `project_root` reported by the running Mission Control backend. This keeps every Webview action bound to the same Git repository even when the VS Code workspace folder is a parent directory such as `/workspace` and the repository is `/workspace/rebuildv3/AgentSupport`.

The VSCode extension uses native DOM and does not launch xterm or a separate terminal host. Conversation scrolling and Composer layout are browser-native. If a panel appears stale, run **Commands → Reload window**; interrupted Mission Control work is recovered from SQLite and the existing Git worktrees.

Codex and provider operations are recorded in the Last Order output channel. For an update mismatch, verify that `/health` reports the same build and control protocol as the installed extension.

## Codex paginated threads

Codex app-server threads created by newer clients can use `historyMode: "paginated"`. Older Codex CLI builds cannot resume those threads and return:

```text
-32601 paginated_threads is not supported yet
```

Last Order treats this as a compatibility failure. It records a visible warning, starts a new native Codex thread, and preserves the Last Order event log, manager memory files, workers, checkpoints, and task state. The original native thread is no longer attached to the manager after this fallback.

To keep full native thread context, configure `LO_CODEX_COMMAND` to a compatible Codex executable:

```bash
export LO_CODEX_COMMAND=/absolute/path/to/codex
codex --version
```

Use `codex-cli 0.164.0-alpha.11.1` or a newer compatible build. `/memory status` shows the active native thread; `/memory clear` deliberately starts a fresh thread while preserving Last Order history.

## After updating the extension

Last Order reuses a healthy Mission Control backend. If a detached backend from an older extension is still running, the old backend would otherwise keep handling messages even after the VSIX is upgraded. Current builds include a control protocol version in `/health` and `control.json`; when the version does not match, the extension asks the old backend to shut down and starts the bundled backend.

If an older extension still reports `paginated_threads` after upgrade, stop the previous Last Order service through the extension or terminate its old process, verify `missionControl.keepRunningOnDeactivate` is disabled, install the current VSIX, and reload the VS Code window. Check that the extension directory is the expected version before retrying.

## Linux clipboard in SSH sessions

System clipboard commands need a graphical session:

- Wayland: `WAYLAND_DISPLAY` is set and `wl-clipboard` is installed.
- X11: `DISPLAY` and a valid `XAUTHORITY` are available, with `xclip` installed.

An SSH session without X11 or Wayland cannot use `xclip` or `wl-paste`. Last Order reports this directly instead of surfacing `Can't open display: (null)`. Use the terminal paste shortcut `Ctrl+Shift+V` or `Shift+Insert`; the editor Webview receives the pasted text in its focused Composer.
