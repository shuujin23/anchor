import { Store } from './store';
import { afterNotice, Reminder } from './schedule';
const tokenFor = (r: Reminder) => JSON.stringify([r.due,r.nextNotify,r.windows,r.discord,r.title,r.mode,r.recurrence,r.every,r.unit,r.leadMinutes,r.repeatMinutes]);
export async function deliverDue(store: Store, sendWindows: (title:string,body:string)=>void, sendDiscord: (body:string)=>Promise<void>, now = new Date()) {
  const due = store.reminders().filter(r=>r.enabled&&!r.completed&&r.nextNotify&&Date.parse(r.nextNotify)<=now.getTime()).sort((a,b)=>a.nextNotify!.localeCompare(b.nextNotify!)).slice(0,5);
  for (const r of due) {
    const token=tokenFor(r), pendingKey='delivery:'+r.id;
    let pending=JSON.parse(store.get(pendingKey)||'{}');
    if(pending.token!==token) pending={token,windows:false,discord:false,attempts:0,retryAt:0};
    if(pending.retryAt>now.getTime()) continue;
    try {
      const body = r.mode === 'ongoing'
        ? `Task: ${r.title}\nPengingat terjadwal ${new Date(r.nextNotify!).toLocaleString('id-ID')}. Tanpa deadline; tandai Selesai di Anchor untuk menghentikan seluruh pengulangan.`
        : `${r.kind==='bill'?'Tagihan':'Task'}: ${r.title}\nJatuh tempo ${new Date(r.due).toLocaleString('id-ID')}. Buka Anchor untuk menyelesaikan atau snooze.`;
      if(r.windows&&!pending.windows){sendWindows('Anchor · Pengingat',body);pending.windows=true;store.set(pendingKey,JSON.stringify(pending));store.persist();}
      if(r.discord&&!pending.discord){await sendDiscord(body);pending.discord=true;}
      const fresh=store.reminders().find(x=>x.id===r.id);
      if(fresh&&fresh.enabled&&!fresh.completed&&tokenFor(fresh)===token){
        fresh.lastNotified=now.toISOString();fresh.nextNotify=afterNotice(fresh,now);
        store.transaction(()=>{store.putReminder(fresh);store.set(pendingKey,'{}');store.set('lastDeliveryError','');});
      }
    } catch(error) {
      pending.attempts++;pending.retryAt=now.getTime()+Math.min(30,2**Math.min(pending.attempts,5))*60000;
      store.transaction(()=>{store.set(pendingKey,JSON.stringify(pending));store.set('lastDeliveryError',(error as Error).message+' Pengiriman akan dicoba lagi otomatis.');});
    }
  }
}
