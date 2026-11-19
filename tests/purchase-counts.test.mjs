import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {fixture} from './matching-fixture.mjs';
const VM=fixture([],'game',{title:'Unused'}).context.FanaticalLibrary,F={purchaseCount:items=>structuredClone(VM.purchaseCount(items)),purchaseCountText:value=>VM.purchaseCountText(value)};
const ref=c=>c.repeat(64);
const item=(origins,extra={})=>({source:'fanatical',sourceItemId:'synthetic-product',title:'Synthetic Game',mediaType:'game',bundle:{sourceItemId:'bundle-a',title:'Bundle A'},purchaseOrigins:origins,...extra});
const origin=(purchaseRef,bundle='bundle-a',quantity=1)=>({...(purchaseRef?{purchaseRef}:{}),bundle:{sourceItemId:bundle,title:bundle},purchaseDate:'2026-01-01',quantity});

test('separate orders, and copies listed in one order, count as separate purchases',()=>{
 assert.deepEqual(F.purchaseCount([item([origin(ref('a')),origin(ref('b'))])]),{count:2,exact:true},'two orders of the same bundle');
 assert.deepEqual(F.purchaseCount([item([origin(ref('a'),'bundle-a',2)])]),{count:2,exact:true},'a quantity of two in one order');
 assert.deepEqual(F.purchaseCount([item([origin(ref('a')),origin(ref('a'),'bundle-b')])]),{count:2,exact:true},'one order containing the product in two bundles');
});

test('the same order seen again is one purchase, including after it returns from Galactic Library',()=>{
 const local=item([origin(ref('a'))]),returned=item([origin(ref('a'))],{purchaseDate:'2026-01-01'});
 assert.deepEqual(F.purchaseCount([local,returned]),{count:1,exact:true});
 assert.deepEqual(F.purchaseCount([item([origin(ref('a')),origin(ref('a'))])]),{count:1,exact:true});
});

test('records without an order reference count once per bundle and become a lower bound only when they may be a referenced order',()=>{
 assert.deepEqual(F.purchaseCount([item([origin(null)])]),{count:1,exact:true});
 assert.deepEqual(F.purchaseCount([item([origin(ref('a'),'bundle-a'),origin(null,'bundle-b')])]),{count:2,exact:true},'different bundles are different purchases');
 const overlap=F.purchaseCount([item([origin(ref('a'),'bundle-a'),origin(null,'bundle-a')])]);
 assert.deepEqual(overlap,{count:1,max:2,exact:false});assert.equal(F.purchaseCountText(overlap),'at least 1 purchase');
 assert.equal(F.purchaseCountText({count:1200,exact:true}),'1,200 purchases');
});

test('other stores, promotional gifts and records without purchase evidence are never counted',()=>{
 assert.equal(F.purchaseCount([{source:'steam',sourceItemId:'x',title:'Synthetic Game',purchaseOrigins:[origin(ref('c'))]}]).count,0);
 assert.equal(F.purchaseCount([{source:'fanatical',sourceItemId:'p',title:'Manual'}]).count,0);
 assert.equal(F.purchaseCount([]).count,0);
});

const badge=async(records,offered,central=null)=>{const f=fixture(records,'game',offered,central),{match}=await f.classify();return {match,label:vm.runInContext('FanaticalLibrary.overlayLabel',f.context)(match)};};

test('bundle badges say Owned ×N for repeat purchases, from the same count as the Library',async()=>{
 const twice={sourceItemId:'synthetic-product',title:'Synthetic Game',bundle:{sourceItemId:'bundle-a',title:'Bundle A'},purchaseOrigins:[origin(ref('a')),origin(ref('b'))]};
 assert.equal((await badge([twice],{title:'Synthetic Game'})).label,'Owned ×2','title match');
 assert.equal((await badge([twice],{title:'Synthetic Game',sourceItemId:'synthetic-product'})).label,'Owned ×2','product ID match');
 const copies={...twice,purchaseOrigins:[origin(ref('a'),'bundle-a',3)]};
 assert.equal((await badge([copies],{title:'Synthetic Game'})).label,'Owned ×3');
 const once={...twice,purchaseOrigins:[origin(ref('a'))]};
 assert.equal((await badge([once],{title:'Synthetic Game'})).label,'Owned');
});

test('ownership on other stores never adds to the Fanatical count',async()=>{
 const once={sourceItemId:'synthetic-product',title:'Synthetic Game',bundle:{sourceItemId:'bundle-a',title:'Bundle A'},purchaseOrigins:[origin(ref('a'))]};
 const steam={matches:[{provider:'steam',title:'Synthetic Game',ownership:'owned',relationship:'same-edition'},{provider:'epic',title:'Synthetic Game',ownership:'owned',relationship:'same-edition'}]};
 assert.equal((await badge([once],{title:'Synthetic Game'},steam)).label,'Owned');
 const elsewhere=await badge([],{title:'Synthetic Game'},steam);assert.equal(elsewhere.match.state,'owned-elsewhere');assert.doesNotMatch(elsewhere.label,/×/u);
});
