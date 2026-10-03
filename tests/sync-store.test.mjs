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

test('only successful full same-profile scans archive missing products and preserve their first disappearance',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[options,1]);
  await f.store.execute('commit',[scan.token,update,1]);
  const history=structuredClone(f.state.fanaticalHistoricalItems);
  assert.equal(history.length,1);assert.equal(history[0].item.title,item.title);assert.equal(history[0].profileLabel,'personal');
  const repeat=await f.store.execute('begin',[options,1]);await f.store.execute('commit',[repeat.token,update,1]);
  assert.deepEqual(f.state.fanaticalHistoricalItems,history);
  const failed=await f.store.execute('begin',[options,1]);await f.store.execute('failure',[failed.token,null,1]);
  assert.deepEqual(f.state.fanaticalHistoricalItems,history);
  const quick=await f.store.execute('begin',[{...options,fullScan:false},1]);
  await f.store.execute('commit',[quick.token,{...update,fanaticalImportSummary:{scanMode:'quick'}},1]);
  assert.deepEqual(f.state.fanaticalHistoricalItems,history);
  const returning=await f.store.execute('begin',[{...options,fullScan:false},1]);
  await f.store.execute('commit',[returning.token,{...update,fanaticalLibraryItems:[item],fanaticalImportSummary:{scanMode:'quick'}},1]);
  assert.deepEqual(f.state.fanaticalHistoricalItems,[]);
});

test('quick scans and initial profile assignment never infer missing records',async()=>{
  const f=fixture(),quick=await f.store.execute('begin',[{...options,fullScan:false},1]);
  await f.store.execute('commit',[quick.token,{...update,fanaticalImportSummary:{scanMode:'quick'}},1]);
  assert.deepEqual(f.state.fanaticalHistoricalItems,[]);
  const legacy=fixture();legacy.state.fanaticalProfileLabel='';
  const first=await legacy.store.execute('begin',[options,1]);await legacy.store.execute('commit',[first.token,update,1]);
  assert.deepEqual(legacy.state.fanaticalHistoricalItems,[]);
});

test('history is profile isolated, safely recoverable, removed on clear and reset by older backups',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[options,1]);await f.store.execute('commit',[scan.token,update,1]);
  f.state.fanaticalHistoricalItems[0].item.key='SECRET';
  const backup=await f.store.execute('backup');assert.equal(backup.schemaVersion,4);assert.equal(JSON.stringify(backup).includes('SECRET'),false);
  const switchScan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);
  await f.store.execute('commit',[switchScan.token,update,1]);assert.deepEqual(f.state.fanaticalHistoricalItems,[]);
  assert.equal(f.state.fanaticalProfileArchives[0].historicalItems[0].item.title,item.title);
  await f.store.execute('restore',[backup]);assert.equal(f.state.fanaticalHistoricalItems.length,1);
  const before=structuredClone(f.state),invalid=structuredClone(backup);invalid.historicalItems[0].profileLabel='foreign';
  await assert.rejects(f.store.execute('restore',[invalid]),/profile/);assert.deepEqual(f.state,before);
  invalid.historicalItems[0].profileLabel='personal';invalid.historicalItems[0].missingSince='invalid';
  await assert.rejects(f.store.execute('restore',[invalid]),/date/);assert.deepEqual(f.state,before);
  await f.store.execute('restore',[{...backup,schemaVersion:3}]);assert.deepEqual(f.state.fanaticalHistoricalItems,[]);
  await f.store.execute('restore',[backup]);await f.store.execute('clear');assert.equal('fanaticalHistoricalItems' in f.state,false);
});

test('stale full scans and malformed commits cannot alter current or historical evidence',async()=>{
  const f=fixture(),old=await f.store.execute('begin',[options,1]),newer=await f.store.execute('begin',[options,1]);
  const before=structuredClone(f.state);
  await assert.rejects(f.store.execute('commit',[old.token,update,1]),/superseded/);assert.deepEqual(f.state,before);
  await assert.rejects(f.store.execute('commit',[newer.token,{...update,fanaticalLibraryItems:[{...item,title:''}]},1]),/invalid/);assert.deepEqual(f.state,before);
});

test('summary preferences merge through the writer, reject invalid patches atomically, and survive restore and clear outside backups',async()=>{
  const f=fixture();await f.store.execute('patch',[{fanaticalSummaryPreferences:{position:'top-left'}}]);await f.store.execute('patch',[{fanaticalSummaryPreferences:{minimized:true}}]);assert.deepEqual(f.state.fanaticalSummaryPreferences,{position:'top-left',minimized:true});const before=structuredClone(f.state);
  for(const value of [{position:'offscreen'},{minimized:'true'},{extra:'private'},null,[]]){await assert.rejects(f.store.execute('patch',[{fanaticalShowDiagnostics:true,fanaticalSummaryPreferences:value}]),/preferences/);assert.deepEqual(f.state,before);}
  assert.equal(JSON.stringify(await f.store.execute('backup')).includes('fanaticalSummaryPreferences'),false);await f.store.execute('restore',[{schemaVersion:1,items:[item]}]);assert.deepEqual(f.state.fanaticalSummaryPreferences,before.fanaticalSummaryPreferences);await f.store.execute('clear');assert.deepEqual(f.state.fanaticalSummaryPreferences,before.fanaticalSummaryPreferences);
});
