import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
const F = globalThis.FanaticalLibrary;
const unit = (number, extra = {}) => ({ series: 'Saga', run: '2020', language: 'en', unitType: 'issue', number: String(number), completeness: 'full', ...extra });
const product = (id, numbers, extra = {}) => ({ sourceItemId: id, title: id, mediaType: 'book', contents: numbers.map(unit), contentsComplete: true, ...extra });
const resolve = (item, covered = [], possible = [], extra = {}) => ({ state: covered.length ? 'partial' : 'new', offered: item,
  coverage: { covered: covered.map(unit), possibleCovered: possible.map(unit), missing: item.contents.filter(entry => !covered.includes(Number(entry.number))), total: item.contents.length, owned: covered.length }, ...extra });
const parsed = (products, extra = {}) => ({ kind: 'standard', products, groups: [], ...extra });

test('overlapping collections add distinct issues once and subtract union ownership', () => {
  const first = product('first', [1, 2, 3]); const second = product('second', [2, 3, 4]);
  const result = F.bundleContents(parsed([first, second]), [resolve(first, [1, 2]), resolve(second, [2])]);
  assert.deepEqual(result.additional.map(entry => entry.number), ['3', '4']);
  assert.deepEqual(result.covered.map(entry => entry.number), ['1', '2']);
});
test('scope uncertainty and incomplete lookups stay out of additional-content totals', () => {
  const first = product('first', [1, 2]);
  assert.equal(F.bundleContents(parsed([first]), [resolve(first, [], [], { lookupIncomplete: true })]).additional.length, 0);
  const unknown = product('unknown', [1, 2], { contents: [unit(1, { run: '' }), unit(2, { language: '' })] });
  const uncertain = F.bundleContents(parsed([unknown]), [resolve(unknown)]);
  assert.equal(uncertain.additional.length, 0); assert.equal(uncertain.uncertain.length, 2);
  const possible = F.bundleContents(parsed([first]), [resolve(first, [], [1])]);
  assert.equal(possible.additional.length, 1); assert.equal(possible.uncertain.length, 1);
});
test('whole owned products contribute explicit contents but title-derived collections supply no assertion', () => {
  const owned = product('owned', [1, 2]); const offer = product('offer', [2, 3]);
  const result = F.bundleContents(parsed([owned, offer]), [resolve(owned, [], [], { state: 'owned-elsewhere' }), resolve(offer)]);
  assert.deepEqual(result.additional.map(entry => entry.number), ['3']);
  const titleOnly = { sourceItemId: 'range', title: 'Saga (2020) #1-2', mediaType: 'book', language: 'en' };
  const range = F.bundleContents(parsed([titleOnly]), [{ state: 'owned', offered: titleOnly }]);
  assert.equal(range.covered.length, 0); assert.equal(range.additional.length, 0); assert.equal(range.uncertain.length, 2);
});
test('different runs, languages, annuals and fractions stay distinct', () => {
  const item = product('units', [], { contents: [unit(1), unit(1, { run: '2021' }), unit(1, { language: 'ja' }), unit(1, { unitType: 'annual' }), unit('1/2'), unit('0.5')] });
  assert.equal(F.bundleContents(parsed([item]), [resolve(item)]).additional.length, 5);
});
test('tier counts are cumulative by numeric price and overlapping units count once', () => {
  const cheap = product('cheap', [1, 2]); const higher = product('higher', [2, 3]);
  const result = F.bundleContents(parsed([cheap, higher], { groups: [{ price: { USD: 1000 }, products: [higher, cheap] }, { price: { USD: 100 }, products: [cheap] }] }), [resolve(cheap), resolve(higher)]);
  assert.deepEqual(result.tiers.map(tier => [tier.price, tier.additional]), [[100, 2], [1000, 3]]);
});
test('Pick & Mix reports only available pool units and selected subsets', () => {
  const available = product('available', [1, 2]); const sold = product('sold', [3], { availability: { soldOut: true } });
  const region = product('region', [4], { availability: { regionAvailable: false } });
  const result = F.bundleContents(parsed([available, sold, region], { kind: 'pick-mix' }), [resolve(available), resolve(sold), resolve(region)]);
  assert.equal(result.additional.length, 2);
  assert.equal(F.bundleContents(parsed([available], { kind: 'pick-mix' }), [resolve(available)]).additional.length, 2);
});
test('offers without enumerable contents are disclosed instead of assigned a zero-content value', () => {
  const item = { sourceItemId: 'unknown', title: 'Unnumbered omnibus', mediaType: 'book' };
  const result = F.bundleContents(parsed([item]), [{ state: 'possible', offered: item }]);
  assert.equal(result.noContentsProducts, 1); assert.equal(result.additional.length, 0);
});
