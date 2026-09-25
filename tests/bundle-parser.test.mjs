import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBundle } from '../src/bundle-parser.mjs';

const game = { _id: 'game-123456', name: 'Game One', slug: 'game-one', type: 'game', steam: { id: 10 }, drm: { steam: true }, platforms: { windows: true }, regionAvailable: true, storeVisible: true };

test('standard/tiered bundles retain group membership and product identity', () => {
  const parsed = parseBundle({ _id: 'bundle-123456', name: 'Tier Bundle', slug: 'tier-bundle', bundles: [{ price: { USD: 100 }, games: [game] }] });
  assert.equal(parsed.kind, 'standard'); assert.equal(parsed.bundle.sourceItemId, 'bundle-123456'); assert.equal(parsed.groups.length, 1); assert.equal(parsed.products[0].sourceItemId, 'game-123456');
});

test('Pick & Mix retains pool, quantity tiers, and card order', () => {
  const parsed = parseBundle({ _id: 'mix-123456', name: 'Mix', slug: 'mix', products: [game], tiers: [{ _id: 'tier-123456', quantity: 3, price: { USD: 495 } }], ordering: ['game-one'] }, 'pick-mix');
  assert.equal(parsed.kind, 'pick-mix'); assert.deepEqual(parsed.tiers, [{ id: 'tier-123456', quantity: 3, price: { USD: 495 } }]); assert.deepEqual(parsed.order, ['game-one']);
});
