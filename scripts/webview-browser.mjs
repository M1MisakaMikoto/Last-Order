import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function withWebviewBrowser(root, callback) {
  const out = path.join(root, '.tmp', 'webview-review');
  await mkdir(out, { recursive: true });
  const browser = process.env.WEBVIEW_BROWSER || (process.platform === 'win32'
    ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : 'chromium');
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${path.join(out, 'profile-' + Date.now())}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 15000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('Browser exited: ' + code)); });
      child.stderr.on('data', data => {
        const match = data.toString().match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(endpoint);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data), request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    });
    const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Timed out: ' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => command(method, params, sessionId);
    await page('Page.enable'); await page('Runtime.enable');
    const evaluate = async expression => {
      const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async expression => {
      for (let index = 0; index < 100; index++) {
        if (await evaluate(expression)) return;
        const error = await evaluate('document.body?.dataset.error');
        if (error) throw new Error(error);
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('Condition not met: ' + expression);
    };
    let navigation = 0;
    const open = async ({ width = 1200, height = 900, scenario = 'default', theme = 'dark', hash = '', font = 13 } = {}) => {
      await page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const url = pathToFileURL(path.join(root, '.tmp/webview-preview.html'));
      url.search = new URLSearchParams({ scenario, theme, font, navigation: ++navigation }); url.hash = hash;
      await page('Page.navigate', { url: url.href });
      await waitFor(`document.readyState === 'complete' && document.body.dataset.previewReady === 'true'`);
      await new Promise(resolve => setTimeout(resolve, 100));
    };
    const click = async selector => {
      const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error('Missing element: ' + ${JSON.stringify(selector)}); element.scrollIntoView({ block: 'nearest' }); const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const type = (value, selector = '#composer-input') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.value = ${JSON.stringify(value)}; input.setSelectionRange(input.value.length, input.value.length); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const keypress = async (key, modifiers = 0) => {
      await page('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
      await evaluate('keyChain');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    const screenshot = async name => {
      const { data } = await page('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(out, name + '.png'), Buffer.from(data, 'base64'));
    };
    await callback({ out, open, evaluate, waitFor, click, type, keypress, screenshot, page });
    await command('Browser.close');
  } finally { socket?.close(); child.kill(); }
}
