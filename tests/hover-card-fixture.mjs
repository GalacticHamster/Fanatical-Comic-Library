// Minimal structural fixture captured from the public CoppaFeel page, 2026-10-20.
// The native overlay is layer 5 and its child is transparent until real hover.
export const hoverCardCss=`
section[data-tier]{display:grid;grid-template-columns:repeat(2,280px);gap:20px}
article{position:relative;height:220px;width:280px;margin:0;padding:0}
.cover-container{position:relative;height:180px}.cover-container img{display:block;width:280px;height:180px;background:#36506b}
.overlay-container{position:absolute;inset:0 0 40px;z-index:5;text-align:center}
.card-overlay{display:flex;align-items:center;justify-content:center;width:100%;height:100%;opacity:0}
article:hover>.overlay-container{background:rgba(0,0,0,.95)}article:hover .card-overlay{opacity:1}
.card-overlay a,.card-overlay button{color:white}.card-product-name{font-size:14px;margin:5px}.native-price{position:absolute;bottom:4px}
`;
export function hoverCardMarkup(p,i){
 const type=i===1?'bundle-product-card':i===2?'PickAndMixCard':'bundle-game-card';
 const title=`<h3 class="card-product-name">${p.name}</h3>`;
 const overlay=i===1?title:`<div class="overlay-container"><div class="card-overlay"><div>${title}<a class="faux-block-link__overlay-link" href="#product-${i}">Product details</a>${i===2?'<button class="native-select" type="button">Select</button>':''}</div></div></div>`;
 return `<article class="${type} faux-block-link" data-index="${i}"><div class="cover-container"><div class="responsive-image-island"><div class="responsive-image responsive-image--16by9"><img alt="${p.name}"></div></div></div>${overlay}<span class="native-price">$5</span></article>`;
}
export async function checkHoverCards({evaluate,pointer,check}){
 let total=0;const assert=(condition,label)=>{check(condition,label);total++;};
 await evaluate(`(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());window.hoverLinks=0;window.hoverSelections=0;document.querySelectorAll('.faux-block-link__overlay-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();window.hoverLinks++;}));document.querySelector('.native-select').addEventListener('click',()=>{window.hoverSelections++;document.querySelector('[data-index="2"] .native-price').textContent='$10';});return true;})()`);
 const position=async(i,selector='')=>evaluate(`(()=>{const c=document.querySelector('[data-index="${i}"]');c.scrollIntoView({block:'center'});const r=(c.querySelector(${JSON.stringify(selector||'[data-fanatical-library-for]')})).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
 const visible=i=>evaluate(`(()=>{const b=document.querySelector('[data-index="${i}"] [data-fanatical-library-for]');if(!b)return false;for(let n=b;n;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0)return false;}const r=b.getBoundingClientRect();return r.width>0&&r.height>0&&b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})()`);
 for(let i=0;i<5;i++){
  await position(i);await pointer(0,0);assert(await visible(i),'Card '+i+' badge visible and hit-testable before hover');
  const p=await position(i);await pointer(p.x,p.y);assert(await visible(i),'Card '+i+' badge visible during native hover');
  if(i!==1)assert(await evaluate(`Number(getComputedStyle(document.querySelector('[data-index="${i}"] .card-overlay')).opacity)===1`),'Native hover details still appear');
  await pointer(0,0);assert(await visible(i),'Card '+i+' badge visible after mouseout');
 }
 let p=await position(0,'.faux-block-link__overlay-link');await pointer(p.x,p.y);await pointer(p.x,p.y,true);assert(await evaluate('window.hoverLinks')===1,'Native product details link receives real clicks');
 p=await position(2,'.native-select');await pointer(p.x,p.y);await pointer(p.x,p.y,true);assert(await evaluate('window.hoverSelections')===1,'Native Pick & Mix selection remains usable');assert(await evaluate('document.querySelector(\'[data-index="2"] .native-price\').textContent')==='$10','Native pricing responds to selection');
 const initial=await evaluate(`JSON.stringify([...document.querySelectorAll('[data-index]')].map(c=>{const r=c.getBoundingClientRect(),i=c.querySelector('img').getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height,i.width,i.height]}))`);
 await evaluate(`(()=>{const c=document.querySelector('[data-index="0"]').cloneNode(true);c.dataset.index='10';document.querySelector('section[data-tier]').append(c);return true;})()`);
 const states=[['owned','Owned'],['owned-elsewhere','Owned elsewhere'],['owned','Purchased'],['new','New'],['partial','Partial'],['possible','Possible']];
 for(const [index,[state,label]]of states.entries()){
  await evaluate(`(()=>{const c=document.querySelector('[data-index="10"]');const m={state:${JSON.stringify(state)},offered:{kind:${JSON.stringify(label==='Purchased'?'game':'book')}},item:{title:'Synthetic',source:'fanatical',kind:${JSON.stringify(label==='Purchased'?'game':'book')}},provenance:'steam',owned:1,total:2};FanaticalLibrary.upsertBadge(c,'visibility-case',m,c,()=>{window.hoverInspected=true;});return true;})()`);
  const point=await position(10);await pointer(0,0);assert(await visible(10),label+' visible before hover');await pointer(point.x,point.y);assert(await visible(10),label+' visible during hover');await pointer(0,0);assert(await visible(10),label+' visible after mouseout');
  assert(await evaluate(`document.querySelector('[data-index="10"] [data-fanatical-library-for]').textContent.startsWith(${JSON.stringify(label)})`),label+' label unchanged');
  assert(await evaluate(`getComputedStyle(document.querySelector('[data-index="10"] [data-fanatical-library-for]')).backgroundColor!=='rgba(0, 0, 0, 0)'`),label+' keeps its status color');
  assert(await evaluate(`document.querySelectorAll('[data-index="10"] [data-fanatical-library-for]').length`)===1,label+' does not duplicate badges');
 }
 p=await position(10);await pointer(p.x,p.y,true);assert(await evaluate('window.hoverInspected')===true,'Badge remains clickable above native overlay');
 await evaluate(`(()=>{document.querySelector('[data-index="10"]').remove();return true;})()`);
 assert(await evaluate(`JSON.stringify([...document.querySelectorAll('[data-index]')].map(c=>{const r=c.getBoundingClientRect(),i=c.querySelector('img').getBoundingClientRect();return [r.x+scrollX,r.y+scrollY,r.width,r.height,i.width,i.height]}))`)===initial,'Badge updates do not change card/image dimensions');
 await evaluate(`(()=>{const c=document.querySelector('[data-index="0"]'),replacement=c.cloneNode(true);replacement.querySelector('[data-fanatical-library-for]').dataset.hoverStale='true';c.replaceWith(replacement);badgeRecheck('platform');return true;})()`);
 for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('[data-index="0"] [data-fanatical-library-for]:not([data-hover-stale])'))`))break;await new Promise(r=>setTimeout(r,30));}
 assert(await evaluate(`Boolean(document.querySelector('[data-index="0"] [data-fanatical-library-for]:not([data-hover-stale])'))`),'Production refresh replaces the stale cloned badge');
 await position(0);await pointer(0,0);assert(await visible(0),'React-style card replacement gets an always-visible badge');assert(await evaluate('document.querySelectorAll("[data-fanatical-library-for]").length')===5,'Refresh/replacement leaves exactly one badge per product');
 await evaluate(`(()=>{const c=document.querySelector('[data-index="4"]');window.lazyCard=c.cloneNode(true);window.lazyCard.querySelectorAll('[data-fanatical-library-for]').forEach(b=>b.remove());c.remove();badgeRecheck('platform');return true;})()`);
 await new Promise(r=>setTimeout(r,400));
 await evaluate(`(()=>{document.querySelector('section[data-tier]').append(window.lazyCard);return true;})()`);
 for(let i=0;i<100;i++){if(await evaluate(`Boolean(document.querySelector('[data-index="4"] [data-fanatical-library-for]'))`))break;await new Promise(r=>setTimeout(r,30));}
 await position(4);await pointer(0,0);assert(await visible(4),'Lazily inserted native card receives a visible badge');assert(await evaluate('document.querySelectorAll("[data-fanatical-library-for]").length')===5,'Lazy insertion keeps one badge per product');
 return total;
}
