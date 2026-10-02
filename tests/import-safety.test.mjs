import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import test from 'node:test';
import { safeId, validateScanResult, createSyncStore, mergeLibraryItems } from '../src/library-data.mjs';

import {importFanaticalOrdersInPage} from '../src/order-importer.mjs';

const source = fs.readFileSync(new URL('../src/service-worker.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gmu, '');
const orderId = 'order-123456';
const fingerprint = (id) => createHash('sha256').update(id).digest('hex');
const detail = { _id: orderId, status: 'COMPLETE', items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [{ games: [{ _id: 'product-123456', name: 'New purchase', type: 'game' }] }] }] };
const summary = { _id: orderId, status: 'COMPLETE', items: [{ name: 'Bundle', bundles: [{ games: [{ name: 'New purchase' }] }] }] };
const previous = { fanaticalLibraryItems: [{ source: 'fanatical', sourceItemId: 'product-654321', title: 'Previously imported', mediaType: 'game', bundle: { sourceItemId: 'bundle-654321', title: 'Previous bundle' } }], fanaticalImportSummary: { importedAt: 'previous', scanMode: 'full' }, fanaticalScannedOrderFingerprints: [] };

function harness({ list = [summary], details = { [orderId]: detail }, headers = {}, status = 200, invalidJSON = false, known = [], scriptResult, respond, authRead=()=>'SECRET-TOKEN', pageOverrides = {} } = {}) {
  const stored = structuredClone({ ...previous, fanaticalProfileLabel:'fixture',fanaticalProfileArchives:[],fanaticalScannedOrderFingerprints: known });
  const before = structuredClone(stored); const writes = []; const paths = []; const receipts = [];
  let listener; let active = 0; let maxActive = 0;
  const page = { TextEncoder, crypto: webcrypto, URL, AbortController, setTimeout, clearTimeout, ...pageOverrides, localStorage: { getItem: () => JSON.stringify({ token:authRead() }) }, fetch: async (url, options) => {
    paths.push(url); active++; maxActive = Math.max(active, maxActive);
    let reply;
    try { reply = respond ? await respond(url, options) : { status, headers, data: url === '/api/user/orders' ? list : details[url.split('/').at(-1)] }; }
    finally { active--; }
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, headers: new Headers(reply.headers), json: async () => {
      if (invalidJSON) throw new Error('SECRET raw invalid JSON');
      return reply.json ? reply.json(options) : structuredClone(reply.data);
    } };
  } };
  const chrome = { runtime: { id:'a'.repeat(32),getURL:()=>`chrome-extension://${'a'.repeat(32)}/`, onMessage: { addListener(handler) { listener = handler; } } }, tabs: { query: async () => [{ id: 1, url: 'https://www.fanatical.com/en/orders' }] }, storage: { local: {
    get: async (defaults) => ({ ...defaults, ...structuredClone(stored) }),
    set: async (changes) => { if(Object.keys(changes).some(key=>key!=='fanaticalSyncControl'))writes.push(structuredClone(changes)); Object.assign(stored, structuredClone(changes)); }
  } }, scripting: { executeScript: async ({ func, args }) => {
    if (scriptResult) return scriptResult();
    // Execute the serialized function in a separate page world, just like Chrome.
    const mainWorld = vm.runInNewContext(`(${func.toString()})`, page);
    const result = await mainWorld(...args); receipts.push(structuredClone(result)); return [{ result }];
  } } };
  const worker = vm.runInNewContext(`${source}\n;({ importPurchases, syncStore });`, { chrome, safeId, validateScanResult, createSyncStore, mergeLibraryItems, importFanaticalOrdersInPage });
  return { stored, before, writes, paths, receipts, get maxActive() { return maxActive; }, scan: (fullScan = true) => worker.importPurchases({ fullScan,profileLabel:'fixture',confirmed:true }),
    send: (fullScan = true) => new Promise((resolve) => listener({ type: 'FANATICAL_IMPORT_PURCHASES', fullScan,profileLabel:'fixture',confirmed:true }, {id:chrome.runtime.id,url:'https://www.fanatical.com/en/orders',tab:{id:1}}, resolve)) };
}

test('HTTP-success malformed order lists never alter purchases, summary or fingerprints', async () => {
  for (const list of [null, {}, { orders: [] }, { error: 'SECRET' }, 'unreadable', [null], [{ _id: orderId }], [{ status: 'COMPLETE' }], [{ _id: 123456, status: 'COMPLETE' }], [summary, summary]]) {
    for (const full of [true, false]) {
      const run = harness({ list });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('serialized purchase importer retains only bounded bibliographic leaves for matching', async () => {
  const expanded = structuredClone(detail);
  Object.assign(expanded.items[0].bundles[0].games[0], {
    type: 'manga', authors: ['Writer', { key: 'SECRET-AUTHOR' }], language: 'en', run: '2020', series: 'Saga', issue: '1/2', edition: 'First', publisher: 'Publisher',
    token: 'SECRET-TOKEN', metadata: { downloadUrl: 'SECRET-URL' }
  });
  const run = harness({ details: { [orderId]: expanded } });
  await run.scan();
  const item = run.stored.fanaticalLibraryItems[0];
  assert.equal(item.mediaType, 'book');
  assert.deepEqual(item.authors, ['Writer']);
  assert.equal(item.run, '2020'); assert.equal(item.language, 'en'); assert.equal(item.issue, '1/2');
  assert.equal(JSON.stringify(run.receipts).includes('SECRET'), false);
  assert.equal(JSON.stringify(item).includes('SECRET'), false);
});

test('invalid JSON, partial HTTP success and unusable pagination indicators preserve the library', async () => {
  for (const config of [{ invalidJSON: true }, { status: 206 }, { headers: { link: '</api/user/orders?page=2>; rel="next"' } }, { headers: { link: '</api/user/orders?page=2>; rel="prev next"' } }, { headers: { 'x-total-count': '2' } }, { headers: { 'content-range': 'items 0-0/2' } }, { headers: { 'content-range': 'items 1-1/2' } }]) {
    const run = harness(config);
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
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
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('malformed/mismatched/non-complete details and unsupported leaf shapes cannot rebuild', async () => {
  const invalid = [null, {}, { ...detail, _id: 'different-123456' }, { ...detail, status: 'REFUNDED' }, { ...detail, items: null }, { ...detail, items: [] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle' }] }, { ...detail, items: [{ _id: 'bundle-123456', name: 'Bundle', bundles: [] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [] }] }] }, { ...detail, items: [{ ...detail.items[0], bundles: [{ games: [{ _id: 'product-123456' }] }] }] }];
  for (const broken of invalid) {
    for (const full of [true, false]) {
      const run = harness({ details: { [orderId]: broken } });
      await assert.rejects(run.scan(full), /unreadable|incomplete/);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
      assert.equal(run.writes.length, 0);
    }
  }
});

test('one unreadable detail aborts the entire multi-order rebuild and quick scan', async () => {
  for (const full of [true, false]) {
    const run = harness({ list: [summary, { ...summary, _id: 'order-654321' }], details: { [orderId]: detail, 'order-654321': { error: 'SECRET' } } });
    await assert.rejects(run.scan(full));
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
    assert.equal(run.writes.length, 0);
  }
});

test('nonempty details must cover every product occurrence named in their order summary', async () => {
  const incompleteSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'Missing purchase' }] }] }] };
  const duplicateSummary = { ...summary, items: [{ ...summary.items[0], bundles: [{ games: [{ name: 'New purchase' }, { name: 'New purchase' }] }] }] };
  for (const list of [[incompleteSummary], [duplicateSummary]]) {
    const run = harness({ list });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
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
  const receipt = { schemaVersion: 1, ordersAvailable: 1, ordersScanned: 1, coverage: { complete: true, listedOrders: 1, validatedOrders: 1, emptyAccount: false, pagesFetched: 1, expectedTotal: null, paginationEvidence: 'array-only', retries: 0, concurrency: 3 }, orderFingerprints: [fingerprint(orderId)], items: [{ source: 'fanatical', sourceItemId: 'product-123456', title: 'Purchase', bundle: { sourceItemId: 'bundle-123456', title: 'Bundle' } }] };
  const bad = [undefined, {}, { ...receipt, coverage: undefined }, { ...receipt, ordersScanned: 0 }, { ...receipt, items: [] }, { ...receipt, coverage: { ...receipt.coverage, validatedOrders: 0 } }, { ...receipt, orderFingerprints: [] }, { ...receipt, orderFingerprints: ['bad'] }, { ...receipt, items: [{ title: 'Dropped item' }] }, { ...receipt, items: [...receipt.items, ...receipt.items] }];
  for (const result of bad) {
    const run = harness({ scriptResult: () => [{ result }] });
    await assert.rejects(run.scan(), /unreadable|incomplete/);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
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

function longHistory(count = 1000, pageSize = 40) {
  const orders = Array.from({ length: count }, (_, index) => {
    const id = `order-${String(index).padStart(6, '0')}`;
    return { summary: { ...summary, _id: id }, detail: { ...detail, _id: id, items: [{ ...detail.items[0], bundles: [{ games: [{ ...detail.items[0].bundles[0].games[0], _id: `product-${String(index).padStart(6, '0')}` }] }] }] } };
  });
  const respond = async (path, options) => {
    const url = new URL(path, 'https://www.fanatical.com');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, 'SECRET-TOKEN');
    if (url.pathname === '/api/user/orders') {
      const page = Number(url.searchParams.get('page') || 1); const start = (page - 1) * pageSize;
      const data = orders.slice(start, start + pageSize).map((entry) => entry.summary);
      return { status: 200, data, headers: { 'x-total-count': String(count), 'content-range': `orders ${start}-${start + data.length - 1}/${count}`,
        ...(start + data.length < count ? { link: `</api/user/orders?page=${page + 1}>; rel="next"; title="Next, purchase page"` } : {}) } };
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
    const id = url.pathname.split('/').at(-1);
    return { status: 200, data: orders.find((entry) => entry.detail._id === id)?.detail };
  };
  return { orders, respond };
}

// Fast deterministic backoff tests: request watchdogs stay cancellable, while
// retry waits advance a virtual wall clock without real multi-second sleeps.
function retryClock({ watchdog = 1000 } = {}) {
  let now = Date.parse('2026-10-01T12:00:00Z'); const waits = [];
  const math = Object.create(Math); math.random = () => 0;
  return { waits, get now() { return now; }, pageOverrides: {
    Date: class extends Date { static now() { return now; } }, Math: math,
    setTimeout(callback, ms) {
      if (ms === 20000) return setTimeout(callback, watchdog);
      waits.push(ms); return setTimeout(() => { now += ms; callback(); }, 0);
    }
  } };
}

test('1,000 orders across 25 pages validate with no more than three detail fetches in flight', async () => {
  const run = harness(longHistory());
  const result = await run.scan();
  assert.equal(result.ordersScanned, 1000); assert.equal(result.ownedLeafProducts, 1000);
  assert.equal(result.coverage.pagesFetched, 25); assert.equal(result.coverage.expectedTotal, 1000);
  assert.equal(result.coverage.paginationEvidence, 'range'); assert.equal(run.maxActive, 3);
  assert.equal(run.paths.length, 1025); assert.equal(run.writes.length, 1);
  assert.equal(run.stored.fanaticalScannedOrderFingerprints.length, 1000);
  assert.equal(JSON.stringify(run.stored).includes('SECRET'), false);
  assert.equal(JSON.stringify(run.stored).includes('order-000'), false);
});

test('quick scan traverses the entire long history but fetches only unseen completed orders', async () => {
  const history = longHistory(); const known = history.orders.slice(0, 995).map(({ summary: order }) => fingerprint(order._id));
  const run = harness({ ...history, known }); const result = await run.scan(false);
  assert.equal(result.ordersScanned, 5); assert.equal(result.ordersSkipped, 995);
  assert.equal(result.coverage.pagesFetched, 25); assert.equal(run.paths.length, 30);
  assert.equal(run.stored.fanaticalLibraryItems.length, 6); assert.equal(run.maxActive, 3);
});

test('explicit same-endpoint cursor links can complete without inventing query conventions', async () => {
  const secondId = 'order-654321';
  const run = harness({ respond: async (path) => {
    if (path === '/api/user/orders') return { status: 200, data: [summary], headers: { link: '<https://www.fanatical.com/api/user/orders?cursor=SECRET-CURSOR>; rel="next"' } };
    if (path.includes('?cursor=')) return { status: 200, data: [{ ...summary, _id: secondId }] };
    return { status: 200, data: { ...detail, _id: path.split('/').at(-1) } };
  } });
  const result = await run.scan();
  assert.equal(result.coverage.pagesFetched, 2); assert.equal(result.coverage.paginationEvidence, 'link');
  assert.match(result.historyCoverage, /no independent history total/);
  assert.equal(JSON.stringify(run.receipts).includes('SECRET'), false);
});

test('bare-array coverage explicitly discloses that silent truncation cannot be verified', async () => {
  const run = harness(); const result = await run.scan();
  assert.equal(result.coverage.paginationEvidence, 'array-only');
  assert.match(result.historyCoverage, /silent server truncation/);
});

test('pagination loops, repeated orders, gaps, changing totals, missing next links and unreadable pages never commit', async () => {
  const second = { ...summary, _id: 'order-654321' };
  const cases = [
    [{ data: [summary], headers: { link: '</api/user/orders>; rel="next"' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: [summary] }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'content-range': 'orders 0-0/3' } }, { data: [second], headers: { 'content-range': 'orders 2-2/3' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'x-total-count': '2' } }, { data: [second], headers: { 'x-total-count': '3' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'content-range': 'orders 0-0/2' } }, { data: [second] }],
    [{ data: [summary], headers: { 'x-total-count': '2' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: { orders: [second], total: 2 } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"' } }, { data: [], headers: { link: '<?page=3>; rel="next"' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="last"' } }],
    [{ data: [], headers: { 'x-total-count': '1' } }],
    [{ data: [summary], headers: { 'x-total-count': '0' } }],
    [{ data: [summary], headers: { link: '<?page=2>; rel="next"', 'x-total-count': '1' } }]
  ];
  for (const pages of cases) {
    for (const full of [true, false]) {
      let index = 0;
      const run = harness({ respond: async () => ({ status: 200, ...pages[index++] }) });
      await assert.rejects(run.scan(full), /incomplete|unreadable/u);
      assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before); assert.equal(run.writes.length, 0);
      assert.equal(run.paths.every((path) => new URL(path, 'https://www.fanatical.com').pathname === '/api/user/orders'), true);
    }
  }
});

test('unsafe or ambiguous pagination never receives the authorization token', async () => {
  for (const link of ['<https://evil.example/api/user/orders?page=2>; rel="next"', '</api/basket>; rel="next"', '<http://www.fanatical.com/api/user/orders?page=2>; rel="next"', '<https://user:password@www.fanatical.com/api/user/orders?page=2>; rel="next"', '<?page=2#secret>; rel="next"', '<?page=2>; rel="next", <?page=3>; rel="next"', '<?page=2>; rel="next"; anchor="/elsewhere"', '<?page=2>; rel="next"; rel="last"', '<?page=2>; rel="next']) {
    const run = harness({ headers: { link } });
    await assert.rejects(run.scan()); assert.equal(run.paths.length, 1); assert.equal(run.writes.length, 0);
  }
});

test('the page safety limit rejects an endless unique next-page chain', async () => {
  let page = 0;
  const run = harness({ respond: async () => {
    page++; return { status: 200, data: [{ ...summary, _id: `order-${String(page).padStart(6, '0')}` }], headers: { link: `<?page=${page + 1}>; rel="next"` } };
  } });
  await assert.rejects(run.scan(), /1,000-page safety limit/);
  assert.equal(run.paths.length, 1000); assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
});

test('transport errors and transient HTTP statuses retry GET with exponential backoff', async () => {
  for (const failure of ['network', 408, 429, 500, 502, 503, 504]) {
    const clock = retryClock(); let attempts = 0;
    const run = harness({ ...clock, respond: async (path) => {
      if (path === '/api/user/orders' && ++attempts < 3) {
        if (failure === 'network') throw new Error('SECRET socket error');
        return { status: failure };
      }
      return { status: 200, data: path === '/api/user/orders' ? [summary] : detail };
    } });
    const result = await run.scan();
    assert.deepEqual(clock.waits, [500, 1000]); assert.equal(result.coverage.retries, 2);
    assert.equal(run.paths.length, 4); assert.equal(run.writes.length, 1);
  }
});

test('Retry-After seconds and HTTP dates are respected; long delays stop rather than retry early', async () => {
  for (const kind of ['seconds', 'date', 'invalid']) {
    const clock = retryClock(); let attempts = 0;
    const header = kind === 'seconds' ? '2' : kind === 'date' ? new Date(clock.now + 2000).toUTCString() : 'nonsense';
    const run = harness({ ...clock, respond: async (path) => path === '/api/user/orders' && ++attempts === 1
      ? { status: 429, headers: { 'retry-after': header } } : { status: 200, data: path === '/api/user/orders' ? [summary] : detail } });
    await run.scan(); assert.deepEqual(clock.waits, [kind === 'invalid' ? 500 : 2000]);
  }
  const clock = retryClock();
  const run = harness({ ...clock, respond: async () => ({ status: 503, headers: { 'retry-after': '120' } }) });
  await assert.rejects(run.scan(), /try scanning again later/);
  assert.equal(run.paths.length, 1); assert.equal(clock.waits.length, 0); assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
});

test('timeouts cover response headers and body reads and exhaust a bounded retry budget', async () => {
  for (const body of [false, true]) {
    const clock = retryClock({ watchdog: 1 }); let aborted = 0;
    const hang = (options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('SECRET timeout')); }, { once: true }));
    const run = harness({ ...clock, respond: async (_path, options) => body ? { status: 200, json: hang } : hang(options) });
    await assert.rejects(run.scan(), /three attempts/);
    assert.equal(run.paths.length, 3); assert.equal(aborted, 3); assert.deepEqual(clock.waits, [500, 1000]);
    assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before);
  }
});

test('expired sessions, permanent errors and malformed successful responses are not retried', async () => {
  for (const status of [400, 401, 403, 404, 206]) {
    const clock = retryClock(); const run = harness({ ...clock, status });
    await assert.rejects(run.scan()); assert.equal(run.paths.length, 1); assert.equal(clock.waits.length, 0);
  }
  const clock = retryClock(); const run = harness({ ...clock, invalidJSON: true });
  await assert.rejects(run.scan(), /unreadable/); assert.equal(run.paths.length, 1);
});

test('a failing detail stops the queue, aborts in-flight requests and preserves all existing scan state', async () => {
  const history = longHistory(30, 30); let aborted = 0;
  const run = harness({ respond: async (path, options) => {
    if (path === '/api/user/orders') return { status: 200, data: history.orders.map((entry) => entry.summary) };
    if (path.endsWith('000000')) { await new Promise((resolve) => setTimeout(resolve, 5)); return { status: 404 }; }
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => { aborted++; reject(new Error('SECRET abort')); }, { once: true }));
  } });
  await assert.rejects(run.scan());
  assert.equal(run.paths.length, 4); assert.equal(aborted, 2); assert.equal(run.maxActive, 3);
  assert.deepEqual(Object.fromEntries(Object.entries(run.stored).filter(([key])=>key!=='fanaticalSyncControl')), run.before); assert.equal(run.writes.length, 0);
});

test('runtime scan failures expose incomplete coverage without replacing purchases or successful summary', async () => {
  const run = harness({ invalidJSON: true }); const reply = await run.send();
  assert.equal(reply.ok, false); assert.match(reply.error, /Scan incomplete/);
  assert.deepEqual(run.stored.fanaticalLibraryItems, run.before.fanaticalLibraryItems);
  assert.deepEqual(run.stored.fanaticalImportSummary, run.before.fanaticalImportSummary);
  assert.deepEqual(run.stored.fanaticalScannedOrderFingerprints, run.before.fanaticalScannedOrderFingerprints);
  assert.equal(run.stored.fanaticalLastScanAttempt.status, 'incomplete');
  assert.equal(JSON.stringify({ reply, writes: run.writes }).includes('SECRET'), false);
});

test('overlapping runtime imports are rejected without starting a second scan', async () => {
  let release;
  const run = harness({ respond: async (path) => {
    if (path === '/api/user/orders') await new Promise((resolve) => { release = resolve; });
    return { status: 200, data: path === '/api/user/orders' ? [summary] : detail };
  } });
  const first = run.send(); const second = await run.send(false);
  assert.equal(second.ok, false); assert.match(second.error, /already running/);
  while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
  release(); assert.equal((await first).ok, true); assert.equal(run.paths.length, 2);
});

test('detail retries stay bounded and a shared server cooldown also delays queued orders', async () => {
  const history = longHistory(6, 6); const clock = retryClock(); const started = []; let attempts = 0;
  const retryAfterDeadline = clock.now + 2000;
  const run = harness({ ...clock, respond: async (path, options) => {
    if (path === '/api/user/orders') return { status: 200, data: history.orders.map((entry) => entry.summary) };
    started.push({ path, at: clock.now });
    if (path.endsWith('000000') && ++attempts === 1) return { status: 503, headers: { 'retry-after': '2' } };
    return history.respond(path, options);
  } });
  const result = await run.scan(); assert.equal(result.coverage.retries, 1);
  assert.equal(result.ordersScanned, 6); assert.ok(run.maxActive <= 3);
  assert.equal(started.filter((entry) => entry.path.endsWith('000000')).length, 2);
  assert.ok(started.slice(3).every((entry) => entry.at >= retryAfterDeadline));
});

test('consistent count metadata validates a page chain without Content-Range', async () => {
  let page = 0;
  const run = harness({ respond: async (path) => {
    if (path.startsWith('/api/user/orders/')) return { status: 200, data: { ...detail, _id: path.split('/').at(-1) } };
    page++; return { status: 200, data: [{ ...summary, _id: `order-${String(page).padStart(6, '0')}` }], headers: { 'x-total-count': '2', ...(page === 1 ? { link: '<?page=2>; rel="next"' } : {}) } };
  } });
  const result = await run.scan(); assert.equal(result.coverage.paginationEvidence, 'count');
  assert.equal(result.coverage.expectedTotal, 2); assert.equal(result.coverage.pagesFetched, 2);
});

test('invalid coverage receipts cannot assert independent pagination validation', () => {
  const receipt = { schemaVersion: 1, ordersAvailable: 0, ordersScanned: 0, items: [], orderFingerprints: [],
    coverage: { complete: true, listedOrders: 0, validatedOrders: 0, emptyAccount: true, pagesFetched: 1, expectedTotal: null, paginationEvidence: 'array-only', retries: 0, concurrency: 3 } };
  for (const changes of [{ pagesFetched: 0 }, { pagesFetched: 1001 }, { pagesFetched: 2 }, { retries: -1 }, { concurrency: 1000 }, { paginationEvidence: 'verified' }, { paginationEvidence: 'link' }, { paginationEvidence: 'count' }, { expectedTotal: 1 }, { expectedTotal: 0 }, { pagesFetched: undefined }]) {
    assert.throws(() => validateScanResult({ ...receipt, coverage: { ...receipt.coverage, ...changes } }), /incomplete/);
  }
});

test('a broken response-body transport is retried, unlike malformed JSON', async () => {
  const clock = retryClock(); let attempts = 0;
  const run = harness({ ...clock, respond: async (path) => path === '/api/user/orders' && ++attempts === 1
    ? { status: 200, json: () => { throw new TypeError('SECRET interrupted body'); } }
    : { status: 200, data: path === '/api/user/orders' ? [summary] : detail } });
  const result = await run.scan(); assert.equal(result.coverage.retries, 1); assert.deepEqual(clock.waits, [500]);
  const overflowing = harness({ ...retryClock(), respond: async () => ({ status: 503, headers: { 'retry-after': '9'.repeat(400) } }) });
  await assert.rejects(overflowing.scan(), /try scanning again later/); assert.equal(overflowing.paths.length, 1);
});

test('a session change during serialized scanning prevents ownership writes without exposing tokens',async()=>{
  let reads=0;const run=harness({authRead:()=>++reads===1?'FIRST-SECRET':'SECOND-SECRET'});
  await assert.rejects(run.scan(),/session changed/);assert.equal(run.writes.length,0);assert.deepEqual(run.stored.fanaticalLibraryItems,run.before.fanaticalLibraryItems);
});


test('5,000 purchases across 100 pages retain every product and finish at bounded concurrency', async()=>{
  const run=harness(longHistory(5000,50)),result=await run.scan();assert.equal(result.ordersScanned,5000);assert.equal(result.ownedLeafProducts,5000);assert.equal(result.coverage.pagesFetched,100);assert.equal(result.coverage.expectedTotal,5000);assert.equal(run.maxActive,3);assert.equal(run.stored.fanaticalScannedOrderFingerprints.length,5000);
});
test('an advertised last page remains mandatory when later headers omit it, and cannot change mid-scan',async()=>{
  for(const changed of [false,true]){let page=0;const run=harness({respond:async()=>{page++;return {status:200,data:[{...summary,_id:'order-'+String(page).padStart(6,'0')}],headers:page===1?{link:'<?page=2>; rel="next", <?page=3>; rel="last"'}:changed?{link:'<?page=2>; rel="last"'}:{}};}});await assert.rejects(run.scan(),/incomplete/);assert.equal(run.writes.length,0);assert.deepEqual(run.stored.fanaticalLibraryItems,run.before.fanaticalLibraryItems);}
});


test('full and quick imports retain separate same-product purchases and multiplicity without raw order identifiers',async()=>{
  const orders=[1,2].map(n=>{const id='repeat-order-'+n,leaf={...detail.items[0].bundles[0].games[0]};return {summary:{...summary,_id:id,items:[{name:'Bundle '+n,bundles:[{games:Array.from({length:n},()=>({name:leaf.name}))}]}]},detail:{...detail,_id:id,date:'2026-09-0'+n+'T00:00:00Z',items:[{...detail.items[0],name:'Bundle '+n,bundles:[{games:Array.from({length:n},()=>leaf)}]}]}};});
  const run=harness({respond:async path=>({status:200,data:path==='/api/user/orders'?orders.map(row=>row.summary):orders.find(row=>row.detail._id===path.split('/').at(-1))?.detail})});await run.scan();let item=run.stored.fanaticalLibraryItems[0];assert.equal(run.stored.fanaticalLibraryItems.length,1);assert.equal(item.purchaseOrigins.length,2);assert.deepEqual(item.purchaseOrigins.map(row=>row.quantity),[1,2]);assert.equal(item.bundle.title,'Bundle 2');
  const third=structuredClone(orders[0]);third.summary._id=third.detail._id='repeat-order-3';third.detail.date='2026-09-03T00:00:00Z';orders.push(third);await run.scan(false);item=run.stored.fanaticalLibraryItems[0];assert.equal(item.purchaseOrigins.length,3);await run.scan(false);assert.equal(run.stored.fanaticalLibraryItems[0].purchaseOrigins.length,3);assert(!JSON.stringify(run.stored).includes('repeat-order'));
});
