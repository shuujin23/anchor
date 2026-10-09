import React, {useEffect,useState} from 'react';
const api=(command:string,arg?:unknown)=>window.anchor.call(command,arg);
export function SheetsPanel({state,busy,act,unlocked,onUnlock}:any){
  const [key,setKey]=useState(''),[url,setUrl]=useState(''),[pic,setPic]=useState(''),[info,setInfo]=useState<any>(null);
  useEffect(()=>{if(state?.config){setUrl(state.config.spreadsheetId);setPic(String(state.config.sheetId));setInfo(null);}},[state?.config?.spreadsheetId,state?.config?.sheetId]);
  if(!state)return null;
  if(!state.license.active)return <section className="panel settings-panel"><h2>Aktivasi fitur</h2><p className="form-hint">Masukkan key aktivasi untuk membuka Google Sheets Sync.</p><label>Key aktivasi<textarea rows={2} value={key} onChange={e=>setKey(e.target.value)} maxLength={4096} autoComplete="off"/></label><div className="button-row"><button className="secondary" disabled={busy||!key.trim()} onClick={()=>act(async()=>{await api('activateSheets',{key});setKey('');},'Fitur diaktifkan')}>Aktifkan</button><button className="secondary" disabled={busy} onClick={()=>act(async()=>{await api('importSheetsLicense');})}>Pilih file key</button></div></section>;
  const options=info?.sheets ?? (state.config?[{id:state.config.sheetId,title:state.config.pic}]:[]);
  const tasks=Object.values(state.tasks ?? {}) as any[];
  return <section className="panel settings-panel"><h2>Google Sheets Sync</h2><p className="form-hint">Aktif untuk {state.license.name}. Satu task menjadi satu baris. Tanggal memakai tanggal dibuat dan manhours memakai aktual.</p>
    {!unlocked&&<button className="secondary" onClick={onUnlock}>Buka vault untuk mengatur koneksi</button>}
    <div className="button-row"><button className="secondary" disabled={busy||!unlocked||state.busy} onClick={()=>act(async()=>{await api('importSheetsCredential');setInfo(null);})}>{state.hasCredential?'Ganti JSON credential':'Pilih JSON credential Google'}</button></div>
    <p className="form-hint">{state.hasCredential?'Credential tersimpan terenkripsi di perangkat ini.':'Gunakan JSON service account yang memiliki izin Editor pada spreadsheet.'}</p>
    <label>URL atau ID Google Sheet<input value={url} maxLength={500} placeholder="https://docs.google.com/spreadsheets/d/…" onChange={e=>{setUrl(e.target.value);setInfo(null);setPic('');}}/></label>
    <div className="button-row"><button className="secondary" disabled={busy||!state.hasCredential||!url.trim()} onClick={()=>act(async()=>{const result=await api('inspectSheets',{spreadsheetId:url});setInfo(result);setPic('');},'Daftar PIC dimuat')}>Muat daftar PIC</button></div>
    <label>PIC default<select value={pic} onChange={e=>setPic(e.target.value)}><option value="">Pilih tab PIC</option>{options.map((s:any)=><option key={s.id} value={s.id}>{s.title}</option>)}</select></label>
    {info&&<p className="form-hint">{info.title} · {info.timeZone}</p>}
    <p className="form-hint">Tab harus memiliki kolom: No., Task, Tanggal Mengerjakan, Manhours, Catatan. Mengubah PIC default hanya berlaku untuk task yang baru diikutkan sync. Baris manual tetap dipertahankan.</p>
    <div className="button-row"><button className="primary" disabled={busy||state.busy||!unlocked||pic===''} onClick={()=>act(()=>api('configureSheets',{spreadsheetId:url,sheetId:Number(pic),enabled:true}),'Pengaturan sync disimpan')}>Simpan & aktifkan sync</button>{state.config?.enabled&&<button className="secondary" disabled={busy} onClick={()=>act(()=>api('pauseSheets'),'Sync dijeda')}>Jeda sync</button>}<button className="secondary" disabled={busy||state.busy||!state.config?.enabled} onClick={()=>act(()=>api('syncSheetsNow'))}>{state.busy?'Menyinkronkan…':'Sync sekarang'}</button></div>
    <p className="form-hint">{state.config?.enabled?'Otomatis diperiksa setiap 15 detik saat aplikasi berjalan.':'Sync belum aktif atau sedang dijeda.'} {tasks.filter(t=>t.status==='Tersinkron').length} tersinkron · {tasks.filter(t=>t.status==='Menunggu').length} menunggu · {tasks.filter(t=>t.status==='Gagal').length} gagal.</p>
    {tasks.find(t=>t.error)&&<p role="alert" className="inline-error">{tasks.find(t=>t.error).error}</p>}
    <p className="form-hint">Baris hasil sync dikelola Anchor. Edit melalui Anchor agar perubahan konsisten. Menghapus task atau mematikan sync tidak menghapus baris Google Sheet.</p>
    <button className="text-button" disabled={busy||state.busy} onClick={()=>act(()=>api('deactivateSheets'),'Aktivasi dinonaktifkan; baris Google Sheet tetap disimpan')}>Nonaktifkan aktivasi di perangkat ini</button>
  </section>;
}
