import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { Store } from '../electron/store';
import { Reminder, validateReminder } from '../electron/schedule';
import { deliverDue } from '../electron/scheduler';
import { derive, salt } from '../electron/crypto';
import { selectTasks, taskWorkbook } from '../electron/task-export';
import { taskView } from '../electron/task-view';

test('created range uses inclusive local calendar days, open bounds and export ordering',()=>{
  const at=(d:number,h=0)=>new Date(2026,9,d,h,59,59,999).toISOString();
  const rows=[task({id:'a',createdAt:at(6)}),task({id:'b',createdAt:at(7,23)}),task({id:'c',createdAt:at(8)}),task({id:'missing',createdAt:undefined})];
  const ids=(items:Reminder[])=>items.map(r=>r.id);
  assert.deepEqual(ids(taskView(rows,{dateFrom:'2026-10-07',dateTo:'2026-10-07'})),['b']);
  assert.deepEqual(ids(taskView(rows,{dateFrom:'2026-10-07',sort:'created-desc'})),['c','b']);
  assert.deepEqual(ids(taskView(rows,{dateTo:'2026-10-07',sort:'created-asc'})),['a','b']);
  assert.deepEqual(ids(taskView(rows,{sort:'created-desc'})),['c','b','a','missing']);
  const options={scope:'filtered' as const,filter:'all',query:'restart',dateFrom:'2026-10-06',dateTo:'2026-10-07',sort:'created-desc' as const};
  assert.deepEqual(ids(selectTasks(rows,options)),ids(taskView(rows,options)));
  assert.equal(selectTasks(rows,{...options,scope:'all'}).length,4);
  assert.throws(()=>taskView(rows,{dateFrom:'2026-10-08',dateTo:'2026-10-07'}));
  assert.throws(()=>taskView(rows,{dateFrom:'2026-02-30'}));
});

const root = path.resolve(process.env.ANCHOR_TEST_ROOT || '.test-data');
async function store() { fs.mkdirSync(root,{recursive:true}); const s=new Store(path.join(fs.mkdtempSync(path.join(root,'task-')),'anchor.db'));await s.open();return s; }
function task(patch:Partial<Reminder> = {}): Reminder {return {id:'task',kind:'task',mode:'deadline',title:'Restart server',notes:'Step 1\nStep 2',amount:0,currency:'IDR',due:'2026-10-01T09:00:00.000Z',anchor:'2026-10-01T09:00:00.000Z',recurrence:'once',every:1,unit:'days',leadMinutes:0,repeatMinutes:5,windows:true,discord:false,enabled:true,completed:false,nextNotify:null,lastNotified:null,createdAt:'2026-09-30T09:00:00.000Z',...patch};}
function create(s:Store,patch:Partial<Reminder> = {}) { const {id,...input}=task(patch);s.saveReminder(input);return s.reminders()[0]; }

test('manhours validates numbers, preserves missing vs zero, and does not reset snooze',async()=>{
  for(const value of [-1,NaN,Infinity,'2',{},1000001]) for(const field of ['estimatedHours','actualHours']) assert.throws(()=>validateReminder({...task(),[field]:value}));
  const s=await store();const r=create(s);assert.equal(r.actualHours,null);
  s.action(r.id,'snooze',60);const before=s.reminders()[0];
  s.saveReminder({...before,estimatedHours:2.5,actualHours:0});
  const reopened=new Store(s.file);await reopened.open();const after=reopened.reminders()[0];
  assert.equal(after.nextNotify,before.nextNotify);assert.equal(after.actualHours,0);assert.equal(after.estimatedHours,2.5);
});

test('deadline task repeats notification, completes atomically with hours and never advances period',async()=>{
  const s=await store();const r=create(s,{estimatedHours:4});let sent=0;
  await deliverDue(s,()=>{sent++;},async()=>{},new Date(r.due));
  assert.equal(s.reminders()[0].nextNotify,'2026-10-01T09:05:00.000Z');
  assert.throws(()=>s.action(r.id,'complete',30,-1));assert.equal(s.reminders()[0].completed,false);assert.equal(s.history().length,0);
  const persist=s.persist;s.persist=()=>{throw Error('disk error');};
  assert.throws(()=>s.action(r.id,'complete',30,3.5));s.persist=persist;
  assert.equal(s.reminders()[0].completed,false);assert.equal(s.reminders()[0].actualHours,null);assert.equal(s.history().length,0);
  s.action(r.id,'complete',30,3.5);
  const done=s.reminders()[0];assert.equal(done.completed,true);assert.equal(done.actualHours,3.5);assert.equal(done.due,r.due);assert.equal(done.nextNotify,null);assert.ok(done.completedAt);
  assert.equal(s.history()[0].reminderId,r.id);assert.equal(s.history()[0].estimatedHours,4);assert.equal(s.history()[0].actualHours,3.5);assert.equal(s.history()[0].notes,r.notes);
  await deliverDue(s,()=>{sent++;},async()=>{},new Date('2027-01-01'));assert.equal(sent,1);
});

test('legacy deadline task remains recurring until explicit conversion; new recurring deadlines rejected',async()=>{
  const s=await store();assert.throws(()=>create(s,{recurrence:'daily'}));
  const legacy=task({mode:undefined,recurrence:'daily',estimatedHours:2,actualHours:1});s.transaction(()=>s.putReminder(legacy));
  s.saveReminder({...legacy,notes:'Edited',actualHours:1.5});s.action(legacy.id,'complete');
  let r=s.reminders()[0];assert.equal(r.completed,false);assert.equal(r.due,'2026-10-02T09:00:00.000Z');assert.equal(r.actualHours,null);assert.equal(s.history()[0].actualHours,1.5);
  s.saveReminder({...r,recurrence:'once'});s.action(r.id,'complete');assert.equal(s.reminders()[0].completed,true);
  const other=await store();const ongoing=create(other,{mode:'ongoing',recurrence:'daily',repeatMinutes:0});
  assert.throws(()=>other.saveReminder({...ongoing,mode:'deadline'}));
  other.saveReminder({...ongoing,mode:'deadline',recurrence:'once'});assert.equal(other.reminders()[0].recurrence,'once');
});

test('manual and automatic backups preserve hours and completion snapshot; legacy hours stay absent',async()=>{
  const source=await store();source.setup('source master password');const r=create(source,{estimatedHours:2.5});source.action(r.id,'complete',30,2);
  const legacy=task({id:'old',title:'Old task'});source.transaction(()=>source.putReminder(legacy));
  const target=await store();target.setup('target master password');target.importBackup(source.exportBackup('export backup password'),'export backup password');
  const restored=target.reminders().find(x=>x.id===r.id)!;
  assert.equal(restored.actualHours,2);assert.equal(restored.estimatedHours,2.5);assert.ok(restored.completedAt);assert.equal(target.history()[0].actualHours,2);assert.equal(target.reminders().find(x=>x.id==='old')!.actualHours,undefined);
  const backupSalt=salt(),backupKey=derive('source master password',backupSalt);source.lock();
  const automatic=source.exportAutomaticBackup(backupSalt,backupKey,new Date().toISOString());backupKey.fill(0);
  const autoTarget=await store();autoTarget.setup('automatic target password');autoTarget.importBackup(automatic,'source master password');
  assert.equal(autoTarget.reminders().find(x=>x.id===r.id)!.actualHours,2);assert.equal(autoTarget.history()[0].estimatedHours,2.5);
});

test('export filters only tasks and applies search and each status without history limits',()=>{
  const rows=[task(),task({id:'paused',enabled:false}),task({id:'done',completed:true,enabled:false}),task({id:'bill',kind:'bill'}),task({id:'other',title:'Other'})];
  assert.equal(selectTasks(rows,{scope:'all'}).length,4);
  for(const [filter,count] of [['active',1],['paused',1],['done',1],['all',3]] as const) assert.equal(selectTasks(rows,{scope:'filtered',filter,query:'RESTART'}).length,count);
  assert.equal(selectTasks(Array.from({length:250},(_,i)=>task({id:String(i)})),{scope:'all'}).length,250);
  assert.throws(()=>selectTasks(rows,{scope:'filtered',filter:'invalid',query:''}));
});

test('xlsx roundtrip preserves text safely, numeric hours, local dates, totals, filters and empty exports',async()=>{
  const r=task({title:'=HYPERLINK("https://example.com")',notes:'+SUM(1,2)\n<&>',estimatedHours:1.5,actualHours:0});
  const wb=taskWorkbook([r,task({id:'2',mode:'ongoing'})]);
  const copy=new ExcelJS.Workbook();await copy.xlsx.load(await wb.xlsx.writeBuffer());const sheet=copy.getWorksheet('Tasks')!;
  assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);assert.equal(sheet.getCell('B2').value,r.title);assert.equal(sheet.getCell('N2').value,r.notes);
  assert.equal(sheet.getCell('I2').value,1.5);assert.equal(sheet.getCell('J2').value,0);assert.equal(sheet.getCell('I3').value,null);
  const d=new Date(r.due);assert.equal((sheet.getCell('G2').value as Date).getUTCHours(),d.getHours());assert.equal(sheet.getCell('G3').value,null);assert.ok(sheet.getCell('F3').value);
  assert.equal(sheet.getCell('I4').formula,'SUBTOTAL(109,I2:I3)');assert.equal(sheet.getCell('I4').result,1.5);assert.ok(sheet.autoFilter);assert.equal(sheet.views[0].state,'frozen');
  const empty=new ExcelJS.Workbook();await empty.xlsx.load(await taskWorkbook([]).xlsx.writeBuffer());assert.equal(empty.getWorksheet('Tasks')!.getCell('I2').value,0);
});
