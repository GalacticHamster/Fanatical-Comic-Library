// Executed only in a disposable extension page, with real browser storage APIs.
async function installedQuotaChecks(limited) {
  const {createSyncStore}=await import('./library-data.mjs');
  const area=chrome.storage.local,store=createSyncStore(area),checks=[];
  const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
  const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
  const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
  await area.set(quotaBaseline());
  const permission=await chrome.permissions.contains({permissions:['unlimitedStorage']});
  check(permission===!limited,'installed permission matches the quota test target');
  const before=await area.get(quotaProtectedFields),items=Array.from({length:26000},(_,i)=>quotaProduct(i));
  check(new Blob([JSON.stringify(items)]).size>20*1024*1024,'catalog records alone exceed 20 MiB using validated metadata fields');
  const scan=await store.execute('begin',[{profileLabel:'fixture',confirmed:true,fullScan:true},1]);
  const updates={fanaticalLibraryItems:items,fanaticalImportSummary:{scanMode:'full',ownedLeafProducts:items.length},
    fanaticalScannedOrderFingerprints:Array.from({length:1040},(_,i)=>(i+1).toString(16).padStart(64,'0'))};
  if(limited){
    let error='';try{await store.execute('commit',[scan.token,updates,1]);}catch(caught){error=caught.message;}
    check(/quota/i.test(error),'Chrome without unlimitedStorage rejects the actual large storage.local write');
    await store.execute('failure',[scan.token,null,1]);
    const after=await area.get(quotaProtectedFields);
    check(quotaProtectedFields.every(key=>same(before[key],after[key])),'rejected write preserves purchases, fingerprints, summary, accounts, history and corrections');
    check((await area.get('fanaticalSyncControl')).fanaticalSyncControl===null,'failure handling releases the scan lease');
    check((await area.get('fanaticalLastScanAttempt')).fanaticalLastScanAttempt.status==='incomplete','failure is recorded separately from successful scan history');
    return {checks};
  }
  await store.execute('commit',[scan.token,updates,1]);
  const bytes=await area.getBytesInUse();
  check(bytes>20*1024*1024,`real storage.local holds ${bytes} bytes after the full commit`);
  const quick=await store.execute('begin',[{profileLabel:'fixture',confirmed:true,fullScan:false},1]);
  await store.execute('commit',[quick.token,{...updates,fanaticalLibraryItems:[...quick.state.fanaticalLibraryItems,quotaProduct(26000)],
    fanaticalImportSummary:{scanMode:'quick',ownedLeafProducts:26001},fanaticalScannedOrderFingerprints:[...updates.fanaticalScannedOrderFingerprints,'f'.repeat(64)]},1]);
  const saved=await area.get(quotaProtectedFields);
  check(saved.fanaticalLibraryItems.length===26001&&saved.fanaticalScannedOrderFingerprints.length===1041,'incremental update succeeds above 20 MiB and retains prior fingerprints');
  check(saved.fanaticalLibraryItems.find(p=>p.sourceItemId==='quota-product-0').manualMediaType==='comic'&&saved.mediaTypeOverrides['quota-product-0']==='comic','manual media correction survives both large commits');
  check(same(saved.fanaticalHistoricalItems,before.fanaticalHistoricalItems),'historical purchase evidence is retained');
  check(same(saved.fanaticalProfileArchives,before.fanaticalProfileArchives)&&saved.fanaticalProfileLabel==='fixture','other account data remains separate and unchanged');
  check(!saved.fanaticalLibraryItems.some(p=>p.sourceItemId==='quota-previous-product'),'inactive-account records never enter the active catalog');
  return {checks};
}
