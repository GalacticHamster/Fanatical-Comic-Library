import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
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
let child,exited;
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
    const send=(operation,...args)=>chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation,args});
    let response=await send('wishlist','add',[{title:'Native wish',mediaType:'book',weight:7,token:'SYNTHETIC-SECRET'}]);if(!response.ok)throw Error(response.error);
    response=await send('backup');if(!response.ok||response.result.schemaVersion!==3||response.result.wishlistItems[0].weight!==7||JSON.stringify(response).includes('SYNTHETIC-SECRET'))throw Error('Native queued wishlist/backup failed');
    const backup=response.result;await send('wishlist','replace',[]);response=await send('restore',backup);if(!response.ok||(await chrome.storage.local.get('fanaticalWishlistItems')).fanaticalWishlistItems.length!==1)throw Error('Native backup restore failed');
    const before=JSON.stringify(await chrome.storage.local.get(null));response=await send('restore',{...backup,items:[{title:'Invalid',source:'fanatical'}]});if(response.ok||JSON.stringify(await chrome.storage.local.get(null))!==before)throw Error('Invalid native restore changed state');
    response=await chrome.runtime.sendMessage({type:'FANATICAL_IMPORT_PURCHASES',profileLabel:'synthetic',confirmed:true});if(response.ok)throw Error('Options bypassed Orders sender guard');
    return ['real queued wishlist/backup/restore','invalid restore is atomic','Orders sender guard'];
  })()`,options);checks.forEach(check=>console.log('PASS installed Chrome: '+check));

  if(process.argv.includes('--central')){
    const centralRoot=resolve('..','GalacticLibrary'),builder=await import(pathToFileURL(join(centralRoot,'scripts/release.mjs'))),central=await builder.createRelease(centralRoot),centralStage=join(temporary,'central');
    for(const [name,bytes]of builder.readRuntimeZip(central.zip)){const target=join(centralStage,name);await mkdir(dirname(target),{recursive:true});await writeFile(target,bytes);}
    const paired=await driver.send('Extensions.loadUnpacked',{path:centralStage}),centralPage=await attach('chrome-extension://'+paired.id+'/options.html');await wait("document.readyState==='complete'",centralPage);
    const rejected=await evaluate(`(async()=>{try{await FanaticalLibrary.testGalacticLink(message=>chrome.runtime.sendMessage(${JSON.stringify(paired.id)},message));return false;}catch{return true;}})()`,options);assert.equal(rejected,true);console.log('PASS installed Chrome: real central worker rejects an unpaired companion');
    await evaluate(`(async()=>{const S=await import('./src/lib/storage.js');await S.saveAllowedExternalClientIds([${JSON.stringify(installed.id)}]);await S.mergeProviderItems('gog',[{providerItemId:'native-soft',title:'Native creative software',mediaType:'software',ownership:'owned'}]);await S.mergeProviderItems('fanatical',[{providerItemId:'native-key',title:'Native creative software',mediaType:'software',ownership:'owned',}]);await S.mergeProviderItems('humble',[{providerItemId:'native-hb-key',title:'Native reported key',mediaType:'game',ownership:'owned',metadata:{entitlement:'third-party-key',keyStatus:'unrevealed',expiresAt:'2026-11-01T00:00:00.000Z'}}]);return true;})()`,centralPage);
    const pairedChecks=await evaluate(`(async()=>{
      const id=${JSON.stringify(paired.id)},F=FanaticalLibrary,send=message=>chrome.runtime.sendMessage(id,message),caps=await F.testGalacticLink(send);if(!caps.entitlementReminders||!caps.mediaTypes.includes('software'))throw Error('Live capabilities missing');
      const product={sourceItemId:'product-native-soft',title:'Native creative software',mediaType:'software'},query=await F.queryGalacticItems(F.galacticRequestItems([product],true),send),result=query.results.get(product.sourceItemId);if(query.failed.size||!result?.matches.some(row=>row.provider==='gog')||result.matches.some(row=>row.provider==='fanatical'))throw Error('Native match response or Fanatical exclusion failed');
      const fanatical=await F.loadCentralReminders(send);if(fanatical.total!==1||fanatical.reminders[0].dueAt!==null)throw Error('Default provider or unknown deadline failed');const reminders=await F.loadCentralReminders(send,{provider:''});if(reminders.total!==3||!reminders.reminders.some(row=>row.kind==='activation'&&row.dueAt===null)||!reminders.reminders.some(row=>row.kind==='key-expiry'&&row.dueAt==='2026-11-01T00:00:00.000Z')||JSON.stringify(reminders).includes('native-key'))throw Error('Native central reminder feed failed: '+JSON.stringify(reminders));
      await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'patch',args:[{galacticLibraryExtensionId:id}]});document.querySelector('#reminder-provider').value='';document.querySelector('#load-reminders').click();for(let n=0;n<200;n++){if(!document.querySelector('#load-reminders').disabled)break;await new Promise(done=>setTimeout(done,20));}if(document.querySelector('#reminder-list').children.length!==3)throw Error(document.querySelector('#reminder-status').textContent);
      return ['real allow-listed software matching excludes central Fanatical copies','real central feed keeps activation and reported key expiry distinct','installed reminder controls consume the central worker'];
    })()`,options);pairedChecks.forEach(check=>console.log('PASS installed Chrome: '+check));
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
        try{await driver.send('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:headers,body:Buffer.from(body).toString('base64')},page);}finally{active--;}return;
      }
      await driver.send('Fetch.fulfillRequest',{requestId,responseCode:code,responseHeaders:headers,body:Buffer.from(body).toString('base64')},page);
    })().catch(error=>errors.push(error));
  });
  await driver.send('Fetch.enable',{patterns:[{urlPattern:'*'}]},page);await driver.send('Page.enable',{},page);await driver.send('Page.navigate',{url:'https://www.fanatical.com/en/orders'},page);
  await wait("!!document.querySelector('#fanatical-library-importer')",page);
  await evaluate("document.querySelector('[data-profile-label]').value='synthetic';document.querySelector('[data-profile-confirm]').checked=true;document.querySelector('[data-import-mode=all]').click();true",page);
  await wait("!document.querySelector('[data-import-mode=all]').disabled",page);
  let saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary?.ordersScanned,200,await evaluate("document.querySelector('#fanatical-library-importer output').textContent",page));assert.equal(saved.fanaticalImportSummary.coverage.pagesFetched,10);assert.equal(saved.fanaticalLibraryItems[0].purchaseOrigins.length,200);assert.equal(paths.filter(path=>!path.includes('synthetic-order')).length,10);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,200);assert(maxActive<=3);assert(!JSON.stringify(saved).includes('SYNTHETIC-SECRET'));assert(!JSON.stringify(saved).includes('synthetic-order-'));
  console.log('PASS installed Chrome: packaged content -> worker -> MAIN full import covers 200 orders / 10 pages with bounded concurrency and 200 distinct purchase origins');
  total=201;paths.length=0;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(saved.fanaticalImportSummary.ordersScanned,1);assert.equal(saved.fanaticalImportSummary.ordersSkipped,200);assert.equal(saved.fanaticalImportSummary.coverage.pagesFetched,11);assert.equal(saved.fanaticalLibraryItems[0].purchaseOrigins.length,201);assert.equal(paths.filter(path=>path.includes('synthetic-order')).length,1);console.log('PASS installed Chrome: quick import traverses all 11 pages but retrieves only one new order and preserves prior origins');
  const before=JSON.stringify({items:saved.fanaticalLibraryItems,summary:saved.fanaticalImportSummary,fingerprints:saved.fanaticalScannedOrderFingerprints});broken=true;await evaluate("document.querySelector('[data-import-mode=new]').click();true",page);await wait("!document.querySelector('[data-import-mode=new]').disabled",page);saved=await evaluate('chrome.storage.local.get(null)',options);
  assert.equal(JSON.stringify({items:saved.fanaticalLibraryItems,summary:saved.fanaticalImportSummary,fingerprints:saved.fanaticalScannedOrderFingerprints}),before);assert.equal(saved.fanaticalLastScanAttempt.status,'incomplete');assert.equal(errors.length,0,String(errors[0]));console.log('PASS installed Chrome: broken pagination retains purchases and successful summary, displaying incomplete coverage');
}finally{
  if(child){child.kill();await Promise.race([exited,pause(3000)]);}
  const target=resolve(temporary),base=resolve(tmpdir());if(!target.startsWith(base+sep)||!target.slice(base.length+1).startsWith('fanatical-runtime-test-'))throw Error('Unsafe runtime test cleanup.');await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
