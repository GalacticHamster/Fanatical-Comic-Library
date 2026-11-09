// Provider acquisition contract v1. Persistence is owned by the consuming writer.
export const ACQUISITION_CONTRACT_VERSION=1;
export function acquisitionContract({provider,finished,verified=[],unresolved=[],ineligible=[],coverage,scope,retry=[]}){
  if(!['humble','fanatical'].includes(provider)||typeof finished!=='boolean'
    ||!['verified','unverified','incomplete'].includes(coverage?.status)
    ||!['declared-scope','saved-order-match'].includes(scope?.authority))throw Error('Invalid acquisition authority.');
  const lists=[verified,unresolved,ineligible];
  if(lists.some(list=>!Array.isArray(list)||list.some(id=>typeof id!=='string'||!id)||new Set(list).size!==list.length)
    ||verified.some(id=>unresolved.includes(id)||ineligible.includes(id))||unresolved.some(id=>ineligible.includes(id))
    ||finished&&unresolved.length||coverage.status==='verified'&&(!finished||unresolved.length))throw Error('Contradictory acquisition evidence.');
  return {version:1,provider,acquisition:{outcome:finished?'finished':'interrupted'},verified,unresolved,ineligible,
    coverage,scope,retry,persistence:{outcome:'not-attempted'},reconciliation:{authority:'none'}};
}

// Self-contained boundary validator, also embedded beside GL's serialized
// adapter. Legacy writer validation still checks products and save-time leases.
export function fanaticalCompatibilityReport(value){
  const fields=['unsupportedStatus','invalidStatus','missingItems','invalidItems','missingBundles','invalidBundles','missingGames','invalidGames','missingNames','summaryConflict','detailRequest','detailStructure','detailIdentity','detailStatus','detailProductMismatch','detailProductIdentity','detailProjection','scheduled','knownSkipped','multipleCopies'];
  if(!value||value.version!==1||Object.keys(value).some(k=>!['version','counts'].includes(k))||!value.counts||typeof value.counts!=='object'||Array.isArray(value.counts)||Object.keys(value.counts).length!==fields.length||fields.some(k=>!Number.isSafeInteger(value.counts[k])||value.counts[k]<0||value.counts[k]>100000))return null;
  return {version:1,counts:Object.fromEntries(fields.map(k=>[k,value.counts[k]]))};
}
export function assertFanaticalAcquisitionContract(raw,options={}){
  const invalid=()=>{throw Error('Invalid or contradictory Fanatical acquisition contract. Earlier purchases were kept.');};
  const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const ids=value=>Array.isArray(value)&&value.length<=100000&&value.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/u.test(id))&&new Set(value).size===value.length;
  const same=(a,b)=>{if(!ids(a)||!ids(b)||a.length!==b.length)return false;const set=new Set(b);return a.every(id=>set.has(id));};
  if(!keys(raw,['acquisitionContract','partialScanVersion','outcome','verifiedOrderFingerprints','unresolvedOrderFingerprints','ineligibleOrderFingerprints','observedOrderFingerprints','failures','unidentifiedRecords','schemaVersion','coverage','ordersScanned','ordersAvailable','orderFingerprints','items'])||raw.schemaVersion!==1||raw.partialScanVersion!==1)invalid();
  const c=raw.acquisitionContract,coverage=raw.coverage;
  const compatibility=coverage?.compatibility===undefined?null:fanaticalCompatibilityReport(coverage.compatibility);
  if(coverage?.compatibility!==undefined&&!compatibility)invalid();
  if(!keys(c,['version','provider','acquisition','verified','unresolved','ineligible','coverage','scope','retry','persistence','reconciliation'])||c.version!==1||c.provider!=='fanatical'
    ||!keys(c.acquisition,['outcome'])||!keys(c.coverage,['status','evidence'])||!keys(c.scope,['authority'])||!keys(c.persistence,['outcome'])||!keys(c.reconciliation,['authority'])
    ||c.persistence.outcome!=='not-attempted'||c.reconciliation.authority!=='none'
    ||!same(c.verified,raw.verifiedOrderFingerprints)||!same(c.unresolved,raw.unresolvedOrderFingerprints)||!same(c.ineligible,raw.ineligibleOrderFingerprints)||!same(c.retry,c.unresolved)
    ||!ids(raw.observedOrderFingerprints)||!ids(raw.orderFingerprints)||!Array.isArray(raw.items)||!Array.isArray(raw.failures))invalid();
  const partition=[...c.verified,...c.unresolved,...c.ineligible],observedSet=new Set(raw.observedOrderFingerprints);
  if(new Set(partition).size!==partition.length||partition.some(id=>!observedSet.has(id)))invalid();
  if(!coverage||!['complete','partial-extraction','partial-discovery'].includes(raw.outcome)||coverage.complete!==(raw.outcome==='complete')||coverage.discoveryComplete!==(raw.outcome!=='partial-discovery'))invalid();
  const finished=raw.outcome==='complete'||raw.outcome==='partial-discovery'&&coverage.paginationEvidence==='array-only'&&coverage.expectedTotal===null&&coverage.pagesParsed===coverage.pagesFetched&&!c.unresolved.length&&raw.unidentifiedRecords===0&&raw.failures.length===1&&raw.failures[0].code==='discovery-unverified'&&raw.failures[0].stage==='listing'&&raw.failures[0].count===1;
  const status=raw.outcome==='complete'?'verified':finished?'unverified':'incomplete';
  if(c.acquisition.outcome!==(finished?'finished':'interrupted')||c.coverage.status!==status||!Array.isArray(c.coverage.evidence)||c.coverage.evidence.length!==1||c.coverage.evidence[0]!==coverage.paginationEvidence||coverage.complete&&(!['count','range','link'].includes(coverage.paginationEvidence)||c.unresolved.length))invalid();
  // Match acquisition's normalization: corrupt checkpoints confer no authority.
  const normalizedKnown=(Array.isArray(options.knownOrderFingerprints)?options.knownOrderFingerprints:[]).filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/iu.test(id)).map(id=>id.toLowerCase());
  const saved=new Set([...normalizedKnown,...(Array.isArray(options.accountOrderFingerprints)?options.accountOrderFingerprints:[]).filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/u.test(id))]),observed=raw.observedOrderFingerprints;
  const overlap=observed.some(id=>saved.has(id)),authority=overlap?'saved-order-match':'declared-scope';
  if(c.scope.authority!==authority||coverage.accountAffinity!==authority||saved.size&&observed.length&&!overlap)invalid();
  const known=new Set(options.fullScan?[]:normalizedKnown),verified=new Set(c.verified),processed=new Set(raw.orderFingerprints);
  if(raw.ordersScanned!==c.verified.length||raw.orderFingerprints.some(id=>!verified.has(id)&&!known.has(id))||c.verified.some(id=>!processed.has(id)))invalid();
  return {finished,coverage:status,scope:authority,...(compatibility?{compatibility}:{})};
}
