import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { AutomaticBackup, nextBackupTime } from '../electron/automatic-backup';
import { Store } from '../electron/store';
import { encrypt, decrypt } from '../electron/crypto';
const root=path.resolve(process.env.ANCHOR_TEST_ROOT||'.test-data');
const password='automatic-master-password';
const schedule={frequency:'daily' as const,time:'09:00',weekday:1,monthDay:31};
async function fixture(){
  await fs.mkdir(root,{recursive:true});const dir=await fs.mkdtemp(path.join(root,'auto-'));
  const folder=path.join(dir,'storage');await fs.mkdir(folder);
  const s=new Store(path.join(dir,'vault.db'));await s.open();s.setup(password);
  s.saveCredential({title:'Server private',username:'root',url:'example.test',password:'secret-value-928371',notes:'recovery-secret',category:'Server'});
  const osKey=randomBytes(32),protection={seal:(v:string)=>encrypt(v,osKey),unseal:(v:string)=>decrypt(v,osKey)};
  let now=new Date(2026,8,14,10);
  const service=new AutomaticBackup(s,protection,()=>now);
  const config={...schedule,enabled:true,folder,password};
  return {s,dir,folder,service,config,protection,clock:()=>now,setTime:(date:Date)=>{now=date;}};
}
test('automatic backup calendar: daily, weekly, month end and leap year',()=>{
  assert.equal(nextBackupTime(schedule,new Date(2026,8,14,9)),new Date(2026,8,15,9).toISOString());
  assert.equal(nextBackupTime({...schedule,frequency:'weekly'},new Date(2026,8,14,9)),new Date(2026,8,21,9).toISOString());
  assert.equal(nextBackupTime({...schedule,frequency:'monthly'},new Date(2026,0,31,9)),new Date(2026,1,28,9).toISOString());
  assert.equal(nextBackupTime({...schedule,frequency:'monthly'},new Date(2024,0,31,9)),new Date(2024,1,29,9).toISOString());
  assert.throws(()=>nextBackupTime({...schedule,time:'25:00'},new Date()));
});
test('configuration rejects invalid credentials and schedules without enabling',async()=>{
  const f=await fixture();assert.equal(f.service.settings().enabled,false);
  await assert.rejects(f.service.configure({...f.config,password:'wrong-password'}));
  await assert.rejects(f.service.configure({...f.config,monthDay:32}));
  assert.equal(f.service.settings().enabled,false);assert.equal(await f.service.runDue(),null);
});
test('locked vault backup restores credentials with original master into a different vault',async()=>{
  const f=await fixture();await f.service.configure(f.config);f.s.lock();const activity=f.s.lastActivity;
  const result=await f.service.runDue();assert.equal(result?.ok,true);assert.equal(f.s.key,null);assert.equal(f.s.lastActivity,activity);
  const content=await fs.readFile(result!.file!,'utf8');assert.equal(JSON.parse(content).version,3);
  assert.equal(content.includes('secret-value-928371'),false);assert.equal(content.includes(password),false);
  assert.equal(f.s.get('automaticBackup.config')!.includes(password),false);
  const config=JSON.parse(f.s.get('automaticBackup.config')!);const secret=JSON.parse(f.protection.unseal(config.protectedKey));
  assert.notEqual(secret.salt,f.s.get('salt'));
  assert.throws(()=>decrypt(f.s.rows('credentials')[0].payload,Buffer.from(secret.key,'hex')));
  const target=new Store(path.join(f.dir,'restored.db'));await target.open();target.setup('different-master-password');
  assert.throws(()=>target.importBackup(content,'wrong-password'));assert.equal(target.credentials().length,0);
  target.importBackup(content,password);assert.equal(target.credential(target.credentials()[0].id).password,'secret-value-928371');
  target.importBackup(content,password);assert.equal(target.credentials().length,1);
  assert.equal(target.get('automaticBackup.config'),null);
});
test('persisted schedule catches up once after restart and retains older files',async()=>{
  const f=await fixture();await f.service.configure(f.config);assert.equal((await f.service.runDue())?.ok,true);
  assert.equal(await f.service.runDue(),null);
  f.setTime(new Date(2026,8,20,12));const reopened=new Store(f.s.file);await reopened.open();
  const restarted=new AutomaticBackup(reopened,f.protection,f.clock);
  assert.equal((await restarted.runDue())?.ok,true);assert.equal(await restarted.runDue(),null);
  assert.equal(restarted.settings().nextRun,new Date(2026,8,21,9).toISOString());
  assert.equal((await fs.readdir(f.folder)).filter(n=>n.endsWith('.anchor')).length,2);
});
test('disconnected storage retries after fifteen minutes and recovers',async()=>{
  const f=await fixture();await f.service.configure(f.config);await fs.rename(f.folder,f.folder+'-away');
  assert.equal((await f.service.runDue())?.ok,false);assert.ok(f.service.settings().lastError);
  await fs.rename(f.folder+'-away',f.folder);f.setTime(new Date(2026,8,14,10,14));assert.equal(await f.service.runDue(),null);
  f.setTime(new Date(2026,8,14,10,15));assert.equal((await f.service.runDue())?.ok,true);assert.equal(f.service.settings().lastError,'');
});
test('concurrent jobs write only one archive; disabling stops scheduled jobs',async()=>{
  const f=await fixture();await f.service.configure(f.config);
  const results=await Promise.all([f.service.runNow(),f.service.runNow()]);assert.equal(results.filter(r=>r.ok).length,1);
  assert.equal((await fs.readdir(f.folder)).length,1);
  await f.service.configure({enabled:false});f.setTime(new Date(2026,9,14));assert.equal(await f.service.runDue(),null);
});
test('OS key unavailable fails safely without producing a plaintext archive',async()=>{
  const f=await fixture();await f.service.configure(f.config);f.s.lock();
  const unavailable=new AutomaticBackup(f.s,{seal:()=>{throw new Error();},unseal:()=>{throw new Error();}},f.clock);
  assert.equal((await unavailable.runDue())?.ok,false);assert.equal((await fs.readdir(f.folder)).length,0);assert.equal(f.s.key,null);
});
