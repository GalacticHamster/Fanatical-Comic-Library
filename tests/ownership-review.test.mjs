import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const context = { globalThis: null, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL('../src/shared.js', import.meta.url), 'utf8'), context);
const { FanaticalLibrary: library } = context;

test('an exact Galactic title with uncertain or temporary access asks for review', () => {
  for (const ownership of ['unknown', 'subscription', 'borrowed', 'rental']) {
    const result = library.mergeGalactic({ state: 'new' }, { matches: [{ provider: 'kindle', ownership }] });
    assert.equal(result.state, 'possible');
    assert.equal(library.overlayLabel(result), 'Check ownership');
  }
});

test('a confirmed Galactic purchase still wins over uncertain records', () => {
  const result = library.mergeGalactic({ state: 'new' }, { matches: [
    { provider: 'kindle', ownership: 'unknown' },
    { provider: 'humble', ownership: 'owned' }
  ] });
  assert.equal(result.state, 'owned-elsewhere');
  assert.equal(result.provenance, 'humble');
});
