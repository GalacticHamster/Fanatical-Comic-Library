import './shared.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const type = (value) => {
  const raw = text(value).toLowerCase();
  if (raw.includes('comic') || raw === 'book') return 'book';
  if (raw.includes('audio') && raw.includes('book')) return 'audiobook';
  return raw === 'game' ? 'game' : raw.includes('software') || raw.includes('asset') ? 'software' : raw || 'other';
};
function product(raw) {
  if (!raw?._id || !text(raw?.name)) return null;
  const drm = Object.entries(raw.drm ?? {}).filter(([, value]) => value === true).map(([key]) => key).sort();
  const platforms = Object.entries(raw.platforms ?? raw.os ?? {}).filter(([, value]) => value === true).map(([key]) => key).sort();
  return {
    sourceItemId: String(raw._id), title: text(raw.name), slug: text(raw.slug), mediaType: type(raw.display_type ?? raw.type),
    ...(raw?.steam?.id !== undefined ? { externalIds: { steamAppId: String(raw.steam.id) } } : {}),
    ...(text(raw.isbn) ? { externalIds: { ...(raw?.steam?.id !== undefined ? { steamAppId: String(raw.steam.id) } : {}), isbn: text(raw.isbn).replace(/[^0-9X]/giu, '') } } : {}),
    drm, platforms,
    ...globalThis.FanaticalLibrary.componentMetadata(raw.components, raw.display_type ?? raw.type),
    availability: { soldOut: raw.soldOut === true, lowStock: raw.low_stock === true, regionAvailable: raw.regionAvailable !== false, storeVisible: raw.storeVisible !== false }
  };
}
export function parseBundle(raw, routeKind = 'standard') {
  if (!raw || typeof raw !== 'object' || !raw._id || !text(raw.name)) throw new Error('Fanatical bundle response is missing its identity.');
  const pickMix = routeKind === 'pick-mix' || (Array.isArray(raw.products) && Array.isArray(raw.tiers));
  const groups = pickMix ? [] : (Array.isArray(raw.bundles) ? raw.bundles : []).map((group, index) => ({ index, price: group?.price ?? null, products: (Array.isArray(group?.games) ? group.games : []).map(product).filter(Boolean) }));
  const products = pickMix ? raw.products.map(product).filter(Boolean) : groups.flatMap((group) => group.products);
  const tiers = pickMix ? (Array.isArray(raw.tiers) ? raw.tiers : []).map((tier) => ({ id: String(tier?._id ?? ''), quantity: Number(tier?.quantity ?? 0), price: tier?.price ?? {} })).filter((tier) => tier.quantity > 0) : groups.map((group) => ({ id: String(group.index), price: group.price }));
  const order = pickMix ? (Array.isArray(raw.ordering) ? raw.ordering.map(String) : []) : [];
  return { kind: pickMix ? 'pick-mix' : 'standard', bundle: { sourceItemId: String(raw._id), title: text(raw.name), slug: text(raw.slug) }, products, groups, tiers, order };
}
