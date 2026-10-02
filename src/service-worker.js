/* Chrome MV3 entry point. The only main-world execution is the strict importer. */
import { safeId, validateScanResult, createSyncStore, mergeLibraryItems } from './library-data.mjs';

import {importFanaticalOrdersInPage} from './order-importer.mjs';

const syncStore=createSyncStore(chrome.storage.local);
const STORAGE_ITEMS = 'fanaticalLibraryItems';
const STORAGE_SUMMARY = 'fanaticalImportSummary';
const STORAGE_ORDER_FINGERPRINTS = 'fanaticalScannedOrderFingerprints';

/* This function is serialized by chrome.scripting and runs only in Fanatical's
 * MAIN world. Its return value is an explicit ownership DTO, never raw JSON. */

async function activeFanaticalTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https:\/\/www\.fanatical\.com\//u.test(tab.url ?? '')) throw new Error('Open a Fanatical page before importing purchases.');
  return tab;
}

async function importPurchases({ fullScan = false, profileLabel='', confirmed=false, switchProfile=false, tab:requestedTab } = {}) {
  const tab=requestedTab??await activeFanaticalTab();
  const scan=await syncStore.execute('begin',[{fullScan,profileLabel,confirmed,switchProfile},tab.id]);
  fullScan=fullScan||scan.forceFull;const stored=scan.state;
  try {
  const knownOrderFingerprints = Array.isArray(stored[STORAGE_ORDER_FINGERPRINTS]) ? stored[STORAGE_ORDER_FINGERPRINTS] : [];
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN', func: importFanaticalOrdersInPage,
    args: [{ fullScan, knownOrderFingerprints }]
  });
  if (!Array.isArray(result) || result.length !== 1) throw new Error('Fanatical scan did not return a complete result. Your library was not changed.');
  const projected = validateScanResult(result[0]?.result, { fullScan, knownOrderFingerprints });
  const existing = new Map((Array.isArray(stored[STORAGE_ITEMS]) ? stored[STORAGE_ITEMS] : []).filter((item) => safeId(item?.sourceItemId)).map((item) => [item.sourceItemId, item]));
  const addedProducts = projected.items.filter((item) => !existing.has(item.sourceItemId)).length;
  const merged = fullScan ? new Map() : existing;
  for (const item of projected.items) {const previous=merged.get(item.sourceItemId);merged.set(item.sourceItemId,previous?mergeLibraryItems([previous,item])[0]:item);}
  const importedAt = new Date().toISOString();
  const summary = {
    importedAt,
    scanMode: fullScan ? 'full' : 'quick',
    ordersScanned: projected.ordersScanned,
    ordersAvailable: projected.ordersAvailable,
    ordersSkipped: Math.max(0, projected.ordersAvailable - projected.ordersScanned),
    addedProducts,
    ownedLeafProducts: merged.size,
    historyCoverage: `${projected.coverage.emptyAccount ? 'Valid empty order history.' : `Validated ${projected.coverage.listedOrders} listed orders across ${projected.coverage.pagesFetched} page(s) and ${projected.ordersScanned} requested completed-order details.`} ${projected.coverage.paginationEvidence === 'array-only' ? 'No pagination metadata: silent server truncation cannot be independently ruled out.' : projected.coverage.expectedTotal !== null ? 'All pages agree with the reported history total.' : 'Followed the next-page chain to its end; no independent history total was supplied.'}`,
    coverage: projected.coverage
  };
  await syncStore.execute('commit',[scan.token,{
    [STORAGE_ITEMS]: [...merged.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)),
    [STORAGE_ORDER_FINGERPRINTS]: projected.orderFingerprints,
    [STORAGE_SUMMARY]: summary,
    fanaticalLastScanAttempt: { status: 'complete', scanMode: summary.scanMode, attemptedAt: importedAt }
  },tab.id]);
  return summary;
  }catch(error){error.scanToken=scan.token;error.scanTabId=tab.id;throw error;}
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
      const url = globalThis.FanaticalLibrary.centralReviewUrl(stored.galacticLibraryExtensionId);
      if (!url) { sendResponse({ ok: false, error: 'Open Galactic Library from its toolbar icon and choose Manage library to review ownership and contents.' }); return; }
      await chrome.tabs.create({ url }); sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false, error: 'Open Galactic Library from its toolbar icon to review ownership and contents.' }));
    return true;
  }
  if(message?.type==='FANATICAL_STORE'){
    if(_sender?.id!==chrome.runtime.id||typeof _sender.url!=='string'||!(_sender.url.startsWith(chrome.runtime.getURL(''))||['patch','wishlist'].includes(message.operation)&&_sender.url.startsWith('https://www.fanatical.com/'))||!['restore','clear','patch','unlink','wishlist','backup'].includes(message.operation)){sendResponse({ok:false,error:'Untrusted storage request.'});return false;}
    syncStore.execute(message.operation,message.args).then(result=>sendResponse({ok:true,result}),error=>sendResponse({ok:false,error:error.message}));return true;
  }
  if (message?.type === 'FANATICAL_IMPORT_PURCHASES') {
    if(_sender?.id!==chrome.runtime.id||!/^https:\/\/www\.fanatical\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?orders\/?(?:[?#]|$)/iu.test(_sender?.url??'')||!_sender.tab?.id){sendResponse({ok:false,error:'Import from the signed-in Fanatical orders page.'});return false;}
    if (purchaseScan) { sendResponse({ ok: false, error: 'A Fanatical purchase scan is already running. Wait for it to finish.' }); return true; }
    purchaseScan = importPurchases({ fullScan: message.fullScan === true,profileLabel:message.profileLabel,confirmed:message.confirmed===true,switchProfile:message.switchProfile===true,tab:_sender.tab }).then((summary) => sendResponse({ ok: true, summary })).catch(async (error) => {
      // Persist only an explicit coverage failure flag, never page/transport errors.
      try { if(error.scanToken)await syncStore.execute('failure',[error.scanToken,null,error.scanTabId]); } catch { /* Keep the on-page warning even when storage is unavailable. */ }
      sendResponse({ ok: false, error: `Scan incomplete; previous purchases and successful scan history were kept. ${String(error?.message ?? 'Please try again.').slice(0, 500)}` });
    }).finally(() => { purchaseScan = null; });
    return true;
  }
  if (message?.type === 'FANATICAL_GET_PUBLIC_BUNDLE') {
    fetchPublicBundle(message.path).then((bundle) => sendResponse({ ok: true, bundle })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Bundle data is unavailable.') }));
    return true;
  }
  return true;
});
