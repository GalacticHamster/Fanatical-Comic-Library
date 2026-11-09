// Build-time integrity only. Each checkout pins its own revision; peer versions
// and runtime purchase-sync compatibility remain independent.
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function assertProviderRuntime(files,pin){
  if(pin.contractVersion!==1||pin.revision!==`fanatical-v1-${hash(pin.engine+pin.adapter+pin.contract).slice(0,16)}`)
    throw Error('Invalid pinned Fanatical acquisition revision');
  if(!pin.runtime||!Object.keys(pin.runtime).length)throw Error('Missing pinned provider runtime inventory');
  const authoritative=Object.hasOwn(pin.runtime,'src/order-importer.mjs')
    ?{'src/order-importer.mjs':pin.engine,'src/acquisition-contract.mjs':pin.contract}
    :{'src/providers/fanatical-scan.js':pin.consumers?.GL};
  for(const [path,digest]of Object.entries(authoritative))if(!digest||pin.runtime[path]!==digest)
    throw Error('Pinned runtime does not match authoritative Fanatical digest: '+path);
  for(const [path,digest]of Object.entries(pin.runtime)){
    if(!files.has(path)||hash(files.get(path))!==digest)throw Error('Pinned Fanatical runtime differs: '+path);
  }
  return true;
}
