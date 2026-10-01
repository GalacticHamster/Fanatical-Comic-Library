import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { safeId, validateScanResult } from '../src/library-data.mjs';

const source = fs.readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/mu, '');
const orderId = 'order-123456';
const fingerprint = (id) => createHash('sha256').update(id).digest('hex');
const detail = { _id: orderId, status: 'COMPLETE', items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [{ games: [{ _id: 'product-123456', name: 'New purchase', type: 'game' }] }] }] };
const summary = { _id: orderId, status: 'COMPLETE', items: [{ name: 'Bundle', bundles: [{ games: [{ name: 'New purchase' }] }] }] };
const previous = { fanaticalLibraryItems: [{ source: 'fanatical', sourceItemId: 'product-654321', title: 'Previously imported', mediaType: 'game', bundle: { sourceItemId: 'bundle-654321', title: 'Previous bundle' } }], fanaticalImportSummary: { importedAt: 'previous', scanMode: 'full' }, fanaticalScannedOrderFingerprints: [] };

function harness({ list = [summary], details = { [orderId]: detail }, headers = {}, status = 200, invalidJSON = false, known = [], scriptResult } = {}) {
  const stored = structuredClone({ ...previous, fanaticalScannedOrderFingerprints: known });
  const before = structuredClone(stored); const writes = []; const paths = [];
  const page = { TextEncoder, crypto: webcrypto, localStorage: { getItem: () => JSON.stringify({ token: 'SECRET-TOKEN' }) }, fetch: async (url) => {
    paths.push(url);
    return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => {
      if (invalidJSON) throw new Error('SECRET raw invalid JSON');
      return structuredClone(url === '/api/user/orders' ? list : details[url.split('/').at(-1)]);
    } };
  } };
  const chrome = { runtime: { onMessage: { addListener() {} } }, tabs: { query: async () => [{ id: 1, url: 'https://www.fanatical.com/en/orders' }] }, storage: { local: {
    get: async (defaults) => ({ ...defaults, ...structuredClone(stored) }),
    set: async (changes) => { writes.push(structuredClone(changes)); Object.assign(stored, structuredClone(changes)); }
  } }, scripting: { executeScript: async ({ func, args }) => {
    if (scriptResult) return scriptResult();
    // Execute the serialized function in a separate page world, just like Chrome.
    const mainWorld = vm.runInNewContext(`(${func.toString()})`, page);
    return [{ result: await mainWorld(...args) }];
  } } };
  const worker = vm.runInNewContext(`${source}\n;({ importPurchases });`, { chrome, safeId, validateScanResult });
  return { stored, before, writes, paths, scan: (fullScan = true) => worker.importPurchases({ fullScan }) };
}

test('HTTP-success malformed order lists never alter purchases, summary or fingerprints', async () => {
  for (const list of [null, {}, { orders: [] }, { error: 'SECRET' }, 'unreadable', [null], [{ _id: orderId }], [{ status: 'COMPLETE' }], [{ _id: 123456, status: 'COMPLETE' }], [summary, summary]]) {
    for (const full of [true, false]) {
      const run = harness({ list });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(run.stored, run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('invalid JSON, partial HTTP success and pagination indicators preserve the library', async () => {
  for (const config of [{ invalidJSON: true }, { status: 206 }, { headers: { link: '</api/user/orders?page=2>; rel="next"' } }, { headers: { link: '</api/user/orders?page=2>; rel="prev next"' } }, { headers: { 'x-total-count': '2' } }, { headers: { 'content-range': 'items 0-0/2' } }, { headers: { 'content-range': 'items 1-1/2' } }]) {
    const run = harness(config);
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(run.stored, run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('a genuine empty array is a validated empty account, not a failed read', async () => {
  const run = harness({ list: [], headers: { 'content-range': 'items */0', 'x-total-count': '0' } });
  const result = await run.scan();
  assert.equal(result.ordersScanned, 0);
  assert.equal(result.ownedLeafProducts, 0);
  assert.match(result.historyCoverage, /Valid empty order history/);
  assert.deepEqual(run.stored.fanaticalLibraryItems, []);
  assert.equal(run.paths.length, 1);
  assert.equal(run.writes.length, 1);
});

test('quick scan of a valid empty account preserves existing records rather than replacing them', async () => {
  const run = harness({ list: [] });
  await run.scan(false);
  assert.deepEqual(run.stored.fanaticalLibraryItems, run.before.fanaticalLibraryItems);
});

test('a refunded known order remains listed coverage, but is not imported as owned', async () => {
  const run = harness({ list: [{ _id: orderId, status: 'REFUNDED' }], known: [fingerprint(orderId)] });
  const result = await run.scan();
  assert.equal(result.ordersScanned, 0);
  assert.equal(run.paths.length, 1);
  assert.deepEqual(run.stored.fanaticalLibraryItems, []);
  assert.equal(result.historyCoverage.includes('Valid empty order history'), false);
});

test('a list missing known orders is not accepted as complete, even if it is an empty array', async () => {
  for (const list of [[], [summary]]) {
    const run = harness({ list, known: [fingerprint('missing-123456')] });
    await assert.rejects(run.scan(), /omits previously scanned/);
    assert.deepEqual(run.stored, run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('malformed/mismatched/non-complete details and unsupported leaf shapes cannot rebuild', async () => {
  const invalid = [null, {}, { ...detail, _id: 'different-123456' }, { ...detail, status: 'REFUNDED' }, { ...detail, items: null }, { ...detail, items: [] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle' }] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [] }] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [{ _id: 'product-123456' }] }] }] }];
  for (const broken of invalid) {
    for (const full of [true, false]) {
      const run = harness({ details: { [orderId]: broken } });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(run.stored, run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('one unreadable detail aborts the entire multi-order rebuild and quick scan', async () => {
  for (const full of [true, false]) {
    const run = harness({ list: [summary, { ...summary, _id: 'order-654321' }], details: { [orderId]: detail, 'order-654321': { error: 'SECRET' } } });
    await assert.rejects(run.scan(full));
    assert.deepEqual(run.stored, run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('nonempty details must cover every product occurrence named in their order summary', async () => {
  const incompleteSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'Missing purchase' }] }] }] };
  const duplicateSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'New purchase' }] }] }] };
  for (const list of [[incompleteSummary], [duplicateSummary]]) {
    const run = harness({ list });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(run.stored, run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('full scan validates every completed order; quick scan validates only unseen ones', async () => {
  const full = harness({ known: [fingerprint(orderId)], headers: { 'x-total-count': '1', 'content-range': 'items 0-0/1' } });
  const fullResult = await full.scan();
  assert.equal(fullResult.ordersScanned, 1);
  assert.equal(full.stored.fanaticalLibraryItems[0].title, 'New purchase');
  const quick = harness({ known: [fingerprint(orderId)] });
  const quickResult = await quick.scan(false);
  assert.equal(quickResult.ordersScanned, 0);
  assert.equal(quickResult.ordersSkipped, 1);
  assert.equal(quick.paths.length, 1);
  assert.deepEqual(quick.stored.fanaticalLibraryItems, quick.before.fanaticalLibraryItems);
});

test('worker refuses missing, partial or silently lossy MAIN-world results before storage writes', async () => {
  const receipt = { schemaVersion: 1, ordersAvailable: 1, ordersScanned: 1, coverage: { complete: true, listedOrders: 1, validatedOrders: 1, emptyAccount: false }, orderFingerprints: [fingerprint(orderId)], items: [{ source: 'fanatical', sourceItemId: 'product-123456', title: 'Purchase', bundle: { sourceItemId: 'bundle-123456', title: 'Bundle' } }] };
  const bad = [undefined, {}, { ...receipt, coverage: undefined }, { ...receipt, ordersScanned: 0 }, { ...receipt, items: [] }, { ...receipt, coverage: { ...receipt.coverage, validatedOrders: 0 } }, { ...receipt, orderFingerprints: [] }, { ...receipt, orderFingerprints: ['bad'] }, { ...receipt, items: [{ title: 'Dropped item' }] }, { ...receipt, items: [...receipt.items, ...receipt.items] }];
  for (const result of bad) {
    const run = harness({ scriptResult: () => [{ result }] });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(run.stored, run.before);
    assert.equal(run.writes.length, 0);
  }
  const noResult = harness({ scriptResult: () => [] });
  await assert.rejects(noResult.scan(), /complete result/);
  assert.equal(noResult.writes.length, 0);
});

test('scan failures expose no raw response, token or order details', async () => {
  const run = harness({ invalidJSON: true });
  await assert.rejects(run.scan(), (error) => !error.message.includes('SECRET') && /not changed/u.test(error.message));
});
