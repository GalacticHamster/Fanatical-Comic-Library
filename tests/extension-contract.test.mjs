import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const worker = fs.readFileSync(new URL('src/service-worker.js', root), 'utf8');
const importer = fs.readFileSync(new URL('src/order-importer.mjs',root),'utf8');
const content = fs.readFileSync(new URL('src/content.js', root), 'utf8');
const popup = fs.readFileSync(new URL('src/popup.js', root), 'utf8');
const options = fs.readFileSync(new URL('src/options.js', root), 'utf8');

test('manifest uses only Fanatical host access and minimal importer permissions', () => {
  assert.deepEqual(manifest.host_permissions, ['https://www.fanatical.com/*']);
  assert.deepEqual(manifest.permissions.sort(), ['scripting', 'storage']);
  assert.equal(JSON.stringify(manifest).includes('cookies'), false);
});

test('importer has no cart endpoint or diagnostic logging path', () => {
  assert.equal(worker.includes('/api/basket'), false);
  assert.equal(worker.includes('console.'), false);
  assert.match(importer, /\/api\/user\/orders/);
  assert.match(worker, /world: 'MAIN'/);
});

test('quick scans persist only opaque order fingerprints and full scans are explicit', () => {
  assert.match(worker, /fanaticalScannedOrderFingerprints/);
  assert.match(importer, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(worker, /fullScan: message\.fullScan === true/);
  assert.equal(worker.includes('orderIds'), false);
});

test('library management follows the Fanatical Orders importer flow', () => {
  assert.match(popup, /openOptionsPage/);
  assert.match(options, /https:\/\/www\.fanatical\.com\/en\/orders/);
  assert.match(content, /isOrderHistoryPage/);
  assert.match(content, /Quick scan for new purchases/);
  assert.match(content, /Full scan all purchases/);
});

test('bundle summary distinguishes partial and possible matches and recommends a tier', () => {
  assert.match(content, /counts\.partial/);
  assert.match(content, /only partly owned/);
  assert.match(content, /Lowest tier containing all confirmed-new items/);
  assert.match(content, /fanaticalShowNewItemsOnly/);
});

test('only observed public bundle paths may be requested from the page world', () => {
  assert.match(worker, /products-group\|pick-and-mix/);
  assert.equal(worker.includes('FANATICAL_GET_PUBLIC_BUNDLE'), true);
});
