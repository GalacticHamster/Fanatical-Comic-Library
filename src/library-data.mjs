// Shared by the purchase importer and backup UI. Never persist raw input.
import {fanaticalRejectedPurchaseItems} from './acquisition-contract.mjs';
import './purchase-snapshot.js';
import './purchase-adapters.js';
import './purchase-sync.js';
import './shared.js';
import './planning.js';
const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const safeId = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
export const FANATICAL_ORDERS_URL = 'https://www.fanatical.com/en/orders';
export const orderNavigationUrl = id => typeof id === 'string' && safeId(id) ? FANATICAL_ORDERS_URL + '/' + id : null;
async function orderMatchesReference(id, reference) {
  if (!orderNavigationUrl(id) || typeof reference !== 'string' || !/^[a-f0-9]{64}$/u.test(reference)) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === reference;
}

/** Reduce the private page projection to verified orders or known saved purchases. */
export async function checkedOrderNavigation(raw, receipt, recoveryRefs) {
  if (!Array.isArray(raw) || raw.length > 100000) return [];
  const eligible = new Set(receipt.verifiedOrderFingerprints);
  const saved = new Set(recoveryRefs);
  for (const ref of receipt.orderFingerprints) if (saved.has(ref)) eligible.add(ref);
  const checked = new Map();
  for (let start = 0; start < raw.length; start += 64) {
    const chunk = await Promise.all(raw.slice(start, start + 64).map(async pair =>
      Array.isArray(pair) && pair.length === 2 && eligible.has(pair[0]) && await orderMatchesReference(pair[1],pair[0]) ? pair : null));
    for (const pair of chunk) if (pair) checked.set(...pair);
  }
  return [...checked];
}

export function savedOrderReferences(items) {
  const refs = new Set();
  for (const item of items ?? []) {
    if (item?.source && item.source !== 'fanatical') continue;
    for (const origin of item?.purchaseOrigins ?? []) {
      if (/^[a-f0-9]{64}$/u.test(origin?.purchaseRef ?? '')) refs.add(origin.purchaseRef);
    }
  }
  return refs;
}
const safeDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeList = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => safeText(entry, 40)).filter(Boolean))].sort().slice(0, 30);
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

export function keyObservation(value){
  if(value?.keyStatus===undefined&&value?.keyCheckedAt===undefined)return {};
  if(!['unknown','unrevealed'].includes(value.keyStatus)||!safeDate(value.keyCheckedAt))throw Error('Invalid key observation.');
  return {keyStatus:value.keyStatus,keyCheckedAt:safeDate(value.keyCheckedAt)};
}
export function keySummary(origins=[]){
  const observed=origins.filter(o=>o.keyCheckedAt&&['unknown','unrevealed'].includes(o.keyStatus));if(!observed.length)return {};
  const pending=observed.filter(o=>o.keyStatus==='unrevealed'),selected=pending.length?pending:observed;
  return {keyStatus:pending.length?'unrevealed':'unknown',keyCheckedAt:selected.map(o=>o.keyCheckedAt).sort()[0]};
}
/** Purchase groups, not titles or scan timestamps, identify local reminders. */
export function localKeyReminders(items,now=Date.now()){
 const rows=[];for(const item of items??[])for(const origin of item.purchaseOrigins??[]){
  if(!origin.purchaseRef||!['unrevealed','unknown'].includes(origin.keyStatus)||!safeDate(origin.keyCheckedAt))continue;
  const ref=JSON.stringify([item.sourceItemId,origin.purchaseRef,origin.bundle.sourceItemId]);
  rows.push({ref,purchaseRef:origin.purchaseRef,title:item.title,bundle:origin.bundle.title,purchasedAt:origin.purchaseDate,quantity:origin.quantity??1,status:origin.keyStatus,checkedAt:origin.keyCheckedAt,hidden:GalacticPurchaseSnapshot.keyReviewHidden(origin,now),review:GalacticPurchaseSnapshot.keyReview(origin.keyReview)});
 }return rows.sort((a,b)=>a.title.localeCompare(b.title)||a.ref.localeCompare(b.ref));
}
// Review state belongs to the purchase, including when it returns from history.
function retainKeyReviews(items,previous){
 const origins=new Map(),key=(item,o)=>JSON.stringify([item.sourceItemId,o.purchaseRef,o.bundle.sourceItemId]);
 for(const item of previous)for(const o of item.purchaseOrigins??[]){const id=key(item,o),old=origins.get(id);const review=GalacticPurchaseSnapshot.mergeKeyReview(old?.keyReview,o.keyReview),observation=old?.keyCheckedAt&&(!o.keyCheckedAt||Date.parse(old.keyCheckedAt)>Date.parse(o.keyCheckedAt))?old:o;origins.set(id,{...observation,...(review?{keyReview:review}:{})});}
 return items.map(item=>({...item,...(item.purchaseOrigins?{purchaseOrigins:item.purchaseOrigins.map(o=>{const old=origins.get(key(item,o)),review=GalacticPurchaseSnapshot.mergeKeyReview(old?.keyReview,o.keyReview);return {...o,...(review&&!o.keyCheckedAt&&old?.keyCheckedAt?keyObservation(old):{}),...(review?{keyReview:review}:{})};})}:{})}));
}
function purchaseOrigins(value,strict=false){
  if(value===undefined)return undefined;
  if(!Array.isArray(value)||value.length>100000)throw new Error('Invalid purchase origins.');
  return value.map(origin=>{
    if(!origin||typeof origin!=='object'||origin.purchaseRef!==undefined&&origin.purchaseRef!==null&&!/^[a-f0-9]{64}$/iu.test(origin.purchaseRef)||!Number.isSafeInteger(origin.quantity??1)||(origin.quantity??1)<1||(origin.quantity??1)>100000)throw new Error('Invalid purchase origin.');
    if(strict&&(origin.bundle?.sourceItemId&&!safeId(origin.bundle.sourceItemId)||origin.purchaseDate!=null&&!safeDate(origin.purchaseDate)))throw new Error('Invalid purchase provenance.');
    if(origin.keyReview!==undefined&&!origin.keyCheckedAt)throw Error('Key reminder review needs a dated observation.');
    return {
      ...(origin.purchaseRef?{purchaseRef:origin.purchaseRef.toLowerCase()}:{}),
      bundle:{sourceItemId:safeId(origin.bundle?.sourceItemId),title:safeText(origin.bundle?.title),...(safeText(origin.bundle?.slug,300)?{slug:safeText(origin.bundle.slug,300)}:{})},
      purchaseDate:safeDate(origin.purchaseDate),
      quantity:origin.quantity??1,...keyObservation(origin),...(origin.keyReview!==undefined?{keyReview:GalacticPurchaseSnapshot.keyReview(origin.keyReview)}:{}),
      ...(origin.delivery ? { delivery: safeText(origin.delivery) } : {}),
      ...(origin.streaming ? { streaming: true } : {}),
      ...(Array.isArray(origin.drm) && origin.drm.length ? { drm: safeList(origin.drm) } : {}),
      ...(Array.isArray(origin.platforms) && origin.platforms.length ? { platforms: safeList(origin.platforms) } : {}),
      ...(Array.isArray(origin.formats) ? { formats: safeList(origin.formats) } : {})
    };
  });
}
function mergeProduct(previous,incoming){
  if(!previous)return incoming;
  const origins=new Map();
  for(const item of [previous,incoming])for(const origin of item.purchaseOrigins??[{bundle:item.bundle,purchaseDate:item.purchaseDate,quantity:1,delivery:item.delivery,streaming:item.streaming,formats:item.formats}]){
    const key=origin.purchaseRef?JSON.stringify([origin.purchaseRef,origin.bundle?.sourceItemId]):JSON.stringify(['legacy',origin.bundle?.sourceItemId,origin.bundle?.title,origin.purchaseDate]);
    const prev = origins.get(key);
    if (!prev) {
      origins.set(key, origin);
    } else {
      const combinedFormats = Array.isArray(prev.formats) || Array.isArray(origin.formats)
        ? [...new Set([...(prev.formats || []), ...(origin.formats || [])])].sort()
        : undefined;
      const mergedDelivery = origin.delivery || prev.delivery;
      const mergedStreaming = Boolean(origin.streaming || prev.streaming);
      origins.set(key, {
        ...prev,
        ...origin,
        quantity: Math.max(prev.quantity || 1, origin.quantity || 1),
        ...(GalacticPurchaseSnapshot.mergeKeyReview(prev.keyReview,origin.keyReview)?{keyReview:GalacticPurchaseSnapshot.mergeKeyReview(prev.keyReview,origin.keyReview)}:{}),
        ...keyObservation(Date.parse(origin.keyCheckedAt)>=Date.parse(prev.keyCheckedAt)||!prev.keyCheckedAt?origin:prev),
        ...(mergedDelivery ? { delivery: mergedDelivery } : {}),
        ...(mergedStreaming ? { streaming: true } : {}),
        ...(combinedFormats !== undefined ? { formats: combinedFormats } : {})
      });
    }
  }
  const latest=Date.parse(previous.purchaseDate)>Date.parse(incoming.purchaseDate)?previous:incoming;
  const combinedFormats = Array.isArray(previous.formats) || Array.isArray(incoming.formats)
    ? [...new Set([...(previous.formats || []), ...(incoming.formats || [])])].sort()
    : undefined;
  const mergedDelivery = incoming.delivery || previous.delivery || latest.delivery;
  const mergedStreaming = Boolean(incoming.streaming || previous.streaming || latest.streaming);
  return {
    ...latest,
    ...(mergedDelivery ? { delivery: mergedDelivery } : {}),
    ...(mergedStreaming ? { streaming: true } : {}),
    ...(combinedFormats !== undefined ? { formats: combinedFormats } : {}),
    purchaseOrigins:[...origins.values()],...keySummary([...origins.values()])
  };
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
      source: 'fanatical', sourceItemId, title,...keyObservation(candidate),
      ...(safeText(candidate?.slug, 300) ? { slug: safeText(candidate.slug, 300) } : {}),
      mediaType: ['game', 'book', 'comic', 'audiobook', 'software', 'audio', 'video', 'elearning', 'unclassified', 'other'].includes(candidate?.mediaType) ? candidate.mediaType : 'other',
      ...(candidate?.automaticMediaType ? { automaticMediaType: candidate.automaticMediaType } : {}),
      ...(candidate?.manualMediaType ? { manualMediaType: candidate.manualMediaType } : {}),
      ...(candidate?.delivery ? { delivery: candidate.delivery } : {}),
      ...(candidate?.streaming ? { streaming: true } : {}),
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...globalThis.FanaticalLibrary.bibliographicFields(candidate),
      ...globalThis.FanaticalLibrary.contentsMetadata(candidate),
      ...(safeList(candidate?.drm).length ? { drm: safeList(candidate.drm) } : {}),
      ...(safeList(candidate?.platforms).length ? { platforms: safeList(candidate.platforms) } : {}),
      ...(Array.isArray(candidate?.formats) ? { formats: safeList(candidate.formats) } : {}),
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
    items: [...deduplicated.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)),
    ...(input.rejectedPurchaseItems!==undefined?{rejectedPurchaseItems:fanaticalRejectedPurchaseItems(input.rejectedPurchaseItems)}:{})
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
  for(const item of value.items){keyObservation(item);if(item.mediaType!==undefined&&!['game','book','comic','audiobook','software','audio','video','elearning','unclassified','other'].includes(item.mediaType))throw new Error('Invalid backup media type.');purchaseOrigins(item.purchaseOrigins,true);}
  if (value.mediaTypeOverrides !== undefined) {
    if (typeof value.mediaTypeOverrides !== 'object' || Array.isArray(value.mediaTypeOverrides) || value.mediaTypeOverrides === null) throw new Error('Invalid backup media type overrides.');
    for (const [, v] of Object.entries(value.mediaTypeOverrides)) {
      if (typeof v !== 'string' || !['game','book','comic','audiobook','software','audio','video','elearning','unclassified','other'].includes(v)) throw new Error('Invalid backup media type override value.');
    }
  }
  if (value.rejectedPurchaseItems !== undefined) {
    value.rejectedPurchaseItems = fanaticalRejectedPurchaseItems(value.rejectedPurchaseItems);
  }
  return sanitizeImportResult(value).items;
}

/** Do not let tolerant sanitization turn a broken scan into an empty rebuild. */
export function validateScanResult(value, { fullScan = false, knownOrderFingerprints = [] } = {}) {
  if(value?.partialScanVersion===1)return validatePartialScan(value,{fullScan,knownOrderFingerprints});
  const fail = () => { throw new Error('Fanatical scan was unreadable or incomplete. Your library and scan history were not changed.'); };
  const integer = (number) => Number.isSafeInteger(number) && number >= 0;
  if (!value || value.schemaVersion !== 1 || value.coverage?.complete !== true || !integer(value.ordersScanned) || !integer(value.ordersAvailable)
    || !integer(value.coverage.listedOrders) || value.coverage.listedOrders < value.ordersAvailable || value.coverage.validatedOrders !== value.ordersScanned
    || value.coverage.emptyAccount !== (value.coverage.listedOrders === 0) || !Array.isArray(value.items) || !Array.isArray(value.orderFingerprints)) fail();
  const fingerprints = value.orderFingerprints;
  if (fingerprints.length !== value.ordersAvailable || fingerprints.some((fingerprint) => typeof fingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(fingerprint)) || new Set(fingerprints).size !== fingerprints.length) fail();
  const known = new Set(knownOrderFingerprints);
  const unseen = fingerprints.filter((fingerprint) => !known.has(fingerprint)).length;
  const scheduled = value.coverage?.compatibility?.counts?.scheduled;
  const expected = fullScan ? value.ordersAvailable : (Number.isSafeInteger(scheduled) ? scheduled : unseen);
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

const PARTIAL_FAILURE_CODES=new Set(['batch-deferred','discovery-unverified','listing-unreadable','listing-incomplete','summaries-unreadable','details-unreadable','details-incomplete','request-aborted','retry-later','request-exhausted','pagination-unsafe','pagination-ambiguous','pagination-total','pagination-repeated','page-limit','order-limit','pagination-range','pagination-order','pagination-last','pagination-final','pagination-missing-next','history-missing-known']);
const LISTING_EVIDENCE_KEYS=['arrayPages','objectPages','otherPages','headersReadablePages','linkHeaderPages','totalCountHeaderPages','contentRangeHeaderPages','nextReferencePages'];
function validFingerprints(value){return Array.isArray(value)&&value.length<=100000&&value.every(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/u.test(fp))&&new Set(value).size===value.length;}
function validatePartialScan(value,{fullScan,knownOrderFingerprints}){
  const fail=()=>{throw Error('Invalid independent purchase evidence; the partial scan was not saved.');};
  const bounded=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
  if(value.schemaVersion!==1||!['complete','partial-extraction','partial-discovery'].includes(value.outcome))fail();
  if(value.outcome==='complete')validateScanResult({...value,partialScanVersion:undefined},{fullScan,knownOrderFingerprints});
  for(const name of ['orderFingerprints','verifiedOrderFingerprints','unresolvedOrderFingerprints','ineligibleOrderFingerprints','observedOrderFingerprints'])if(!validFingerprints(value[name]))fail();
  // Orders a bounded Full-scan batch left for a later batch: always a subset of the unresolved orders.
  const deferred=value.deferredOrderFingerprints===undefined?null:new Set(validFingerprints(value.deferredOrderFingerprints)?value.deferredOrderFingerprints:fail());
  if(deferred&&[...deferred].some(fp=>!value.unresolvedOrderFingerprints.includes(fp)))fail();
  const all=new Set(value.observedOrderFingerprints),verified=new Set(value.verifiedOrderFingerprints),processed=new Set(value.orderFingerprints),unresolved=new Set(value.unresolvedOrderFingerprints),ineligible=new Set(value.ineligibleOrderFingerprints),known=new Set(validFingerprints(knownOrderFingerprints)?knownOrderFingerprints:[]);
  if([...processed].some(fp=>!all.has(fp)||unresolved.has(fp)||ineligible.has(fp)||!verified.has(fp)&&(!known.has(fp)||fullScan))||[...verified].some(fp=>!processed.has(fp))||[...unresolved].some(fp=>!all.has(fp)||ineligible.has(fp))||[...ineligible].some(fp=>!all.has(fp))||processed.size+unresolved.size+ineligible.size!==all.size)fail();
  const c=value.coverage;
  if(!c||typeof c.discoveryComplete!=='boolean'||c.complete!==(value.outcome==='complete')||c.discoveryComplete!==(value.outcome!=='partial-discovery')||!bounded(c.listedOrders)||c.listedOrders!==all.size||c.validatedOrders!==verified.size||c.emptyAccount!==(all.size===0)||!Number.isSafeInteger(c.pagesFetched)||c.pagesFetched<1||c.pagesFetched>1000||!Number.isSafeInteger(c.retries)||c.retries<0||c.retries>300000||c.concurrency!==3||!['array-only','link','count','range'].includes(c.paginationEvidence)||c.expectedTotal!==null&&!bounded(c.expectedTotal)||!bounded(value.ordersAvailable)||value.ordersAvailable>all.size||value.ordersScanned!==verified.size||!bounded(value.unidentifiedRecords))fail();
  if(!['saved-order-match','declared-scope'].includes(c.accountAffinity))fail();
  if(!Number.isSafeInteger(c.pagesParsed)||c.pagesParsed<0||c.pagesParsed>c.pagesFetched)fail();
  if(c.discoveryComplete&&(c.paginationEvidence==='array-only'&&c.pagesFetched!==1||c.expectedTotal!==null&&c.expectedTotal!==all.size||value.unidentifiedRecords))fail();
  if(!Array.isArray(value.failures)||value.failures.length>32||value.failures.some(f=>!f||!PARTIAL_FAILURE_CODES.has(f.code)||!['listing','summaries','details'].includes(f.stage)||!bounded(f.count)||f.count<1))fail();
  const failures=value.failures.map(({code,stage,count})=>({code,stage,count}));
  let listingEvidence=null;
  if(c.listingEvidence!==undefined){
    if(!c.listingEvidence||LISTING_EVIDENCE_KEYS.some(k=>!Number.isSafeInteger(c.listingEvidence[k])||c.listingEvidence[k]<0||c.listingEvidence[k]>c.pagesFetched))fail();
    listingEvidence=Object.fromEntries(LISTING_EVIDENCE_KEYS.map(k=>[k,c.listingEvidence[k]]));
    if(listingEvidence.arrayPages+listingEvidence.objectPages+listingEvidence.otherPages>c.pagesFetched||listingEvidence.headersReadablePages>listingEvidence.arrayPages+listingEvidence.objectPages+listingEvidence.otherPages||['linkHeaderPages','totalCountHeaderPages','contentRangeHeaderPages'].some(k=>listingEvidence[k]>listingEvidence.headersReadablePages)||listingEvidence.nextReferencePages>listingEvidence.linkHeaderPages)fail();
  }
  const acquisitionComplete=value.outcome==='complete'||value.outcome==='partial-discovery'&&c.paginationEvidence==='array-only'&&c.expectedTotal===null&&c.pagesParsed===c.pagesFetched&&unresolved.size===0&&value.unidentifiedRecords===0&&failures.length===1&&failures[0].code==='discovery-unverified'&&failures[0].stage==='listing'&&failures[0].count===1;
  if(value.outcome==='complete'&&(unresolved.size||value.unidentifiedRecords||failures.length)||value.outcome==='partial-extraction'&&!unresolved.size||value.outcome!=='complete'&&!failures.length)fail();
  if(!Array.isArray(value.items)||value.items.length>500000)fail();
  const projected=sanitizeImportResult(value),origins=new Set();
  if(projected.items.length!==value.items.length)fail();
  for(const item of value.items){
    if(item.source!=='fanatical'||!safeId(item.sourceItemId)||!safeText(item.title)||!safeId(item.bundle?.sourceItemId)||!safeText(item.bundle?.title)||!Array.isArray(item.purchaseOrigins)||!item.purchaseOrigins.length)fail();
    purchaseOrigins(item.purchaseOrigins,true);
    for(const origin of item.purchaseOrigins){if(!verified.has(origin.purchaseRef)||!safeId(origin.bundle?.sourceItemId)||!safeText(origin.bundle?.title))fail();origins.add(origin.purchaseRef);}
  }
  if(origins.size!==verified.size)fail();
  return {...projected,acquisitionComplete,partialScanVersion:1,outcome:value.outcome,verifiedOrderFingerprints:[...verified],unresolvedOrderFingerprints:[...unresolved],...(deferred?{deferredOrderFingerprints:[...deferred]}:{}),ineligibleOrderFingerprints:[...ineligible],observedOrderFingerprints:[...all],failures,unidentifiedRecords:value.unidentifiedRecords,coverage:{...(listingEvidence?{listingEvidence}:{}),complete:c.complete,discoveryComplete:c.discoveryComplete,accountAffinity:c.accountAffinity,listedOrders:c.listedOrders,validatedOrders:c.validatedOrders,emptyAccount:c.emptyAccount,pagesFetched:c.pagesFetched,pagesParsed:c.pagesParsed,expectedTotal:c.expectedTotal,paginationEvidence:c.paginationEvidence,retries:c.retries,concurrency:3}};
}

/** A Full scan read in batches keeps its progress here until its final complete commit. */
const FULL_SCAN_PASS_KEY='fanaticalFullScanPass',FULL_SCAN_PART_PREFIX='fanaticalFullScanPart:';
const sameFullScanPass=(saved,expected)=>saved&&saved.accountId===expected.accountId&&saved.label===expected.label&&saved.startedAt===expected.startedAt&&saved.parts===expected.parts&&saved.updatedAt===expected.updatedAt;
export function fullScanStorage(){return {pass:FULL_SCAN_PASS_KEY,part:n=>FULL_SCAN_PART_PREFIX+n};}
// An unfinished Full scan is kept for this many days after its last saved batch.
export const FULL_SCAN_PASS_DAYS=7;
// The active account's unfinished Full scan, if it can still be continued. Counts only; never order data.
export function fullScanPassStatus(state,now=Date.now()){
  const pass=state?.[FULL_SCAN_PASS_KEY],updated=Date.parse(pass?.updatedAt);
  if(pass?.version!==1||!state.fanaticalAccountId||pass.accountId!==state.fanaticalAccountId||pass.label!==state.fanaticalProfileLabel||!Array.isArray(pass.done)||!Number.isSafeInteger(pass.parts)||pass.parts<1||!Number.isFinite(updated)||now-updated>=FULL_SCAN_PASS_DAYS*86400000)return null;
  return {verifiedOrders:pass.done.length,batches:pass.parts,startedAt:safeDate(pass.startedAt),updatedAt:safeDate(pass.updatedAt),expiresAt:new Date(updated+FULL_SCAN_PASS_DAYS*86400000).toISOString()};
}
export async function removeFullScanPass(area){
  const pass=(await area.get({[FULL_SCAN_PASS_KEY]:null}))[FULL_SCAN_PASS_KEY],parts=Number.isSafeInteger(pass?.parts)&&pass.parts>0?Math.min(pass.parts,1000):0;
  await area.remove([FULL_SCAN_PASS_KEY,...Array.from({length:parts},(_,n)=>FULL_SCAN_PART_PREFIX+n)]);
}

function partialAttemptIsValid(attempt){
  return attempt?.status==='partial'&&attempt.partialCheckpointVersion===1&&['partial-discovery','partial-extraction'].includes(attempt.outcome)&&attempt.discoveryComplete===(attempt.outcome==='partial-extraction')&&['full','quick'].includes(attempt.scanMode)&&Number.isSafeInteger(attempt.pagesProcessed)&&attempt.pagesProcessed>=1&&attempt.pagesProcessed<=1000&&attempt.completeCheckpointAdvanced===false&&Boolean(safeDate(attempt.attemptedAt))&&['verifiedPurchasesSaved','unresolvedOrders'].every(k=>Number.isSafeInteger(attempt[k])&&attempt[k]>=0&&attempt[k]<=100000)&&Array.isArray(attempt.failures)&&attempt.failures.length<=32&&attempt.failures.every(f=>PARTIAL_FAILURE_CODES.has(f.code)&&['listing','summaries','details'].includes(f.stage)&&Number.isSafeInteger(f.count)&&f.count>0&&f.count<=100000);
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

export function createLibraryBackup(items, summary, exportedAt = new Date().toISOString(), profileLabel='', profileArchives=[],wishlistItems=[],historicalItems=[],mediaTypeOverrides={},rejectedPurchaseItems=[],accountId=null) {
  // Scan metadata is informational only: restore never trusts its skip history.
  const safeSummary = summary && ['full', 'quick'].includes(summary.scanMode) ? {
    importedAt: safeDate(summary.importedAt), scanMode: summary.scanMode,
    ordersScanned: count(summary.ordersScanned), ordersAvailable: count(summary.ordersAvailable), ordersSkipped: count(summary.ordersSkipped),
    addedProducts: count(summary.addedProducts), ownedLeafProducts: count(summary.ownedLeafProducts),
    historyCoverage: safeText(summary.historyCoverage)
  } : null;
  const safeOverrides = (mediaTypeOverrides && typeof mediaTypeOverrides === 'object' && !Array.isArray(mediaTypeOverrides)) ? mediaTypeOverrides : {};
  const safeRejected = fanaticalRejectedPurchaseItems(rejectedPurchaseItems);
  if(accountId!=null&&!GalacticPurchaseSync.accountUuid(accountId))throw Error('Invalid saved account identity.');
  const scoped={...(accountId?{accountId}:{}),format:'fanatical-library-backup',schemaVersion:4,wishlistItems:globalThis.FanaticalLibrary.normalizeWishlist(wishlistItems),items:sanitizeImportResult({items}).items,profileLabel,profileArchives,historicalItems:parseHistoricalItems(historicalItems,profileLabel),mediaTypeOverrides:safeOverrides,rejectedPurchaseItems:safeRejected};
  parseLibraryBackup(scoped);
  const safeArchives=backupRestoreState(scoped.items,scoped).fanaticalProfileArchives;
  return { format:'fanatical-library-backup', ...scoped, exportedAt: safeDate(exportedAt), summary: safeSummary, profileArchives:safeArchives };
}

export function backupRestoreState(items, backup={}) {
  const profileArchives=(backup.schemaVersion>=2?backup.profileArchives:[]).map(entry=>{
    if(!entry||typeof entry.profileLabel!=='string'||!entry.profileLabel||entry.profileLabel.length>100)throw new Error('Invalid archived profile.');
    if(entry.accountId!=null&&!GalacticPurchaseSync.accountUuid(entry.accountId))throw Error('Invalid saved account identity.');
    return {...(entry.accountId?{accountId:entry.accountId}:{}),profileLabel:entry.profileLabel,items:parseLibraryBackup({schemaVersion:1,items:entry.items}),archivedAt:safeDate(entry.archivedAt),
      historicalItems:parseHistoricalItems(entry.historicalItems??[],entry.profileLabel)};
  });
  if(backup.accountId!=null&&!GalacticPurchaseSync.accountUuid(backup.accountId))throw Error('Invalid saved account identity.');
  const ids=[backup.accountId,...profileArchives.map(a=>a.accountId)].filter(Boolean).map(id=>id.toLowerCase());if(new Set(ids).size!==ids.length)throw Error('Duplicate saved account identity.');
  return { fanaticalAccountId:backup.accountId??null, fanaticalLibraryItems: items, fanaticalImportSummary: null, fanaticalScannedOrderFingerprints: [], fanaticalLastScanAttempt: null, fanaticalProfileLabel:backup.schemaVersion>=2?backup.profileLabel:'', fanaticalProfileArchives:profileArchives,
    fanaticalHistoricalItems:backup.schemaVersion>=4?parseHistoricalItems(backup.historicalItems,backup.profileLabel):[],
    ...(backup.mediaTypeOverrides && typeof backup.mediaTypeOverrides === 'object' && !Array.isArray(backup.mediaTypeOverrides) ? { mediaTypeOverrides: backup.mediaTypeOverrides } : {}),
    ...(backup.rejectedPurchaseItems!==undefined ? { rejectedPurchaseItems: fanaticalRejectedPurchaseItems(backup.rejectedPurchaseItems) } : {}),
    ...(backup.schemaVersion>=3?{fanaticalWishlistItems:globalThis.FanaticalLibrary.normalizeWishlist(backup.wishlistItems)}:{}) };
}

// Restore adds a backup to what this browser already saved. Purchases already saved here keep their
// current or history placement, the backup adds missing purchases and purchase records, and each key
// review keeps the newer decision. Accounts match only by saved account identity; a saved account
// that the backup does not contain is kept as a saved account. Corrections and wishes already saved
// here win, and the backup adds missing ones.
function mergeAccountPurchases(restored,current,label){
  const ids=rows=>new Set(rows.map(item=>item.sourceItemId));
  // An identical saved copy needs no merge, which keeps repeated restores unchanged. Saved purchases
  // are compared in backup form; any that no longer validate are kept exactly as saved.
  const normal=rows=>{try{return parseLibraryBackup({schemaVersion:1,items:rows});}catch{return rows;}};
  current={items:normal(current.items),historicalItems:current.historicalItems};
  const saved=new Map([...current.items,...current.historicalItems.map(entry=>entry.item)].map(item=>[item.sourceItemId,JSON.stringify(item)]));
  const changed=item=>saved.get(item.sourceItemId)!==JSON.stringify(item);
  restored={items:restored.items.filter(changed),historicalItems:restored.historicalItems.filter(entry=>changed(entry.item))};
  const currentActive=ids(current.items),currentHistory=new Map(current.historicalItems.map(entry=>[entry.item.sourceItemId,entry]));
  const restoredHistory=restored.historicalItems.filter(entry=>!currentActive.has(entry.item.sourceItemId));
  const toHistory=new Map([...restored.items,...restored.historicalItems.map(entry=>entry.item)].filter(item=>currentHistory.has(item.sourceItemId)).map(item=>[item.sourceItemId,item]));
  const items=mergeLibraryItems([...restored.items.filter(item=>!currentHistory.has(item.sourceItemId)),...restored.historicalItems.filter(entry=>currentActive.has(entry.item.sourceItemId)).map(entry=>entry.item),...current.items]);
  const history=new Map(restoredHistory.filter(entry=>!currentHistory.has(entry.item.sourceItemId)).map(entry=>[entry.item.sourceItemId,entry]));
  for(const [id,entry] of currentHistory)history.set(id,toHistory.has(id)?{...entry,item:mergeLibraryItems([toHistory.get(id),entry.item])[0]}:entry);
  const activeIds=ids(items);
  return {items,historicalItems:[...history.values()].filter(entry=>!activeIds.has(entry.item.sourceItemId)).map(entry=>({...entry,profileLabel:label}))};
}
export function mergeRestoreState(current,restored){
  const id=value=>value?String(value).toLowerCase():'';
  const sources=[];
  // Restore still resets scan history everywhere, so the next scan rechecks orders; it never removes purchases.
  if(current.fanaticalLibraryItems?.length||current.fanaticalHistoricalItems?.length)sources.push({accountId:current.fanaticalAccountId,profileLabel:current.fanaticalProfileLabel,items:current.fanaticalLibraryItems,historicalItems:current.fanaticalHistoricalItems??[],archivedAt:new Date().toISOString()});
  sources.push(...(current.fanaticalProfileArchives??[]).map(({localScanState,...entry})=>entry));
  const next={...restored,fanaticalProfileArchives:[...restored.fanaticalProfileArchives]};
  const labels=()=>new Set([next.fanaticalProfileLabel,...next.fanaticalProfileArchives.map(entry=>entry.profileLabel)]);
  for(const source of sources){
    const sid=id(source.accountId),sourceData={items:source.items??[],historicalItems:source.historicalItems??[]};
    if(sid&&sid===id(next.fanaticalAccountId)){
      const merged=mergeAccountPurchases({items:next.fanaticalLibraryItems,historicalItems:next.fanaticalHistoricalItems},sourceData,next.fanaticalProfileLabel);
      Object.assign(next,{fanaticalLibraryItems:merged.items,fanaticalHistoricalItems:merged.historicalItems});
      continue;
    }
    const index=sid?next.fanaticalProfileArchives.findIndex(entry=>id(entry.accountId)===sid):-1;
    if(index>=0){
      const entry=next.fanaticalProfileArchives[index],merged=mergeAccountPurchases({items:entry.items,historicalItems:entry.historicalItems??[]},sourceData,entry.profileLabel);
      next.fanaticalProfileArchives[index]={...entry,...merged};
      continue;
    }
    if(!sourceData.items.length&&!sourceData.historicalItems.length)continue;
    const taken=labels();let name=source.profileLabel||'Account before restore';
    if(taken.has(name)){const base=`${name} (before restore)`;name=base;for(let n=2;taken.has(name);n++)name=`${base} ${n}`;}
    next.fanaticalProfileArchives.push({...source,profileLabel:name,historicalItems:sourceData.historicalItems.map(entry=>({...entry,profileLabel:name}))});
  }
  if(next.fanaticalProfileArchives.length>100)throw Error('Too many saved accounts. Export a backup first.');
  const F=globalThis.FanaticalLibrary,wishes=new Map();
  if(next.fanaticalWishlistItems)for(const item of [...F.normalizeWishlist(next.fanaticalWishlistItems),...F.normalizeWishlist(current.fanaticalWishlistItems??[])])wishes.set(F.wishlistKey(item),item);
  const rejected=new Map([...(next.rejectedPurchaseItems??[]),...(current.rejectedPurchaseItems??[])].map(row=>[JSON.stringify(row),row]));
  return {...next,
    fanaticalWishlistItems:next.fanaticalWishlistItems?[...wishes.values()].slice(0,10000):F.normalizeWishlist(current.fanaticalWishlistItems??[]),
    mediaTypeOverrides:{...(next.mediaTypeOverrides??{}),...(current.mediaTypeOverrides??{})},
    rejectedPurchaseItems:fanaticalRejectedPurchaseItems([...rejected.values()])};
}

export function createSyncStore(area,{onInvalidated=()=>{}}={}){
  let tail=Promise.resolve();const key='fanaticalSyncControl';
  const defaults={fanaticalLibraryItems:[],fanaticalScannedOrderFingerprints:[],fanaticalProfileLabel:'',fanaticalAccountId:null,fanaticalProfileArchives:[],fanaticalHistoricalItems:[],fanaticalImportSummary:null,fanaticalLastScanAttempt:null,mediaTypeOverrides:{},rejectedPurchaseItems:[]};
  async function operate(operation,args){
    if(['syncAccounts','begin','selectProfile','renameProfile'].includes(operation))await GalacticPurchaseSync.migrateAccounts(area,'fan');
    function archive(state){
      const fingerprints=state.fanaticalScannedOrderFingerprints;
      if(!Array.isArray(fingerprints)||fingerprints.some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value)))throw Error('Saved account scan history is invalid.');
      return {accountId:state.fanaticalAccountId,profileLabel:state.fanaticalProfileLabel,items:parseLibraryBackup({schemaVersion:1,items:state.fanaticalLibraryItems}),historicalItems:parseHistoricalItems(state.fanaticalHistoricalItems,state.fanaticalProfileLabel),archivedAt:new Date().toISOString(),localScanState:{fingerprints:[...new Set(fingerprints)],summary:state.fanaticalImportSummary,attempt:state.fanaticalLastScanAttempt}};
    }
    if(operation==='syncAccounts'){
      const state=await area.get(defaults),rows=await globalThis.GalacticPurchaseAdapters.accounts('fan',state);
      return rows;
    }
    if (operation === 'keyReminderDestination' || operation === 'orderDestination') {
      const [accountId, ref] = args;
      const state = await area.get({fanaticalAccountId:null, fanaticalLibraryItems:[], fanaticalOrderNavigation:{}});
      const reminder = operation === 'keyReminderDestination';
      if (!accountId || state.fanaticalAccountId !== accountId) throw Error(reminder
        ? 'The saved account changed. Refresh reminders before opening a purchase.'
        : 'The saved account changed. Refresh before opening a purchase.');
      const purchaseRef = reminder
        ? localKeyReminders(state.fanaticalLibraryItems).find(row => row.ref === ref)?.purchaseRef
        : savedOrderReferences(state.fanaticalLibraryItems).has(ref) ? ref : null;
      if (!purchaseRef) throw Error(reminder ? 'This reminder changed. Refresh reminders before opening a purchase.'
        : 'This purchase changed. Refresh before opening it.');
      const id = state.fanaticalOrderNavigation[accountId]?.[purchaseRef];
      return await orderMatchesReference(id,purchaseRef) ? orderNavigationUrl(id) : null;
    }
    if(['handoffAccounts','handoffSnapshot','handoffImport','handoffPreview'].includes(operation)){
      const A=globalThis.GalacticPurchaseAdapters,S=globalThis.GalacticPurchaseSnapshot,state=await area.get(defaults);
      if(operation==='handoffAccounts')return A.accounts('fan',state);
      if(operation==='handoffSnapshot')return A.snapshot('fan',state,args[0]);
      const [raw,target]=args,data=S.validate(raw);if(data.provider!=='fanatical')throw Error('Wrong purchase provider.');
      if(operation!=='handoffPreview'&&(await area.get({[key]:null}))[key])throw Error('Wait for the Fanatical scan to finish before importing saved purchases.');
      let scope;
      if(target?.newLabel){const label=String(target.newLabel).trim();if(!label||label.length>100||A.fanScopes(state).some(value=>value.label===label)||target.expectedActiveLabel!==state.fanaticalProfileLabel)throw Error('Invalid or stale new account choice.');scope={label,items:[],state:{accountId:crypto.randomUUID()},fresh:true};}
      else scope=await A.selected('fan',state,target?.accountRef);
      if(operation==='handoffImport'&&target?.autoSync){const accountId=scope.stableId;await globalThis.GalacticPurchaseSync.assertCommit(area,data.provider,target,accountId);}
      const result=A.fanMerge(scope.items,data.records,Boolean(target?.autoSync)),items=parseLibraryBackup({schemaVersion:1,items:retainKeyReviews(result.items,[...(scope.label===state.fanaticalProfileLabel?state.fanaticalHistoricalItems:scope.state?.historicalItems??[]).map(h=>h.item),...scope.items])});
      if(operation==='handoffPreview')return {readOnly:true,sourceRecords:data.records.length,destinationRecords:scope.items.length,...result.stats,...A.previewTitles(scope.items,result.items.slice(scope.items.length)),updateBreakdownKnown:false,limitations:data.limitations};
      if(!result.stats.added&&!result.stats.updated&&!scope.fresh)return result.stats;
      if(scope.label===state.fanaticalProfileLabel||!state.fanaticalProfileLabel&&!state.fanaticalLibraryItems.length)await area.set({fanaticalAccountId:scope.state.accountId??scope.stableId,fanaticalLibraryItems:items,fanaticalProfileLabel:scope.label});
      else {const archives=state.fanaticalProfileArchives.filter(p=>p.profileLabel!==scope.label);archives.push({...scope.state,accountId:scope.stableId??scope.state.accountId,profileLabel:scope.label,items,historicalItems:scope.state?.historicalItems??[],archivedAt:new Date().toISOString()});if(archives.length>100)throw Error('Too many saved accounts.');await area.set({fanaticalProfileArchives:archives});}
      return result.stats;
    }
    if(operation==='reviewKeyReminder'){
      const [request]=args,state=await area.get(defaults);
      if(!request||request.accountId!==state.fanaticalAccountId||!GalacticPurchaseSync.accountUuid(request.accountId))throw Error('The saved account changed. Refresh reminders before reviewing.');
      const row=localKeyReminders(state.fanaticalLibraryItems).find(r=>r.ref===request.ref);
      if(!row||request.basis!==row.status||JSON.stringify(request.expectedReview??null)!==JSON.stringify(row.review??null))throw Error('This reminder changed. Refresh before reviewing.');
      if(!['active','dismissed','snoozed'].includes(request.action))throw Error('Invalid reminder action.');
      if(request.action==='snoozed'&&(!safeDate(request.until)||Date.parse(request.until)<=Date.now()||Date.parse(request.until)>Date.now()+366*86400000))throw Error('Snooze must end within the next year.');
      const review=GalacticPurchaseSnapshot.keyReview({action:request.action,basis:row.status,until:request.action==='snoozed'?request.until:null,updatedAt:new Date(Math.max(Date.now(),Date.parse(row.review?.updatedAt??'')+1||0)).toISOString()});
      const items=state.fanaticalLibraryItems.map(item=>({...item,...(item.purchaseOrigins?{purchaseOrigins:item.purchaseOrigins.map(o=>JSON.stringify([item.sourceItemId,o.purchaseRef,o.bundle.sourceItemId])===row.ref?{...o,keyReview:review}:o)}:{})}));
      await area.set({fanaticalLibraryItems:items});return true;
    }
    if(operation==='profiles'){
      const state=await area.get(defaults),unique=new Map(state.fanaticalProfileArchives.map(entry=>[entry.profileLabel,entry]));
      if(state.fanaticalProfileLabel)unique.delete(state.fanaticalProfileLabel);
      return {activeLabel:state.fanaticalProfileLabel,profiles:[...(state.fanaticalProfileLabel||state.fanaticalAccountId||state.fanaticalLibraryItems.length?[{label:state.fanaticalProfileLabel,active:true,itemCount:state.fanaticalLibraryItems.length}]:[]),...[...unique.values()].map(entry=>({label:entry.profileLabel,active:false,itemCount:entry.items.length}))]};
    }
    if(operation==='selectProfile'||operation==='renameProfile'){
      const [options]=args,state=await area.get(defaults),label=String(options.profileLabel??'').trim();
      if(options.confirmed!==true)throw Error('Confirm the selected account before continuing.');
      if(options.expectedActiveLabel!==state.fanaticalProfileLabel)throw Error('The active account changed. Review the saved accounts and try again.');
      const selected=label===state.fanaticalProfileLabel&&label?null:[...state.fanaticalProfileArchives].reverse().find(entry=>entry.profileLabel===label);
      if(!label&&operation!=='renameProfile'||label!==state.fanaticalProfileLabel&&!selected)throw Error('This saved account is unavailable. Refresh the account list.');
      if(operation==='renameProfile'){
        const next=String(options.newLabel??'').trim();
        if(!next||next.length>100)throw Error('Enter an account nickname of 1 to 100 characters.');
        if(next===label)return true;
        if(next===state.fanaticalProfileLabel||state.fanaticalProfileArchives.some(entry=>entry.profileLabel===next))throw Error('That account nickname is already in use.');
        const renameHistory=rows=>(rows??[]).map(entry=>({...entry,profileLabel:next}));
        const archives=state.fanaticalProfileArchives.map(entry=>entry.profileLabel===label?{...entry,profileLabel:next,historicalItems:renameHistory(entry.historicalItems)}:entry);
        await area.set({fanaticalProfileArchives:archives,...(label===state.fanaticalProfileLabel?{fanaticalProfileLabel:next,fanaticalHistoricalItems:renameHistory(state.fanaticalHistoricalItems)}:{}),[key]:null});return true;
      }
      if(label===state.fanaticalProfileLabel)return true;
      if(!state.fanaticalProfileLabel&&state.fanaticalLibraryItems.length)throw Error('Name the current account in Saved accounts before switching. Your purchases were kept.');
      const items=parseLibraryBackup({schemaVersion:1,items:selected.items}),history=parseHistoricalItems(selected.historicalItems??[],label),scan=selected.localScanState;
      if(scan&&(!Array.isArray(scan.fingerprints)||scan.fingerprints.some(value=>typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))))throw Error('Saved account scan history is invalid.');
      const archives=state.fanaticalProfileArchives.filter(entry=>entry.profileLabel!==label&&entry.profileLabel!==state.fanaticalProfileLabel);
      if(state.fanaticalProfileLabel)archives.push(archive(state));
      if(archives.length>100)throw Error('Too many saved accounts. Export a backup first.');
      await area.set({fanaticalAccountId:selected.accountId,fanaticalLibraryItems:items,fanaticalHistoricalItems:history,fanaticalScannedOrderFingerprints:scan?.fingerprints??[],fanaticalImportSummary:scan?.summary??null,fanaticalLastScanAttempt:scan?.attempt??null,fanaticalProfileLabel:label,fanaticalProfileArchives:archives,[key]:null});return true;
    }
    if(operation==='begin'){
      const [options,tabId]=args;const state=await area.get(defaults);let label=String(options.profileLabel??'').trim();
      if(options.fullScanPass){
        const saved=(await area.get({[FULL_SCAN_PASS_KEY]:null}))[FULL_SCAN_PASS_KEY];
        if(!sameFullScanPass(saved,options.fullScanPass))throw Error('Full scan progress changed. Start the scan again.');
      }
      const reuse=options.reuseAccount===true&&options.accountId===state.fanaticalAccountId&&!options.switchProfile;
      if(options.reuseAccount&&!reuse)throw Error('The selected saved account changed. Start the update again.');
      if(reuse){if(label&&label!==state.fanaticalProfileLabel)throw Error('Use Change account to select another account; use Rename in Saved accounts to change its name.');label=state.fanaticalProfileLabel||'Default account';}
      if(!label&&options.confirmed&&options.switchProfile){let n=state.fanaticalProfileArchives.length+2;do{label='Account '+n++;}while(label===state.fanaticalProfileLabel||state.fanaticalProfileArchives.some(a=>a.profileLabel===label));}
      if((!options.confirmed&&!reuse)||!label||label.length>100)throw new Error('Choose the saved account to update.');
      const changing=Boolean(state.fanaticalProfileLabel)&&state.fanaticalProfileLabel!==label;
      if(changing&&state.fanaticalProfileArchives.some(entry=>entry.profileLabel===label))throw Error('This account is already saved. Use saved account before importing.');
      if(changing&&(!options.fullScan||!options.switchProfile))throw new Error('Choose Rescan all purchases and explicitly select Save a new account.');
      const fingerprints=state.fanaticalScannedOrderFingerprints;
      const initialized=(['full','quick'].includes(state.fanaticalImportSummary?.scanMode)||partialAttemptIsValid(state.fanaticalLastScanAttempt)&&fingerprints?.length>0)&&validFingerprints(fingerprints);
      const forceFull=changing||!state.fanaticalProfileLabel||!initialized;const token=globalThis.crypto.randomUUID();
      await area.set({[key]:{token,tabId,label,changing,fullScan:options.fullScan||forceFull}});
      return {token,forceFull,state:changing?{...defaults}:state};
    }
    if(operation==='stageFullScanBatch'){
      // A restore or profile change invalidates the same token used to save the batch.
      const [token,tabId,pass,done,receipt]=args;
      const saved=await area.get({[key]:null,[FULL_SCAN_PASS_KEY]:null,fanaticalAccountId:null,fanaticalProfileLabel:''});
      const control=saved[key];
      if(!control||control.token!==token||control.tabId!==tabId)throw new Error('Scan superseded by another scan, restore, or clear. Start a fresh scan.');
      if(pass.parts ? !sameFullScanPass(saved[FULL_SCAN_PASS_KEY],pass) : saved[FULL_SCAN_PASS_KEY]!==null)throw Error('Full scan progress changed. Start the scan again.');
      const next={...pass,accountId:saved.fanaticalAccountId,label:saved.fanaticalProfileLabel,parts:pass.parts+1,done,updatedAt:new Date().toISOString()};
      await area.set({[FULL_SCAN_PART_PREFIX+pass.parts]:{items:receipt.items,rejectedPurchaseItems:receipt.rejectedPurchaseItems??[]},[FULL_SCAN_PASS_KEY]:next,[key]:null});
      return next;
    }
    if(operation==='commit'||operation==='commitPartial'||operation==='commitFullScanBatch'||operation==='failure'){
      const [token,rawUpdates,tabId,stageBatch,navigation]=args;let updates=rawUpdates;const control=(await area.get({[key]:null}))[key];
      if(!control||control.token!==token||control.tabId!==tabId){if(operation==='failure')return false;throw new Error('Scan superseded by another scan, restore, or clear. Start a fresh scan.');}
      if(operation==='failure'){await area.set({fanaticalLastScanAttempt:{status:'incomplete',scanMode:control.fullScan?'full':'quick',attemptedAt:new Date().toISOString()},[key]:null});return true;}
      const state=await area.get(defaults);const archives=[...state.fanaticalProfileArchives];
      const finalBatch=operation==='commitFullScanBatch',partial=operation==='commitPartial'||finalBatch;let partialSummary;
      if(partial){
        const base=control.changing?defaults:state;
        // A final batch is already validated against the pass fingerprints in the worker.
        const receipt=finalBatch?updates:validateScanResult(updates,{fullScan:control.fullScan,knownOrderFingerprints:base.fanaticalScannedOrderFingerprints});
        if(!receipt.partialScanVersion||(receipt.outcome==='complete')!==finalBatch)throw Error('Unexpected acquisition outcome for a batch commit.');
        const priorItems=parseLibraryBackup({schemaVersion:1,items:base.fanaticalLibraryItems}),priorById=new Map(priorItems.map(item=>[item.sourceItemId,item]));
        const additions=receipt.items.map(item=>{
          const previous=priorById.get(item.sourceItemId);if(!previous)return item;
          const origins=new Map((previous.purchaseOrigins??[]).map(origin=>[JSON.stringify([origin.purchaseRef,origin.bundle?.sourceItemId]),origin]));
          return {...previous,...item,externalIds:{...previous.externalIds,...item.externalIds},purchaseDate:item.purchaseDate??previous.purchaseDate,
            purchaseOrigins:item.purchaseOrigins.map(origin=>{const old=origins.get(JSON.stringify([origin.purchaseRef,origin.bundle?.sourceItemId]));return {...old,...origin,purchaseDate:origin.purchaseDate??old?.purchaseDate??null};})};
        });
        const merged=mergeLibraryItems([...priorItems,...additions]);
        const fingerprints=new Set(validFingerprints(base.fanaticalScannedOrderFingerprints)?base.fanaticalScannedOrderFingerprints:[]);
        for(const fp of [...receipt.unresolvedOrderFingerprints,...receipt.ineligibleOrderFingerprints])fingerprints.delete(fp);
        for(const fp of receipt.verifiedOrderFingerprints)fingerprints.add(fp);
        if(fingerprints.size>100000)throw Error('Saved scan history reached its safety limit.');
        const attempt={status:'partial',acquisitionComplete:receipt.acquisitionComplete,partialCheckpointVersion:1,outcome:receipt.outcome,scanMode:control.fullScan?'full':'quick',attemptedAt:new Date().toISOString(),discoveryComplete:receipt.coverage.discoveryComplete,completeCheckpointAdvanced:false,verifiedPurchasesSaved:receipt.verifiedOrderFingerprints.length,unresolvedOrders:receipt.unresolvedOrderFingerprints.length,unidentifiedRecords:receipt.unidentifiedRecords,failures:receipt.failures,pagesProcessed:receipt.coverage.pagesFetched};
        if(!finalBatch&&!partialAttemptIsValid(attempt))throw Error('Invalid partial scan checkpoint.');
        const existingIds=new Set(base.fanaticalLibraryItems.map(item=>item.sourceItemId));
        partialSummary={...attempt,ordersScanned:receipt.ordersScanned,ordersAvailable:receipt.ordersAvailable,ordersSkipped:receipt.orderFingerprints.length-receipt.ordersScanned,addedProducts:receipt.items.filter(i=>!existingIds.has(i.sourceItemId)).length,ownedLeafProducts:merged.length,coverage:receipt.coverage};
        updates={fanaticalLibraryItems:merged,fanaticalScannedOrderFingerprints:[...fingerprints].sort(),fanaticalImportSummary:base.fanaticalImportSummary,fanaticalLastScanAttempt:finalBatch?base.fanaticalLastScanAttempt:attempt};
      }
      if(!partial&&control.fullScan&&updates.fanaticalImportSummary?.scanMode!=='full')throw new Error('This profile requires a full scan.');
      const parsedIncoming=parseLibraryBackup({schemaVersion:1,items:updates.fanaticalLibraryItems});
      const overrides = state.mediaTypeOverrides ?? {};
      const reviewItems=control.changing?[]:[...state.fanaticalHistoricalItems.filter(h=>h.profileLabel===state.fanaticalProfileLabel).map(h=>h.item),...state.fanaticalLibraryItems];
      const withReviews=retainKeyReviews(parsedIncoming,reviewItems);
      const incoming = withReviews.map(item => {
        const override = overrides[item.sourceItemId] || (item.title && overrides[`manual:${globalThis.FanaticalLibrary.titleKey(item.title)}`]);
        if (override) {
          return { ...item, mediaType: override, manualMediaType: override, automaticMediaType: item.automaticMediaType || item.mediaType || 'unclassified' };
        }
        return item;
      });
      const prevRejected = state.rejectedPurchaseItems ?? [];
      const nextRejected = [...prevRejected];
      for (const rej of updates.rejectedPurchaseItems || []) {
        if (!nextRejected.some(r => r.sourceItemId === rej.sourceItemId || (r.title === rej.title && r.bundle?.sourceItemId === rej.bundle?.sourceItemId))) {
          nextRejected.push(rej);
        }
      }
      const now=new Date().toISOString(),sameProfile=state.fanaticalProfileLabel===control.label;
      const history=new Map((sameProfile?parseHistoricalItems(state.fanaticalHistoricalItems,control.label):[]).map(entry=>[entry.item.sourceItemId,entry]));
      if(control.changing){const prior=archive(state);for(let n=archives.length-1;n>=0;n--)if(archives[n].profileLabel===prior.profileLabel||archives[n].profileLabel===control.label)archives.splice(n,1);archives.push(prior);if(archives.length>100)throw new Error('Too many archived profiles; export a backup first.');}
      const observed=new Set(incoming.map(item=>item.sourceItemId));
      if(!partial&&sameProfile&&updates.fanaticalImportSummary?.coverage?.paginationEvidence==='array-only'){
        if(control.fullScan&&state.fanaticalLibraryItems.some(item=>!observed.has(item.sourceItemId)))throw Error('A headerless acquisition cannot replace earlier purchases.');
        // Keep independently enumerated coverage when the latest acquisition
        // cannot establish it. Per-order skip evidence still advances below.
        const prior=state.fanaticalImportSummary;
        if(prior?.coverage?.complete===true&&['count','range','link'].includes(prior.coverage.paginationEvidence))updates={...updates,fanaticalImportSummary:prior};
      }
      // Only a successful complete scan of the same confirmed profile infers
      // absence. Headerless acquisitions, Quick scans, failures, and switches
      // cannot retire its items.
      if(!partial&&control.fullScan&&sameProfile)for(const item of parseLibraryBackup({schemaVersion:1,items:state.fanaticalLibraryItems})) {
        if(!observed.has(item.sourceItemId)&&!history.has(item.sourceItemId))history.set(item.sourceItemId,{profileLabel:control.label,missingSince:now,item});
      }
      if(!partial)for(const id of observed)history.delete(id);
      const accountId=control.changing?crypto.randomUUID():state.fanaticalAccountId;
      let navigationPatch={};
      if (navigation?.length && accountId) {
        const {fanaticalOrderNavigation:saved}=await area.get({fanaticalOrderNavigation:{}});
        const previous=saved[accountId]??{};
        const refs=savedOrderReferences(incoming);
        const additions=navigation.filter(([ref,id])=>refs.has(ref)&&previous[ref]!==id);
        if (additions.length) navigationPatch={fanaticalOrderNavigation:{...saved,[accountId]:{...previous,...Object.fromEntries(additions)}}};
      }
      await area.set({...updates,...navigationPatch,fanaticalAccountId:accountId,fanaticalLibraryItems:incoming,fanaticalHistoricalItems:[...history.values()],fanaticalProfileLabel:control.label,fanaticalProfileArchives:archives,rejectedPurchaseItems:nextRejected,[key]:partial&&stageBatch?control:null});return partial?partialSummary:true;
    }
    if(operation==='backup'){
      const state=await area.get({...defaults,fanaticalImportSummary:null,fanaticalWishlistItems:[]});return createLibraryBackup(state.fanaticalLibraryItems,state.fanaticalImportSummary,undefined,state.fanaticalProfileLabel,state.fanaticalProfileArchives,state.fanaticalWishlistItems,state.fanaticalHistoricalItems,state.mediaTypeOverrides,state.rejectedPurchaseItems,state.fanaticalAccountId);
    }
    if(operation==='wishlist'){
      const [action,value]=args,F=globalThis.FanaticalLibrary,stored=await area.get({fanaticalWishlistItems:[]}),current=F.normalizeWishlist(stored.fanaticalWishlistItems);if(!['add','remove','replace'].includes(action))throw Error('Unsupported wishlist action.');
      const next=action==='remove'?current.filter(item=>F.wishlistKey(item)!==value):F.normalizeWishlist(action==='add'?[...current,...F.normalizeWishlist(value)]:value);await area.set({fanaticalWishlistItems:next});return next;
    }
    if(operation==='restore'){
      const backup=args[0];const items=parseLibraryBackup(backup),current=await area.get({...defaults,fanaticalWishlistItems:[]});
      const replacement=await GalacticPurchaseSync.restoredAccounts('fan',mergeRestoreState(current,backupRestoreState(items,backup)));
      const profiles=[[replacement.fanaticalAccountId,replacement.fanaticalLibraryItems],...replacement.fanaticalProfileArchives.map(a=>[a.accountId,a.items])];
      const retirement=await GalacticPurchaseSync.restorationPatch(area,{fanatical:profiles.map(([id])=>id)});
      const {fanaticalOrderNavigation:saved}=await area.get({fanaticalOrderNavigation:{}});
      const navigation=Object.fromEntries(profiles.filter(([id])=>saved[id]).map(([id,rows])=>{
        const refs=savedOrderReferences(rows);
        return [id,Object.fromEntries(Object.entries(saved[id]).filter(([ref])=>refs.has(ref)))];
      }));
      await removeFullScanPass(area);await area.set({galacticPurchaseAccountIds:{},...retirement.patch,...replacement,...(Object.keys(saved).length?{fanaticalOrderNavigation:navigation}:{}),[key]:null});Promise.resolve().then(()=>onInvalidated(retirement.retired)).catch(()=>{});return true;
    }
    if(operation==='clear'){
      const retirement=await GalacticPurchaseSync.retirementPatch(area);
      await removeFullScanPass(area);
      await area.remove(['galacticPurchaseAccountIds','galacticPurchaseSync',...Object.keys(defaults),'fanaticalImportSummary','fanaticalLastScanAttempt','fanaticalOrderNavigation',key]);Promise.resolve().then(()=>onInvalidated(retirement.retired)).catch(()=>{});return true;
    }
    if (operation === 'setMediaOverride') {
      const [targetItem, targetKind] = args;
      const validKinds = new Set(['game', 'book', 'comic', 'audiobook', 'software', 'audio', 'video', 'elearning', 'unclassified', 'other']);
      if (!validKinds.has(targetKind)) throw new Error('Unsupported media type override.');
      const state = await area.get(defaults);
      const overrideKey = globalThis.FanaticalLibrary.mediaOverrideKey(targetItem);
      if (!overrideKey) throw new Error('Cannot determine media override key.');
      const overrides = { ...(state.mediaTypeOverrides ?? {}), [overrideKey]: targetKind };
      const matchItem = it => (it.sourceItemId && targetItem.sourceItemId && it.sourceItemId === targetItem.sourceItemId)
        || (targetItem.sourceItemId && it.sourceItemId === targetItem.sourceItemId)
        || (globalThis.FanaticalLibrary.titleKey(it.title) === globalThis.FanaticalLibrary.titleKey(targetItem.title));
      const updateItem = it => {
        if (!matchItem(it)) return it;
        const automaticMediaType = it.automaticMediaType || it.mediaType || 'unclassified';
        return { ...it, mediaType: targetKind, automaticMediaType, manualMediaType: targetKind };
      };
      const items = (state.fanaticalLibraryItems ?? []).map(updateItem);
      await area.set({ mediaTypeOverrides: overrides, fanaticalLibraryItems: items });
      return true;
    }
    if (operation === 'resetMediaOverride') {
      const [targetItem] = args;
      const state = await area.get(defaults);
      const overrideKey = globalThis.FanaticalLibrary.mediaOverrideKey(targetItem);
      const overrides = { ...(state.mediaTypeOverrides ?? {}) };
      if (overrideKey) delete overrides[overrideKey];
      if (targetItem.sourceItemId) delete overrides[targetItem.sourceItemId];
      const matchItem = it => (it.sourceItemId && targetItem.sourceItemId && it.sourceItemId === targetItem.sourceItemId)
        || (globalThis.FanaticalLibrary.titleKey(it.title) === globalThis.FanaticalLibrary.titleKey(targetItem.title));
      const resetItem = it => {
        if (!matchItem(it)) return it;
        const automaticMediaType = it.automaticMediaType || 'unclassified';
        const { manualMediaType, ...rest } = it;
        return { ...rest, mediaType: automaticMediaType, automaticMediaType };
      };
      const items = (state.fanaticalLibraryItems ?? []).map(resetItem);
      await area.set({ mediaTypeOverrides: overrides, fanaticalLibraryItems: items });
      return true;
    }
    if (operation === 'recoverRejectedItem') {
      const [rejectedRecord, targetKind] = args;
      const validKinds = new Set(['game', 'book', 'comic', 'audiobook', 'software', 'audio', 'video', 'elearning', 'unclassified', 'other']);
      if (!validKinds.has(targetKind)) throw new Error('Unsupported media type.');
      const state = await area.get(defaults);
      const rejected = (state.rejectedPurchaseItems ?? []).filter(r => !(r.sourceItemId === rejectedRecord.sourceItemId || (r.title === rejectedRecord.title && r.bundle?.sourceItemId === rejectedRecord.bundle?.sourceItemId)));
      const sourceItemId = rejectedRecord.sourceItemId && !rejectedRecord.sourceItemId.startsWith('fan_rej_')
        ? rejectedRecord.sourceItemId
        : `recovered_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newItem = {
        source: 'fanatical',
        sourceItemId,
        title: rejectedRecord.title,
        mediaType: targetKind,
        automaticMediaType: 'unclassified',
        manualMediaType: targetKind,
        bundle: rejectedRecord.bundle || { sourceItemId: '', title: rejectedRecord.sourceBundle || '' },
        purchaseDate: rejectedRecord.purchaseDate || null,
        ...(rejectedRecord.delivery ? { delivery: rejectedRecord.delivery } : {}),
        ...(Array.isArray(rejectedRecord.formats) && rejectedRecord.formats.length ? { formats: rejectedRecord.formats } : {}),
        purchaseOrigins: rejectedRecord.purchaseOrigins || [{
          bundle: rejectedRecord.bundle || { sourceItemId: '', title: rejectedRecord.sourceBundle || '' },
          purchaseDate: rejectedRecord.purchaseDate || null,
          quantity: 1
        }]
      };
      const existing = state.fanaticalLibraryItems ?? [];
      const updated = sanitizeImportResult({ items: [...existing, newItem] }).items;
      const overrides = { ...(state.mediaTypeOverrides ?? {}), [sourceItemId]: targetKind };
      await area.set({ rejectedPurchaseItems: rejected, fanaticalLibraryItems: updated, mediaTypeOverrides: overrides });
      return true;
    }
    if (operation === 'dismissRejectedItem') {
      const [recordOrAll] = args;
      const state = await area.get(defaults);
      let rejected = [];
      if (recordOrAll !== 'all') {
        rejected = (state.rejectedPurchaseItems ?? []).filter(r => !(r.sourceItemId === recordOrAll.sourceItemId || (r.title === recordOrAll.title && r.bundle?.sourceItemId === recordOrAll.bundle?.sourceItemId)));
      }
      await area.set({ rejectedPurchaseItems: rejected });
      return true;
    }
    if(operation==='patch'){
      const updates=args[0];if(!updates||Object.keys(updates).some(name=>!['galacticLibraryExtensionId','fanaticalShowDiagnostics','fanaticalShowNewItemsOnly','fanaticalCatalogueFilters','fanaticalSummaryPreferences','galacticHamsterAppearance'].includes(name)))throw new Error('Unsupported settings patch.');
      if(Object.hasOwn(updates,'galacticHamsterAppearance'))globalThis.GalacticHamsterTheme.validatePreferences(updates.galacticHamsterAppearance);
      if(Object.hasOwn(updates,'fanaticalSummaryPreferences')){const F=globalThis.FanaticalLibrary;F.normalizeSummaryPreferences(updates.fanaticalSummaryPreferences,true);const current=await area.get({fanaticalSummaryPreferences:{}});updates.fanaticalSummaryPreferences=F.normalizeSummaryPreferences({...F.normalizeSummaryPreferences(current.fanaticalSummaryPreferences),...updates.fanaticalSummaryPreferences},true);}
      await area.set(updates);return true;
    }
    if(operation==='unlink'){await area.remove('galacticLibraryExtensionId');return true;}
    throw new Error('Unsupported storage operation.');
  }
  return {execute(operation,args=[]){const captured=structuredClone(args);const task=tail.then(()=>operate(operation,captured));tail=task.catch(()=>{});return task;}};
}

/** Portable catalog metadata deliberately excludes purchase/ownership evidence. */
/**
 * Spreadsheet catalog: the same title rows as the Library page, with the purchase count and dates the
 * Library and bundle badges use (FanaticalLibrary.purchaseList). Columns match Humble Library's CSV.
 * Activation on Steam or another store is not known from Fanatical purchases and is not exported.
 */
export function createTitleCatalogCsv(rows){
  const F=globalThis.FanaticalLibrary,catalog=createTitleCatalog(rows);
  const cell=value=>{let text=String(value??'');if(/^[=+@\-\t\r]/u.test(text))text="'"+text;return '"'+text.replace(/"/gu,'""')+'"';};
  // Calendar days as the Library shows them (FanaticalLibrary.calendarDay); never inferred.
  const time=value=>typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  const day=value=>globalThis.FanaticalLibrary.calendarDay(value);
  const out=[['Title','Media type','Purchase status','First purchased','Last purchased','Purchase count','Purchase count confidence','Source','Bundle / purchase name','Purchase dates']];
  catalog.items.forEach((item,index)=>{
    const row=rows[index],{purchases:list,exact}=F.purchaseList(typeof row==='object'?[row]:[]),purchased=list.length>0;
    const purchases=list.map(p=>({name:String(p.name??'').trim(),time:time(p.date),date:day(p.date)})).sort((a,b)=>{const x=Number.isFinite(a.time),y=Number.isFinite(b.time);return x&&y?a.time-b.time:x?-1:y?1:0;});
    const dated=purchases.filter(p=>p.date),media=item.mediaType==='book'&&typeof row==='object'&&F.isComicItem?.(row)?'comic':item.mediaType;
    out.push([item.title,media,purchased?'Purchased':'Not recorded as a purchase',dated[0]?.date??'',dated.at(-1)?.date??'',purchases.length,purchased?(exact?'Exact':'At least'):'',purchased?'Fanatical purchase':'Added manually',purchases.map(p=>p.name).join('; '),purchases.map(p=>p.date||'unknown').join('; ')]);
  });
  return '\uFEFF'+out.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

export function createTitleCatalog(items){
  return {format:'fanatical-title-catalog',version:1,items:sanitizeImportResult({items}).items.map(item=>({title:item.title,mediaType:item.mediaType,...(item.externalIds?{externalIds:item.externalIds}:{}),...globalThis.FanaticalLibrary.bibliographicFields(item)}))};
}
