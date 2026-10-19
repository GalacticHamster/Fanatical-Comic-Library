// Synthetic transport only; actual packaged FAN + GL content scripts share the DOM.
globalThis.navigationShadows=new WeakMap();
const navigationAttach=Element.prototype.attachShadow;
Element.prototype.attachShadow=function(options){const root=navigationAttach.call(this,options);navigationShadows.set(this,root);return root;};
const navigationSend=chrome.runtime.sendMessage;
globalThis.navigationHoldFan=false;globalThis.navigationHoldGl=false;globalThis.navigationHoldBundle=false;
globalThis.navigationCompletedFan=0;globalThis.navigationCommits=0;
chrome.runtime.sendMessage=async(first,second)=>{
 const m=second||first;
 if(m.type==='GET_PROVIDER_PROFILE')return {ok:true,profileId:'fixture-profile',profileLabel:'Fixture',reuseAllowed:true,profiles:[]};
 if(m.type==='GET_PROVIDER_SYNC_STATE')return {ok:true,profileId:'fixture-profile',scanToken:'fixture-token',hasFullBaseline:true,syncState:{}};
 if(m.type==='FETCH_FANATICAL_ORDERS'){
  if(navigationHoldGl){navigationHoldGl=false;await new Promise(resolve=>{globalThis.navigationReleaseGl=resolve;});}
  return {ok:true,result:{items:[],ordersScanned:0,ordersAvailable:0}};
 }
 if(m.type==='COMMIT_PROVIDER_SCAN'){navigationCommits++;return {ok:true,gameCount:0,bookCount:0,audiobookCount:0};}
 if(m.type==='FANATICAL_IMPORT_PURCHASES'){
  if(navigationHoldFan){navigationHoldFan=false;await new Promise(resolve=>{globalThis.navigationReleaseFan=resolve;});}
  navigationCompletedFan++;
  return {ok:true,summary:{scanMode:'quick',ordersScanned:1,ordersSkipped:0,addedProducts:1,ownedLeafProducts:2}};
 }
 if(m.type==='FANATICAL_GET_PUBLIC_BUNDLE'&&navigationHoldBundle){
  navigationHoldBundle=false;
  await new Promise((resolve,reject)=>{globalThis.navigationRejectBundle=()=>reject(Error('Old route fetch failed'));});
 }
 return navigationSend(first,second);
};

// Emulate the website rerendering its own page after Back/Forward.
addEventListener('popstate',()=>{document.querySelector('main').innerHTML=location.pathname.includes('/bundle/')?navigationCards:'Website page';});
