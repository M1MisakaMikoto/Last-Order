import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

// Remove mouse reports before readline sees them, including split reports.
// Otherwise terminal wheel packets can become literal text in the input box.
export class TerminalInput extends Transform {
  constructor(onWheel, onMouse = () => {}, onPaste = () => {}) {
    super();
    this.onWheel = onWheel; this.onMouse = onMouse; this.onPaste = onPaste;
    this.decoder = new StringDecoder('utf8'); this.pending = ''; this.pasting = false; this.pasteBuffer = '';
  }
  _transform(chunk, encoding, done) {
    clearTimeout(this.escapeTimer);
    this.pending += this.decoder.write(chunk);
    let output = '';
    while (this.pending) {
      if (this.pasting) {
        const end = this.pending.indexOf('\x1b[201~');
        if (end >= 0) {
          this.pasteBuffer += this.pending.slice(0, end);
          this.pending = this.pending.slice(end + 6);
          const paste = this.pasteBuffer;
          this.pasteBuffer = ''; this.pasting = false;
          this.onPaste(paste);
          continue;
        }
        let keep = 0;
        for (let size = 1; size < 6; size++) if (this.pending.endsWith('\x1b[201~'.slice(0, size))) keep = size;
        this.pasteBuffer += keep ? this.pending.slice(0, -keep) : this.pending;
        this.pending = keep ? this.pending.slice(-keep) : '';
        break;
      }
      const escape = this.pending.indexOf('\x1b');
      if (escape < 0) { output += this.pending; this.pending = ''; break; }
      output += this.pending.slice(0, escape); this.pending = this.pending.slice(escape);
      if (this.pending === '\x1b' || this.pending === '\x1b[') break;
      if (this.pending.startsWith('\x1b[200~')) {
        this.pasting = true; this.pending = this.pending.slice(6); continue;
      }
      if ('\x1b[200~'.startsWith(this.pending)) break;
      if (this.pending.startsWith('\x1b[201~')) { this.pending = this.pending.slice(6); continue; }
      if ('\x1b[201~'.startsWith(this.pending)) break;
      if (this.pending.startsWith('\x1b[<')) {
        const report = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.pending);
        if (!report && /^\x1b\[<[\d;]*$/.test(this.pending) && this.pending.length < 64) break;
        if (report) {
          const button = Number(report[1]), x = Number(report[2]), y = Number(report[3]);
          if (report[4] === 'M' && (button & 64) && !(button & 2)) this.onWheel((button & 1) ? 3 : -3);
          else if (!(button & 64)) this.onMouse({
            type: report[4] === 'm' || (button & 3) === 3 ? 'up' : (button & 32) ? 'drag' : 'down',
            button: button & 3, x, y, shift: Boolean(button & 4), meta: Boolean(button & 8), ctrl: Boolean(button & 16)
          });
          this.pending = this.pending.slice(report[0].length); continue;
        }
      } else if (this.pending.startsWith('\x1b[M')) {
        if (this.pending.length < 6) break;
        const button = this.pending.charCodeAt(3) - 32, x = this.pending.charCodeAt(4) - 32, y = this.pending.charCodeAt(5) - 32;
        if ((button & 64) && !(button & 2)) this.onWheel((button & 1) ? 3 : -3);
        else this.onMouse({
          type: (button & 3) === 3 ? 'up' : (button & 32) ? 'drag' : 'down',
          button: button & 3, x, y, shift: Boolean(button & 4), meta: Boolean(button & 8), ctrl: Boolean(button & 16)
        });
        this.pending = this.pending.slice(6); continue;
      }
      output += this.pending[0]; this.pending = this.pending.slice(1);
    }
    if (output) this.push(output);
    // A standalone Escape must reach readline too; allow a short interval for
    // the rest of a split mouse/keyboard escape sequence to arrive first.
    if (this.pending === '\x1b') this.escapeTimer = setTimeout(() => { this.push(this.pending); this.pending = ''; }, 30);
    done();
  }
  _flush(done) {
    clearTimeout(this.escapeTimer);
    if (this.pasting) { this.onPaste(this.pasteBuffer + this.pending + this.decoder.end()); this.pasteBuffer = ''; this.pending = ''; }
    else this.push(this.pending + this.decoder.end());
    done();
  }
  _destroy(error, done) { clearTimeout(this.escapeTimer); done(error); }
}
