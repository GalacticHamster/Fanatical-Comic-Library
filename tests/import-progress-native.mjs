import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';import {access,mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';import {createServer} from 'node:http';import {tmpdir} from 'node:os';import {join,resolve,sep,dirname} from 'node:path';import {setTimeout as pause} from 'node:timers/promises';import {chromePipe,freePort,firefoxMarionette} from './native-protocol.mjs';import {createRelease,runtimeZip,readRuntimeZip} from '../scripts/release.mjs';
import {verifyStandaloneFanaticalReminders,verifyFanaticalKeyCompatibility,verifyFanaticalKeyReminders,verifyFanaticalNativeSync} from '../../GalacticLibrary/tests/fanatical-native-sync.mjs';
import {createRelease as glRelease,readRuntimeZip as readGLZip} from '../../GalacticLibrary/scripts/release.mjs';
import {candidateFiles} from '../../GalacticLibrary/tests/provider-candidate-build.mjs';
const firefox=process.argv.includes('--firefox'),release=await createRelease(undefined,undefined,firefox?'firefox':'chrome');
const legacyPeer=process.argv.includes('--legacy-peer'),legacyKeys=legacyPeer||process.argv.includes('--pre-key-observations')||process.argv.includes('--observation-peer');
const sourceFiles=legacyKeys?readRuntimeZip(await readFile(process.env.FAN_LEGACY_RUNTIME_PACKAGE??(()=>{throw Error('Explicit legacy FAN runtime package required');})())):release.files;
const files=process.argv.includes('--candidate')?await candidateFiles('FAN',sourceFiles):new Map(sourceFiles);
const baseline=process.argv.includes('--baseline');
if(baseline)for(const name of ['src/content.js','src/order-importer.mjs','src/service-worker.js','src/shared.js'])files.set(name,execFileSync('git',['show','ea494ce6c0d8232142d519c4552243fc43062e21:'+name],{windowsHide:true,maxBuffer:8*1024*1024}));
let sixOrders=false,directGames=false,directKeysPresent=false,mixedSummary=false;
const baseOrder=n=>directGames&&n===size-1?{_id:'synthetic-order-'+n,status:'COMPLETE',date:'2026-11-01',items:Array.from({length:10},(_,i)=>({_id:'direct-game-'+i,name:'Selected '+i,type:'game',status:'fulfilled',bundles:[],pickAndMix:'Synthetic pick and mix',drm:{steam:true},...(directKeysPresent?{key:'SYNTHETIC_SECRET_DO_NOT_RETAIN'}:{})}))}:({_id:'synthetic-order-'+n,status:'COMPLETE',date:'2026-10-01T00:00:00Z',items:[{_id:'bundle-123456',name:'Synthetic',bundles:[{games:sixOrders?Array.from({length:8},(_,j)=>({_id:'six-product-'+n+'-'+j,name:'Synthetic '+n+' '+j,type:n===2?'comic':'game'})):[{_id:'synthetic-product-'+n,name:'Synthetic '+n,type:'book'}]}]}]});
const order=n=>{const o=baseOrder(n);if(mixedSummary&&n===size-1)o.items.push(...[1,2].map(i=>({_id:'mixed-bundle-'+i,name:'Mixed comic bundle '+i,bundles:[{games:[{_id:'mixed-comic-'+i,name:'Mixed comic '+i,type:'comic'}]}]})));return o;};
let size=3,delay=0,fail=false,denied=false,retry=false,headerless=false,summaryIssues=false,reorderedDuplicate=false,sparseSummary=false,sparseDetailFailure=false,counts={lists:0,details:0,completed:0,failed:0},attempts=new Map();
const thin=o=>({...o,items:o.items.map((p,i)=>mixedSummary&&i===0?p:({name:p.name,bundles:[]}))});
const summaryRows=()=>{const rows=Array.from({length:size},(_,i)=>summaryIssues&&i===1?{...order(i),status:'UNKNOWN_STATUS'}:summaryIssues&&i===2?{...order(i),items:[{...order(i).items[0],bundles:[],products:[{name:'PRIVATE_TITLE',_id:'PRIVATE_ID'}],tiers:[{quantity:1}]}]}:order(i));if(sixOrders)for(let n=3;n<rows.length;n++)rows[n].items[0].bundles={};if(sparseSummary&&rows.length)rows[rows.length-1]=thin(rows.at(-1));if(reorderedDuplicate&&rows.length)rows.push(Object.fromEntries(Object.entries(rows[0]).reverse()));return rows;};
const server=createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');if(req.url.startsWith('/api/user/orders')){const list=!req.url.includes('/orders/'),i=Number(req.url.split('-').at(-1));if(list)counts.lists++;else {counts.details++;const attempt=(attempts.get(i)??0)+1;attempts.set(i,attempt);await pause(delay*(1+(i%3)/3));if(denied||fail&&i===size-1||retry&&i===0&&attempt===1){res.statusCode=denied?401:fail?404:503;counts.failed++;res.end('{}');return;}counts.completed++;}if(list&&!headerless)res.setHeader('x-total-count',String(size));res.end(JSON.stringify(list?summaryRows():sparseDetailFailure&&i===size-1?thin(order(i)):order(i)));return;}res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body><script>localStorage.setItem("bsauth",JSON.stringify({token:"SYNTHETIC-ONLY"}));</script></body></html>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const manifest=JSON.parse(files.get('manifest.json'));for(const entry of manifest.content_scripts)entry.matches=entry.matches.map(p=>p==='https://www.fanatical.com/*'?'http://127.0.0.1/*':p);manifest.host_permissions.push('http://127.0.0.1/*');files.set('manifest.json',Buffer.from(JSON.stringify(manifest)));
for(const name of ['src/content.js','src/order-importer.mjs','src/service-worker.js','src/library-data.mjs','src/shared.js'])files.set(name,Buffer.from(files.get(name).toString().replaceAll('https://www.fanatical.com',origin)));
files.set('src/service-worker.js',Buffer.from(files.get('src/service-worker.js').toString().replaceAll(String.raw`/^https:\/\/www\.fanatical\.com\/`,String.raw`/^http:\/\/127\.0\.0\.1:\d+\/`)));
files.set('src/content.js',Buffer.from('globalThis.confirm=()=>true;document.documentElement.dataset.testReportUrl=chrome.runtime.getURL("test-report.html");URL.createObjectURL=function(b){b.text().then(t=>document.documentElement.dataset.testExport=t);return "blob:synthetic";};HTMLAnchorElement.prototype.click=function(){};\n'+files.get('src/content.js')));
files.set('src/service-worker.js',Buffer.from(files.get('src/service-worker.js').toString().replace('const syncStore=',"let testWrites=[];const testSet=chrome.storage.local.set.bind(chrome.storage.local);chrome.storage.local.set=async p=>{await testSet(p);testWrites.push({keys:Object.keys(p),bytes:new TextEncoder().encode(JSON.stringify(p)).length});};chrome.runtime.onMessage.addListener((r,s,reply)=>{if(r?.type==='TEST_WRITES'){reply(testWrites);return false;}});const syncStore=")));
files.set('test-report.html',Buffer.from('<html><script type="module" src="test-report.js"></script></html>'));files.set('test-report.js',Buffer.from('const stored=await chrome.storage.local.get(null);document.documentElement.dataset.result=JSON.stringify({count:(stored.fanaticalLibraryItems??[]).length,items:stored.fanaticalLibraryItems??[],history:stored.fanaticalHistoricalItems??[],fingerprints:stored.fanaticalScannedOrderFingerprints??[],summary:stored.fanaticalImportSummary??null,accountId:stored.fanaticalAccountId,writes:await chrome.runtime.sendMessage({type:"TEST_WRITES"})});'));
const central=process.argv.includes('--central');
const centralInput=central?(process.argv.includes('--legacy-central')
  ?readGLZip(await readFile(process.env.GL_LEGACY_RUNTIME_PACKAGE??(()=>{throw Error('Explicit legacy GL runtime package required');})()))
  :(await glRelease(undefined,undefined,firefox?'firefox':'chrome')).files):null;
const centralFiles=central?(process.argv.includes('--candidate')&&!process.argv.includes('--legacy-central')?await candidateFiles('GL',centralInput):new Map(centralInput)):null;
const temporary=await mkdtemp(join(tmpdir(),'fan-progress-native-'));let child,driver,session,exited,fanId,centralId;
try{
  const profile=join(temporary,'profile'),stage=join(temporary,'extension');await mkdir(profile);await mkdir(stage);
  for(const [name,bytes]of files){const target=join(stage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  const candidates=firefox?[process.env.FIREFOX_BIN,'C:/Program Files/Mozilla Firefox/firefox.exe']:[process.env.CHROME_BIN,'C:/Program Files/Google/Chrome/Application/chrome.exe'];
  if(firefox&&process.platform==='win32'){const location=execFileSync('powershell.exe',['-NoProfile','-Command','(Get-AppxPackage -Name Mozilla.Firefox).InstallLocation'],{windowsHide:true,encoding:'utf8'}).trim();if(location)candidates.push(join(location,'VFS/ProgramFiles/Firefox Package Root/firefox.exe'));}
  let binary;for(const path of candidates.filter(Boolean))try{await access(path);binary=path;break;}catch{}if(!binary)throw Error('Set CHROME_BIN or FIREFOX_BIN.');
  async function startBrowser(){const port=firefox?await freePort():0;if(firefox)await writeFile(join(profile,'user.js'),`user_pref("marionette.port",${port});\nuser_pref("extensions.update.enabled",false);\nuser_pref("toolkit.telemetry.enabled",false);\nuser_pref("network.captive-portal-service.enabled",false);\n`);
  child=spawn(binary,firefox?['--headless','--no-remote','--profile',profile,'--marionette','--remote-allow-system-access','about:blank']:['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--enable-unsafe-extension-debugging','--remote-debugging-pipe',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,env:{...process.env,...(firefox?{MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'}:{})},stdio:firefox?['ignore','pipe','pipe']:['ignore','pipe','pipe','pipe','pipe']});
  exited=new Promise(done=>child.once('exit',done));child.on('error',()=>{});driver=firefox?await firefoxMarionette(port):chromePipe(child);
  if(firefox){await driver.send('WebDriver:NewSession',{capabilities:{alwaysMatch:{browserName:'firefox'}}});const archive=join(temporary,'extension.zip');await writeFile(archive,runtimeZip(files));{const installed=await driver.send('Addon:Install',{path:archive,temporary:true});fanId=installed.value??installed;}
    if(central){const centralArchive=join(temporary,'central.zip');await writeFile(centralArchive,runtimeZip(centralFiles));const installed=await driver.send('Addon:Install',{path:centralArchive,temporary:true});centralId=installed.value??installed;}
    await driver.send('Marionette:SetContext',{value:'chrome'});
    const granted=await driver.send('WebDriver:ExecuteAsyncScript',{script:'const done=arguments[arguments.length-1];const {ExtensionPermissions}=ChromeUtils.importESModule("resource://gre/modules/ExtensionPermissions.sys.mjs");ExtensionPermissions.add(arguments[0],{permissions:[],origins:["http://127.0.0.1/*"]},WebExtensionPolicy.getByID(arguments[0]).extension).then(()=>done(true),error=>done({error:error.message}));',args:['fanatical-library@galactichamster.com'],newSandbox:true});assert.equal(granted.value??granted,true);
    await driver.send('Marionette:SetContext',{value:'content'});
  }else{fanId=(await driver.send('Extensions.loadUnpacked',{path:stage})).id;if(central){const centralStage=join(temporary,'central-extension');for(const [name,bytes]of centralFiles){const target=join(centralStage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}centralId=(await driver.send('Extensions.loadUnpacked',{path:centralStage})).id;}}}
  await startBrowser();
  async function evaluate(script){
    if(firefox){const r=await driver.send('WebDriver:ExecuteAsyncScript',{script:'(async()=>{'+script+'})().then(arguments[arguments.length-1],e=>arguments[arguments.length-1]({error:String(e)}));',args:[],newSandbox:false});const value=Object.hasOwn(r,'value')?r.value:r;assert(!value?.error,value?.error);return value;}
    const r=await driver.send('Runtime.evaluate',{expression:'(async()=>{'+script+'})()',awaitPromise:true,returnByValue:true},session);assert(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  }
  async function navigate(url){if(firefox)await driver.send('WebDriver:Navigate',{url});else{const t=await driver.send('Target.createTarget',{url});session=(await driver.send('Target.attachToTarget',{targetId:t.targetId,flatten:true})).sessionId;await driver.send('Runtime.enable',{},session);}}
  async function wait(script,message){for(let i=0;i<250;i++){const v=await evaluate(script);if(v)return v;await pause(100);}const state=await evaluate('return {ready:document.readyState,status:document.querySelector("#galactic-library-fanatical-importer")?.shadowRoot?.querySelector("[data-import-status]")?.textContent};');
    if(message==='Local dismissal did not reach GL')try{
      const diagnostic=await evaluate(`const reply=await chrome.runtime.sendMessage({type:'GH_PURCHASE_ACTION',provider:'fanatical',action:'syncState'}),s=reply.state;const S=await import('./src/lib/storage.js'),R=await import('./src/lib/reminders.js'),db=await S.getDatabase();return {pending:R.libraryReminders(db).filter(r=>r.provider==='fanatical'&&r.keyStatus==='unrevealed').length,sync:s?{status:s.status,pending:s.pending,errorCode:s.errorCode,staleSnapshot:s.error==='Saved account data changed. Refresh the account choices and confirm again.',confirmed:s.confirmed,remoteConfirmed:s.remoteConfirmed}:null};`);console.log('REMINDER FAILURE '+JSON.stringify(diagnostic));
      await navigate(reportUrl.replace('test-report.html','src/options.html'));await wait('return !!globalThis.LibraryBrowser;','Reminder diagnostic page readiness');
      console.log('FAN REMINDER FAILURE '+JSON.stringify(await evaluate(`const D=await import('./library-data.mjs'),raw=await chrome.storage.local.get(null),rows=D.localKeyReminders(raw.fanaticalLibraryItems??[]),s=raw.galacticPurchaseSync?.fanatical;return {pending:rows.filter(r=>!r.hidden).length,reviews:rows.slice(0,20).map(r=>({action:r.review?.action??null,time:r.review?.updatedAt??null})),sync:s?{pending:s.pending,status:s.status,confirmed:s.confirmed,remoteConfirmed:s.remoteConfirmed,errorCode:s.errorCode}:null};`)));
    }catch{console.log('REMINDER FAILURE diagnostics unavailable; original assertion retained');}
    throw Error(message+' '+JSON.stringify(state));}


 const root='document.querySelector("#fanatical-library-importer")',checks=[];let reportUrl,centralOptionsUrl;
 for(const scenario of [{name:'small',n:3,ms:0},{name:'large',n:90,ms:0},{name:'slow',n:12,ms:250},{name:'waiting',n:3,ms:3000},{name:'retry',n:3,ms:0,retry:true},{name:'partial',n:6,ms:50,fail:true},{name:'fatal',n:6,ms:0,denied:true}]){
  size=scenario.n;delay=scenario.ms;fail=!!scenario.fail;denied=!!scenario.denied;retry=!!scenario.retry;attempts.clear();counts={lists:0,details:0,completed:0,failed:0};
  await navigate(origin+'/en/orders');await wait('return !!document.querySelector("#fanatical-library-importer")?.querySelector("output");','No importer');
  reportUrl=await evaluate('return document.documentElement.dataset.testReportUrl;');
  await evaluate('window.confirm=()=>true;window.testStates=[];window.testProgress=[];const s='+root+';new MutationObserver(()=>{const t=s.querySelector("output").textContent;if(window.testStates.at(-1)!==t)window.testStates.push(t);}).observe(s.querySelector("output"),{childList:true,subtree:true,characterData:true});window.addEventListener("message",e=>{if(e.data?.type==="FANATICAL_IMPORT_PROGRESS")window.testProgress.push(e.data);});const button=s.querySelector("[data-import-mode=all]");button.click();if(!button.disabled)throw Error("Import did not enter its running lifecycle");return true;');
  await wait('return !'+root+'.querySelector("[data-import-mode=all]").disabled;','Import pending');
  const visible=await evaluate('return {states:window.testStates,events:window.testProgress,final:document.querySelector("#fanatical-library-importer output").textContent};');
  if(!baseline&&scenario.name==='waiting')assert(visible.states.some(t=>/seconds elapsed.*pending/.test(t)),JSON.stringify(visible));
  if(scenario.name==='partial')assert(/Saved|saved/.test(visible.final),visible.final);
  if(scenario.denied)assert(/incomplete|failed|Sign in/i.test(visible.final));else if(!baseline){assert(visible.events.some(e=>e.progress.phase==='activity'),JSON.stringify(visible));assert(visible.states.some(t=>/Comparing and saving/.test(t)),JSON.stringify(visible));}
  const diagnostic=await evaluate('const s='+root+';s.querySelector("details").open=true;const b=[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report");b.click();return true;');
  const exported=JSON.parse(await wait('return document.documentElement.dataset.testExport;','Export missing'));assert(!/SYNTHETIC|synthetic-order|synthetic-product|PRIVATE_TOKEN/.test(JSON.stringify(exported)));
  await navigate(reportUrl);const stored=JSON.parse(await wait('return document.documentElement?.dataset.result;','No records'));assert(stored.items.every(i=>i.source==='fanatical'));console.log('MEASURE '+JSON.stringify({scenario:scenario.name,counts,states:visible.states,progressEvents:visible.events.length,saved:stored.count,writes:stored.writes,exported}));checks.push(scenario.name);
 }
 console.log(checks.length+' installed FAN '+(baseline?'baseline ':'')+'progress scenarios passed.');
 if(!baseline){
   async function openOrders(){await navigate(origin+'/en/orders');await wait('return !!document.querySelector("#fanatical-library-importer")?.querySelector("output");','No importer after reload');}
   async function scan(mode,expectFailure=false){
     counts={lists:0,details:0,completed:0,failed:0};attempts.clear();
     const started=await evaluate('const button='+root+'.querySelector("[data-import-mode='+mode+']");if(button.disabled)throw Error("Already running");button.click();return button.disabled;');assert.equal(started,true,'Scan never started');
     await wait('return !'+root+'.querySelector("[data-import-mode='+mode+']").disabled;','Scan never finished');
     const text=await evaluate('return '+root+'.querySelector("output").textContent;');if(expectFailure)assert.match(text,/^Import failed\n\n[^]+Your existing library was not changed\.$/);else{
       const paragraphs=text.split('\n\n');assert.equal(paragraphs.length,3,'Completion must include outcome, activity and library counts');
       if(/ partially completed$/.test(paragraphs[0])){
         assert.match(paragraphs[0],/^(?:Full import|Quick update) partially completed$/);
         assert.match(paragraphs[1],/^(?:Couldn't check [\d,]+ purchases?[^\n]*|Part of your purchase list couldn't be checked[^\n]*)$/);
         assert.match(paragraphs[2],/^(?:Saved [\d,]+ purchases?[^\n]*|No purchases were saved\.[^\n]*)Your library now contains [\d,]+ items?\. Earlier records were preserved\.$/);
       }else{
         assert.match(paragraphs[0],/^(?:Full import|Quick update) completed$/);
         assert.match(paragraphs[1],/^(?:(?:Checked [\d,]+ purchases?\.|No purchases needed checking\.) (?:Imported [\d,]+ new items?\.|No new items found\.)|No purchases found in your account\.)$/);
         assert.match(paragraphs[2],/^[\d,]+ items? in your library\.$/);
       }
     }assert(counts.lists>0,'No candidate acquisition occurred');return text;
   }
   async function saved(){await navigate(reportUrl);return JSON.parse(await wait('return document.documentElement?.dataset.result;','No persisted records'));}
   denied=false;retry=false;delay=0;size=91;fail=true;await openOrders();
   await scan('all');let before=await saved();assert.equal(before.count,90);assert.equal(before.fingerprints.length,90);
   // A real page reload must retain retry eligibility for the one failed order.
   fail=false;await openOrders();await scan('new');assert.equal(counts.details,1);let after=await saved();assert.equal(after.count,91);assert.equal(after.fingerprints.length,91);assert.equal(after.accountId,before.accountId);for(const item of before.items)assert.deepEqual(after.items.find(row=>row.sourceItemId===item.sourceItemId),item);
   await openOrders();await scan('new');assert.equal(counts.details,0);before=await saved();assert.equal(before.count,91);
   // Restart the disposable browser with the same disposable profile; temporary
   // installation is restored by startBrowser, never a personal profile.
   driver.close?.();child.kill();await exited;await startBrowser();await openOrders();await scan('new');assert.equal(counts.details,0);after=await saved();assert.deepEqual(after.items,before.items);assert.deepEqual(after.fingerprints,before.fingerprints);assert.deepEqual(after.history,before.history);assert.equal(after.accountId,before.accountId);
   // The exact empty Full -> Quick transition must not clear saved authority.
   before=after;size=0;headerless=true;await openOrders();await scan('all',legacyPeer);after=await saved();assert.deepEqual(after.items,before.items);assert.deepEqual(after.fingerprints,before.fingerprints);assert.deepEqual(after.summary,before.summary);assert.deepEqual(after.history,before.history);
   await openOrders();await scan('new',legacyPeer);after=await saved();assert.deepEqual(after.items,before.items);assert.deepEqual(after.fingerprints,before.fingerprints);assert.deepEqual(after.summary,before.summary);assert.deepEqual(after.history,before.history);
   // Real packaged acquisition and report export for unreadable summaries.
   size=91;headerless=true;summaryIssues=true;await openOrders();await scan('all');
   await evaluate('const s='+root+';[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report").click();return true;');
   let compatibilityReport=JSON.parse(await wait('return document.documentElement.dataset.testExport;','Compatibility export missing'));
   assert.equal(compatibilityReport.code,'summaries-unreadable');assert.equal(compatibilityReport.compatibility.counts.unsupportedStatus,1);assert.equal(compatibilityReport.compatibility.counts.invalidBundles,1);const shape=compatibilityReport.compatibility.bundleShapes.records[0];assert.equal(shape.reason,'empty-array');assert.equal(shape.stage,'summaries');assert.equal(shape.parentProducts,'array');assert.equal(shape.parentTiers,'array');assert(!/PRIVATE/.test(JSON.stringify(compatibilityReport)));assert(!/UNKNOWN_STATUS|synthetic-order|synthetic-product/.test(JSON.stringify(compatibilityReport)));
   before=await saved();assert.equal(before.count,91);assert.equal(before.fingerprints.length,89,'unreadable known orders lose skip authority, never their saved purchases');assert.equal(before.summary.coverage.complete,true,'partial scan preserves the earlier complete checkpoint');
   await openOrders();await scan('new');assert.equal(counts.details,0);assert.equal((await saved()).count,91);
   // The two malformed *known* summaries are still validated before skipping.
   summaryIssues=false;await openOrders();assert.equal(await scan('new'),'Quick update completed\n\nChecked 2 purchases. No new items found.\n\n91 items in your library.');assert.equal(counts.details,2);after=await saved();assert.equal(after.count,91);assert.equal(after.fingerprints.length,91);assert.deepEqual(after.history,before.history);
   console.log('PASS installed FAN compatibility report priority, safe counters, known-summary validation and reload recovery');
   reorderedDuplicate=true;await openOrders();await scan('new');assert.equal(counts.details,0);
   await evaluate('const s='+root+';[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report").click();return true;');
   compatibilityReport=JSON.parse(await wait('return document.documentElement.dataset.testExport;','Reordered-summary export missing'));assert.equal(compatibilityReport.compatibility.counts.summaryConflict,0);assert.equal(compatibilityReport.compatibility.counts.knownSkipped,91);assert.equal(compatibilityReport.unresolvedOrders,0);after=await saved();assert.deepEqual(after.items,before.items);assert.equal(after.fingerprints.length,91);reorderedDuplicate=false;
   console.log('PASS installed FAN identical reordered summaries preserve purchases and skip authority without granting complete coverage');
   sparseSummary=true;sparseDetailFailure=true;await openOrders();await scan('all');
   await evaluate('const s='+root+';[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report").click();return true;');
   let recoveryReport=JSON.parse(await wait('return document.documentElement.dataset.testExport;','Sparse failure report missing'));assert.equal(recoveryReport.compatibility.summaryRecovery.unresolved,1);assert.equal(recoveryReport.compatibility.summaryRecovery.recovered,0);assert(recoveryReport.compatibility.bundleShapes.records.some(r=>r.stage==='details'&&r.reason==='invalidBundles'));assert(!recoveryReport.completeCheckpointAdvanced);before=await saved();assert.equal(before.count,91);assert.equal(before.fingerprints.length,90);
   sparseDetailFailure=false;await openOrders();await scan('new');assert.equal(counts.details,1);after=await saved();assert.equal(after.count,91);assert.equal(after.fingerprints.length,91);assert.deepEqual(after.history,before.history);
   await openOrders();await scan('new');assert.equal(counts.details,1);
   await evaluate('const s='+root+';[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report").click();return true;');
   recoveryReport=JSON.parse(await wait('return document.documentElement.dataset.testExport;','Sparse recovery report missing'));assert.equal(recoveryReport.compatibility.summaryRecovery.recovered,1);assert.equal(recoveryReport.compatibility.summaryRecovery.scheduled,1);assert(!/synthetic-order|PRIVATE|SYNTHETIC-ONLY/.test(JSON.stringify(recoveryReport)));sparseSummary=false;after=await saved();assert.deepEqual(after.items,before.items);
   console.log('PASS installed FAN sparse summary: incomplete detail preserves purchases, Quick retries and rechecks known details without duplicating origins');
   if(central){
     let glUrl;if(firefox){await driver.send('Marionette:SetContext',{value:'chrome'});const result=await driver.send('WebDriver:ExecuteScript',{script:'return WebExtensionPolicy.getByID(arguments[0]).getURL(arguments[1]);',args:[centralId,'options.html'],newSandbox:true});glUrl=result.value??result;await driver.send('Marionette:SetContext',{value:'content'});}else glUrl='chrome-extension://'+centralId+'/options.html';
     centralOptionsUrl=glUrl;const fanUrl=reportUrl.replace('test-report.html','src/options.html');
     await verifyFanaticalNativeSync({browser:firefox?'Firefox':'Chrome',peerId:fanId,navigate,evaluate,wait,glUrl,fanUrl,openOrders,scan,restart:async()=>{driver.close?.();child.kill();await exited;await startBrowser();},setSource:value=>{size=value.size;fail=value.fail;headerless=false;denied=false;retry=false;}});
   }
   console.log('PASS installed FAN '+(firefox?'Firefox':'Chrome')+': partial Full, reload Quick retry, unchanged Quick, browser restart, empty Full/Quick preserve purchases, account, history and checkpoints');
   // Fresh-account 6/3/24 regression, with the Library tab kept open throughout.
   const optionsUrl=reportUrl.replace('test-report.html','src/options.html');await navigate(optionsUrl);await wait('return !!globalThis.LibraryBrowser&&!!document.querySelector("#preview-note").textContent;','Options initial render not ready');
   // The next scenarios test a standalone empty library. Default-on sharing
   // intentionally refills a cleared receiver; opt out before clearing so the
   // previous integration scenario cannot add its saved purchases here.
   const sharing=await evaluate('return await chrome.runtime.sendMessage({type:"GH_PURCHASE_ACTION",action:"syncState",provider:"fanatical"});');
   if(typeof sharing.sharing==='boolean'){const off=await evaluate('return await chrome.runtime.sendMessage({type:"GH_PURCHASE_ACTION",action:"syncSetSharing",provider:"fanatical",enabled:false});');assert(off.ok,off.error);}
   const cleared=await evaluate('return await chrome.runtime.sendMessage({type:"FANATICAL_STORE",operation:"clear",args:[]});');assert(cleared.ok,cleared.error);
   await wait('return document.querySelector("#library-count").textContent.includes("0 unique items")&&document.querySelector("#preview-note").textContent.includes("Your library is empty");','Open options did not finish reflecting clear');
   await evaluate('document.querySelector("#galactic-id").value="unsaved draft";return true;');
   let optionsSession=session,optionsHandle;
   if(firefox){const h=await driver.send('WebDriver:GetWindowHandle');optionsHandle=h.value??h;const tab=await driver.send('WebDriver:NewWindow',{type:'tab'});await driver.send('WebDriver:SwitchToWindow',{handle:(tab.value??tab).handle});}
   sixOrders=true;size=6;headerless=true;fail=false;denied=false;sparseSummary=false;sparseDetailFailure=false;await openOrders();await scan('all');
   await evaluate('const s='+root+';[...s.querySelectorAll("button")].find(b=>b.textContent==="Export scan report").click();return true;');
   const freshReport=JSON.parse(await wait('return document.documentElement.dataset.testExport;','6/3/24 report missing'));assert.equal(freshReport.purchaseRecordsRecognized,6);assert.equal(freshReport.verifiedPurchasesSaved,3);assert.equal(freshReport.verifiedProductRecordsSaved,24);assert.equal(freshReport.unresolvedOrders,3);assert.equal(freshReport.accountAffinity,'declared-scope');assert.equal(freshReport.storageAdmission,'committed');assert(!freshReport.completeCheckpointAdvanced);
   if(firefox)await driver.send('WebDriver:SwitchToWindow',{handle:optionsHandle});else session=optionsSession;
   await wait('return document.querySelector("#library-count").textContent.includes("24 unique items");','Already-open Library did not refresh committed purchases');
   assert.equal(await evaluate('return document.querySelector("#galactic-id").value;'),'unsaved draft');
   await navigate(optionsUrl);await wait('return !!globalThis.LibraryBrowser&&document.querySelector("#library-count").textContent.includes("24 unique items");','Reload lost active-library visibility');
   const persisted=await saved();assert.equal(persisted.count,24);assert.equal(persisted.fingerprints.length,3);assert.equal(persisted.history.length,0);assert.equal(persisted.summary,null);assert(persisted.accountId);assert.equal(new Set(persisted.items.map(i=>i.sourceItemId)).size,24);
   driver.close?.();child.kill();await exited;await startBrowser();await navigate(optionsUrl);await wait('return !!globalThis.LibraryBrowser&&document.querySelector("#library-count").textContent.includes("24 unique items");','Browser restart lost 24 purchases');
   console.log('PASS installed FAN 6/3/24: committed read-back, existing-tab refresh with draft retained, reload/restart, active account and no false complete checkpoint');
   sixOrders=false;directGames=true;size=4;await openOrders();assert.equal(await scan('all'),'Full import completed\n\nChecked 4 purchases. Imported 13 new items.\n\n37 items in your library.');let directSaved=await saved();assert.equal(directSaved.count,37);assert.equal(directSaved.summary.coverage.complete,true);assert.equal(directSaved.summary.coverage.paginationEvidence,'array-only');assert.equal(directSaved.history.length,0);for(const item of persisted.items)assert.deepEqual(directSaved.items.find(i=>i.sourceItemId===item.sourceItemId),item);assert.equal(directSaved.items.filter(i=>i.sourceItemId.startsWith('direct-game-')).length,10);
   await openOrders();assert.equal(await scan('new'),'Quick update completed\n\nNo purchases needed checking. No new items found.\n\n37 items in your library.');assert.equal(counts.details,0);directSaved=await saved();assert.equal(directSaved.count,37);
   sparseDetailFailure=true;await openOrders();await scan('all');const retained=await saved();assert.equal(retained.count,37);assert.deepEqual(retained.items,directSaved.items);assert.equal(retained.fingerprints.length,3);
   sparseDetailFailure=false;await openOrders();await scan('new');assert.equal(counts.details,1);directSaved=await saved();assert.equal(directSaved.count,37);assert.equal(directSaved.fingerprints.length,4);
   driver.close?.();child.kill();await exited;await startBrowser();await navigate(optionsUrl);await wait('return !!globalThis.LibraryBrowser&&document.querySelector("#library-count").textContent.includes("37 unique items");','Direct purchased games lost after restart');
   console.log('PASS installed FAN direct games: ten selections, earlier 24 preserved, unchanged Quick, failed-detail retry, restart and no false complete checkpoint');
   assert.equal(directSaved.items.filter(i=>i.keyStatus==='unrevealed').length,legacyKeys&&!process.argv.includes('--observation-peer')?0:10);
   if(!legacyKeys)await verifyStandaloneFanaticalReminders({navigate,evaluate,wait,fanUrl:optionsUrl,openOrders,scan,restart:async()=>{driver.close?.();child.kill();await exited;await startBrowser();}});
   if(central&&(legacyKeys||process.argv.includes('--legacy-central')))await verifyFanaticalKeyCompatibility({observationsSupported:process.argv.includes('--observation-peer')||process.argv.includes('--legacy-observations'),browser:firefox?'Firefox':'Chrome',peerId:fanId,navigate,evaluate,wait,glUrl:centralOptionsUrl,fanUrl:optionsUrl,restart:async()=>{driver.close?.();child.kill();await exited;await startBrowser();}});
   if(central&&!legacyKeys&&!process.argv.includes('--legacy-central'))await verifyFanaticalKeyReminders({browser:firefox?'Firefox':'Chrome',peerId:fanId,navigate,evaluate,wait,glUrl:centralOptionsUrl,fanUrl:optionsUrl,openOrders,scan,setKeysPresent:()=>{directKeysPresent=true;},restart:async()=>{driver.close?.();child.kill();await exited;await startBrowser();}});

   const preMixed=await saved();directGames=false;size=2;headerless=true;mixedSummary=true;sparseSummary=true;await openOrders();await scan('all');let mixedSaved=await saved();assert.equal(mixedSaved.count,preMixed.count+2);assert.deepEqual(mixedSaved.fingerprints,preMixed.fingerprints);assert.deepEqual(mixedSaved.history,preMixed.history);assert.deepEqual(mixedSaved.summary,preMixed.summary);for(const item of preMixed.items)assert(mixedSaved.items.some(i=>i.sourceItemId===item.sourceItemId));
   await openOrders();await scan('new');assert.equal(counts.details,1);assert.equal((await saved()).count,mixedSaved.count);
   sparseDetailFailure=true;await openOrders();await scan('all');assert.deepEqual((await saved()).items,mixedSaved.items);assert.equal((await saved()).fingerprints.length,mixedSaved.fingerprints.length-1);
   sparseDetailFailure=false;await openOrders();await scan('new');assert.equal(counts.details,1);assert.deepEqual((await saved()).fingerprints,mixedSaved.fingerprints);assert.equal((await saved()).count,mixedSaved.count);
   console.log('PASS installed FAN mixed checkout: three populated/sparse bundles, detail recovery, known Quick recheck, atomic failed-order preservation and retry without complete coverage');

 }
}finally{driver?.close?.();child?.kill();if(exited)await exited;await new Promise(done=>server.close(done));const target=resolve(temporary),base=resolve(tmpdir());if(target.startsWith(base+sep)&&target.slice(base.length+1).startsWith('fan-progress-native-'))await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
