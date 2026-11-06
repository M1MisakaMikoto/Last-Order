import { spawn } from 'node:child_process';

function writeClipboard(command, args, text, encoding = 'utf8') {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('复制到剪贴板超时'));
    }, 5000);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
    child.on('error', error => finish(error));
    child.on('close', code => finish(code === 0 ? null : new Error(stderr.trim() || `剪贴板命令退出码 ${code}`)));
    child.stdin.on('error', error => finish(error));
    child.stdin.end(Buffer.from(text, encoding));
  });
}

function headlessClipboardError(action) {
  const verb = action === 'copy' ? '复制' : '读取';
  return new Error(`无法${verb}系统剪贴板：当前 Linux 会话未设置 DISPLAY 或 WAYLAND_DISPLAY。SSH 或无桌面环境请使用终端粘贴快捷键 Ctrl+Shift+V 或 Shift+Insert。`);
}

export async function copyText(text, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    try {
      await writeClipboard('clip.exe', [], text, 'utf16le');
    } catch {
      await writeClipboard('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'
      ], text);
    }
    return;
  }
  if (platform === 'darwin') {
    await writeClipboard('pbcopy', [], text);
    return;
  }
  if (platform === 'linux') {
    if (env.WAYLAND_DISPLAY) {
      try {
        await writeClipboard('wl-copy', [], text);
        return;
      } catch (error) {
        if (!env.DISPLAY) throw new Error(`Wayland 剪贴板不可用：${error.message}。请安装 wl-clipboard，或使用终端粘贴快捷键 Ctrl+Shift+V / Shift+Insert。`);
      }
    }
    if (!env.DISPLAY) throw headlessClipboardError('copy');
    try {
      await writeClipboard('xclip', ['-selection', 'clipboard'], text);
    } catch (error) {
      throw new Error(`X11 剪贴板不可用：${error.message}。请检查 DISPLAY 与 XAUTHORITY，或使用终端粘贴快捷键 Ctrl+Shift+V / Shift+Insert。`);
    }
    return;
  }
  throw new Error(`当前平台不支持直接复制：${platform}`);
}

function readClipboardCommand(command, args, platform = process.platform) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('读取剪贴板超时'));
    }, 5000);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) return finish(new Error(Buffer.concat(stderr).toString('utf8').trim() || `剪贴板命令退出码 ${code}`));
      const output = Buffer.concat(stdout);
      if (platform === 'win32') {
        const encoded = output.toString('ascii').trim();
        return finish(null, encoded ? Buffer.from(encoded, 'base64').toString('utf8') : '');
      }
      finish(null, output.toString('utf8'));
    });
  });
}

export async function readClipboard(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return readClipboardCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$text = Get-Clipboard -Raw; if ($null -ne $text) { [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) }'
    ], platform);
  }
  if (platform === 'darwin') return readClipboardCommand('pbpaste', [], platform);
  if (platform === 'linux') {
    if (env.WAYLAND_DISPLAY) {
      try {
        return await readClipboardCommand('wl-paste', ['--no-newline'], platform);
      } catch (error) {
        if (!env.DISPLAY) throw new Error(`Wayland 剪贴板不可用：${error.message}。请安装 wl-clipboard，或使用终端粘贴快捷键 Ctrl+Shift+V / Shift+Insert。`);
      }
    }
    if (!env.DISPLAY) throw headlessClipboardError('read');
    try {
      return await readClipboardCommand('xclip', ['-selection', 'clipboard', '-o'], platform);
    } catch (error) {
      throw new Error(`X11 剪贴板不可用：${error.message}。请检查 DISPLAY 与 XAUTHORITY，或使用终端粘贴快捷键 Ctrl+Shift+V / Shift+Insert。`);
    }
  }
  throw new Error(`当前平台不支持读取剪贴板：${platform}`);
}
