/* Wishlist identity is independent of ownership; planning uses resolved badges. */
(function(global){
  'use strict';const F=global.FanaticalLibrary;
  function wishlistFields(item){
    const fields=F.bibliographicFields(item),isbn=[...new Set([item.externalIds?.isbn,item.isbn,item.isbns,item.evidence?.isbn].flat().map(F.validIsbn).filter(Boolean))].sort();
    if(isbn.length)fields.isbn=isbn;
    return fields;
  }
  function wishlistKey(item){return JSON.stringify([F.mediaType(item.mediaType),item.sourceItemId||'',F.scopeKey(item.title),wishlistFields(item).isbn||[],item.edition||'',(item.authors||[]).map(F.scopeKey).sort()]);}
  function normalizeWishlist(value=[]){
    if(!Array.isArray(value)||value.length>10000)throw Error('Wishlist must contain at most 10,000 items.');const unique=new Map();
    for(const item of value){if(!item||typeof item.title!=='string'||!item.title.trim()||item.title.length>500||!['game','book','audiobook','software','audio','elearning','other'].includes(item.mediaType)||!Number.isSafeInteger(item.weight??1)||(item.weight??1)<1||(item.weight??1)>100)throw Error('Every wish needs a title, media type and weight from 1 to 100.');
      const row={title:item.title.trim(),mediaType:item.mediaType,weight:item.weight??1,...(typeof item.sourceItemId==='string'&&/^[a-zA-Z0-9_-]{6,128}$/.test(item.sourceItemId)?{sourceItemId:item.sourceItemId}:{}),...wishlistFields(item)};const ids=F.externalIds(item);if(Object.keys(ids).length)row.externalIds=ids;unique.set(wishlistKey(row),row);
    }return [...unique.values()];
  }

  function wishlistRelation(wanted, item) {
    const kind=F.mediaType(item.mediaType), wantedKind=F.mediaType(wanted.mediaType);
    if(kind!==wantedKind)return 'none';
    const a=wishlistFields(wanted), b=wishlistFields(item), policy=global.LibraryMatchingPolicy;
    const hard=F.identityConflicts(item,wanted,false);
    if(hard.some(reason=>/issue|volume|unitType|seriesId|runId|Different run/iu.test(reason)))return 'none';
    const issues=value=>{const match=/(?:#|\bvol(?:ume)?s?\.?\s*)(\d+(?:\.\d+|\/\d+)?)/iu.exec(value.title||'');return match?policy.unitKey(match[1]):'';};
    if(issues(item)&&issues(wanted)&&issues(item)!==issues(wanted))return 'none';
    const shared=Boolean(a.isbn?.some(id=>b.isbn?.includes(id))||a.asin&&a.asin===b.asin||a.editionId&&a.editionId===b.editionId);
    const sameTitle=policy.fullTitleMatches(item.title,wanted.title,kind);
    const conflicts=F.identityConflicts(item,wanted,true).filter(reason=>reason!=='Author name variation needs review');
    const packageLabel=value=>kind==='game'?(String(value).match(/\b(base(?: game)?|standard|deluxe|gold|platinum|ultimate|complete|definitive|premium|goty|game of the year)(?: edition)?\s*$/iu)?.[0]||'').toLowerCase():'';
    const packageDifference=packageLabel(item.title)!==packageLabel(wanted.title);
    const strong=shared||sameTitle||Boolean((item.externalIds?.steamAppId||item.steamAppId)&&(item.externalIds?.steamAppId||item.steamAppId)===(wanted.externalIds?.steamAppId||wanted.steamAppId));
    if(strong&&!conflicts.length&&!packageDifference)return 'match';
    if(strong||F.classify(item,[wanted]).state==='possible')return 'related';
    return 'none';
  }
  function wishlistIntentKey(item) {
    const data=wishlistFields(item);
    return JSON.stringify([F.mediaType(item.mediaType),global.LibraryMatchingPolicy.presentationTitle(item.title,F.mediaType(item.mediaType)),Object.fromEntries(Object.entries(data).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>[key,Array.isArray(value)?[...value].sort():value]))]);
  }
  function planningWishes(wishlist) {
    const unique=new Map();
    for(const wish of normalizeWishlist(wishlist)){const id=wishlistIntentKey(wish),previous=unique.get(id);if(!previous||wish.weight>previous.weight)unique.set(id,wish);}
    return [...unique.values()];
  }

  async function updateWishlist(action,value){const response=await chrome.runtime.sendMessage({type:'FANATICAL_STORE',operation:'wishlist',args:[action,value]});if(!response?.ok)throw Error(response?.error||'Could not update wishlist.');return response.result;}
  const price=value=>(typeof value==='number'||typeof value==='string'&&value.trim())&&Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):null;
  const available=item=>item.availability?.regionAvailable!==false&&item.availability?.soldOut!==true&&item.availability?.storeVisible!==false;
  function unitSelection(rows,target,slots){
    const candidates=rows.filter(row=>row.units.size).sort((a,b)=>b.units.size-a.units.size||b.weight-a.weight||a.product.sourceItemId.localeCompare(b.product.sourceItemId));let nodes=0,limited=candidates.length>24||slots>8||target.size>2000,solution=null;
    const suffix=[];if(!limited){suffix[candidates.length]=new Set();for(let n=candidates.length-1;n>=0;n--)suffix[n]=new Set([...suffix[n+1],...candidates[n].units]);}
    const visit=(index,chosen,covered)=>{if(++nodes>25000){limited=true;return;}if([...target].every(key=>covered.has(key))){solution=chosen;return;}if(chosen.length===slots||index===candidates.length||[...target].some(key=>!covered.has(key)&&!suffix[index].has(key)))return;visit(index+1,[...chosen,candidates[index]],new Set([...covered,...candidates[index].units]));if(!solution&&!limited)visit(index+1,chosen,covered);};
    if(!limited)visit(0,[],new Set());
    if(!solution&&limited){const chosen=[],covered=new Set();while(chosen.length<slots){const next=candidates.filter(row=>!chosen.includes(row)).map(row=>({row,added:[...row.units].filter(key=>!covered.has(key)).length})).sort((a,b)=>b.added-a.added||b.row.weight-a.row.weight)[0];if(!next?.added)break;chosen.push(next.row);for(const key of next.row.units)covered.add(key);if([...target].every(key=>covered.has(key))){solution=chosen;break;}}}
    return {selected:solution,exact:!limited};
  }
  function planPurchase(parsed,matches,wishlist=[],{goal='products',includeUncertain=false}={}){
    if(!['products','units','wishlist'].includes(goal))throw Error('Unknown purchase goal.');const wishes=planningWishes(wishlist),contents=F.bundleContents(parsed,matches),additional=new Set(contents.additional.map(F.contentKey));
    const unavailableIds=new Set(parsed.products.filter(product=>!available(product)).map(product=>product.sourceItemId));
    const rows=[...new Map(parsed.products.map((product,index)=>{const match=matches[index]||{state:'unchecked'},units=new Set(F.offerContents(product).entries.map(F.contentKey).filter(key=>additional.has(key)));const wishIds=new Set();for(const [index,wish] of wishes.entries())if(wishlistRelation(wish,product)==='match')wishIds.add(index);const weight=[...wishIds].reduce((sum,id)=>sum+wishes[id].weight,0);return {product,match,units,weight,wishIds};}).map(row=>[row.product.sourceItemId,row])).values()].filter(row=>!unavailableIds.has(row.product.sourceItemId));
    const eligible=rows.filter(row=>!['owned','owned-elsewhere'].includes(row.match.state)&&!row.match.lookupIncomplete&&(row.match.state==='new'||goal==='units'&&row.match.state==='partial'&&row.units.size||includeUncertain&&row.match.state==='possible'));
    const targets=eligible.filter(row=>goal==='wishlist'?row.weight>0:goal==='units'?row.units.size>0:true),targetIds=new Set(targets.map(row=>row.product.sourceItemId)),targetUnits=new Set(targets.flatMap(row=>[...row.units]));
    const targetWishes=new Set(targets.flatMap(row=>[...row.wishIds]));
    const preference=(a,b)=>b.weight-a.weight||b.units.size-a.units.size||a.product.title.localeCompare(b.product.title);
    const metrics=selected=>{const fulfilled=new Set(selected.flatMap(row=>[...row.wishIds]));return {wishlistWeight:[...fulfilled].reduce((sum,id)=>sum+wishes[id].weight,0),wishlistCount:fulfilled.size,additionalUnits:new Set(selected.flatMap(row=>[...row.units])).size};};
    let uncertainSearch=false;const plans=[];
    if(parsed.kind==='standard'){
      const groups=parsed.groups.map(group=>({group,price:price(group.price?.USD)})).sort((a,b)=>(a.price??Infinity)-(b.price??Infinity)),ids=new Set();
      for(const {group,price:cost}of groups){for(const product of group.products)ids.add(product.sourceItemId);const selected=eligible.filter(row=>ids.has(row.product.sourceItemId)),covered=new Set(selected.flatMap(row=>[...row.units]));const complete=targets.length>0&&(goal==='units'?[...targetUnits].every(key=>covered.has(key)):goal==='wishlist'?[...targetWishes].every(id=>selected.some(row=>row.wishIds.has(id))):[...targetIds].every(id=>ids.has(id)));plans.push({price:cost,quantity:ids.size,complete,exact:true,selected:selected.map(row=>row.product),...metrics(selected)});}
    }else{
      for(const tier of [...parsed.tiers].sort((a,b)=>(price(a.price?.USD)??Infinity)-(price(b.price?.USD)??Infinity))){
        const quantity=tier.quantity,cost=price(tier.price?.USD);if(!Number.isSafeInteger(quantity)||quantity<1||cost===null)continue;let selected=null,exact=true;
        if(targets.length&&quantity<=eligible.length){if(goal==='units'||goal==='wishlist'){const candidates=goal==='wishlist'?eligible.map(row=>({...row,units:row.wishIds})):eligible;const search=unitSelection(candidates,goal==='wishlist'?targetWishes:targetUnits,quantity);selected=search.selected?.map(row=>eligible.find(original=>original.product.sourceItemId===row.product.sourceItemId));exact=search.exact;}else if(targets.length<=quantity)selected=[...targets];}
        const complete=Boolean(selected);if(selected){for(const filler of [...eligible].sort(preference)){if(selected.length>=quantity)break;if(!selected.includes(filler))selected.push(filler);}}else selected=[...eligible].sort(preference).slice(0,quantity);
        uncertainSearch||=!exact;plans.push({price:cost,quantity,complete,exact:exact&&!uncertainSearch,selected:selected.map(row=>row.product),...metrics(selected)});
      }
    }
    const recommended=plans.find(plan=>plan.complete&&plan.price!==null)||null;
    return {goal,includeUncertain,targetProducts:targetIds.size,targetWishes:targetWishes.size,targetUnits:targetUnits.size,excludedUncertain:rows.filter(row=>['possible','partial','unchecked'].includes(row.match.state)&&!eligible.includes(row)).length,unavailable:new Set(parsed.products.map(product=>product.sourceItemId)).size-rows.length,plans,recommended,unitsUnconfirmed:contents.incompleteProducts>0||contents.uncertain.length>0};
  }
  Object.assign(F,{wishlistKey,normalizeWishlist,wishlistRelation,wishlistIntentKey,planningWishes,updateWishlist,planPurchase});
})(globalThis);
