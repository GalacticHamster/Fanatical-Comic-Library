import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture(){
  const timers=new Map();let next=0;
  const context={URL,Promise,console,setTimeout:(callback,ms)=>{const id=++next;timers.set(id,{callback,ms});return id;},clearTimeout:id=>timers.delete(id)};
  context.globalThis=context;vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../src/shared.js',import.meta.url),'utf8'),context);
  return {F:context.FanaticalLibrary,timers};
}
test('large-library central deadline is finite, late results cannot erase failures, and retry recovers',async()=>{
  const {F,timers}=fixture();let finishLate;
  const requests=[{requestId:'one',mediaType:'book',title:'Slow comic'}];
  const pending=F.queryGalacticItems(requests,()=>new Promise(resolve=>{finishLate=resolve;}));
  const deadline=[...timers.values()][0];assert.equal(deadline.ms,30000);
  deadline.callback();const failure=await pending;
  assert.equal(failure.results.size,0);assert(failure.failed.has('one'));
  assert.match([...failure.failures][0],/after 30 seconds/u);assert.equal(timers.size,0);
  const reply={ok:true,apiVersion:1,results:[{requestId:'one',matches:[]}]};
  const retry=await F.queryGalacticItems(requests,async()=>reply);
  assert.equal(retry.results.size,1);assert.equal(retry.failed.size,0);assert.equal(retry.failures.size,0);
  finishLate(reply);await Promise.resolve();await Promise.resolve();
  assert.equal(failure.results.size,0);assert(failure.failed.has('one'));assert.equal(retry.failed.size,0);assert.equal(timers.size,0);
});
test('software capability checks use the same finite large-library deadline',async()=>{
  const {F,timers}=fixture();
  const pending=F.galacticCapabilities(()=>new Promise(()=>{}));
  const rejection=assert.rejects(pending,/Connection timed out/u);
  const deadline=[...timers.values()][0];assert.equal(deadline.ms,30000);deadline.callback();await rejection;assert.equal(timers.size,0);
});
