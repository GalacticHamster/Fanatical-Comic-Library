(async()=>{
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async predicate=>{for(let n=0;n<750;n++){if(predicate())return;await pause(20);}throw Error('Slow lookup did not settle');};
  const summary=()=>document.querySelector('.fanatical-library-summary');
  try{
    await until(()=>summary()?.querySelector('.fanatical-library-summary-controls'));
    assert(Boolean(summary().querySelector('.fanatical-library-galactic-pending')),'local summary renders immediately while Galactic Library is pending');
    await until(()=>summary()&&!summary().querySelector('.fanatical-library-galactic-pending'));
    assert(!document.querySelector('.fanatical-library-unchecked-badge'),'A valid slow GL response was turned into Check incomplete');
    assert(document.querySelector('.fanatical-library-owned-badge')&&document.querySelector('.fanatical-library-owned-elsewhere-badge'),'Slow central ownership erased local purchases or failed to show external ownership');
    assertBadgesVisible();
    assert(summary().classList.contains('fanatical-library-summary-minimized')&&summary().dataset.position==='top-left','Slow lookup reset the saved summary preferences');
    summary().querySelector('.fanatical-library-summary-expand').click();await pause(100);
    const initial=summary();centralDelayMs=0;centralMode='reject';
    await chrome.storage.local.set({galacticLibraryExtensionId:'c'.repeat(32)});
    await until(()=>summary()!==initial&&document.querySelectorAll('.fanatical-library-unchecked-badge').length===3);
    assert(document.querySelector('.fanatical-library-owned-badge'),'An actual failed lookup erased proven local ownership');
    assertBadgesVisible();
    const failed=summary(),retry=failed.querySelector('.fanatical-library-retry-galactic');
    assert(retry,'Failed checks have no visible retry action');
    centralMode='normal';centralDelayMs=4500;retry.click();retry.click();await pause(250);
    assert(summary()===failed&&retry.disabled&&failed.getAttribute('aria-busy')==='true','Retry lost the settled summary or allowed duplicate requests');
    await until(()=>summary()!==failed&&!document.querySelector('.fanatical-library-unchecked-badge'));
    assert(document.querySelector('.fanatical-library-owned-elsewhere-badge')&&summary().querySelector('.fanatical-library-galactic-status').textContent.includes('checked linked libraries')&&summary().querySelector('[data-section="galactic"]').textContent.includes('Available.'),'Retry left stale failure labels or missed returned ownership');
    assert(!summary().querySelector('.fanatical-library-retry-galactic')&&!summary().classList.contains('fanatical-library-summary-minimized')&&summary().dataset.position==='top-left','Successful retry retained a failure action or reset summary preferences');
    assertBadgesVisible();
    const recovered=summary(),calls=requests.filter(row=>row.type==='MATCH_ITEMS').length;await pause(500);
    assert(summary()===recovered&&requests.filter(row=>row.type==='MATCH_ITEMS').length===calls,'Recovery started another central lookup or rebuilt the summary repeatedly');
    finish({ok:true,scenario:'slow central ownership, visible unchecked badges, explicit retry and stable summary',route:location.pathname});
  }catch(error){finish({ok:false,error:error.message})}
})();
