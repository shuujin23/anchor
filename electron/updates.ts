import { app, dialog } from 'electron';
import { autoUpdater } from 'electron-updater';

// The feed is embedded by electron-builder; never accept a URL from the renderer.
export function createUpdates(beforeInstall:()=>void) {
  let checking=false, downloading=false, downloaded=false, available=false;
  let status='Belum diperiksa', version='', progress=0;
  autoUpdater.autoDownload=false;
  autoUpdater.autoInstallOnAppQuit=false;
  autoUpdater.allowDowngrade=false;
  autoUpdater.allowPrerelease=false;
  const state=()=>({status,version,progress,checking,downloading,downloaded,available,currentVersion:app.getVersion(),supported:app.isPackaged});
  const install=()=>{
    if(!downloaded) throw new Error('Download update belum selesai.');
    beforeInstall();
    autoUpdater.quitAndInstall(false,true);
  };
  const download=async()=>{
    if(downloading||downloaded)return;
    if(!available)throw new Error('Periksa versi terbaru terlebih dahulu.');
    downloading=true;progress=0;status='Mengunduh update';
    try { await autoUpdater.downloadUpdate(); }
    catch { status='Download gagal. Periksa koneksi lalu coba lagi.'; }
    finally { downloading=false; }
  };
  autoUpdater.on('error',()=>{status='Update gagal. Periksa koneksi dan ketersediaan rilis GitHub.';});
  autoUpdater.on('download-progress',p=>{progress=Math.round(p.percent);});
  autoUpdater.on('update-downloaded',info=>{
    downloaded=true;available=true;version=info.version;status='Update siap diinstal';progress=100;
    void dialog.showMessageBox({type:'info',title:'Update Anchor siap',message:`Anchor ${version} siap diinstal.`,detail:'Anchor akan ditutup dan dibuka kembali. Data credential, reminder, dan pengaturan tetap disimpan.',buttons:['Install & restart','Nanti'],defaultId:0,cancelId:1}).then(r=>{if(r.response===0)install();}).catch(()=>{});
  });
  const check=async(manual=false)=>{
    if(!app.isPackaged){status='Pemeriksaan tersedia pada aplikasi yang diinstal.';return state();}
    if(checking||downloading||downloaded)return state();
    checking=true;status='Memeriksa update';
    try {
      const result=await autoUpdater.checkForUpdates();
      if(result?.isUpdateAvailable){
        available=true;version=result.updateInfo.version;status='Versi baru tersedia';
        const notes=result.updateInfo.releaseNotes;
        const detail=typeof notes==='string'?notes.replace(/<[^>]*>/g,'').slice(0,2500):'Download update langsung dari GitHub Releases.';
        const answer=await dialog.showMessageBox({type:'info',title:'Update Anchor',message:`Anchor ${version} tersedia.`,detail,buttons:['Download update','Nanti'],defaultId:0,cancelId:1});
        if(answer.response===0)await download();
      } else {
        available=false;status='Sudah memakai versi terbaru';
        if(manual)await dialog.showMessageBox({type:'info',title:'Update Anchor',message:status,buttons:['OK']});
      }
    } catch {status='Gagal memeriksa update. Pastikan repository dan rilis tersedia serta koneksi aktif.';}
    finally {checking=false;}
    return state();
  };
  return {state,check,download,install};
}
