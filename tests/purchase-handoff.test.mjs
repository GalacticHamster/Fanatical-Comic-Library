import test from 'node:test';import assert from 'node:assert/strict';
import {createSyncStore as createFanStore} from '../src/library-data.mjs';
const S=globalThis.GalacticPurchaseSnapshot,A=globalThis.GalacticPurchaseAdapters,H=globalThis.HumbleComicLibrary;
const row=(n=0,provider='fanatical')=>({providerItemId:provider==='fanatical'?'product_'+n:'purchase_'+n+':product:native_'+n,title:'Synthetic book '+n,mediaType:'book',metadata:provider==='fanatical'?{bundleId:'bundle_123',bundleTitle:'Synthetic bundle'}:{purchaseId:'purchase_'+n,sourceBundle:'Synthetic bundle'},purchasedAt:null,origins:[]});
const snapshot=(records=[row()],provider='fanatical')=>S.validate({protocolVersion:1,provider,snapshotId:'snapshot-control',accountRef:'source-profile',accountLabel:'Personal',capturedAt:'2026-10-09T12:00:00Z',scope:'historical',completeness:'partial',limitations:[],records});
function memory(values={}){return {values,sets:0,get:async defaults=>structuredClone({...defaults,...values}),async set(updates){this.sets++;Object.assign(values,structuredClone(updates));},remove:async()=>{}};}
for(const role of ['fan'])test(role+' real serialized importer: repeat/restart, overlap, richer fields and separate account',async()=>{
 const provider=role==='hb'?'humble':'fanatical',itemKey=role==='hb'?'libraryItems':'fanaticalLibraryItems',labelKey=role==='hb'?'humbleProfileLabel':'fanaticalProfileLabel',archivesKey=role==='hb'?'profileArchives':'fanaticalProfileArchives';
 const area=memory({[itemKey]:[],[labelKey]:'Personal',[archivesKey]:[]}),make=()=>role==='hb'?H.createSyncStore(area):createFanStore(area);let store=make();
 const ref=async()=>(await store.execute('handoffAccounts'))[0].accountRef;
 const data=snapshot([row(1,provider)],provider);
 assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).added,1);
 const before=JSON.stringify(area.values),writes=area.sets;
 assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).unchanged,1);assert.equal(JSON.stringify(area.values),before);assert.equal(area.sets,writes);
 store=make();assert.equal((await store.execute('handoffImport',[data,{accountRef:await ref()}])).unchanged,1);
 const overlap=snapshot([row(1,provider),row(2,provider)],provider);assert.equal((await store.execute('handoffImport',[{...overlap,scope:'incremental'},{accountRef:await ref()}])).added,1);assert.equal(area.values[itemKey].length,2);
 area.values[itemKey][0].publisher='Richer local publisher';const stale=await ref();
 const historical=snapshot([{...row(1,provider),metadata:{...row(1,provider).metadata,publisher:'Historical publisher'}}],provider);
 await store.execute('handoffImport',[historical,{accountRef:stale}]);assert.equal(area.values[itemKey][0].publisher,'Richer local publisher');
 assert.equal((await store.execute('handoffImport',[data,{newLabel:'Separate',expectedActiveLabel:'Personal'}])).added,1);assert.equal(area.values[labelKey],'Personal');assert.equal(area.values[archivesKey].length,1);
 await assert.rejects(store.execute('handoffImport',[data,{accountRef:'not-this-account'}]));assert.equal(area.values[itemKey].length,2);
 const freshRef=await ref();area.values[itemKey].push(role==='hb'?{title:'Native scan item',kind:'book',purchaseKey:'p-native'}:{source:'fanatical',sourceItemId:'native_123',title:'Native scan item',mediaType:'book'});
 await assert.rejects(store.execute('handoffImport',[data,{accountRef:freshRef}]),/changed/);
});
test('FAN order/bundle occurrence counts are idempotent and overlapping groups are preserved',()=>{
 const order='a'.repeat(64),other='b'.repeat(64),origin={orderRef:order,bundleId:'bundle_123',bundleTitle:'Synthetic bundle',bundleSlug:'',purchasedAt:null,quantity:2,occurrenceRefs:[]};
 const first=A.fanMerge([],[{...row(),origins:[origin]}]);const again=A.fanMerge(first.items,[{...row(),origins:[origin]}]);assert.deepEqual(again.items,first.items);assert.equal(again.items[0].purchaseOrigins[0].quantity,2);
 const added=A.fanMerge(again.items,[{...row(),origins:[{...origin,orderRef:other,quantity:1}]}]);assert.equal(added.items[0].purchaseOrigins.length,2);
});

test('Legacy named FAN accounts with primary bundle only, empty archives and missing IDs stay discoverable',async()=>{
 const rows=Array.from({length:47},(_,n)=>({source:'fanatical',sourceItemId:'legacy_'+n,title:'Legacy book '+n,mediaType:'book',bundle:{sourceItemId:'legacy_bundle',title:'Legacy bundle'}}));const area=memory({fanaticalProfileLabel:'Personal',fanaticalLibraryItems:rows,fanaticalProfileArchives:[{profileLabel:'Empty',items:[]},{profileLabel:'Incomplete',items:[{title:'Unidentified',mediaType:'book'}]}]}),store=createFanStore(area);const accounts=await store.execute('handoffAccounts');assert.equal(accounts.length,3);assert.equal(accounts[0].eligibleCount,47);assert.equal(accounts[1].count,0);assert.equal(accounts[2].eligibleCount,0);const snapshot=await store.execute('handoffSnapshot',[accounts[0].accountRef]);assert.equal(snapshot.records.length,47);assert.equal(snapshot.records[0].metadata.bundleTitle,'Legacy bundle');assert.equal(snapshot.records[0].origins.length,0);assert.equal(area.sets,0);
});

test('FAN preview is read-only and uses the real merge for existing, new and additional titles',async()=>{
 const area=memory({fanaticalProfileLabel:'Personal',fanaticalLibraryItems:[],fanaticalSyncControl:{active:true}}),store=createFanStore(area),ref=(await store.execute('handoffAccounts'))[0].accountRef;
 const data=snapshot([row(1),row(2)]),before=JSON.stringify(area.values);
 const preview=await store.execute('handoffPreview',[data,{accountRef:ref}]);assert.equal(preview.readOnly,true);assert.equal(preview.added,2);assert.equal(preview.newTitleNames,2);assert.equal(JSON.stringify(area.values),before);assert.equal(area.sets,0);
 const fresh=await store.execute('handoffPreview',[data,{newLabel:'Separate',expectedActiveLabel:'Personal'}]);assert.equal(fresh.added,2);assert.equal(area.sets,0);
 delete area.values.fanaticalSyncControl;await store.execute('handoffImport',[data,{accountRef:ref}]);const next=(await store.execute('handoffAccounts'))[0].accountRef;
 const unchanged=await store.execute('handoffPreview',[data,{accountRef:next}]);assert.equal(unchanged.unchanged,2);assert.equal(unchanged.newTitleNames,0);
 const additional=await store.execute('handoffPreview',[snapshot([{...row(3),title:row(1).title}]),{accountRef:next}]);assert.equal(additional.additionalRecords,1);assert.equal(additional.newTitleNames,0);
 await assert.rejects(store.execute('handoffPreview',[data,{accountRef:ref}]),/changed/);
});


test('FAN preview applies the same destination validation as import without writing',async()=>{
 const area=memory({fanaticalProfileLabel:'Personal',fanaticalLibraryItems:[{source:'fanatical',sourceItemId:'local_123',title:'Saved book',mediaType:'invalid'}]}),store=createFanStore(area),target={accountRef:(await store.execute('handoffAccounts'))[0].accountRef},data=snapshot([row(9)]),before=JSON.stringify(area.values);
 await assert.rejects(store.execute('handoffPreview',[data,target]),/Invalid backup media type/);await assert.rejects(store.execute('handoffImport',[data,target]),/Invalid backup media type/);assert.equal(area.sets,0);assert.equal(JSON.stringify(area.values),before);
});
