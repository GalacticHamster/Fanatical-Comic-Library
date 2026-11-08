// Real installed developer-package upgrade, using preserved release ZIPs.
// Synthetic local data only; no provider account, requests or personal profile.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as pause} from 'node:timers/promises';
import {createRelease,readRuntimeZip} from '../scripts/release.mjs';
import {chromePipe,firefoxMarionette,freePort} from './native-protocol.mjs';
import {quotaProduct,quotaBaseline} from './fixtures/storage-quota.mjs';

const firefox=process.argv.includes('--firefox'),from=process.env.FAN_UPGRADE_FROM??'1.0.2',suffix=firefox?'-firefox':'';
assert(['1.0.0','1.0.1','1.0.2'].includes(from));
const oldZip=await readFile(new URL(`../dist/FanaticalLibrary-${from}${suffix}.zip`,import.meta.url)),oldFiles=readRuntimeZip(oldZip);
const newZip=process.env.FAN_UPGRADE_TO?await readFile(process.env.FAN_UPGRADE_TO):(await createRelease(undefined,undefined,firefox?'firefox':'chrome')).zip,newFiles=readRuntimeZip(newZip);
const oldManifest=JSON.parse(oldFiles.get('manifest.json')),nextManifest=JSON.parse(newFiles.get('manifest.json'));
assert.equal(oldManifest.version,from);assert.equal(nextManifest.version,'1.0.3');
assert(nextManifest.permissions.includes('unlimitedStorage'));
if(from==='1.0.2')assert.deepEqual(nextManifest,{...oldManifest,version:'1.0.3'},'Only version changes in the release manifest');
const temporary=await mkdtemp(join(tmpdir(),'fan-release-upgrade-')),profile=join(temporary,'profile'),stage=join(temporary,'runtime');
let child,driver,exited,session,url;
const writeStage=async files=>{for(const [name,bytes]of files){const path=join(stage,name);await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes);}};
try{
  await mkdir(profile);
  if(firefox){
    let binary=process.env.FIREFOX_BIN||'C:/Program Files/Mozilla Firefox/firefox.exe';
    if(process.platform==='win32'&&!process.env.FIREFOX_BIN){const location=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim();if(location)binary=join(location,'VFS/ProgramFiles/Firefox Package Root/firefox.exe');}
    const port=await freePort(),archive=resolve('dist',`FanaticalLibrary-${from}-firefox.zip`);
    await writeFile(join(profile,'user.js'),`user_pref("marionette.port",${port});\nuser_pref("extensions.update.enabled",false);\n`);
    child=spawn(binary,['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank'],{windowsHide:true,env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'},stdio:['ignore','pipe','pipe']});exited=new Promise(done=>child.once('exit',done));
    driver=await firefoxMarionette(port);await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});
    await driver.send('Addon:Install',{path:archive,temporary:true});await driver.send('Marionette:SetContext',{value:'chrome'});
    const response=await driver.send('WebDriver:ExecuteScript',{script:'return WebExtensionPolicy.getByID("fanatical-library@galactichamster.com").getURL("src/options.html");',args:[],newSandbox:true});url=response.value??response;
    await driver.send('Marionette:SetContext',{value:'content'});await driver.send('WebDriver:Navigate',{url});
  }else{
    await writeStage(oldFiles);
    child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});exited=new Promise(done=>child.once('exit',done));driver=chromePipe(child,{timeoutMs:60000});
    const installed=await driver.send('Extensions.loadUnpacked',{path:stage});url=`chrome-extension://${installed.id}/src/options.html`;
    const target=await driver.send('Target.createTarget',{url});session=(await driver.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;
  }
  async function evaluate(script){
    if(firefox){const response=await driver.send('WebDriver:ExecuteAsyncScript',{script:'(async()=>{'+script+'})().then(arguments[arguments.length-1],e=>arguments[arguments.length-1]({error:e.message}));',args:[],newSandbox:false});const value=response.value??response;assert.equal(value?.error,undefined,JSON.stringify(value));return value;}
    const response=await driver.send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',awaitPromise:true,returnByValue:true},session);assert.equal(response.exceptionDetails,undefined,JSON.stringify(response.exceptionDetails));return response.result.value;
  }
  async function ready(){for(let i=0;i<200;i++){try{if(await evaluate("return document.querySelector('#library-count')?.textContent.includes('stored locally');"))return;}catch{}await pause(40);}throw Error('Installed options did not become ready: '+JSON.stringify(await evaluate("return {url:location.href,text:document.body?.innerText?.slice(0,1200)};")));}
  await ready();
  const seed={...quotaBaseline(),fanaticalLibraryItems:[{...quotaProduct(0),mediaType:'comic'}],fanaticalScannedOrderFingerprints:['1'.padStart(64,'0')],fanaticalLastScanAttempt:{status:'incomplete',scanMode:'quick',attemptedAt:'2026-01-16T12:00:00.000Z'},galacticLibraryExtensionId:'b'.repeat(32),galacticHamsterAppearance:{version:1,mode:'dark'}};
  const before=await evaluate(`await chrome.storage.local.set(${JSON.stringify(seed)});return await chrome.storage.local.get(null);`);
  const backup=await evaluate("const r=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'backup',args:[]});if(!r.ok)throw Error(r.error);return r.result;");
  console.log(`PASS ${from}: installed baseline retains library, history, profiles, corrections, fingerprints, incomplete attempt and companion settings`);
  if(firefox){await driver.send('WebDriver:Navigate',{url:'about:blank'});const archive=process.env.FAN_UPGRADE_TO??join(temporary,'new.zip');if(!process.env.FAN_UPGRADE_TO)await writeFile(archive,newZip);await driver.send('Addon:Install',{path:archive,temporary:true});await driver.send('WebDriver:Navigate',{url});}
  else{await writeStage(newFiles);const reloaded=await driver.send('Extensions.loadUnpacked',{path:stage});assert.equal('chrome-extension://'+reloaded.id+'/src/options.html',url);const target=await driver.send('Target.createTarget',{url});session=(await driver.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;}
  await ready();
  assert.deepEqual(await evaluate('return await chrome.storage.local.get(null);'),before,'Upgrade must preserve the entire stored state');
  assert.equal(await evaluate('return chrome.runtime.getManifest().version;'),'1.0.3');
  assert.equal(await evaluate("return await chrome.permissions.contains({permissions:['unlimitedStorage']});"),true);
  console.log(`PASS ${from}: same-identity installed upgrade to 1.0.3 preserves all storage and unlimitedStorage`);
  const result=await evaluate(`const {createSyncStore,parseLibraryBackup}=await import('./library-data.mjs');const store=createSyncStore(chrome.storage.local);const backup=${JSON.stringify(backup)};if(parseLibraryBackup(backup).length!==1)throw Error('Old backup unreadable');const scan=await store.execute('begin',[{reuseAccount:true,accountId:${JSON.stringify(seed.fanaticalAccountId)},profileLabel:'fixture',confirmed:true},99]);if(scan.forceFull)throw Error('Valid old checkpoints lost');await store.execute('failure',[scan.token,null,99]);return true;`);
  assert.equal(result,true);console.log(`PASS ${from}: old backup parses and existing per-order authority remains usable`);
  const updated=await evaluate(`const {createSyncStore}=await import('./library-data.mjs');const s=createSyncStore(chrome.storage.local);const scan=await s.execute('begin',[{reuseAccount:true,accountId:${JSON.stringify(seed.fanaticalAccountId)},profileLabel:'fixture',confirmed:true},99]);await s.execute('commit',[scan.token,{fanaticalLibraryItems:[...scan.state.fanaticalLibraryItems,${JSON.stringify(quotaProduct(1))}],fanaticalScannedOrderFingerprints:scan.state.fanaticalScannedOrderFingerprints,fanaticalImportSummary:{...scan.state.fanaticalImportSummary,scanMode:'quick'},fanaticalLastScanAttempt:{status:'complete',scanMode:'quick'}},99]);return (await chrome.storage.local.get('fanaticalLibraryItems')).fanaticalLibraryItems;`);assert.equal(updated.length,2);assert.equal(updated.find(i=>i.sourceItemId==='quota-product-0').mediaType,'comic');
  console.log(`PASS ${from}: post-upgrade incremental writer preserves the existing corrected purchase`);
  for(const malformed of [null,{scanMode:'invalid'}]){
    const forced=await evaluate(`await chrome.storage.local.set({fanaticalImportSummary:${JSON.stringify(malformed)},fanaticalLastScanAttempt:null});const {createSyncStore}=await import('./library-data.mjs');const s=createSyncStore(chrome.storage.local);const scan=await s.execute('begin',[{reuseAccount:true,accountId:${JSON.stringify(seed.fanaticalAccountId)},profileLabel:'fixture',confirmed:true},99]);await s.execute('failure',[scan.token,null,99]);return scan.forceFull;`);assert.equal(forced,true);
  }
  console.log(`PASS ${from}: missing/invalid initialization selects Full without losing purchases`);
  await evaluate(`const r=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'restore',args:[${JSON.stringify(backup)}]});if(!r.ok)throw Error(r.error);return true;`);
  const restored=await evaluate("return await chrome.storage.local.get(['fanaticalLibraryItems','mediaTypeOverrides','fanaticalProfileArchives','fanaticalScannedOrderFingerprints','fanaticalImportSummary']);");
  assert.equal(restored.fanaticalLibraryItems[0].sourceItemId,'quota-product-0');assert.equal(restored.mediaTypeOverrides['quota-product-0'],'comic');assert.equal(restored.fanaticalProfileArchives.length,1);assert.deepEqual(restored.fanaticalScannedOrderFingerprints,[]);assert.equal(restored.fanaticalImportSummary,null);
  console.log(`PASS ${from}: restored backup preserves purchases/corrections/profiles and resets private checkpoint authority`);
  // Run the actual installed package's acquisition/validation/writer in each
  // native engine too. Fetch is synthetic; Firefox provider MAIN admission is
  // separately covered by the packaged-browser serialized-function checks.
  const acquired=await evaluate(`
    const {importFanaticalOrdersInPage:acquire}=await import('./order-importer.mjs');
    const {createSyncStore,validateScanResult}=await import('./library-data.mjs');
    const originalFetch=window.fetch,originalAuth=localStorage.getItem('bsauth');
    const games=Array.from({length:47},(_,i)=>({_id:'upgrade-product-'+i,name:'Synthetic book '+i,type:'book'}));
    const order={_id:'upgrade-order-47',status:'COMPLETE',items:[{_id:'upgrade-bundle-47',name:'Synthetic bundle',bundles:[{games}]}]};
    const summary={_id:order._id,status:'COMPLETE',items:[{name:'Synthetic bundle',bundles:[{games:games.map(({name})=>({name}))}]}]};
    const paths=[],store=createSyncStore(chrome.storage.local),results=[];
    await chrome.storage.local.set({fanaticalLibraryItems:[],fanaticalHistoricalItems:[],fanaticalScannedOrderFingerprints:[],fanaticalImportSummary:null,fanaticalLastScanAttempt:null});
    try{
      localStorage.setItem('bsauth',JSON.stringify({token:'SYNTHETIC'}));
      window.fetch=async path=>{paths.push(path);return new Response(JSON.stringify(path==='/api/user/orders'?[summary]:order),{status:200,headers:{'content-type':'application/json'}});};
      for(const fullScan of [false,false,true]){
        paths.length=0;const scan=await store.execute('begin',[{profileLabel:'fixture',confirmed:true,fullScan},99]);
        const actualFull=fullScan||scan.forceFull,known=scan.state.fanaticalScannedOrderFingerprints;
        const receipt=validateScanResult(await acquire({allowPartial:true,returnFailure:true,fullScan:actualFull,knownOrderFingerprints:known}),{fullScan:actualFull,knownOrderFingerprints:known});
        const saved=await store.execute('commitPartial',[scan.token,receipt,99]);
        const state=await chrome.storage.local.get(['fanaticalLibraryItems','fanaticalImportSummary']);
        results.push({mode:saved.scanMode,verified:saved.verifiedPurchasesSaved,added:saved.addedProducts,finished:saved.acquisitionComplete,coverage:receipt.coverage.complete,count:state.fanaticalLibraryItems.length,completeSummary:state.fanaticalImportSummary,requests:paths.length});
      }
      return results;
    }finally{window.fetch=originalFetch;if(originalAuth===null)localStorage.removeItem('bsauth');else localStorage.setItem('bsauth',originalAuth);}
  `);
  assert.deepEqual(acquired,[
    {mode:'full',verified:1,added:47,finished:true,coverage:false,count:47,completeSummary:null,requests:2},
    {mode:'quick',verified:0,added:0,finished:true,coverage:false,count:47,completeSummary:null,requests:1},
    {mode:'full',verified:1,added:0,finished:true,coverage:false,count:47,completeSummary:null,requests:2}
  ]);
  if(firefox)await driver.send('WebDriver:Navigate',{url});else{await driver.send('Page.enable',{},session);await driver.send('Page.reload',{},session);}
  await ready();assert.match(await evaluate("return document.querySelector('#history-note').textContent;"),/^Last import finished successfully[.]/);
  assert.equal(await evaluate("return document.querySelector('#history-note').textContent.includes('Last scan was partial');"),false);
  console.log(`PASS ${from}: actual installed package saves one headerless purchase and 47 products without false coverage`);
  console.log(`PASS ${from}: installed Quick skips verified details and Full revalidates without product duplication`);
  console.log(`8 installed ${firefox?'Firefox':'Chrome'} upgrade checks passed (${from} -> 1.0.3).`);
}finally{
  if(firefox&&driver)try{await driver.send('Marionette:Quit',{flags:['eForceQuit']});}catch{}
  child?.kill();driver?.close?.();if(exited)await exited;
  const target=resolve(temporary);if(!target.startsWith(resolve(tmpdir())+sep)||!target.includes('fan-release-upgrade-'))throw Error('Unsafe test cleanup');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
