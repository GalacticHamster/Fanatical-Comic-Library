// Test-only lifecycle tracing; all provider and purchase inputs are synthetic.
window.hydration={start:performance.now(),events:[],pending:[],hold:true};
const H=window.hydration;
H.log=(event,generation=window.FanaticalLibrary?.state?.revision??0)=>{if(H.events.length<100)H.events.push({event,ms:Math.round(performance.now()-H.start),generation});};
H.container=document.querySelector('.fan-grid-container');H.html=H.container.innerHTML;H.container.replaceChildren();
const hydrationSend=chrome.runtime.sendMessage;
chrome.runtime.sendMessage=async(...args)=>{
 const m=args[1]??args[0],generation=window.FanaticalLibrary?.state?.revision??0;
 if(m.type==='PING'&&H.unavailable)throw Error('Could not establish connection. Receiving end does not exist.');
 if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')H.log('extraction-request',generation);
 if(m.type==='MATCH_ITEMS'){H.log('gl-request',generation);if(H.hold)await new Promise(resolve=>H.pending.push(resolve));}
 try{const result=await hydrationSend(...args);if(m.type==='MATCH_ITEMS')H.log('gl-response',generation);if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE')H.log('extraction-ready',generation);return result;}
 catch(error){if(m.type==='MATCH_ITEMS')H.log('gl-error',generation);throw error;}
};
const hydrationGet=chrome.storage.local.get;
chrome.storage.local.get=async defaults=>{const result=await hydrationGet(defaults);if(Object.hasOwn(defaults,'fanaticalLibraryItems'))H.log('local-ready');return result;};
let hydrationSignature='';
new MutationObserver(()=>{const signature=[...document.querySelectorAll('[data-fanatical-library-for]')].map(b=>b.dataset.fanaticalLibraryFor+':'+b.textContent).join('|');if(signature!==hydrationSignature){hydrationSignature=signature;H.log(signature?'badges-rendered':'badges-removed');}}).observe(document.documentElement,{childList:true,subtree:true});
