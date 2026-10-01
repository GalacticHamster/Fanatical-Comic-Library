import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { globalThis: null, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), context);
const { FanaticalLibrary: F } = context;

const owned = (overrides = {}) => ({ source: 'fanatical', sourceItemId: 'product-123456', title: 'Example Game', mediaType: 'game', ...overrides });

test('catalogue offer identity accepts only Fanatical bundle links', () => {
  assert.deepEqual({ ...F.catalogueOffer('/en/bundle/valiant-comics?ref=featured') }, { kind: 'standard', slug: 'valiant-comics' });
  assert.deepEqual({ ...F.catalogueOffer('https://www.fanatical.com/en/pick-and-mix/build-your-own-games') }, { kind: 'pick-mix', slug: 'build-your-own-games' });
  for (const href of ['/en/bundle', '/en/bundle/all', '/en/bundle/books', '/en/bundle/mystery', '/en/game/valiant-comics', 'https://example.com/en/bundle/valiant-comics']) {
    assert.equal(F.catalogueOffer(href), null);
  }
});

test('catalogue routes include bundle/all but exclude individual offers and homepage', () => {
  assert.equal(F.cataloguePageKind('/en/bundle'), 'main');
  assert.equal(F.cataloguePageKind('/en/bundle/all'), 'all');
  assert.equal(F.cataloguePageKind('/en/bundle/books'), 'books');
  assert.equal(F.cataloguePageKind('/en/bundle/games'), 'games');
  assert.equal(F.cataloguePageKind('/en/bundle/other'), 'other');
  assert.equal(F.cataloguePageKind('/en/bundle/mystery'), 'mystery');
  assert.equal(F.cataloguePageKind('/en/bundle/valiant-comics'), null);
  assert.equal(F.cataloguePageKind('/en/'), null);
});

test('catalogue purchases require an imported parent bundle slug, not leaf ownership', () => {
  const indexed = F.purchasedBundleSlugs([
    owned({ bundle: { sourceItemId: 'bundle-123456', title: 'Valiant Comics', slug: 'valiant-comics' }, purchaseDate: '2026-09-25T02:36:22Z' }),
    owned({ sourceItemId: 'another-leaf', bundle: { sourceItemId: 'bundle-123456', title: 'Valiant Comics', slug: 'valiant-comics' } }),
    owned({ sourceItemId: 'orphan-leaf' }),
    { source: 'humble', sourceItemId: 'external-leaf', bundle: { sourceItemId: 'bundle-654321', slug: 'other-bundle' } }
  ]);
  assert.deepEqual([...indexed.keys()], ['valiant-comics']);
  assert.equal(indexed.get('valiant-comics').sourceItemId, 'bundle-123456');
  assert.equal(indexed.get('valiant-comics').purchaseDate, '2026-09-25T02:36:22Z');
});

test('catalogue expiry recognizes days and countdowns without guessing from prices', () => {
  assert.equal(F.catalogueDaysLeft('7 Days Left'), 7);
  assert.equal(F.catalogueDaysLeft('1 Day Left'), 1);
  assert.equal(F.catalogueDaysLeft('7Days Left'), 7);
  assert.ok(Math.abs(F.catalogueDaysLeft('09H:36M:22S') - (0.4 + 22 / 86400)) < 1e-10);
  assert.ok(Math.abs(F.catalogueDaysLeft('02D:03H:04M:05S') - (2 + 3 / 24 + 4 / 1440 + 5 / 86400)) < 1e-10);
  assert.equal(F.catalogueDaysLeft('00H:00M:00S'), 0);
  assert.equal(F.catalogueDaysLeft('Up to -98% From $1.35'), null);
});

test('exact Fanatical ID wins over all weaker signals', () => {
  const result = F.classify({ sourceItemId: 'product-123456', title: 'Unrelated', mediaType: 'game' }, [owned()]);
  assert.equal(result.state, 'owned');
  assert.equal(result.reason, 'exact Fanatical product ID');
});

test('compatible Steam IDs prove local ownership', () => {
  const result = F.classify({ sourceItemId: 'different-123456', title: 'Renamed Game', mediaType: 'game', externalIds: { steamAppId: '123' } }, [owned({ externalIds: { steamAppId: '123' } })]);
  assert.equal(result.state, 'owned');
  assert.equal(result.reason, 'exact Steam App ID');
});

test('ISBN identifies compatible books', () => {
  const result = F.classify({ sourceItemId: 'book-123456', title: 'A Revised Name', mediaType: 'book', externalIds: { isbn: '0-306-40615-2' } }, [owned({ mediaType: 'book', externalIds: { isbn: '9780306406157' } })]);
  assert.equal(result.state, 'owned');
  assert.equal(result.reason, 'exact ISBN');
});

test('normalization removes punctuation and normalizes Roman numerals', () => {
  assert.equal(F.titleKey("The Hero's Journey, Vol. II"), 'heros journey vol 2');
  assert.equal(F.classify({ title: "Hello, World!: A Programmer's Guide", mediaType: 'book' }, [owned({ title: 'Hello World A Programmers Guide', mediaType: 'book' })]).state, 'possible');
});

test('game edition relationships are possible rather than owned', () => {
  const result = F.classify({ title: 'Space Adventure Deluxe Edition', mediaType: 'game' }, [owned({ title: 'Space Adventure', mediaType: 'game' })]);
  assert.equal(result.state, 'possible');
});

test('book editions are possible rather than owned', () => {
  const result = F.classify({ title: 'Systems Design, 2nd Edition', mediaType: 'book' }, [owned({ title: 'Systems Design', mediaType: 'book' })]);
  assert.equal(result.state, 'possible');
});

test('only explicitly enumerable collections may be partial', () => {
  const result = F.classify({ title: 'Trilogy', mediaType: 'book', components: [
    { sourceItemId: 'product-123456', title: 'One', mediaType: 'book' },
    { sourceItemId: 'other-123456', title: 'Two', mediaType: 'book' }
  ] }, [owned()]);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { state: 'partial', provenance: 'fanatical', owned: 1, total: 2, reason: 'some enumerable components owned' });
});

test('different media types cannot be owned by title or ISBN', () => {
  assert.equal(F.classify({ title: 'Example Game', mediaType: 'book' }, [owned()]).state, 'new');
});

test('Galactic exact matches are owned elsewhere, never Fanatical owned', () => {
  const result = F.mergeGalactic({ state: 'new', provenance: null }, { matches: [{ provider: 'steam', ownership: 'owned' }] });
  assert.equal(result.state, 'owned-elsewhere'); assert.equal(result.provenance, 'steam'); assert.equal(result.reason, 'exact Galactic Library match');
});

test('local ownership remains authoritative over Galactic data', () => {
  const local = { state: 'owned', provenance: 'fanatical' };
  assert.equal(F.mergeGalactic(local, { matches: [{ provider: 'steam', ownership: 'owned' }] }), local);
});

test('MATCH_ITEMS candidates include only Galactic-supported media with stable request IDs', () => {
  const requests = F.galacticRequestItems([
    { sourceItemId: 'game-123456', title: 'Game', mediaType: 'game' },
    { sourceItemId: 'book-123456', title: 'Comic', mediaType: 'comic' },
    { sourceItemId: 'audio-123456', title: 'Audio', mediaType: 'audio' },
    { sourceItemId: 'software-123456', title: 'App', mediaType: 'software' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
    { requestId: 'game-123456', title: 'Game', mediaType: 'game', excludeProviders: ['fanatical'] },
    { requestId: 'book-123456', title: 'Comic', mediaType: 'book', excludeProviders: ['fanatical'] }
  ]);
});

test('badge upsert clears a stale badge when a SPA reuses a card for another product', () => {
  const nodes = [];
  const document = { createElement: () => ({ dataset: {}, setAttribute() {}, remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); } }) };
  const card = { querySelectorAll: () => [...nodes], append: (node) => nodes.push(node) };
  const testContext = { globalThis: null, document }; testContext.globalThis = testContext; vm.createContext(testContext);
  vm.runInContext(fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), testContext);
  testContext.FanaticalLibrary.upsertBadge(card, 'product-123456', { state: 'new' });
  testContext.FanaticalLibrary.upsertBadge(card, 'product-654321', { state: 'owned' });
  assert.equal(nodes.length, 1); assert.equal(nodes[0].textContent, 'Owned'); assert.equal(nodes[0].dataset.fanaticalLibraryFor, 'product-654321');
});

test('badge can be placed on a stable cover host while the whole card receives state classes', () => {
  const nodes = [];
  const document = { createElement: () => ({ dataset: {}, setAttribute() {}, remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); } }) };
  const classNames = new Set(); const host = { querySelectorAll: () => [...nodes], append: (node) => nodes.push(node), classList: { add: (...names) => names.forEach((name) => classNames.add(name)) } };
  const card = { classList: { add: (...names) => names.forEach((name) => classNames.add(name)), remove() {} }, dataset: {}, title: '' };
  const testContext = { globalThis: null, document }; testContext.globalThis = testContext; vm.createContext(testContext);
  vm.runInContext(fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), testContext);
  testContext.FanaticalLibrary.upsertBadge(card, 'product-123456', { state: 'owned', reason: 'exact Fanatical product ID' }, host);
  assert.equal(nodes.length, 1); assert.equal(classNames.has('fanatical-library-card-owned'), true); assert.equal(classNames.has('fanatical-library-badge-host'), true);
});

test('rebinding removes an obsolete hover-overlay badge before adding the stable-cover badge', () => {
  const nodes = [{ dataset: { fanaticalLibraryFor: 'product-123456' }, remove() { this.removed = true; } }];
  const document = { createElement: () => ({ dataset: {}, setAttribute() {}, remove() {} }) };
  const host = { querySelectorAll: () => [], append: (node) => nodes.push(node), classList: { add() {} } };
  const overlay = { dataset: { fanaticalLibraryBadge: 'New' }, classList: { remove() {} }, removeAttribute() {} };
  const card = { querySelectorAll: (selector) => selector === '[data-fanatical-library-for]' ? [nodes[0]] : [overlay], classList: { add() {}, remove() {} }, dataset: {}, title: '' };
  const testContext = { globalThis: null, document }; testContext.globalThis = testContext; vm.createContext(testContext);
  vm.runInContext(fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), testContext);
  testContext.FanaticalLibrary.upsertBadge(card, 'product-123456', { state: 'owned' }, host);
  assert.equal(nodes[0].removed, true); assert.equal(nodes.length, 2);
});
