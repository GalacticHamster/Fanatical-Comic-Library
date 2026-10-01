import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
import { createLibraryBackup, parseLibraryBackup } from '../src/library-data.mjs';
const F = globalThis.FanaticalLibrary;
const unit = (number, extra = {}) => ({ series: 'Saga', run: '2020', language: 'en', unitType: 'issue', number: String(number), completeness: 'full', ...extra });
const record = (extra = {}) => ({ provider: 'kindle', title: 'Owned collection', itemRef: 'opaque', ownership: 'owned', relationship: 'contains', evidence: { source: 'Reviewed contents', checkedAt: '2026-09-30' }, ...extra });
const product = (extra = {}) => ({ sourceItemId: 'product-123456', title: 'Saga collection', mediaType: 'book', contents: [unit(1), unit(2)], contentsComplete: true, ...extra });

test('Unicode titles remain distinct and meaningful package labels survive normalization', () => {
  assert.equal(F.normalizeTitle('進撃の巨人 Vol. 1'), '進撃の巨人 vol 1');
  assert.notEqual(F.titleKey('進撃の巨人'), F.titleKey('鋼の錬金術師'));
  for (const edition of ['Deluxe', 'Gold', 'Platinum', 'Ultimate']) {
    const base = { sourceItemId: 'base-123456', title: 'Hades', mediaType: 'game' };
    const variant = { sourceItemId: 'other-123456', title: `Hades ${edition} Edition`, mediaType: 'game' };
    assert.equal(F.classify(base, [variant]).state, 'possible');
    assert.equal(F.classify(variant, [base]).state, 'possible');
  }
});
test('first versus fifth editions and different valid ISBNs remain Possible in both directions', () => {
  const first = { sourceItemId: 'first-123456', title: 'Dune First Edition', mediaType: 'book', externalIds: { isbn: '9780306406157' } };
  const later = { sourceItemId: 'later-123456', title: 'Dune 5th Edition', mediaType: 'book', externalIds: { isbn: '9780140328721' } };
  assert.equal(F.classify(first, [later]).state, 'possible');
  assert.equal(F.classify(later, [first]).state, 'possible');
  assert.match(F.classify(first, [later]).reason, /Dune 5th Edition/);
});
test('homonyms, different authors and numbered volumes cannot become Owned from lossy titles', () => {
  const offer = { title: 'Echo', mediaType: 'book', authors: ['Author A'] };
  const unrelated = { sourceItemId: 'other-123456', title: 'Echo', mediaType: 'book', authors: ['Author B'] };
  assert.equal(F.classify(offer, [unrelated]).state, 'new');
  assert.equal(F.classify({ title: 'Echo', mediaType: 'book' }, [unrelated, { ...unrelated, sourceItemId: 'third-123456', authors: ['Author C'] }]).state, 'possible');
  assert.equal(F.classify({ title: 'Saga Vol. 2', mediaType: 'book' }, [{ ...unrelated, title: 'Saga Vol. 1' }]).state, 'new');
  assert.equal(F.classify({ title: 'Other work', mediaType: 'book', authors: ['Author B'] }, [unrelated]).state, 'new');
});
test('invalid ISBNs cannot establish identity or enter central identifiers', () => {
  assert.equal(F.validIsbn('9781234567890'), '');
  assert.equal(F.validIsbn('0306406152'), '9780306406157');
  const request = F.galacticRequestItems([product({ externalIds: { isbn: '9781234567890' } })])[0];
  assert.equal(request.identifiers, undefined);
});
test('requests transfer bibliographic evidence and explicit contents without purchase-bearing leaves', () => {
  const request = F.galacticRequestItems([product({ externalIds: { isbn: '0306406152' }, authors: ['Writer'], run: '2020', language: 'en', key: 'SECRET', bundle: { sourceItemId: 'SECRET' } })])[0];
  assert.deepEqual(request.identifiers, { isbn: '9780306406157' });
  assert.deepEqual(request.excludeProviders, ['fanatical']);
  assert.equal(request.contentsComplete, true);
  assert.equal(JSON.stringify(request).includes('SECRET'), false);
});
test('catalog identity survives backup round trips while unknown nested fields do not', () => {
  const item = { source: 'fanatical', ...product(), authors: ['Writer'], run: '2020', language: 'en', publisher: 'Publisher', token: 'SECRET' };
  const restored = parseLibraryBackup(createLibraryBackup([item]));
  assert.deepEqual(restored[0].authors, ['Writer']);
  assert.equal(restored[0].run, '2020');
  assert.equal(JSON.stringify(restored).includes('SECRET'), false);
});
test('exact central evidence can resolve local Possible or Partial while retaining both evidence sets', () => {
  const offer = product(); const exact = record({ title: offer.title, relationship: 'same-edition' });
  for (const state of ['possible', 'partial']) {
    const local = { state, item: { title: 'Old edition' } };
    const resolved = F.mergeGalactic(local, { matches: [exact] }, offer);
    assert.equal(resolved.state, 'owned-elsewhere');
    assert.equal(resolved.item.title, offer.title);
    assert.equal(resolved.localMatch, local);
  }
});
test('same-work, contains and temporary exact records cannot imply ownership of an offered edition', () => {
  for (const row of [record({ relationship: 'same-work' }), record(), record({ relationship: 'same-edition', ownership: 'subscription' })]) {
    assert.equal(F.mergeGalactic({ state: 'new' }, { matches: [row] }, product()).state, 'possible');
  }
  assert.equal(F.mergeGalactic({ state: 'new' }, { matches: [record({ provider: 'fanatical', relationship: 'same-edition' })] }, product()).state, 'new');
});
test('coverage unions scoped local and central contents, including fraction equivalence', () => {
  const local = F.localContents([{ sourceItemId: 'local-123456', title: 'Saga #1', run: '2020', language: 'en' }]);
  const result = { coverage: { covered: [{ ...unit(2), evidence: [record()] }] } };
  const coverage = F.coverageFor(F.offerContents(product()), local, result);
  assert.equal(coverage.owned, 2); assert.equal(coverage.complete, true);
  assert.equal(F.mergeGalactic({ state: 'new' }, result, product(), coverage).state, 'owned-elsewhere');
  assert.equal(F.contentKey(unit('1/2')), F.contentKey(unit('0.5')));
});
test('full title-range coverage remains Partial without a complete product contents assertion', () => {
  const offer = product({ title: 'Saga (2020) #1-2', contents: undefined, contentsComplete: false, language: 'en' });
  const target = F.offerContents(offer);
  assert.equal(target.entries.length, 2); assert.equal(target.complete, false);
  const coverage = F.coverageFor(target, [], { coverage: { covered: target.entries.map(entry => ({ ...entry, evidence: [record()] })) } });
  assert.equal(F.mergeGalactic({ state: 'new' }, {}, offer, coverage).state, 'partial');
  assert.equal(F.localContents([{ ...offer, source: 'fanatical' }]).length, 0);
});
test('unknown run/language, excerpts, rentals and incompatible scope never supply full coverage', () => {
  const target = F.offerContents(product());
  for (const entry of [unit(1, { run: '' }), unit(1, { language: '' }), unit(1, { run: '2021' }), unit(1, { completeness: 'excerpt' })]) {
    assert.equal(F.coverageFor(target, [], { coverage: { covered: [{ ...entry, evidence: [record()] }] } }).owned, 0);
  }
  assert.equal(F.coverageFor(target, [], { coverage: { covered: [{ ...unit(1), evidence: [record({ ownership: 'rental' })] }] } }).owned, 0);
});
test('enumerated game components resolve across local and central ownership', () => {
  const local = { sourceItemId: 'base-123456', title: 'Hades', mediaType: 'game' };
  const extra = { sourceItemId: 'extra-123456', title: 'Hades soundtrack', mediaType: 'game' };
  const offer = { sourceItemId: 'offer-123456', title: 'Hades Deluxe Edition', mediaType: 'game', components: [local, extra] };
  const lookup = item => item === extra ? { matches: [record({ title: extra.title, relationship: 'same-edition', provider: 'steam' })] } : null;
  assert.equal(F.resolveProduct(offer, [local], [], lookup).state, 'partial');
  assert.equal(F.resolveProduct({ ...offer, componentsComplete: true }, [local], [], lookup).state, 'owned-elsewhere');
});
test('batch limits apply to both item counts and total contents, including large catalogs', () => {
  const rows = Array.from({ length: 501 }, (_, index) => ({ requestId: String(index), title: 'Title', mediaType: 'book' }));
  assert.deepEqual(F.galacticBatches(rows).map(batch => batch.length), [500, 1]);
  assert.deepEqual(F.galacticBatches(rows.slice(0, 12).map(row => ({ ...row, contents: Array(2000).fill(unit(1)) }))).map(batch => batch.length), [10, 2]);
});
test('failed, missing, duplicate and incompatible responses remain failures and can be retried', async () => {
  const requests = [{ requestId: 'a' }, { requestId: 'b' }];
  for (const reply of [{ ok: false }, { ok: true, apiVersion: 2, results: [] }, { ok: true, apiVersion: 1, results: [] }]) {
    const lookup = await F.queryGalacticItems(requests, async () => reply);
    assert.equal(lookup.results.size, 0); assert.equal(lookup.failed.size, 2);
  }
  const partial = await F.queryGalacticItems(requests, async () => ({ ok: true, apiVersion: 1, results: [{ requestId: 'a', matches: [] }] }));
  assert.equal(partial.results.size, 1); assert.deepEqual([...partial.failed], ['b']);
  const retried = await F.queryGalacticItems(requests.filter(item => partial.failed.has(item.requestId)), async () => ({ ok: true, apiVersion: 1, results: [{ requestId: 'b', matches: [] }] }));
  assert.equal(retried.failed.size, 0);
});
test('a later successful batch does not erase earlier failures', async () => {
  const requests = Array.from({ length: 501 }, (_, index) => ({ requestId: String(index) }));
  let count = 0;
  const lookup = await F.queryGalacticItems(requests, async message => ++count === 1 ? { ok: false } : { ok: true, apiVersion: 1, results: message.items.map(item => ({ requestId: item.requestId, matches: [] })) });
  assert.equal(lookup.failed.size, 500); assert.equal(lookup.results.size, 1);
});
test('shipped Fanatical requests and resolver integrate with the current Galactic Library API', async t => {
  let handle; let titleKey;
  try { ({ handleExternalApiRequest: handle } = await import('../../GalacticLibrary/src/lib/external-api.js')); ({ titleKey } = await import('../../GalacticLibrary/src/lib/normalization.js')); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') { t.skip('Adjacent Galactic Library checkout unavailable'); return; } throw error; }
  const item = record();
  const db = { providerItems: { central: { id: 'central', recordRef: 'opaque', provider: 'kindle', title: item.title, normalizedTitle: titleKey(item.title), mediaType: 'book', ownership: 'owned', metadata: {} } },
    contentReviews: { central: { entries: [unit(1), unit(2)], verifiedAt: '2026-09-30' } } };
  const request = F.galacticRequestItems([product()])[0];
  const response = handle(db, { type: 'MATCH_ITEMS', apiVersion: 1, items: [request] });
  assert.equal(response.ok, true);
  const resolved = F.resolveProduct(product(), [], [], () => response.results[0]);
  assert.equal(resolved.coverage.owned, 2);
  assert.equal(resolved.state, 'owned-elsewhere');
});
