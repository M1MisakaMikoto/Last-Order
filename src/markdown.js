const cellWidth = char => /\p{Mark}/u.test(char) ? 0
  : /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6\u{1f300}-\u{1faff}]/u.test(char) ? 2 : 1;
const textWidth = text => Array.from(String(text ?? '')).reduce((sum, char) => sum + cellWidth(char), 0);

export function stripFormatting(text) {
  return String(text ?? '')
    .replace(/\x1b\]8;;.*?(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

export function styledWidth(text) {
  return Array.from(stripFormatting(text)).reduce((sum, char) => sum + cellWidth(char), 0);
}

function safeLink(url) {
  const value = String(url ?? '').trim();
  if (/^(?:https?:\/\/|mailto:)/i.test(value)) return value.replace(/[\x00-\x20\x7f]/g, encodeURIComponent);
  if (/^lastorder-copy:[A-Za-z0-9_-]+$/.test(value)) return value;
  if (/^[A-Za-z]:[\\/]/.test(value)) return value;
  if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/[\x00-\x1f\x7f]/.test(value)) return value;
  return '';
}

function fileMention(value) {
  const text = String(value ?? '').trim();
  if (!text || /^(?:https?:\/\/|mailto:)/i.test(text) || /\s{2,}/.test(text)) return null;
  const hash = /^(.+?)#L(\d+)(?:-L?(\d+))?$/i.exec(text);
  const match = hash ?? /^(.+?)(?::(\d+)(?:-(\d+))?)?$/.exec(text);
  if (!match) return null;
  const file = match[1];
  if (!(/(?:^|[\\/])[^\\/]+\.[a-z0-9]{1,12}$/i.test(file) || /^[A-Za-z]:[\\/]/.test(file))) return null;
  const anchor = match[2] ? `#L${match[2]}${match[3] ? `-L${match[3]}` : ''}` : '';
  return { text, target: file.replaceAll('\\', '/') + anchor };
}

function inlineSegments(text, base = {}) {
  const segments = [], pattern = /(\[([^\]]+)\]\(([^)\s]+)\)|\{\{file:([^}]+)\}\}|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let last = 0, match;
  while ((match = pattern.exec(text))) {
    if (match.index > last) segments.push({ ...base, text: text.slice(last, match.index) });
    if (match[2] !== undefined) {
      const link = safeLink(match[3]);
      segments.push({ ...base, text: match[2], link: link || null, underline: Boolean(link) });
    } else if (match[4] !== undefined) {
      const mention = fileMention(match[4]);
      segments.push({ ...base, text: mention?.text ?? match[4], link: mention?.target ?? null, underline: Boolean(mention), code: true });
    } else if (match[5] !== undefined) {
      const mention = fileMention(match[5]);
      segments.push({ ...base, text: match[5], link: mention?.target ?? null, underline: Boolean(mention), code: true });
    } else if (match[6] !== undefined) segments.push({ ...base, text: match[6], bold: true });
    else if (match[7] !== undefined) segments.push({ ...base, text: match[7], italic: true });
    last = pattern.lastIndex;
  }
  if (last < text.length) segments.push({ ...base, text: text.slice(last) });
  return segments;
}

function styleSegment(segment, text) {
  if (!text) return '';
  const prefix = [];
  if (segment.link) prefix.push(`\x1b]8;;${segment.link}\x1b\\`);
  if (segment.bold) prefix.push('\x1b[1m');
  if (segment.italic) prefix.push('\x1b[3m');
  if (segment.underline) prefix.push('\x1b[4m');
  if (segment.code) prefix.push('\x1b[36m');
  if (segment.dim) prefix.push('\x1b[2m');
  const suffix = (prefix.length ? '\x1b[0m' : '') + (segment.link ? '\x1b]8;;\x1b\\' : '');
  return prefix.join('') + text + suffix;
}

function wrapSegments(segments, columns) {
  const lines = [];
  let current = [], used = 0;
  const push = () => { lines.push(current); current = []; used = 0; };
  for (const segment of segments) {
    let chunk = '';
    for (const char of segment.text) {
      const size = cellWidth(char);
      if (used + size > columns && (current.length || chunk)) {
        if (chunk) current.push({ ...segment, text: chunk });
        push(); chunk = '';
      }
      chunk += char; used += size;
    }
    if (chunk) current.push({ ...segment, text: chunk });
  }
  if (current.length || !lines.length) push();
  return lines.map(line => line.map(segment => styleSegment(segment, segment.text)).join(''));
}

function indentContinuation(segments, prefix, columns) {
  const first = wrapSegments(segments, Math.max(1, columns - cellWidth(prefix)));
  return first.map((line, index) => (index ? ' '.repeat(Math.min(columns, Array.from(prefix).reduce((sum, char) => sum + cellWidth(char), 0))) : prefix) + line);
}

function splitTableRow(line) {
  const value = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') { cell += '|'; index++; continue; }
    if (char === '|') { cells.push(cell.trim()); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function tableAlignments(line) {
  const cells = splitTableRow(line);
  if (!cells.length || !cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map(cell => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : 'left');
}

function plainCell(value) {
  return stripFormatting(String(value))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\{\{file:([^}]+)\}\}/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function wrapCell(value, width) {
  const lines = [];
  let line = '', used = 0;
  for (const char of plainCell(value)) {
    const size = cellWidth(char);
    if (used + size > width && line) { lines.push(line); line = ''; used = 0; }
    line += char; used += size;
  }
  lines.push(line);
  return lines.length ? lines : [''];
}

function fitCell(value, width, alignment = 'left') {
  const padding = Math.max(0, width - textWidth(value));
  if (alignment === 'right') return ' '.repeat(padding) + value;
  if (alignment === 'center') {
    const left = Math.floor(padding / 2);
    return ' '.repeat(left) + value + ' '.repeat(padding - left);
  }
  return value + ' '.repeat(padding);
}

function renderTable(rows, alignments, columns) {
  const count = Math.max(2, ...rows.map(row => row.length));
  const normalized = rows.map(row => Array.from({ length: count }, (_, index) => plainCell(row[index] ?? '')));
  const totalBorder = count * 3 + 1;
  if (columns < totalBorder + count) {
    return normalized.map((row, index) => styleSegment({ bold: index === 0 }, row.join(' · ')));
  }
  const budget = columns - totalBorder;
  const widths = Array.from({ length: count }, (_, index) => Math.max(1, ...normalized.map(row => textWidth(row[index]))));
  while (widths.reduce((sum, width) => sum + width, 0) > budget) {
    let widest = 0;
    for (let index = 1; index < count; index++) if (widths[index] > widths[widest]) widest = index;
    if (widths[widest] <= 1) break;
    widths[widest]--;
  }
  const border = (left, middle, right) => left + widths.map(width => '─'.repeat(width + 2)).join(middle) + right;
  const output = [border('┌', '┬', '┐')];
  normalized.forEach((row, rowIndex) => {
    const wrapped = row.map((cell, index) => wrapCell(cell, widths[index]));
    const height = Math.max(...wrapped.map(lines => lines.length));
    for (let line = 0; line < height; line++) {
      output.push('│ ' + wrapped.map((lines, index) => fitCell(lines[line] ?? '', widths[index], alignments[index] ?? 'left')).join(' │ ') + ' │');
    }
    if (rowIndex === 0) output.push(border('├', '┼', '┤'));
  });
  output.push(border('└', '┴', '┘'));
  return output;
}

export function renderMarkdown(text, columns = 80) {
  columns = Math.max(1, columns);
  const source = stripFormatting(text).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const sourceLines = source.split('\n');
  const output = [];
  let fenced = false, language = '', codeLines = [];
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex++) {
    const raw = sourceLines[lineIndex];
    if (/^\s*```/.test(raw)) {
      if (!fenced) {
        fenced = true; language = raw.trim().slice(3).trim();
        codeLines = [];
        output.push(styleSegment({ dim: true }, '┌─ ' + (language || 'code')));
      } else {
        fenced = false;
        output.push(styleSegment({ dim: true }, '└─'));
        const code = codeLines.join('\n');
        if (code && Buffer.byteLength(code) <= 16_000) {
          const target = 'lastorder-copy:' + Buffer.from(code).toString('base64url');
          output.push(styleSegment({ link: target, underline: true, dim: true }, '[copy code]'));
        }
        codeLines = [];
      }
      continue;
    }
    if (fenced) {
      codeLines.push(raw);
      for (const line of wrapSegments([{ text: raw || ' ' }], Math.max(1, columns - 2))) output.push(styleSegment({ dim: true }, '│ ') + line);
      continue;
    }
    if (raw.includes('|')) {
      const alignments = tableAlignments(sourceLines[lineIndex + 1] ?? '');
      if (alignments) {
        const rows = [splitTableRow(raw)];
        let next = lineIndex + 2;
        while (next < sourceLines.length && sourceLines[next].trim() && sourceLines[next].includes('|')) {
          rows.push(splitTableRow(sourceLines[next]));
          next++;
        }
        output.push(...renderTable(rows, alignments, columns));
        lineIndex = next - 1;
        continue;
      }
    }
    if (!raw.trim()) { output.push(''); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      output.push(...wrapSegments([{ text: heading[2], bold: true, underline: heading[1].length <= 2 }], columns));
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(raw)) { output.push('─'.repeat(columns)); continue; }
    const quote = /^>\s?(.*)$/.exec(raw);
    if (quote) { output.push(...indentContinuation(inlineSegments(quote[1], { dim: true }), '│ ', columns)); continue; }
    const list = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(raw);
    if (list) {
      const prefix = list[1] + (/\d/.test(list[2]) ? list[2] : '•') + ' ';
      output.push(...indentContinuation(inlineSegments(list[3]), prefix, columns));
      continue;
    }
    output.push(...wrapSegments(inlineSegments(raw), columns));
  }
  return output;
}
