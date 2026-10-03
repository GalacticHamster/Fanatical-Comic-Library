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


const choose=(label,expectedActiveLabel)=>({profileLabel:label,expectedActiveLabel,confirmed:true});
test('saved account activation restores only its items and private incremental scan state across worker restarts',async()=>{
  const f=fixture();f.state.fanaticalImportSummary={scanMode:'full',importedAt:'2026-10-02T10:00:00Z'};f.state.fanaticalLastScanAttempt={status:'incomplete'};f.state.fanaticalWishlistItems=[{title:'Wish',mediaType:'book',weight:2}];f.state.galacticLibraryExtensionId='a'.repeat(32);
  const personal=structuredClone(f.state);personal.fanaticalLibraryItems=parseLibraryBackup({schemaVersion:1,items:personal.fanaticalLibraryItems});const scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);
  await f.store.execute('commit',[scan.token,{...update,fanaticalLibraryItems:[{...item,title:'Work comic',sourceItemId:'work-product'}],fanaticalScannedOrderFingerprints:['b'.repeat(64)],fanaticalLastScanAttempt:null},1]);
  const old=await f.store.execute('begin',[{profileLabel:'work',confirmed:true},1]);await f.store.execute('selectProfile',[choose('personal','work')]);
  for(const key of ['fanaticalLibraryItems','fanaticalScannedOrderFingerprints','fanaticalImportSummary','fanaticalLastScanAttempt'])assert.deepEqual(f.state[key],personal[key]);
  assert.equal(f.state.fanaticalWishlistItems[0].title,'Wish');assert.equal(f.state.galacticLibraryExtensionId,'a'.repeat(32));await assert.rejects(f.store.execute('commit',[old.token,update,1]),/superseded/);assert.equal(await f.store.execute('failure',[old.token,null,1]),false);
  f.store=createSyncStore(f.area);const quick=await f.store.execute('begin',[{profileLabel:'personal',confirmed:true},1]);assert.equal(quick.forceFull,false);assert.deepEqual(quick.state.fanaticalScannedOrderFingerprints,['a'.repeat(64)]);
  await f.store.execute('selectProfile',[choose('work','personal')]);assert.deepEqual(f.state.fanaticalScannedOrderFingerprints,['b'.repeat(64)]);assert.equal(f.state.fanaticalLibraryItems[0].title,'Work comic');
  for(let n=0;n<3;n++){await f.store.execute('selectProfile',[choose('personal','work')]);await f.store.execute('selectProfile',[choose('work','personal')]);}assert.equal(f.state.fanaticalProfileArchives.length,1);
});
test('saved account selection validates confirmation, stale UI and scan history atomically',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);await f.store.execute('commit',[scan.token,update,1]);const before=structuredClone(f.state);
  for(const args of [{...choose('personal','work'),confirmed:false},choose('personal','stale'),choose('missing','work')]){await assert.rejects(f.store.execute('selectProfile',[args]));assert.deepEqual(f.state,before);}
  await assert.rejects(f.store.execute('begin',[{...options,profileLabel:'personal',switchProfile:true},1]),/Use saved account/);assert.deepEqual(f.state,before);
  f.state.fanaticalProfileLabel='';f.state.fanaticalLibraryItems=[item];const unnamed=structuredClone(f.state);await assert.rejects(f.store.execute('selectProfile',[choose('personal','')]),/nickname/);assert.deepEqual(f.state,unnamed);f.state.fanaticalProfileLabel='work';
  f.state.fanaticalProfileArchives[0].localScanState.fingerprints=['bad'];const invalid=structuredClone(f.state);await assert.rejects(f.store.execute('selectProfile',[choose('personal','work')]),/scan history/);assert.deepEqual(f.state,invalid);
});
test('renames preserve scan authority, scope historical evidence correctly and reject collisions',async()=>{
  const f=fixture(),initial=await f.store.execute('begin',[options,1]);await f.store.execute('commit',[initial.token,update,1]);const historical=structuredClone(f.state.fanaticalHistoricalItems);
  const switchScan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);await f.store.execute('commit',[switchScan.token,{...update,fanaticalScannedOrderFingerprints:['b'.repeat(64)]},1]);
  const pending=await f.store.execute('begin',[{profileLabel:'work',confirmed:true},1]),before=structuredClone(f.state);
  for(const next of ['personal','', 'x'.repeat(101)]){await assert.rejects(f.store.execute('renameProfile',[{...choose('work','work'),newLabel:next}]));assert.deepEqual(f.state,before);}
  await f.store.execute('renameProfile',[{...choose('work','work'),newLabel:'business'}]);assert.deepEqual(f.state.fanaticalScannedOrderFingerprints,before.fanaticalScannedOrderFingerprints);await assert.rejects(f.store.execute('commit',[pending.token,update,1]),/superseded/);
  await f.store.execute('renameProfile',[{...choose('personal','business'),newLabel:'home'}]);await f.store.execute('selectProfile',[choose('home','business')]);assert.deepEqual(f.state.fanaticalHistoricalItems,historical.map(entry=>({...entry,profileLabel:'home'})));assert.equal((await f.store.execute('begin',[{profileLabel:'home',confirmed:true},1])).forceFull,false);
});
test('backups and older archives never restore private scan fingerprints as skip authority',async()=>{
  const f=fixture(),scan=await f.store.execute('begin',[{...options,profileLabel:'work',switchProfile:true},1]);await f.store.execute('commit',[scan.token,update,1]);
  const backup=await f.store.execute('backup');assert.equal(JSON.stringify(backup).includes('localScanState'),false);assert.equal(JSON.stringify(backup).includes('a'.repeat(64)),false);
  backup.profileArchives[0].localScanState={fingerprints:['c'.repeat(64)],summary:{scanMode:'full'}};await f.store.execute('restore',[backup]);await f.store.execute('selectProfile',[choose('personal','work')]);assert.deepEqual(f.state.fanaticalScannedOrderFingerprints,[]);assert.equal(f.state.fanaticalLibraryItems[0].title,'Personal comic');
  const quick=await f.store.execute('begin',[{profileLabel:'personal',confirmed:true},1]);assert.equal(quick.forceFull,false);assert.deepEqual(quick.state.fanaticalScannedOrderFingerprints,[]);
});
