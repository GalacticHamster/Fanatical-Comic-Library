import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBundle } from '../src/bundle-parser.mjs';

test('live and standalone parsing share the same implementation and retain safe contents evidence', () => {
  assert.equal(parseBundle, globalThis.FanaticalLibrary.parseBundle);
  const raw = { ...game, authors: ['Writer'], language: 'en', run: '2020', edition: 'Deluxe', token: 'SECRET',
    contentsComplete: true, contents: [{ series: '日本語', run: '2020', language: 'en', unitType: 'issue', number: '1/2', completeness: 'full', url: 'SECRET' }],
    components: [{ _id: 'component-123456', name: '日本語 #1', type: 'book', key: 'SECRET' }] };
  const item = parseBundle({ _id: 'bundle-123456', name: 'Bundle', products: [raw], tiers: [] }).products[0];
  assert.equal(item.contents[0].number, '0.5');
  assert.equal(item.contentsComplete, true);
  assert.equal(item.components[0].mediaType, 'book');
  assert.equal(JSON.stringify(item).includes('SECRET'), false);
  const damaged = globalThis.FanaticalLibrary.plainProduct({ ...raw, contents: [...raw.contents, { series: 'Unreadable' }] });
  assert.equal(damaged.contentsComplete, false);
  assert.equal(damaged.contentsCoverageUnknown, true);
});

const game = { _id: 'game-123456', name: 'Game One', slug: 'game-one', type: 'game', steam: { id: 10 }, drm: { steam: true }, platforms: { windows: true }, regionAvailable: true, storeVisible: true };

test('standard/tiered bundles retain group membership and product identity', () => {
  const parsed = parseBundle({ _id: 'bundle-123456', name: 'Tier Bundle', slug: 'tier-bundle', bundles: [{ price: { USD: 100 }, games: [game] }] });
  assert.equal(parsed.kind, 'standard'); assert.equal(parsed.bundle.sourceItemId, 'bundle-123456'); assert.equal(parsed.groups.length, 1); assert.equal(parsed.products[0].sourceItemId, 'game-123456');
});

test('Pick & Mix retains pool, quantity tiers, and card order', () => {
  const parsed = parseBundle({ _id: 'mix-123456', name: 'Mix', slug: 'mix', products: [game], tiers: [{ _id: 'tier-123456', quantity: 3, price: { USD: 495 } }], ordering: ['game-one'] }, 'pick-mix');
  assert.equal(parsed.kind, 'pick-mix'); assert.deepEqual(parsed.tiers, [{ id: 'tier-123456', quantity: 3, price: { USD: 495 } }]); assert.deepEqual(parsed.order, ['game-one']);
});
