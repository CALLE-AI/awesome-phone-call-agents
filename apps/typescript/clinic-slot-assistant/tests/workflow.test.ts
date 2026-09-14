import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceDemo, canConfirm, createCall, decide, newWorkspace, reconcileInterruptedCalls, type CreateInput, type Scenario } from '../lib/model';
import { applyProviderResult, callTask, settings } from '../lib/calle';
import { sameOrigin } from '../lib/request-guard';
import type { Call as ProviderCall } from '@call-e/calle';
const now = new Date('2026-09-12T09:00:00Z');
function input(scenario: Scenario = 'accepted'): CreateInput {return {requestId:crypto.randomUUID(),slotId:'slot-1',candidateId:'person-1',mode:'demo',scenario,consent:true,approved:true};}
test('a simulated acceptance does not book until a staff decision, and repeated confirmation is harmless',()=>{
  const state=newWorkspace(now);const call=createCall(state,input(),now);
  advanceDemo(state,new Date(now.getTime()+6000));
  assert.equal(call.phase,'review');assert.equal(state.slots[0].status,'open');assert.equal(canConfirm(call),true);
  decide(state,call.id,'confirm');decide(state,call.id,'confirm');
  assert.equal(state.slots[0].status,'booked');assert.equal(state.slots[0].bookedFor,'person-1');assert.equal(state.audit.filter(a=>a.text.includes('confirmed by staff')).length,1);
});
for(const scenario of ['declined','unclear','unanswered'] as Scenario[]) test(`${scenario} cannot create a booking`,()=>{
  const state=newWorkspace(now);const call=createCall(state,input(scenario),now);advanceDemo(state,new Date(now.getTime()+6000));
  assert.equal(canConfirm(call),false);assert.throws(()=>decide(state,call.id,'confirm'),/clearly confirm/);decide(state,call.id,'close');assert.equal(state.slots[0].status,'open');
});
test('request replay returns one call and mismatched replay is rejected',()=>{
  const state=newWorkspace(now);const request=input();const first=createCall(state,request,now);
  assert.equal(createCall(state,request,now),first);assert.equal(state.calls.length,1);
  assert.throws(()=>createCall(state,{...request,candidateId:'person-2'},now),/already been used/);
});
test('only one unresolved call per slot or person; completed review releases the slot',()=>{
  const state=newWorkspace(now);const call=createCall(state,input('declined'),now);
  assert.throws(()=>createCall(state,{...input(),candidateId:'person-2'},now),/Review the existing/);
  assert.throws(()=>createCall(state,{...input(),slotId:'slot-2'},now),/Review the existing/);
  advanceDemo(state,new Date(now.getTime()+6000));assert.throws(()=>createCall(state,input(),now),/Review the existing/);
  decide(state,call.id,'close');createCall(state,{...input(),candidateId:'person-2'},now);assert.equal(state.calls.length,2);
});
test('missing contact consent or staff approval blocks call creation',()=>{
  for(const patch of [{candidateId:'person-4'},{consent:false},{approved:false}]) assert.throws(()=>createCall(newWorkspace(now),{...input(),...patch},now),/consent and staff approval/);
});
test('expired slots are not callable',()=>{
  const state=newWorkspace(now);assert.throws(()=>createCall(state,input(),new Date('2026-09-14T10:00:00Z')),/already passed/);
});
test('a booked person cannot receive a second appointment invitation',()=>{
  const state=newWorkspace(now);const call=createCall(state,input(),now);advanceDemo(state,new Date(now.getTime()+6000));decide(state,call.id,'confirm');
  assert.throws(()=>createCall(state,{...input(),slotId:'slot-2'},now),/already has a confirmed/);
});
test('a process interruption leaves live creation locked and explicitly uncertain',()=>{
  const state=newWorkspace(now);const call=createCall(state,{...input(),mode:'live'},now);
  assert.equal(reconcileInterruptedCalls(state,new Date(now.getTime()+31000)),true);assert.equal(call.phase,'uncertain');
  assert.throws(()=>createCall(state,input(),now),/Review the existing/);
});
function provider(patch: Partial<ProviderCall>={}): ProviderCall {
  return {id:'call_test',object:'call_task',status:'completed',task:'fixture',recipients:[],structuredResult:{can_attend:'yes'},summary:'Fixture result',taskCompleted:true,completionConfidence:{score:.93,label:'high'},evidence:['A clear yes'],metadata:{},failureCode:null,failureMessage:null,createdAt:now.toISOString(),completedAt:now.toISOString(),...patch};
}
test('CALL-E results require an explicit acceptance and successful task with sufficient confidence',()=>{
  const state=newWorkspace(now);const call=createCall(state,input(),now);
  applyProviderResult(call,provider());assert.equal(canConfirm(call),true);
  for(const patch of [{taskCompleted:false},{status:'failed' as const},{completionConfidence:null},{structuredResult:{can_attend:'maybe'}},{completionConfidence:{score:.5,label:'low'}}]) {
    applyProviderResult(call,provider(patch));assert.equal(canConfirm(call),false);
  }
});
test('recipient result takes precedence over task-level result and phone numbers are redacted',()=>{
  const state=newWorkspace(now);const call=createCall(state,input(),now);
  applyProviderResult(call,provider({summary:'Reached +919876543210',recipients:[{id:'r1',phones:[],locale:'en-IN',region:'IN',status:'completed',structuredResult:{can_attend:'no'},summary:null,attempts:[]}]}));
  assert.equal(call.canAttend,'no');assert.equal(call.summary,'Reached [phone hidden]');
});
test('a queued task with an active recipient displays call progress',()=>{
  const state=newWorkspace(now);const call=createCall(state,input(),now);
  applyProviderResult(call,provider({status:'queued',taskCompleted:null,recipients:[{id:'r1',phones:[],locale:'en-IN',region:'IN',status:'in_progress',structuredResult:null,summary:null,attempts:[]}]}));
  assert.equal(call.phase,'calling');assert.equal(canConfirm(call),false);
});
test('live call task includes exact date/time, fictional context and human confirmation',()=>{
  const task=callTask(newWorkspace(now).slots[0]);
  assert.match(task,/Asia\/Kolkata/);assert.match(task,/10:30/);assert.match(task,/2026/);assert.match(task,/fictional/);assert.match(task,/staff must review/);assert.match(task,/Do not schedule retries/);
});
test('same-origin guard accepts the actual host and rejects external origins, wrong ports, and missing headers',()=>{
  assert.equal(sameOrigin('http://127.0.0.1:3210','127.0.0.1:3210'),true);
  assert.equal(sameOrigin('http://localhost:3210','localhost:3210'),true);
  for(const origin of [null,'null','https://attacker.example','http://127.0.0.1:4000','file:///']) assert.equal(sameOrigin(origin,'127.0.0.1:3210'),false);
});
test('live testing remains off without explicit configuration',()=>{
  const previous=process.env.CALLE_LIVE_ENABLED;process.env.CALLE_LIVE_ENABLED='false';
  try {assert.equal(settings().liveReady,false);}finally{if(previous===undefined)delete process.env.CALLE_LIVE_ENABLED;else process.env.CALLE_LIVE_ENABLED=previous;}
});
