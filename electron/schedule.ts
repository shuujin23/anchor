export type Reminder = {
  // Missing mode means a legacy deadline reminder. In ongoing mode `due` is the
  // first reminder time, not a deadline; nextNotify tracks delivery independently.
  mode?: 'deadline' | 'ongoing';
  id: string; title: string; kind: 'task' | 'bill'; notes: string; amount: number; currency: string;
  anchor: string; due: string; recurrence: 'once' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  every: number; unit: 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'; leadMinutes: number; repeatMinutes: number;
  windows: boolean; discord: boolean; enabled: boolean; completed: boolean;
  nextNotify: string | null; lastNotified: string | null; createdAt: string;
};
export function firstNotice(r: Pick<Reminder, 'due' | 'leadMinutes' | 'mode'>) { return new Date(new Date(r.due).getTime() - (r.mode === 'ongoing' ? 0 : r.leadMinutes) * 60000).toISOString(); }
// Keep the original day when clamping Jan 31 / Feb 29 to shorter months.
export function nextDue(r: Reminder): string | null {
  if (r.recurrence === 'once') return null;
  const date = new Date(r.due), anchor = new Date(r.anchor);
  const amount = r.recurrence === 'custom' ? r.every : 1;
  const unit = r.recurrence === 'custom' ? r.unit : ({ daily: 'days', weekly: 'weeks', monthly: 'months', yearly: 'years' } as const)[r.recurrence];
  if (unit === 'seconds' || unit === 'minutes' || unit === 'hours') date.setTime(date.getTime() + amount * ({seconds:1000,minutes:60000,hours:3600000}[unit]));
  else if (unit === 'days' || unit === 'weeks') date.setDate(date.getDate() + amount * (unit === 'weeks' ? 7 : 1));
  else {
    date.setDate(1);
    if (unit === 'months') date.setMonth(date.getMonth() + amount);
    else { date.setFullYear(date.getFullYear() + amount); date.setMonth(anchor.getMonth()); }
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(anchor.getDate(), lastDay));
  }
  return date.toISOString();
}
export function afterNotice(r: Reminder, now: Date): string | null {
  if (r.mode === 'ongoing') {
    // Jump directly over missed short intervals, even after years offline.
    if (r.recurrence === 'custom' && (r.unit === 'seconds' || r.unit === 'minutes' || r.unit === 'hours')) {
      const start = Date.parse(r.due), interval = r.every * ({seconds:1000,minutes:60000,hours:3600000}[r.unit]);
      return new Date(start + Math.max(0,Math.floor((now.getTime()-start)/interval)+1)*interval).toISOString();
    }
    // Keep calendar cadence anchored to the chosen start, even after snoozing,
    // retries or several days offline. Deliver one catch-up, not a backlog.
    let next = r.due;
    while (Date.parse(next) <= now.getTime()) {
      const following = nextDue({ ...r, due: next });
      if (!following) return null;
      next = following;
    }
    return new Date(next).toISOString();
  }
  if (r.repeatMinutes > 0) {
    const next = now.getTime() + r.repeatMinutes * 60000;
    return new Date(now.getTime() < Date.parse(r.due) ? Math.min(next, Date.parse(r.due)) : next).toISOString();
  }
  return now.getTime() < Date.parse(r.due) ? r.due : null;
}
export function validateReminder(input: any): void {
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 160) throw new Error('Judul wajib diisi, maksimal 160 karakter.');
  if (!['task','bill'].includes(input.kind) || !['once','daily','weekly','monthly','yearly','custom'].includes(input.recurrence) || !['seconds','minutes','hours','days','weeks','months','years'].includes(input.unit)) throw new Error('Jenis jadwal tidak valid.');
  if (input.mode !== undefined && !['deadline','ongoing'].includes(input.mode)) throw new Error('Mode reminder tidak valid.');
  if (input.mode === 'ongoing' && (input.kind !== 'task' || input.recurrence === 'once' || input.leadMinutes !== 0 || input.repeatMinutes !== 0)) throw new Error('Task tanpa deadline harus memakai jadwal berulang, tanpa pengingat awal atau interval tambahan.');
  if (!Number.isFinite(Date.parse(input.due)) || new Date(input.due).getFullYear() < 2000 || new Date(input.due).getFullYear() > 2200) throw new Error('Tanggal tidak valid (2000–2200).');
  for (const [name, min, max] of [['every',1,365],['leadMinutes',0,525600],['repeatMinutes',0,525600]] as const) {
    if (!Number.isInteger(input[name]) || input[name] < min || input[name] > max) throw new Error('Interval jadwal tidak valid.');
  }
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > 1e15) throw new Error('Nominal tidak valid.');
  if (typeof input.notes !== 'string' || input.notes.length > 10000 || !['IDR','USD','EUR','SGD'].includes(input.currency)) throw new Error('Detail tidak valid.');
  if (typeof input.windows !== 'boolean' || typeof input.discord !== 'boolean' || (!input.windows && !input.discord)) throw new Error('Pilih minimal satu kanal notifikasi.');
}
