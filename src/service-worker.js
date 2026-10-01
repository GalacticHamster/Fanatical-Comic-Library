/* Chrome MV3 entry point. The only main-world execution is the strict importer. */
import { safeId, validateScanResult, createSyncStore } from './library-data.mjs';

const syncStore=createSyncStore(chrome.storage.local);
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
    if (type.includes('comic') || ['book', 'ebook', 'manga', 'graphic_novel', 'graphic novel'].includes(type)) return 'book';
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
    const catalog = {};
    for (const name of ['language', 'edition', 'series', 'run', 'volume', 'issue', 'publisher']) {
      if (safeTextInPage(leaf?.[name])) catalog[name] = safeTextInPage(leaf[name]);
    }
    const authors = Array.isArray(leaf?.authors) ? leaf.authors : typeof leaf?.author === 'string' ? [leaf.author] : [];
    const names = [...new Set(authors.map(value => safeTextInPage(value)).filter(Boolean))].slice(0, 50);
    if (names.length) catalog.authors = names;
    return {
      source: 'fanatical', sourceItemId, title,
      ...(safeTextInPage(leaf?.slug, 300) ? { slug: safeTextInPage(leaf.slug, 300) } : {}),
      mediaType: mediaTypeInPage(leaf?.display_type ?? leaf?.type),
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...catalog,
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
  const incomplete = (reason) => new Error(`Fanatical scan incomplete; order-history coverage could not be confirmed: ${reason} Your library and scan history were not changed.`);
  const scanController = new AbortController();
  const concurrency = 3; const maxAttempts = 3; const maxPages = 1000; const maxOrders = 100000;
  let retries = 0; let cooldownUntil = 0;
  const pause = (ms) => new Promise((resolve, reject) => {
    if (scanController.signal.aborted) { reject(incomplete('Scan stopped after a failed request.')); return; }
    const abort = () => { clearTimeout(timer); reject(incomplete('Scan stopped after a failed request.')); };
    const timer = setTimeout(() => { scanController.signal.removeEventListener('abort', abort); resolve(); }, ms);
    scanController.signal.addEventListener('abort', abort, { once: true });
  });
  const retryDelay = (header, attempt) => {
    const backoff = 500 * (2 ** attempt) + Math.floor(Math.random() * 250);
    if (!header) return backoff;
    const delay = /^\d+$/u.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
    // Do not retry earlier than Retry-After, or keep the page busy indefinitely.
    if (delay > 30000) throw incomplete('Fanatical requested a longer retry delay. Please try scanning again later.');
    if (!Number.isFinite(delay)) return backoff;
    return Math.max(backoff, delay);
  };
  const request = async (path) => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      while (cooldownUntil > Date.now()) await pause(cooldownUntil - Date.now());
      if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      scanController.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(), 20000);
      let response; let transportFailed = false;
      try {
        try {
          response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { accept: 'application/json', authorization: token } });
        } catch { transportFailed = true; }
        if (scanController.signal.aborted) throw incomplete('Scan stopped after a failed request.');
        if (response?.status === 200) {
          let data;
          try { data = await response.json(); } catch (error) {
            if (!controller.signal.aborted && error?.name !== 'TypeError') throw unreadable();
            transportFailed = true;
          }
          if (!transportFailed) return { data, headers: response.headers };
        }
        // Do not leave retry/error response streams downloading in the background.
        try { await response?.body?.cancel(); } catch { /* No ownership data is read from error bodies. */ }
        if (!transportFailed && ![408, 429, 500, 502, 503, 504].includes(response?.status)) {
          if (response?.status === 401 || response?.status === 403) throw incomplete('Fanatical session expired or access was denied. Sign in and try again.');
          throw unreadable();
        }
      } finally {
        clearTimeout(timer); scanController.signal.removeEventListener('abort', abort);
      }
      if (attempt === maxAttempts - 1) throw incomplete('An order request failed after three attempts. Please try again later.');
      const delay = retryDelay(response?.headers?.get('retry-after'), attempt);
      retries++;
      if ([429, 503].includes(response?.status)) cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
      await pause(delay);
    }
    throw incomplete('An order request did not finish.');
  };
  const pagePath = (target, current) => {
    let url;
    try { url = new URL(target, `https://www.fanatical.com${current}`); } catch { throw incomplete('A pagination link was unreadable.'); }
    if (url.origin !== 'https://www.fanatical.com' || url.pathname !== '/api/user/orders' || url.username || url.password || url.hash) throw incomplete('An unsupported pagination link was returned.');
    url.searchParams.sort();
    return url.pathname + url.search;
  };
  // Split Link entries/parameters without splitting commas in quoted dates or
  // semicolons inside an angle-bracketed URL. Reject ambiguous header syntax.
  const splitHeader = (value, separator) => {
    const parts = []; let start = 0; let quoted = false; let angle = false; let escaped = false;
    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      if (escaped) { escaped = false; continue; }
      if (quoted && char === '\\') { escaped = true; continue; }
      if (!angle && char === '"') quoted = !quoted;
      if (!quoted && char === '<') { if (angle) throw unreadable(); angle = true; }
      if (!quoted && char === '>') { if (!angle) throw unreadable(); angle = false; }
      if (!quoted && !angle && char === separator) { parts.push(value.slice(start, i).trim()); start = i + 1; }
    }
    if (quoted || angle || escaped) throw unreadable();
    parts.push(value.slice(start).trim()); return parts;
  };
  const paginationLinks = (header, current) => {
    const links = {};
    if (!header) return links;
    for (const entry of splitHeader(header, ',')) {
      const match = /^<([^<>]+)>(.*)$/u.exec(entry);
      if (!match) throw unreadable();
      const parameters = splitHeader(match[2], ';');
      if (parameters.shift() !== '') throw unreadable();
      let relations = null;
      for (const parameter of parameters) {
        const param = /^([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s";]+))$/iu.exec(parameter);
        if (!param || param[1].toLowerCase() === 'anchor') throw unreadable();
        if (param[1].toLowerCase() === 'rel') {
          if (relations !== null) throw unreadable();
          relations = (param[2] ?? param[3]).toLowerCase().split(/\s+/u);
        }
      }
      if (!relations) throw unreadable();
      for (const relation of relations.filter((rel) => ['next', 'last'].includes(rel))) {
        if (links[relation]) throw incomplete('Pagination returned ambiguous next/last links.');
        links[relation] = pagePath(match[1], current);
      }
    }
    return links;
  };
  const summaries = []; const visitedPages = new Set(); const pageOrderIds = new Set();
  let path = '/api/user/orders'; let expectedTotal = null; let ranged = false; let linked = false;
  const acceptTotal = (value) => {
    if (!Number.isSafeInteger(value) || value < 0 || value > maxOrders || (expectedTotal !== null && value !== expectedTotal)) throw incomplete('Pagination totals changed or were unreadable.');
    expectedTotal = value;
  };
  while (path) {
    if (visitedPages.has(path)) throw incomplete('Pagination repeated a page.');
    if (visitedPages.size >= maxPages) throw incomplete('The 1,000-page safety limit was reached.');
    visitedPages.add(path);
    const { data, headers } = await request(path);
    // Envelopes/query conventions are not guessed from a fabricated contract.
    if (!Array.isArray(data)) throw unreadable();
    const total = headers?.get('x-total-count');
    if (total !== null && total !== undefined) {
      if (!/^\d+$/u.test(total)) throw unreadable();
      acceptTotal(Number(total));
    }
    const range = headers?.get('content-range');
    if (ranged && !range) throw incomplete('Pagination omitted a previously supplied range.');
    if (range) {
      ranged = true;
      if (data.length === 0 && summaries.length === 0 && /^(?:items|orders)\s+\*\/0$/iu.test(range)) acceptTotal(0);
      else {
        const match = /^(?:items|orders)\s+(\d+)-(\d+)\/(\d+)$/iu.exec(range);
        if (!match || Number(match[1]) !== summaries.length || Number(match[2]) - Number(match[1]) + 1 !== data.length || Number(match[2]) >= Number(match[3])) throw incomplete('Pagination ranges have gaps, overlaps or unreadable bounds.');
        acceptTotal(Number(match[3]));
      }
    }
    if (summaries.length + data.length > maxOrders) throw incomplete('The 100,000-order safety limit was reached.');
    for (const order of data) {
      if (!order || typeof order._id !== 'string' || !safeIdInPage(order._id) || pageOrderIds.has(order._id)) throw incomplete('Pagination returned an unreadable or repeated order.');
      pageOrderIds.add(order._id);
      summaries.push(order);
    }
    if (summaries.length > maxOrders || (expectedTotal !== null && summaries.length > expectedTotal)) throw incomplete('Pagination exceeded its total or the 100,000-order safety limit.');
    const links = paginationLinks(headers?.get('link'), path);
    if (links.next) {
      if (!data.length || (expectedTotal !== null && summaries.length >= expectedTotal)) throw incomplete('Pagination supplied a next page after an empty or final page.');
      linked = true;
    } else if ((expectedTotal !== null && summaries.length !== expectedTotal) || (links.last && links.last !== path)) {
      throw incomplete('Fanatical returned only part of the history without a usable next-page link.');
    }
    path = links.next || null;
  }
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
  const boundedMap = async (input, task) => {
    const results = new Array(input.length); let cursor = 0; let failure = null;
    const worker = async () => {
      while (!failure && cursor < input.length) {
        const index = cursor++;
        try { results[index] = await task(input[index], index); }
        catch (error) { if (!failure) { failure = error; scanController.abort(); } }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, input.length) }, worker));
    if (failure) throw failure;
    return results;
  };
  const completeWithFingerprints = await boundedMap(complete, async (order) => ({ order, fingerprint: await fingerprintOrderInPage(order._id) }));
  const known = new Set((Array.isArray(knownOrderFingerprints) ? knownOrderFingerprints : []).filter((fingerprint) => /^[a-f0-9]{64}$/iu.test(String(fingerprint))).map((fingerprint) => String(fingerprint).toLowerCase()));
  const listedFingerprints = new Set(await boundedMap([...listed], fingerprintOrderInPage));
  if ([...known].some((fingerprint) => !listedFingerprints.has(fingerprint))) {
    throw new Error('Fanatical order history omits previously scanned orders, so complete coverage could not be confirmed. Your library and scan history were not changed.');
  }
  const toInspect = fullScan ? completeWithFingerprints : completeWithFingerprints.filter(({ fingerprint }) => !known.has(fingerprint));
  const details = await boundedMap(toInspect, async ({ order: listedOrder }) => {
    const { data: order } = await request(`/api/user/orders/${encodeURIComponent(listedOrder._id)}`);
    const projectedItems = [];
    if (!order || order._id !== listedOrder._id || order.status !== 'COMPLETE' || !Array.isArray(order.items) || !order.items.length) throw unreadable();
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
          projectedItems.push(projected);
        }
      }
    }
    return projectedItems;
  });
  const items = new Map();
  for (const products of details) for (const product of products) items.set(product.sourceItemId, product);
  let currentToken='';try{currentToken=String(JSON.parse(localStorage.getItem('bsauth')||'{}')?.token||'');}catch{}
  if(currentToken!==token)throw new Error('The signed-in Fanatical session changed during this scan. Start a fresh scan.');
  // `token`, summaries, details, and raw leaves remain in this execution world.
  return {
    schemaVersion: 1,
    coverage: { complete: true, listedOrders: summaries.length, validatedOrders: details.length, emptyAccount: summaries.length === 0,
      pagesFetched: visitedPages.size, expectedTotal, paginationEvidence: ranged ? 'range' : expectedTotal !== null ? 'count' : linked ? 'link' : 'array-only', retries, concurrency },
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
    if(_sender?.id!==chrome.runtime.id||typeof _sender.url!=='string'||!(_sender.url.startsWith(chrome.runtime.getURL(''))||message.operation==='patch'&&_sender.url.startsWith('https://www.fanatical.com/'))||!['restore','clear','patch','unlink'].includes(message.operation)){sendResponse({ok:false,error:'Untrusted storage request.'});return false;}
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
