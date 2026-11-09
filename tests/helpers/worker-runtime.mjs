// Test-only bridge for synchronous VM fixtures. Resolve actual ESM dependencies
// before creating a VM; never silently discard an unrecognized import.
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';

export async function prepareWorker({url=new URL('../../src/service-worker.js',import.meta.url),load=specifier=>import(specifier),source}={}){
  source??=fs.readFileSync(url,'utf8');
  const bindings={},imports=[];
  const body=source.replace(/^import[^\r\n]*(?:\r?\n|$)/gmu,line=>{
    const named=/^import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+)['"];\s*$/u.exec(line);
    const side=/^import\s*['"](\.\/[^'"]+)['"];\s*$/u.exec(line);
    if(named){imports.push({path:named[2],names:named[1].split(',').map(s=>s.trim())});}
    else if(side&&['./theme.js','./purchase-transfer.js'].includes(side[1]))imports.push({path:side[1],sideEffect:true});
    else throw Error('Unsupported worker import: '+line.trim());
    return '';
  });
  if(/^\s*import\b/mu.test(body))throw Error('Unresolved worker import syntax');
  for(const entry of imports){
    const target=new URL(entry.path,url);
    if(entry.sideEffect){entry.source=fs.readFileSync(target,'utf8');continue;}
    let module;try{module=await load(target.href);}catch(error){throw Error('Worker dependency could not load: '+entry.path,{cause:error});}
    for(const name of entry.names){
      if(!/^[A-Za-z_$][\w$]*$/u.test(name)||typeof module?.[name]!=='function')throw Error('Missing or invalid worker dependency: '+entry.path+' export '+name);
      if(Object.hasOwn(bindings,name))throw Error('Duplicate worker binding: '+name);
      bindings[name]=module[name];
    }
  }
  return {imports:imports.map(({path,names,sideEffect})=>({path,names,sideEffect})),source:body,
    run(globals,{prelude='',expression='({ importPurchases, syncStore })'}={}){
      for(const name of Object.keys(bindings))if(Object.hasOwn(globals,name))throw Error('Worker dependency override: '+name);
      return vm.runInNewContext(`${prelude}\n${imports.filter(i=>i.sideEffect).map(i=>i.source).join('\n')}\n${body}\n;${expression}`,{...globals,...bindings},{filename:url.href});
    }};
}

export function workerSourceURL(){
  return process.env.FAN_WORKER_TEST_OVERLAY
    ?new URL('service-worker.js',pathToFileURL(process.env.FAN_WORKER_TEST_OVERLAY.replace(/[\\/]?$/u,'/')))
    :new URL('../../src/service-worker.js',import.meta.url);
}
