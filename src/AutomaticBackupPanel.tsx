import { useEffect, useState } from 'react';
import { CloudUpload, FolderOpen, Save, Upload } from 'lucide-react';

type BackupSettings = {
  enabled:boolean; folder:string; frequency:'daily'|'weekly'|'monthly'; time:string;
  weekday:number; monthDay:number; hasKey:boolean; running:boolean;
  nextRun:string|null; lastSuccess:string|null; lastFile:string|null;
  lastError:string; retryAt:string|null;
};
type Props = { settings:BackupSettings; busy:boolean; unlocked:boolean; onUnlock:()=>void; act:(fn:()=>Promise<any>,message?:string)=>Promise<void> };
const format = (date:string) => new Date(date).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});
const call = (command:string,arg?:unknown) => window.anchor.call(command,arg);

export function AutomaticBackupPanel({settings,busy,unlocked,onUnlock,act}:Props) {
  const [enabled,setEnabled]=useState(settings.enabled),[folder,setFolder]=useState(settings.folder);
  const [frequency,setFrequency]=useState(settings.frequency),[time,setTime]=useState(settings.time);
  const [weekday,setWeekday]=useState(settings.weekday),[monthDay,setMonthDay]=useState(settings.monthDay);
  const [password,setPassword]=useState('');
  useEffect(()=>{if(!unlocked)setPassword('');},[unlocked]);
  const dirty=enabled!==settings.enabled||folder!==settings.folder||frequency!==settings.frequency||time!==settings.time||weekday!==settings.weekday||monthDay!==settings.monthDay||password!=='';
  return <section className="panel settings-panel">
    <div className="section-title"><CloudUpload size={20}/><h2>Backup otomatis ke storage eksternal</h2>
      <span className={'badge '+(settings.enabled?'green':'neutral')}>{settings.running?'Membuat file…':settings.enabled?'Terjadwal':'Nonaktif'}</span>
    </div>
    <p className="muted">Pilih folder yang disinkronkan Google Drive for desktop, atau folder di drive eksternal. Anchor membuat file terenkripsi; Google Drive menangani upload ke cloud.</p>
    <form onSubmit={e=>{
      e.preventDefault();
      if(!unlocked){onUnlock();return;}
      void act(async()=>{await call('saveAutomaticBackup',{enabled,folder,frequency,time,weekday,monthDay,password});setPassword('');},'Pengaturan backup otomatis disimpan');
    }}>
      <label className="checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>Aktifkan backup otomatis</label>
      <label>Folder tujuan<input aria-label="Folder tujuan backup" readOnly value={folder} placeholder="Pilih folder Google Drive / drive eksternal"/></label>
      <div className="button-row"><button type="button" className="secondary" disabled={busy||settings.running||!enabled} onClick={()=>{
        if(!unlocked){onUnlock();return;}
        void act(async()=>{const selected=await call('pickBackupFolder');if(selected)setFolder(selected);});
      }}><FolderOpen size={16}/>Pilih folder</button></div>
      <div className="form-grid">
        <label>Frekuensi backup<select disabled={!enabled} value={frequency} onChange={e=>setFrequency(e.target.value as BackupSettings['frequency'])}>
          <option value="daily">Setiap hari</option><option value="weekly">Setiap minggu</option><option value="monthly">Setiap bulan</option>
        </select></label>
        <label>Jam backup (waktu lokal)<input type="time" required={enabled} disabled={!enabled} value={time} onChange={e=>setTime(e.target.value)}/></label>
      </div>
      {frequency==='weekly'&&<label>Hari backup<select disabled={!enabled} value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>
        {['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'].map((day,index)=><option key={day} value={index}>{day}</option>)}
      </select></label>}
      {frequency==='monthly'&&<><label>Tanggal backup<input type="number" min={1} max={31} required={enabled} disabled={!enabled} value={monthDay} onChange={e=>setMonthDay(Number(e.target.value))}/></label>
        <p className="form-hint">Tanggal 29–31 memakai hari terakhir jika bulan tersebut lebih pendek.</p></>}
      {enabled&&<label>Master password vault{settings.hasKey?' (isi hanya untuk memperbarui kunci)':''}
        <input type="password" autoComplete="current-password" maxLength={1024} disabled={!unlocked} required={unlocked&&!settings.hasKey} value={password} onChange={e=>setPassword(e.target.value)} placeholder={settings.hasKey?'Kosongkan untuk memakai kunci tersimpan':'Diperlukan sekali saat mengaktifkan'}/>
      </label>}
      <p className="form-hint">Backup otomatis dipulihkan memakai master password vault saat backup dibuat. Master password tidak disimpan. Backup tetap berjalan saat vault terkunci; credential tidak dibuka oleh proses backup.</p>
      <p className="form-hint">Saat diaktifkan, backup pertama langsung dibuat. Berikutnya mengikuti jadwal selama Anchor berjalan dan PC aktif. Jadwal yang terlewat dijalankan sekali saat aplikasi aktif kembali. Backup lama tetap disimpan.</p>
      <div className="button-row">
        <button className="primary" disabled={busy||settings.running}><Save size={16}/>{unlocked?'Simpan backup otomatis':'Buka vault untuk mengatur'}</button>
        <button type="button" className="secondary" disabled={busy||settings.running||!settings.enabled||dirty} title="Menggunakan pengaturan yang sudah disimpan" onClick={()=>act(()=>call('automaticBackupNow'),'File backup dibuat di folder tujuan; periksa Google Drive untuk status upload')}><Upload size={16}/>Backup sekarang</button>
      </div>
    </form>
    <div className="data-path">
      <span>STATUS FILE DI FOLDER TUJUAN</span>
      <p className="muted">Backup berhasil terakhir: {settings.lastSuccess?format(settings.lastSuccess):'Belum ada'}</p>
      <p className="muted">Jadwal berikutnya: {settings.enabled&&settings.nextRun?format(settings.nextRun):'Nonaktif'}</p>
      {settings.lastFile&&<code>{settings.lastFile}</code>}
      <p className="form-hint">File lokal berhasil dibuat bukan konfirmasi upload selesai. Periksa status sinkronisasi di Google Drive for desktop.</p>
    </div>
    {settings.lastError&&<div role="alert" className="inline-error">{settings.lastError}{settings.retryAt&&` Dicoba lagi ${format(settings.retryAt)}.`}</div>}
  </section>;
}
