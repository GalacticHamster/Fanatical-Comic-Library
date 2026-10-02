import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
const F=globalThis.FanaticalLibrary;
const row=(n=0)=>({reminderRef:'opaque-reminder-'+n,itemRef:'opaque-item-'+n,title:'Example '+n,provider:'fanatical',mediaType:'game',kind:'activation',dueAt:null,severity:'information',privateKey:'SECRET',metadata:{orderId:'SECRET'}});
function responder(page,caps=true){return async request=>request.type==='GET_STATUS'?{ok:true,apiVersion:1,capabilities:{entitlementReminders:caps}}:{ok:true,apiVersion:1,...page};}
test('central reminders are projected safely and follow explicit paged offsets',async()=>{
  const requests=[],send=async message=>{requests.push(message);return responder({total:51,nextOffset:50,reminders:Array.from({length:50},(_,n)=>row(n))})(message);};const page=await F.loadCentralReminders(send);assert.equal(page.reminders.length,50);assert.equal(page.nextOffset,50);assert(!JSON.stringify(page).includes('SECRET'));assert.deepEqual(requests.map(request=>request.type),['GET_STATUS','GET_REMINDERS']);assert.equal(requests[1].provider,'fanatical');
  const second=await F.loadCentralReminders(responder({total:51,nextOffset:null,reminders:[row(50)]}),{offset:50});assert.equal(second.reminders[0].title,'Example 50');
});
test('absent capability, rejected transport and incompatible versions cannot become an empty checked feed',async()=>{
  await assert.rejects(F.loadCentralReminders(responder({total:0,nextOffset:null,reminders:[]},false)),/does not advertise/);await assert.rejects(F.loadCentralReminders(async()=>({ok:false,apiVersion:1})),/rejected/);await assert.rejects(F.loadCentralReminders(async()=>({ok:true,apiVersion:2})),/Incompatible/);await assert.rejects(F.loadCentralReminders(async()=>{throw Error('SECRET transport');}),/connection unavailable/);
});
test('malformed pagination, duplicate reminders, wrong providers and invented deadlines are rejected',async()=>{
  const valid={total:1,nextOffset:null,reminders:[row()]};for(const page of [{...valid,nextOffset:50},{...valid,total:2},{...valid,reminders:[{...row(),provider:'humble'}]},{...valid,reminders:[{...row(),kind:'key-expiry'}]},{...valid,reminders:[{...row(),dueAt:'2026-02-30'}]},{total:2,nextOffset:null,reminders:[row(),row()]}])await assert.rejects(F.loadCentralReminders(responder(page)),/invalid reminder page/);
});
test('all-provider pages preserve source separation and reported access deadlines without private fields',async()=>{
  const page=await F.loadCentralReminders(responder({total:2,nextOffset:null,reminders:[{...row(),provider:'humble',mediaType:'unknown',source:'humble-companion',sourceClientId:'SECRET'},{...row(1),provider:'amazon-video',mediaType:'movie',kind:'access-expiry',dueAt:'2026-10-10T12:00:00.000Z',severity:'due-soon'}]}),{provider:''});assert.equal(page.reminders[0].reviewAvailable,false);assert(!JSON.stringify(page).includes('SECRET'));assert.equal(page.reminders[1].dueAt,'2026-10-10T12:00:00.000Z');
});
