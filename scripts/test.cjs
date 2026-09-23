const fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>{const source=fs.readFileSync(filename,'utf8');module._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);};
require('../tests/core.test.ts');
require('../tests/automatic-backup.test.ts');
require('../tests/updates.test.cjs');
require('../tests/runbooks.test.ts');
