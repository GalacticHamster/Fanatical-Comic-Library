import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,sep} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createRelease,readRuntimeZip} from '../scripts/release.mjs';

// A private DevTools pipe drives only the Chrome process started by this test.
function protocol(child){
  let next=0,input=Buffer.alloc(0);const pending=new Map(),listeners=new Set();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');});
  const fail=error=>{for(const request of pending.values()){clearTimeout(request.timer);request.reject(error);}pending.clear();};
  child.stdio[4].on('data',chunk=>{input=Buffer.concat([input,chunk]);let end;while((end=input.indexOf(0))>=0){const message=JSON.parse(input.subarray(0,end));input=input.subarray(end+1);if(message.id){const request=pending.get(message.id);if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);}}else for(const listener of listeners)listener(message);}if(input.length>8*1024*1024)fail(Error('Excessive browser response.'));});
  child.on('error',fail);child.on('exit',()=>fail(Error('Chrome exited.')));return {send,on:listener=>listeners.add(listener)};
}
if(process.argv.slice(2).some(arg=>arg!=='--central'))throw Error('Usage: node tests/runtime-check.mjs [--central]');
const temporary=await mkdtemp(join(tmpdir(),'fanatical-runtime-test-'));
let child,exited,centralSession=null,centralExtensionId=null;
try{
  const stage=join(temporary,'extension'),{zip}=await createRelease();
  for(const [name,bytes]of readRuntimeZip(zip)){const target=join(stage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
  child=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--user-data-dir='+join(temporary,'profile'),'--remote-debugging-pipe','--enable-unsafe-extension-debugging','about:blank'],{windowsHide:true,stdio:['ignore','pipe','pipe','pipe','pipe']});
  exited=new Promise(done=>child.once('exit',done));const driver=protocol(child);
  const evaluate=async(expression,sessionId)=>{const result=await driver.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));return result.result.value;};
  const attach=async url=>{const target=await driver.send('Target.createTarget',{url});return (await driver.send('Target.attachToTarget',{targetId:target.targetId,flatten:true})).sessionId;};
  const wait=async(expression,sessionId)=>{for(let n=0;n<400;n++){try{if(await evaluate(expression,sessionId))return;}catch(error){if(!/context was destroyed|Cannot find context/u.test(error.message))throw error;}await pause(25);}throw Error('Installed UI did not become ready: '+expression);};
  const installed=await driver.send('Extensions.loadUnpacked',{path:stage}),options=await attach('chrome-extension://'+installed.id+'/src/options.html');
  await wait("document.querySelector('#library-count')?.textContent.includes('stored locally')",options);
  const checks=await evaluate(`(async()=>{
    const absent=await FanaticalLibrary.galacticAvailability(message=>chrome.runtime.sendMessage('nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn',message));
    if(absent.state!=='unavailable')throw Error('Native no-receiver availability failed');
    const send=(operation,...args)=>chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});
    let response=await send('wishlist','add',[{title:'Native wish',mediaType:'book',weight:7,token:'SYNTHETIC-SECRET'}]);if(!response.ok)throw Error(response.error);
    response=await send('backup');if(!response.ok||response.result.schemaVersion!==4||response.result.wishlistItems[0].weight!==7||JSON.stringify(response).includes('SYNTHETIC-SECRET'))throw Error('Native queued wishlist/backup failed');
    const backup=response.result;await send('wishlist','replace',[]);response=await send('restore',backup);if(!response.ok||(await chrome.storage.local.get('fanaticalWishlistItems')).fanaticalWishlistItems.length!==1)throw Error('Native backup restore failed');
    const before=JSON.stringify(await chrome.storage.local.get(null));response=await send('restore',{...backup,items:[{title:'Invalid',source:'fanatical'}]});if(response.ok||JSON.stringify(await chrome.storage.local.get(null))!==before)throw Error('Invalid native restore changed state');
    response=await chrome.runtime.sendMessage({type:'FANATICAL_IMPORT_PURCHASES',profileLabel:'synthetic',confirmed:true});if(response.ok)throw Error('Options bypassed Orders sender guard');
    return ['real missing-receiver availability','real queued wishlist/backup/restore','invalid restore is atomic','Orders sender guard'];
  })()`,options);checks.forEach(check=>console.log('PASS installed Chrome: '+check));

  if(process.argv.includes('--central')){
    const centralRoot=resolve('..','GalacticLibrary'),builder=await import(pathToFileURL(join(centralRoot,'scripts/release.mjs'))),central=await builder.createRelease(centralRoot),centralStage=join(temporary,'central');
    for(const [name,bytes]of builder.readRuntimeZip(central.zip)){const target=join(centralStage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
    const paired=await driver.send('Extensions.loadUnpacked',{path:centralStage}),centralPage=await attach('chrome-extension://'+paired.id+'/options.html');centralSession=centralPage;centralExtensionId=paired.id;await wait("document.readyState==='complete'",centralPage);
    const rejected=await evaluate(`(async()=>{try{await FanaticalLibrary.testGalacticLink(message=>chrome.runtime.sendMessage(${JSON.stringify(paired.id)},message));return false;}catch{return true;}})()`,options);assert.equal(rejected,true);console.log('PASS installed Chrome: real central worker rejects an unpaired companion');
    await evaluate(`(async()=>{const S=await import('./src/lib/storage.js');await S.saveAllowedExternalClientIds([${JSON.stringify(installed.id)}]);await S.mergeProviderItems('gog',[{providerItemId:'native-soft',title:'Native creative software',mediaType:'software',ownership:'owned'}]);await S.mergeProviderItems('fanatical',[{providerItemId:'native-key',title:'Native creative software',mediaType:'software',ownership:'owned',}]);await S.mergeProviderItems('humble',[{providerItemId:'native-hb-key',title:'Native reported key',mediaType:'game',ownership:'owned',metadata:{entitlement:'third-party-key',keyStatus:'unrevealed',expiresAt:'2026-11-01T00:00:00.000Z'}}]);return true;})()`,centralPage);
    const pairedChecks=await evaluate(`(async()=>{
      const id=${JSON.stringify(paired.id)},F=FanaticalLibrary,send=message=>chrome.runtime.sendMessage(id,message),caps=await F.testGalacticLink(send);if(!caps.entitlementReminders||!caps.mediaTypes.includes('software'))throw Error('Live capabilities missing');
      const product={sourceItemId:'product-native-soft',title:'Native creative software',mediaType:'software'},query=await F.queryGalacticItems(F.galacticRequestItems([product],true),send),result=query.results.get(product.sourceItemId);if(query.failed.size||!result?.matches.some(row=>row.provider==='gog')||result.matches.some(row=>row.provider==='fanatical'))throw Error('Native match response or Fanatical exclusion failed');
      const fanatical=await F.loadCentralReminders(send);if(fanatical.total!==1||fanatical.reminders[0].dueAt!==null)throw Error('Default provider or unknown deadline failed');const reminders=await F.loadCentralReminders(send,{provider:''});if(reminders.total!==3||!reminders.reminders.some(row=>row.kind==='activation'&&row.dueAt===null)||!reminders.reminders.some(row=>row.kind==='key-expiry'&&row.dueAt==='2026-11-01T00:00:00.000Z')||JSON.stringify(reminders).includes('native-key'))throw Error('Native central reminder feed failed: '+JSON.stringify(reminders));
      await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'patch',args:[{galacticLibraryExtensionId:id}]});document.querySelector('#reminder-provider').value='';document.querySelector('#load-reminders').click();for(let n=0;n<200;n++){if(!document.querySelector('#load-reminders').disabled)break;await new Promise(done=>setTimeout(done,20));}if(document.querySelector('#reminder-list').children.length!==3)throw Error(document.querySelector('#reminder-status').textContent);
      return ['real allow-listed software matching excludes central Fanatical copies','real central feed keeps activation and reported key expiry distinct','installed reminder controls consume the central worker'];
    })()`,options);pairedChecks.forEach(check=>console.log('PASS installed Chrome: '+check));
    const hbRoot=resolve('..','HB'),hbPackage=join(temporary,'hb-package'),hbStage=join(temporary,'hb-runtime');await mkdir(hbPackage);
    execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',join(hbRoot,'scripts/package-release.ps1'),'-OutputDirectory',hbPackage],{windowsHide:true,stdio:'pipe'});
    const hbManifest=JSON.parse(await readFile(join(hbRoot,'manifest.json'),'utf8')),extract=join(temporary,'extract-hb.ps1');
    await writeFile(extract,'param($Archive,$Destination)\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n[System.IO.Compression.ZipFile]::ExtractToDirectory($Archive,$Destination)\n');
    execFileSync('powershell.exe',['-NoProfile','-File',extract,join(hbPackage,'Humble-Comic-Library-'+hbManifest.version+'.zip'),hbStage],{windowsHide:true,stdio:'pipe'});
    const hb=await driver.send('Extensions.loadUnpacked',{path:hbStage}),hbPage=await attach('chrome-extension://'+hb.id+'/options.html');await wait("typeof HumbleComicLibrary!=='undefined'",hbPage);
    await evaluate('(async()=>{const S=await import("./src/lib/storage.js");await S.addAllowedExternalClientId('+JSON.stringify(hb.id)+');return true;})()',centralPage);
    await evaluate('(async()=>{await HumbleComicLibrary.storageSet({galacticLibraryExtensionId:'+JSON.stringify(paired.id)+'});return true;})()',hbPage);
    for(const id of [hb.id,installed.id])assert.equal((await evaluate('chrome.runtime.sendMessage('+JSON.stringify(id)+',{type:"PING",apiVersion:1})',centralPage)).ok,true);
    assert.equal((await evaluate('chrome.runtime.sendMessage('+JSON.stringify(installed.id)+',{type:"PING",apiVersion:1})',hbPage)).ok,false);
    const request={type:'MATCH_ITEMS',apiVersion:1,items:[{requestId:'same',title:'Native creative software',mediaType:'software',excludeProviders:['humble','fanatical']}]},expression='chrome.runtime.sendMessage('+JSON.stringify(paired.id)+','+JSON.stringify(request)+')';
    const hbMatch=await evaluate(expression,hbPage),fanMatch=await evaluate(expression,options);assert.deepEqual(hbMatch.results,fanMatch.results);
    const {seedConsoleCompanionLibrary,checkConsoleCompanionResults}=await import(pathToFileURL(join(centralRoot,'tests/fixtures/console-companion-native.mjs')));
    await evaluate('('+seedConsoleCompanionLibrary.toString()+')()',centralPage);
    assert(await evaluate('('+checkConsoleCompanionResults.toString()+')(message=>chrome.runtime.sendMessage('+JSON.stringify(paired.id)+',message),FanaticalLibrary)',options));
    assert(await evaluate('('+checkConsoleCompanionResults.toString()+')(message=>chrome.runtime.sendMessage('+JSON.stringify(paired.id)+',message))',hbPage));
    console.log('PASS installed Chrome: console provenance/ownership through GL to both companions, FAN response validator/resolver, wishlist-only and provider exclusions');
    await evaluate('(async()=>{const S=await import("./src/lib/storage.js");await S.saveAllowedExternalClientIds([]);return true;})()',centralPage);
    for(const page of [hbPage,options])assert.equal((await evaluate(expression,page)).ok,false);
    console.log('PASS installed Chrome: all three packaged extensions, matching parity, GL status in both companions, HB-to-FAN rejection and custom-ID revocation');

  }

  // Every request on this synthetic Fanatical tab is fulfilled locally. It
  // never contacts Fanatical or uses a real account/session or user profile.
  const page=await attach('about:blank');let total=200,broken=false,active=0,maxActive=0;const paths=[],errors=[];
  const summary=n=>({_id:'synthetic-order-'+n,status:'COMPLETE',items:[{name:'Synthetic bundle',bundles:[{games:[{name:'Synthetic purchase'}]}]}]});
  const detail=n=>({_id:'synthetic-order-'+n,status:'COMPLETE',date:'2026-10-01T00:00:00Z',privateKey:'SYNTHETIC-SECRET',items:[{_id:'bundle-123456',name:'Synthetic bundle',bundles:[{games:[{_id:'product-123456',name:'Synthetic purchase',type:'book',privateDownloadUrl:'SYNTHETIC-SECRET'}]}]}]});
  driver.on(message=>{
    if(message.sessionId!==page)return;
    if(message.method==='Page.javascriptDialogOpening'){driver.send('Page.handleJavaScriptDialog',{accept:true},page).catch(error=>errors.push(error));return;}
    if(message.method!=='Fetch.requestPaused')return;
    (async()=>{
      const {requestId,request}=message.params,url=new URL(request.url);let body='',code=404,headers=[{name:'Content-Type',value:'application/json'}];
      if(url.origin==='https://www.fanatical.com'&&url.pathname==='/en/orders'){
        code=200;headers=[{name:'Content-Type',value:'text/html; charset=utf-8'}];body='<!doctype html><html><head><title>Synthetic orders</title></head><body><h1>Synthetic orders</h1><script>localStorage.setItem("bsauth",JSON.stringify({token:"SYNTHETIC-SECRET"}));</script></body></html>';
      }else if(url.origin==='https://www.fanatical.com'&&url.pathname==='/api/user/orders'){
        assert.equal(request.method,'GET');paths.push(url.pathname+url.search);code=200;const number=Number(url.searchParams.get('page')||1),start=(number-1)*20,end=Math.min(start+20,total),last=Math.ceil(total/20);body=JSON.stringify(Array.from({length:end-start},(_,n)=>summary(start+n)));headers.push({name:'X-Total-Count',value:String(total)},{name:'Content-Range',value:'items '+start+'-'+(end-1)+'/'+total});
        const links=[];if(number<last&&!(broken&&number===2))links.push('</api/user/orders?page='+(number+1)+'>; rel="next"');if(number===1)links.push('</api/user/orders?page='+last+'>; rel="last"');if(links.length)headers.push({name:'Link',value:links.join(', ')});
      }else if(url.origin==='https://www.fanatical.com'&&/^\/api\/user\/orders\/synthetic-order-\d+$/.test(url.pathname)){
        assert.equal(request.method,'GET');paths.push(url.pathname);active++;maxActive=Math.max(maxActive,active);await pause(3);code=200;body=JSON.stringify(detail(Number(url.pathname.split('-').at(-1))));
        // End server work when handing off the response; DevTools acknowledgement can arrive after the next fetch starts.
        active--;await driver.send('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:headers,body:Buffer.from(body).toString('base64')},page);return;
      }
      await driver.send('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:headers,body:Buffer.from(body).toString('base64')},page);
    })().catch(error=>errors.push(error));
  });
  await driver.send('Fetch.enable',{patterns:[{urlPattern:'*'}]},page);await driver.send('Page.enable',{},page);await driver.send('Page.navigate',{url:'https://www.fanatical.com/en/orders'},page);
  await wait("!!document.querySelector('#fanatical-library-importer')",page);
  await evaluate("window.importMessages=[];new MutationObserver(()=>importMessages.push(document.querySelector('#fanatical-library-importer output').textContent)).observe(document.querySelector('#fanatical-library-importer output'),{childList:true});true",page);
  await evaluate("document.querySelector('[data-import-mode=all]').click();true",page);
  await wait("!document.querySelector('[data-import-mode=all]').disabled",page);
  let saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary?.ordersScanned,200,await evaluate("document.querySelector('#fanatical-library-importer output').textContent",page));assert.equal(saved.fanaticalImportSummary.coverage.pagesFetched,10);assert.equal(saved.fanaticalLibraryItems[0].purchaseOrigins.length,200);assert.equal(paths.filter(path=>!path.includes('synthetic-order')).length,10);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,200);assert(maxActive<=3);assert(!JSON.stringify(saved).includes('SYNTHETIC-SECRET'));assert(!JSON.stringify(saved).includes('synthetic-order-'));
  console.log('PASS installed Chrome: packaged content -> worker -> MAIN full import covers 200 orders / 10 pages with bounded concurrency and 200 distinct purchase origins');
  assert.match(await evaluate("document.querySelector('#fanatical-library-importer output').textContent",page),/^Rescanned 200 purchases; current snapshot rebuilt/);
  const progress=await evaluate('window.importMessages',page);
  assert(progress.some(message=>message.startsWith('Loading your purchase list: page')));
  assert(progress.some(message=>message.startsWith('Rescanning all purchases: purchase')));
  console.log('PASS installed Chrome: live aggregate progress crosses MAIN into the importer without replacing its completed result');
  total=201;paths.length=0;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary.ordersScanned,1);assert.equal(saved.fanaticalImportSummary.ordersSkipped,200);assert.equal(saved.fanaticalImportSummary.coverage.pagesFetched,11);assert.equal(saved.fanaticalLibraryItems[0].purchaseOrigins.length,201);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,1);console.log('PASS installed Chrome: quick import traverses all 11 pages but retrieves only one new order and preserves prior origins');
  assert.match(await evaluate("document.querySelector('#fanatical-library-importer output').textContent",page),/^Checked 1 new purchase; skipped 200 unchanged purchases/);
  paths.length=0;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary.ordersScanned,0);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,0);
  assert.match(await evaluate("document.querySelector('#fanatical-library-importer output').textContent",page),/^No new purchases; no purchase details to check; skipped 201 unchanged purchases/);
  console.log('PASS installed Chrome: repeated quick import says no new purchases and skips every known purchase detail');
  const before=JSON.stringify({items:saved.fanaticalLibraryItems,summary:saved.fanaticalImportSummary,fingerprints:saved.fanaticalScannedOrderFingerprints});broken=true;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(JSON.stringify({items:saved.fanaticalLibraryItems,summary:saved.fanaticalImportSummary,fingerprints:saved.fanaticalScannedOrderFingerprints}),before);assert.equal(saved.fanaticalLastScanAttempt.status,'incomplete');assert.equal(errors.length,0,String(errors[0]));console.log('PASS installed Chrome: broken pagination retains purchases and successful summary, displaying incomplete coverage');
  broken=false;
  const savedFingerprints=[...saved.fanaticalScannedOrderFingerprints];
  await evaluate("document.querySelector('[data-profile-label]').value='other';document.querySelector('[data-profile-confirm]').checked=true;document.querySelector('[data-profile-switch]').checked=true;document.querySelector('[data-import-mode=all]').click();true",page);await wait("!document.querySelector('[data-import-mode=all]').disabled",page);
  saved=await evaluate('chrome.storage.local.get(null)',options);assert.equal(saved.fanaticalProfileLabel,'other');assert.deepEqual(saved.fanaticalProfileArchives[0].localScanState.fingerprints,savedFingerprints);
  await wait("document.querySelector('#account-profiles [data-account-list]')?.options.length===2",options);
  await evaluate("(()=>{const host=document.querySelector('#account-profiles'),picker=host.querySelector('[data-account-list]');picker.value='Default account';picker.dispatchEvent(new Event('change'));host.querySelector('[data-account-confirm]').checked=true;host.querySelector('[data-account-use]').click();return true;})()",options);
  await wait("document.querySelector('#account-profiles summary').textContent.includes('active: Default account')",options);await wait("document.querySelector('[data-profile-label]').value==='Default account'",page);
  total=202;paths.length=0;await evaluate("document.querySelector('[data-profile-confirm]').checked=true;document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary.scanMode,'quick');assert.equal(saved.fanaticalImportSummary.ordersScanned,1);assert.equal(saved.fanaticalImportSummary.ordersSkipped,201);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,1);console.log('PASS installed Chrome: saved account switch restores private scan history and quick import fetches only its one new order');
  await evaluate("(()=>{const host=document.querySelector('#account-profiles');host.querySelector('[data-account-name]').value='personal';host.querySelector('[data-account-rename]').click();return true;})()",options);await wait("document.querySelector('#account-profiles summary').textContent.includes('active: personal')",options);
  saved=await evaluate('chrome.storage.local.get(null)',options);assert.equal(saved.fanaticalScannedOrderFingerprints.length,202);assert.equal(saved.fanaticalLibraryItems[0].purchaseOrigins.length,202);console.log('PASS installed Chrome: account rename preserves all purchase origins and incremental scan history');

  if(centralSession){
    await evaluate(`(async()=>{const S=await import('./src/lib/storage.js');await S.saveAllowedExternalClientIds([${JSON.stringify(installed.id)}]);return true;})()`,centralSession);
    await evaluate(`chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'patch',args:[{galacticLibraryExtensionId:${JSON.stringify(centralExtensionId)}}]})`,options);
    const syncCall=fields=>evaluate(`chrome.runtime.sendMessage(${JSON.stringify({type:'GH_PURCHASE_ACTION',provider:'fanatical',...fields})})`,centralSession);
    let choices=await syncCall({action:'syncChoices',peerId:installed.id});assert(choices.ok,choices.error);
    let result=await syncCall({action:'syncConnect',peerId:choices.peerId,localId:choices.accounts[0].stableId,remoteId:choices.remoteAccounts[0].stableId,confirmed:true,sameAccount:true});assert(result.ok,result.error);
    const waitForOrigins=async count=>{for(let n=0;n<300;n++){if(await evaluate(`(async()=>{const S=await import('./src/lib/storage.js');return Object.values((await S.getDatabase()).providerItems).some(i=>i.provider==='fanatical'&&i.providerItemId==='product-123456'&&i.metadata.purchaseOrigins?.length===${count});})()`,centralSession))return;await pause(20);}throw Error('GL did not receive '+count+' Fanatical purchase origins');};
    await waitForOrigins(202);
    // Inject identity/permission loss only into this disposable synthetic library.
    await evaluate(`(async()=>{await chrome.storage.local.remove(['fanaticalAccountId','galacticPurchaseSync']);await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'profiles',args:[]});return true;})()`,options);
    assert.equal((await syncCall({action:'syncNow'})).ok,false);
    const stopped=await syncCall({action:'syncState'});assert.equal(stopped.state.status,'attention');
    choices=await syncCall({action:'syncChoices',peerId:installed.id});const a=choices.accounts[0],b=choices.remoteAccounts[0];
    result=await syncCall({action:'syncRepair',peerId:choices.peerId,localId:a.stableId,remoteId:b.stableId,confirmed:true,sameAccount:true,expectedId:choices.state.id,expectedRemoteId:choices.remoteRelationshipId,localFingerprint:a.fingerprint,remoteFingerprint:b.fingerprint});assert(result.ok,result.error);
    for(let n=0;n<300;n++){if((await syncCall({action:'syncState'})).state?.status==='synced')break;await pause(20);}
    total=203;broken=false;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);await waitForOrigins(203);
    console.log('PASS installed Chrome: real FAN purchase import reaches GL; identity loss repairs once; a subsequent real content/worker Quick Import automatically transfers its new purchase origin');
  }
}finally{
  if(child){child.kill();await Promise.race([exited,pause(3000)]);}
  const target=resolve(temporary),base=resolve(tmpdir());if(!target.startsWith(base+sep)||!target.slice(base.length+1).startsWith('fanatical-runtime-test-'))throw Error('Unsafe runtime test cleanup.');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
