import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, dialog, clipboard, safeStorage, powerMonitor, session, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomInt } from 'node:crypto';
import { Store } from './store';
import { deliverDue } from './scheduler';
import { AutomaticBackup } from './automatic-backup';
import { createUpdates } from './updates';

app.setName('Anchor');
app.setPath('userData', process.env.ANCHOR_DATA_DIR ? path.resolve(process.env.ANCHOR_DATA_DIR) : path.join(app.getPath('appData'),'Anchor'));
app.setAppUserModelId('local.anchor.desktop');
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
let win: BrowserWindow | null = null, tray: Tray, store: Store, quitting = false, ticking = false;
let automaticBackup: AutomaticBackup;
let updates: ReturnType<typeof createUpdates>;
let clipboardTimer: NodeJS.Timeout | undefined, ownedClipboard: string | null = null;
let lastUnlock = 0;
const indexUrl = pathToFileURL(path.join(__dirname,'../dist/index.html')).href;
const show = () => { win?.show(); win?.focus(); };
const clearClipboard = async () => { const expected = ownedClipboard; ownedClipboard = null; if (expected !== null && await clipboard.readText() === expected) clipboard.clear(); };
function lock() { store.lock(); void clearClipboard().catch(()=>{}); win?.webContents.send('vault-locked'); }
function settings() { return { updates:updates.state(),automaticBackup:automaticBackup.settings(),autoStart:app.isPackaged ? app.getLoginItemSettings({args:['--hidden']}).openAtLogin : false, packaged:app.isPackaged, autoLockMinutes:Number(store.get('autoLockMinutes') || 5), hasWebhook:!!store.get('webhook'), dataPath:store.file, lastDeliveryError:store.get('lastDeliveryError') || '', timezone:Intl.DateTimeFormat().resolvedOptions().timeZone }; }
function webhook() {
  const value = store.get('webhook'); if (!value) throw new Error('Discord webhook belum diatur.');
  try { return safeStorage.decryptString(Buffer.from(value,'base64')); } catch { throw new Error('Webhook tidak bisa dibuka di akun Windows ini. Atur ulang webhook.'); }
}
function validWebhook(value: string) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'discord.com' && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname); } catch { return false; }
}
async function sendDiscord(content: string) {
  const url = webhook(); if (!validWebhook(url)) throw new Error('URL webhook tidak valid.');
  try {
    const response = await fetch(url + '?wait=true',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('Discord HTTP ' + response.status);
  } catch (error) { if (error instanceof Error && /^Discord HTTP \d+$/.test(error.message)) throw error; throw new Error('Discord tidak terhubung. Periksa internet atau webhook.'); }
}
function notify(title: string, body: string) {
  if (!Notification.isSupported()) throw new Error('Notifikasi Windows tidak tersedia.');
  const n = new Notification({title,body,icon:path.join(__dirname,'../assets/icon.png')});
  n.on('click',show);
  n.on('failed',() => { store.set('lastDeliveryError','Windows menolak notifikasi. Periksa pengaturan notifikasi dan instal aplikasi melalui installer.'); store.persist(); });
  n.show();
}
async function tick() {
  if (ticking || !store) return; ticking = true;
  try {
    const now = new Date();
    if (store.key && Date.now() - store.lastActivity > Number(store.get('autoLockMinutes') || 5) * 60000) lock();
    await deliverDue(store, notify, sendDiscord, now);
  } catch { /* Retain due state; a failed database write must not mark delivery complete. */ }
  finally { ticking = false; }
}
function register() {
  const handlers: Record<string,(arg: any) => any> = {
    checkUpdates:() => updates.check(true),
    downloadUpdate:() => updates.download(),
    installUpdate:() => updates.install(),
    status:() => ({initialized:!!store.get('salt'),unlocked:!!store.key}),
    setup:(arg) => store.setup(arg.password),
    unlock:(arg) => { if (Date.now() - lastUnlock < 1500) throw new Error('Tunggu sebentar sebelum mencoba lagi.'); lastUnlock = Date.now(); store.unlock(arg.password); },
    lock:() => lock(),
    activity:() => { if (store.key) store.lastActivity = Date.now(); },
    credentials:() => store.credentials(),
    credential:(arg) => store.credential(arg.id),
    saveCredential:(arg) => store.saveCredential(arg),
    deleteCredential:(arg) => store.remove('credentials',arg.id),
    copySecret:async (arg) => {
      clearTimeout(clipboardTimer); await clearClipboard();
      const c = store.credential(arg.id);
      ownedClipboard = c.password; await clipboard.writeText(c.password);
      clipboardTimer = setTimeout(() => void clearClipboard().catch(()=>{}),30000);
    },
    generatePassword:() => { store.requireKey(); const groups = ['ABCDEFGHJKLMNPQRSTUVWXYZ','abcdefghijkmnopqrstuvwxyz','23456789','!@#$%&*-_=+']; const chars = groups.join(''); const result = groups.map(g => g[randomInt(g.length)]); while (result.length < 24) result.push(chars[randomInt(chars.length)]); for (let i = result.length - 1; i > 0; i--) { const j = randomInt(i + 1); [result[i],result[j]] = [result[j],result[i]]; } return result.join(''); },
    reminders:() => store.reminders(),
    saveReminder:(arg) => { if (arg.discord && !store.get('webhook')) throw new Error('Atur Discord webhook di Pengaturan terlebih dahulu.'); store.saveReminder(arg); },
    reminderAction:(arg) => store.action(arg.id,arg.action,arg.minutes),
    deleteReminder:(arg) => store.remove('reminders',arg.id),
    history:() => store.history(),
    settings:() => settings(),
    pickBackupFolder:async () => {
      store.requireKey();
      const result=await dialog.showOpenDialog(win!,{title:'Pilih folder Google Drive atau storage eksternal',defaultPath:automaticBackup.settings().folder || undefined,properties:['openDirectory','createDirectory']});
      return result.canceled ? null : result.filePaths[0];
    },
    saveAutomaticBackup:async (arg) => {
      await automaticBackup.configure(arg);
      void automaticBackup.runDue().catch(()=>{});
    },
    automaticBackupNow:async () => {
      const result=await automaticBackup.runNow();
      if (!result.ok) throw new Error(result.error || 'Backup gagal.');
      return result.file;
    },
    saveSettings:(arg) => {
      if (![1,5,15,30].includes(arg.autoLockMinutes) || typeof arg.autoStart !== 'boolean') throw new Error('Pengaturan tidak valid.');
      if (arg.webhook !== undefined && arg.webhook !== '') {
        store.requireKey();
        if (typeof arg.webhook !== 'string' || !validWebhook(arg.webhook)) throw new Error('Gunakan URL https://discord.com/api/webhooks/ID/TOKEN.');
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Enkripsi Windows tidak tersedia.');
        store.set('webhook',safeStorage.encryptString(arg.webhook).toString('base64'));
      }
      if (arg.removeWebhook) { store.requireKey(); store.set('webhook',''); }
      store.set('autoLockMinutes',String(arg.autoLockMinutes)); store.persist();
      if (app.isPackaged) app.setLoginItemSettings({openAtLogin:arg.autoStart,args:['--hidden']});
    },
    testWindows:() => notify('Anchor siap mengingatkan','Ini notifikasi tes. Klik untuk membuka Anchor.'),
    testDiscord:() => sendDiscord('Anchor terhubung. Reminder akan dikirim ke channel ini.'),
    exportBackup:async (arg) => {
      const content = store.exportBackup(arg.password);
      const result = await dialog.showSaveDialog(win!,{title:'Simpan backup terenkripsi',defaultPath:`Anchor-${new Date().toISOString().slice(0,10)}.anchor`,filters:[{name:'Anchor encrypted backup',extensions:['anchor']}]});
      if (result.canceled || !result.filePath) return false;
      fs.writeFileSync(result.filePath,content,{mode:0o600}); return true;
    },
    importBackup:async (arg) => {
      store.requireKey();
      if (typeof arg.password !== 'string' || arg.password.length > 1024) throw new Error('Password backup tidak valid.');
      const result = await dialog.showOpenDialog(win!,{title:'Pilih backup Anchor',filters:[{name:'Anchor encrypted backup',extensions:['anchor']}],properties:['openFile']});
      if (result.canceled) return false;
      if (fs.statSync(result.filePaths[0]).size > 50 * 1024 * 1024) throw new Error('Backup terlalu besar (maksimal 50 MB).');
      store.importBackup(fs.readFileSync(result.filePaths[0],'utf8'),arg.password); return true;
    }
  };
  ipcMain.handle('anchor',async (event,command,arg) => {
    if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== indexUrl || !Object.prototype.hasOwnProperty.call(handlers,command)) return {ok:false,error:'Permintaan ditolak.'};
    try { return {ok:true,data:await handlers[command](arg)}; }
    catch (error) { const message = (error as Error).message || ''; return {ok:false,error:/^(SQLITE|ENOENT|EACCES|EPERM|NOT NULL|UNIQUE)/.test(message) ? 'Data gagal disimpan. Periksa izin folder dan ruang disk.' : message.slice(0,300)}; }
  });
}
if (single) app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  if (app.isPackaged && process.platform === 'win32') {
    const shortcut=path.join(app.getPath('appData'),'Microsoft','Windows','Start Menu','Programs','Anchor.lnk');
    // AUMID on both the shortcut and app is required for Windows toast identity.
    if (fs.existsSync(path.dirname(shortcut))) shell.writeShortcutLink(shortcut,'create',{target:process.execPath,cwd:path.dirname(process.execPath),description:'Anchor · Personal vault and reminders',icon:process.execPath,iconIndex:0,appUserModelId:'local.anchor.desktop'});
  }
  store = new Store(path.join(app.getPath('userData'),'anchor.db')); await store.open();
  automaticBackup = new AutomaticBackup(store,{
    seal:(value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Penyimpanan kunci terenkripsi Windows tidak tersedia.');
      return safeStorage.encryptString(value).toString('base64');
    },
    unseal:(value) => safeStorage.decryptString(Buffer.from(value,'base64'))
  });
  session.defaultSession.setPermissionRequestHandler((_w,_p,callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  updates=createUpdates(()=>{quitting=true;lock();});
  register();
  win = new BrowserWindow({width:1280,height:850,minWidth:960,minHeight:700,title:'Anchor',backgroundColor:'#f6f7f9',icon:path.join(__dirname,'../assets/icon.png'),show:false,webPreferences:{preload:path.join(__dirname,'preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true,devTools:!app.isPackaged}});
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate',event => event.preventDefault());
  win.on('close',event => { if (!quitting) { event.preventDefault(); win?.hide(); lock(); } });
  await win.loadURL(indexUrl);
  if (!process.argv.includes('--hidden')) show();
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname,'../assets/icon.png')));
  tray.setToolTip('Anchor · Vault & Reminders');
  tray.setContextMenu(Menu.buildFromTemplate([{label:'Buka Anchor',click:show},{label:'Kunci vault',click:lock},{type:'separator'},{label:'Keluar (hentikan reminder)',click:() => app.quit()}]));
  tray.on('double-click',show);
  if(app.isPackaged){setTimeout(()=>void updates.check(),15000);setInterval(()=>void updates.check(),6*60*60*1000);}
  powerMonitor.on('lock-screen',lock); powerMonitor.on('suspend',lock); powerMonitor.on('resume',() => {void tick();void automaticBackup.runDue().catch(()=>{});});
  setInterval(() => void tick(),1000); void tick();
  setInterval(() => void automaticBackup.runDue().catch(()=>{}),60000);
  void automaticBackup.runDue().catch(()=>{});
}).catch(() => { dialog.showErrorBox('Anchor gagal dibuka','Database tidak bisa dibuka. Periksa izin folder data atau pulihkan backup.'); app.quit(); });
app.on('second-instance',show);
app.on('before-quit',() => { quitting = true; if (store) store.lock(); void clearClipboard().catch(()=>{}); });
app.on('window-all-closed',() => {});
