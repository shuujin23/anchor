export type TaskViewOptions = { filter?: string; query?: string; sort?: 'schedule' | 'created-desc' | 'created-asc'; dateFrom?: string; dateTo?: string };
type Task = { id?: string; kind: string; title: string; enabled: boolean; completed: boolean; createdAt?: string; mode?: string; due: string; nextNotify?: string | null };
function day(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Tanggal filter tidak valid.');
  const [y,m,d] = value.split('-').map(Number), date = new Date(y,m-1,d);
  if (y < 2000 || y > 2200 || date.getFullYear() !== y || date.getMonth() !== m-1 || date.getDate() !== d) throw new Error('Tanggal filter tidak valid.');
  return date.getTime();
}
export function taskDateBounds(options: TaskViewOptions) {
  const start = options.dateFrom ? day(options.dateFrom) : -Infinity;
  let end = options.dateTo ? day(options.dateTo) : Infinity;
  if (start > end) throw new Error('Tanggal mulai tidak boleh melewati tanggal akhir.');
  if (Number.isFinite(end)) { const next = new Date(end); next.setDate(next.getDate()+1); end = next.getTime(); }
  return {start,end};
}
export function taskView<T extends Task>(items: T[], options: TaskViewOptions): T[] {
  const {start,end} = taskDateBounds(options), sort = options.sort ?? 'schedule';
  if (!['schedule','created-desc','created-asc'].includes(sort)) throw new Error('Urutan task tidak valid.');
  return items.filter(r => r.kind === 'task' && r.title.toLowerCase().includes((options.query ?? '').toLowerCase()) &&
    (!options.filter || options.filter === 'all' || options.filter === 'active' && r.enabled && !r.completed || options.filter === 'paused' && !r.enabled && !r.completed || options.filter === 'done' && r.completed) &&
    (!(options.dateFrom || options.dateTo) || Date.parse(r.createdAt ?? '') >= start && Date.parse(r.createdAt ?? '') < end)
  ).sort((a,b) => {
    const value = (r: T) => Date.parse(sort === 'schedule' ? (r.mode === 'note' ? '' : r.mode === 'ongoing' ? r.nextNotify || r.due : r.due) : r.createdAt ?? '');
    const av=value(a),bv=value(b);
    // Records without a valid creation date remain last in either direction.
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return Number.isFinite(av)?-1:Number.isFinite(bv)?1:0;
    return (av-bv)*(sort==='created-desc'?-1:1) || (a.id ?? '').localeCompare(b.id ?? '');
  });
}
