import './shared.js';

const safeText = (value, max = 500) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const safeId = (value) => /^[a-zA-Z0-9_-]{6,128}$/u.test(String(value ?? '')) ? String(value) : '';
const safeDate = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
const trueKeys = (value) => Object.entries(value && typeof value === 'object' ? value : {}).filter(([, active]) => active === true).map(([key]) => key).sort();
const formats = (downloads) => [...new Set((Array.isArray(downloads) ? downloads : []).flatMap((download) => (Array.isArray(download?.files) ? download.files : []).map((file) => safeText(file?.format, 32).toLowerCase())).filter(Boolean))].sort();
const mediaType = globalThis.FanaticalLibrary.mediaType;

function projectLeaf(leaf, parent, order) {
  const sourceItemId = safeId(leaf?._id);
  const title = safeText(leaf?.name);
  if (!sourceItemId || !title) return null;
  const steamId = leaf?.steam?.id === undefined || leaf?.steam?.id === null ? '' : String(leaf.steam.id);
  const isbn = safeText(leaf?.isbn, 32).replace(/[^0-9X]/giu, '');
  return {
    source: 'fanatical', sourceItemId, title,
    ...(safeText(leaf?.slug, 300) ? { slug: safeText(leaf.slug, 300) } : {}),
    mediaType: mediaType(leaf?.display_type ?? leaf?.type),
    ...globalThis.FanaticalLibrary.bibliographicFields(leaf),
    ...(Object.keys({ ...(steamId ? { steamAppId: steamId } : {}), ...(isbn ? { isbn } : {}) }).length ? { externalIds: { ...(steamId ? { steamAppId: steamId } : {}), ...(isbn ? { isbn } : {}) } } : {}),
    ...(trueKeys(leaf?.drm).length ? { drm: trueKeys(leaf.drm) } : {}),
    ...(trueKeys(leaf?.platforms ?? leaf?.os).length ? { platforms: trueKeys(leaf.platforms ?? leaf.os) } : {}),
    ...(formats(leaf?.downloads).length ? { formats: formats(leaf.downloads) } : {}),
    bundle: {
      sourceItemId: safeId(parent?._id), title: safeText(parent?.name),
      ...(safeText(parent?.slug, 300) ? { slug: safeText(parent.slug, 300) } : {})
    },
    purchaseDate: safeDate(order?.date)
  };
}

function leavesFor(item) {
  const groups = Array.isArray(item?.bundles) ? item.bundles : [];
  return groups.flatMap((group) => Array.isArray(group?.games) ? group.games : []);
}

/** Strict allowlist: raw order objects and all unlisted properties are discarded. */
export function projectOrderHistory(orderSummaries, orderDetails) {
  const completeIds = new Set((Array.isArray(orderSummaries) ? orderSummaries : [])
    .filter((order) => order?.status === 'COMPLETE').map((order) => safeId(order?._id)).filter(Boolean));
  const items = new Map();
  for (const order of Array.isArray(orderDetails) ? orderDetails : []) {
    const orderId = safeId(order?._id);
    if (!orderId || !completeIds.has(orderId) || order?.status !== 'COMPLETE') continue;
    for (const parent of Array.isArray(order?.items) ? order.items : []) {
      for (const leaf of leavesFor(parent)) {
        const projected = projectLeaf(leaf, parent, order);
        if (projected) items.set(projected.sourceItemId, projected);
      }
    }
  }
  return { schemaVersion: 1, ordersScanned: completeIds.size, items: [...items.values()].sort((a, b) => a.sourceItemId.localeCompare(b.sourceItemId)) };
}
