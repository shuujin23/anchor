// Owner-only CLI. The private signing key must stay outside the application repository.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const [command,keyFile,output,label='Anchor user']=process.argv.slice(2);
if(!keyFile||!output||!['init','issue'].includes(command))throw Error('Usage: node scripts/license-tool.cjs init <private-key-outside-repo> <public-ts-output> | issue <private-key> <license-output> [name]');
const root=path.resolve(__dirname,'..'), keyPath=path.resolve(keyFile);
if(keyPath===root||keyPath.startsWith(root+path.sep))throw Error('Private key must be outside the repository.');
if(command==='init'){
 if(fs.existsSync(keyPath)||fs.existsSync(output))throw Error('Refusing to overwrite signing keys.');
 const pair=crypto.generateKeyPairSync('ed25519');fs.mkdirSync(path.dirname(keyPath),{recursive:true});
 fs.writeFileSync(keyPath,pair.privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 fs.writeFileSync(output,'export const LICENSE_PUBLIC_KEY = '+JSON.stringify(pair.publicKey.export({type:'spki',format:'pem'}).toString())+';\n',{flag:'wx'});
}else{
 const payload=Buffer.from(JSON.stringify({v:1,feature:'google-sheets-sync',id:crypto.randomUUID(),name:label.slice(0,120),issuedAt:new Date().toISOString()})).toString('base64url');
 const signature=crypto.sign(null,Buffer.from(payload),fs.readFileSync(keyPath)).toString('base64url');
 fs.writeFileSync(output,'ANCHOR1.'+payload+'.'+signature+'\n',{flag:'wx',mode:0o600});
}
console.log('Saved: '+path.resolve(output));
