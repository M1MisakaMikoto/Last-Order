// Share the CLI's controller and presentation rules with native DOM rendering.
// Terminal transport methods are omitted; no terminal emulator or frame painting is used.
function buildUiRuntime(readSource, version) {
  const stripModule = source => source.replace(/^import .+;\r?\n/gm, '')
    .replace(/^export \{[^\n]+\};?\r?\n/gm, '').replace(/^export /gm, '');
  const module = (file, exports, transform = value => value) =>
    `const ${exports.join('_')}_module = (() => {\n${transform(stripModule(readSource(file)))}\nreturn { ${exports.join(', ')} };\n})();\nconst { ${exports.join(', ')} } = ${exports.join('_')}_module;\n`;
  const controller = source => {
    const start = source.indexOf('  async start() {');
    const schedule = source.indexOf('  scheduleRender(');
    const render = source.lastIndexOf('  render() {');
    if (start < 0 || schedule < start || render < schedule) throw new Error('TUI controller boundaries changed; review the native runtime adapter.');
    return source.slice(0, start) + source.slice(schedule, render) + '  render() {}\n}\n';
  };
  return `(() => {
  'use strict';
  const process = { platform: '', arch: '', version: '', env: {} };
  const path = { dirname(value) {
    const normalized = String(value).replaceAll('\\\\', '/').replace(/\\/+$/, '');
    const index = normalized.lastIndexOf('/');
    return index < 0 ? '.' : index === 0 ? '/' : normalized.slice(0, index);
  } };
  const Buffer = {
    byteLength: value => new TextEncoder().encode(value).length,
    from: value => ({ toString: () => {
      const bytes = new TextEncoder().encode(value);
      return btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join('')).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
    } })
  };
  const copyText = async () => { throw new Error('Use the native clipboard adapter'); };
  const readClipboard = copyText;
  const APP_VERSION = ${JSON.stringify(version)};
  const PROVIDERS = ${JSON.stringify(/export const PROVIDERS = (\[[^;]+\]);/.exec(readSource('src/core/tools.js'))?.[1] ? JSON.parse(/export const PROVIDERS = (\[[^;]+\]);/.exec(readSource('src/core/tools.js'))[1].replaceAll("'", '"')) : [])};
  ${module('src/core/identity.js', ['PRODUCT_NAME', 'CONTROL_PROTOCOL_VERSION'])}
  ${module('src/core/config.js', ['DEFAULT_CONFIG', 'validateConfig'], source => source.slice(0, source.indexOf('async function loadConfig(')))}
  ${module('src/commands.js', ['COMMANDS', 'commandUsage', 'commandCompletions', 'fileQuery'])}
  ${module('src/markdown.js', ['renderMarkdown', 'styledWidth', 'stripFormatting'])}
  const stripVTControlCharacters = stripFormatting;
  ${module('src/conversation.js', ['conversationGroups', 'eventContent', 'toolName'])}
  ${module('src/conversation-view.js', ['clean', 'fit', 'fitStyled', 'wrap', 'width', 'border', 'messageLabel', 'conversationPresentation', 'renderConversation'])}
  ${module('src/ui.js', ['TerminalUI'], controller)}
  globalThis.LastOrderUI = { TerminalUI, DEFAULT_CONFIG, COMMANDS, commandUsage, commandCompletions,
    conversationGroups, conversationPresentation, eventContent, messageLabel, renderMarkdown, stripFormatting, clean, fit, wrap, width,
    setRuntime(info) { process.platform = info.platform; process.arch = info.arch; process.version = info.node; process.env.LO_CODEX_COMMAND = info.codex_command || ''; }
  };
})();\n`;
}

module.exports = { buildUiRuntime };
