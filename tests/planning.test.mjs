import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
import '../src/planning.js';
import {createSyncStore,createLibraryBackup,parseLibraryBackup,backupRestoreState} from '../src/library-data.mjs';
const F=globalThis.FanaticalLibrary,unit=n=>({series:'Saga',run:'2020',language:'en',unitType:'issue',number:String(n),completeness:'full'});
const product=(id,numbers=[],extra={})=>({sourceItemId:id,title:id,mediaType:'book',availability:{regionAvailable:true,soldOut:false,storeVisible:true},contents:numbers.map(unit),contentsComplete:true,...extra});
const match=state=>({state});
test('standard goals use cheapest cumulative coverage, deduplicate units and preserve weighted wishlist evidence',()=>{
  const a=product('product-a',[1,2]),b=product('product-b',[2,3]),owned=product('product-owned',[4]),parsed={kind:'standard',products:[a,b,owned],groups:[{price:{USD:100},products:[a,b]},{price:{USD:1000},products:[owned]}]},matches=[match('new'),match('new'),match('owned')];
  const wishes=[{title:a.title,mediaType:'book',sourceItemId:a.sourceItemId,weight:5}];let plan=F.planPurchase(parsed,matches,wishes);assert.equal(plan.recommended.price,100);assert.equal(plan.recommended.additionalUnits,3);assert.equal(plan.recommended.wishlistWeight,5);plan=F.planPurchase(parsed,matches,wishes,{goal:'wishlist'});assert.equal(plan.targetProducts,1);assert.equal(plan.recommended.price,100);assert.equal(plan.recommended.wishlistWeight,5);
});
test('possible, partial, unchecked and unavailable products stay out of default purchase goals',()=>{
  const products=['possible','partial','unchecked','owned','new','unavailable'].map(id=>product('product-'+id,[],id==='unavailable'?{availability:{regionAvailable:false}}:{})),parsed={kind:'pick-mix',products,tiers:[{quantity:2,price:{USD:100}}]},matches=['possible','partial','unchecked','owned','new','new'].map(match);
  let plan=F.planPurchase(parsed,matches);assert.equal(plan.targetProducts,1);assert.equal(plan.recommended,null);assert.equal(plan.excludedUncertain,3);assert.equal(plan.unavailable,1);plan=F.planPurchase(parsed,matches,[],{includeUncertain:true});assert.equal(plan.targetProducts,4);assert.equal(plan.recommended,null);assert.deepEqual(matches.map(row=>row.state),['possible','partial','unchecked','owned','new','new']);
});
test('Pick and Mix finds complete overlapping unit plans, fills exact quantities and respects sold-out products',()=>{
  const a=product('product-a',[1,2]),b=product('product-b',[2,3]),c=product('product-c',[1,2,3]),sold=product('product-sold',[9],{availability:{soldOut:true}}),parsed={kind:'pick-mix',products:[a,b,c,sold],tiers:[{quantity:1,price:{USD:100}},{quantity:2,price:{USD:200}},{quantity:4,price:{USD:300}}]},matches=[match('partial'),match('new'),match('new'),match('new')];
  const plan=F.planPurchase(parsed,matches,[],{goal:'units'});assert.equal(plan.targetUnits,3);assert.equal(plan.recommended.price,100);assert.equal(plan.recommended.selected[0].sourceItemId,c.sourceItemId);assert(plan.recommended.exact);assert.equal(plan.plans[1].selected.length,2);assert(!plan.plans.some(row=>row.selected.some(item=>item.sourceItemId===sold.sourceItemId)));assert(!plan.plans[2].complete);
});
test('failed contents lookups never become additional units, even with uncertainty explicitly included',()=>{
  const a=product('product-a',[1,2]),parsed={kind:'pick-mix',products:[a],tiers:[{quantity:1,price:{USD:100}}]},matches=[{state:'unchecked',lookupIncomplete:true}];const plan=F.planPurchase(parsed,matches,[],{goal:'units',includeUncertain:true});assert.equal(plan.targetUnits,0);assert.equal(plan.recommended,null);assert(plan.unitsUnconfirmed);
});
test('wishlist weights prioritize partial tier suggestions without pretending all wishes are fulfilled',()=>{
  const products=[product('product-a'),product('product-b'),product('product-c')],parsed={kind:'pick-mix',products,tiers:[{quantity:2,price:{USD:100}}]},wishes=products.map((item,n)=>({...item,weight:n+1})),plan=F.planPurchase(parsed,products.map(()=>match('new')),wishes,{goal:'wishlist'});assert.equal(plan.recommended,null);assert.equal(plan.plans[0].wishlistWeight,5);assert.deepEqual(plan.plans[0].selected.map(item=>item.sourceItemId),['product-c','product-b']);
});
test('bounded large-pool search labels feasible unit plans as unproven cheapest and invalid tiers are excluded',()=>{
  const products=Array.from({length:25},(_,n)=>product('product-'+n,[1])),parsed={kind:'pick-mix',products,tiers:[{quantity:1.5,price:{USD:1}},{quantity:1,price:{USD:null}},{quantity:1,price:{USD:100}}]},plan=F.planPurchase(parsed,products.map(()=>match('new')),[],{goal:'units'});assert.equal(plan.plans.length,1);assert.equal(plan.recommended.exact,false);assert.equal(plan.recommended.additionalUnits,1);
});
test('wishlist edits serialize, strip purchase secrets and round-trip through version 3 backup snapshots',async()=>{
  const state={},area={get:async defaults=>structuredClone({...defaults,...state}),set:async updates=>Object.assign(state,structuredClone(updates)),remove:async()=>{}},store=createSyncStore(area),wish=title=>({title,mediaType:'book',weight:2,token:'SECRET',purchaseOrigins:['SECRET']});
  await Promise.all(['First','Second'].map(title=>store.execute('wishlist',['add',[wish(title)]])));assert.equal(state.fanaticalWishlistItems.length,2);assert(!JSON.stringify(state).includes('SECRET'));await assert.rejects(store.execute('wishlist',['add',[{...wish('Bad'),weight:0}]]));const backup=await store.execute('backup');assert.equal(backup.schemaVersion,4);assert.equal(backup.wishlistItems.length,2);await store.execute('wishlist',['replace',[]]);await store.execute('restore',[backup]);assert.equal(state.fanaticalWishlistItems.length,2);const before=structuredClone(state);await assert.rejects(store.execute('restore',[{...backup,wishlistItems:[{title:'Bad'}]}]));assert.deepEqual(state,before);assert.equal(backupRestoreState(parseLibraryBackup(createLibraryBackup([],null)),createLibraryBackup([],null)).fanaticalWishlistItems.length,0);
});

test('conflicting duplicate availability cannot reintroduce a sold-out choice',()=>{
  const a=product('product-a'),unavailable={...a,availability:{soldOut:true}},parsed={kind:'pick-mix',products:[unavailable,a],tiers:[{quantity:1,price:{USD:100}}]},plan=F.planPurchase(parsed,[match('new'),match('new')]);assert.equal(plan.recommended,null);assert.equal(plan.unavailable,1);assert.equal(plan.plans[0].selected.length,0);
});
