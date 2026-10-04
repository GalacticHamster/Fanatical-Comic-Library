(async()=>{
  const checks=[],check=(ok,message)=>{assert(ok,message);checks.push(message);};
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{for(let n=0;n<300;n++){if(predicate())return;await pause(20);}throw Error('Lifecycle did not settle');};
  const panel=()=>document.querySelector('.fanatical-library-summary');
  const settled=()=>panel()?.querySelector('.fanatical-library-summary-controls');
  const local=lifecycleBook?{source:'fanatical',sourceItemId:'owned-issue-123456',title:'Saga #1',mediaType:'book',run:'2020',language:'en'}:{source:'fanatical',sourceItemId:'edition-base-123456',title:'Space Adventure',mediaType:'game',externalIds:{steamAppId:'42'}};
  try{
    await until(()=>globalThis.lifecycleReleaseRead);
    check(!settled(),'Cold read has not manufactured a final analysis');
    await chrome.storage.local.set({fanaticalLibraryItems:[local]});
    lifecycleReleaseRead();
    await until(()=>settled()&&(!lifecycleBook||panel().querySelector('.fanatical-library-contents')?.textContent.includes('1 covered')));
    check(lifecycleReadCount>=2,'Storage change during the first read discards the stale snapshot');
    check(panel().querySelector('.fanatical-library-planning'),'First settled summary includes applicable planning');
    check(!panel().querySelector('[data-section="galactic"]'),'Unlinked central details remain absent');
    panel().querySelector('.fanatical-library-advanced').open=true;
    const before=panel();
    centralDelayMs=450;
    await chrome.storage.local.set({galacticLibraryExtensionId:'b'.repeat(32)});
    await until(()=>requests.some(message=>message.type==='MATCH_ITEMS'));
    // An update during a central await must be retained for the final summary.
    const wish=lifecycleBook?{sourceItemId:'contents-product-2',title:'Saga #6',mediaType:'book',weight:9}:{title:'Space Adventure Deluxe Edition',mediaType:'game',weight:9};
    await chrome.storage.local.set({fanaticalWishlistItems:[wish],fanaticalShowDiagnostics:true});
    await until(()=>settled()&&panel()!==before&&panel().querySelector('[data-section="galactic"]')&&panel().querySelector('.fanatical-library-wishlist-notice')?.textContent.includes('1 matches')&&diagnostics());
    check(!lifecycleBook||panel().querySelector('.fanatical-library-contents').textContent.includes('2 covered'),'Delayed GL updates local-plus-central contents evidence on the same page');
    check(true,'Wishlist and Diagnostics arriving during a central await reach the completed summary');
    check(requests.filter(message=>message.type==='MATCH_ITEMS').length===1,'UI-only updates retain valid in-flight GL results instead of repeating ownership requests');
    check(panel().querySelector('.fanatical-library-advanced').open,'Asynchronous hydration preserves the existing open Advanced disclosure');
    const hydrated=panel();
    // Capture an older snapshot and update another dependency while it waits.
    lifecycleBlockRead=true;
    await chrome.storage.local.set({fanaticalLibraryItems:[local]});
    const oldRelease=lifecycleReleaseRead;
    await until(()=>lifecycleReleaseRead!==oldRelease);
    await chrome.storage.local.set({fanaticalWishlistItems:[],fanaticalShowDiagnostics:false});
    lifecycleReleaseRead();
    await until(()=>settled()&&panel()!==hydrated&&!diagnostics()&&!panel().querySelector('.fanatical-library-wishlist-notice'));
    check(true,'Delayed storage cannot restore stale wishlist or diagnostics applicability');
    centralMode='reject';
    await chrome.storage.local.set({galacticLibraryExtensionId:'c'.repeat(32)});
    await until(()=>settled()&&panel().textContent.includes('check incomplete'));
    check(!lifecycleBook||panel().querySelector('.fanatical-library-contents').textContent.includes('1 covered'),'Central failure retains proven local unit evidence');
    check(lifecycleBook||!panel().querySelector('.fanatical-library-reading'),'Game bundle omits meaningless series coverage');
    centralMode='normal';centralDelayMs=0;
    panel().querySelector('.fanatical-library-reminders button').click();
    await until(()=>settled()&&!panel().textContent.includes('check incomplete'));
    const warm=panel(),calls=requests.filter(message=>message.type==='MATCH_ITEMS').length;
    await chrome.storage.local.set({fanaticalShowDiagnostics:true});
    await until(()=>settled()&&panel()!==warm&&diagnostics());
    const stable=panel();await pause(350);
    check(panel()===stable&&requests.filter(message=>message.type==='MATCH_ITEMS').length===calls,'Warm evidence is reused and the summary stops refreshing');
    check(performance.getEntriesByType('navigation')[0]===lifecycleNavigation,'All lifecycle updates completed without a second page navigation');
    await runPanelPresentationChecks(false,check);
    finish({ok:true,scenario:'cold storage, late local/central evidence, in-flight UI dependencies, warm cache, central failure, conditional game analysis',checks});
  }catch(error){finish({ok:false,error:error.message,checks});}
})();
