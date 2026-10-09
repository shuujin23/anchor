import ExcelJS from 'exceljs';
import { Reminder } from './schedule';
import { taskView, TaskViewOptions } from './task-view';

export type TaskExportOptions = TaskViewOptions & { scope: 'all' | 'filtered' };
export function selectTasks(reminders: Reminder[], options: TaskExportOptions): Reminder[] {
  if (!options || !['all','filtered'].includes(options.scope) || (options.scope === 'filtered' && (!['all','active','paused','done'].includes(options.filter || '') || typeof options.query !== 'string' || options.query.length > 10000))) throw new Error('Pilihan ekspor task tidak valid.');
  return taskView(reminders, options.scope === 'all' ? {sort:options.sort} : options);
}
const names: Record<string,string> = { once:'Sekali',daily:'Harian',weekly:'Mingguan',monthly:'Bulanan',yearly:'Tahunan' };
const units: Record<string,string> = { seconds:'detik',minutes:'menit',hours:'jam',days:'hari',weeks:'minggu',months:'bulan',years:'tahun' };
// Excel dates have no timezone. Preserve the same local wall clock shown in Anchor.
function localDate(value?: string | null): Date | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const d = new Date(value);
  return new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds()));
}
export function taskWorkbook(tasks: Reminder[], now = new Date()) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Anchor'; workbook.created = now;
  const sheet = workbook.addWorksheet('Tasks', {views:[{state:'frozen',ySplit:1}]});
  sheet.columns = [
    {header:'No.',key:'no',width:7}, {header:'Task',key:'title',width:36},
    {header:'Mode',key:'mode',width:22}, {header:'Status',key:'status',width:16},
    {header:'Dibuat (lokal)',key:'created',width:23}, {header:'Mulai pengingat (lokal)',key:'start',width:25},
    {header:'Deadline (lokal)',key:'due',width:23}, {header:'Selesai (lokal)',key:'completed',width:23},
    {header:'Estimasi (MH)',key:'estimate',width:18}, {header:'Aktual (MH)',key:'actual',width:18},
    {header:'Jadwal / periode',key:'cadence',width:32}, {header:'Pengingat awal (menit)',key:'lead',width:25},
    {header:'Ulang pengingat (menit)',key:'repeat',width:26}, {header:'Catatan',key:'notes',width:60}
  ];
  tasks.forEach((r,index) => {
    const cadence = r.recurrence === 'custom' ? `Setiap ${r.every} ${units[r.unit]}` : names[r.recurrence];
    sheet.addRow({no:index+1,title:r.title,mode:r.mode==='note'?'Catatan task':r.mode === 'ongoing' ? 'Tanpa deadline' : 'Dengan deadline',
      status:r.completed?'Selesai':!r.enabled?'Nonaktif':r.mode !== 'note' && r.mode !== 'ongoing' && Date.parse(r.due)<now.getTime()?'Terlewat':r.mode==='note'?'Aktif':'Terjadwal',
      created:localDate(r.createdAt),start:r.mode === 'ongoing'?localDate(r.due):null,due:r.mode !== 'note' && r.mode !== 'ongoing'?localDate(r.due):null,
      completed:localDate(r.completedAt),estimate:r.estimatedHours ?? null,actual:r.actualHours ?? null,
      cadence:r.mode==='note'?'Tidak ada':r.mode !== 'ongoing' && r.recurrence !== 'once'?`${cadence} (periode lama)`:cadence,
      lead:r.mode === 'note'||r.mode === 'ongoing'?null:r.leadMinutes,repeat:r.mode === 'note'||r.mode === 'ongoing'?null:r.repeatMinutes,notes:r.notes});
  });
  for (const key of ['created','start','due','completed']) sheet.getColumn(key).numFmt = 'dd mmm yyyy hh:mm:ss';
  for (const key of ['estimate','actual']) sheet.getColumn(key).numFmt = '0.00';
  sheet.eachRow((row,index) => {
    row.alignment = {vertical:'top',wrapText:true};
    if (index === 1) { row.height = 32; row.font = {bold:true,color:{argb:'FFFFFFFF'}}; row.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FF6153D9'}}; }
  });
  sheet.autoFilter = {from:{row:1,column:1},to:{row:Math.max(1,tasks.length+1),column:14}};
  const totals = sheet.addRow({title:'TOTAL (sesuai filter Excel)'});
  totals.font = {bold:true};
  for (const [column,key] of [['I','estimatedHours'],['J','actualHours']] as const) {
    const result = tasks.reduce((sum,r) => sum+(r[key] ?? 0),0);
    totals.getCell(column).value = tasks.length ? {formula:`SUBTOTAL(109,${column}2:${column}${tasks.length+1})`,result} : 0;
    totals.getCell(column).numFmt = '0.00';
  }
  sheet.addRow({title:`Zona waktu: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. MH = jam kerja. Nilai kosong belum diisi.`});
  sheet.mergeCells(sheet.rowCount,2,sheet.rowCount,14);
  sheet.lastRow!.alignment = {wrapText:true}; sheet.lastRow!.height = 32;
  return workbook;
}
