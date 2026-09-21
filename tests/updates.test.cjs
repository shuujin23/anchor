const test=require('node:test'),assert=require('node:assert/strict');
const Module=require('node:module'),{EventEmitter}=require('node:events');
test('updater requires consent, handles errors and only installs downloaded files',async()=>{
  const updater=new EventEmitter();let downloads=0,installs=0,prepared=0;
  updater.checkForUpdates=async()=>({isUpdateAvailable:true,updateInfo:{version:'1.5.0',releaseNotes:'Test release'}});
  updater.downloadUpdate=async()=>{downloads++;};updater.quitAndInstall=()=>{installs++;};
  const answers=[1,0,1],dialogs=[];
  const electron={app:{isPackaged:true,getVersion:()=> '1.4.0'},dialog:{showMessageBox:async options=>{dialogs.push(options);return {response:answers.shift()??1};}}};
  const original=Module._load;
  Module._load=function(id,...args){if(id==='electron')return electron;if(id==='electron-updater')return {autoUpdater:updater};return original.call(this,id,...args);};
  let createUpdates;try{({createUpdates}=require('../electron/updates.ts'));}finally{Module._load=original;}
  const service=createUpdates(()=>{prepared++;});
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);assert.equal(updater.allowDowngrade,false);
  assert.throws(()=>service.install());
  await service.check();assert.equal(downloads,0);assert.equal(service.state().available,true);
  await service.check(true);assert.equal(downloads,1);assert.equal(installs,0);
  updater.emit('download-progress',{percent:48.4});assert.equal(service.state().progress,48);
  updater.emit('update-downloaded',{version:'1.5.0'});await Promise.resolve();assert.equal(installs,0);
  service.install();assert.equal(installs,1);assert.equal(prepared,1);
  assert.equal(service.state().downloaded,true);
  updater.emit('error',new Error('network'));assert.match(service.state().status,/gagal/);
  assert.equal(dialogs.length,3);
});
