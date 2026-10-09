import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../electron/store';
import { License, verifyLicense } from '../electron/license';
import { SheetsSync } from '../electron/sheets-sync';
import { GoogleSheets, SheetRow, SheetTarget, sheetDate, parseCredential, spreadsheetId } from '../electron/google-sheets';
const id='a'.repeat(30),target:SheetTarget={spreadsheetId:id,sheetId:0,pic:'Ujun',timeZone:'Asia/Jakarta'};
const pair=generateKeyPairSync('rsa',{modulusLength:2048}),credential=JSON.stringify({type:'service_account',client_email:'anchor@test.iam.gserviceaccount.com',private_key:pair.privateKey.export({type:'pkcs8',format:'pem'}).toString()});
async function fixture(){
 const root=path.resolve(process.env.ANCHOR_TEST_ROOT||'.test-data');fs.mkdirSync(root,{recursive:true});const store=new Store(path.join(fs.mkdtempSync(path.join(root,'sheets-')),'anchor.db'));await store.open();store.setup('sheets master password');
 let active=true;const license={state:()=>({active,name:'Test'}),require:()=>{if(!active)throw Error('Activation required');}} as License;
 const rows=new Map<string,SheetRow>();let failure=false,dropResponse=false,calls=0;
 const api={inspect:async()=>({title:'Work',timeZone:'Asia/Jakarta',sheets:[{id:0,title:'Ujun'},{id:1,title:'Other'}]}),upsert:async(_t:SheetTarget,row:SheetRow,_known:boolean,allowed:()=>boolean)=>{calls++;if(failure)throw Error('Offline');if(allowed())rows.set(row.taskId,row);if(dropResponse){dropResponse=false;throw Error('Lost response');}}};
 const protection={seal:(s:string)=>Buffer.from(s).toString('base64'),unseal:(s:string)=>Buffer.from(s,'base64').toString()};
 const sync=new SheetsSync(store,license,protection,()=>api);
 sync.importCredential(credential);await sync.configure({...target,enabled:true});
 const task={title:'Work',kind:'task',mode:'deadline',notes:'notes',amount:0,currency:'IDR',due:'2026-10-10T00:00:00Z',recurrence:'once',every:1,unit:'days',leadMinutes:0,repeatMinutes:0,windows:true,discord:false};
 return {store,sync,rows,task,license,protection,api,calls:()=>calls,setActive:(v:boolean)=>{active=v;},setFailure:(v:boolean)=>{failure=v;},drop:()=>{dropResponse=true;}};
}
test('signed license accepts genuine feature keys and rejects tampering, other features and malformed input',()=>{
 const pair=generateKeyPairSync('ed25519'),pub=pair.publicKey.export({type:'spki',format:'pem'}).toString();
 const issue=(feature:string)=>{const payload=Buffer.from(JSON.stringify({v:1,feature,id:'owner',name:'Owner'})).toString('base64url');return 'ANCHOR1.'+payload+'.'+sign(null,Buffer.from(payload),pair.privateKey).toString('base64url');};
 const key=issue('google-sheets-sync');assert.equal(verifyLicense(key,pub)?.name,'Owner');assert.equal(verifyLicense(key.replace('ANCHOR1','ANCHOR2'),pub),null);assert.equal(verifyLicense(issue('other-feature'),pub),null);assert.equal(verifyLicense(key+'.extra',pub),null);assert.equal(verifyLicense(123,pub),null);assert.equal(verifyLicense(key),null);
});
test('activation enforced in backend; unselected tasks and bills are not uploaded',async()=>{
 const f=await fixture();f.setActive(false);
 assert.throws(()=>f.store.saveReminder({...f.task,syncToSheets:true}));assert.throws(()=>f.sync.importCredential(credential));await assert.rejects(f.sync.inspect(id));await assert.rejects(f.sync.run(true));
 f.store.saveReminder(f.task);await f.sync.run();assert.equal(f.calls(),0);
 f.setActive(true);await assert.rejects(f.sync.configure({...target,sheetId:999,enabled:true}));assert.throws(()=>f.store.saveReminder({...f.task,kind:'bill',syncToSheets:true}));
 await f.sync.run();assert.equal(f.calls(),0);
});
test('note task sync updates one row, captures created date and actual hours, and preserves destination across default changes',async()=>{
 const f=await fixture();f.store.saveReminder({...f.task,mode:'note',syncToSheets:true});const r=f.store.reminders()[0];assert.equal(r.nextNotify,null);await f.sync.run();assert.equal(f.rows.size,1);assert.equal(f.rows.get(r.id)!.hours,null);assert.equal(f.rows.get(r.id)!.date,sheetDate(r.createdAt,'Asia/Jakarta'));
 f.store.action(r.id,'complete',30,2.5);await f.sync.run();assert.equal(f.rows.size,1);assert.equal(f.rows.get(r.id)!.hours,2.5);assert.equal(f.sync.statuses()[r.id].status,'Tersinkron');
 await f.sync.configure({...target,sheetId:1,enabled:true});f.store.saveReminder({...f.store.reminders()[0],notes:'new note'});assert.equal(f.store.reminders()[0].sheetTarget!.sheetId,0);await f.sync.run();assert.equal(f.rows.get(r.id)!.notes,'new note');
 f.store.remove('reminders',r.id);await f.sync.run();assert.equal(f.rows.size,1);
});
test('offline changes persist across restart, retry avoids duplicates after lost acknowledgement, pause and opt-out stop writes',async()=>{
 const f=await fixture();f.store.saveReminder({...f.task,syncToSheets:true});const r=f.store.reminders()[0];f.setFailure(true);await f.sync.run();assert.equal(f.sync.statuses()[r.id].status,'Gagal');const calls=f.calls();await f.sync.run();assert.equal(f.calls(),calls);
 const reopened=new Store(f.store.file);await reopened.open();const sync=new SheetsSync(reopened,f.license,f.protection,()=>f.api);f.setFailure(false);f.drop();await sync.run(true);assert.equal(f.rows.size,1);await sync.run(true);assert.equal(f.rows.size,1);assert.equal(sync.statuses()[r.id].status,'Tersinkron');
 reopened.saveReminder({...reopened.reminders()[0],notes:'paused'});sync.pause();await sync.run(true);assert.equal(f.rows.get(r.id)!.notes,'notes');
 reopened.saveReminder({...reopened.reminders()[0],syncToSheets:false});assert.deepEqual(sync.statuses(),{});
});
test('backup restore never silently enables outgoing sync or carries Google credentials',async()=>{
 const f=await fixture();f.store.saveReminder({...f.task,syncToSheets:true});const backup=f.store.exportBackup('backup sheets password');const other=await fixture();other.store.importBackup(backup,'backup sheets password');const restored=other.store.reminders()[0];assert.equal(restored.syncToSheets,false);assert.equal(restored.sheetTarget,undefined);
});
test('previous mapping is resynced once into Detail Task without requiring a task edit',async()=>{
 const f=await fixture();f.store.saveReminder({...f.task,mode:'note',syncToSheets:true});const r=f.store.reminders()[0];
 const oldRow={taskId:r.id,title:r.title,date:sheetDate(r.createdAt,target.timeZone),hours:null,notes:r.notes};
 f.store.transaction(()=>f.store.set('sheets.task:'+id+':'+r.id,JSON.stringify({hash:createHash('sha256').update(JSON.stringify(oldRow)).digest('hex'),lastSync:new Date().toISOString()})));
 assert.equal(f.sync.statuses()[r.id].status,'Menunggu');await f.sync.run();assert.equal(f.calls(),1);assert.equal(f.rows.get(r.id)!.notes,r.notes);
 await f.sync.run();assert.equal(f.calls(),1);assert.equal(f.sync.statuses()[r.id].status,'Tersinkron');
});
test('Google date conversion uses sheet timezone and credential input cannot redirect endpoints',()=>{
 assert.equal(sheetDate('2026-10-08T18:00:00Z','Asia/Jakarta'),sheetDate('2026-10-09T10:00:00Z','Asia/Jakarta'));
 assert.equal(spreadsheetId('https://docs.google.com/spreadsheets/d/'+id+'/edit'),id);assert.throws(()=>spreadsheetId('https://evil.example/'));
 assert.equal(parseCredential(credential).client_email,'anchor@test.iam.gserviceaccount.com');assert.throws(()=>parseCredential('{}'));
});
test('Google API atomically inserts metadata with row, retries by identity, uses RAW updates and protects manual headers',async()=>{
 const bodies:any[]=[];let exists=false,wrongHeader=false;
 const http=(async(url:any,init:any)=>{
  const u=String(url),body=init?.body;let result:any={};
  if(u.includes('oauth2'))result={access_token:'TEST_TOKEN'};
  else if(u.includes('?fields='))result={properties:{title:'Work',timeZone:'Asia/Jakarta'},sheets:[{properties:{sheetId:0,title:'Ujun',sheetType:'GRID'}}]};
  else if(u.includes('/values/'))result={values:[[wrongHeader?'Oops':'No.','Task','Detail Task','Tanggal Mengerjakan','Manhours','Catatan']]};
  else if(u.endsWith('/developerMetadata:search'))result={matchedDeveloperMetadata:exists?[{developerMetadata:{metadataId:10,location:{dimensionRange:{sheetId:0,dimension:'ROWS',startIndex:3,endIndex:4}}}}]:[]};
  else{bodies.push(JSON.parse(body));exists=true;}
  return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 const client=new GoogleSheets(parseCredential(credential),http),row={taskId:'unique-task',title:'=DANGEROUS()',date:46000,hours:null,notes:'+formula'};
 await client.upsert(target,row,false,()=>true);assert.equal(bodies[0].requests.length,3);assert.equal(bodies[0].requests[1].updateCells.rows[0].values[1].userEnteredValue.stringValue,row.title);assert.equal(bodies[0].requests[2].createDeveloperMetadata.developerMetadata.metadataValue,row.taskId);
 const inserted=bodies[0].requests[1].updateCells.rows[0].values;
 assert.equal(inserted.length,5);assert.equal(inserted[2].userEnteredValue.stringValue,row.notes);assert.equal(inserted[3].userEnteredValue.numberValue,row.date);
 await client.upsert(target,{...row,hours:0},false,()=>true);assert.equal(bodies[1].valueInputOption,'RAW');assert.equal(bodies[1].data[0].values[0][4],0);assert.equal(bodies[1].data[0].dataFilter.developerMetadataLookup.metadataId,10);
 assert.deepEqual(bodies[1].data[0].values[0],[null,row.title,row.notes,row.date,0]); // F is absent, so manual Catatan is untouched.
 wrongHeader=true;await assert.rejects(client.upsert(target,row,true,()=>true));assert.equal(bodies.length,2);
 wrongHeader=false;exists=false;await assert.rejects(client.upsert(target,row,true,()=>true));assert.equal(bodies.length,2);
 await client.upsert(target,row,false,()=>false);assert.equal(bodies.length,2);
});
