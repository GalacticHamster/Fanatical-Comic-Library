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
  if(!value||value.version!==1||Object.keys(value).some(k=>!['version','counts','bundleShapes','summaryRecovery','productMismatches'].includes(k))||!value.counts||typeof value.counts!=='object'||Array.isArray(value.counts)||Object.keys(value.counts).length!==fields.length||fields.some(k=>!Number.isSafeInteger(value.counts[k])||value.counts[k]<0||value.counts[k]>100000))return null;
  const result={version:1,counts:Object.fromEntries(fields.map(k=>[k,value.counts[k]]))};
  if(value.summaryRecovery!==undefined){
    const r=value.summaryRecovery,counts=['eligible','scheduled','recovered','unresolved','emptyDetailItems'],types=['missing','null','array','object','string','number','boolean','other'],bounded=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
    if(!r||r.version!==1||Object.keys(r).length!==7||Object.keys(r).some(k=>!['version','detailItemTypes',...counts].includes(k))||counts.some(k=>!bounded(r[k]))||!r.detailItemTypes||Object.keys(r.detailItemTypes).length!==types.length||types.some(k=>!bounded(r.detailItemTypes[k]))||r.scheduled>r.eligible||r.recovered+r.unresolved>r.scheduled||r.emptyDetailItems>r.detailItemTypes.array||types.reduce((n,k)=>n+r.detailItemTypes[k],0)>r.scheduled)return null;
    result.summaryRecovery={version:1,...Object.fromEntries(counts.map(k=>[k,r[k]])),detailItemTypes:Object.fromEntries(types.map(k=>[k,r.detailItemTypes[k]]))};
  }
  if(value.bundleShapes!==undefined){
    const shapes=value.bundleShapes,types=['missing','null','array','object','string','number','boolean','other'];
    const typed=['parentType','bundlesType','parentId','parentName','parentGames','parentProducts','parentItems','parentTiers','bundleGames','bundleProducts','bundleItems','bundleTiers','childType','childId','childName','childGames','childProducts','childItems','childTiers'];
    const keys=['stage','reason','bundlesSize',...typed];
    if(!shapes||shapes.version!==1||Object.keys(shapes).length!==3||Object.keys(shapes).some(k=>!['version','records','truncated'].includes(k))||typeof shapes.truncated!=='boolean'||!Array.isArray(shapes.records)||shapes.records.length>8)return null;
    if(shapes.records.some(r=>!r||Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||!['summaries','details'].includes(r.stage)||!['missing','empty-array','non-array','missingItems','invalidItems','missing-parent-name','missing-leaf-name','missingBundles','invalidBundles','missingGames','invalidGames'].includes(r.reason)||!['not-container','empty','one','many'].includes(r.bundlesSize)||typed.some(k=>!types.includes(r[k]))))return null;
    result.bundleShapes={version:1,records:shapes.records.map(r=>Object.fromEntries(keys.map(k=>[k,r[k]]))),truncated:shapes.truncated};
  }
  if(value.productMismatches!==undefined){
    const pm=value.productMismatches,cats=['parent-missing','unexpected-detail-item','id-missing','direct-missing','product-missing','product-count'],bounded=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000;
    const ctxInts=['summaryParents','detailParents','promotionalDetailParents','unexpectedDetailParents','detailDirectParents','detailBundleParents','nonStringPickAndMix'],ctxKeys=[...ctxInts,'normalizedNameMatched'];
    const validCtx=c=>c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).length===ctxKeys.length&&Object.keys(c).every(k=>ctxKeys.includes(k))&&ctxInts.every(k=>bounded(c[k]))&&typeof c.normalizedNameMatched==='boolean';
    const validRecord=r=>r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).every(k=>['category','expectedCount','observedCount','parentContext'].includes(k))&&cats.includes(r.category)&&bounded(r.expectedCount)&&bounded(r.observedCount)&&(!Object.hasOwn(r,'parentContext')||validCtx(r.parentContext));
    if(!pm||pm.version!==1||Object.keys(pm).length!==3||Object.keys(pm).some(k=>!['version','records','truncated'].includes(k))||typeof pm.truncated!=='boolean'||!Array.isArray(pm.records)||pm.records.length>8||pm.records.some(r=>!validRecord(r)))return null;
    result.productMismatches={version:1,records:pm.records.map(r=>({category:r.category,expectedCount:r.expectedCount,observedCount:r.observedCount,...(Object.hasOwn(r,'parentContext')?{parentContext:{...Object.fromEntries(ctxInts.map(k=>[k,r.parentContext[k]])),normalizedNameMatched:r.parentContext.normalizedNameMatched}}:{})})),truncated:pm.truncated};
  }
  return result;
}
// Rejected purchase diagnostics are data, not arbitrary page-world objects.
// Reconstruct only these fields; unknown fields (including getters) are never read.
export function fanaticalRejectedPurchaseItems(value){
  const invalid=()=>{throw Error('Invalid Fanatical rejected purchase information. Earlier purchases were kept.');};
  const object=v=>{
    if(!v||typeof v!=='object'||Array.isArray(v))invalid();
    const proto=Object.getPrototypeOf(v);
    if(proto!==null&&Object.getPrototypeOf(proto)!==null)invalid();
  };
  const field=(v,key)=>{
    const descriptor=Object.getOwnPropertyDescriptor(v,key);
    if(descriptor&&!Object.hasOwn(descriptor,'value'))invalid();
    return descriptor?.value;
  };
  const text=(v,max,required=false)=>{
    if(typeof v!=='string'||v.length>max||required&&!v.trim())invalid();
    return v;
  };
  const list=(v,max,project)=>{
    if(!Array.isArray(v)||v.length>max)invalid();
    const result=[];
    for(let n=0;n<v.length;n++){
      const descriptor=Object.getOwnPropertyDescriptor(v,String(n));
      if(!descriptor||!Object.hasOwn(descriptor,'value'))invalid();
      result.push(project(descriptor.value));
    }
    return result;
  };
  return list(value,50000,item=>{
    object(item);
    const result={sourceItemId:text(field(item,'sourceItemId'),128,true),title:text(field(item,'title'),500,true)};
    for(const [key,max]of [['sourceBundle',500],['reason',500],['delivery',500]]){
      if(Object.hasOwn(item,key))result[key]=text(field(item,key),max);
    }
    if(Object.hasOwn(item,'purchaseDate')){
      const date=field(item,'purchaseDate');
      if(date!==null&&(typeof date!=='string'||date.length>64||!Number.isFinite(Date.parse(date))))invalid();
      result.purchaseDate=date;
    }
    if(Object.hasOwn(item,'streaming')){
      const streaming=field(item,'streaming');if(typeof streaming!=='boolean')invalid();result.streaming=streaming;
    }
    if(Object.hasOwn(item,'formats'))result.formats=list(field(item,'formats'),30,v=>text(v,40));
    if(Object.hasOwn(item,'bundle')){
      const bundle=field(item,'bundle');object(bundle);
      result.bundle={sourceItemId:text(field(bundle,'sourceItemId'),128),title:text(field(bundle,'title'),500)};
      if(Object.hasOwn(bundle,'slug'))result.bundle.slug=text(field(bundle,'slug'),300);
    }
    return result;
  });
}
export function assertFanaticalAcquisitionContract(raw,options={}){
  const invalid=()=>{throw Error('Invalid or contradictory Fanatical acquisition contract. Earlier purchases were kept.');};
  const keys=(value,allowed)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const ids=value=>Array.isArray(value)&&value.length<=100000&&value.every(id=>typeof id==='string'&&/^[a-f0-9]{64}$/u.test(id))&&new Set(value).size===value.length;
  const same=(a,b)=>{if(!ids(a)||!ids(b)||a.length!==b.length)return false;const set=new Set(b);return a.every(id=>set.has(id));};
  if(!keys(raw,['acquisitionContract','partialScanVersion','outcome','verifiedOrderFingerprints','unresolvedOrderFingerprints','ineligibleOrderFingerprints','observedOrderFingerprints','failures','unidentifiedRecords','schemaVersion','coverage','ordersScanned','ordersAvailable','orderFingerprints','items','rejectedPurchaseItems'])||raw.schemaVersion!==1||raw.partialScanVersion!==1)invalid();
  const rejected=raw.rejectedPurchaseItems===undefined?undefined:fanaticalRejectedPurchaseItems(raw.rejectedPurchaseItems);
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
  if(c.acquisition.outcome!==(finished?'finished':'interrupted')||c.coverage.status!==status||!Array.isArray(c.coverage.evidence)||c.coverage.evidence.length!==1||c.coverage.evidence[0]!==coverage.paginationEvidence||coverage.complete&&(!['count','range','link','array-only'].includes(coverage.paginationEvidence)||c.unresolved.length))invalid();
  // Match acquisition's normalization: corrupt checkpoints confer no authority.
  const normalizedKnown=(Array.isArray(options.knownOrderFingerprints)?options.knownOrderFingerprints:[]).filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/iu.test(id)).map(id=>id.toLowerCase());
  const saved=new Set([...normalizedKnown,...(Array.isArray(options.accountOrderFingerprints)?options.accountOrderFingerprints:[]).filter(id=>typeof id==='string'&&/^[a-f0-9]{64}$/u.test(id))]),observed=raw.observedOrderFingerprints;
  const overlap=observed.some(id=>saved.has(id)),authority=overlap?'saved-order-match':'declared-scope';
  if(c.scope.authority!==authority||coverage.accountAffinity!==authority||saved.size&&observed.length&&!overlap)invalid();
  const known=new Set(options.fullScan?[]:normalizedKnown),verified=new Set(c.verified),processed=new Set(raw.orderFingerprints);
  if(raw.ordersScanned!==c.verified.length||raw.orderFingerprints.some(id=>!verified.has(id)&&!known.has(id))||c.verified.some(id=>!processed.has(id)))invalid();
  return {finished,coverage:status,scope:authority,...(compatibility?{compatibility}:{}),...(rejected!==undefined?{rejectedPurchaseItems:rejected}:{})};
}
