import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../src/shared.js',import.meta.url),'utf8'),context);
const F = context.FanaticalLibrary;

test('incremental summaries distinguish no new purchases, new purchases and restored scan history',()=>{
  assert.equal(F.purchaseImportScope({ordersScanned:0,ordersSkipped:26}), 'No new purchases; no purchase details to check; skipped 26 unchanged purchases');
  assert.equal(F.purchaseImportScope({ordersScanned:1,ordersSkipped:26}), 'Checked 1 new purchase; skipped 26 unchanged purchases');
  assert.equal(F.purchaseImportScope({ordersScanned:26,ordersSkipped:0,scanHistoryMissing:true}), 'Rechecked 26 purchases because saved scan history was unavailable');
  assert.equal(F.purchaseImportScope({ordersScanned:26,scanMode:'full'}), 'Rescanned 26 purchases; current snapshot rebuilt');
});

test('live import progress identifies listing, detail work, unchanged purchases and retries',()=>{
  const scope={total:26,skipped:2,fullScan:false,scanHistoryMissing:false};
  assert.equal(F.purchaseImportProgress({phase:'list',page:2}), 'Loading your purchase list: page 2\u2026');
  assert.equal(F.purchaseImportProgress({phase:'plan',...scope}), 'Found 26 new purchases; skipped 2 unchanged purchases\u2026');
  assert.equal(F.purchaseImportProgress({phase:'plan',...scope,total:0}), 'No new purchases; no purchase details to check; skipped 2 unchanged purchases\u2026');
  assert.equal(F.purchaseImportProgress({phase:'details',...scope,completed:1}), 'Importing new purchases: purchase 1 of 26\u2026');
  assert.equal(F.purchaseImportProgress({phase:'details',...scope,fullScan:true,completed:1}), 'Rescanning all purchases: purchase 1 of 26\u2026');
  assert.equal(F.purchaseImportProgress({phase:'plan',...scope,scanHistoryMissing:true}), 'Rechecking 26 purchases because saved scan history is unavailable; skipped 2 unchanged purchases\u2026');
  assert.equal(F.purchaseImportProgress({phase:'details',...scope,scanHistoryMissing:true,completed:1}), 'Rechecking purchase history (saved scan history unavailable): purchase 1 of 26\u2026');
  assert.equal(F.purchaseImportProgress({phase:'retry',attempt:2}), 'Retrying a purchase request (attempt 2 of 3)\u2026');
});

test('page progress accepts only bounded aggregate fields and never displays page-supplied text',()=>{
  for(const invalid of [null,{}, {phase:'secret',message:'PRIVATE'}, {phase:'list',page:0},{phase:'list',page:1001},
    {phase:'retry',attempt:4},{phase:'plan',total:NaN,skipped:0,fullScan:false,scanHistoryMissing:false},
    {phase:'plan',total:100001,skipped:0,fullScan:false,scanHistoryMissing:false},
    {phase:'details',total:26,skipped:0,fullScan:false,scanHistoryMissing:false,completed:27},
    {phase:'plan',total:26,skipped:0,fullScan:'false',scanHistoryMissing:false}]) assert.equal(F.purchaseImportProgress(invalid),null);
  assert.equal(F.purchaseImportProgress({phase:'list',page:1,message:'PRIVATE'}), 'Loading your purchase list: page 1\u2026');
});
