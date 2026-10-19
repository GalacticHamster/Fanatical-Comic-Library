import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture} from './matching-fixture.mjs';

test('availability timeout stays a failed check, never proof of absence',async()=>{
 const c=fixture([],'book',{title:'Timeout fixture'}).context;
 let expire,late,cleared=false;
 c.setTimeout=callback=>{expire=callback;return 1;};c.clearTimeout=()=>{cleared=true;};
 const pending=c.FanaticalLibrary.galacticAvailability(()=>new Promise(resolve=>{late=resolve;}));
 expire();const result=await pending;
 assert.equal(result.state,'failed');assert.match(result.error,/30 seconds/);assert(cleared);
 late({ok:true,apiVersion:1});await Promise.resolve();assert.equal(result.state,'failed');
});

test('a receiver error message cannot impersonate the browser no-receiver result',async()=>{
 const c=fixture([],'book',{title:'Fixture'}).context;
 const result=await c.FanaticalLibrary.galacticAvailability(async()=>({ok:false,error:'Could not establish connection. Receiving end does not exist.'}));
 assert.equal(result.state,'failed');
});
