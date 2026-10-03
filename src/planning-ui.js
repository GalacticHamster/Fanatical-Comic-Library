(function(global){
  'use strict';const F=global.FanaticalLibrary;
  const node=(tag,text='')=>{const element=document.createElement(tag);element.textContent=text;return element;};
  function createPurchasePlanning(parsed,matches,state){
    const root=node('details');root.className='fanatical-library-planning';root.open=state.planOpen;root.addEventListener('toggle',()=>{state.planOpen=root.open;});root.append(node('summary','Wishlist and purchase planning'));
    const goal=node('select');goal.setAttribute('aria-label','Purchase planning goal');for(const [value,text]of [['products','Confirmed-new products'],['units','Additional full issues/volumes'],['wishlist','Wishlist items']]){const option=node('option',text);option.value=value;goal.append(option);}goal.value=state.planGoal;
    const label=node('label'),uncertain=node('input');uncertain.type='checkbox';uncertain.checked=state.planUncertain;label.append(uncertain,document.createTextNode(' Include Possible, Partial and Check incomplete products explicitly'));
    const note=node('p','Plans do not change ownership or select anything in the store. Unknown units never count as newly covered. A unit goal can use verified additional contents of a partial offer.'),output=node('div');output.setAttribute('role','status');
    const render=()=>{
      state.planGoal=goal.value;state.planUncertain=uncertain.checked;const plan=F.planPurchase(parsed,matches,state.wishlist,{goal:goal.value,includeUncertain:uncertain.checked});output.replaceChildren();output.append(node('p',`Targets: ${plan.targetProducts} products / ${plan.targetUnits} distinct additional units; ${plan.excludedUncertain} uncertain products excluded; ${plan.unavailable} unavailable offers excluded.`));
      const list=node('ul');for(const tier of plan.plans){const cost=tier.price!==null?'$'+(tier.price/100).toFixed(2):'Unknown price',row=node('li',`${cost}: ${tier.quantity} slots/items; ${tier.wishlistWeight} wishlist priority points; ${tier.additionalUnits} distinct additional units${tier.additionalUnits&&tier.price!==null?' ($'+(tier.price/100/tier.additionalUnits).toFixed(2)+'/unit)':''}; ${tier.complete?'goal satisfied':'goal not fully satisfied'}.`);if(parsed.kind==='pick-mix')row.textContent+=' Suggested: '+tier.selected.map(item=>item.title).join('; ');list.append(row);}output.append(list);
      const result=node('p',plan.recommended?(plan.recommended.exact?'Lowest tier satisfying this goal: ':'Feasible plan; cheaper tiers not ruled out: ')+'$'+(plan.recommended.price/100).toFixed(2):'No priced tier satisfies every target under these rules. Partial suggestions are shown above.');result.className='fanatical-library-plan-result';output.append(result);if(plan.unitsUnconfirmed)output.append(node('p','Some contents or comparisons are unconfirmed; their units are excluded from value calculations.'));
    };
    goal.addEventListener('change',render);uncertain.addEventListener('change',render);root.append(note,goal,label,output);render();
    const manage=node('details');manage.open=state.wishOpen;manage.append(node('summary','Wishes in this offer'));manage.addEventListener('toggle',()=>{state.wishOpen=manage.open;});const list=node('ul'),previous=node('button','Previous offered wishes'),next=node('button','Next offered wishes'),count=node('p'),status=node('p');previous.type=next.type='button';status.setAttribute('role','status');
    const renderProducts=()=>{
      list.replaceChildren();const products=[...new Map(parsed.products.map(product=>[product.sourceItemId,product])).values()];state.offerWishPage=Math.min(state.offerWishPage,Math.max(0,Math.ceil(products.length/50)-1));previous.disabled=state.offerWishPage===0;next.disabled=(state.offerWishPage+1)*50>=products.length;count.textContent=`Page ${state.offerWishPage+1}; showing up to 50 of ${products.length} offers.`;
      for(const product of products.slice(state.offerWishPage*50,state.offerWishPage*50+50)){
        const row=node('li',product.title+' '),wish=state.wishlist.find(item=>item.sourceItemId===product.sourceItemId||F.classify(product,[item]).state==='owned'),weight=node('input'),save=node('button',wish?'Save priority':'Add to wishlist'),remove=node('button','Remove wish');row.dataset.productId=product.sourceItemId;weight.type='number';weight.min='1';weight.max='100';weight.value=String(wish?.weight||1);weight.setAttribute('aria-label','Wishlist priority for '+product.title);save.type=remove.type='button';remove.disabled=!wish;
        save.addEventListener('click',async()=>{try{state.wishlist=await F.updateWishlist('add',[{...(wish||product),weight:Number(weight.value)}]);status.textContent='Wishlist saved; ownership was not changed.';renderProducts();render();}catch(error){status.textContent=error.message;}});
        remove.addEventListener('click',async()=>{try{state.wishlist=await F.updateWishlist('remove',F.wishlistKey(wish));renderProducts();render();}catch(error){status.textContent=error.message;}});row.append(weight,save,remove);list.append(row);
      }
    };
    previous.addEventListener('click',()=>{state.offerWishPage--;renderProducts();});next.addEventListener('click',()=>{state.offerWishPage++;renderProducts();});manage.append(count,previous,next,list,status);renderProducts();root.append(manage);return root;
  }
  F.createPurchasePlanning=createPurchasePlanning;
})(globalThis);
