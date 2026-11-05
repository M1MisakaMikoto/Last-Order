import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, writeFileSync, closeSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory, initial) {
    mkdirSync(directory, { recursive: true });
    this.lockPath = path.join(directory, 'service.lock');
    try {
      this.lock = openSync(this.lockPath, 'wx');
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const pid = Number(readFileSync(this.lockPath, 'utf8'));
      let alive = true;
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') alive = false; }
      if (alive || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('This project already has a service, or its lock needs inspection: ' + this.lockPath);
      unlinkSync(this.lockPath);
      this.lock = openSync(this.lockPath, 'wx');
    }
    writeFileSync(this.lock, String(process.pid));
    try {
      this.db = new DatabaseSync(path.join(directory, 'schedule.sqlite'));
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL, actor TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL);');
      const saved = this.db.prepare('SELECT value FROM state WHERE id=1').get();
      this.state = saved ? JSON.parse(saved.value) : initial;
      if (this.state.schemaVersion !== 1) throw new Error('Unsupported database schema');
      this.write = this.db.prepare('INSERT INTO state(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value');
      this.append = this.db.prepare('INSERT INTO events(time,actor,type,data) VALUES(?,?,?,?)');
    } catch (error) { this.close(); throw error; }
  }
  commit(type, data, mutate = () => {}, actor = 'service') {
    const next = structuredClone(this.state);
    mutate(next);
    const time = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.write.run(JSON.stringify(next));
      const result = this.append.run(time, actor, type, JSON.stringify(data));
      this.db.exec('COMMIT');
      this.state = next;
      return { seq: Number(result.lastInsertRowid), time, actor, type, data };
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  history(actor, limit = 400) {
    const rows = actor
      ? this.db.prepare('SELECT * FROM events WHERE actor=? ORDER BY seq DESC LIMIT ?').all(actor, limit)
      : this.db.prepare('SELECT * FROM events ORDER BY seq DESC LIMIT ?').all(limit);
    return rows.reverse().map(row => ({ ...row, data: JSON.parse(row.data) }));
  }
  historyPage(actor, { limit = 100, beforeSeq = null, types = [] } = {}) {
    const clauses = ['actor=?'], values = [actor];
    if (Number.isSafeInteger(beforeSeq)) { clauses.push('seq<?'); values.push(beforeSeq); }
    if (types.length) { clauses.push(`type IN (${types.map(() => '?').join(',')})`); values.push(...types); }
    values.push(limit);
    const rows = this.db.prepare(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY seq DESC LIMIT ?`).all(...values);
    return rows.reverse().map(row => ({ ...row, data: JSON.parse(row.data) }));
  }
  event(actor, seq) {
    const row = this.db.prepare('SELECT * FROM events WHERE actor=? AND seq=?').get(actor, seq);
    return row ? { ...row, data: JSON.parse(row.data) } : null;
  }
  close() {
    this.db?.close(); this.db = undefined;
    if (this.lock !== undefined) { closeSync(this.lock); this.lock = undefined; unlinkSync(this.lockPath); }
  }
}
