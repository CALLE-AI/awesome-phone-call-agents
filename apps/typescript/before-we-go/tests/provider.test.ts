import {test} from 'node:test';import assert from 'node:assert/strict';
import {normalizeProvider,requestCall} from '../lib/provider.ts';
import {fixtureExtraction} from '../lib/fixtures.ts';
import {exportReview} from '../lib/domain.ts';
test('malformed terminal transcript becomes explicit unresolved result',()=>{for(const attempts of [null,{},[null],[{transcript_turns:{}}],[{transcript_turns:[null]}]]){const r=normalizeProvider({status:'completed',recipients:[{attempts,structured_result:fixtureExtraction}]},'Venue');assert.ok(r.issues.some(x=>x.includes('No transcript')));assert.ok(r.requirements.every(x=>x.effective==='unknown'))}});
test('provider create does not retry after ambiguous network failure',async()=>{const original=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;throw new Error('timeout')};try{await assert.rejects(requestCall('test-key',{},'stable'));assert.equal(count,1)}finally{globalThis.fetch=original}});
test('status response must belong to requested call',async()=>{const {fetchCall}=await import('../lib/provider.ts');const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({id:'call_other',status:'completed'});try{await assert.rejects(fetchCall('test-key','call_requested'),/identifier mismatch/)}finally{globalThis.fetch=original}});

test('normalization masks stored and exported text after matching original evidence',()=>{
 const phone='+12025550123',local='(202) 555-0123';
 const extraction=structuredClone(fixtureExtraction);
 extraction.requirements.entrance_table.quote='I need step-free seating; call '+phone;
 extraction.requirements.entrance_table.detail='Contact '+local;
 extraction.requirements.entrance_table.follow_up='Confirm with '+phone;
 extraction.open_questions=['Callback '+local];
 const data={status:'completed',recipients:[{structured_result:extraction,attempts:[{transcript_turns:[{speaker:'user',text:extraction.requirements.entrance_table.quote}]}]}]};
 const result=normalizeProvider(data,'Venue');
 assert.equal(result.requirements[0].evidence,'matched');
 assert.equal(result.requirements[0].effective,'requested');
 for(const output of [result,exportReview(result,'seek_confirmation',true)]){
  assert.ok(!JSON.stringify(output).includes(phone));assert.ok(!JSON.stringify(output).includes(local));
 }
 assert.ok(data.recipients[0].attempts[0].transcript_turns[0].text.includes(phone),'original provider input remains unchanged');
});

test('masking cannot turn differing phone quotes into matched evidence',()=>{
 const extraction=structuredClone(fixtureExtraction);
 extraction.requirements.entrance_table.quote='Call +12025550123';
 const result=normalizeProvider({status:'completed',recipients:[{structured_result:extraction,attempts:[{transcript_turns:[{speaker:'user',text:'Call +12125550123'}]}]}]},'Venue');
 assert.equal(result.requirements[0].evidence,'unmatched');
 assert.equal(result.requirements[0].effective,'unknown');
});
