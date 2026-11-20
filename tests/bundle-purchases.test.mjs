import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';

// The bundle page's Already purchased notice lists every saved purchase of the bundle (WP-07).
const F = globalThis.FanaticalLibrary;
const origin = (ref, date, quantity = 1, bundle = 'bundle-a') => ({...(ref ? {purchaseRef: ref.repeat(64)} : {}), purchaseDate: date, quantity, bundle: {sourceItemId: bundle, title: 'Bundle A'}});
const product = (id, origins) => ({source: 'fanatical', sourceItemId: id, title: id, mediaType: 'game', bundle: origins[0].bundle, purchaseOrigins: origins});

test('two orders of a bundle are two purchases, oldest first, undated last and never hidden', () => {
  const items = [
    product('p1', [origin('b', '2026-02-01T15:00:00.000Z'), origin('a', '2025-03-01T15:00:00.000Z'), origin('c', null)]),
    product('p2', [origin('b', '2026-02-01T15:00:00.000Z'), origin('a', '2025-03-01T15:00:00.000Z')]),
    product('other', [origin('d', '2024-01-01T15:00:00.000Z', 1, 'bundle-b')])
  ];
  const result = F.bundlePurchases(items, 'bundle-a');
  assert.deepEqual(result.purchases.map(p => p.date), ['2025-03-01T15:00:00.000Z', '2026-02-01T15:00:00.000Z', null]);
  assert.equal(result.exact, true);
});

test('quantity counts as copies, and an undated only purchase is still listed', () => {
  assert.deepEqual(F.bundlePurchases([product('p1', [origin('a', null, 2)])], 'bundle-a'), {purchases: [{date: null, copies: 2}], exact: true});
});

test('an earlier record without an order reference that may be a verified order makes the count a minimum', () => {
  const same = F.bundlePurchases([product('p1', [origin('a', '2025-03-01T15:00:00.000Z')]), product('p2', [origin(null, '2025-03-01T15:00:00.000Z')])], 'bundle-a');
  assert.equal(same.purchases.length, 1);
  assert.equal(same.exact, false);
  const separate = F.bundlePurchases([product('p1', [origin('a', '2025-03-01T15:00:00.000Z')]), product('p2', [origin(null, '2020-01-01T15:00:00.000Z')])], 'bundle-a');
  assert.equal(separate.purchases.length, 2);
  assert.equal(separate.exact, true);
  assert.deepEqual(F.bundlePurchases([product('p1', [origin('a', '2025-03-01T15:00:00.000Z')])], 'missing'), {purchases: [], exact: true});
});
