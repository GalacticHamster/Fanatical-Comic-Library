import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRelease} from '../scripts/release.mjs';
import {assertProviderRuntime} from '../scripts/provider-engine-integrity.mjs';
const pin=JSON.parse(await readFile(new URL('../scripts/provider-engine-pin.json',import.meta.url),'utf8'));
test('independent release pin detects modified engine, validator, worker and revision',async()=>{
  const {files}=await createRelease();assert(assertProviderRuntime(files,pin));
  for(const name of Object.keys(pin.runtime)){
    const changed=new Map(files);changed.set(name,Buffer.concat([changed.get(name),Buffer.from('\n// changed')]));
    assert.throws(()=>assertProviderRuntime(changed,pin),/runtime differs/);
    changed.delete(name);assert.throws(()=>assertProviderRuntime(changed,pin),/runtime differs/);
  }
  assert.throws(()=>assertProviderRuntime(files,{...pin,revision:'mislabeled'}),/revision/);
  const forged=structuredClone(pin);forged.runtime['src/order-importer.mjs']='a'.repeat(64);
  assert.throws(()=>assertProviderRuntime(files,forged),/authoritative/);
});
