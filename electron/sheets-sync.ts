import { createHash } from 'node:crypto';
import { Store } from './store';
import { License } from './license';
import { Reminder } from './schedule';
import { GoogleSheets, parseCredential, ServiceCredential, SheetTarget, SheetsAPI, sheetDate, spreadsheetId } from './google-sheets';
type Protection={seal:(value:string)=>string;unseal:(value:string)=>string};
type Config=SheetTarget & {enabled:boolean;title:string};
type RecordState={hash?:string;lastSync?:string;error?:string;attempts?:number;retryAt?:number};
export class SheetsSync {
  private busy=false;private cached?:SheetsAPI;
  constructor(private store:Store,private license:License,private protection:Protection,private factory:(c:ServiceCredential)=>SheetsAPI=c=>new GoogleSheets(c)) {
    store.prepareReminder=(r,input,old)=>{
      const enabled=input.syncToSheets ?? old?.syncToSheets ?? false;
      if(enabled){
        if(!old?.syncToSheets){this.license.require();if(!this.config()||!this.store.get('sheets.credential'))throw new Error('Atur Google Sheets dan PIC terlebih dahulu.');}
        if(r.kind!=='task'||r.mode!=='ongoing'&&r.recurrence!=='once')throw new Error('Sync hanya untuk task satu periode. Ubah task lama menjadi satu deadline terlebih dahulu.');
        r.sheetTarget=old?.sheetTarget ?? this.config()!;
      }else r.sheetTarget=old?.sheetTarget;
      r.syncToSheets=enabled;
    };
  }
  private config():Config|null{const raw=this.store.get('sheets.config');return raw?JSON.parse(raw):null;}
  private api(){if(!this.cached){const sealed=this.store.get('sheets.credential');if(!sealed)throw new Error('Pilih credential Google terlebih dahulu.');try{this.cached=this.factory(JSON.parse(this.protection.unseal(sealed)));}catch{throw new Error('Credential tidak dapat dibuka di akun perangkat ini. Impor ulang JSON credential.');}}return this.cached;}
  private recordKey(r:Reminder){return 'sheets.task:'+r.sheetTarget!.spreadsheetId+':'+r.id;}
  private record(r:Reminder):RecordState{return JSON.parse(this.store.get(this.recordKey(r))||'{}');}
  private row(r:Reminder){return {taskId:r.id,title:r.title,date:sheetDate(r.createdAt,r.sheetTarget!.timeZone),hours:r.actualHours ?? null,notes:r.notes};}
  private hash(r:Reminder){return createHash('sha256').update(JSON.stringify(this.row(r))).digest('hex');}
  state(){return {license:this.license.state(),config:this.license.state().active?this.config():null,hasCredential:!!this.store.get('sheets.credential'),busy:this.busy};}
  statuses(){
    if(!this.license.state().active)return {};
    const out:Record<string,{status:string;error?:string;lastSync?:string;pic:string}>={};
    for(const r of this.store.reminders().filter(r=>r.syncToSheets&&r.sheetTarget)){
      const s=this.record(r);out[r.id]={status:!this.config()?.enabled?'Dijeda':s.hash===this.hash(r)?'Tersinkron':s.error?'Gagal':'Menunggu',error:s.error,lastSync:s.lastSync,pic:r.sheetTarget!.pic};
    }return out;
  }
  importCredential(raw:string){this.license.require();this.store.requireKey();if(this.busy)throw new Error('Tunggu sinkronisasi selesai.');const credential=parseCredential(raw),sealed=this.protection.seal(JSON.stringify(credential));this.store.transaction(()=>this.store.set('sheets.credential',sealed));this.cached=undefined;}
  async inspect(value:unknown){this.license.require();return this.api().inspect(spreadsheetId(value));}
  async configure(input:any){
    this.license.require();this.store.requireKey();if(this.busy)throw new Error('Tunggu sinkronisasi selesai.');
    if(!input||!Number.isInteger(input.sheetId)||typeof input.enabled!=='boolean')throw new Error('Pengaturan Sheets tidak valid.');
    const id=spreadsheetId(input.spreadsheetId),info=await this.api().inspect(id),sheet=info.sheets.find(s=>s.id===input.sheetId);
    if(!sheet)throw new Error('PIC harus dipilih dari tab spreadsheet yang tersedia.');
    this.license.require();this.store.requireKey();
    const config:Config={spreadsheetId:id,sheetId:sheet.id,pic:sheet.title,timeZone:info.timeZone,title:info.title,enabled:input.enabled};
    this.store.transaction(()=>this.store.set('sheets.config',JSON.stringify(config)));
  }
  pause(){this.license.require();const c=this.config();if(c)this.store.transaction(()=>this.store.set('sheets.config',JSON.stringify({...c,enabled:false})));}
  deactivate(){if(this.busy)throw new Error('Tunggu sinkronisasi selesai.');this.pause();this.store.transaction(()=>this.store.set('sheets.license',''));this.cached=undefined;}
  async run(force=false){
    if(force)this.license.require();
    if(this.busy||!this.license.state().active||!this.config()?.enabled)return;
    this.busy=true;
    try{
      const jobs=this.store.reminders().filter(r=>r.syncToSheets&&r.sheetTarget).filter(r=>{const s=this.record(r);return s.hash!==this.hash(r)&&(force||!s.retryAt||s.retryAt<=Date.now());}).slice(0,5);
      for(const task of jobs){
        const hash=this.hash(task),previous=this.record(task);
        const allowed=()=>{const fresh=this.store.reminders().find(r=>r.id===task.id);return !!(this.license.state().active&&this.config()?.enabled&&fresh?.syncToSheets&&fresh.sheetTarget&&this.hash(fresh)===hash);};
        if(!allowed())continue;
        try{
          await this.api().upsert(task.sheetTarget!,this.row(task),!!previous.lastSync,allowed);
          if(allowed())this.store.transaction(()=>this.store.set(this.recordKey(task),JSON.stringify({hash,lastSync:new Date().toISOString()})));
        }catch(error){
          const attempts=(previous.attempts ?? 0)+1;
          const message=error instanceof Error?error.message:'Sinkronisasi gagal.';
          this.store.transaction(()=>this.store.set(this.recordKey(task),JSON.stringify({...previous,attempts,error:message.slice(0,240),retryAt:Date.now()+Math.min(30,2**Math.min(attempts,5))*60000})));
        }
      }
    }finally{this.busy=false;}
  }
}
