import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Store } from './store';
import { derive, salt } from './crypto';

export type BackupSchedule = {
  frequency:'daily'|'weekly'|'monthly'; time:string; weekday:number; monthDay:number;
};
type Config = BackupSchedule & { enabled:boolean; folder:string; protectedKey:string; sourceSalt:string };
type State = {
  nextRun:string|null; lastSuccess:string|null; lastFile:string|null;
  lastAttempt:string|null; lastError:string; retryAt:string|null;
};
export type KeyProtection = { seal:(value:string)=>string; unseal:(value:string)=>string };
const CONFIG = 'automaticBackup.config', STATE = 'automaticBackup.state';
const defaultConfig = ():Config => ({enabled:false,folder:'',frequency:'daily',time:'09:00',weekday:1,monthDay:1,protectedKey:'',sourceSalt:''});
const defaultState = ():State => ({nextRun:null,lastSuccess:null,lastFile:null,lastAttempt:null,lastError:'',retryAt:null});

export function validateBackupSchedule(input: BackupSchedule) {
  if (!['daily','weekly','monthly'].includes(input.frequency) || typeof input.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
    || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6
    || !Number.isInteger(input.monthDay) || input.monthDay < 1 || input.monthDay > 31) throw new Error('Jadwal backup tidak valid.');
}

export function nextBackupTime(schedule: BackupSchedule, after: Date): string {
  validateBackupSchedule(schedule);
  const [hour,minute] = schedule.time.split(':').map(Number);
  const date = new Date(after);
  date.setHours(hour,minute,0,0);
  if (schedule.frequency === 'daily') {
    if (date <= after) date.setDate(date.getDate()+1);
  } else if (schedule.frequency === 'weekly') {
    date.setDate(date.getDate() + (schedule.weekday-date.getDay()+7)%7);
    if (date <= after) date.setDate(date.getDate()+7);
  } else {
    const setDay = () => date.setDate(Math.min(schedule.monthDay,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));
    date.setDate(1); setDay();
    if (date <= after) { date.setDate(1); date.setMonth(date.getMonth()+1); setDay(); }
  }
  return date.toISOString();
}

export class AutomaticBackup {
  private busy = false;
  private memoryRetryUntil = 0;
  constructor(private store:Store, private protection:KeyProtection, private clock:()=>Date = ()=>new Date()) {}
  private config():Config { return {...defaultConfig(),...JSON.parse(this.store.get(CONFIG)||'{}')}; }
  private state():State { return {...defaultState(),...JSON.parse(this.store.get(STATE)||'{}')}; }
  settings() {
    const {protectedKey,sourceSalt,...config} = this.config();
    return {...config,...this.state(),hasKey:!!protectedKey,running:this.busy};
  }
  private readKey(config:Config) {
    try {
      if (config.sourceSalt !== this.store.get('salt')) throw new Error();
      const key = JSON.parse(this.protection.unseal(config.protectedKey));
      if (!/^[a-f0-9]{32}$/.test(key.salt) || !/^[a-f0-9]{64}$/.test(key.key)) throw new Error();
      return {salt:key.salt as string,key:Buffer.from(key.key,'hex')};
    } catch { throw new Error('Kunci backup tidak dapat dibuka di perangkat ini. Simpan ulang pengaturan dengan master password.'); }
  }
  async configure(input:any) {
    this.store.requireKey();
    if (this.busy) throw new Error('Tunggu backup yang sedang berjalan selesai.');
    if (!input || typeof input.enabled !== 'boolean') throw new Error('Pengaturan backup tidak valid.');
    let old = this.config();
    if (!input.enabled) {
      this.store.transaction(()=>{this.store.set(CONFIG,JSON.stringify({...old,enabled:false}));this.store.set(STATE,JSON.stringify({...this.state(),nextRun:null,retryAt:null,lastError:''}));});
      return;
    }
    validateBackupSchedule(input);
    if (typeof input.folder !== 'string' || input.folder.length > 4096 || !path.isAbsolute(input.folder)) throw new Error('Pilih folder backup yang valid.');
    const folder = path.normalize(input.folder);
    try { if (!(await fs.stat(folder)).isDirectory()) throw new Error(); }
    catch { throw new Error('Folder backup belum tersedia. Hubungkan storage atau jalankan Google Drive for desktop.'); }
    // Recheck after awaiting filesystem access; the vault could have auto-locked.
    this.store.requireKey();
    if (this.busy) throw new Error('Tunggu backup yang sedang berjalan selesai.');
    old = this.config();
    const config:Config = {enabled:true,folder,frequency:input.frequency,time:input.time,weekday:input.weekday,monthDay:input.monthDay,protectedKey:old.protectedKey,sourceSalt:old.sourceSalt};
    if (input.password !== undefined && input.password !== '') {
      this.store.verifyMasterPassword(input.password);
      const backupSalt = salt(), key = derive(input.password,backupSalt);
      try { config.protectedKey=this.protection.seal(JSON.stringify({salt:backupSalt,key:key.toString('hex')})); }
      finally { key.fill(0); }
      config.sourceSalt = this.store.get('salt')!;
    } else { this.readKey(config).key.fill(0); }
    const scheduleChanged = ['frequency','time','weekday','monthDay'].some(k=>(old as any)[k]!==input[k]);
    const state = this.state(), now = this.clock();
    if (!old.enabled || folder !== old.folder || !state.nextRun) state.nextRun=now.toISOString();
    else if (scheduleChanged) state.nextRun=nextBackupTime(config,now);
    state.retryAt=null; state.lastError='';
    this.store.transaction(()=>{this.store.set(CONFIG,JSON.stringify(config));this.store.set(STATE,JSON.stringify(state));});
    this.memoryRetryUntil=0;
  }
  async runDue(now = this.clock()) {
    const config=this.config(),state=this.state();
    if (!config.enabled || !state.nextRun || Date.parse(state.nextRun)>now.getTime() || (state.retryAt && Date.parse(state.retryAt)>now.getTime()) || this.memoryRetryUntil>now.getTime()) return null;
    return this.run(now);
  }
  async runNow() { return this.run(this.clock()); }
  private async run(now:Date):Promise<{ok:boolean;file?:string;error?:string}> {
    if (this.busy) return {ok:false,error:'Backup sedang berjalan.'};
    const config=this.config();
    if (!config.enabled) return {ok:false,error:'Aktifkan dan simpan pengaturan backup terlebih dahulu.'};
    this.busy=true;
    let temporary:string|undefined, key:Buffer|undefined;
    try {
      if (!(await fs.stat(config.folder)).isDirectory()) throw new Error('Folder tujuan bukan direktori.');
      const secret=this.readKey(config); key=secret.key;
      const content=this.store.exportAutomaticBackup(secret.salt,key,now.toISOString());
      const suffix=randomUUID();
      const destination=path.join(config.folder,`Anchor-auto-${now.toISOString().replace(/[:.]/g,'-')}-${suffix.slice(0,8)}.anchor`);
      temporary=path.join(config.folder,`.anchor-${suffix}.tmp`);
      const handle=await fs.open(temporary,'wx',0o600);
      try { await handle.writeFile(content,'utf8'); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temporary,destination); temporary=undefined;
      if (await fs.readFile(destination,'utf8') !== content) throw new Error('Verifikasi file backup gagal.');
      const finished=new Date(Math.max(now.getTime(),this.clock().getTime()));
      const state:State={nextRun:nextBackupTime(config,finished),lastSuccess:finished.toISOString(),lastFile:destination,lastAttempt:now.toISOString(),lastError:'',retryAt:null};
      this.store.transaction(()=>this.store.set(STATE,JSON.stringify(state)));
      this.memoryRetryUntil=0;
      return {ok:true,file:destination};
    } catch(error) {
      const code=(error as NodeJS.ErrnoException).code;
      const message=code === 'ENOENT' ? 'Folder backup tidak tersedia. Hubungkan storage atau jalankan Google Drive for desktop.'
        : code === 'ENOSPC' ? 'Ruang penyimpanan tujuan tidak cukup.'
        : code === 'EACCES' || code === 'EPERM' ? 'Folder backup tidak dapat ditulis. Periksa izin akses.'
        : code ? 'File backup gagal ditulis. Periksa koneksi storage dan coba lagi.' : (error as Error).message;
      this.memoryRetryUntil=now.getTime()+15*60000;
      const state:State={...this.state(),lastAttempt:now.toISOString(),lastError:message,retryAt:new Date(this.memoryRetryUntil).toISOString()};
      try { this.store.transaction(()=>this.store.set(STATE,JSON.stringify(state))); } catch { /* in-memory delay prevents disk-failure retry storms */ }
      return {ok:false,error:message};
    } finally {
      key?.fill(0);
      if (temporary) { try { await fs.unlink(temporary); } catch {} }
      this.busy=false;
    }
  }
}
