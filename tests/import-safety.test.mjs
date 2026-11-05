import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
const purchaseModules=['purchase-snapshot.js', 'purchase-transfer.js', 'purchase-sync.js', 'purchase-adapters.js'].map(file=>fs.readFileSync(new URL('../src/'+file,import.meta.url),'utf8')).join('\n');
const dispatch=(listeners,message,sender,respond)=>{for(const fn of listeners)if(fn(message,sender,respond)===true)return;respond(null);};
import { safeId, validateScanResult, createSyncStore, mergeLibraryItems } from '../src/library-data.mjs';

import {importFanaticalOrdersInPage} from '../src/order-importer.mjs';
import {quotaProduct,quotaBaseline,quotaProtectedFields} from './fixtures/storage-quota.mjs';

const source = fs.readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gmu, '');
const orderId = 'order-123456';
const fingerprint = (id) => createHash('sha256').update(id).digest('hex');
const detail = { _id: orderId, status: 'COMPLETE', items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [{ games: [{ _id: 'product-123456', name: 'New purchase', type: 'game' }] }] }] };
const summary = { _id: orderId, status: 'COMPLETE', items: [{ name: 'Bundle', bundles: [{ games: [{ name: 'New purchase' }] }] }] };
const previous = { fanaticalLibraryItems: [{ source: 'fanatical', sourceItemId: 'product-654321', title: 'Previously imported', mediaType: 'game', bundle: { sourceItemId: 'bundle-654321', title: 'Previous bundle' } }], fanaticalImportSummary: { importedAt: 'previous', scanMode: 'full' }, fanaticalScannedOrderFingerprints: [] };

test('partial pilot saves 499 independently verified orders and retries the malformed order',async()=>{
  const history=longHistory(500,20);history.orders[211].detail.items[0].bundles[0].games[0]._id='bad';
  const run=harness({...history,partial:true}),before=structuredClone(run.before),reply=await run.send(true);
  assert.equal(reply.ok,true,reply.error);assert.equal(reply.summary.outcome,'partial-extraction');
  assert.equal(reply.summary.verifiedPurchasesSaved,499);assert.equal(reply.summary.unresolvedOrders,1);
  assert.equal(run.stored.fanaticalLibraryItems.length,500);
  assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,499);
  assert(!run.stored.fanaticalScannedOrderFingerprints.includes(fingerprint(history.orders[211].summary._id)));
  assert.deepEqual(run.stored.fanaticalImportSummary,before.fanaticalImportSummary);
  assert.equal(run.stored.fanaticalLastScanAttempt.completeCheckpointAdvanced,false);
  history.orders[211].detail.items[0].bundles[0].games[0]._id='recovered-product';run.paths.length=0;await new Promise(r=>setImmediate(r));
  const next=await run.send(false);assert.equal(next.ok,true,next.error);assert.equal(next.summary.outcome,'complete');
  assert.equal(next.summary.ordersScanned,1);assert.equal(run.paths.filter(p=>p.includes('/orders/order-')).length,1);
  assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,500);
});

test('partial pilot saves verified purchases before a missing next link without retiring unseen purchases',async()=>{
  const history=longHistory(160,40);const run=harness({partial:true,respond:async(path,options)=>{
    const reply=await history.respond(path,options);if(path==='/api/user/orders?page=3')delete reply.headers.link;return reply;
  }});
  const reply=await run.send(true);assert.equal(reply.ok,true,reply.error);assert.equal(reply.summary.outcome,'partial-discovery');
  assert.equal(reply.summary.verifiedPurchasesSaved,120);assert.equal(run.stored.fanaticalLibraryItems.length,121);
  assert.deepEqual(run.stored.fanaticalImportSummary,run.before.fanaticalImportSummary);
  assert.equal(run.stored.fanaticalHistoricalItems?.length??0,0);assert.equal(run.stored.fanaticalLastScanAttempt.discoveryComplete,false);
});

test('partial pilot isolates malformed multi-product orders, unknown statuses and failed details',async()=>{
  for(const kind of ['malformed','status','request']){
    const history=longHistory(500,25),bad=history.orders[211];
    if(kind==='malformed')bad.detail.items[0].bundles[0].games.push({name:'Invalid second product'});
    if(kind==='status')bad.summary.status='UNRECOGNIZED';
    const clock=retryClock(),run=harness({...clock,partial:true,respond:async(path,options)=>kind==='request'&&path.endsWith(bad.summary._id)?{status:503}:history.respond(path,options)});
    const reply=await run.send(true);assert.equal(reply.ok,true,reply.error);assert.equal(reply.summary.verifiedPurchasesSaved,499);assert.equal(reply.summary.unresolvedOrders,1);
    assert(!run.stored.fanaticalLibraryItems.some(item=>item.sourceItemId===bad.detail.items[0].bundles[0].games[0]._id));
    assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,499);assert.deepEqual(run.stored.fanaticalImportSummary,run.before.fanaticalImportSummary);
  }
});

test('partial pilot retains old evidence, valid skip authority and corrections through repeated pagination failures and later Full',async()=>{
  for(const problem of ['later-request','loop','count']){
    const history=longHistory(120,40),clock=retryClock();let broken=true;
    const oldfp=fingerprint('unobserved-order');
    const run=harness({...clock,partial:true,known:[oldfp,fingerprint(history.orders[0].summary._id)],initial:{mediaTypeOverrides:{'product-000000':'comic'}},respond:async(path,options)=>{
      if(broken&&problem==='later-request'&&path.endsWith('page=3'))return {status:503};
      const r=await history.respond(path,options);
      if(broken&&path.endsWith('page=2')){
        if(problem==='loop')r.headers.link='<?page=2>; rel="next"';
        if(problem==='count')r.headers['x-total-count']='999';
      }
      return r;
    }});
    const one=await run.send(true);assert.equal(one.ok,true,one.error);assert.equal(one.summary.outcome,'partial-discovery');
    const items=structuredClone(run.stored.fanaticalLibraryItems),fingerprints=structuredClone(run.stored.fanaticalScannedOrderFingerprints);
    assert(fingerprints.includes(oldfp));assert.equal(items.find(i=>i.sourceItemId==='product-000000').manualMediaType,'comic');assert(items.some(i=>i.sourceItemId==='product-654321'));
    await new Promise(r=>setImmediate(r));const again=await run.send(true);assert.equal(again.ok,true,again.error);
    assert.deepEqual(run.stored.fanaticalLibraryItems,items);assert.deepEqual(run.stored.fanaticalScannedOrderFingerprints,fingerprints);
    broken=false;await new Promise(r=>setImmediate(r));
    // The old unobserved order remains a conservative coverage warning until it
    // is actually listed again; it must never be silently dropped to go green.
    const stillPartial=await run.send(true);assert.equal(stillPartial.summary.outcome,'partial-discovery');
  }
  const history=longHistory(20,10);let broken=true;
  const run=harness({partial:true,initial:{fanaticalImportSummary:null},respond:async(path,options)=>{const r=await history.respond(path,options);if(broken&&path==='/api/user/orders')delete r.headers.link;return r;}});
  const first=await run.send(false);assert.equal(first.summary.scanMode,'full');assert.equal(run.stored.fanaticalImportSummary,null);assert.equal(run.stored.fanaticalLibraryItems.length,11);
  await new Promise(r=>setImmediate(r));const repeated=await run.send(false);assert.equal(repeated.summary.scanMode,'quick');assert.equal(repeated.summary.verifiedPurchasesSaved,0);
  broken=false;await new Promise(r=>setImmediate(r));const complete=await run.send(true);
  assert.equal(complete.ok,true,complete.error);assert.equal(complete.summary.outcome,'complete');assert.equal(run.stored.fanaticalImportSummary.scanMode,'full');assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,20);
  await new Promise(r=>setImmediate(r));assert.equal((await run.send(false)).summary.ordersScanned,0);
});

test('partial pilot rejects all evidence on account/session conflicts and atomic write failure',async()=>{
  for(const kind of ['identity','authentication','session','disk','stale']){
    const history=longHistory(30,10);history.orders[3].detail.items=[];
    let reads=0;
    const run=harness({partial:true,authRead:()=>kind==='session'&&++reads>1?'CHANGED':'SECRET-TOKEN',respond:async(path,options)=>{
      if(kind==='authentication'&&path.endsWith('order-000020'))return {status:403};
      if(kind==='identity'&&path.endsWith('order-000020'))return {status:200,data:{...history.orders[20].detail,_id:'another-order'}};
      if(kind==='stale'&&path.endsWith('order-000020'))await run.store('clear',[],'chrome-extension://'+'a'.repeat(32)+'/src/options.html');
      return history.respond(path,options);
    },onSet:async values=>{if(kind==='disk'&&Object.hasOwn(values,'fanaticalLibraryItems'))throw Error('Disk failed');}});
    const reply=await run.send(true);assert.equal(reply.ok,false,kind);
    if(kind==='stale')assert.equal(run.stored.fanaticalLibraryItems,undefined);
    else for(const key of ['fanaticalLibraryItems','fanaticalImportSummary','fanaticalScannedOrderFingerprints'])assert.deepEqual(run.stored[key],run.before[key],kind);
    assert(!JSON.stringify(reply).includes('SECRET-TOKEN'));
  }
});

test('partial pilot scales to 1000 and 5000 orders without marking unresolved orders processed',async()=>{
  for(const count of [1000,5000]){
    const history=longHistory(count,50);history.orders[count-1].detail.items=[];
    const run=harness({...history,partial:true});const reply=await run.send(true);
    assert.equal(reply.ok,true,reply.error);assert.equal(reply.summary.verifiedPurchasesSaved,count-1);assert.equal(reply.summary.unresolvedOrders,1);
    assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,count-1);assert.equal(run.maxActive,3);
  }
});

test('partial pilot snapshots stay additions-only and backups never restore partial skip authority',async()=>{
  const history=longHistory(3,3);history.orders[2].detail.items=[];const run=harness({...history,partial:true});
  assert.equal((await run.send(true)).ok,true);
  const accounts=await globalThis.GalacticPurchaseAdapters.accounts('fan',run.stored),snapshot=await globalThis.GalacticPurchaseAdapters.snapshot('fan',run.stored,accounts[0].accountRef);
  assert.equal(snapshot.completeness,'partial');assert.equal(snapshot.scope,'historical');assert(snapshot.limitations.some(s=>s.includes('Absence is not deletion')));
  const state={...run.stored,fanaticalProfileArchives:[]},a=await globalThis.GalacticPurchaseAdapters.snapshot('fan',state,accounts[0].accountRef);
  assert.deepEqual(snapshot.records,a.records);assert(!JSON.stringify(snapshot).includes('partialCheckpointVersion'));
  const backup=(await run.store('backup',[],'chrome-extension://'+'a'.repeat(32)+'/src/options.html')).result;
  assert(!JSON.stringify(backup).includes('partialCheckpointVersion'));
  backup.fanaticalLastScanAttempt=run.stored.fanaticalLastScanAttempt;backup.fanaticalScannedOrderFingerprints=run.stored.fanaticalScannedOrderFingerprints;
  assert.equal((await run.store('restore',[backup],'chrome-extension://'+'a'.repeat(32)+'/src/options.html')).ok,true);
  assert.deepEqual(run.stored.fanaticalScannedOrderFingerprints,[]);assert.equal(run.stored.fanaticalLastScanAttempt,null);
});

test('partial pilot removes unresolved skip eligibility, preserves prior purchase evidence and validates receipts',async()=>{
  const history=longHistory(3,3),run=harness({...history,partial:true,initial:{mediaTypeOverrides:{'product-000001':'comic'}}});
  history.orders[0].detail.date='2015-03-02T00:00:00.000Z';history.orders[0].detail.items[0].bundles[0].games[0].language='en';
  assert.equal((await run.send(true)).ok,true);const baseline=structuredClone(run.stored.fanaticalImportSummary);
  delete history.orders[0].detail.date;delete history.orders[0].detail.items[0].bundles[0].games[0].language;
  history.orders[1].detail.items[0].bundles[0].games[0]._id='bad';await new Promise(r=>setImmediate(r));
  const partial=await run.send(true);assert.equal(partial.ok,true,partial.error);assert.equal(partial.summary.unresolvedOrders,1);
  assert(!run.stored.fanaticalScannedOrderFingerprints.includes(fingerprint(history.orders[1].summary._id)));
  assert.equal(run.stored.fanaticalLibraryItems.find(i=>i.sourceItemId==='product-000001').manualMediaType,'comic');assert.deepEqual(run.stored.fanaticalImportSummary,baseline);
  const retained=run.stored.fanaticalLibraryItems.find(i=>i.sourceItemId==='product-000000');assert.equal(retained.purchaseDate,'2015-03-02T00:00:00.000Z');assert.equal(retained.purchaseOrigins[0].purchaseDate,retained.purchaseDate);assert.equal(retained.language,'en');
  const receipt=run.receipts.at(-1);assert.equal(validateScanResult(receipt,{fullScan:true,knownOrderFingerprints:[]}).outcome,'partial-extraction');
  for(const change of [r=>r.items[0].purchaseOrigins[0].purchaseRef='a'.repeat(64),r=>r.unresolvedOrderFingerprints=[],r=>r.verifiedOrderFingerprints.push('b'.repeat(64)),r=>r.outcome='complete',r=>r.failures[0].code='private-account']){
    const bad=structuredClone(receipt);change(bad);assert.throws(()=>validateScanResult(bad,{fullScan:true,knownOrderFingerprints:[]}));
  }
  history.orders[1].detail.items[0].bundles[0].games[0]._id='product-000001';await new Promise(r=>setImmediate(r));run.paths.length=0;
  const recovery=await run.send(false);assert.equal(recovery.summary.ordersScanned,1);assert.equal(recovery.summary.outcome,'complete');assert.equal(run.stored.fanaticalLibraryItems.length,3);
});

test('partial pilot complete first imports save one and 500 orders with normal successful checkpoints',async()=>{
  for(const count of [1,500]){
    const run=harness({...longHistory(count,20),partial:true,initial:{fanaticalImportSummary:null}}),reply=await run.send(false);
    assert.equal(reply.ok,true,reply.error);assert.equal(reply.summary.outcome,'complete');assert.equal(reply.summary.verifiedPurchasesSaved,count);assert.equal(reply.summary.scanMode,'full');
    assert.equal(run.stored.fanaticalLastScanAttempt.status,'complete');assert.equal(run.stored.fanaticalImportSummary.scanMode,'full');assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,count);
    assert.equal(reply.summary.scanDiagnostic.completeCheckpointAdvanced,true);
  }
});

test('partial pilot keeps account checkpoints isolated and rejects an unconfirmed account switch',async()=>{
  const history=longHistory(3,3);history.orders[2].detail.items=[];
  const oldFingerprint=fingerprint('old-account-order'),run=harness({...history,partial:true,known:[oldFingerprint]});
  const bad=await run.send(false,{profileLabel:'work',switchProfile:false});assert.equal(bad.ok,false);assert.equal(run.paths.length,0);assert.deepEqual(run.stored.fanaticalLibraryItems,run.before.fanaticalLibraryItems);
  await new Promise(r=>setImmediate(r));
  const good=await run.send(true,{profileLabel:'work',switchProfile:true});assert.equal(good.ok,true,good.error);
  assert.equal(run.stored.fanaticalProfileLabel,'work');assert.equal(run.stored.fanaticalLibraryItems.length,2);assert(!run.stored.fanaticalScannedOrderFingerprints.includes(oldFingerprint));
  const old=run.stored.fanaticalProfileArchives.find(a=>a.profileLabel==='fixture');assert.deepEqual(old.items,mergeLibraryItems(run.before.fanaticalLibraryItems));assert.deepEqual(old.localScanState.fingerprints,[oldFingerprint]);
  assert.notEqual(run.stored.fanaticalAccountId,run.before.fanaticalAccountId);assert.equal(run.stored.fanaticalImportSummary,null);
});

test('partial pilot empty/unsafe continuation receipts and incompatible companions never manufacture completeness',async()=>{
  const empty=harness({partial:true,list:[],headers:{'x-total-count':'0'},initial:{fanaticalLibraryItems:[],fanaticalImportSummary:null}});assert.equal((await empty.send()).summary.outcome,'complete');
  const unknown=harness({partial:true});const reply=await unknown.send();assert.equal(reply.summary.outcome,'partial-discovery');assert.equal(unknown.stored.fanaticalLastScanAttempt.completeCheckpointAdvanced,false);
  const unsafe=harness({partial:true,headers:{link:'<https://other.example/api/user/orders?page=2>; rel="next"'}});const kept=await unsafe.send();assert.equal(kept.ok,true,kept.error);assert.equal(kept.summary.outcome,'partial-discovery');assert(unsafe.paths.every(path=>path.startsWith('/api/user/orders')));assert.equal(kept.summary.verifiedPurchasesSaved,1);
  const before=structuredClone(unsafe.stored);
  for(const version of [0,2])await assert.rejects(globalThis.FanaticalLibrary.testGalacticLink(async()=>({ok:true,apiVersion:version})),/version|compatible|verified|unavailable/i);
  await assert.rejects(globalThis.FanaticalLibrary.testGalacticLink(async()=>{throw Error('Missing receiver');}));
  assert.deepEqual(unsafe.stored,before);
});

test('partial pilot retains oversized duplicate-product history locally and refuses incompatible purchase-sharing protocols',async()=>{
  const history=longHistory(500,25);for(const order of history.orders)order.detail.items[0].bundles[0].games[0]._id='same-product';history.orders[499].detail.items=[];
  const run=harness({...history,partial:true});assert.equal((await run.send()).ok,true);
  const accounts=await GalacticPurchaseAdapters.accounts('fan',run.stored),data=await GalacticPurchaseAdapters.snapshot('fan',run.stored,accounts[0].accountRef);
  await import('../src/purchase-transfer.js');let sends=0,protocolVersion=0;
  const transfer=GalacticPurchaseTransfer.createService({runtime:{sendMessage:async()=>{sends++;return {ok:true,protocolVersion};}},snapshot:async()=>data});
  const before=structuredClone(run.stored);
  await assert.rejects(transfer.prepare('fanatical',accounts[0].accountRef,'synthetic-peer'),/chunk limit/);assert.equal(sends,0);
  for(const version of [0,2]){protocolVersion=version;await assert.rejects(transfer.request('synthetic-peer',{type:'GH_PURCHASE_ACCOUNTS',provider:'fanatical'}),/Incompatible purchase-sharing protocol/);}
  assert.deepEqual(run.stored,before);assert.equal(run.stored.fanaticalLibraryItems.find(i=>i.sourceItemId==='same-product').purchaseOrigins.length,499);
});

test('partial pilot rejects disjoint account history and uses retained provenance only for attribution, never skip authority',async()=>{
  const history=longHistory(3,3);let foreign=false;
  const run=harness({partial:true,respond:async(path,options)=>{
    if(!foreign)return history.respond(path,options);
    if(path==='/api/user/orders')return {status:200,data:[{...summary,_id:'foreign-order'}],headers:{'x-total-count':'1'}};
    return {status:200,data:{...detail,_id:'foreign-order'}};
  }});
  assert.equal((await run.send(true)).ok,true);const baseline=structuredClone(run.stored);foreign=true;await new Promise(r=>setImmediate(r));
  const rejected=await run.send(true);assert.equal(rejected.ok,false);assert.equal(rejected.scanDiagnostic.code,'account-scope-conflict');
  for(const key of ['fanaticalLibraryItems','fanaticalHistoricalItems','fanaticalScannedOrderFingerprints','fanaticalImportSummary'])assert.deepEqual(run.stored[key],baseline[key]);
  foreign=false;run.stored.fanaticalScannedOrderFingerprints=[];run.stored.fanaticalImportSummary=null;await new Promise(r=>setImmediate(r));run.paths.length=0;
  const restored=await run.send(false);assert.equal(restored.ok,true,restored.error);assert.equal(restored.summary.ordersScanned,3);assert.equal(restored.summary.scanDiagnostic.accountAffinity,'saved-order-match');
  const legacy=harness({...history,partial:true});const guarded=await legacy.send(true,{confirmed:false,useSavedAccount:true});assert.equal(guarded.ok,false);assert.equal(guarded.scanDiagnostic.code,'account-attribution-required');assert.equal(legacy.paths.length,0);assert.deepEqual(legacy.stored.fanaticalLibraryItems,legacy.before.fanaticalLibraryItems);
});

test('full and incremental imports above 20 MiB retain account evidence and corrections when later writes fail', async () => {
  const list=[],details={},count=26000;
  for(let first=0;first<count;first+=25){
    const products=Array.from({length:25},(_,offset)=>quotaProduct(first+offset));
    const bundle=products[0].bundle,id=`quota-order-${first/25}`;
    const leaves=products.map(p=>({_id:p.sourceItemId,name:p.title,type:'book',slug:p.slug,authors:p.authors,language:p.language,edition:p.edition,series:p.series,volume:p.volume,formats:p.formats,drm:p.drm,platforms:p.platforms}));
    details[id]={_id:id,status:'COMPLETE',date:'2026-01-15T12:00:00.000Z',items:[{_id:bundle.sourceItemId,name:bundle.title,slug:bundle.slug,bundles:[{games:leaves}]}]};
    list.push({_id:id,status:'COMPLETE',items:[{name:bundle.title,bundles:[{games:leaves.map(p=>({name:p.name}))}]}]});
  }
  let failure='';
  const run=harness({list,details,initial:quotaBaseline(),onSet:async values=>{if(failure&&Object.hasOwn(values,'fanaticalLibraryItems'))throw Error(failure);}});
  assert.equal((await run.send(true)).ok,true);
  assert.ok(Buffer.byteLength(JSON.stringify(run.stored.fanaticalLibraryItems))>20*1024*1024);
  assert.equal(run.stored.fanaticalLibraryItems.length,count);
  assert.equal(run.stored.fanaticalLibraryItems.find(p=>p.sourceItemId==='quota-product-0').manualMediaType,'comic');
  assert.deepEqual(run.stored.fanaticalProfileArchives,run.before.fanaticalProfileArchives);
  assert.deepEqual(run.stored.fanaticalHistoricalItems,run.before.fanaticalHistoricalItems);
  const fingerprints=[...run.stored.fanaticalScannedOrderFingerprints];
  list.push(summary);details[orderId]=detail;
  await new Promise(resolve=>setImmediate(resolve));
  const updated=await run.send(false);assert.equal(updated.ok,true,updated.error);assert.equal(updated.summary.ordersScanned,1);
  assert.equal(run.stored.fanaticalLibraryItems.length,count+1);
  const foreignId=run.before.fanaticalProfileArchives[0].items[0].sourceItemId;
  assert.ok(run.stored.fanaticalLibraryItems.every(p=>p.sourceItemId!==foreignId));
  assert.ok(fingerprints.every(value=>run.stored.fanaticalScannedOrderFingerprints.includes(value)));
  const saved=structuredClone(run.stored);
  for(const error of ['Resource::kQuotaBytes quota exceeded','Disk write failed']){
    await new Promise(resolve=>setImmediate(resolve));
    failure=error;const reply=await run.send(true);assert.equal(reply.ok,false);assert.match(reply.error,/previous purchases.*kept/);
    for(const key of quotaProtectedFields)assert.deepEqual(run.stored[key],saved[key],`${key} survives ${error}`);
    assert.equal(run.stored.fanaticalSyncControl,null);
    assert.equal(run.stored.fanaticalLastScanAttempt.status,'incomplete');
  }
});

function harness({ list = [summary], details = { [orderId]: detail }, headers = {}, status = 200, invalidJSON = false, known = [], scriptResult, respond, authRead=()=>'SECRET-TOKEN', pageOverrides = {}, initial = {}, onSet, partial = false } = {}) {
  const stored = structuredClone({ ...previous, fanaticalAccountId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',fanaticalProfileLabel:'fixture',fanaticalProfileArchives:[],fanaticalScannedOrderFingerprints: known, ...initial });
  const before = structuredClone(stored); const writes = []; const paths = []; const receipts = [];
  const listeners=[]; let active = 0; let maxActive = 0;
  const page = { TextEncoder, crypto: webcrypto, URL, AbortController, setTimeout, clearTimeout, ...pageOverrides, localStorage: { getItem: () => JSON.stringify({ token:authRead() }) }, fetch: async (url, options) => {
    paths.push(url); active++; maxActive = Math.max(active, maxActive);
    let reply;
    try { reply = respond ? await respond(url, options) : { status, headers, data: url === '/api/user/orders' ? list : details[url.split('/').at(-1)] }; }
    finally { active--; }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, headers: new Headers(reply.headers), json: async () => {
      if (invalidJSON) throw new Error('SECRET raw invalid JSON');
      return reply.json ? reply.json(options) : structuredClone(reply.data);
    } };
  } };
  const chrome = { runtime: { id:'a'.repeat(32),getURL:()=>`chrome-extension://${'a'.repeat(32)}/`, onMessage: { addListener(handler) { listeners.push(handler); } } }, tabs: { query: async () => [{ id: 1, url: 'https://www.fanatical.com/en/orders' }] }, storage: { local: {
    get: async (defaults) => ({ ...defaults, ...structuredClone(stored) }),
    remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete stored[key];},
    set: async (changes) => { if(onSet)await onSet(changes); if(Object.keys(changes).some(key=>key!=='fanaticalSyncControl'))writes.push(structuredClone(changes)); Object.assign(stored, structuredClone(changes)); }
  } }, scripting: { executeScript: async ({ func, args }) => {
    // Keep legacy strict-acquisition regressions; pilot tests opt into the
    // production partial capability and assert the committed state below.
    args[0].allowPartial=partial;
    if (scriptResult) return scriptResult();
    // Execute the serialized function in a separate page world, just like Chrome.
    const mainWorld = vm.runInNewContext(`(${func.toString()})`, page);
    const result = await mainWorld(...args); receipts.push(structuredClone(result)); return [{ result }];
  } } };
  const worker = vm.runInNewContext(`${purchaseModules}\n${fs.readFileSync(new URL('../src/theme.js',import.meta.url),'utf8')}\n${source}\n;({ importPurchases, syncStore });`, { chrome, safeId, validateScanResult, createSyncStore, mergeLibraryItems, importFanaticalOrdersInPage });
  return { stored, before, writes, paths, receipts, get maxActive() { return maxActive; }, scan: (fullScan = true,progressId='') => worker.importPurchases({ fullScan,progressId,profileLabel:'fixture',confirmed:true }),
    store: (operation,args,url='https://www.fanatical.com/en/orders',id=chrome.runtime.id)=>new Promise(resolve=>dispatch(listeners,{type:'FANATICAL_STORE',operation,args},{id,url,tab:{id:1}},resolve)),
    send: (fullScan = true,overrides={}) => new Promise((resolve) => dispatch(listeners,{ type: 'FANATICAL_IMPORT_PURCHASES', fullScan,profileLabel:'fixture',confirmed:true,...overrides }, {id:chrome.runtime.id,url:'https://www.fanatical.com/en/orders',tab:{id:1}}, resolve)) };
}

test('failure reports cross the MAIN boundary as allowlisted aggregates, never page messages or identifiers',async()=>{
  for(const [options,code,stage] of [
    [{authRead:()=>''},'authentication-missing','authentication'],
    [{status:403},'authentication-rejected','listing'],
    [{invalidJSON:true},'listing-unreadable','listing'],
    [{list:[{...summary,items:[]}]},'summaries-unreadable','summaries'],
    [{details:{[orderId]:{...detail,items:[]}}},'details-unreadable','details'],
    [{pageOverrides:{TextEncoder:class{constructor(){throw Error('SECRET account@example.test order-123456');}}}},'page-exception','summaries']
  ]){
    const run=harness(options),reply=await run.send(false);
    assert.equal(reply.ok,false);assert.equal(reply.scanDiagnostic.code,code);assert.equal(reply.scanDiagnostic.stage,stage);
    assert.equal(reply.scanDiagnostic.requestedOperation,'quick');assert.equal(reply.scanDiagnostic.selectedMode,'quick');
    assert.equal(reply.scanDiagnostic.sourceAccountVerified,false);assert.equal(reply.scanDiagnostic.storageAdmission,'not-reached');
    assert.equal(reply.scanDiagnostic.previousLibraryPreserved,true);
    assert(!/SECRET|order-123456|account@|New purchase|TOKEN/u.test(JSON.stringify(reply)));
    for(const key of ['fanaticalLibraryItems','fanaticalImportSummary','fanaticalScannedOrderFingerprints'])assert.deepEqual(run.stored[key],run.before[key]);
  }
  const unsafe=harness({scriptResult:()=>[{result:{fanaticalImportFailure:1,code:'PRIVATE ACCOUNT',diagnostic:{stage:'PRIVATE',authentication:'PRIVATE',pagesAttempted:'PRIVATE',httpStatus:'PRIVATE',token:'SECRET',ordersRecognized:Infinity},message:'SECRET'}}]});
  const reply=await unsafe.send();assert.equal(reply.scanDiagnostic.code,'page-exception');assert.equal(reply.scanDiagnostic.stage,'unknown');assert(!/PRIVATE|SECRET/u.test(JSON.stringify(reply)));
});

test('a named account with missing or corrupt initialization selects a full scan before acquisition',async()=>{
  for(const initial of [{fanaticalImportSummary:null},{fanaticalScannedOrderFingerprints:null},{fanaticalScannedOrderFingerprints:['damaged']}]){
    const run=harness({initial}),reply=await run.send(false);assert.equal(reply.ok,true,reply.error);
    assert.equal(reply.summary.scanMode,'full');assert.equal(reply.summary.scanDiagnostic.requestedOperation,'quick');
    assert.equal(reply.summary.scanDiagnostic.selectedMode,'full');assert.equal(reply.summary.ordersScanned,1);
    assert.deepEqual(run.stored.fanaticalScannedOrderFingerprints,[fingerprint(orderId)]);
  }
});

test('realistic history variations preserve strict acquisition and distinguish failure stages',async()=>{
  const variants=[
    ['one order',longHistory(1,20),true],
    ['several on one page',longHistory(7,20),true],
    ['multiple full pages',longHistory(40,20),true],
    ['partial last page',longHistory(43,20),true],
    ['many pages',longHistory(257,20),true],
    ['older sparse metadata',{list:[summary],details:{[orderId]:{...detail,date:'2011-03-02T00:00:00Z'}}},true],
    ['mixed products',{list:[{...summary,items:[{name:'Bundle',bundles:[{games:['game','book','software','audiobook','video','elearning'].map((type)=>({name:'Synthetic '+type}))}]}]}],details:{[orderId]:{...detail,items:[{...detail.items[0],bundles:[{games:['game','book','software','audiobook','video','elearning'].map(type=>({_id:'product-'+type,name:'Synthetic '+type,type}))}]}]}}},true],
    ['delayed list',{respond:async path=>{await new Promise(r=>setTimeout(r,10));return {status:200,data:path==='/api/user/orders'?[summary]:detail};}},true],
    ['late HTTP failure',{...retryClock(),respond:async path=>path==='/api/user/orders'?{status:200,data:[summary],headers:{'x-total-count':'2',link:'<?page=2>; rel="next"'}}:{status:503}},false],
    ['duplicate page',{respond:async()=>({status:200,data:[summary],headers:{link:'<?page=2>; rel="next"'}})},false],
    ['genuine empty',{list:[],initial:{fanaticalLibraryItems:[],fanaticalImportSummary:null}},true],
    ['unauthenticated empty HTML',{respond:async()=>({status:200,data:'<html>Sign in</html>'})},false],
    ['unknown continuation shape',{list:[summary],headers:{'x-total-count':'2',link:'</account/orders?page=2>; rel="next"'}},false],
    ['malformed purchase',{details:{[orderId]:{...detail,items:[{...detail.items[0],bundles:[{games:[{name:'Missing identity'}]}]}]}}},false]
  ];
  for(const [name,options,complete]of variants){
    const run=harness(options),reply=await run.send(true);assert.equal(reply.ok,complete,name);
    const report=reply.scanDiagnostic??reply.summary.scanDiagnostic;
    assert.equal(report.storageAdmission,complete?'committed':'not-reached',name);
    assert(!JSON.stringify(report).includes('SECRET'),name);
    if(!complete)for(const key of ['fanaticalLibraryItems','fanaticalImportSummary','fanaticalScannedOrderFingerprints'])assert.deepEqual(run.stored[key],run.before[key],name);
  }
});

test('serialized importer emits only aggregate progress and explains missing saved scan history', async () => {
  const messages=[],progressId='a'.repeat(32);
  const pageOverrides={window:{postMessage:(data,origin)=>messages.push({data:structuredClone(data),origin})}};
  const run=harness({pageOverrides});
  const result=await run.scan(false,progressId);
  assert.equal(result.scanHistoryMissing,true);
  assert.deepEqual(messages.map(message=>message.data.progress.phase),['list','plan','details']);
  assert.equal(messages[1].data.progress.scanHistoryMissing,true);
  assert.equal(messages[2].data.progress.completed,1);
  assert.ok(messages.every(message=>message.origin==='https://www.fanatical.com'&&message.data.progressId===progressId));
  const text=JSON.stringify(messages);
  for(const value of ['SECRET-TOKEN',orderId,'New purchase','product-123456'])assert.equal(text.includes(value),false);
  messages.length=0;
  const known=harness({pageOverrides,known:[fingerprint(orderId)]});
  assert.equal((await known.scan(false,progressId)).scanHistoryMissing,false);
  assert.equal(messages.at(-1).data.progress.total,0);
  assert.equal(messages.at(-1).data.progress.skipped,1);
  assert.equal(messages.some(message=>message.data.progress.phase==='details'),false);
});

test('HTTP-success malformed order lists never alter purchases, summary or fingerprints', async () => {
  for (const list of [null, {}, { orders: [] }, { error: 'SECRET' }, 'unreadable', [null], [{ _id: orderId }], [{ status: 'COMPLETE' }], [{ _id: 123456, status: 'COMPLETE' }], [summary, summary]]) {
    for (const full of [true, false]) {
      const run = harness({ list });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('serialized purchase importer retains only bounded bibliographic leaves for matching', async () => {
  const expanded = structuredClone(detail);
  Object.assign(expanded.items[0].bundles[0].games[0], {
    type: 'manga', authors: ['Writer', { key: 'SECRET-AUTHOR' }], language: 'en', run: '2020', series: 'Saga', issue: '1/2', edition: 'First', publisher: 'Publisher',
    token: 'SECRET-TOKEN', metadata: { downloadUrl: 'SECRET-URL' }
  });
  const run = harness({ details: { [orderId]: expanded } });
  await run.scan();
  const item = run.stored.fanaticalLibraryItems[0];
  assert.equal(item.mediaType, 'book');
  assert.deepEqual(item.authors, ['Writer']);
  assert.equal(item.run, '2020'); assert.equal(item.language, 'en'); assert.equal(item.issue, '1/2');
  assert.equal(JSON.stringify(run.receipts).includes('SECRET'), false);
  assert.equal(JSON.stringify(item).includes('SECRET'), false);
});

test('invalid JSON, partial HTTP success and unusable pagination indicators preserve the library', async () => {
  for (const config of [{ invalidJSON: true }, { status: 206 }, { headers: { link: '</api/user/orders?page=2>; rel="next"' } }, { headers: { link: '</api/user/orders?page=2>; rel="prev next"' } }, { headers: { 'x-total-count': '2' } }, { headers: { 'content-range': 'items 0-0/2' } }, { headers: { 'content-range': 'items 1-1/2' } }]) {
    const run = harness(config);
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('a genuine empty array is a validated empty account, not a failed read', async () => {
  const run = harness({ list: [], headers: { 'content-range': 'items */0', 'x-total-count': '0' } });
  const result = await run.scan();
  assert.equal(result.ordersScanned, 0);
  assert.equal(result.ownedLeafProducts, 0);
  assert.match(result.historyCoverage, /Valid empty order history/);
  assert.deepEqual(run.stored.fanaticalLibraryItems, []);
  assert.equal(run.paths.length, 1);
  assert.equal(run.writes.length, 1);
});

test('quick scan of a valid empty account preserves existing records rather than replacing them', async () => {
  const run = harness({ list: [] });
  await run.scan(false);
  assert.deepEqual(run.stored.fanaticalLibraryItems, run.before.fanaticalLibraryItems.map(item=>({...item,purchaseDate:item.purchaseDate??null})));
});

test('a refunded known order remains listed coverage, but is not imported as owned', async () => {
  const run = harness({ list: [{ _id: orderId, status: 'REFUNDED' }], known: [fingerprint(orderId)] });
  const result = await run.scan();
  assert.equal(result.ordersScanned, 0);
  assert.equal(run.paths.length, 1);
  assert.deepEqual(run.stored.fanaticalLibraryItems, []);
  assert.equal(result.historyCoverage.includes('Valid empty order history'), false);
});

test('a list missing known orders is not accepted as complete, even if it is an empty array', async () => {
  for (const list of [[], [summary]]) {
    const run = harness({ list, known: [fingerprint('missing-123456')] });
    await assert.rejects(run.scan(), /omits previously scanned/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('malformed/mismatched/non-complete details and unsupported leaf shapes cannot rebuild', async () => {
  const invalid = [null, {}, { ...detail, _id: 'different-123456' }, { ...detail, status: 'REFUNDED' }, { ...detail, items: null }, { ...detail, items: [] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle' }] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [] }] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [{ _id: 'product-123456' }] }] }] }];
  for (const broken of invalid) {
    for (const full of [true, false]) {
      const run = harness({ details: { [orderId]: broken } });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('one unreadable detail aborts the entire multi-order rebuild and quick scan', async () => {
  for (const full of [true, false]) {
    const run = harness({ list: [summary, { ...summary, _id: 'order-654321' }], details: { [orderId]: detail, 'order-654321': { error: 'SECRET' } } });
    await assert.rejects(run.scan(full));
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('nonempty details must cover every product occurrence named in their order summary', async () => {
  const incompleteSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'Missing purchase' }] }] }] };
  const duplicateSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'New purchase' }] }] }] };
  for (const list of [[incompleteSummary], [duplicateSummary]]) {
    const run = harness({ list });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('full scan validates every completed order; quick scan validates only unseen ones', async () => {
  const full = harness({ known: [fingerprint(orderId)], headers: { 'x-total-count': '1', 'content-range': 'items 0-0/1' } });
  const fullResult = await full.scan();
  assert.equal(fullResult.ordersScanned, 1);
  assert.equal(full.stored.fanaticalLibraryItems[0].title, 'New purchase');
  const quick = harness({ known: [fingerprint(orderId)] });
  const quickResult = await quick.scan(false);
  assert.equal(quickResult.ordersScanned, 0);
  assert.equal(quickResult.ordersSkipped, 1);
  assert.equal(quick.paths.length, 1);
  assert.deepEqual(quick.stored.fanaticalLibraryItems, quick.before.fanaticalLibraryItems.map(item=>({...item,purchaseDate:item.purchaseDate??null})));
});

test('worker refuses missing, partial or silently lossy MAIN-world results before storage writes', async () => {
  const receipt = { schemaVersion: 1, ordersAvailable: 1, ordersScanned: 1, coverage: { complete: true, listedOrders: 1, validatedOrders: 1, emptyAccount: false, pagesFetched: 1, expectedTotal: null, paginationEvidence: 'array-only', retries: 0, concurrency: 3 }, orderFingerprints: [fingerprint(orderId)], items: [{ source: 'fanatical', sourceItemId: 'product-123456', title: 'Purchase', bundle: { sourceItemId: 'bundle-123456', title: 'Bundle' } }] };
  const bad = [undefined, {}, { ...receipt, coverage: undefined }, { ...receipt, ordersScanned: 0 }, { ...receipt, items: [] }, { ...receipt, coverage: { ...receipt.coverage, validatedOrders: 0 } }, { ...receipt, orderFingerprints: [] }, { ...receipt, orderFingerprints: ['bad'] }, { ...receipt, items: [{ title: 'Dropped item' }] }, { ...receipt, items: [...receipt.items, ...receipt.items] }];
  for (const result of bad) {
    const run = harness({ scriptResult: () => [{ result }] });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
  const noResult = harness({ scriptResult: () => [] });
  await assert.rejects(noResult.scan(), /complete result/);
  assert.equal(noResult.writes.length, 0);
});

test('scan failures expose no raw response, token or order details', async () => {
  const run = harness({ invalidJSON: true });
  await assert.rejects(run.scan(), (error) => !error.message.includes('SECRET') && /not changed/u.test(error.message));
});

function longHistory(count = 1000, pageSize = 40) {
  const orders = Array.from({ length: count }, (_, index) => {
    const id = `order-${String(index).padStart(6, '0')}`;
    return { summary: { ...summary, _id: id }, detail: { ...detail, _id: id, items: [{ ...detail.items[0], bundles: [{ games: [{ ...detail.items[0].bundles[0].games[0], _id: `product-${String(index).padStart(6, '0')}` }] }] }] } };
  });
  const respond = async (path, options) => {
    const url = new URL(path, 'https://www.fanatical.com');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'SECRET-TOKEN');
    if (url.pathname === '/api/user/orders') {
      const page = Number(url.searchParams.get('page') || 1); const start = (page - 1) * pageSize;
      const data = orders.slice(start, start + pageSize).map((entry) => entry.summary);
      return { status: 200, data, headers: { 'x-total-count': String(count), 'content-range': `orders ${start}-${start + data.length - 1}/${count}`,
        ...(start + data.length < count ? { link: `</api/user/orders?page=${page + 1}>; rel="next"; title="Next, purchase page"` } : {}) } };
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
    const id = url.pathname.split('/').at(-1);
    return { status: 200, data: orders.find((entry) => entry.detail._id === id)?.detail };
  };
  return { orders, respond };
}

// Fast deterministic backoff tests: request watchdogs stay cancellable, while
// retry waits advance a virtual wall clock without real multi-second sleeps.
function retryClock({ watchdog = 1000 } = {}) {
  let now = Date.parse('2026-10-01T12:00:00Z'); const waits = [];
  const math = Object.create(Math); math.random = () => 0;
  return { waits, get now() { return now; }, pageOverrides: {
    Date: class extends Date { static now() { return now; } }, Math: math,
    setTimeout(callback, ms) {
      if (ms === 20000) return setTimeout(callback, watchdog);
      waits.push(ms); return setTimeout(() => { now += ms; callback(); }, 0);
    }
  } };
}

test('1,000 orders across 25 pages validate with no more than three detail fetches in flight', async () => {
  const run = harness(longHistory());
  const result = await run.scan();
  assert.equal(result.ordersScanned, 1000); assert.equal(result.ownedLeafProducts, 1000);
  assert.equal(result.coverage.pagesFetched, 25); assert.equal(result.coverage.expectedTotal, 1000);
  assert.equal(result.coverage.paginationEvidence, 'range'); assert.equal(run.maxActive, 3);
  assert.equal(run.paths.length, 1025); assert.equal(run.writes.length, 1);
  assert.equal(run.stored.fanaticalScannedOrderFingerprints.length, 1000);
  assert.equal(JSON.stringify(run.stored).includes('SECRET'), false);
  assert.equal(JSON.stringify(run.stored).includes('order-000'), false);
});

test('quick scan traverses the entire long history but fetches only unseen completed orders', async () => {
  const history = longHistory(); const known = history.orders.slice(0, 995).map(({ summary: order }) => fingerprint(order._id));
  const run = harness({ ...history, known }); const result = await run.scan(false);
  assert.equal(result.ordersScanned, 5); assert.equal(result.ordersSkipped, 995);
  assert.equal(result.coverage.pagesFetched, 25); assert.equal(run.paths.length, 30);
  assert.equal(run.stored.fanaticalLibraryItems.length, 6); assert.equal(run.maxActive, 3);
});

test('explicit same-endpoint cursor links can complete without inventing query conventions', async () => {
  const secondId = 'order-654321';
  const run = harness({ respond: async (path) => {
    if (path === '/api/user/orders') return { status: 200, data: [summary], headers: { link: '<https://www.fanatical.com/api/user/orders?cursor=SECRET-CURSOR>; rel="next"' } };
    if (path.includes('?cursor=')) return { status: 200, data: [{ ...summary, _id: secondId }] };
    return { status: 200, data: { ...detail, _id: path.split('/').at(-1) } };
  } });
  const result = await run.scan();
  assert.equal(result.coverage.pagesFetched, 2); assert.equal(result.coverage.paginationEvidence, 'link');
  assert.match(result.historyCoverage, /no independent history total/);
  assert.equal(JSON.stringify(run.receipts).includes('SECRET'), false);
});

test('bare-array coverage explicitly discloses that silent truncation cannot be verified', async () => {
  const run = harness(); const result = await run.scan();
  assert.equal(result.coverage.paginationEvidence, 'array-only');
  assert.match(result.historyCoverage, /silent server truncation/);
});

test('pagination loops, repeated orders, gaps, changing totals, missing next links and unreadable pages never commit', async () => {
  const second = { ...summary, _id: 'order-654321' };
  const cases = [
    [{ data: [summary], headers: { link: '</api/user/orders>; rel="next"' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: [summary] }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'content-range': 'orders 0-0/3' } }, { data: [second], headers: { 'content-range': 'orders 2-2/3' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'x-total-count': '2' } }, { data: [second], headers: { 'x-total-count': '3' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'content-range': 'orders 0-0/2' } }, { data: [second] }],
    [{ data: [summary], headers: { 'x-total-count': '2' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: { orders: [second], total: 2 } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: [], headers: { link: '<?page=3>; rel="next"' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="last"' } }],
    [{ data: [], headers: { 'x-total-count': '1' } }],
    [{ data: [summary], headers: { 'x-total-count': '0' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'x-total-count': '1' } }]
  ];
  for (const pages of cases) {
    for (const full of [true, false]) {
      let index = 0;
      const run = harness({ respond: async () => ({ status: 200, ...pages[index++] }) });
      await assert.rejects(run.scan(full), /incomplete|unreadable/u);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before); assert.equal(run.writes.length, 0);
      assert.equal(run.paths.every((path) => new URL(path, 'https://www.fanatical.com').pathname === '/api/user/orders'), true);
    }
  }
});

test('unsafe or ambiguous pagination never receives the authorization token', async () => {
  for (const link of ['<https://evil.example/api/user/orders?page=2>; rel="next"', '</api/basket>; rel="next"', '<http://www.fanatical.com/api/user/orders?page=2>; rel="next"', '<https://user:password@www.fanatical.com/api/user/orders?page=2>; rel="next"', '<?page=2#secret>; rel="next"', '<?page=2>; rel="next", <?page=3>; rel="next"', '<?page=2>; rel="next"; anchor="/elsewhere"', '<?page=2>; rel="next"; rel="last"', '<?page=2>; rel="next']) {
    const run = harness({ headers: { link } });
    await assert.rejects(run.scan()); assert.equal(run.paths.length, 1); assert.equal(run.writes.length, 0);
  }
});

test('the page safety limit rejects an endless unique next-page chain', async () => {
  let page = 0;
  const run = harness({ respond: async () => {
    page++; return { status: 200, data: [{ ...summary, _id: `order-${String(page).padStart(6, '0')}` }], headers: { link: `<?page=${page + 1}>; rel="next"` } };
  } });
  await assert.rejects(run.scan(), /1,000-page safety limit/);
  assert.equal(run.paths.length, 1000); assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
});

test('transport errors and transient HTTP statuses retry GET with exponential backoff', async () => {
  for (const failure of ['network', 408, 429, 500, 502, 503, 504]) {
    const clock = retryClock(); let attempts = 0;
    const run = harness({ ...clock, respond: async (path) => {
      if (path === '/api/user/orders' && ++attempts < 3) {
        if (failure === 'network') throw new Error('SECRET socket error');
        return { status: failure };
      }
      return { status: 200, data: path === '/api/user/orders' ? [summary] : detail };
    } });
    const result = await run.scan();
    assert.deepEqual(clock.waits, [500, 1000]); assert.equal(result.coverage.retries, 2);
    assert.equal(run.paths.length, 4); assert.equal(run.writes.length, 1);
  }
});

test('Retry-After seconds and HTTP dates are respected; long delays stop rather than retry early', async () => {
  for (const kind of ['seconds', 'date', 'invalid']) {
    const clock = retryClock(); let attempts = 0;
    const header = kind === 'seconds' ? '2' : kind === 'date' ? new Date(clock.now + 2000).toUTCString() : 'nonsense';
    const run = harness({ ...clock, respond: async (path) => path === '/api/user/orders' && ++attempts === 1
      ? { status: 429, headers: { 'retry-after': header } } : { status: 200, data: path === '/api/user/orders' ? [summary] : detail } });
    await run.scan(); assert.deepEqual(clock.waits, [kind === 'invalid' ? 500 : 2000]);
  }
  const clock = retryClock();
  const run = harness({ ...clock, respond: async () => ({ status: 503, headers: { 'retry-after': '120' } }) });
  await assert.rejects(run.scan(), /try scanning again later/);
  assert.equal(run.paths.length, 1); assert.equal(clock.waits.length, 0); assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
});

test('timeouts cover response headers and body reads and exhaust a bounded retry budget', async () => {
  for (const body of [false, true]) {
    const clock = retryClock({ watchdog: 1 }); let aborted = 0;
    const hang = (options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('SECRET timeout')); }, { once: true }));
    const run = harness({ ...clock, respond: async (_path, options) => body ? { status: 200, json: hang } : hang(options) });
    await assert.rejects(run.scan(), /three attempts/);
    assert.equal(run.paths.length, 3); assert.equal(aborted, 3); assert.deepEqual(clock.waits, [500, 1000]);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
  }
});

test('expired sessions, permanent errors and malformed successful responses are not retried', async () => {
  for (const status of [400, 401, 403, 404, 206]) {
    const clock = retryClock(); const run = harness({ ...clock, status });
    await assert.rejects(run.scan()); assert.equal(run.paths.length, 1); assert.equal(clock.waits.length, 0);
  }
  const clock = retryClock(); const run = harness({ ...clock, invalidJSON: true });
  await assert.rejects(run.scan(), /unreadable/); assert.equal(run.paths.length, 1);
});

test('a failing detail stops the queue, aborts in-flight requests and preserves all existing scan state', async () => {
  const history = longHistory(30, 30); let aborted = 0;
  const run = harness({ respond: async (path, options) => {
    if (path === '/api/user/orders') return { status: 200, data: history.orders.map((entry) => entry.summary) };
    if (path.endsWith('000000')) { await new Promise((resolve) => setTimeout(resolve, 5)); return { status: 404 }; }
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('SECRET abort')); }, { once: true }));
  } });
  await assert.rejects(run.scan());
  assert.equal(run.paths.length, 4); assert.equal(aborted, 2); assert.equal(run.maxActive, 3);
  assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before); assert.equal(run.writes.length, 0);
});

test('runtime scan failures expose incomplete coverage without replacing purchases or successful summary', async () => {
  const run = harness({ invalidJSON: true }); const reply = await run.send();
  assert.equal(reply.ok, false); assert.match(reply.error, /Scan incomplete/);
  assert.deepEqual(run.stored.fanaticalLibraryItems, run.before.fanaticalLibraryItems);
  assert.deepEqual(run.stored.fanaticalImportSummary, run.before.fanaticalImportSummary);
  assert.deepEqual(run.stored.fanaticalScannedOrderFingerprints, run.before.fanaticalScannedOrderFingerprints);
  assert.equal(run.stored.fanaticalLastScanAttempt.status, 'incomplete');
  assert.equal(JSON.stringify({ reply, writes: run.writes }).includes('SECRET'), false);
});

test('overlapping runtime imports are rejected without starting a second scan', async () => {
  let release;
  const run = harness({ respond: async (path) => {
    if (path === '/api/user/orders') await new Promise((resolve) => { release = resolve; });
    return { status: 200, data: path === '/api/user/orders' ? [summary] : detail };
  } });
  const first = run.send(); const second = await run.send(false);
  assert.equal(second.ok, false); assert.match(second.error, /already running/);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  release(); assert.equal((await first).ok, true); assert.equal(run.paths.length, 2);
});

test('detail retries stay bounded and a shared server cooldown also delays queued orders', async () => {
  const history = longHistory(6, 6); const clock = retryClock(); const started = []; let attempts = 0;
  const retryAfterDeadline = clock.now + 2000;
  const run = harness({ ...clock, respond: async (path, options) => {
    if (path === '/api/user/orders') return { status: 200, data: history.orders.map((entry) => entry.summary) };
    started.push({ path, at: clock.now });
    if (path.endsWith('000000') && ++attempts === 1) return { status: 503, headers: { 'retry-after': '2' } };
    return history.respond(path, options);
  } });
  const result = await run.scan(); assert.equal(result.coverage.retries, 1);
  assert.equal(result.ordersScanned, 6); assert.ok(run.maxActive <= 3);
  assert.equal(started.filter((entry) => entry.path.endsWith('000000')).length, 2);
  assert.ok(started.slice(3).every((entry) => entry.at >= retryAfterDeadline));
});

test('consistent count metadata validates a page chain without Content-Range', async () => {
  let page = 0;
  const run = harness({ respond: async (path) => {
    if (path.startsWith('/api/user/orders/')) return { status: 200, data: { ...detail, _id: path.split('/').at(-1) } };
    page++; return { status: 200, data: [{ ...summary, _id: `order-${String(page).padStart(6, '0')}` }], headers: { 'x-total-count': '2', ...(page === 1 ? { link: '<?page=2>; rel="next"' } : {}) } };
  } });
  const result = await run.scan(); assert.equal(result.coverage.paginationEvidence, 'count');
  assert.equal(result.coverage.expectedTotal, 2); assert.equal(result.coverage.pagesFetched, 2);
});

test('invalid coverage receipts cannot assert independent pagination validation', () => {
  const receipt = { schemaVersion: 1, ordersAvailable: 0, ordersScanned: 0, items: [], orderFingerprints: [],
    coverage: { complete: true, listedOrders: 0, validatedOrders: 0, emptyAccount: true, pagesFetched: 1, expectedTotal: null, paginationEvidence: 'array-only', retries: 0, concurrency: 3 } };
  for (const changes of [{ pagesFetched: 0 }, { pagesFetched: 1001 }, { pagesFetched: 2 }, { retries: -1 }, { concurrency: 1000 }, { paginationEvidence: 'verified' }, { paginationEvidence: 'link' }, { paginationEvidence: 'count' }, { expectedTotal: 1 }, { expectedTotal: 0 }, { pagesFetched: undefined }]) {
    assert.throws(() => validateScanResult({ ...receipt, coverage: { ...receipt.coverage, ...changes } }), /incomplete/);
  }
});

test('a broken response-body transport is retried, unlike malformed JSON', async () => {
  const clock = retryClock(); let attempts = 0;
  const run = harness({ ...clock, respond: async (path) => path === '/api/user/orders' && ++attempts === 1
    ? { status: 200, json: () => { throw new TypeError('SECRET interrupted body'); } }
    : { status: 200, data: path === '/api/user/orders' ? [summary] : detail } });
  const result = await run.scan(); assert.equal(result.coverage.retries, 1); assert.deepEqual(clock.waits, [500]);
  const overflowing = harness({ ...retryClock(), respond: async () => ({ status: 503, headers: { 'retry-after': '9'.repeat(400) } }) });
  await assert.rejects(overflowing.scan(), /try scanning again later/); assert.equal(overflowing.paths.length, 1);
});

test('a session change during serialized scanning prevents ownership writes without exposing tokens',async()=>{
  let reads=0;const run=harness({authRead:()=>++reads===1?'FIRST-SECRET':'SECOND-SECRET'});
  await assert.rejects(run.scan(),/session changed/);assert.equal(run.writes.length,0);assert.deepEqual(run.stored.fanaticalLibraryItems,run.before.fanaticalLibraryItems);
});


test('5,000 purchases across 100 pages retain every product and finish at bounded concurrency', async()=>{
  const run=harness(longHistory(5000,50)),result=await run.scan();assert.equal(result.ordersScanned,5000);assert.equal(result.ownedLeafProducts,5000);assert.equal(result.coverage.pagesFetched,100);assert.equal(result.coverage.expectedTotal,5000);assert.equal(run.maxActive,3);assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,5000);
});
test('an advertised last page remains mandatory when later headers omit it, and cannot change mid-scan',async()=>{
  for(const changed of [false,true]){let page=0;const run=harness({respond:async()=>{page++;return {status:200,data:[{...summary,_id:'order-'+String(page).padStart(6,'0')}],headers:page===1?{link:'<?page=2>; rel="next", <?page=3>; rel="last"'}:changed?{link:'<?page=2>; rel="last"'}:{}};}});await assert.rejects(run.scan(),/incomplete/);assert.equal(run.writes.length,0);assert.deepEqual(run.stored.fanaticalLibraryItems,run.before.fanaticalLibraryItems);}
});


test('full and quick imports retain separate same-product purchases and multiplicity without raw order identifiers',async()=>{
  const orders=[1,2].map(n=>{const id='repeat-order-'+n,leaf={...detail.items[0].bundles[0].games[0]};return {summary:{...summary,_id:id,items:[{name:'Bundle '+n,bundles:[{games:Array.from({length:n},()=>({name:leaf.name}))}]}]},detail:{...detail,_id:id,date:'2026-09-0'+n+'T00:00:00Z',items:[{...detail.items[0],name:'Bundle '+n,bundles:[{games:Array.from({length:n},()=>leaf)}]}]}};});
  const run=harness({respond:async path=>({status:200,data:path==='/api/user/orders'?orders.map(row=>row.summary):orders.find(row=>row.detail._id===path.split('/').at(-1))?.detail})});await run.scan();let item=run.stored.fanaticalLibraryItems[0];assert.equal(run.stored.fanaticalLibraryItems.length,1);assert.equal(item.purchaseOrigins.length,2);assert.deepEqual(item.purchaseOrigins.map(row=>row.quantity),[1,2]);assert.equal(item.bundle.title,'Bundle 2');
  const third=structuredClone(orders[0]);third.summary._id=third.detail._id='repeat-order-3';third.detail.date='2026-09-03T00:00:00Z';orders.push(third);await run.scan(false);item=run.stored.fanaticalLibraryItems[0];assert.equal(item.purchaseOrigins.length,3);await run.scan(false);assert.equal(run.stored.fanaticalLibraryItems[0].purchaseOrigins.length,3);assert(!JSON.stringify(run.stored).includes('repeat-order'));
});


test('profile operations are limited to own settings and order pages, with explicit account confirmation',async()=>{
  const run=harness(),before=structuredClone(run.stored),args=[{profileLabel:'fixture',expectedActiveLabel:'fixture',newLabel:'personal',confirmed:true}];
  for(const url of ['https://www.fanatical.com/en/bundle/test','https://www.fanatical.com.evil.test/en/orders','https://other.example/en/orders'])for(const operation of ['selectProfile','renameProfile']){const reply=await run.store(operation,args,url);assert.equal(reply.ok,false);assert.match(reply.error,/Untrusted/);assert.deepEqual(run.stored,before);}
  assert.equal((await run.store('renameProfile',args,'https://www.fanatical.com/en/orders','foreign')).ok,false);
  const noConfirm=await run.store('renameProfile',[{...args[0],confirmed:false}]);assert.equal(noConfirm.ok,false);assert.deepEqual(run.stored,before);
  assert.equal((await run.store('profiles',[])).ok,true);assert.equal((await run.store('renameProfile',args,'chrome-extension://'+'a'.repeat(32)+'/src/options.html')).ok,true);assert.equal(run.stored.fanaticalProfileLabel,'personal');
});
