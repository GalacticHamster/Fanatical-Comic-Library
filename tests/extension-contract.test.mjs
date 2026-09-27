import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', root), 'utf8'));
const worker = fs.readFileSync(new URL('src/service-worker.js', root), 'utf8');

test('manifest uses only Fanatical host access and minimal importer permissions', () => {
  assert.deepEqual(manifest.host_permissions, ['https://www.fanatical.com/*']);
  assert.deepEqual(manifest.permissions.sort(), ['scripting', 'storage']);
  assert.equal(JSON.stringify(manifest).includes('cookies'), false);
});

test('importer has no cart endpoint or diagnostic logging path', () => {
  assert.equal(worker.includes('/api/basket'), false);
  assert.equal(worker.includes('console.'), false);
  assert.match(worker, /\/api\/user\/orders/);
  assert.match(worker, /world: 'MAIN'/);
});

test('quick scans persist only opaque order fingerprints and full scans are explicit', () => {
  assert.match(worker, /fanaticalScannedOrderFingerprints/);
  assert.match(worker, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(worker, /fullScan: message\.fullScan === true/);
  assert.equal(worker.includes('orderIds'), false);
});

test('only observed public bundle paths may be requested from the page world', () => {
  assert.match(worker, /products-group\|pick-and-mix/);
  assert.equal(worker.includes('FANATICAL_GET_PUBLIC_BUNDLE'), true);
});
