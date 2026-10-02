import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOrderHistory } from '../src/projection.mjs';

function toxicLeaf() {
  return {
    _id: 'leaf-123456', iid: 'purchase-private', name: 'Safe Game', slug: 'safe-game', type: 'game', display_type: 'game',
    steam: { id: 42, key: 'DO-NOT-KEEP' }, isbn: '978-1-23-456789-0', drm: { steam: true, gog: false }, platforms: { windows: true },
    downloads: [{ files: [{ format: 'pdf', path: 'https://private.example/download', md5: 'private-hash' }] }],
    key: 'key', keys: ['keys'], steam_key: 'steam-key', activation_key: 'activation-key', redemption_key: 'redemption-key', token: 'token', authorization: 'authorization', download_url: 'download-url', hash: 'hash', payment: { card: 'private' }, address: { city: 'private' }, email: 'private@example.test'
  };
}

test('safe order projection keeps only an explicit ownership allowlist', async () => {
  const output = await projectOrderHistory([{ _id: 'order-123456', status: 'COMPLETE' }], [{
    _id: 'order-123456', status: 'COMPLETE', date: '2026-01-01T00:00:00.000Z', payment: { secret: 'nope' },
    items: [{ _id: 'bundle-123456', name: 'Safe Bundle', slug: 'safe-bundle', bundles: [{ games: [toxicLeaf()] }] }]
  }]);
  assert.equal(output.ordersScanned, 1);
  assert.equal(output.items.length, 1);
  const {purchaseOrigins,...projected}=output.items[0];assert.equal(purchaseOrigins.length,1);assert.equal(purchaseOrigins[0].quantity,1);assert.match(purchaseOrigins[0].purchaseRef,/^[a-f0-9]{64}$/u);
  assert.deepEqual(projected, {
    source: 'fanatical', sourceItemId: 'leaf-123456', title: 'Safe Game', slug: 'safe-game', mediaType: 'game',
    externalIds: { steamAppId: '42', isbn: '9781234567890' }, drm: ['steam'], platforms: ['windows'], formats: ['pdf'],
    bundle: { sourceItemId: 'bundle-123456', title: 'Safe Bundle', slug: 'safe-bundle' }, purchaseDate: '2026-01-01T00:00:00.000Z'
  });
});

test('toxic key, token, account and download values cannot survive projection', async () => {
  const output = await projectOrderHistory([{ _id: 'order-123456', status: 'COMPLETE' }], [{ _id: 'order-123456', status: 'COMPLETE', date: '2026-01-01T00:00:00Z', items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [{ games: [toxicLeaf()] }] }] }]);
  const serialized = JSON.stringify(output);
  for (const forbidden of ['DO-NOT-KEEP', 'steam-key', 'activation-key', 'redemption-key', 'private@example.test', 'private-hash', 'https://private.example/download', 'authorization']) assert.equal(serialized.includes(forbidden), false, forbidden);
});

test('only complete orders and valid leaf identities are imported', async () => {
  const output = await projectOrderHistory([{ _id: 'order-123456', status: 'REFUNDED' }], [{ _id: 'order-123456', status: 'REFUNDED', items: [{ bundles: [{ games: [toxicLeaf()] }] }] }]);
  assert.deepEqual(output, { schemaVersion: 1, ordersScanned: 0, items: [] });
});
