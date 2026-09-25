/* Chrome MV3 entry point. The only main-world execution is the strict importer. */

const STORAGE_ITEMS = 'fanaticalLibraryItems';
const STORAGE_SUMMARY = 'fanaticalImportSummary';

const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeId = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
const safeDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
const safeList = (value, max = 30) => [...new Set((Array.isArray(value) ? value : []).map((entry) => safeText(entry, 40)).filter(Boolean))].sort().slice(0, max);

/** Defense in depth: treat the main-world result as untrusted and re-allowlist it. */
function sanitizeImportResult(value) {
  const input = value && typeof value === 'object' ? value : {};
  const deduplicated = new Map();
  for (const candidate of Array.isArray(input.items) ? input.items : []) {
    const sourceItemId = safeId(candidate?.sourceItemId);
    const title = safeText(candidate?.title);
    const bundleId = safeId(candidate?.bundle?.sourceItemId);
    if (!sourceItemId || !title) continue;
    const externalIds = {};
    if (/^\d{1,16}$/u.test(String(candidate?.externalIds?.steamAppId ?? ''))) externalIds.steamAppId = String(candidate.externalIds.steamAppId);
    if (/^[0-9X]{10,17}$/iu.test(String(candidate?.externalIds?.isbn ?? ''))) externalIds.isbn = String(candidate.externalIds.isbn).toUpperCase();
    const item = {
      source: 'fanatical', sourceItemId, title,
      ...(safeText(candidate?.slug, 300) ? { slug: safeText(candidate.slug, 300) } : {}),
      mediaType: ['game', 'book', 'audiobook', 'software', 'audio', 'elearning', 'other'].includes(candidate?.mediaType) ? candidate.mediaType : 'other',
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...(safeList(candidate?.drm).length ? { drm: safeList(candidate.drm) } : {}),
      ...(safeList(candidate?.platforms).length ? { platforms: safeList(candidate.platforms) } : {}),
      ...(safeList(candidate?.formats).length ? { formats: safeList(candidate.formats) } : {}),
      bundle: { sourceItemId: bundleId, title: safeText(candidate?.bundle?.title), ...(safeText(candidate?.bundle?.slug, 300) ? { slug: safeText(candidate.bundle.slug, 300) } : {}) },
      purchaseDate: safeDate(candidate?.purchaseDate)
    };
    deduplicated.set(sourceItemId, item);
  }
  return { schemaVersion: 1, ordersScanned: Math.max(0, Math.floor(Number(input.ordersScanned) || 0)), items: [...deduplicated.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)) };
}

/* This function is serialized by chrome.scripting and runs only in Fanatical's
 * MAIN world. Its return value is an explicit ownership DTO, never raw JSON. */
async function importFanaticalOrdersInPage() {
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
  const request = async (path) => {
    const response = await fetch(path, { method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json', authorization: token } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Fanatical session expired. Sign in and try again.' : 'Fanatical order history is unavailable right now.');
    return response.json();
  };
  const summaries = await request('/api/user/orders');
  const complete = (Array.isArray(summaries) ? summaries : []).filter((order) => order?.status === 'COMPLETE' && safeIdInPage(order?._id));
  const details = await Promise.all(complete.map((order) => request(`/api/user/orders/${encodeURIComponent(order._id)}`)));
  const items = new Map();
  for (const order of details) {
    if (order?.status !== 'COMPLETE') continue;
    for (const parent of Array.isArray(order?.items) ? order.items : []) {
      for (const group of Array.isArray(parent?.bundles) ? parent.bundles : []) {
        for (const leaf of Array.isArray(group?.games) ? group.games : []) {
          const projected = projectLeafInPage(leaf, parent, order);
          if (projected) items.set(projected.sourceItemId, projected);
        }
      }
    }
  }
  // `token`, summaries, details, and raw leaves remain in this execution world.
  return { schemaVersion: 1, ordersScanned: complete.length, items: [...items.values()] };
}

async function activeFanaticalTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !/^https:\/\/www\.fanatical\.com\//u.test(tab.url ?? '')) throw new Error('Open a Fanatical page before importing purchases.');
  return tab;
}

async function importPurchases() {
  const tab = await activeFanaticalTab();
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: importFanaticalOrdersInPage });
  const projected = sanitizeImportResult(result?.[0]?.result);
  const importedAt = new Date().toISOString();
  const summary = { importedAt, ordersScanned: projected.ordersScanned, ownedLeafProducts: projected.items.length, historyCoverage: 'Pagination has not yet been validated on a larger account.' };
  await chrome.storage.local.set({ [STORAGE_ITEMS]: projected.items, [STORAGE_SUMMARY]: summary });
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
    importPurchases().then((summary) => sendResponse({ ok: true, summary })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Import failed.') }));
    return true;
  }
  if (message?.type === 'FANATICAL_GET_PUBLIC_BUNDLE') {
    fetchPublicBundle(message.path).then((bundle) => sendResponse({ ok: true, bundle })).catch((error) => sendResponse({ ok: false, error: String(error?.message ?? 'Bundle data is unavailable.') }));
    return true;
  }
  return true;
});
