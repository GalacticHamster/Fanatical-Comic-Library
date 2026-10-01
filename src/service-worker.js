/* Chrome MV3 entry point. The only main-world execution is the strict importer. */
import { safeId, validateScanResult } from './library-data.mjs';

const STORAGE_ITEMS = 'fanaticalLibraryItems';
const STORAGE_SUMMARY = 'fanaticalImportSummary';
const STORAGE_ORDER_FINGERPRINTS = 'fanaticalScannedOrderFingerprints';

/* This function is serialized by chrome.scripting and runs only in Fanatical's
 * MAIN world. Its return value is an explicit ownership DTO, never raw JSON. */
async function importFanaticalOrdersInPage({ fullScan = false, knownOrderFingerprints = [] } = {}) {
  const safeTextInPage = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const safeIdInPage = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
  const safeDateInPage = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  const trueKeysInPage = (value) => Object.entries(value && typeof value === 'object' ? value : {}).filter(([, active]) => active === true).map(([key]) => key).sort();
  const formatsInPage = (downloads) => [...new Set((Array.isArray(downloads) ? downloads : []).flatMap((download) => (Array.isArray(download?.files) ? download.files : []).map((file) => safeTextInPage(file?.format, 32).toLowerCase())).filter(Boolean))].sort();
  const mediaTypeInPage = (value) => {
    const type = safeTextInPage(value).toLowerCase();
    if (type.includes('comic') || type === 'book') return 'book';
    if (type.includes('audio') && type.includes('book')) return 'audiobook';
    if (type === 'game') return 'game';
    if (type.includes('software') || type.includes('asset')) return 'software';
    if (type.includes('learn') || type.includes('course')) return 'elearning';
    if (type.includes('audio')) return 'audio';
    return 'other';
  };
  const projectLeafInPage = (leaf, parent, order) => {
    const sourceItemId = safeIdInPage(leaf?._id); const title = safeTextInPage(leaf?.name);
    if (!sourceItemId || !title) return null;
    const steam = leaf?.steam?.id === undefined || leaf?.steam?.id === null ? '' : String(leaf.steam.id);
    const isbn = safeTextInPage(leaf?.isbn, 32).replace(/[^0-9X]/giu, '');
    const externalIds = { ...(steam ? { steamAppId: steam } : {}), ...(isbn ? { isbn } : {}) };
    return {
      source: 'fanatical', sourceItemId, title,
      ...(safeTextInPage(leaf?.slug, 300) ? { slug: safeTextInPage(leaf.slug, 300) } : {}),
      mediaType: mediaTypeInPage(leaf?.display_type ?? leaf?.type),
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...(trueKeysInPage(leaf?.drm).length ? { drm: trueKeysInPage(leaf.drm) } : {}),
      ...(trueKeysInPage(leaf?.platforms ?? leaf?.os).length ? { platforms: trueKeysInPage(leaf.platforms ?? leaf.os) } : {}),
      ...(formatsInPage(leaf?.downloads).length ? { formats: formatsInPage(leaf.downloads) } : {}),
      bundle: { sourceItemId: safeIdInPage(parent?._id), title: safeTextInPage(parent?.name), ...(safeTextInPage(parent?.slug, 300) ? { slug: safeTextInPage(parent.slug, 300) } : {}) },
      purchaseDate: safeDateInPage(order?.date)
    };
  };
  let token = '';
  try { token = String(JSON.parse(localStorage.getItem('bsauth') || '{}')?.token || ''); } catch { /* no signed-in token */ }
  if (!token) throw new Error('Sign in to Fanatical before importing purchases.');
  const unreadable = () => new Error('Fanatical returned unreadable or incomplete order data. Your library and scan history were not changed.');
  const request = async (path) => {
    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json', authorization: token } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Fanatical session expired. Sign in and try again.' : 'Fanatical order history is unavailable right now.');
    if (response.status !== 200) throw unreadable();
    let data;
    try { data = await response.json(); } catch { throw unreadable(); }
    if (path === '/api/user/orders') {
      // Only the observed, unpaginated array contract is supported. Never
      // rebuild from a first page or from an API/error envelope.
      if (!Array.isArray(data)) throw unreadable();
      const link = response.headers?.get('link') || '';
      for (const relation of link.matchAll(/\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;\s,]+))/giu)) {
        if ((relation[1] ?? relation[2] ?? relation[3]).toLowerCase().split(/\s+/u).includes('next')) throw unreadable();
      }
      const total = response.headers?.get('x-total-count');
      if (total !== null && total !== undefined && (!/^\d+$/u.test(total) || Number(total) !== data.length)) throw unreadable();
      const range = response.headers?.get('content-range');
      if (range && !(data.length === 0 && /^(?:items|orders)\s+\*\/0$/iu.test(range))) {
        const match = /^(?:items|orders)\s+0-(\d+)\/(\d+)$/iu.exec(range);
        if (!match || Number(match[1]) + 1 !== data.length || Number(match[2]) !== data.length) throw unreadable();
      }
    }
    return data;
  };
  const summaries = await request('/api/user/orders');
  const listed = new Set();
  const expectedProducts = new Map();
  const productCounts = (parents) => {
    if (!Array.isArray(parents) || !parents.length) throw unreadable();
    const counts = new Map();
    for (const parent of parents) {
      if (!safeTextInPage(parent?.name) || !Array.isArray(parent?.bundles) || !parent.bundles.length) throw unreadable();
      for (const group of parent.bundles) {
        if (!Array.isArray(group?.games) || !group.games.length) throw unreadable();
        for (const leaf of group.games) {
          if (!safeTextInPage(leaf?.name)) throw unreadable();
          const key = JSON.stringify([safeTextInPage(parent.name), safeTextInPage(leaf.name)]);
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    }
    return counts;
  };
  for (const order of summaries) {
    if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || typeof order.status !== 'string' || !/^[A-Z][A-Z_]*$/u.test(order.status) || listed.has(order._id)) throw unreadable();
    listed.add(order._id);
    if (order.status === 'COMPLETE') expectedProducts.set(order._id, productCounts(order.items));
  }
  const complete = summaries.filter((order) => order.status === 'COMPLETE');
  // Only opaque SHA-256 fingerprints leave the page world. This lets a quick
  // scan identify unseen orders without persisting Fanatical order IDs.
  const fingerprintOrderInPage = async (id) => {
    const bytes = new TextEncoder().encode(String(id));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, '0')).join('');
  };
  const completeWithFingerprints = await Promise.all(complete.map(async (order) => ({ order, fingerprint: await fingerprintOrderInPage(order._id) })));
  const known = new Set((Array.isArray(knownOrderFingerprints) ? knownOrderFingerprints : []).filter((fingerprint) => /^[a-f0-9]{64}$/iu.test(String(fingerprint))).map((fingerprint) => String(fingerprint).toLowerCase()));
  const listedFingerprints = new Set(await Promise.all([...listed].map(fingerprintOrderInPage)));
  if ([...known].some((fingerprint) => !listedFingerprints.has(fingerprint))) {
    throw new Error('Fanatical order history omits previously scanned orders, so complete coverage could not be confirmed. Your library and scan history were not changed.');
  }
  const toInspect = fullScan ? completeWithFingerprints : completeWithFingerprints.filter(({ fingerprint }) => !known.has(fingerprint));
  const details = await Promise.all(toInspect.map(({ order }) => request(`/api/user/orders/${encodeURIComponent(order._id)}`)));
  const items = new Map();
  for (const [index, order] of details.entries()) {
    if (!order || order._id !== toInspect[index].order._id || order.status !== 'COMPLETE' || !Array.isArray(order.items) || !order.items.length) throw unreadable();
    const expected = expectedProducts.get(order._id);
    const actual = productCounts(order.items);
    if (actual.size !== expected.size || [...expected].some(([key, quantity]) => actual.get(key) !== quantity)) throw unreadable();
    for (const parent of order.items) {
      if (!parent || typeof parent._id !== 'string' || !safeIdInPage(parent._id) || !safeTextInPage(parent.name) || !Array.isArray(parent.bundles) || !parent.bundles.length) throw unreadable();
      for (const group of parent.bundles) {
        if (!group || !Array.isArray(group.games) || !group.games.length) throw unreadable();
        for (const leaf of group.games) {
          if (typeof leaf?._id !== 'string') throw unreadable();
          const projected = projectLeafInPage(leaf, parent, order);
          if (!projected) throw unreadable();
          items.set(projected.sourceItemId, projected);
        }
      }
    }
  }
  // `token`, summaries, details, and raw leaves remain in this execution world.
  return {
    schemaVersion: 1,
    coverage: { complete: true, listedOrders: summaries.length, validatedOrders: details.length, emptyAccount: summaries.length === 0 },
    ordersScanned: toInspect.length,
    ordersAvailable: complete.length,
    orderFingerprints: completeWithFingerprints.map(({ fingerprint }) => fingerprint),
    items: [...items.values()]
  };
}

async function activeFanaticalTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https:\/\/www\.fanatical\.com\//u.test(tab.url ?? '')) throw new Error('Open a Fanatical page before importing purchases.');
  return tab;
}

async function importPurchases({ fullScan = false } = {}) {
  const tab = await activeFanaticalTab();
  const stored = await chrome.storage.local.get({ [STORAGE_ITEMS]: [], [STORAGE_ORDER_FINGERPRINTS]: [] });
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
  for (const item of projected.items) merged.set(item.sourceItemId, item);
  const importedAt = new Date().toISOString();
  const summary = {
    importedAt,
    scanMode: fullScan ? 'full' : 'quick',
    ordersScanned: projected.ordersScanned,
    ordersAvailable: projected.ordersAvailable,
    ordersSkipped: Math.max(0, projected.ordersAvailable - projected.ordersScanned),
    addedProducts,
    ownedLeafProducts: merged.size,
    historyCoverage: `${projected.coverage.emptyAccount ? 'Valid empty order history.' : `Validated ${projected.coverage.listedOrders} listed orders and ${projected.ordersScanned} requested completed-order details.`} Pagination has not yet been validated on a larger account.`
  };
  await chrome.storage.local.set({
    [STORAGE_ITEMS]: [...merged.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)),
    [STORAGE_ORDER_FINGERPRINTS]: projected.orderFingerprints,
    [STORAGE_SUMMARY]: summary
  });
  return summary;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FANATICAL_IMPORT_PURCHASES') {
    importPurchases({ fullScan: message.fullScan === true }).then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Import failed.') }));
    return true;
  }
  if (message?.type === 'FANATICAL_GET_PUBLIC_BUNDLE') {
    fetchPublicBundle(message.path).then((bundle) => sendResponse({ ok: true, bundle })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Bundle data is unavailable.') }));
    return true;
  }
  return true;
});
