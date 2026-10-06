import assert from 'node:assert/strict';
import test from 'node:test';
import '../src/shared.js';
const F=globalThis.FanaticalLibrary;
test('FAN sends sender/callback correlation without waiting for diagnostics and remains compatible with older GL',async()=>{
  const sent=[];
  const send=async request=>{sent.push(request);if(request.type==='MATCH_ITEMS_DIAGNOSTIC_CALLBACK')return new Promise(()=>{});return {ok:true,results:[],performance:{id:request.diagnosticLookupId}};};
  const result=await F.sendGalacticMatch(send,{type:'MATCH_ITEMS',apiVersion:1,items:[{title:'Synthetic title',mediaType:'book'}]});
  assert.equal(result.ok,true);assert.equal(sent.length,2);assert.match(sent[0].diagnosticLookupId,/^lookup-[a-f0-9]{12}-\d{3,6}$/u);
  assert.equal(sent[0].diagnosticLookupId,sent[1].diagnosticLookupId);assert.ok(sent[1].diagnosticCallbackEpochMs>=sent[0].diagnosticSentEpochMs);
  assert.equal(JSON.stringify(sent[1]).includes('Synthetic title'),false);
  const old=[];await F.sendGalacticMatch(async request=>{old.push(request);return {ok:true};},{type:'MATCH_ITEMS'});assert.equal(old.length,1);
  const status={type:'GET_STATUS'};assert.equal(await F.sendGalacticMatch(async request=>request,status),status);
});
