// Shared by the purchase importer and backup UI. Never persist raw input.
const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const safeId = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
const safeDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
const safeList = (value) => [...new Set((Array.isArray(value) ? value : []).map((entry) => safeText(entry, 40)).filter(Boolean))].sort().slice(0, 30);
const count = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;

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
    deduplicated.set(sourceItemId, {
      source: 'fanatical', sourceItemId, title,
      ...(safeText(candidate?.slug, 300) ? { slug: safeText(candidate.slug, 300) } : {}),
      mediaType: ['game', 'book', 'audiobook', 'software', 'audio', 'elearning', 'other'].includes(candidate?.mediaType) ? candidate.mediaType : 'other',
      ...(Object.keys(externalIds).length ? { externalIds } : {}),
      ...(safeList(candidate?.drm).length ? { drm: safeList(candidate.drm) } : {}),
      ...(safeList(candidate?.platforms).length ? { platforms: safeList(candidate.platforms) } : {}),
      ...(safeList(candidate?.formats).length ? { formats: safeList(candidate.formats) } : {}),
      bundle: { sourceItemId: safeId(candidate?.bundle?.sourceItemId), title: safeText(candidate?.bundle?.title), ...(safeText(candidate?.bundle?.slug, 300) ? { slug: safeText(candidate.bundle.slug, 300) } : {}) },
      purchaseDate: safeDate(candidate?.purchaseDate)
    });
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
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.items)) throw new Error('Expected a Fanatical Library version 1 backup with an items array.');
  if (value.items.some((item) => item?.source !== 'fanatical' || !safeId(item?.sourceItemId) || !safeText(item?.title))) {
    throw new Error('The backup contains an invalid Fanatical ownership record. Nothing was imported.');
  }
  return sanitizeImportResult(value).items;
}

export function createLibraryBackup(items, summary, exportedAt = new Date().toISOString()) {
  // Scan metadata is informational only: restore never trusts its skip history.
  const safeSummary = summary && ['full', 'quick'].includes(summary.scanMode) ? {
    importedAt: safeDate(summary.importedAt), scanMode: summary.scanMode,
    ordersScanned: count(summary.ordersScanned), ordersAvailable: count(summary.ordersAvailable), ordersSkipped: count(summary.ordersSkipped),
    addedProducts: count(summary.addedProducts), ownedLeafProducts: count(summary.ownedLeafProducts),
    historyCoverage: safeText(summary.historyCoverage)
  } : null;
  return { schemaVersion: 1, exportedAt: safeDate(exportedAt), summary: safeSummary, items: sanitizeImportResult({ items }).items };
}

export function backupRestoreState(items) {
  return { fanaticalLibraryItems: items, fanaticalImportSummary: null, fanaticalScannedOrderFingerprints: [] };
}
