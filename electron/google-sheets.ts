import { createPrivateKey, createHash, sign } from 'node:crypto';
export type ServiceCredential = {client_email:string;private_key:string};
export type SheetTarget = {spreadsheetId:string;sheetId:number;pic:string;timeZone:string};
export type SheetRow = {taskId:string;title:string;date:number;hours:number|null;notes:string};
export type SheetInfo = {title:string;timeZone:string;sheets:{id:number;title:string}[]};
export interface SheetsAPI { inspect(id:string):Promise<SheetInfo>; upsert(target:SheetTarget,row:SheetRow,known:boolean,allowed:()=>boolean):Promise<void>; }
export function parseCredential(raw:string):ServiceCredential {
  try {const k=JSON.parse(raw);if(k.type!=='service_account'||typeof k.client_email!=='string'||!k.client_email.endsWith('.iam.gserviceaccount.com')||typeof k.private_key!=='string'||createPrivateKey(k.private_key).asymmetricKeyType!=='rsa')throw Error();return {client_email:k.client_email,private_key:k.private_key};}catch{throw new Error('File harus berupa JSON service account Google yang valid.');}
}
export function spreadsheetId(value:unknown):string {
  if(typeof value!=='string')throw new Error('URL spreadsheet tidak valid.');
  const id=value.trim().match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? value.trim();
  if(!/^[\w-]{20,150}$/.test(id))throw new Error('URL atau ID spreadsheet tidak valid.');return id;
}
export function sheetDate(iso:string,timeZone:string):number {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(iso));
  const n=(key:string)=>Number(parts.find(p=>p.type===key)!.value);
  return (Date.UTC(n('year'),n('month')-1,n('day'))-Date.UTC(1899,11,30))/86400000;
}
const header=['No.','Task','Tanggal Mengerjakan','Manhours','Catatan'];
export class GoogleSheets implements SheetsAPI {
  private token='';private expires=0;
  constructor(private credential:ServiceCredential,private http:typeof fetch=fetch){}
  private async access(){
    if(this.token&&Date.now()<this.expires)return this.token;
    const enc=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
    const data=enc({alg:'RS256',typ:'JWT'})+'.'+enc({iss:this.credential.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
    let response:Response;
    try{response=await this.http('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:data+'.'+sign('RSA-SHA256',Buffer.from(data),this.credential.private_key).toString('base64url')})});}catch{throw new Error('Tidak dapat menghubungi Google. Periksa koneksi.');}
    if(!response.ok)throw new Error('Autentikasi Google gagal. Periksa credential dan jam komputer.');
    const result=await response.json() as any;if(typeof result.access_token!=='string')throw new Error('Respons autentikasi Google tidak valid.');
    this.token=result.access_token;this.expires=Date.now()+3000000;return this.token;
  }
  private async request(id:string,suffix:string,body?:unknown){
    const token=await this.access();let response:Response;
    try{response=await this.http(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId(id)}${suffix}`,{method:body===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}catch{throw new Error('Google Sheets tidak terhubung. Perubahan akan dicoba lagi.');}
    if(!response.ok){if(response.status===401){this.token='';this.expires=0;}throw new Error(response.status===403?'Akses Google ditolak. Pastikan service account memiliki izin Editor dan Sheets API aktif.':response.status===404?'Spreadsheet atau tab tujuan tidak ditemukan.':response.status===429?'Batas Google API tercapai. Akan dicoba lagi otomatis.':`Google Sheets gagal (HTTP ${response.status}). Periksa akses dan struktur sheet.`);}
    return response.json() as Promise<any>;
  }
  async inspect(id:string):Promise<SheetInfo>{
    const data=await this.request(id,'?fields=properties(title,timeZone),sheets(properties(sheetId,title,sheetType))');
    return {title:data.properties.title,timeZone:data.properties.timeZone,sheets:data.sheets.filter((s:any)=>s.properties.sheetType==='GRID').map((s:any)=>({id:s.properties.sheetId,title:s.properties.title}))};
  }
  async upsert(target:SheetTarget,row:SheetRow,known:boolean,allowed:()=>boolean){
    const info=await this.inspect(target.spreadsheetId),sheet=info.sheets.find(s=>s.id===target.sheetId);
    if(!sheet)throw new Error('Tab PIC tujuan sudah tidak tersedia.');
    if(info.timeZone!==target.timeZone)throw new Error('Zona waktu spreadsheet berubah. Periksa pengaturan sebelum sinkronisasi.');
    const range="'"+sheet.title.replaceAll("'","''")+"'!A1:E1";
    const values=await this.request(target.spreadsheetId,'/values/'+encodeURIComponent(range));
    if(header.some((text,i)=>values.values?.[0]?.[i]!==text))throw new Error('Header PIC harus: No., Task, Tanggal Mengerjakan, Manhours, Catatan.');
    const lookup={metadataKey:'anchor.taskId',metadataValue:row.taskId,visibility:'DOCUMENT'};
    const found=await this.request(target.spreadsheetId,'/developerMetadata:search',{dataFilters:[{developerMetadataLookup:lookup}]});
    const matches=found.matchedDeveloperMetadata ?? [];
    if(matches.length>1)throw new Error('Identitas task duplikat di spreadsheet. Periksa baris sebelum mencoba lagi.');
    if(!allowed())return;
    if(matches.length){
      const metadata=matches[0].developerMetadata,location=metadata.location?.dimensionRange;
      if(location?.sheetId!==target.sheetId||location?.dimension!=='ROWS'||location.startIndex<1||location.endIndex!==location.startIndex+1)throw new Error('Baris task berpindah ke lokasi yang tidak sesuai.');
      // RAW prevents task titles/notes from being interpreted as formulas. Null preserves No.
      await this.request(target.spreadsheetId,'/values:batchUpdateByDataFilter',{valueInputOption:'RAW',data:[{dataFilter:{developerMetadataLookup:{metadataId:metadata.metadataId}},majorDimension:'ROWS',values:[[null,row.title,row.date,row.hours ?? '',row.notes]]}]});
    }else{
      if(known)throw new Error('Baris tersinkron hilang atau identitasnya dihapus. Pulihkan baris beserta metadata sebelum mencoba lagi.');
      // Insert a dedicated row below the header and attach identity in the same atomic request.
      // Insertion avoids overwriting manually entered rows or concurrent writers.
      const metadataId=(createHash('sha256').update(row.taskId).digest().readUInt32BE(0)&0x7fffffff)||1;
      await this.request(target.spreadsheetId,':batchUpdate',{requests:[
        {insertDimension:{range:{sheetId:target.sheetId,dimension:'ROWS',startIndex:1,endIndex:2},inheritFromBefore:false}},
        {updateCells:{start:{sheetId:target.sheetId,rowIndex:1,columnIndex:0},rows:[{values:[
          {userEnteredValue:{formulaValue:'=ROW()-1'}},{userEnteredValue:{stringValue:row.title}},
          {userEnteredValue:{numberValue:row.date},userEnteredFormat:{numberFormat:{type:'DATE',pattern:'dd/mm/yyyy'}}},
          {...(row.hours===null?{}:{userEnteredValue:{numberValue:row.hours}}),userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0.00'}}},
          {userEnteredValue:{stringValue:row.notes}}
        ]}],fields:'userEnteredValue,userEnteredFormat.numberFormat'}},
        {createDeveloperMetadata:{developerMetadata:{metadataId,metadataKey:'anchor.taskId',metadataValue:row.taskId,visibility:'DOCUMENT',location:{dimensionRange:{sheetId:target.sheetId,dimension:'ROWS',startIndex:1,endIndex:2}}}}}
      ]});
    }
  }
}
