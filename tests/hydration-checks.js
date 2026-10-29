(async()=>{
 const checks=[],check=(condition,message)=>{assert(condition,message);checks.push(message);};
 const H=window.hydration,pause=ms=>new Promise(r=>setTimeout(r,ms));
 const until=async(predicate,limit=2000)=>{const end=performance.now()+limit;while(performance.now()<end){if(predicate())return;await pause(20);}throw Error('Timed out: '+predicate);};
 const badges=()=>document.querySelectorAll('[data-fanatical-library-for]');
 const visible=()=>[...badges()].every(b=>{for(let n=b;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return b.getBoundingClientRect().width>0;});
 const release=()=>{H.hold=false;H.pending.splice(0).forEach(r=>r());};
 try{
  await until(()=>H.pending.length);const count=FanaticalLibrary.state.parsed.products.length;check(badges().length===0,'No classifications invented before native cards exist');
  H.log('hydrate');H.container.innerHTML=H.html;
  await until(()=>badges().length===count,1000);
  check(H.pending.length>0&&!H.events.some(e=>e.event==='gl-response'),'Local badges paint while GL is still held');check(visible(),'Hydrated local badges are visibly rendered');
  const localOwned=[...badges()].filter(b=>b.classList.contains('fanatical-library-owned-badge')).map(b=>b.dataset.fanaticalLibraryFor);
  document.body.style.minHeight='2400px';window.scrollTo(0,120);const savedScroll=window.scrollY;
  const summary=document.querySelector('[data-fanatical-library-summary]');summary.querySelector('.fanatical-library-advanced').open=true;
  const first=H.container.querySelector('article'),replacement=first.cloneNode(true);replacement.querySelectorAll('[data-fanatical-library-for]').forEach(b=>b.remove());first.replaceWith(replacement);H.log('replace-card');
  await until(()=>badges().length===count,1000);check(visible(),'Replacement card repaints before GL responds');check(document.querySelector('[data-fanatical-library-summary]')===summary&&summary.querySelector('.fanatical-library-advanced').open,'Card hydration preserves panel and disclosure state');
  check(window.scrollY===savedScroll,'Hydration repair preserves scroll position');
  check(H.events.filter(e=>e.event==='gl-request').length===1&&H.events.filter(e=>e.event==='local-ready').length===1,'Hydration repair does not repeat local reads or GL requests');
  await pause(3000);check(H.pending.length>0&&badges().length===count,'Three-second GL delay does not remove local badges');
  // Synthetic storefront charity dialog: native top-layer focus and input must
  // survive asynchronous ownership hydration underneath it.
  const charity=document.createElement('dialog');charity.innerHTML='<form method="dialog"><label>Charity contribution <input type="number" value="2" aria-label="Charity contribution"></label><button>Done</button></form>';document.body.append(charity);charity.showModal();const contribution=charity.querySelector('input');contribution.focus();contribution.value='3';
  release();await until(()=>!FanaticalLibrary.state.rendering);check(badges().length===count&&visible(),'GL enrichment settles without duplicate or missing badges');
  check(charity.open&&document.activeElement===contribution&&contribution.value==='3','Charity dialog retains focus and entered contribution during GL enrichment');const rect=contribution.getBoundingClientRect();check(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)===contribution,'Ownership overlays do not cover the storefront charity control');charity.close();charity.remove();
  H.container.replaceChildren();FanaticalLibrary.render();await until(()=>!FanaticalLibrary.state.rendering);H.log('warm-hydrate');H.container.innerHTML=H.html;await until(()=>badges().length===count);check(visible(),'Warm GL response before hydration still yields visible badges');
  H.hold=true;await chrome.storage.local.set({galacticLibraryExtensionId:'c'.repeat(32)});await until(()=>H.pending.length);H.container.replaceChildren();H.container.innerHTML=H.html;await until(()=>badges().length===count,1000);check(H.pending.length>0,'Fresh local badges do not wait for a repeated lookup');
  // A route change while the previous lookup is held must initialize locally.
  const oldPending=H.pending.splice(0);history.pushState({},'',location.pathname+'?hydration-next=1');window.dispatchEvent(new PopStateEvent('popstate'));H.log('route-change');
  await until(()=>H.pending.length&&FanaticalLibrary.state.url.includes('hydration-next=1'));
  check(badges().length===count,'New route paints locally before its and the old GL requests finish');
  release();await until(()=>!FanaticalLibrary.state.rendering);const newer=[...badges()].map(b=>b.textContent).join('|');oldPending.forEach(r=>r());await pause(150);check([...badges()].map(b=>b.textContent).join('|')===newer,'Stale route GL reply cannot overwrite newer badges');
  centralMode='reject';await chrome.storage.local.set({galacticLibraryExtensionId:'d'.repeat(32)});await until(()=>!FanaticalLibrary.state.rendering&&FanaticalLibrary.state.failed.size>0);check(badges().length===count,'GL failure retains local card classifications');
  check(localOwned.every(id=>[...badges()].some(b=>b.dataset.fanaticalLibraryFor===id&&b.classList.contains('fanatical-library-owned-badge'))),'GL failure preserves every locally purchased classification');
  H.unavailable=true;await chrome.storage.local.set({galacticLibraryExtensionId:'e'.repeat(32)});await until(()=>!FanaticalLibrary.state.rendering&&FanaticalLibrary.state.galacticConnectionState==='unavailable');
  H.container.replaceChildren();H.container.innerHTML=H.html;await until(()=>badges().length===count);check(visible(),'Unavailable GL does not block local hydration');
  finish({ok:true,scenario:'local-first hydration and stale route requests',checks,trace:H.events});
 }catch(error){finish({ok:false,error:error.message,checks,trace:H.events});}
})();
