import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
const F = globalThis.FanaticalLibrary;
const unit = (number, extra = {}) => ({ series: 'Saga', run: '2020', language: 'en', unitType: 'issue', number: String(number), completeness: 'full', ...extra });
const product = (entries, extra = {}) => ({ sourceItemId: 'offer-123456', title: 'Saga collection', mediaType: 'book', contents: entries, contentsComplete: true, ...extra });
const record = (extra = {}) => ({ provider: 'kindle', title: 'Other collection', itemRef: 'opaque', ownership: 'owned', relationship: 'contains', evidence: { source: 'Reviewed contents', checkedAt: '2026-09-30' }, ...extra });

test('reading context queries intervening units without inventing whole-product ownership', () => {
  const targets = F.readingTargets([product([unit(1), unit(3)])]);
  assert.deepEqual(targets.queries[0].entries.map(entry => entry.number), ['1', '3', '2']);
  const request = F.galacticRequestItems([targets.queries[0].item])[0];
  assert.equal(request.contentsComplete, false); assert.deepEqual(request.excludeProviders, ['fanatical']);
  const coverage = F.readingCoverage(targets, [], () => ({ matches: [], coverage: { covered: [{ ...unit(2), evidence: [record()] }], possibleCovered: [], missing: [] } }), true)[0];
  assert.equal(coverage.coverage.owned, 1);
  assert.equal(coverage.offeredKeys.has(F.contentKey(unit(2))), false);
  assert.equal(coverage.lookupIncomplete, false);
});
test('different runs, languages and unit types keep separate reading sequences', () => {
  const entries = [unit(1), unit(3), unit(1, { run: '2021' }), unit(1, { language: 'ja' }), unit(1, { unitType: 'annual' }), unit('special', { unitType: 'special' })];
  const targets = F.readingTargets([product(entries)]);
  assert.equal(targets.queries.length, 5);
  assert.equal(targets.queries.find(query => query.item.contents[0].unitType === 'annual').entries.length, 1);
});
test('unconfirmed scope does not generate misleading reading gaps', () => {
  const targets = F.readingTargets([product([unit(1, { run: '' }), unit(3, { language: '' })])]);
  assert.equal(targets.queries.length, 0); assert.equal(targets.unknownScope, 2);
});
test('parenthetical edition labels are not silently treated as confirmed series runs', () => {
  const target = F.offerContents({ title: 'Saga (Deluxe) #1-3', language: 'en' });
  assert.equal(target.entries[0].run, '');
  assert.equal(F.readingTargets([{ title: 'Saga (Deluxe) #1-3', language: 'en' }]).unknownScope, 3);
});
test('confirmed offered editions contribute explicit catalog contents to reading coverage, never title-derived ranges', () => {
  const item = product([unit(1), unit(2)]);
  const source = record({ relationship: 'same-edition', title: item.title });
  const match = F.resolveProduct(item, [], [], () => ({ matches: [source] }));
  const evidence = F.editionContentsEvidence([match]);
  const row = F.readingCoverage(F.readingTargets([item]), evidence, () => ({ matches: [], coverage: { covered: [], possibleCovered: [], missing: item.contents } }), true)[0];
  assert.equal(row.coverage.owned, 2);
  assert.match(row.coverage.covered[0].evidence[0].reason, /Confirmed offered edition/);
  const titleOnly = { ...match, offered: { sourceItemId: 'range', title: 'Saga (2020) #1-2', mediaType: 'book', language: 'en' } };
  assert.equal(F.editionContentsEvidence([titleOnly]).length, 0);
});
test('large spans and total context queries stay bounded and disclose incomplete range coverage', () => {
  const targets = F.readingTargets([product([unit(1), unit(100000)])]);
  assert.equal(targets.limited, true); assert.equal(targets.queries[0].entries.length, 2);
  const many = F.readingTargets(Array.from({ length: 30 }, (_, index) => product([unit(1, { series: `Series ${index}` }), unit(1999, { series: `Series ${index}` })])));
  assert.ok(many.queries.reduce((total, query) => total + query.entries.length, 0) <= 20000);
  assert.equal(many.limited, true);
});
test('missing old-version contents coverage never confirms a gap or added-unit value', () => {
  const item = product([unit(1), unit(3)]); const targets = F.readingTargets([item]);
  const legacy = { matches: [] };
  assert.equal(F.readingCoverage(targets, [], () => legacy, true)[0].lookupIncomplete, true);
  const resolved = F.resolveProduct(item, [], [], () => legacy);
  assert.equal(resolved.contentsLookupIncomplete, true);
  assert.equal(F.bundleContents({ products: [item], groups: [], kind: 'standard' }, [resolved]).additional.length, 0);
});
test('temporary or unknown central ownership produces actionable reminders without fake expiry dates', () => {
  for (const ownership of ['unknown', 'subscription', 'borrowed', 'rental']) {
    const reminders = F.centralReminders([{ state: 'possible', externalResult: { matches: [record({ ownership })] } }], Date.parse('2026-10-01'));
    assert.equal(reminders[0].type, 'ownership'); assert.ok(reminders[0].text.includes(ownership));
    if (ownership !== 'unknown') assert.match(reminders[0].text, /Expiry dates are unavailable/);
  }
});
test('old and undated central evidence produces reminders, never revokes permanent ownership', () => {
  const older = record({ evidence: { source: 'Review', checkedAt: '2026-01-01' }, verifiedAt: '2026-02-01' });
  const match = { state: 'owned-elsewhere', externalResult: { matches: [older], partialMatches: [older] } };
  const reminders = F.centralReminders([match, match], Date.parse('2026-10-01'));
  assert.deepEqual(reminders.map(row => row.type), ['freshness', 'contents']);
  assert.equal(match.state, 'owned-elsewhere'); assert.match(reminders[0].text, /does not revoke/);
  const unknown = F.centralReminders([{ externalResult: { matches: [record({ evidence: {} })] } }]);
  assert.match(unknown[0].text, /date unavailable/);
  assert.equal(JSON.stringify(reminders).includes('opaque'), false);
});
test('lookup retries enforce timeouts and malformed coverage stays incomplete', async () => {
  const requests = [{ requestId: 'a' }];
  const timeout = await F.queryGalacticItems(requests, () => new Promise(() => {}), 5);
  assert.equal(timeout.failed.size, 1);
  const malformed = await F.queryGalacticItems(requests, async () => ({ ok: true, apiVersion: 1, results: [{ requestId: 'a', matches: [], coverage: { covered: 'bad' } }] }));
  assert.equal(malformed.failed.size, 1);
});
test('large local libraries reuse indexes while matching each offered issue independently', () => {
  const library = Array.from({ length: 20000 }, (_, index) => ({ sourceItemId: `issue-${index}`, title: `Saga #${index + 1}`, mediaType: 'book', run: '2020', language: 'en' }));
  const contents = F.localContents(library);
  for (let index = 1; index <= 30; index++) {
    assert.equal(F.classify({ title: `Saga #${index}`, mediaType: 'book' }, library).state, 'owned');
    assert.equal(F.coverageFor(F.offerContents(product([unit(index)])), contents, null).owned, 1);
  }
});
