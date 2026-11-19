import test from 'node:test';import assert from 'node:assert/strict';import {createSyncStore} from '../src/library-data.mjs';
const Y=GalacticPurchaseSync;
function fixture(){const saved={fanaticalProfileLabel:'Personal',fanaticalLibraryItems:[],fanaticalProfileArchives:[]},area={get:async defaults=>structuredClone({...defaults,...saved}),set:async patch=>Object.assign(saved,structuredClone(patch)),remove:async keys=>keys.forEach(k=>delete saved[k])};return {saved,area,store:createSyncStore(area)};}
test('automatic account IDs survive purchase revisions and nickname rename',async()=>{const f=fixture(),first=(await f.store.execute('syncAccounts'))[0];f.saved.fanaticalLibraryItems.push({title:'Synthetic',mediaType:'book',source:'fanatical',sourceItemId:'product_123',bundle:{sourceItemId:'bundle_123',title:'Synthetic bundle'}});const changed=(await f.store.execute('syncAccounts'))[0];assert.equal(changed.stableId,first.stableId);assert.notEqual(changed.accountRef,first.accountRef);await f.store.execute('renameProfile',[{profileLabel:'Personal',newLabel:'Renamed',expectedActiveLabel:'Personal',confirmed:true}]);assert.equal((await f.store.execute('syncAccounts'))[0].stableId,first.stableId);});
test('clear invalidates mapping and local IDs without deleting peer purchases',async()=>{const f=fixture(),first=(await f.store.execute('syncAccounts'))[0];f.saved[Y.KEY]={fanatical:{confirmed:true}};await f.store.execute('clear');assert.equal(f.saved[Y.KEY],undefined);assert.notEqual((await f.store.execute('syncAccounts'))[0].stableId,first.stableId);});
test('queued imports enforce current standing consent independently of unchanged account references',async()=>{const f=fixture(),a=(await f.store.execute('syncAccounts'))[0],data=await f.store.execute('handoffSnapshot',[a.accountRef]);await assert.rejects(f.store.execute('handoffImport',[data,{accountRef:a.accountRef,autoSync:{id:'old',peerId:'gl',localId:a.stableId}}]),/consent/);assert.deepEqual(f.saved.fanaticalLibraryItems,[]);});

test('automatic native category conflicts keep the old record and import the safe subset',()=>{const old={title:'Synthetic',source:'fanatical',mediaType:'book',sourceItemId:'product_1',bundle:{sourceItemId:'bundle_1',title:'Synthetic'}},row={providerItemId:'product_1',title:'Synthetic',mediaType:'game',metadata:{},purchasedAt:null,origins:[]},result=GalacticPurchaseAdapters.fanMerge([old],[row,{...row,providerItemId:'product_2',title:'New',mediaType:'book'}],true);assert.equal(result.stats.skipped,1);assert.equal(result.stats.added,1);assert.deepEqual(result.items[0],old);});

test('saved Fanatical media types outside the sharing vocabulary map like Humble kinds, and one malformed record cannot block account discovery',async()=>{
 const f=fixture(),item=(n,mediaType,extra={})=>({title:'Synthetic '+n,mediaType,source:'fanatical',sourceItemId:'product_'+n+'_id',bundle:{sourceItemId:'bundle_123',title:'Synthetic bundle'},purchaseOrigins:[{purchaseRef:'a'.repeat(64),bundle:{sourceItemId:'bundle_123',title:'Synthetic bundle'},purchaseDate:'2026-11-01',quantity:1}],...extra});
 f.saved.fanaticalLibraryItems=[item(1,'book'),item(2,'comic',{manualMediaType:'comic',automaticMediaType:'book'}),item(3,'unclassified'),item(4,'video'),item(5,'game',{title:'Synthetic\u0008control'})];
 const [account]=await f.store.execute('syncAccounts'),before=structuredClone(f.saved);assert.equal(account.count,5);
 const data=await f.store.execute('handoffSnapshot',[account.accountRef]);
 assert.deepEqual(Object.fromEntries(data.records.map(r=>[r.providerItemId,r.mediaType])),{product_1_id:'book',product_2_id:'book',product_3_id:'other',product_4_id:'other'});
 assert(data.limitations.some(text=>/^1 saved record/.test(text)),JSON.stringify(data.limitations));
 assert(!JSON.stringify(data).includes('control'));
 assert.deepEqual(f.saved,before,'saved purchases and their media types are unchanged');
});

test('an unsafe optional store link is left out of a shared Fanatical record without withholding the purchase',async()=>{
 const f=fixture(),item=(n,extra={})=>({title:'Synthetic '+n,mediaType:'game',source:'fanatical',sourceItemId:'product_'+n+'_id',bundle:{sourceItemId:'bundle_123',title:'Synthetic bundle'},...extra});
 f.saved.fanaticalLibraryItems=[item(1,{detailUrl:'https://example.invalid/game'}),item(2,{detailUrl:'https://www.fanatical.com/en/game/synthetic'})];
 const [account]=await f.store.execute('syncAccounts'),before=structuredClone(f.saved.fanaticalLibraryItems),data=await f.store.execute('handoffSnapshot',[account.accountRef]);
 assert.deepEqual(data.records.map(r=>[r.providerItemId,r.metadata.detailUrl??null]),[['product_1_id',null],['product_2_id','https://www.fanatical.com/en/game/synthetic']]);
 assert(data.limitations.includes('1 saved store link was not a Humble or Fanatical address and was left out; the purchase is still shared.'));
 assert(!data.limitations.some(l=>/cannot be shared/.test(l)));assert.deepEqual(f.saved.fanaticalLibraryItems,before);
});
