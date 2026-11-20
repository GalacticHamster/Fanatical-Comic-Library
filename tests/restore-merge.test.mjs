import assert from 'node:assert/strict';
import test from 'node:test';
import {createSyncStore} from '../src/library-data.mjs';

// Restore adds an older backup to newer saved data: nothing already saved is lost.
const ACCOUNT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const ref = n => String(n).repeat(64).slice(0, 64);
const review = (action, updatedAt, until = null) => ({action, basis: 'unrevealed', until, updatedAt});
const origin = (n, keyReview) => ({purchaseRef: ref(n), bundle: {sourceItemId: 'bundle-' + n + '00000', title: 'Bundle ' + n}, purchaseDate: `2025-0${n}-01T00:00:00.000Z`, quantity: 1,
  keyStatus: 'unrevealed', keyCheckedAt: '2026-01-01T00:00:00.000Z', ...(keyReview ? {keyReview} : {})});
const product = (id, title, origins) => ({source: 'fanatical', sourceItemId: id, title, mediaType: 'game', bundle: origins[0].bundle, purchaseDate: origins[0].purchaseDate, purchaseOrigins: origins});

function fixture(state) {
  const area = {
    get: async defaults => structuredClone({...defaults, ...Object.fromEntries(Object.keys(defaults).filter(key => key in state).map(key => [key, state[key]]))}),
    set: async updates => Object.assign(state, structuredClone(updates)),
    remove: async keys => { for (const key of [keys].flat()) delete state[key]; }
  };
  return {state, store: createSyncStore(area)};
}
function older(accountId = ACCOUNT) {
  return {
    fanaticalAccountId: accountId, fanaticalProfileLabel: 'personal', fanaticalProfileArchives: [], fanaticalHistoricalItems: [],
    fanaticalLibraryItems: [
      product('product-100001', 'Shared Game', [origin(1, review('snoozed', '2026-01-01T00:00:00.000Z', '2026-01-08T00:00:00.000Z')), origin(2, review('dismissed', '2026-03-01T00:00:00.000Z'))]),
      product('product-100002', 'Backup Only Game', [origin(3, review('dismissed', '2026-01-02T00:00:00.000Z'))])
    ],
    mediaTypeOverrides: {'product-100001': 'book', 'product-100002': 'software'},
    fanaticalWishlistItems: [{title: 'Old Wish', mediaType: 'game', weight: 1}, {title: 'Kept Wish', mediaType: 'game', weight: 1}]
  };
}
function newer() {
  return {
    fanaticalAccountId: ACCOUNT, fanaticalProfileLabel: 'personal', fanaticalProfileArchives: [], fanaticalHistoricalItems: [],
    fanaticalLibraryItems: [
      product('product-100001', 'Shared Game', [origin(1, review('dismissed', '2026-02-01T00:00:00.000Z')), origin(2, review('active', '2026-02-01T00:00:00.000Z')), origin(4)]),
      product('product-100003', 'Newer Game', [origin(5)])
    ],
    mediaTypeOverrides: {'product-100001': 'audiobook'},
    fanaticalWishlistItems: [{title: 'Kept Wish', mediaType: 'game', weight: 9}, {title: 'New Wish', mediaType: 'book', weight: 2}],
    fanaticalScannedOrderFingerprints: ['a'.repeat(64)], fanaticalImportSummary: {scanMode: 'full'}
  };
}
const reviews = item => Object.fromEntries(item.purchaseOrigins.map(o => [o.purchaseRef[0], o.keyReview?.action ?? null]));

test('restoring an older backup keeps newer purchases, wishes, corrections and review decisions', async () => {
  const source = fixture(older()), backup = await source.store.execute('backup');
  assert.equal(backup.schemaVersion, 4, 'the backup schema does not change');
  const f = fixture(newer());
  await f.store.execute('restore', [backup]);
  const items = Object.fromEntries(f.state.fanaticalLibraryItems.map(item => [item.title, item]));
  assert.deepEqual(Object.keys(items).sort(), ['Backup Only Game', 'Newer Game', 'Shared Game']);
  assert.deepEqual(items['Shared Game'].purchaseOrigins.map(o => o.purchaseRef[0]).sort(), ['1', '2', '4'], 'purchase records from both sides are kept');
  assert.deepEqual(reviews(items['Shared Game']), {1: 'dismissed', 2: 'dismissed', 4: null}, 'each key keeps its newer review decision');
  assert.deepEqual(reviews(items['Backup Only Game']), {3: 'dismissed'});
  assert.deepEqual(f.state.mediaTypeOverrides, {'product-100001': 'audiobook', 'product-100002': 'software'});
  assert.deepEqual(f.state.fanaticalWishlistItems.map(w => [w.title, w.weight]).sort(), [['Kept Wish', 9], ['New Wish', 2], ['Old Wish', 1]]);
  assert.deepEqual(f.state.fanaticalProfileArchives, []);
  assert.deepEqual(f.state.fanaticalScannedOrderFingerprints, [], 'restore still resets scan history for a safe recheck');

  const once = structuredClone(f.state);
  await f.store.execute('restore', [backup]);
  for (const key of ['fanaticalLibraryItems', 'fanaticalHistoricalItems', 'mediaTypeOverrides', 'fanaticalWishlistItems', 'fanaticalProfileArchives']) assert.deepEqual(f.state[key], once[key], `repeat restore is idempotent: ${key}`);
});

test('a current account that is not in the backup is kept as a saved account and never mixed', async () => {
  const backup = await fixture(older(OTHER)).store.execute('backup'), f = fixture(newer());
  await f.store.execute('restore', [backup]);
  assert.equal(f.state.fanaticalAccountId, OTHER);
  assert.deepEqual(f.state.fanaticalLibraryItems.map(item => item.title).sort(), ['Backup Only Game', 'Shared Game']);
  assert.deepEqual(f.state.fanaticalProfileArchives.map(entry => [entry.profileLabel, entry.accountId]), [['personal (before restore)', ACCOUNT]]);
  assert.deepEqual(f.state.fanaticalProfileArchives[0].items.map(item => item.title).sort(), ['Newer Game', 'Shared Game']);
  await f.store.execute('selectProfile', [{profileLabel: 'personal (before restore)', expectedActiveLabel: 'personal', confirmed: true}]);
  assert.equal(f.state.fanaticalAccountId, ACCOUNT);
  assert.deepEqual(f.state.fanaticalLibraryItems.map(item => item.title).sort(), ['Newer Game', 'Shared Game']);
});

test('a backup without a wishlist keeps the current wishlist; history stays where the newer scan put it', async () => {
  const backup = await fixture(older()).store.execute('backup');
  const legacy = {...backup, schemaVersion: 2};
  delete legacy.wishlistItems; delete legacy.historicalItems;
  const current = newer();
  current.fanaticalHistoricalItems = [{profileLabel: 'personal', missingSince: '2026-02-01T00:00:00.000Z', item: current.fanaticalLibraryItems.pop()}];
  current.fanaticalHistoricalItems[0].item = {...current.fanaticalHistoricalItems[0].item, sourceItemId: 'product-100002', title: 'Backup Only Game'};
  const f = fixture(current);
  await f.store.execute('restore', [legacy]);
  assert.deepEqual(f.state.fanaticalWishlistItems.map(w => w.title), ['Kept Wish', 'New Wish']);
  assert.deepEqual(f.state.fanaticalLibraryItems.map(item => item.title), ['Shared Game'], 'a title the newer scan moved to history is not made current again');
  assert.equal(f.state.fanaticalHistoricalItems.length, 1);
  assert.deepEqual(f.state.fanaticalHistoricalItems[0].item.purchaseOrigins.map(o => o.purchaseRef[0]).sort(), ['3', '5'], 'its purchase records are merged in history');
});
