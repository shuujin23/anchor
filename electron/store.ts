import initSqlJs, { Database } from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { derive, encrypt, decrypt, salt } from './crypto';
import { Reminder, firstNotice, nextDue, validateReminder } from './schedule';
export class Store {
  db!: Database; key: Buffer | null = null; lastActivity = Date.now();
  constructor(public file: string) {}
  async open() {
    const SQL = await initSqlJs();
    this.db = new SQL.Database(fs.existsSync(this.file) ? fs.readFileSync(this.file) : undefined);
    this.db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    this.persist();
  }
  rows(table: 'credentials'|'reminders'|'history') { return (this.db.exec(`SELECT id, payload FROM ${table}`)[0]?.values ?? []).map(r => ({ id: String(r[0]), payload: String(r[1]) })); }
  get(key: string) { const stmt = this.db.prepare('SELECT value FROM meta WHERE key=?'); try { stmt.bind([key]); return stmt.step() ? String(stmt.get()[0]) : null; } finally { stmt.free(); } }
  set(key: string, value: string) { this.db.run('INSERT OR REPLACE INTO meta VALUES (?,?)', [key,value]); }
  persist() {
    fs.mkdirSync(path.dirname(this.file), {recursive:true});
    const temp = this.file + '.tmp';
    const fd = fs.openSync(temp, 'w', 0o600);
    try { fs.writeFileSync(fd, Buffer.from(this.db.export())); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, this.file);
  }
  transaction(fn: () => void) {
    const before = this.db.export(); this.db.run('BEGIN');
    try { fn(); this.db.run('COMMIT'); this.persist(); }
    catch (error) { try { this.db.run('ROLLBACK'); } catch {} this.db.close(); const Constructor = this.db.constructor as new (bytes: Uint8Array) => Database; this.db = new Constructor(before); throw error; }
  }
  setup(password: string) {
    if (this.get('salt')) throw new Error('Vault sudah dibuat.');
    this.checkPassword(password);
    const s = salt(), key = derive(password,s);
    this.transaction(() => { this.set('salt',s); this.set('verifier',encrypt('anchor-vault-v1',key)); });
    this.key = key; this.lastActivity = Date.now();
  }
  checkPassword(password: string) { if (typeof password !== 'string' || password.length < 12 || password.length > 1024) throw new Error('Gunakan master password minimal 12 karakter.'); }
  unlock(password: string) {
    if (typeof password !== 'string' || password.length > 1024) throw new Error('Password tidak valid.');
    const s = this.get('salt'); if (!s) throw new Error('Buat vault terlebih dahulu.');
    const key = derive(password,s);
    try { if (decrypt(this.get('verifier')!,key) !== 'anchor-vault-v1') throw new Error(); }
    catch { key.fill(0); throw new Error('Master password salah.'); }
    this.key?.fill(0); this.key = key; this.lastActivity = Date.now();
  }
  lock() { this.key?.fill(0); this.key = null; }
  requireKey() { if (!this.key) throw new Error('Buka vault terlebih dahulu.'); this.lastActivity = Date.now(); return this.key; }
  credentials() { const key = this.requireKey(); return this.rows('credentials').map(r => { const c = JSON.parse(decrypt(r.payload,key)); const {password,notes,...metadata} = c; return metadata; }); }
  credential(id: string) { const key = this.requireKey(), r = this.rows('credentials').find(r => r.id === id); if (!r) throw new Error('Credential tidak ditemukan.'); return JSON.parse(decrypt(r.payload,key)); }
  saveCredential(c: any) {
    const key = this.requireKey();
    for (const k of ['title','username','url','password','notes','category']) if (typeof c[k] !== 'string' || c[k].length > 10000) throw new Error('Credential tidak valid.');
    if (!c.title.trim() || c.title.length > 160 || !['Server','Billing','Akun','Lainnya'].includes(c.category)) throw new Error('Judul atau kategori tidak valid.');
    if (c.id && !this.rows('credentials').some(r => r.id === c.id)) throw new Error('Credential tidak ditemukan.');
    const id = c.id || randomUUID();
    const clean = {id,title:c.title.trim(),username:c.username,url:c.url,password:c.password,notes:c.notes,category:c.category,updatedAt:new Date().toISOString()};
    this.transaction(() => this.db.run('INSERT OR REPLACE INTO credentials VALUES (?,?)',[id,encrypt(JSON.stringify(clean),key)]));
  }
  reminders(): Reminder[] { return this.rows('reminders').map(r => JSON.parse(r.payload)); }
  putReminder(r: Reminder) { this.db.run('INSERT OR REPLACE INTO reminders VALUES (?,?)',[r.id,JSON.stringify(r)]); }
  saveReminder(input: any) {
    validateReminder(input);
    const old = input.id ? this.reminders().find(r => r.id === input.id) : undefined;
    if (input.id && !old) throw new Error('Reminder tidak ditemukan.');
    const due = new Date(input.due).toISOString();
    const mode = input.mode ?? 'deadline';
    const scheduleChanged = !old || (old.mode ?? 'deadline') !== mode || ['recurrence','every','unit','leadMinutes','repeatMinutes','windows','discord'].some(k => (old as any)[k] !== input[k]) || old.due !== due;
    const r: Reminder = { id:old?.id || randomUUID(),title:input.title.trim(),kind:input.kind,notes:input.notes,amount:input.amount,currency:input.currency,due,anchor:!old || old.due !== due ? due : old.anchor,recurrence:input.recurrence,every:input.every,unit:input.unit,leadMinutes:input.leadMinutes,repeatMinutes:input.repeatMinutes,windows:input.windows,discord:input.discord,enabled:old?.enabled ?? true,completed:old?.completed ?? false,nextNotify:old?.nextNotify ?? null,lastNotified:old?.lastNotified ?? null,createdAt:old?.createdAt || new Date().toISOString() };
    r.mode = mode;
    if (scheduleChanged) { r.nextNotify = firstNotice(r); r.lastNotified = null; }
    this.transaction(() => this.putReminder(r));
  }
  action(id: string, action: string, minutes = 30) {
    const r = this.reminders().find(r => r.id === id); if (!r) throw new Error('Reminder tidak ditemukan.');
    this.transaction(() => {
      if (action === 'complete') {
        if (r.completed) throw new Error('Task sudah selesai.');
        const next = r.mode === 'ongoing' ? null : nextDue(r);
        const h = {id:randomUUID(),title:r.title,kind:r.kind,mode:r.mode ?? 'deadline',amount:r.amount,currency:r.currency,due:r.due,completedAt:new Date().toISOString()};
        this.db.run('INSERT INTO history VALUES (?,?)',[h.id,JSON.stringify(h)]);
        if (next) { r.due = next; r.nextNotify = firstNotice(r); r.lastNotified = null; }
        else { r.completed = true; r.nextNotify = null; }
      } else if (action === 'toggle') { r.enabled = !r.enabled; }
      else if (action === 'snooze') {
        if (![10,30,60,240,1440].includes(minutes) || r.completed) throw new Error('Snooze tidak valid.');
        r.nextNotify = new Date(Date.now() + minutes * 60000).toISOString();
      } else throw new Error('Aksi tidak valid.');
      this.putReminder(r);
    });
  }
  remove(table: 'credentials'|'reminders', id: string) { if (table === 'credentials') this.requireKey(); this.transaction(() => this.db.run(`DELETE FROM ${table} WHERE id=?`,[id])); }
  history() { return this.rows('history').map(r => JSON.parse(r.payload)).sort((a,b) => b.completedAt.localeCompare(a.completedAt)).slice(0,200); }
  exportBackup(password: string) {
    const key = this.requireKey(); this.checkPassword(password); const s = salt(), backupKey = derive(password,s);
    try { return JSON.stringify({ format:'anchor-backup',version:2,salt:s,payload:encrypt(JSON.stringify({credentials:this.rows('credentials').map(r => JSON.parse(decrypt(r.payload,key))),reminders:this.reminders(),history:this.history()}),backupKey) }); }
    finally { backupKey.fill(0); }
  }
  verifyMasterPassword(password: string) {
    if (typeof password !== 'string' || !password || password.length > 1024 || !this.get('salt')) throw new Error('Master password tidak valid.');
    const candidate = derive(password, this.get('salt')!);
    try {
      if (decrypt(this.get('verifier')!, candidate) !== 'anchor-vault-v1') throw new Error();
    } catch { throw new Error('Master password salah.'); }
    finally { candidate.fill(0); }
  }
  exportAutomaticBackup(backupSalt: string, backupKey: Buffer, createdAt: string) {
    if (!this.get('salt') || !this.get('verifier')) throw new Error('Buat vault sebelum mengaktifkan backup otomatis.');
    if (!/^[a-f0-9]{32}$/.test(backupSalt) || backupKey.length !== 32) throw new Error('Kunci backup tidak valid.');
    // The job only copies ciphertext: it never stores or unlocks the vault key.
    // The outer key has an independent scrypt salt, even though both passwords
    // are the original master password. Settings/webhooks are not exported.
    const snapshot = {
      sourceVault: { salt:this.get('salt'), verifier:this.get('verifier') },
      encryptedCredentials:this.rows('credentials'),
      reminders:this.reminders(), history:this.history(), createdAt
    };
    const content = JSON.stringify({format:'anchor-backup',version:3,salt:backupSalt,payload:encrypt(JSON.stringify(snapshot),backupKey)});
    if (Buffer.byteLength(content,'utf8') > 50 * 1024 * 1024) throw new Error('Backup melebihi batas pemulihan 50 MB.');
    return content;
  }
  importBackup(content: string, password: string) {
    const key = this.requireKey();
    const envelope = JSON.parse(content);
    if (envelope.format !== 'anchor-backup' || ![1,2,3].includes(envelope.version) || !/^[a-f0-9]{32}$/.test(envelope.salt)) throw new Error('Format backup tidak valid.');
    let data: any; const backupKey = derive(password,envelope.salt);
    try { data = JSON.parse(decrypt(envelope.payload,backupKey)); } catch { throw new Error('Password backup salah atau file rusak.'); } finally { backupKey.fill(0); }
    if (envelope.version === 3) {
      if (!data.sourceVault || !/^[a-f0-9]{32}$/.test(data.sourceVault.salt) || typeof data.sourceVault.verifier !== 'string' || !Array.isArray(data.encryptedCredentials) || data.encryptedCredentials.length > 50000) throw new Error('Isi backup otomatis tidak valid.');
      const sourceKey = derive(password, data.sourceVault.salt);
      try {
        if (decrypt(data.sourceVault.verifier,sourceKey) !== 'anchor-vault-v1') throw new Error();
        data.credentials = data.encryptedCredentials.map((row:any) => {
          if (!row || typeof row.id !== 'string' || typeof row.payload !== 'string') throw new Error();
          const credential = JSON.parse(decrypt(row.payload,sourceKey));
          if (credential.id !== row.id) throw new Error();
          return credential;
        });
      } catch { throw new Error('Backup otomatis rusak atau master password vault asal tidak sesuai.'); }
      finally { sourceKey.fill(0); }
    }
    if (!Array.isArray(data.credentials) || !Array.isArray(data.reminders) || !Array.isArray(data.history) || data.credentials.length + data.reminders.length + data.history.length > 50000) throw new Error('Isi backup tidak valid.');
    for (const r of data.reminders) { validateReminder(r); if (typeof r.id !== 'string' || !Number.isFinite(Date.parse(r.anchor)) || typeof r.enabled !== 'boolean' || typeof r.completed !== 'boolean' || (r.nextNotify !== null && !Number.isFinite(Date.parse(r.nextNotify)))) throw new Error('Reminder backup tidak valid.'); }
    for (const c of data.credentials) { for (const field of ['id','title','username','url','password','notes','category']) if (typeof c[field] !== 'string' || c[field].length > 10000) throw new Error('Credential backup tidak valid.'); }
    for (const h of data.history) if (typeof h.id !== 'string' || typeof h.title !== 'string' || !Number.isFinite(Date.parse(h.completedAt))) throw new Error('Riwayat backup tidak valid.');
    // Merge by ID. Existing records win; restoring an older backup cannot revert payment state.
    this.transaction(() => {
      for (const c of data.credentials) this.db.run('INSERT OR IGNORE INTO credentials VALUES (?,?)',[c.id,encrypt(JSON.stringify(c),key)]);
      for (const r of data.reminders) this.db.run('INSERT OR IGNORE INTO reminders VALUES (?,?)',[r.id,JSON.stringify(r)]);
      for (const h of data.history) this.db.run('INSERT OR IGNORE INTO history VALUES (?,?)',[h.id,JSON.stringify(h)]);
    });
  }
}
