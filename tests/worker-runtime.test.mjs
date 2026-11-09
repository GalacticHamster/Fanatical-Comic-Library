import assert from 'node:assert/strict';
import test from 'node:test';
import {prepareWorker} from './helpers/worker-runtime.mjs';

test('worker bridge resolves actual named exports and rejects missing validator modules',async()=>{
  const source="import {assertFanaticalAcquisitionContract} from './acquisition-contract.mjs';\n";
  await assert.rejects(prepareWorker({source,load:async()=>{throw Error('missing');}}),/Worker dependency could not load/);
  await assert.rejects(prepareWorker({source,load:async()=>({})}),/Missing or invalid worker dependency.*assertFanaticalAcquisitionContract/);
  await assert.rejects(prepareWorker({source,load:async()=>({assertFanaticalAcquisitionContract:null})}),/Missing or invalid worker dependency/);
  const runtime=await prepareWorker();
  assert(runtime.imports.some(i=>i.path==='./order-importer.mjs'));
  assert(runtime.imports.some(i=>i.path==='./library-data.mjs'));
  assert.throws(()=>runtime.run({safeId:()=>{}}),/Worker dependency override/);
});

test('worker bridge rejects unsupported side effects and unexpected import syntax',async()=>{
  for(const source of ["import './unexpected.js';\n","import unexpected from './order-importer.mjs';\n","import {\n safeId\n} from './library-data.mjs';\n"])
    await assert.rejects(prepareWorker({source}),/Unsupported worker import|Unresolved worker import/);
});
