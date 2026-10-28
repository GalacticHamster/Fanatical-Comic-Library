import assert from 'node:assert/strict';
import test from 'node:test';
import { backupRestoreState, createLibraryBackup, parseLibraryBackup, sanitizeImportResult } from '../src/library-data.mjs';

const item = { source: 'fanatical', sourceItemId: 'product-123456', title: 'Comic #2', mediaType: 'book', slug: 'comic-2', externalIds: { isbn: '9781234567890' }, formats: ['pdf'], bundle: { sourceItemId: 'bundle-123456', title: 'Comics', slug: 'comics' }, purchaseDate: '2026-09-01T12:00:00.000Z' };

test('version 1 backups round-trip product identity, matching IDs and purchase provenance', () => {
  const backup = createLibraryBackup([item], null);
  assert.deepEqual(parseLibraryBackup(JSON.parse(JSON.stringify(backup))), [item]);
});

test('import and export exclude unknown sensitive fields at every projected level', () => {
  const toxic = { ...item, token: 'SECRET-TOKEN', orderId: 'SECRET-ORDER', key: 'SECRET-KEY', email: 'SECRET-EMAIL', externalIds: { ...item.externalIds, key: 'SECRET-ID' }, bundle: { ...item.bundle, downloadUrl: 'SECRET-URL' }, downloads: ['SECRET-DOWNLOAD'] };
  const backup = { schemaVersion: 1, items: [toxic], token: 'SECRET-ROOT', summary: { scanMode: 'quick', token: 'SECRET-SUMMARY' }, orderFingerprints: ['a'.repeat(64)] };
  const output = createLibraryBackup(parseLibraryBackup(backup), backup.summary);
  assert.equal(JSON.stringify(output).includes('SECRET'), false);
  assert.equal('orderFingerprints' in output, false);
  assert.deepEqual(output.items, [item]);
});

test('invalid schema, non-Fanatical records and malformed records fail closed', () => {
  for (const backup of [null, [], { schemaVersion: 2, items: [item] }, { schemaVersion: 1, items: {} }, { schemaVersion: 1, items: [{ ...item, source: 'humble' }] }, { schemaVersion: 1, items: [item, { ...item, title: '' }] }, { schemaVersion: 1, items: [{ ...item, sourceItemId: 'bad' }] }]) {
    assert.throws(() => parseLibraryBackup(backup));
  }
});

test('backup records deduplicate by product ID, not by title', () => {
  assert.deepEqual(parseLibraryBackup({ schemaVersion: 1, items: [item, { ...item, title: 'Comic #3' }, { ...item, sourceItemId: 'product-654321' }] }).map((row) => row.title), ['Comic #3', 'Comic #2']);
});

test('restore atomically clears scan authority but does not touch pairing or preferences', () => {
  assert.deepEqual(backupRestoreState([item]), { fanaticalAccountId:null, fanaticalLibraryItems: [item], fanaticalImportSummary: null, fanaticalScannedOrderFingerprints: [], fanaticalLastScanAttempt: null,fanaticalProfileLabel:'',fanaticalProfileArchives:[],fanaticalHistoricalItems:[] });
  assert.deepEqual(parseLibraryBackup({ schemaVersion: 1, items: [] }), []);
});

test('shared importer sanitizer validates IDs, bounded lists, counts and fingerprints', () => {
  const result = sanitizeImportResult({ items: [{ ...item, externalIds: { steamAppId: 'invalid', isbn: 'invalid' }, drm: ['steam', 'steam', 123], purchaseDate: 'invalid' }, { title: 'Invalid' }], ordersScanned: Infinity, ordersAvailable: -1, orderFingerprints: ['A'.repeat(64), 'a'.repeat(64), 'secret'] });
  assert.equal(result.items.length, 1);
  assert.equal('externalIds' in result.items[0], false);
  assert.equal(result.items[0].purchaseDate, null);
  assert.deepEqual(result.items[0].drm, ['steam']);
  assert.equal(result.ordersScanned, 0);
  assert.equal(result.ordersAvailable, 0);
  assert.deepEqual(result.orderFingerprints, ['a'.repeat(64)]);
});


test('all purchase origins round-trip through sanitization, backup and profile archives without secret fields',()=>{
  const origin=n=>({purchaseRef:String(n).repeat(64),bundle:{sourceItemId:'bundle-00000'+n,title:'Bundle '+n,slug:'bundle-'+n,key:'SECRET'},purchaseDate:'2026-09-0'+n+'T00:00:00Z',quantity:n,orderId:'SECRET'});
  const owned={...item,purchaseOrigins:[origin(1),origin(2)]};const backup=createLibraryBackup([owned],null,undefined,'personal',[{profileLabel:'other',items:[owned],archivedAt:'2026-10-01'}]);assert.equal(JSON.stringify(backup).includes('SECRET'),false);const restored=backupRestoreState(parseLibraryBackup(backup),backup);assert.equal(restored.fanaticalLibraryItems[0].purchaseOrigins.length,2);assert.equal(restored.fanaticalProfileArchives[0].items[0].purchaseOrigins[1].quantity,2);
  for(const delta of [{purchaseRef:'invalid'},{quantity:0},{purchaseDate:'invalid'}])assert.throws(()=>parseLibraryBackup({schemaVersion:1,items:[{...item,purchaseOrigins:[{...origin(1),...delta}]}]}));
});


test('portable catalogs are distinct from full recoverable backups and cannot restore ownership',async()=>{
  const {createTitleCatalog}=await import('../src/library-data.mjs'),catalog=createTitleCatalog([{...item,purchaseOrigins:[{purchaseRef:'a'.repeat(64),bundle:item.bundle,purchaseDate:item.purchaseDate,quantity:1}]}]);assert.equal(catalog.format,'fanatical-title-catalog');assert.equal(catalog.items[0].title,item.title);for(const field of ['source','sourceItemId','bundle','purchaseDate','purchaseOrigins'])assert.equal(field in catalog.items[0],false);assert.throws(()=>parseLibraryBackup(catalog));assert.throws(()=>parseLibraryBackup({...createLibraryBackup([item],null),format:catalog.format}));
});
