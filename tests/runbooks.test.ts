import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../electron/store';
const root=path.resolve(process.env.ANCHOR_TEST_ROOT||'.test-data');fs.mkdirSync(root,{recursive:true});
async function fixture(){const dir=fs.mkdtempSync(path.join(root,'runbook-'));const s=new Store(path.join(dir,'anchor.db'));await s.open();s.setup('runbook-master-password');s.saveCredential({title:'VPS Production',username:'root',url:'10.0.0.7',password:'secret',notes:'',category:'Server'});return {s,dir};}
const runbook=(credentialId='credential')=>({title:'Start Production',category:'Recovery',description:'Setelah server reboot',credentialIds:[credentialId],steps:[{id:'db',title:'Periksa database',type:'command',content:'systemctl status mysql'},{id:'app',title:'Jalankan aplikasi',type:'command',content:'docker compose up -d'},{id:'health',title:'Periksa health',type:'url',content:'https://app.example.test/health'}]});

test('runbooks are encrypted, validate input, persist and keep session snapshots',async()=>{
 const {s}=await fixture(),credentialId=s.credentials()[0].id;const id=s.saveRunbook(runbook(credentialId));
 const bytes=fs.readFileSync(s.file);assert.equal(bytes.includes(Buffer.from('docker compose up -d')),false);assert.equal(bytes.includes(Buffer.from('Start Production')),false);
 assert.equal(s.runbooks()[0].credentialIds[0],credentialId);assert.throws(()=>s.saveRunbook({...runbook(),steps:[]}));assert.throws(()=>s.saveRunbook({...runbook(),steps:[{id:'x',title:'A',type:'evil',content:''}]}));
 const sessionId=s.startRunbook(id);assert.equal(s.startRunbook(id),sessionId);
 s.saveRunbook({...s.runbook(id),title:'Start Production v2',steps:[{id:'new',title:'New',type:'instruction',content:''}]});
 assert.equal(s.runbookSession(sessionId).title,'Start Production');assert.equal(s.runbookSession(sessionId).steps.length,3);
 const reopened=new Store(s.file);await reopened.open();reopened.unlock('runbook-master-password');assert.equal(reopened.runbookSession(sessionId).status,'running');
});

test('runbook session supports done, skipped, failed, notes, reset and completion history',async()=>{
 const {s}=await fixture();const id=s.saveRunbook(runbook());const sessionId=s.startRunbook(id);
 s.runbookSessionAction({id:sessionId,action:'step',stepId:'db',status:'done',note:'MySQL active'});
 s.runbookSessionAction({id:sessionId,action:'step',stepId:'app',status:'skipped',note:'already running'});
 assert.throws(()=>s.runbookSessionAction({id:sessionId,action:'complete'}));
 s.runbookSessionAction({id:sessionId,action:'step',stepId:'health',status:'failed',note:'HTTP 503'});
 s.runbookSessionAction({id:sessionId,action:'complete'});const done=s.runbookSession(sessionId);assert.equal(done.status,'completed');assert.ok(done.finishedAt);assert.throws(()=>s.runbookSessionAction({id:sessionId,action:'reset'}));
 const second=s.startRunbook(id);s.runbookSessionAction({id:second,action:'step',stepId:'db',status:'done',note:''});s.runbookSessionAction({id:second,action:'reset'});assert.ok(s.runbookSession(second).steps.every(x=>x.status==='pending'));s.runbookSessionAction({id:second,action:'abandon'});assert.equal(s.runbookSession(second).status,'abandoned');
 s.removeRunbook(id);assert.equal(s.runbooks().length,0);assert.equal(s.runbookSessions().length,2);
});

test('manual backup restores encrypted runbooks and sessions without overwriting existing IDs',async()=>{
 const {s,dir}=await fixture();const id=s.saveRunbook(runbook());const sessionId=s.startRunbook(id);s.runbookSessionAction({id:sessionId,action:'step',stepId:'db',status:'done',note:'ok'});
 const content=s.exportBackup('runbook-backup-password');assert.equal(content.includes('systemctl status mysql'),false);assert.equal(JSON.parse(content).version,4);
 const target=new Store(path.join(dir,'target.db'));await target.open();target.setup('different-target-password');target.importBackup(content,'runbook-backup-password');
 assert.equal(target.runbook(id).steps[0].content,'systemctl status mysql');assert.equal(target.runbookSession(sessionId).steps[0].note,'ok');
 target.saveRunbook({...target.runbook(id),title:'Local title'});target.importBackup(content,'runbook-backup-password');assert.equal(target.runbook(id).title,'Local title');
});
