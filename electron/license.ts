import { verify } from 'node:crypto';
import { Store } from './store';
import { LICENSE_PUBLIC_KEY } from './license-public';
export function verifyLicense(token: unknown, publicKey = LICENSE_PUBLIC_KEY): {name:string;id:string} | null {
  try {
    if(typeof token !== 'string' || token.length > 4096) return null;
    const [prefix,payload,signature,...extra]=token.trim().split('.');
    if(prefix!=='ANCHOR1'||extra.length||!payload||!signature||!verify(null,Buffer.from(payload),publicKey,Buffer.from(signature,'base64url')))return null;
    const p=JSON.parse(Buffer.from(payload,'base64url').toString());
    if(p.v!==1||p.feature!=='google-sheets-sync'||typeof p.name!=='string'||!p.name||p.name.length>120||typeof p.id!=='string'||!p.id)return null;
    return {name:p.name,id:p.id};
  }catch{return null;}
}
export class License {
  constructor(private store:Store){}
  state(){const license=verifyLicense(this.store.get('sheets.license'));return {active:!!license,name:license?.name ?? ''};}
  require(){if(!this.state().active)throw new Error('Aktivasi Google Sheets Sync diperlukan.');}
  activate(token:unknown){if(!verifyLicense(token))throw new Error('Key aktivasi tidak valid.');this.store.transaction(()=>this.store.set('sheets.license',(token as string).trim()));}
}
