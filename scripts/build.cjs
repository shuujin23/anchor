const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..');process.chdir(root);
function run(file,args){const r=cp.spawnSync(file,args,{stdio:'inherit',cwd:root});if(r.error)throw r.error;if(r.status)process.exit(r.status);}
run(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.json']);
run(process.execPath,['node_modules/typescript/bin/tsc','-p','tsconfig.electron.json']);
const binary=process.platform==='win32'?'node_modules/@esbuild/win32-x64/esbuild.exe':'node_modules/@esbuild/linux-x64/bin/esbuild';
fs.mkdirSync('dist',{recursive:true});
run(path.resolve(binary),['src/main.tsx','--bundle','--minify','--outfile=dist/app.js','--platform=browser','--target=chrome130']);
fs.writeFileSync('dist/index.html',fs.readFileSync('index.html','utf8').replace('<script type="module" src="/src/main.tsx"></script>','<link rel="stylesheet" href="./app.css"/><script type="module" src="./app.js"></script>'));
