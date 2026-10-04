// Begin without a library, linked GL, wishlist, or computed analysis.
globalThis.lifecycleNavigation=performance.getEntriesByType('navigation')[0];
globalThis.lifecycleBook=location.pathname.includes('test-contents');
globalThis.lifecycleReadCount=0;
values.fanaticalLibraryItems=[];
values.galacticLibraryExtensionId='';
values.fanaticalWishlistItems=[];
values.fanaticalSummaryPreferences={};
const lifecycleOriginalGet=chrome.storage.local.get;
globalThis.lifecycleBlockRead=true;
chrome.storage.local.get=async defaults=>{
  lifecycleReadCount++;
  const snapshot=await lifecycleOriginalGet(defaults);
  if(globalThis.lifecycleBlockRead){globalThis.lifecycleBlockRead=false;await new Promise(resolve=>{globalThis.lifecycleReleaseRead=resolve;});}
  return snapshot;
};
