// Purchase sync uses the store revision to tell whether another saved change landed while Fanatical Library
// applied Galactic Library's records. Reads must not move it; every write must, and an import reports its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSyncStore} from '../src/library-data.mjs';
const item=n=>({source:'fanatical',sourceItemId:'product_'+String(n).padStart(6,'0'),title:'Synthetic '+n,mediaType:'book',bundle:{sourceItemId:'bundle_000001',title:'Synthetic bundle'}});
test('reads leave the store revision unchanged; writes and imports advance it and an import brackets its own write',async()=>{
 const saved={fanaticalProfileLabel:'Main',fanaticalLibraryItems:Array.from({length:3000},(_,n)=>item(n)),fanaticalProfileArchives:[]};
 const store=createSyncStore({get:async d=>structuredClone({...d,...saved}),set:async p=>Object.assign(saved,structuredClone(p)),remove:async k=>[k].flat().forEach(x=>delete saved[x])});
 let [account]=await store.execute('syncAccounts');const settled=store.revision();
 for(let n=0;n<3;n++){[account]=await store.execute('syncAccounts');await store.execute('handoffSnapshot',[account.accountRef]);}
 assert.equal(store.revision(),settled,'account and snapshot reads do not count as changes');
 const snapshot=await store.execute('handoffSnapshot',[account.accountRef]),incoming={...snapshot,records:[{...snapshot.records[0],providerItemId:'product_999999',title:'Synthetic 999999'}]};
 const result=await store.execute('handoffImport',[incoming,{accountRef:account.accountRef}]);
 assert.equal(result.added,1);assert.equal(result.revisionBefore,settled);assert(result.revision>result.revisionBefore);assert.equal(store.revision(),result.revision);
});
