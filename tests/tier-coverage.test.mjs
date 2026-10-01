import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';

const { standardTierCoverage } = globalThis.FanaticalLibrary;
const product = (id) => ({ sourceItemId: id, title: id });
const tier = (price, ids) => ({ price: { USD: price }, products: ids.map(product) });
function coverage(groups, states) {
  const products = groups.flatMap((group) => group.products);
  return standardTierCoverage({ groups, products }, products.map((item) => ({ state: states[item.sourceItemId] })));
}

test('$1 remains recommended when $10 adds only owned items', () => {
  const result = coverage([tier(100, ['new']), tier(1000, ['owned'])], { new: 'new', owned: 'owned' });
  assert.equal(result.recommendedPrice, 100);
  assert.deepEqual(result.tiers.map(({ confirmedNew, total }) => ({ confirmedNew, total })), [{ confirmedNew: 1, total: 1 }, { confirmedNew: 1, total: 2 }]);
});

test('recommendation covers every confirmed-new product, not only the first one', () => {
  const result = coverage([tier(100, ['new-1']), tier(500, ['new-2']), tier(1000, ['owned'])], { 'new-1': 'new', 'new-2': 'new', owned: 'owned' });
  assert.equal(result.recommendedPrice, 500);
});

test('higher-tier owned-elsewhere, possible and partial items do not raise the recommendation', () => {
  const result = coverage([tier(100, ['new']), tier(1000, ['external', 'possible', 'partial'])], { new: 'new', external: 'owned-elsewhere', possible: 'possible', partial: 'partial' });
  assert.equal(result.recommendedPrice, 100);
});

test('tiers are considered by numeric price, regardless of API order', () => {
  assert.equal(coverage([tier('1000', ['owned']), tier('100', ['new'])], { new: 'new', owned: 'owned' }).recommendedPrice, 100);
});

test('repeated products in cumulative tier responses count only once', () => {
  const result = coverage([tier(100, ['new']), tier(1000, ['new', 'new', 'owned'])], { new: 'new', owned: 'owned' });
  assert.equal(result.recommendedPrice, 100);
  assert.equal(result.tiers[1].confirmedNew, 1);
  assert.equal(result.tiers[1].total, 2);
});

test('no confirmed-new products means no purchase recommendation', () => {
  assert.equal(coverage([tier(100, ['owned', 'possible', 'partial'])], { owned: 'owned', possible: 'possible', partial: 'partial' }).recommendedPrice, null);
  assert.equal(coverage([], {}).recommendedPrice, null);
});

test('unknown or invalid prices are not treated as free; explicit zero is valid', () => {
  for (const price of [undefined, null, '', ' ', false, -1, Infinity, 'invalid']) {
    assert.equal(coverage([tier(price, ['new'])], { new: 'new' }).recommendedPrice, null);
  }
  assert.equal(coverage([tier(0, ['new']), tier(1000, ['owned'])], { new: 'new', owned: 'owned' }).recommendedPrice, 0);
});

test('a priced tier cannot cover a new product available only in an unpriced tier', () => {
  assert.equal(coverage([tier(100, ['new-1']), tier(null, ['new-2'])], { 'new-1': 'new', 'new-2': 'new' }).recommendedPrice, null);
});
