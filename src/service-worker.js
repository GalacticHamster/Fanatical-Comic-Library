// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Galactic Hamster
/* Chrome MV3 entry point. The only main-world execution is the strict importer. */
import { safeId, validateScanResult, createSyncStore, mergeLibraryItems } from './library-data.mjs';
import './theme.js';
import './purchase-transfer.js';

import {importFanaticalOrdersInPage} from './order-importer.mjs';

const syncStore=createSyncStore(chrome.storage.local,{onInvalidated:events=>purchaseSync.notifyInvalidated(events)});
const appearanceService=GalacticHamsterTheme.createService({runtime:chrome.runtime,companion:true,
  read:async()=>{const value=await chrome.storage.local.get({galacticHamsterAppearance:null});return value.galacticHamsterAppearance;},
  save:prefs=>syncStore.execute('patch',[{galacticHamsterAppearance:prefs}]),
  resolveId:async()=>{const value=await chrome.storage.local.get({galacticLibraryExtensionId:''});return globalThis.FanaticalLibrary.resolveGalacticId(value.galacticLibraryExtensionId,chrome.runtime);}});
GalacticHamsterTheme.register(appearanceService,chrome.runtime);
const STORAGE_ITEMS = 'fanaticalLibraryItems';
const STORAGE_SUMMARY = 'fanaticalImportSummary';
const STORAGE_ORDER_FINGERPRINTS = 'fanaticalScannedOrderFingerprints';

// Inbound status/review only. No external library, storage or importer endpoint.
chrome.runtime.onMessageExternal?.addListener((message,sender,respond)=>{
  if(!['PING','GET_STATUS','OPEN_REVIEW'].includes(message?.type))return false;
  (async()=>{
    const F=globalThis.FanaticalLibrary,stored=await chrome.storage.local.get({galacticLibraryExtensionId:''});
    if(!F.trustedGalacticSender(sender?.id,stored.galacticLibraryExtensionId,chrome.runtime))return {ok:false,error:'Companion is not allowed.'};
    if(message.apiVersion!==1&&!(message.apiVersion===undefined&&['PING','GET_STATUS'].includes(message.type)))return {ok:false,error:'Unsupported companion API version.'};
    if(message.type==='OPEN_REVIEW')await chrome.runtime.openOptionsPage();
    return {ok:true,apiVersion:1,appVersion:chrome.runtime.getManifest?.().version??'1.0.3',ready:true,purchaseProvider:'fanatical',capabilities:{centralReview:true}};
  })().then(respond,()=>respond({ok:false,error:'Companion request unavailable.'}));return true;
});

/* This function is serialized by chrome.scripting and runs only in Fanatical's
 * MAIN world. Its return value is an explicit ownership DTO, never raw JSON. */

async function activeFanaticalTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https:\/\/www\.fanatical\.com\//u.test(tab.url ?? '')) throw new Error('Open a Fanatical page before importing purchases.');
  return tab;
}

const SCAN_FAILURES = Object.freeze({
  'discovery-unverified':'The purchase response supplied no independent end-of-history evidence.',
  'account-scope-conflict':'This listing does not match saved purchase evidence. Check the signed-in account and use Saved accounts before importing. No purchases from this scan were saved.',
  'account-attribution-required':'Open Advanced accounts and confirm that the signed-in account matches this saved library, then retry. Older saved records provide no order identity for an automatic account check.',
  'order-identity-conflict':'A purchase response belonged to a different order. No purchases from this scan were saved.',
  'request-aborted':'The scan stopped after a failed request. Export the scan report.',
  'retry-later':'Fanatical requested a longer retry delay. Please try scanning again later.',
  'request-exhausted':'An order request failed after three attempts. Please try again later.',
  'pagination-unsafe':'Fanatical returned an unsupported pagination link. Export the scan report.',
  'pagination-ambiguous':'Fanatical returned ambiguous next/last pagination links. Export the scan report.',
  'pagination-total':'Fanatical returned changing or inconsistent purchase-list totals. Export the scan report.',
  'pagination-repeated':'Fanatical repeated a purchase-list page. Export the scan report.',
  'page-limit':'The 1,000-page safety limit was reached. Export the scan report.',
  'order-limit':'The 100,000-order safety limit was reached. Export the scan report.',
  'pagination-range':'Fanatical returned missing, overlapping or inconsistent page ranges. Export the scan report.',
  'pagination-order':'Fanatical returned an unreadable or repeated purchase in its list. Export the scan report.',
  'pagination-last':'Fanatical changed its advertised last page. Export the scan report.',
  'pagination-final':'Fanatical supplied a next page after an empty or final page. Export the scan report.',
  'authentication-missing':'Sign in on Fanatical, open Orders, then retry.',
  'authentication-rejected':'Fanatical rejected the session or denied access. Sign in on Fanatical, then retry.',
  'listing-unreadable':'Fanatical returned an unreadable purchase list. Export the scan report.',
  'listing-incomplete':'Fanatical purchase-list coverage could not be confirmed. Export the scan report, then retry later.',
  'pagination-missing-next':'Fanatical returned part of the history without a usable next-page link. Export the scan report.',
  'summaries-unreadable':'A listed purchase has an unreadable product structure. Export the scan report.',
  'summaries-incomplete':'Purchase-list validation could not finish. Export the scan report.',
  'details-unreadable':'A purchase detail was unreadable or did not match its listing. Export the scan report.',
  'details-incomplete':'A purchase-detail request could not finish. Export the scan report, then retry later.',
  'history-missing-known':'Fanatical order history omits previously scanned orders. Check the signed-in account and export the scan report.',
  'session-changed':'The signed-in Fanatical session changed during the scan. Start a fresh scan.',
  'page-exception':'The purchase scan stopped unexpectedly. Export the scan report.',
  'result-invalid':'The scan did not return a valid complete result. Export the scan report.',
  'injection-failed':'The purchase scan could not run on this page. Reload the signed-in Orders page and retry.',
  'save-failed':'The validated scan could not be saved. Your previous purchases were kept. Export the scan report.',
  'account-check-failed':'The local account could not be selected. Check Saved accounts and retry.'
});
function scanReport({code,diagnostic={},requestedFull=false,actualFull=null,storageAdmission='not-reached',localAccountConfirmed=false,outcome=code==='complete'?'complete':'unsafe',verifiedPurchasesSaved=0,verifiedProductRecordsSaved=0,unresolvedOrders=0,failures=[],acquisitionComplete=false}={}) {
  code=Object.hasOwn(SCAN_FAILURES,code)||code==='complete'?code:'page-exception';
  const count=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
  const version=chrome.runtime.getManifest?.().version;
  return {format:1,provider:'fanatical',extensionVersion:/^\d+(?:\.\d+){1,3}$/u.test(version??'')?version:'unknown',
    browserFamily:chrome.runtime.getURL('').startsWith('moz-extension://')?'firefox':'chromium',
    requestedOperation:requestedFull?'full':'quick',selectedMode:actualFull===null?'unknown':actualFull?'full':'quick',
    code,stage:['authentication','listing','summaries','details','session','validation','injection','storage','account','complete'].includes(diagnostic.stage)?diagnostic.stage:'unknown',
    pagesAttempted:count(diagnostic.pagesAttempted,1000),pagesParsed:count(diagnostic.pagesParsed,1000),
    purchaseRecordsRecognized:count(diagnostic.ordersRecognized,100000),detailsParsed:count(diagnostic.detailsParsed,100000),retries:count(diagnostic.retries,300000),
    terminalReached:diagnostic.terminalReached===true,terminalVerified:diagnostic.terminalReached===true&&['link','count','range'].includes(diagnostic.paginationEvidence),
    paginationEvidence:['link','count','range','array-only'].includes(diagnostic.paginationEvidence)?diagnostic.paginationEvidence:'unknown',
    accountAffinity:['saved-order-match','declared-scope'].includes(diagnostic.accountAffinity)?diagnostic.accountAffinity:'unknown',
    authentication:['token-present','accepted-response','rejected'].includes(diagnostic.authentication)?diagnostic.authentication:'unknown',sourceAccountVerified:false,
    httpStatus:count(diagnostic.httpStatus,599)>=100?diagnostic.httpStatus:null,localAccountConfirmed:localAccountConfirmed===true,
    storageAdmission:['not-reached','attempted','committed'].includes(storageAdmission)?storageAdmission:'not-reached',previousLibraryPreserved:code==='complete'?null:true,
    acquisitionComplete:storageAdmission==='committed'&&(outcome==='complete'||acquisitionComplete===true),
    listingEvidence:diagnostic.listingEvidence&&typeof diagnostic.listingEvidence==='object'?Object.fromEntries(['arrayPages','objectPages','otherPages','headersReadablePages','linkHeaderPages','totalCountHeaderPages','contentRangeHeaderPages','nextReferencePages'].map(k=>[k,count(diagnostic.listingEvidence[k],1000)])):null,
    outcome:['complete','partial-extraction','partial-discovery','unsafe'].includes(outcome)?outcome:'unsafe',verifiedPurchasesSaved:count(verifiedPurchasesSaved,100000),verifiedProductRecordsSaved:count(verifiedProductRecordsSaved,500000),unresolvedOrders:count(unresolvedOrders,100000),discoveryComplete:diagnostic.terminalReached===true&&['link','count','range'].includes(diagnostic.paginationEvidence),completeCheckpointAdvanced:outcome==='complete'&&storageAdmission==='committed',retryEligible:outcome==='partial-extraction'||outcome==='partial-discovery',
    failures:Array.isArray(failures)?failures.filter(f=>Object.hasOwn(SCAN_FAILURES,f?.code)&&['listing','summaries','details'].includes(f.stage)&&count(f.count,100000)>0).slice(0,32).map(({code,stage,count})=>({code,stage,count})):[]};
}

async function importPurchases({ fullScan = false, profileLabel='', confirmed=false, switchProfile=false, progressId='', useSavedAccount=false, tab:requestedTab } = {}) {
  const requestedFull=fullScan;
  const tab=requestedTab??await activeFanaticalTab();
  const progressPhase=phase=>{
    if(!/^[a-f0-9]{32}$/u.test(progressId))return;
    try{void chrome.tabs.sendMessage(tab.id,{type:'FANATICAL_IMPORT_STATUS',progressId,phase}).catch(()=>{});}catch{/* Optional, same-extension UI only. */}
  };
  const account=useSavedAccount?(await syncStore.execute('syncAccounts'))[0]:null;
  const scan=await syncStore.execute('begin',[{fullScan,profileLabel:useSavedAccount?account?.label??'':profileLabel,confirmed,switchProfile,...(account?{reuseAccount:true,accountId:account.stableId}:{})},tab.id]);
  fullScan=fullScan||scan.forceFull;const stored=scan.state;
  let stage='injection',pageDiagnostic={};
  try {
  const knownOrderFingerprints = Array.isArray(stored[STORAGE_ORDER_FINGERPRINTS]) ? stored[STORAGE_ORDER_FINGERPRINTS] : [];
  const scanHistoryMissing = !fullScan && knownOrderFingerprints.length === 0 && (stored[STORAGE_ITEMS]?.length ?? 0) > 0;
  const accountOrderFingerprints=[...new Set([...knownOrderFingerprints,...[...(stored[STORAGE_ITEMS]??[]),...(stored.fanaticalHistoricalItems??[]).map(entry=>entry.item)].flatMap(item=>(item?.purchaseOrigins??[]).map(origin=>origin.purchaseRef))].filter(fp=>typeof fp==='string'&&/^[a-f0-9]{64}$/u.test(fp)))].slice(0,100000);
  if(!accountOrderFingerprints.length&&((stored[STORAGE_ITEMS]?.length??0)+(stored.fanaticalHistoricalItems?.length??0)>0)&&!confirmed){
    throw Object.assign(new Error(SCAN_FAILURES['account-attribution-required']),{scanDiagnostic:scanReport({code:'account-attribution-required',diagnostic:{stage:'account'},requestedFull,actualFull:fullScan,localAccountConfirmed:true})});
  }
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN', func: importFanaticalOrdersInPage,
    args: [{ fullScan, knownOrderFingerprints, scanHistoryMissing, returnFailure:true,allowPartial:true,accountOrderFingerprints,progressId:/^[a-f0-9]{32}$/u.test(progressId)?progressId:'' }]
  });
  stage='validation';
  progressPhase('validation');
  if (!Array.isArray(result) || result.length !== 1) throw new Error('Fanatical scan did not return a complete result. Your library was not changed.');
  if(result[0]?.result?.fanaticalImportFailure===1){
    const envelope=result[0].result;
    const report=scanReport({code:Object.hasOwn(SCAN_FAILURES,envelope.code)?envelope.code:'page-exception',diagnostic:envelope.diagnostic,requestedFull,actualFull:fullScan,localAccountConfirmed:true});
    throw Object.assign(new Error('Fanatical scan incomplete. '+SCAN_FAILURES[report.code]+' Your library and scan history were not changed.'),{scanDiagnostic:report});
  }
  const projected = validateScanResult(result[0]?.result, { fullScan, knownOrderFingerprints });
  if(projected.partialScanVersion&&projected.outcome!=='complete'){
    pageDiagnostic={listingEvidence:projected.coverage.listingEvidence,accountAffinity:projected.coverage.accountAffinity,stage:projected.failures[0].stage,pagesAttempted:projected.coverage.pagesFetched,pagesParsed:projected.coverage.pagesParsed,ordersRecognized:projected.coverage.listedOrders,detailsParsed:projected.ordersScanned,retries:projected.coverage.retries,terminalReached:projected.coverage.discoveryComplete,paginationEvidence:projected.coverage.paginationEvidence,authentication:'accepted-response'};
    stage='storage';
    progressPhase('saving');
    const partial=await syncStore.execute('commitPartial',[scan.token,projected,tab.id]);
    return {...partial,failureExplanation:SCAN_FAILURES[projected.failures[0].code],scanDiagnostic:scanReport({code:projected.failures[0].code,diagnostic:pageDiagnostic,requestedFull,actualFull:fullScan,localAccountConfirmed:true,storageAdmission:'committed',outcome:partial.outcome,verifiedPurchasesSaved:partial.verifiedPurchasesSaved,verifiedProductRecordsSaved:projected.items.length,unresolvedOrders:partial.unresolvedOrders,failures:projected.failures,acquisitionComplete:partial.acquisitionComplete})};
  }
  pageDiagnostic={listingEvidence:projected.coverage.listingEvidence,accountAffinity:projected.coverage.accountAffinity,stage:'storage',pagesAttempted:projected.coverage.pagesFetched,pagesParsed:projected.coverage.pagesFetched,ordersRecognized:projected.coverage.listedOrders,detailsParsed:projected.ordersScanned,retries:projected.coverage.retries,terminalReached:true,paginationEvidence:projected.coverage.paginationEvidence,authentication:'accepted-response'};
  const existing = new Map((Array.isArray(stored[STORAGE_ITEMS]) ? stored[STORAGE_ITEMS] : []).filter((item) => safeId(item?.sourceItemId)).map((item) => [item.sourceItemId, item]));
  const addedProducts = projected.items.filter((item) => !existing.has(item.sourceItemId)).length;
  const merged = fullScan ? new Map() : existing;
  for (const item of projected.items) {const previous=merged.get(item.sourceItemId);merged.set(item.sourceItemId,previous?mergeLibraryItems([previous,item])[0]:item);}
  const importedAt = new Date().toISOString();
  const summary = {
    importedAt,
    scanMode: fullScan ? 'full' : 'quick',
    scanHistoryMissing,
    ordersScanned: projected.ordersScanned,
    ordersAvailable: projected.ordersAvailable,
    ordersSkipped: Math.max(0, projected.ordersAvailable - projected.ordersScanned),
    addedProducts,
    ownedLeafProducts: merged.size,
    historyCoverage: `${projected.coverage.emptyAccount ? 'Valid empty order history.' : `Validated ${projected.coverage.listedOrders} listed orders across ${projected.coverage.pagesFetched} page(s) and ${projected.ordersScanned} requested completed-order details.`} ${projected.coverage.paginationEvidence === 'array-only' ? 'No pagination metadata: silent server truncation cannot be independently ruled out.' : projected.coverage.expectedTotal !== null ? 'All pages agree with the reported history total.' : 'Followed the next-page chain to its end; no independent history total was supplied.'}`,
    coverage: projected.coverage
  };
  stage='storage';
  progressPhase('saving');
  await syncStore.execute('commit',[scan.token,{
    [STORAGE_ITEMS]: [...merged.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)),
    [STORAGE_ORDER_FINGERPRINTS]: projected.orderFingerprints,
    [STORAGE_SUMMARY]: summary,
    fanaticalLastScanAttempt: { status: 'complete', scanMode: summary.scanMode, attemptedAt: importedAt }
  },tab.id]);
  return {...summary,...(projected.partialScanVersion?{acquisitionComplete:true,outcome:'complete',verifiedPurchasesSaved:projected.ordersScanned,unresolvedOrders:0,completeCheckpointAdvanced:true}:{}),scanDiagnostic:scanReport({code:'complete',diagnostic:{...pageDiagnostic,stage:'complete'},requestedFull,actualFull:fullScan,localAccountConfirmed:true,storageAdmission:'committed',verifiedPurchasesSaved:projected.ordersScanned,verifiedProductRecordsSaved:projected.items.length})};
  }catch(error){
    error.scanDiagnostic??=scanReport({code:stage==='storage'?'save-failed':stage==='validation'?'result-invalid':'injection-failed',diagnostic:{...pageDiagnostic,stage},requestedFull,actualFull:fullScan,localAccountConfirmed:true,storageAdmission:stage==='storage'?'attempted':'not-reached'});
    error.scanToken=scan.token;error.scanTabId=tab.id;throw error;
  }
}

/* Public endpoint fetches also run as Fanatical-page requests. This avoids
 * site/WAF differences between a content-script fetch and the page's SPA
 * fetches. Unlike the importer, this endpoint requires no token. */
async function fetchPublicBundleInPage(path) {
  const response = await fetch(path, { method: 'GET', credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error('Fanatical bundle data is unavailable.');
  return response.json();
}

function isPublicBundlePath(path) {
  return /^\/api\/(?:products-group|pick-and-mix)\/[a-z0-9-]+\/en$/iu.test(String(path ?? ''));
}

async function fetchPublicBundle(path) {
  if (!isPublicBundlePath(path)) throw new Error('Unsupported Fanatical bundle endpoint.');
  const tab = await activeFanaticalTab();
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: fetchPublicBundleInPage, args: [path] });
  if (!result?.[0]?.result || typeof result[0].result !== 'object') throw new Error('Fanatical bundle data is unavailable.');
  return result[0].result;
}

let purchaseScan = null;
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FANATICAL_OPEN_GALACTIC_REVIEW') {
    if (!chrome.runtime.id || _sender?.id !== chrome.runtime.id) { sendResponse({ ok: false, error: 'Untrusted review request.' }); return false; }
    chrome.storage.local.get({ galacticLibraryExtensionId: '' }).then(async stored => {
      const F=globalThis.FanaticalLibrary,id=F.resolveGalacticId(stored.galacticLibraryExtensionId,chrome.runtime);
      if(F.isExtensionId(id)&&!/^[a-p]{32}$/u.test(id)){
        try{await F.companionCall(message=>chrome.runtime.sendMessage(id,message),{type:'OPEN_REVIEW',apiVersion:1});sendResponse({ok:true});return;}catch{sendResponse({ok:false,error:'In Firefox, open Galactic Library from its toolbar icon. Check the pairing and update Galactic Library to enable central review.'});return;}
      }
      const url = globalThis.FanaticalLibrary.centralReviewUrl(id);
      if (!url) { sendResponse({ ok: false, error: 'Open Galactic Library from its toolbar icon and choose Manage library to review ownership and contents.' }); return; }
      await chrome.tabs.create({ url }); sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false, error: 'Open Galactic Library from its toolbar icon to review ownership and contents.' }));
    return true;
  }
  if(message?.type==='FANATICAL_STORE'){
    const own=_sender?.id===chrome.runtime.id,url=String(_sender?.url??''),extensionPage=own&&url.startsWith(chrome.runtime.getURL(''));
    const fanaticalPage=own&&url.startsWith('https://www.fanatical.com/'),accountOperation=['profiles','selectProfile','renameProfile'].includes(message.operation);
    const ordersPage=fanaticalPage&&/^https:\/\/www\.fanatical\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?orders\/?(?:[?#]|$)/iu.test(url);
    if(!['restore','clear','patch','unlink','wishlist','backup','profiles','selectProfile','renameProfile','setMediaOverride','resetMediaOverride','recoverRejectedItem','dismissRejectedItem'].includes(message.operation)||!(extensionPage||fanaticalPage&&['patch','wishlist'].includes(message.operation)||accountOperation&&ordersPage)){sendResponse({ok:false,error:'Untrusted storage request.'});return false;}
    syncStore.execute(message.operation,message.args).then(result=>sendResponse({ok:true,result}),error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if (message?.type === 'FANATICAL_IMPORT_PURCHASES') {
    if(_sender?.id!==chrome.runtime.id||!/^https:\/\/www\.fanatical\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?orders\/?(?:[?#]|$)/iu.test(_sender?.url??'')||!_sender.tab?.id){sendResponse({ok:false,error:'Import from the signed-in Fanatical orders page.'});return false;}
    if (purchaseScan) { sendResponse({ ok: false, error: 'A Fanatical purchase scan is already running. Wait for it to finish.' }); return true; }
    purchaseScan = importPurchases({ fullScan: message.fullScan === true,profileLabel:message.profileLabel,confirmed:message.confirmed===true,switchProfile:message.switchProfile===true,progressId:message.progressId,useSavedAccount:message.useSavedAccount===true,tab:_sender.tab }).then((summary) => sendResponse({ ok: true, summary })).catch(async (error) => {
      // Persist only an explicit coverage failure flag, never page/transport errors.
      try { if(error.scanToken)await syncStore.execute('failure',[error.scanToken,null,error.scanTabId]); } catch { /* Keep the on-page warning even when storage is unavailable. */ }
      const report=error.scanDiagnostic??scanReport({code:'account-check-failed',diagnostic:{stage:'account'},requestedFull:message.fullScan===true});
      sendResponse({ ok: false, error: `Scan incomplete; previous purchases and successful scan history were kept. ${SCAN_FAILURES[report.code]}`,scanDiagnostic:report });
    }).finally(() => { purchaseScan = null; });
    return true;
  }
  if (message?.type === 'FANATICAL_GET_PUBLIC_BUNDLE') {
    fetchPublicBundle(message.path).then((bundle) => sendResponse({ ok: true, bundle })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Bundle data is unavailable.') }));
    return true;
  }
  return false;
});

const purchaseHandoff=GalacticPurchaseTransfer.createService({runtime:chrome.runtime,area:chrome.storage.local,
 authorize:async(id,provider)=>provider==='fanatical'&&FanaticalLibrary.trustedGalacticSender(id,(await chrome.storage.local.get({galacticLibraryExtensionId:''})).galacticLibraryExtensionId,chrome.runtime),
 peer:async provider=>{if(provider!=='fanatical')throw Error('Wrong provider.');return FanaticalLibrary.resolveGalacticId((await chrome.storage.local.get({galacticLibraryExtensionId:''})).galacticLibraryExtensionId,chrome.runtime);},
 accounts:()=>syncStore.execute('handoffAccounts'),snapshot:(_,ref)=>syncStore.execute('handoffSnapshot',[ref]),preview:(data,target)=>syncStore.execute('handoffPreview',[data,target]),commit:(data,target)=>syncStore.execute('handoffImport',[data,target])});
purchaseHandoff.register();

const purchaseSync=GalacticPurchaseSync.createCoordinator({runtime:chrome.runtime,area:chrome.storage.local,alarms:chrome.alarms,service:purchaseHandoff,role:'fan',catalog:()=>syncStore.execute('syncAccounts'),busy:async()=>Boolean((await chrome.storage.local.get({fanaticalSyncControl:null})).fanaticalSyncControl)});
purchaseSync.register();
GalacticPurchaseSync.observeCompanion(chrome,purchaseSync,'fanatical',['fanaticalLibraryItems','fanaticalProfileArchives'], 'fanaticalSyncControl');
