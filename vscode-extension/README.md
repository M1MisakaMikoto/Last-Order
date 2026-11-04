# Last Order VSCode Extension

Development extension for Last Order, backed by Last Order backend.

## Run

1. Open the repository in VSCode.
2. Open `vscode-extension/` in the Extension Development Host or press F5 from that folder.
3. Open the target project folder as the workspace.
By default the extension starts Last Order backend and opens the TUI in an editor terminal beside the active editor. Disable this with `missionControl.autoStart` and `missionControl.autoOpenTui`.

The extension starts `bin/mission-control.js` as an independent Node process. If a Last Order backend instance is already running and has published `.git/last-order/control.json`, including one started by the TUI, the extension attaches to it instead.

The extension is the single product entry and manages Last Order backend lifecycle:

- worker tree and status;
- full Last Order backend TUI in an xterm WebviewView in the right secondary sidebar;
- worker monitor terminals opened as editor tabs;
- sending messages and worker controls;
- sending active file/selection context;
- native VSCode diff against the worker base commit;
- editing manager-only worker notes;
- taking over a running worker by pausing it and opening its worktree;
- handing the worker back with a durable manager note and resume request;
- opening worker worktree or monitor terminal;
- approval and question handling;
- Last Order backend start/stop/refresh.

The Manager WebviewView does not reimplement Last Order backend UI. It runs `bin/tui-webview-host.js` with the existing TerminalUI in virtual-terminal mode, then streams ANSI output to xterm.js and forwards keyboard input back to the TUI.
