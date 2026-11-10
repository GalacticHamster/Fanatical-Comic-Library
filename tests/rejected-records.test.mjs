import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeImportResult,createLibraryBackup,parseLibraryBackup,backupRestoreState} from '../src/library-data.mjs';

const safe=()=>({sourceItemId:'synthetic-promotion',title:'Synthetic promotion',reason:'Promotional',bundle:{sourceItemId:'synthetic-bundle',title:'Synthetic bundle'},formats:['pdf']});
const polluted=()=>({...safe(),key:'SYNTHETIC_SENTINEL',headers:{authorization:'SYNTHETIC_SENTINEL'},bundle:{...safe().bundle,rawResponse:{token:'SYNTHETIC_SENTINEL'}}});
test('projection, backup and restore reconstruct rejected records without arbitrary payloads',()=>{
  const projected=sanitizeImportResult({schemaVersion:1,items:[],rejectedPurchaseItems:[polluted()]});
  assert.deepEqual(projected.rejectedPurchaseItems,[safe()]);
  const backup=createLibraryBackup([],null,undefined,'',[],[],[],{},[polluted()]);
  assert.deepEqual(backup.rejectedPurchaseItems,[safe()]);assert(!JSON.stringify(backup).includes('SYNTHETIC_SENTINEL'));
  backup.rejectedPurchaseItems=[polluted()];parseLibraryBackup(backup);
  assert.deepEqual(backup.rejectedPurchaseItems,[safe()]);
  backup.rejectedPurchaseItems=[polluted()];const restored=backupRestoreState([],backup);
  assert.deepEqual(restored.rejectedPurchaseItems,[safe()]);
});
test('invalid rejected fields fail before backup or projection can retain nested data',()=>{
  for(const item of [{...safe(),title:{}},{...safe(),formats:[{token:'SYNTHETIC_SENTINEL'}]},{...safe(),bundle:{sourceItemId:'id',title:'Bundle',slug:[]}}]){
    assert.throws(()=>sanitizeImportResult({items:[],rejectedPurchaseItems:[item]}),/Invalid Fanatical rejected purchase/);
    assert.throws(()=>createLibraryBackup([],null,undefined,'',[],[],[],{},[item]),/Invalid Fanatical rejected purchase/);
  }
});
