// Compare native DOM to the original TUI using identical data, then exercise real keyboard events.
// Browser evidence is distinct from VS Code Remote/provider acceptance.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerminalUI } from '../src/ui.js';
import { conversationGroups, eventContent } from '../src/conversation.js';
import { messageLabel, conversationPresentation } from '../src/conversation-view.js';
import { renderMarkdown, stripFormatting } from '../src/markdown.js';
import { withWebviewBrowser } from './webview-browser.mjs';
import './render-webview-preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function oracle(data) {
  const service = {
    state: data.snapshot, config: data.config, projects: data.projects.length ? data.projects : [{ root: data.projectRoot, active: true, code: '' }],
    git: { root: data.projectRoot }, snapshot: () => data.snapshot, store: { history: actor => data.histories.find(([id]) => id === actor)?.[1] || [] }
  };
  const ui = new TerminalUI(service);
  Object.assign(ui, data.ui);
  ui.expandedActors = new Set(data.ui.expandedActors); ui.expandedGroups = new Set(data.ui.expandedGroups); ui.collapsedGroups = new Set(data.ui.collapsedGroups);
  ui.scrollViews = new Map(data.ui.scrollViews);
  ui.render = () => {};
  return ui;
}
await withWebviewBrowser(root, async ({ out, open, evaluate, waitFor, click, type, keypress, screenshot, page }) => {
  const results = [];
  const audit = async name => {
    const data = await evaluate(`({
      snapshot: state.snapshot, config: state.config, projects: state.projects, projectRoot: state.projectRoot, histories: [...state.histories],
      ui: { screen: ui.screen, panel: ui.panel, workerPanel: ui.workerPanel, selected: ui.selected, workerFocus: ui.workerFocus,
        showArchivedOnce: ui.showArchivedOnce, projectScroll: ui.projectScroll, settings: ui.settings, settingsDraft: ui.settingsDraft,
        settingsIndex: ui.settingsIndex, settingsEditing: ui.settingsEditing, preview: ui.preview, notice: ui.notice,
        requestId: ui.requestId, filePath: ui.filePath, diffMode: ui.diffMode,
        inputValue: ui.input, cursor: ui.cursor, history: ui.history, historyIndex: ui.historyIndex, historyDraft: ui.historyDraft,
        expandedActors: [...ui.expandedActors], expandedGroups: [...ui.expandedGroups], collapsedGroups: [...ui.collapsedGroups], scrollViews: [...ui.scrollViews] },
      dimensions: state.dimensions, workerColumns: workerColumns(),
      header: document.querySelector('#tui-header').textContent,
      requests: [...document.querySelectorAll('.pending-request')].map(element => element.textContent),
      queue: document.querySelector('#pending-queue').textContent,
      notice: document.querySelector('#notice').textContent,
      bounds: (() => { const r = document.querySelector('.input-row').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; })(),
      width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      visibleButtons: [...document.querySelectorAll('button:not([data-remove-attachment]), nav, select')].filter(element => element.getClientRects().length).length,
      error: document.body.dataset.error
    })`);
    const reference = oracle(data), { columns, rows } = data.dimensions;
    assert.equal(data.error, undefined, name + ': browser errors');
    assert.equal(data.header, reference.headerLines(data.snapshot, columns, rows).slice(0, -1).map(line => line.trimEnd()).join('\n'), name + ': exact TUI header content');
    assert.equal(data.visibleButtons, 0, name + ': no added navigation/control buttons');
    assert.deepEqual(data.requests, reference.pendingRequestLines().slice(0, Math.min(5, Math.max(1, rows - 12))), name + ': pending approval/question lines');
    assert.equal(data.queue, reference.queuedMessageLines(data.snapshot, columns, Math.max(1, Math.min(5, Math.floor(rows / 6)))).map(line => line.trimEnd()).join('\n'), name + ': TUI queue');
    assert.ok(data.documentWidth <= data.width && data.bounds.left >= 0 && data.bounds.right <= data.width && data.bounds.bottom <= data.height, name + ': native bounds');
    if (['manager', 'chat'].includes(data.ui.panel)) {
      const actor = data.ui.panel === 'manager' ? 'manager' : reference.worker?.id;
      if (actor) {
        const elements = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(data.ui.panel === 'manager' ? '#manager-messages .message' : '#worker-messages .message')})).map(element => ({ label: element.querySelector('.message-label').textContent, body: element.querySelector('.message-body').textContent }))`);
        const contentColumns = data.ui.panel === 'manager' ? columns : data.workerColumns;
        const messages = conversationGroups(reference.visibleConversationEvents(actor)).filter(group => group.kind === 'message');
        assert.deepEqual(elements, messages.map(({ event }) => ({ label: messageLabel(event, actor), body: stripFormatting(renderMarkdown(eventContent(event), Math.max(8, contentColumns - 6)).join('\n')) })), name + ': all message roles/sequences/times/content');
        const backgrounds = await evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(data.ui.panel === 'manager' ? '#manager-messages .background-group' : '#worker-messages .background-group')})).map(element => ({ title: element.querySelector('summary').textContent, open: element.open, collapsed: element.querySelector('.background-collapsed').textContent, expanded: element.querySelector('.background-content').textContent }))`);
        assert.deepEqual(backgrounds, conversationPresentation(reference.visibleConversationEvents(actor), actor, reference).filter(group => group.kind === 'background').map(group => ({ title: group.title, open: group.expanded, collapsed: group.collapsedContent, expanded: stripFormatting(renderMarkdown(group.expandedContent, Math.max(8, contentColumns - 6)).join('\n')) })), name + ': all folded/expanded tool content and labels');
      }
    }
    if (data.ui.screen === 'workers' && ['chat', 'files', 'git'].includes(data.ui.panel)) {
      const detail = reference.workerDetailPresentation();
      assert.equal(await evaluate(`document.querySelector('#worker-detail-heading').textContent`), [detail.title, detail.views, ...detail.metadata].join('\n'), name + ': worker detail/notes');
      assert.equal(await evaluate(`document.querySelector('#worker-list-title').textContent`), reference.workerListPresentation().title, name + ': worker list and focus indicator');
      if (data.ui.panel !== 'chat') assert.equal(await evaluate(`document.querySelector('#worker-preview').textContent`), reference.worker ? reference.preview || '输入 /refresh 加载当前视图。' : '尚无 worker，Ctrl+Tab 返回 Manager 发送需求。');
    }
    if (['help', 'request'].includes(data.ui.panel)) assert.equal(await evaluate(`document.querySelector('#auxiliary-preview').textContent`), reference.preview, name + ': inline auxiliary page');
    if (data.ui.panel === 'settings') {
      const fields = reference.settingsFieldDefs();
      assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.settings-field')).map(element => ({ label: element.children[1].textContent, value: element.children[2].textContent }))`), fields.map(field => ({ label: field.label, value: String(field.type === 'text' ? field.value || '（空）' : field.value) })), name + ': exact setting labels/order/values');
    }
    const frame = reference.frame(columns, rows);
    assert.equal(data.notice, frame[frame.length - reference.lastInputPresentation.lines.length - 2].trimEnd(), name + ': exact footer notice/scroll counts');
    await writeFile(path.join(out, name + '-tui.txt'), frame.map(stripFormatting).join('\n'));
    await screenshot(name);
    results.push({ name, width: data.width, columns, rows, panel: data.ui.panel, headerMatches: true, contentMatches: true });
    return data;
  };
  const cases = [
    { name: 'manager', width: 1200 }, { name: 'single-project-idle', scenario: 'idle', width: 320 },
    ...[680, 504, 320].map(width => ({ name: 'manager-' + width, width })),
    ...['empty', 'connecting', 'fatal', 'busy', 'interrupted', 'error', 'long', 'approvals', 'questions'].map(scenario => ({ name: scenario, scenario, width: 320 })),
    { name: 'light', theme: 'light', width: 504 }, { name: 'contrast', theme: 'high-contrast', width: 320 }, { name: 'large-font', font: 18, width: 320 },
    ...['worker', 'files', 'git', 'settings', 'commands', 'turns', 'checkpoints', 'skills', 'version', 'quote'].map(hash => ({ name: hash, hash, width: 320 }))
    , ...[
      ['no-hints', ''], ['projects', ''], ['epoch', ''], ['worker-empty', 'worker'], ['worker-mixed', 'worker'],
      ['no-workspace', 'files'], ['archived', 'workers'], ['files-empty', 'files'], ['files-error', 'files'],
      ['git-empty', 'git'], ['git-large', 'git'], ['git-error', 'git'], ['skills-error', 'skills'], ['turns-error', 'turns'], ['long-prompt', 'settings']
    ].map(([scenario, hash]) => ({ name: scenario, scenario, hash, width: 504 }))
  ];
  for (const item of cases) { await open(item); await audit(item.name); }

  async function submit(text) {
    await evaluate(`new Promise(resolve => setTimeout(resolve, ui.lastSubmittedText === ${JSON.stringify(text)} ? Math.max(0, 260 - (Date.now() - ui.lastSubmittedAt)) : 0))`);
    await click('#composer-input'); await type(text); await keypress('Enter');
    await waitFor('!ui.submitPending && state.pending.size === 0');
  }
  await open({ width: 504 });
  const messageBorders = await evaluate(`(() => {
    const user = document.querySelector('#manager-messages .message.user');
    const assistant = document.querySelector('#manager-messages .message.assistant');
    return {
      user: getComputedStyle(user).borderTopColor,
      assistant: getComputedStyle(assistant).borderTopColor
    };
  })()`);
  assert.notEqual(messageBorders.user, messageBorders.assistant);
  assert.match(messageBorders.user, /230, 162, 60/);
  await click('#composer-input'); await type('/pa');
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const suggestionStyle = await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    const ghost = document.querySelector('#input-ghost .ghost');
    const note = document.querySelector('#input-ghost .completion-note');
    const ghostStyle = getComputedStyle(ghost);
    return {
      ghost: ghost.textContent,
      note: note?.textContent || '',
      inputColor: getComputedStyle(input).color,
      ghostColor: ghostStyle.color,
      ghostBackground: ghostStyle.backgroundColor,
      ghostDecoration: ghostStyle.textDecorationStyle
    };
  })()`);
  assert.equal(suggestionStyle.ghost, 'use');
  assert.match(suggestionStyle.note, /Tab 填入/);
  assert.notEqual(suggestionStyle.ghostColor, suggestionStyle.inputColor);
  assert.notEqual(suggestionStyle.ghostBackground, 'rgba(0, 0, 0, 0)');
  assert.equal(suggestionStyle.ghostDecoration, 'dotted');
  await screenshot('input-suggestion');
  await keypress('Tab');
  assert.equal(await evaluate('ui.input'), '/pause');
  assert.equal(await evaluate(`window.__previewMessages.some(message => message.action === 'controlWorker')`), false);
  await screenshot('command-completion');
  await keypress('u', 2); assert.equal(await evaluate('ui.input'), '');
  await type('First line'); await keypress('Enter', 8); assert.equal(await evaluate('ui.input'), 'First line\n');
  await submit('Keyboard request');
  await keypress('p', 2); assert.equal(await evaluate('ui.input'), 'Keyboard request');
  await keypress('n', 2); assert.equal(await evaluate('ui.input'), '');
  await type('Shared draft'); await keypress('Tab', 2);
  assert.equal(await evaluate('ui.screen'), 'workers'); assert.equal(await evaluate('ui.input'), 'Shared draft');
  await keypress('u', 2); await keypress('ArrowDown'); assert.equal(await evaluate('ui.worker.id'), 'worker_b2');
  await keypress('F6'); assert.equal(await evaluate('ui.workerFocus'), 'detail');
  await keypress('ArrowRight'); assert.equal(await evaluate('ui.panel'), 'files');
  await keypress('F4'); assert.equal(await evaluate('ui.panel'), 'git');
  await keypress('Escape'); assert.equal(await evaluate('ui.panel'), 'manager');
  await submit('/workers');
  await submit('Message to Manager while viewing Worker');
  assert.equal(await evaluate(`window.__previewMessages.filter(message => ['sendManager','sendWorker'].includes(message.action)).at(-1).action`), 'sendManager');
  await submit('/msg worker_b2 Review keyboard behavior');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendWorker').workerId`), 'worker_b2');
  await submit('/pause'); assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'controlWorker').workerAction`), 'pause');
  await submit('/interrupt urgent task');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').interrupt`), true);
  await audit('keyboard-worker');

  await keypress('F2'); await keypress('F5');
  assert.equal(await evaluate(`document.querySelector('.background-group').open`), true);
  await audit('worker-expanded');
  await evaluate(`window.retainedGroup = document.querySelector('.background-group'); state.histories.get(ui.worker.id).push({ seq: 99, type: 'message', data: { role: 'assistant', text: 'New reply' } }); renderNative()`);
  assert.equal(await evaluate(`document.querySelector('.background-group') === window.retainedGroup && window.retainedGroup.open`), true);
  await submit('/collapse all'); assert.equal(await evaluate(`document.querySelector('.background-group').open`), false);
  await submit('/quote worker_a1:#12 请继续'); assert.equal(await evaluate('ui.panel'), 'manager');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').quotes[0].seq`), 12);

  await open({ scenario: 'approvals', width: 320 });
  await submit('/approval approval_long'); await audit('approval-detail');
  assert.ok(await evaluate(`document.querySelector('#auxiliary-preview').textContent.includes('node scripts/verify-layout')`));
  await keypress('Escape'); await submit('/approve approval_demo');
  await waitFor(`!state.snapshot.approvals.some(item => item.id === 'approval_demo')`);
  await submit('/deny approval_long'); await waitFor('state.snapshot.approvals.length === 0');
  assert.equal(await evaluate('requestQueue.size'), 0);
  await open({ scenario: 'questions', width: 320 });
  await submit('/question question_2'); await audit('question-detail');
  await keypress('Escape'); await submit('/answer question_1 Use a single column');
  await waitFor(`!state.snapshot.questions.some(item => item.id === 'question_1')`);
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'question').answer`), 'Use a single column');

  await open({ width: 504 }); await submit('/settings');
  await keypress('ArrowDown'); await keypress('Enter');
  await waitFor(`document.activeElement.id === 'settings-editor'`);
  await type('Updated model', '#settings-editor'); await keypress('Enter');
  await keypress('s', 2); await waitFor(`ui.panel === 'manager'`);
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'saveConfig').config.managerModel`), 'Updated model');
  await submit('/settings');
  await evaluate(`ui.settingsDraft.maxWorkers = 0; renderNative()`); await keypress('s', 2);
  assert.equal(await evaluate('ui.panel'), 'settings');
  assert.ok(await evaluate(`ui.notice.includes('maxWorkers')`));
  await keypress('Escape');
  await submit('/help'); await audit('help-original-content');
  await keypress('Escape');
  await submit('/checkpoint Before changes'); await submit('/checkpoints');
  assert.ok(await evaluate(`ui.notice.includes('checkpoint-demo')`));
  await submit('/restore checkpoint-demo all');
  assert.equal(await evaluate(`window.__previewMessages.some(message => message.action === 'restoreCheckpointById')`), false);
  await submit('/restore checkpoint-demo all confirm');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'restoreCheckpointById').mode`), 'all');
  await submit('/turns'); await submit('/fork turn-1'); await submit('/revert turn-2 --yes');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'revertConversation').beforeTurnId`), 'turn-2');
  await submit('/skills'); await audit('skills-content-with-paths'); await keypress('Escape');

  await open({ scenario: 'projects', width: 504 });
  const firstWindow = await evaluate(`document.querySelector('#tui-header').textContent`);
  await keypress('ArrowDown', 1);
  assert.equal(await evaluate('ui.projectScroll'), 1);
  assert.notEqual(await evaluate(`document.querySelector('#tui-header').textContent`), firstWindow);
  await audit('project-window-scrolled');
  await submit('-B Routed project message');
  assert.equal(await evaluate('state.projects.find(project => project.active).code'), 'B');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').text`), 'Routed project message');
  assert.equal(await evaluate(`state.histories.get('manager').length`), 0);
  assert.equal(await evaluate('ui.screen'), 'manager');
  await audit('project-switched');

  await open({ width: 504, hash: 'files' });
  await submit('/open src/app.js');
  assert.ok(await evaluate(`document.querySelector('#worker-preview').textContent.includes('export const sum')`));
  await audit('file-content');
  await keypress('Escape');
  assert.equal(await evaluate(`Boolean(document.querySelector('#attach-image'))`), false);
  const pasted = await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    const data = new DataTransfer();
    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    data.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  })()`);
  assert.equal(pasted, true, 'pasting an image is handled by the composer');
  await waitFor('state.attachments.length === 1');
  assert.equal(await evaluate('state.attachments[0].name'), 'clipboard.png');
  await screenshot('attachment-paste');
  await click('[data-remove-attachment]'); await waitFor('state.attachments.length === 0');
  await evaluate(`(() => {
    const input = document.querySelector('#composer-input');
    const data = new DataTransfer();
    const binary = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    data.items.add(new File([bytes], 'clipboard-copy.png'));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    input.dispatchEvent(event);
  })()`);
  await waitFor('state.attachments.length === 1');
  assert.equal(await evaluate('state.attachments[0].mime'), 'image/png');
  await submit('Message with image');
  assert.match(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').attachments[0].path`), /^\/tmp\/pasted-0-clipboard-copy\.png$/);
  await waitFor('state.attachments.length === 0');

  await type('Slow first request');
  await evaluate(`void enqueueKey('', { name: 'return' });`);
  await type('Next draft while sending');
  await keypress('Enter');
  await waitFor('!ui.submitPending');
  assert.equal(await evaluate('ui.input'), 'Next draft while sending');
  assert.equal(await evaluate(`window.__previewMessages.filter(message => message.action === 'sendManager' && message.text === 'Slow first request').length`), 1);
  await keypress('Enter'); await waitFor('!ui.submitPending');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').text`), 'Next draft while sending');

  await open({ scenario: 'send-failure', width: 504 });
  await submit('Failed message');
  assert.equal(await evaluate('ui.input'), '');
  assert.ok(await evaluate(`ui.notice.includes('Request failed')`));

  await open({ width: 504, hash: 'worker' });
  const linkedTool = { seq: 200, type: 'message', data: { role: 'tool', tool: { name: 'inspect', status: 'failed', id: 'call-12345678', arguments: { path: 'src/app.js' }, result: 'See {{file:src/app.js#L2-L3}}\n\n```js\nconst value = "复制中文";\n```', error: 'Check the complete output', exitCode: 1, durationMs: 123 } } };
  await evaluate(`state.histories.get(ui.worker.id).push(${JSON.stringify(linkedTool)});renderNative()`);
  await keypress('F5');
  await audit('worker-rich-tool');
  const copySelector = '#worker-messages .background-content a[data-external^="lastorder-copy:"]';
  const fileSelector = '#worker-messages .background-content a[data-external="src/app.js#L2-L3"]';
  await click(fileSelector);
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.type === 'openExternal').url`), 'src/app.js#L2-L3');
  const copyURL = await evaluate(`document.querySelector(${JSON.stringify(copySelector)}).dataset.external`);
  assert.equal(Buffer.from(copyURL.slice('lastorder-copy:'.length), 'base64url').toString(), '  const value = "复制中文";');
  await click(copySelector);
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.type === 'openExternal').url`), copyURL);
  await evaluate(`(() => { const range = document.createRange();range.selectNodeContents(document.querySelector('#worker-messages .message-body'));getSelection().removeAllRanges();getSelection().addRange(range); })()`);
  await keypress('q', 2);
  assert.ok(await evaluate(`ui.input.startsWith('> ') && ui.input.slice(-2) === String.fromCharCode(10, 10)`));
  await keypress('u', 2);

  await open({ scenario: 'worker-mixed', width: 320, hash: 'worker' });
  for (let index = 0; index < 6; index++) await keypress('ArrowDown');
  assert.equal(await evaluate('ui.selected'), 6);
  const workerBounds = await evaluate(`(() => { const list=document.querySelector('#worker-list');const a=list.getBoundingClientRect();const b=list.querySelector('[aria-selected="true"]').getBoundingClientRect();return { top: a.top, bottom: a.bottom, selectedTop: b.top, selectedBottom: b.bottom, scrollTop: list.scrollTop }; })()`);
  assert.ok(workerBounds.selectedTop >= workerBounds.top && workerBounds.selectedBottom <= workerBounds.bottom, JSON.stringify(workerBounds));
  await audit('worker-selection-visible');

  for (const width of [1200, 320, 504]) {
    await page('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await audit('worker-resized-' + width);
  }

  await open({ width: 504, hash: 'worker' });
  const longReply = { seq: 201, type: 'message', data: { role: 'assistant', text: Array.from({ length: 120 }, (_, index) => 'Long reply line ' + index).join('\n') } };
  await evaluate(`state.histories.get(ui.worker.id).push(${JSON.stringify(longReply)});renderNative()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate(`(() => { const list=document.querySelector('#worker-messages');const message=list.querySelector('.message:last-child');list.scrollTop+=message.getBoundingClientRect().top-list.getBoundingClientRect().top+120; })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.ok(await evaluate(`(() => { const element=document.querySelector('#worker-messages');const list=element.getBoundingClientRect();const label=document.querySelector('#worker-messages .message:last-child .message-label').getBoundingClientRect();const inset=parseFloat(getComputedStyle(element).paddingTop);return label.top >= list.top && label.top <= list.top + inset + 1 && label.bottom > list.top; })()`), 'sender stays visible inside a long reply');
  await audit('worker-long-message');

  await open({ width: 504 });
  await click('#composer-input'); await keypress('Tab');
  assert.equal(await evaluate('document.activeElement.id'), 'composer-input');
  await type('Shift Enter inserts a newline'); await keypress('Enter', 8);
  assert.equal(await evaluate('ui.input'), 'Shift Enter inserts a newline\n');
  assert.equal(await evaluate(`window.__previewMessages.filter(message => message.action === 'sendManager' && message.text === 'Shift Enter inserts a newline').length`), 0);
  await keypress('Enter');
  await waitFor('!ui.submitPending');
  assert.equal(await evaluate(`window.__previewMessages.findLast(message => message.action === 'sendManager').text`), 'Shift Enter inserts a newline');

  await open({ width: 504 });
  await evaluate(`(() => {
    const event = { seq: null, time: new Date().toISOString(), actor: 'manager', type: 'message', data: { role: 'assistant', text: 'stream-start', streaming: true, memoryEpoch: 0 } };
    window.__streamEvent = event; state.histories.get('manager').push(event); renderNative();
  })()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const initialStream = await evaluate(`(() => { const message = document.querySelector('#manager-messages .message:last-child'); return { count: document.querySelectorAll('#manager-messages .message').length, label: message.querySelector('.message-label').textContent, body: message.querySelector('.message-body').textContent }; })()`);
  assert.match(initialStream.label, /生成中/);
  assert.match(initialStream.body, /stream-start/);
  await evaluate(`window.__streamEvent.data.text = 'stream-complete'; renderNative()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const updatedStream = await evaluate(`(() => { const message = document.querySelector('#manager-messages .message:last-child'); return { count: document.querySelectorAll('#manager-messages .message').length, body: message.querySelector('.message-body').textContent }; })()`);
  assert.equal(updatedStream.count, initialStream.count);
  assert.match(updatedStream.body, /stream-complete/);
  assert.doesNotMatch(updatedStream.body, /stream-start/);
  await screenshot('streaming-message');
  await evaluate(`state.histories.get('manager').pop(); renderNative()`);
  await evaluate(`state.histories.get('manager').push({
    seq: 202, time: new Date().toISOString(), actor: 'manager', type: 'message',
    data: { role: 'assistant', text: 'intermediate-agent-message', background: true, memoryEpoch: 0 }
  }, {
    seq: 203, time: new Date().toISOString(), actor: 'manager', type: 'message',
    data: { role: 'assistant', text: 'final-after-intermediate', memoryEpoch: 0 }
  }); renderNative()`);
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const foldedIntermediate = await evaluate(`(() => {
    const message = [...document.querySelectorAll('#manager-messages .combined-message')].at(-1);
    const intermediate = message?.querySelector('.message-intermediate');
    return message ? {
      open: intermediate.open,
      title: intermediate.querySelector('summary').textContent,
      content: intermediate.querySelector('.background-content').textContent,
      label: message.querySelector('.message-final-label').textContent,
      final: message.querySelector('.message-final-body').textContent,
      order: [...message.children].map(child => child.className),
      messageCount: document.querySelectorAll('#manager-messages .message').length
    } : null;
  })()`);
  assert.ok(foldedIntermediate);
  assert.equal(foldedIntermediate.open, false);
  assert.match(foldedIntermediate.title, /中间回复/);
  assert.match(foldedIntermediate.content, /intermediate-agent-message/);
  assert.match(foldedIntermediate.label, /Manager · #203/);
  assert.match(foldedIntermediate.final, /final-after-intermediate/);
  assert.deepEqual(foldedIntermediate.order.slice(0, 3), [
    'message-intermediate', 'message-label message-final-label', 'message-body message-final-body'
  ]);
  await screenshot('manager-intermediate-fold');
  await evaluate(`state.histories.get('manager').splice(-2); renderNative()`);

  await open({ scenario: 'long', width: 504 });
  await click('#composer-input'); await keypress('ArrowUp', 8);
  assert.equal(await evaluate(`document.querySelector('#manager-messages').scrollTop`), 0);
  await keypress('PageDown'); assert.ok(await evaluate(`document.querySelector('#manager-messages').scrollTop > 0`));
  const performance = await evaluate(`(() => {
    const container = document.querySelector('#manager-messages');
    const first = container.querySelector('.message');
    const range = document.createRange(); range.selectNodeContents(first.querySelector('.message-body'));
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range);
    const selection = window.getSelection().toString(); const started = performance.now();
    for (let index = 0; index < 20; index++) { state.histories.get('manager').push({ seq: 1000 + index, type: 'message', data: { role: 'assistant', text: 'Incremental reply ' + index } }); renderNative(); }
    return { updates: 20, history: state.histories.get('manager').length, milliseconds: Math.round(performance.now() - started), retained: container.querySelector('.message') === first, selectionRetained: window.getSelection().toString() === selection };
  })()`);
  assert.equal(performance.retained, true); assert.equal(performance.selectionRetained, true);
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ evidence: 'Native DOM vs original TUI using identical snapshots; provider and VS Code host acceptance separate', cases: results, keyboardAndCommands: 'completion, shared input, history, F1–F6, Ctrl+Tab, scroll, routing, interrupt, quote, request detail, approve/deny/answer, settings, help, checkpoints, restore, turns/fork/revert, skills, project window/switch/routing, file content, attachments, typing during send, duplicate submit, send failure', performance }, null, 2));
  console.log(`Passed ${results.length} TUI/DOM content comparisons and keyboard/command checks. Evidence: ${out}`);
});
