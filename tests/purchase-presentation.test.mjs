import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import '../src/purchase-handoff-ui.js';
const P=globalThis.GalacticPurchasePresentation;
test('Fanatical purchase offers explain receiving confirmation and keep developer terms out of the summary',()=>{
 const v=P.transfer({count:12},{store:'Fanatical',here:'Fanatical extension',there:'Galactic Library',send:true});const copy=[v.heading,...v.lines,...v.facts,...v.warnings,v.safety,v.next].join(' ');assert(copy.includes('Nothing has been imported yet'));assert(copy.includes('same Fanatical account'));assert(copy.includes('choose Import saved purchases'));assert(!/\b(observation|enrichment|canonical|identity conflict|scoped record|provenance|purchase origin)s?\b/i.test(copy));assert(!/Humble|\bHB\b/.test(copy));
});
test('Fanatical UI keeps read-only actions separate from confirmation and lazy technical diagnostics',async()=>{
 const source=await readFile(new URL('../src/purchase-handoff-ui.js',import.meta.url),'utf8');assert(source.includes('Refresh account choices reloads saved account selections'));assert(source.includes('if(!confirm.checked)'));assert(source.includes("confirmed:true"));assert(source.includes("Technical details"));assert(source.includes('technical.open&&!rendered'));
 const failure=P.failure('reconcile');assert.equal(failure.safety,'No library data was changed.');assert(failure.lines[0].includes('Check the connection'));
});
