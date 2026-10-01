import assert from 'node:assert/strict';
import test from 'node:test';
import {createSyncStore,createLibraryBackup,backupRestoreState,parseLibraryBackup} from '../src/library-data.mjs';

const item={source:'fanatical',sourceItemId:'product-123456',title:'Personal comic',mediaType:'book',bundle:{sourceItemId:'bundle-123456',title:'Personal bundle'}};
function fixture(){
  const state={fanaticalLibraryItems:[item],fanaticalProfileLabel:'personal',fanaticalProfileArchives:[],fanaticalScannedOrderFingerprints:['a'.repeat(64)]};
  const area={get:async defaults=>structuredClone({...defaults,...Object.fromEntries(Object.keys(defaults).filter(key=>key in state).map(key=>[key,state[key]]))}),set:async updates=>Object.assign(state,structuredClone(updates)),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete state[key];}};
  return {state,area,store:createSyncStore(area)};
}
const options={profileLabel:'personal',confirmed:true,fullScan:true};
const update={fanaticalLibraryItems:[],fanaticalImportSummary:{scanMode:'full'},fanaticalScannedOrderFingerprints:[]};
test('scan ordering survives worker restart and rejects commits or failure flags after restore/clear',async()=>{
  const f=fixture();const begin=()=>f.store.execute('begin',[options,1]);const commit=scan=>f.store.execute('commit',[scan.token,update,1]);
  const old=await begin();const latest=await begin();await assert.rejects(commit(old),/superseded/);
  f.store=createSyncStore(f.area);await commit(latest);
  const restoreScan=await begin();await f.store.execute('restore',[{schemaVersion:1,items:[item]}]);await assert.rejects(commit(restoreScan),/superseded/);
  assert.equal(await f.store.execute('failure',[restoreScan.token,null,1]),false);assert.equal(f.state.fanaticalLastScanAttempt,null);
  const clearScan=await begin();await f.store.execute('clear');await assert.rejects(commit(clearScan),/superseded/);
  assert.equal(await f.store.execute('failure',[clearScan.token,null,1]),false);assert.equal('fanaticalLastScanAttempt' in f.state,false);
});
test('switches isolate fingerprints and items, preserve previous profiles, and round-trip their safe backup evidence',async()=>{
  const f=fixture();await assert.rejects(f.store.execute('begin',[{...options,profileLabel:'work'},1]),/explicitly/);
  await assert.rejects(f.store.execute('begin',[{...options,profileLabel:'work',fullScan:false,switchProfile:true},1]),/explicitly/);
  const scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);
  assert.deepEqual(scan.state.fanaticalLibraryItems,[]);assert.deepEqual(scan.state.fanaticalScannedOrderFingerprints,[]);
  await assert.rejects(f.store.execute('commit',[scan.token,{...update,fanaticalImportSummary:{scanMode:'quick'}},1]),/full scan/);
  assert.equal(f.state.fanaticalProfileLabel,'personal');
  await f.store.execute('patch',[{fanaticalShowDiagnostics:true}]);await f.store.execute('commit',[scan.token,update,1]);
  assert.equal(f.state.fanaticalShowDiagnostics,true);assert.equal(f.state.fanaticalProfileLabel,'work');
  const backup=createLibraryBackup([],null,undefined,'work',f.state.fanaticalProfileArchives);
  const restored=backupRestoreState(parseLibraryBackup(backup),backup);
  assert.equal(restored.fanaticalProfileArchives[0].profileLabel,'personal');assert.equal(restored.fanaticalProfileArchives[0].items[0].title,'Personal comic');
});
