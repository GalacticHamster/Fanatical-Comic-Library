// Shared by the purchase importer and backup UI. Never persist raw input.
import './shared.js';
import './planning.js';
const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const safeId = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
const safeDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeList = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => safeText(entry, 40)).filter(Boolean))].sort().slice(0, 30);
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

function purchaseOrigins(value,strict=false){
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>100000)throw new Error('Invalid purchase origins.');
  return value.map(origin=>{
    if(!origin||typeof origin!=='object'||origin.purchaseRef!==undefined&&origin.purchaseRef!==null&&!/^[a-f0-9]{64}$/iu.test(origin.purchaseRef)||!Number.isSafeInteger(origin.quantity??1)||(origin.quantity??1)<1||(origin.quantity??1)>100000)throw new Error('Invalid purchase origin.');
    if(strict&&(origin.bundle?.sourceItemId&&!safeId(origin.bundle.sourceItemId)||origin.purchaseDate!=null&&!safeDate(origin.purchaseDate)))throw new Error('Invalid purchase provenance.');
    return {...(origin.purchaseRef?{purchaseRef:origin.purchaseRef.toLowerCase()}:{}),bundle:{sourceItemId:safeId(origin.bundle?.sourceItemId),title:safeText(origin.bundle?.title),...(safeText(origin.bundle?.slug,300)?{slug:safeText(origin.bundle.slug,300)}:{})},purchaseDate:safeDate(origin.purchaseDate),quantity:origin.quantity??1};
  });
}
function mergeProduct(previous,incoming){
  if(!previous)return incoming;
  const origins=new Map();
  for(const item of [previous,incoming])for(const origin of item.purchaseOrigins??[{bundle:item.bundle,purchaseDate:item.purchaseDate,quantity:1}]){
    const key=origin.purchaseRef?JSON.stringify([origin.purchaseRef,origin.bundle.sourceItemId]):JSON.stringify(['legacy',origin.bundle.sourceItemId,origin.bundle.title,origin.purchaseDate]);origins.set(key,origin);
  }
  const latest=Date.parse(previous.purchaseDate)>Date.parse(incoming.purchaseDate)?previous:incoming;
  return {...latest,purchaseOrigins:[...origins.values()]};
}
export function mergeLibraryItems(items){return sanitizeImportResult({items}).items;}

/** Defense in depth: re-allowlist the main-world importer result or backup. */
export function sanitizeImportResult(value) {
  const input = value && typeof value === 'object' ? value : {};
  const deduplicated = new Map();
  for (const candidate of Array.isArray(input.items) ? input.items : []) {
    const sourceItemId = safeId(candidate?.sourceItemId);
    const title = safeText(candidate?.title);
    if (!sourceItemId || !title) continue;
    const externalIds = {};
    if (/^\d{1,16}$/u.test(String(candidate?.externalIds?.steamAppId ?? ''))) externalIds.steamAppId = String(candidate.externalIds.steamAppId);
    if (/^[0-9X]{10,17}$/iu.test(String(candidate?.externalIds?.isbn ?? ''))) externalIds.isbn = String(candidate.externalIds.isbn).toUpperCase();
    const projected = {
      source: 'fanatical', sourceItemId, title,
      ...(safeText(candidate?.slug, 300) ? { slug: safeText(candidate.slug, 300) } : {}),
      mediaType: ['game', 'book', 'audiobook', 'software', 'audio', 'elearning', 'other'].includes(candidate?.mediaType) ? candidate.mediaType : 'other',
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...globalThis.FanaticalLibrary.bibliographicFields(candidate),
      ...globalThis.FanaticalLibrary.contentsMetadata(candidate),
      ...(safeList(candidate?.drm).length ? { drm: safeList(candidate.drm) } : {}),
      ...(safeList(candidate?.platforms).length ? { platforms: safeList(candidate.platforms) } : {}),
      ...(safeList(candidate?.formats).length ? { formats: safeList(candidate.formats) } : {}),
      bundle: { sourceItemId: safeId(candidate?.bundle?.sourceItemId), title: safeText(candidate?.bundle?.title), ...(safeText(candidate?.bundle?.slug, 300) ? { slug: safeText(candidate.bundle.slug, 300) } : {}) },
      purchaseDate: safeDate(candidate?.purchaseDate),
      ...(candidate.purchaseOrigins!==undefined?{purchaseOrigins:purchaseOrigins(candidate.purchaseOrigins)}:{})
    };
    deduplicated.set(sourceItemId,mergeProduct(deduplicated.get(sourceItemId),projected));
  }
  return {
    schemaVersion: 1,
    ordersScanned: count(input.ordersScanned),
    ordersAvailable: count(input.ordersAvailable),
    orderFingerprints: [...new Set((Array.isArray(input.orderFingerprints) ? input.orderFingerprints : [])
      .filter((fingerprint) => /^[a-f0-9]{64}$/iu.test(String(fingerprint))).map((fingerprint) => String(fingerprint).toLowerCase()))].sort(),
    items: [...deduplicated.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId))
  };
}

export function parseLibraryBackup(value) {
  if (!value || value.format!==undefined&&value.format!=='fanatical-library-backup' || ![1,2,3,4].includes(value.schemaVersion) || !Array.isArray(value.items) || value.items.length>500000) throw new Error('Expected a supported Fanatical Library backup with an items array.');
  if(value.schemaVersion>=2&&(typeof value.profileLabel!=='string'||value.profileLabel.length>100||!Array.isArray(value.profileArchives)||value.profileArchives.length>100))throw new Error('Invalid account/profile backup.');
  if (value.items.some((item) => item?.source !== 'fanatical' || !safeId(item?.sourceItemId) || !safeText(item?.title))) {
    throw new Error('The backup contains an invalid Fanatical ownership record. Nothing was imported.');
  }
  if(value.schemaVersion>=3){if(value.format!=='fanatical-library-backup'||!Array.isArray(value.wishlistItems))throw Error('Invalid recoverable backup.');globalThis.FanaticalLibrary.normalizeWishlist(value.wishlistItems);}
  if(value.schemaVersion>=4)parseHistoricalItems(value.historicalItems,value.profileLabel);
  for(const item of value.items){if(item.mediaType!==undefined&&!['game','book','audiobook','software','audio','elearning','other'].includes(item.mediaType))throw new Error('Invalid backup media type.');purchaseOrigins(item.purchaseOrigins,true);}
  return sanitizeImportResult(value).items;
}

/** Do not let tolerant sanitization turn a broken scan into an empty rebuild. */
export function validateScanResult(value, { fullScan = false, knownOrderFingerprints = [] } = {}) {
  const fail = () => { throw new Error('Fanatical scan was unreadable or incomplete. Your library and scan history were not changed.'); };
  const integer = (number) => Number.isSafeInteger(number) && number >= 0;
  if (!value || value.schemaVersion !== 1 || value.coverage?.complete !== true || !integer(value.ordersScanned) || !integer(value.ordersAvailable)
    || !integer(value.coverage.listedOrders) || value.coverage.listedOrders < value.ordersAvailable || value.coverage.validatedOrders !== value.ordersScanned
    || value.coverage.emptyAccount !== (value.coverage.listedOrders === 0) || !Array.isArray(value.items) || !Array.isArray(value.orderFingerprints)) fail();
  const fingerprints = value.orderFingerprints;
  if (fingerprints.length !== value.ordersAvailable || fingerprints.some((fingerprint) => typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(fingerprint)) || new Set(fingerprints).size !== fingerprints.length) fail();
  const known = new Set(knownOrderFingerprints);
  const expected = fullScan ? value.ordersAvailable : fingerprints.filter((fingerprint) => !known.has(fingerprint)).length;
  if (value.ordersScanned !== expected || (expected > 0 && !value.items.length) || (expected === 0 && value.items.length)) fail();
  if (value.items.some((item) => item?.source !== 'fanatical' || typeof item.sourceItemId !== 'string' || !safeId(item.sourceItemId) || !safeText(item.title) || !safeId(item.bundle?.sourceItemId) || !safeText(item.bundle?.title))) fail();
  const projected = sanitizeImportResult(value);
  if (projected.items.length !== value.items.length) fail();
  const coverage = value.coverage;
  if (!integer(coverage.pagesFetched) || coverage.pagesFetched < 1 || coverage.pagesFetched > 1000 || coverage.listedOrders > 100000
    || !integer(coverage.retries) || coverage.concurrency !== 3 || !['array-only', 'link', 'count', 'range'].includes(coverage.paginationEvidence)
    || (coverage.expectedTotal !== null && (!integer(coverage.expectedTotal) || coverage.expectedTotal !== coverage.listedOrders))
    || (['count', 'range'].includes(coverage.paginationEvidence) !== (coverage.expectedTotal !== null))
    || (coverage.paginationEvidence === 'array-only' && coverage.pagesFetched !== 1)
    || (coverage.paginationEvidence === 'link' && coverage.pagesFetched < 2)) fail();
  return { ...projected, coverage: { complete: true, listedOrders: coverage.listedOrders, validatedOrders: coverage.validatedOrders, emptyAccount: coverage.emptyAccount,
    pagesFetched: coverage.pagesFetched, expectedTotal: coverage.expectedTotal, paginationEvidence: coverage.paginationEvidence, retries: coverage.retries, concurrency: 3 } };
}

export function parseHistoricalItems(value, profileLabel) {
  if (!Array.isArray(value) || value.length > 500000) throw new Error('Invalid historical purchase evidence.');
  const seen = new Set();
  return value.map(entry => {
    if (!entry || typeof entry !== 'object' || !profileLabel || entry.profileLabel !== profileLabel || !safeDate(entry.missingSince)) throw new Error('Historical purchase evidence belongs to a different profile or has an invalid date.');
    const item = parseLibraryBackup({ schemaVersion: 1, items: [entry.item] })[0];
    if (seen.has(item.sourceItemId)) throw new Error('Duplicate historical purchase record.');
    seen.add(item.sourceItemId);
    return { profileLabel, missingSince: safeDate(entry.missingSince), item };
  });
}

export function createLibraryBackup(items, summary, exportedAt = new Date().toISOString(), profileLabel='', profileArchives=[],wishlistItems=[],historicalItems=[]) {
  // Scan metadata is informational only: restore never trusts its skip history.
  const safeSummary = summary && ['full', 'quick'].includes(summary.scanMode) ? {
    importedAt: safeDate(summary.importedAt), scanMode: summary.scanMode,
    ordersScanned: count(summary.ordersScanned), ordersAvailable: count(summary.ordersAvailable), ordersSkipped: count(summary.ordersSkipped),
    addedProducts: count(summary.addedProducts), ownedLeafProducts: count(summary.ownedLeafProducts),
    historyCoverage: safeText(summary.historyCoverage)
  } : null;
  const scoped={format:'fanatical-library-backup',schemaVersion:4,wishlistItems:globalThis.FanaticalLibrary.normalizeWishlist(wishlistItems),items:sanitizeImportResult({items}).items,profileLabel,profileArchives,historicalItems:parseHistoricalItems(historicalItems,profileLabel)};
  parseLibraryBackup(scoped);
  const safeArchives=backupRestoreState(scoped.items,scoped).fanaticalProfileArchives;
  return { format:'fanatical-library-backup', ...scoped, exportedAt: safeDate(exportedAt), summary: safeSummary, profileArchives:safeArchives };
}

export function backupRestoreState(items, backup={}) {
  const profileArchives=(backup.schemaVersion>=2?backup.profileArchives:[]).map(entry=>{
    if(!entry||typeof entry.profileLabel!=='string'||!entry.profileLabel||entry.profileLabel.length>100)throw new Error('Invalid archived profile.');
    return {profileLabel:entry.profileLabel,items:parseLibraryBackup({schemaVersion:1,items:entry.items}),archivedAt:safeDate(entry.archivedAt),
      historicalItems:parseHistoricalItems(entry.historicalItems??[],entry.profileLabel)};
  });
  return { fanaticalLibraryItems: items, fanaticalImportSummary: null, fanaticalScannedOrderFingerprints: [], fanaticalLastScanAttempt: null, fanaticalProfileLabel:backup.schemaVersion>=2?backup.profileLabel:'', fanaticalProfileArchives:profileArchives,
    fanaticalHistoricalItems:backup.schemaVersion>=4?parseHistoricalItems(backup.historicalItems,backup.profileLabel):[],
    ...(backup.schemaVersion>=3?{fanaticalWishlistItems:globalThis.FanaticalLibrary.normalizeWishlist(backup.wishlistItems)}:{}) };
}

export function createSyncStore(area){
  let tail=Promise.resolve();const key='fanaticalSyncControl';
  const defaults={fanaticalLibraryItems:[],fanaticalScannedOrderFingerprints:[],fanaticalProfileLabel:'',fanaticalProfileArchives:[],fanaticalHistoricalItems:[]};
  async function operate(operation,args){
    if(operation==='begin'){
      const [options,tabId]=args;const label=String(options.profileLabel??'').trim();
      if(!options.confirmed||!label||label.length>100)throw new Error('Enter a profile label and confirm the signed-in Fanatical account.');
      const state=await area.get(defaults);const changing=Boolean(state.fanaticalProfileLabel)&&state.fanaticalProfileLabel!==label;
      if(changing&&(!options.fullScan||!options.switchProfile))throw new Error('Choose Full rescan and explicitly switch profiles.');
      const forceFull=changing||!state.fanaticalProfileLabel;const token=globalThis.crypto.randomUUID();
      await area.set({[key]:{token,tabId,label,changing,fullScan:options.fullScan||forceFull}});
      return {token,forceFull,state:changing?{...defaults}:state};
    }
    if(operation==='commit'||operation==='failure'){
      const [token,updates,tabId]=args;const control=(await area.get({[key]:null}))[key];
      if(!control||control.token!==token||control.tabId!==tabId){if(operation==='failure')return false;throw new Error('Scan superseded by another scan, restore, or clear. Start a fresh scan.');}
      if(operation==='failure'){await area.set({fanaticalLastScanAttempt:{status:'incomplete',scanMode:control.fullScan?'full':'quick',attemptedAt:new Date().toISOString()},[key]:null});return true;}
      if(control.fullScan&&updates.fanaticalImportSummary?.scanMode!=='full')throw new Error('This profile requires a full scan.');
      const state=await area.get(defaults);const archives=[...state.fanaticalProfileArchives];
      const incoming=parseLibraryBackup({schemaVersion:1,items:updates.fanaticalLibraryItems});
      const now=new Date().toISOString(),sameProfile=state.fanaticalProfileLabel===control.label;
      const history=new Map((sameProfile?parseHistoricalItems(state.fanaticalHistoricalItems,control.label):[]).map(entry=>[entry.item.sourceItemId,entry]));
      if(control.changing){archives.push({profileLabel:state.fanaticalProfileLabel,items:parseLibraryBackup({schemaVersion:1,items:state.fanaticalLibraryItems}),historicalItems:parseHistoricalItems(state.fanaticalHistoricalItems,state.fanaticalProfileLabel),archivedAt:now});if(archives.length>100)throw new Error('Too many archived profiles; export a backup first.');}
      const observed=new Set(incoming.map(item=>item.sourceItemId));
      // Only a successful complete scan of the same confirmed profile infers
      // absence. Quick scans, failures, and switches cannot retire its items.
      if(control.fullScan&&sameProfile)for(const item of parseLibraryBackup({schemaVersion:1,items:state.fanaticalLibraryItems})) {
        if(!observed.has(item.sourceItemId)&&!history.has(item.sourceItemId))history.set(item.sourceItemId,{profileLabel:control.label,missingSince:now,item});
      }
      for(const id of observed)history.delete(id);
      await area.set({...updates,fanaticalLibraryItems:incoming,fanaticalHistoricalItems:[...history.values()],fanaticalProfileLabel:control.label,fanaticalProfileArchives:archives,[key]:null});return true;
    }
    if(operation==='backup'){
      const state=await area.get({...defaults,fanaticalImportSummary:null,fanaticalWishlistItems:[]});return createLibraryBackup(state.fanaticalLibraryItems,state.fanaticalImportSummary,undefined,state.fanaticalProfileLabel,state.fanaticalProfileArchives,state.fanaticalWishlistItems,state.fanaticalHistoricalItems);
    }
    if(operation==='wishlist'){
      const [action,value]=args,F=globalThis.FanaticalLibrary,stored=await area.get({fanaticalWishlistItems:[]}),current=F.normalizeWishlist(stored.fanaticalWishlistItems);if(!['add','remove','replace'].includes(action))throw Error('Unsupported wishlist action.');
      const next=action==='remove'?current.filter(item=>F.wishlistKey(item)!==value):F.normalizeWishlist(action==='add'?[...current,...F.normalizeWishlist(value)]:value);await area.set({fanaticalWishlistItems:next});return next;
    }
    if(operation==='restore'){
      const backup=args[0];const items=parseLibraryBackup(backup);await area.set({...backupRestoreState(items,backup),[key]:null});return true;
    }
    if(operation==='clear'){
      await area.remove([...Object.keys(defaults),'fanaticalImportSummary','fanaticalLastScanAttempt',key]);return true;
    }
    if(operation==='patch'){
      const updates=args[0];if(!updates||Object.keys(updates).some(name=>!['galacticLibraryExtensionId','fanaticalShowDiagnostics','fanaticalShowNewItemsOnly','fanaticalCatalogueFilters'].includes(name)))throw new Error('Unsupported settings patch.');
      await area.set(updates);return true;
    }
    if(operation==='unlink'){await area.remove('galacticLibraryExtensionId');return true;}
    throw new Error('Unsupported storage operation.');
  }
  return {execute(operation,args=[]){const captured=structuredClone(args);const task=tail.then(()=>operate(operation,captured));tail=task.catch(()=>{});return task;}};
}

/** Portable catalog metadata deliberately excludes purchase/ownership evidence. */
export function createTitleCatalog(items){
  return {format:'fanatical-title-catalog',version:1,items:sanitizeImportResult({items}).items.map(item=>({title:item.title,mediaType:item.mediaType,...(item.externalIds?{externalIds:item.externalIds}:{}),...globalThis.FanaticalLibrary.bibliographicFields(item)}))};
}
