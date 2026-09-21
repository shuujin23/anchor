import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { derive, encrypt, decrypt, salt } from '../electron/crypto';
import { Reminder, nextDue, afterNotice, firstNotice, validateReminder } from '../electron/schedule';
import { Store } from '../electron/store';
import { deliverDue } from '../electron/scheduler';

const root = path.resolve(process.env.ANCHOR_TEST_ROOT || '.test-data');fs.mkdirSync(root,{recursive:true});
function reminder(overrides:Partial<Reminder> = {}):Reminder {return {id:'test',title:'VPS',kind:'bill',notes:'',amount:100000,currency:'IDR',anchor:new Date(2026,0,31,9).toISOString(),due:new Date(2026,0,31,9).toISOString(),recurrence:'monthly',every:1,unit:'days',leadMinutes:0,repeatMinutes:30,windows:true,discord:false,enabled:true,completed:false,nextNotify:null,lastNotified:null,createdAt:new Date().toISOString(),...overrides};}
async function store() {const dir=fs.mkdtempSync(path.join(root,'vault-'));const s=new Store(path.join(dir,'anchor.db'));await s.open();return s;}
const credential={title:'Production',username:'root',url:'10.0.0.1',password:'SUPER_SECRET_938271',notes:'SECRET_RECOVERY_82391',category:'Server'};

test('short custom intervals advance exactly and skip years of missed seconds',()=>{
  const start=new Date('2020-01-01T00:00:00Z');
  for(const [unit,ms] of [['seconds',1000],['minutes',60000],['hours',3600000]] as const){
    const r=reminder({mode:'ongoing',kind:'task',recurrence:'custom',every:7,unit,due:start.toISOString(),anchor:start.toISOString(),leadMinutes:0,repeatMinutes:0});
    validateReminder(r);
    assert.equal(nextDue(r),new Date(start.getTime()+7*ms).toISOString());
    assert.equal(afterNotice(r,new Date(start.getTime()-1)),start.toISOString());
    const now=new Date('2026-09-21T00:00:00Z');
    const expected=start.getTime()+(Math.floor((now.getTime()-start.getTime())/(7*ms))+1)*7*ms;
    assert.equal(afterNotice(r,now),new Date(expected).toISOString());
  }
});

test('second interval persists, sends once per slot, survives backup and stops on completion',async()=>{
  const s=await ongoing({recurrence:'custom',every:5,unit:'seconds'});
  const start=new Date(s.reminders()[0].due);let sends=0;
  await deliverDue(s,()=>{sends++;},async()=>{},start);
  await deliverDue(s,()=>{sends++;},async()=>{},new Date(start.getTime()+4999));
  assert.equal(sends,1);
  const reopened=new Store(s.file);await reopened.open();
  await deliverDue(reopened,()=>{sends++;},async()=>{},new Date(start.getTime()+5000));
  assert.equal(sends,2);
  assert.equal(reopened.reminders()[0].nextNotify,new Date(start.getTime()+10000).toISOString());
  reopened.setup('short-interval-master');const backup=reopened.exportBackup('short-backup-password');
  const target=await store();target.setup('target-master-password');target.importBackup(backup,'short-backup-password');
  assert.equal(target.reminders()[0].unit,'seconds');
  reopened.action(reopened.reminders()[0].id,'complete');
  await deliverDue(reopened,()=>{sends++;},async()=>{},new Date(start.getTime()+10000));
  assert.equal(sends,2);assert.equal(reopened.reminders()[0].nextNotify,null);
});

async function ongoing(overrides:Partial<Reminder> = {}) {
  const s = await store();
  const input:any = reminder({kind:'task',mode:'ongoing',recurrence:'daily',leadMinutes:0,repeatMinutes:0,amount:0,
    due:new Date(2026,8,14,9).toISOString(),...overrides});
  delete input.id;
  s.saveReminder(input);
  return s;
}

test('no-deadline daily task repeats without completion, then stops permanently',async()=>{
  const s=await ongoing(); let sends=0;
  await deliverDue(s,()=>{sends++;},async()=>{},new Date(2026,8,14,9));
  const first=s.reminders()[0];
  assert.equal(first.completed,false);
  assert.equal(first.nextNotify,new Date(2026,8,15,9).toISOString());
  assert.equal(s.history().length,0);
  await deliverDue(s,()=>{sends++;},async()=>{},new Date(2026,8,15,9));
  assert.equal(sends,2);
  s.action(first.id,'complete');
  assert.equal(s.reminders()[0].completed,true);
  assert.equal(s.reminders()[0].nextNotify,null);
  assert.equal(s.history()[0].mode,'ongoing');
  await deliverDue(s,()=>{sends++;},async()=>{},new Date(2026,8,16,9));
  assert.equal(sends,2);
  assert.throws(()=>s.action(first.id,'complete'));
});

test('ongoing weekly, monthly, yearly and custom calendars retain their original cadence',async()=>{
  for(const [recurrence,unit,every,start,now,expected] of [
    ['weekly','days',1,new Date(2026,8,14,9),new Date(2026,8,15,12),new Date(2026,8,21,9)],
    ['monthly','days',1,new Date(2026,0,31,9),new Date(2026,1,28,12),new Date(2026,2,31,9)],
    ['yearly','days',1,new Date(2024,1,29,9),new Date(2027,2,1,12),new Date(2028,1,29,9)],
    ['custom','days',3,new Date(2026,8,14,9),new Date(2026,8,18,12),new Date(2026,8,20,9)],
    ['custom','months',2,new Date(2026,0,31,9),new Date(2026,2,31,12),new Date(2026,4,31,9)],
  ] as const){
    const s=await ongoing({recurrence,unit,every,due:start.toISOString()});
    await deliverDue(s,()=>{},async()=>{},now);
    assert.equal(s.reminders()[0].nextNotify,expected.toISOString());
  }
});

test('late or snoozed delivery sends one catch-up and never shifts the daily clock',async()=>{
  const s=await ongoing(); const r=s.reminders()[0];
  // Simulate a persisted snooze across several missed days.
  r.nextNotify=new Date(2026,8,17,11).toISOString();
  s.transaction(()=>s.putReminder(r));
  const restarted=new Store(s.file);await restarted.open();let sends=0;
  await deliverDue(restarted,()=>{sends++;},async()=>{},new Date(2026,8,17,12));
  await deliverDue(restarted,()=>{sends++;},async()=>{},new Date(2026,8,17,12));
  assert.equal(sends,1);
  assert.equal(restarted.reminders()[0].nextNotify,new Date(2026,8,18,9).toISOString());
  assert.equal(restarted.reminders()[0].due,r.due);
});

test('ongoing snooze persists and pausing suppresses delivery until reenabled',async()=>{
  const s=await ongoing({due:new Date(Date.now()-86400000).toISOString()});const id=s.reminders()[0].id;
  s.action(id,'snooze',30);const snooze=s.reminders()[0].nextNotify!;
  assert.ok(Date.parse(snooze)>Date.now()+29*60000);
  s.action(id,'toggle');let sends=0;
  await deliverDue(s,()=>{sends++;},async()=>{},new Date(snooze));assert.equal(sends,0);
  s.action(id,'toggle');await deliverDue(s,()=>{sends++;},async()=>{},new Date(snooze));assert.equal(sends,1);
  assert.ok(Date.parse(s.reminders()[0].nextNotify!)>Date.parse(snooze));
});

test('ongoing task completion during a network send cannot schedule more reminders',async()=>{
  const s=await ongoing({discord:true});const id=s.reminders()[0].id;
  await deliverDue(s,()=>{},async()=>{s.action(id,'complete');},new Date(2026,8,14,9));
  assert.equal(s.reminders()[0].completed,true);assert.equal(s.reminders()[0].nextNotify,null);
});

test('changing mode while sending invalidates the previous delivery result',async()=>{
  const s=await ongoing({discord:true});const r=s.reminders()[0];
  await deliverDue(s,()=>{},async()=>{s.saveReminder({...r,mode:'deadline',recurrence:'once'});},new Date(2026,8,14,9));
  assert.equal(s.reminders()[0].mode,'deadline');
  assert.equal(s.reminders()[0].nextNotify,r.nextNotify);
  assert.equal(s.reminders()[0].lastNotified,null);
});

test('ongoing notification has no deadline wording and no secret notes',async()=>{
  const s=await ongoing({discord:true,notes:'private notes'});const bodies:string[]=[];
  await deliverDue(s,(_title,body)=>{bodies.push(body);},async(body)=>{bodies.push(body);},new Date(2026,8,14,9));
  assert.equal(bodies.length,2);
  for(const body of bodies){assert.match(body,/Tanpa deadline/);assert.doesNotMatch(body,/Jatuh tempo|private notes/);}
});

test('ongoing validation rejects bills, one-off schedules and conflicting repeat intervals',()=>{
  const r=reminder({mode:'ongoing',kind:'task',recurrence:'daily',repeatMinutes:0});
  validateReminder(r);
  for(const patch of [{kind:'bill'},{recurrence:'once'},{leadMinutes:60},{repeatMinutes:30},{mode:'invalid'}]) assert.throws(()=>validateReminder({...r,...patch}));
});

test('editing ongoing notes preserves pending time; changing mode resets scheduling',async()=>{
  const s=await ongoing();await deliverDue(s,()=>{},async()=>{},new Date(2026,8,14,9));
  const r=s.reminders()[0];s.saveReminder({...r,notes:'edited'});
  assert.equal(s.reminders()[0].nextNotify,r.nextNotify);
  s.saveReminder({...r,mode:'deadline',leadMinutes:60});
  assert.equal(s.reminders()[0].nextNotify,new Date(Date.parse(r.due)-3600000).toISOString());
});

test('existing records without a mode retain deadline completion semantics',async()=>{
  const s=await store();const legacy=reminder();delete legacy.mode;
  s.transaction(()=>s.putReminder(legacy));
  s.action(legacy.id,'complete');
  assert.equal(s.reminders()[0].completed,false);
  assert.equal(new Date(s.reminders()[0].due).getDate(),28);
});

test('backup preserves ongoing mode and next reminder, and accepts old v1 backups',async()=>{
  const s=await ongoing();s.setup('master password for source');
  await deliverDue(s,()=>{},async()=>{},new Date(2026,8,14,9));
  const backup=s.exportBackup('backup password example');
  assert.equal(JSON.parse(backup).version,2);
  const target=await store();target.setup('different master password');target.importBackup(backup,'backup password example');
  assert.deepEqual(target.reminders(),s.reminders());
  target.action(target.reminders()[0].id,'complete');assert.equal(target.reminders()[0].nextNotify,null);
  const old=await store();old.setup('old master password');old.transaction(()=>old.putReminder(reminder()));
  const envelope=JSON.parse(old.exportBackup('old backup password'));envelope.version=1;
  target.importBackup(JSON.stringify(envelope),'old backup password');
  assert.equal(target.reminders().length,2);
});

test('AES-GCM random nonces, roundtrip, wrong key and tamper rejection',()=>{const key=derive('a very good password',salt());const a=encrypt('secret',key),b=encrypt('secret',key);assert.notEqual(a,b);assert.equal(decrypt(a,key),'secret');assert.throws(()=>decrypt(a,derive('wrong',salt())));const parsed=JSON.parse(a);parsed.data=Buffer.from('modified').toString('base64');assert.throws(()=>decrypt(JSON.stringify(parsed),key));});
test('monthly recurrence clamps Jan 31 and recovers March 31',()=>{const r=reminder();const feb=nextDue(r)!;assert.equal(new Date(feb).getDate(),28);r.due=feb;const march=nextDue(r)!;assert.equal(new Date(march).getDate(),31);assert.equal(new Date(march).getHours(),9);});
test('yearly leap-day recovers leap year',()=>{const r=reminder({anchor:new Date(2024,1,29,10).toISOString(),due:new Date(2024,1,29,10).toISOString(),recurrence:'yearly'});for(let year=2025;year<=2028;year++){r.due=nextDue(r)!;assert.equal(new Date(r.due).getFullYear(),year);assert.equal(new Date(r.due).getDate(),year===2028?29:28);}});
test('daily, weekly, custom day/week/month/year and one-off',()=>{const r=reminder({due:new Date(2026,0,1,9).toISOString(),anchor:new Date(2026,0,1,9).toISOString()});assert.equal(nextDue({...r,recurrence:'once'}),null);assert.equal(new Date(nextDue({...r,recurrence:'daily'})!).getDate(),2);assert.equal(new Date(nextDue({...r,recurrence:'weekly'})!).getDate(),8);for(const [unit,month,day,year]of [['days',0,4,2026],['weeks',0,22,2026],['months',3,1,2026],['years',0,1,2029]]as const){const d=new Date(nextDue({...r,recurrence:'custom',unit,every:3})!);assert.deepEqual([d.getMonth(),d.getDate(),d.getFullYear()],[month,day,year]);}});
test('pre-notification and repeat until done preserve deadline',()=>{const r=reminder({due:'2026-09-15T10:00:00Z',leadMinutes:60,repeatMinutes:120});assert.equal(firstNotice(r),'2026-09-15T09:00:00.000Z');assert.equal(afterNotice(r,new Date('2026-09-15T09:00:00Z')),new Date(r.due).toISOString());assert.equal(afterNotice(r,new Date('2026-09-15T11:00:00Z')),'2026-09-15T13:00:00.000Z');assert.equal(afterNotice({...r,repeatMinutes:0},new Date('2026-09-15T11:00:00Z')),null);});
test('invalid schedules are rejected',()=>{for(const patch of [{every:0},{repeatMinutes:-1},{amount:NaN},{due:'bad'},{windows:false,discord:false},{title:''},{recurrence:'evil'}])assert.throws(()=>validateReminder({...reminder(),...patch}));});
test('vault persists encrypted data, locks and refuses wrong password',async()=>{const s=await store();s.setup('master-password-test');s.saveCredential(credential);const id=s.credentials()[0].id;const bytes=fs.readFileSync(s.file);for(const secret of Object.values(credential))if(secret.length>4)assert.equal(bytes.includes(Buffer.from(secret)),false);assert.equal(s.credentials()[0].password,undefined);assert.equal(s.credential(id).password,credential.password);s.lock();assert.throws(()=>s.credentials());assert.throws(()=>s.unlock('bad'));const reopened=new Store(s.file);await reopened.open();reopened.unlock('master-password-test');assert.equal(reopened.credential(id).notes,credential.notes);});
test('recurring completion creates history and next period; pause stays paused',async()=>{const s=await store();const r:any=reminder();delete r.id;s.saveReminder(r);const id=s.reminders()[0].id;s.action(id,'toggle');s.action(id,'complete');assert.equal(s.history().length,1);assert.equal(s.reminders()[0].enabled,false);assert.equal(new Date(s.reminders()[0].due).getDate(),28);assert.equal(s.reminders()[0].completed,false);});
test('one-off completion is idempotently rejected, snooze and restart persist',async()=>{const s=await store();const r:any=reminder({recurrence:'once'});delete r.id;s.saveReminder(r);const id=s.reminders()[0].id;s.action(id,'snooze',30);assert.ok(Date.parse(s.reminders()[0].nextNotify!)>Date.now()+29*60000);const reopened=new Store(s.file);await reopened.open();assert.equal(reopened.reminders()[0].nextNotify,s.reminders()[0].nextNotify);s.action(id,'complete');assert.equal(s.reminders()[0].nextNotify,null);assert.throws(()=>s.action(id,'complete'));assert.equal(s.history().length,1);});
test('encrypted backup restores into different master password and merges safely',async()=>{const s=await store();s.setup('original-master-password');s.saveCredential(credential);const r:any=reminder();delete r.id;s.saveReminder(r);const backup=s.exportBackup('my-backup-password');assert.equal(backup.includes(credential.password),false);const target=await store();target.setup('different-master-password');assert.throws(()=>target.importBackup(backup,'incorrect'));target.importBackup(backup,'my-backup-password');assert.equal(target.credentials().length,1);assert.equal(target.credential(target.credentials()[0].id).password,credential.password);const id=target.reminders()[0].id;target.action(id,'complete');const due=target.reminders()[0].due;target.importBackup(backup,'my-backup-password');assert.equal(target.credentials().length,1);assert.equal(target.reminders()[0].due,due);});
test('failed persistence rolls back in-memory update',async()=>{const s=await store();const r:any=reminder();delete r.id;s.saveReminder(r);const before=s.reminders();const original=s.persist;s.persist=()=>{throw new Error('disk full');};assert.throws(()=>s.action(before[0].id,'complete'));s.persist=original;assert.deepEqual(s.reminders(),before);assert.equal(s.history().length,0);});
test('editing notes preserves snooze while changing deadline resets it',async()=>{const s=await store();const r:any=reminder();delete r.id;s.saveReminder(r);const id=s.reminders()[0].id;s.action(id,'snooze',60);const before=s.reminders()[0];s.saveReminder({...before,notes:'updated'});assert.equal(s.reminders()[0].nextNotify,before.nextNotify);s.saveReminder({...s.reminders()[0],due:'2027-01-01T10:00:00Z'});assert.equal(s.reminders()[0].nextNotify,'2027-01-01T10:00:00.000Z');});
test('scheduler catches missed due time, repeats and stops after completion',async()=>{const s=await store();const now=new Date('2026-09-15T12:00:00Z');const r:any=reminder({recurrence:'once',due:'2026-09-15T10:00:00Z',repeatMinutes:30});delete r.id;s.saveReminder(r);let sent=0;await deliverDue(s,()=>{sent++;},async()=>{},now);assert.equal(sent,1);await deliverDue(s,()=>{sent++;},async()=>{},now);assert.equal(sent,1);await deliverDue(s,()=>{sent++;},async()=>{},new Date(now.getTime()+30*60000));assert.equal(sent,2);s.action(s.reminders()[0].id,'complete');await deliverDue(s,()=>{sent++;},async()=>{},new Date(now.getTime()+60*60000));assert.equal(sent,2);});
test('Discord retry survives restart and does not duplicate successful Windows delivery',async()=>{const s=await store();const now=new Date('2026-09-15T12:00:00Z');const r:any=reminder({due:now.toISOString(),discord:true,repeatMinutes:0});delete r.id;s.saveReminder(r);let windows=0,discord=0;await deliverDue(s,()=>{windows++;},async()=>{discord++;throw new Error('offline');},now);assert.equal(windows,1);const reopened=new Store(s.file);await reopened.open();await deliverDue(reopened,()=>{windows++;},async()=>{discord++;},new Date(now.getTime()+3*60000));assert.equal(windows,1);assert.equal(discord,2);assert.equal(reopened.reminders()[0].nextNotify,null);});
test('completing during Discord send never resurrects an old occurrence',async()=>{const s=await store();const now=new Date('2026-09-15T12:00:00Z');const r:any=reminder({due:now.toISOString(),discord:true});delete r.id;s.saveReminder(r);const id=s.reminders()[0].id;await deliverDue(s,()=>{},async()=>{s.action(id,'complete');},now);assert.equal(new Date(s.reminders()[0].due).getMonth(),9);assert.equal(s.reminders()[0].lastNotified,null);assert.equal(s.history().length,1);});
test('paused reminders do not deliver and notification body excludes notes',async()=>{const s=await store();const now=new Date('2026-09-15T12:00:00Z');const r:any=reminder({due:now.toISOString(),notes:'DO_NOT_SEND_THIS'});delete r.id;s.saveReminder(r);const id=s.reminders()[0].id;s.action(id,'toggle');let bodies:string[]=[];await deliverDue(s,(_title,body)=>{bodies.push(body);},async()=>{},now);assert.equal(bodies.length,0);s.action(id,'toggle');await deliverDue(s,(_title,body)=>{bodies.push(body);},async()=>{},now);assert.equal(bodies.length,1);assert.equal(bodies[0].includes('DO_NOT_SEND_THIS'),false);});
