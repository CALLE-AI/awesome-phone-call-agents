import assert from 'node:assert/strict';
import test from 'node:test';
import { database, env, authorizedRequest } from './helpers/route-runtime.mjs';
import { demoFixture } from '../app/lib/demo-fixtures.ts';
import { CalleCallsProvider, FakeGoalRunProvider } from '../app/lib/call-provider.ts';
import { Miniflare } from 'miniflare';
const workflow = await import('../app/api/workflow/route.ts');
const contacts = await import('../app/api/case-file/route.ts');
const calls = await import('../app/api/calle/route.ts');
const evidence = await import('../app/api/case-evidence/route.ts');
const coverage = await import('../app/api/case-coverage/route.ts');
const demo = await import('../app/api/demo-session/route.ts');
const human = await import('../app/api/human-interview/route.ts');
const respondent = await import('../app/api/respondent/route.ts');
const get = async route => (await route.GET(authorizedRequest())).json();
async function post(route, session, body, role='coordinator') {
 const response = await route.POST(authorizedRequest('http://demo.test/api', {method:'POST', headers:{'content-type':'application/json','x-demo-role':role,...(session ? {'x-demo-case':session.caseId} : {})},body:JSON.stringify(body)}));
 return {status:response.status,data:await response.json()};
}
async function setup() { env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;const db=database();const {session}=await get(workflow);await get(calls);return {db,session}; }
async function ready(session,id='morgan') {
 const person=(await get(contacts)).contacts.find(item=>item.id===id);
 const response=await post(contacts,session,{action:'save_contact',id,version:person.version,name:person.name,role:person.role,expectedPeriod:person.expectedPeriod,phone:'+15550123456',phoneSource:'Consenting test participant',permissionNote:'Agreed to call and transcription for this rehearsal',automatedAllowed:true,transcriptionAllowed:true,permissionReconfirmed:true});
 assert.equal(response.status,200,JSON.stringify(response.data));return response.data.contacts.find(item=>item.id===id);
}
const base = session => ({interview_id:session.interviewId,authorization_version:1,site_key:'dry_cleaner',selected_channel:'automated_callback',automated_call_allowed:true,transcription_allowed:true});
async function prepare(session,person,scenario='direct') {
 const result=await post(calls,session,{...base(session),action:'prepare',contact_id:person.id,contact_version:person.version,scenario});assert.equal(result.status,200,JSON.stringify(result.data));return result.data;
}
function launch(session,person,preview) {return post(calls,session,{...base(session),action:'launch',contact_id:person.id,contact_version:person.version,authorization_version:preview.authorization_version,preview_fingerprint:preview.variables_fingerprint,preview_confirmed:true,live_confirmation:'PLACE LIVE CALL'});}
const restart = session => post(demo,session,{action:'start_new_demo',expectedCaseId:session.caseId});
const archived = async session => (await evidence.GET(authorizedRequest(`http://demo.test/api/case-evidence?archive=1&case=${session.caseId}`))).json();
async function finish(session,person) {
 const preview=await prepare(session,person);const started=await launch(session,person,preview);assert.equal(started.status,200,JSON.stringify(started.data));
 assert.equal((await post(calls,session,{action:'poll',run_id:String(started.data.run_id)})).status,200);
 return {runId:started.data.run_id,preview};
}
function liveMock() {
 env.CALL_PROVIDER='calle_calls';env.LIVE_CALLS_ENABLED='true';env.CALLE_API_KEY='test-only';
 const previous=globalThis.fetch,keys=[];
 globalThis.fetch=async(_url,options)=> {
  if(options?.method==='POST'){keys.push(options.headers['idempotency-key']);return Response.json({id:`test-${keys.length}`,status:'queued',recipients:[]});}
  const fixture=demoFixture('direct');return Response.json({...fixture.raw,id:`test-${keys.length}`,status:'completed',structured_result:fixture.result});
 };
 return {keys,restore:()=>{globalThis.fetch=previous;env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;}};
}

test('fresh demos load, collect evidence and preserve archives in the actual D1 runtime',async()=>{
 const runtime=new Miniflare({modules:true,script:'export default { fetch() { return new Response("test"); } }',compatibilityDate:'2026-05-22',d1Databases:['DB']});
 const previousDb=env.DB;
 try {
  env.DB=await runtime.getD1Database('DB');env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;
  const original=(await get(workflow)).session;await get(calls);
  const reset=await restart(original);assert.equal(reset.status,200);const session=reset.data.session;
  assert.ok(session.caseId.length>40,'exercise the UUID-based case identity used by real resets');
  const fresh=await get(contacts);assert.equal(fresh.contacts.length,3);assert.ok(fresh.contacts.every(item=>!item.hasPhone));
  assert.deepEqual((await get(evidence)).coverage.years,[]);
  const person=await ready(session);const {runId}=await finish(session,person);const data=await get(evidence);
  for(const item of data.statements) assert.equal((await post(workflow,session,{action:'review',statement_id:item.id,status:'accepted',expected_revision:item.revision},'reviewer')).status,201);
  assert.equal((await post(coverage,session,{runId,years:[1992,1993],quote:data.runs[0].evidence.knowledge_quote,reviewed:true},'reviewer')).status,200);
  assert.equal((await post(contacts,session,{action:'create_task',summary:'Find records for the remaining years.',assignee:'Coordinator'})).status,200);
  assert.equal((await post(contacts,session,{action:'select_contact',contactId:'carol'})).status,200);
  const next=await restart(session);assert.equal(next.status,200);
  const nextCase=await get(contacts);assert.equal(nextCase.selectedContactId,'morgan');assert.deepEqual(nextCase.tasks,[]);assert.ok(nextCase.contacts.every(item=>!item.hasPhone));
  const nextEvidence=await get(evidence);assert.deepEqual(nextEvidence.runs,[]);assert.deepEqual(nextEvidence.coverage.years,[]);
  assert.equal((await get(workflow)).session.caseId,next.data.session.caseId);
  const history=await archived(session);assert.deepEqual(history.coverage.years,[1992,1993]);assert.equal(history.caseFile.contacts[0].hasPhone,true);assert.equal(history.caseFile.selectedContactId,'carol');assert.equal(history.caseFile.tasks.length,1);
 } finally {await runtime.dispose();env.DB=previousDb;}
});

test('new demo archives calls, reviewed years, contacts and tasks; fresh investigation starts empty and usage survives',async()=>{
 const {db,session}=await setup();const person=await ready(session);const mock=liveMock();
 try {
  const {runId}=await finish(session,person);let data=await get(evidence);
  for(const item of data.statements) assert.equal((await post(workflow,session,{action:'review',statement_id:item.id,status:'accepted',expected_revision:item.revision},'reviewer')).status,201);
  assert.equal((await post(coverage,session,{runId,years:[1992,1993],quote:data.runs[0].evidence.knowledge_quote,reviewed:true},'reviewer')).status,200);
  await post(contacts,session,{action:'select_contact',contactId:'carol'});
  await post(contacts,session,{action:'create_task',summary:'Ask the property team to obtain additional source records.',assignee:'Coordinator'});
  await post(workflow,session,{action:'follow_up',channel:'human_interview',summary:'Interview the earlier operator about the missing years.'});
  const beforeCounts=db.sqlite.prepare('SELECT (SELECT COUNT(*) FROM call_runs) calls, (SELECT COUNT(*) FROM ingested_statements) statements, (SELECT COUNT(*) FROM review_actions) reviews').get();
  const reset=await restart(session);assert.equal(reset.status,200,JSON.stringify(reset.data));const next=reset.data.session;
  assert.notEqual(next.caseId,session.caseId);assert.notEqual(next.interviewId,session.interviewId);
  data=await get(evidence);assert.equal(data.session.caseId,next.caseId);assert.equal(data.runs.length,0);assert.equal(data.statements.length,0);assert.deepEqual(data.coverage.years,[]);assert.equal(data.coverage.missingYears.length,8);assert.equal(data.suggestion,null);
  const c=await get(contacts);assert.equal(c.selectedContactId,'morgan');assert.deepEqual(c.contacts.map(x=>x.id),['morgan','carol','sam']);assert.ok(c.contacts.every(x=>!x.hasPhone&&!x.automatedAllowed&&!x.transcriptionAllowed&&x.version===0));assert.deepEqual(c.tasks,[]);
  const wf=await get(workflow);assert.equal(wf.workflow.status,'NEEDS_OUTREACH');assert.equal(wf.workflow.assigned_role,'coordinator');assert.deepEqual(wf.reviews,[]);assert.deepEqual(wf.dispositions,[]);assert.deepEqual(wf.tasks,[]);
  const old=await archived(session);assert.equal(old.runs[0].id,runId);assert.deepEqual(old.coverage.years,[1992,1993]);assert.ok(old.statements.every(x=>x.status==='accepted'));assert.equal(old.caseFile.tasks.length,1);assert.equal(old.caseFile.selectedContactId,'carol');assert.equal(old.caseFile.contacts[0].hasPhone,true);assert.equal(old.workflow.tasks.length,1);
  assert.equal((await get(calls)).live_call_slots_remaining,19);assert.equal(env.CALLE_API_KEY,'test-only');
  assert.deepEqual(db.sqlite.prepare('SELECT (SELECT COUNT(*) FROM call_runs) calls, (SELECT COUNT(*) FROM ingested_statements) statements, (SELECT COUNT(*) FROM review_actions) reviews').get(),beforeCounts);
  assert.equal((await get(workflow)).session.caseId,next.caseId,'reinitializing the app retains the active demo');
  assert.equal(mock.keys.length,1,'resetting cannot place calls');
 } finally {mock.restore();}
});

test('successive demos dial with distinct provider keys and preserve duplicate launch identity',async()=>{
 const {session}=await setup();const mock=liveMock();
 try {
  let current=session;const ids=[];
  for(let i=0;i<3;i++){
   const person=await ready(current);const {runId,preview}=await finish(current,person);
   const duplicate=await launch(current,person,preview);assert.equal(duplicate.data.duplicate,true);assert.equal(duplicate.data.run_id,runId);
   ids.push(current.interviewId);
   if(i<2){const reset=await restart(current);assert.equal(reset.status,200);current=reset.data.session;}
  }
  assert.equal(new Set(ids).size,3);assert.equal(new Set(mock.keys).size,3);assert.equal(mock.keys.length,3);assert.equal((await get(calls)).live_call_slots_remaining,17);
  assert.equal((await get(demo)).archived.length,2);
 } finally {mock.restore();}
});

test('stale tabs, repeated reset requests and old forms cannot write into the new demo',async()=>{
 const {session}=await setup();const person=await ready(session);const preview=await prepare(session,person);
 const task=await post(workflow,session,{action:'follow_up',channel:'human_interview',summary:'Interview a respondent about the missing property history.'});
 const form=await post(workflow,session,{action:'follow_up',channel:'secure_form',summary:'Request written testimony about historical property operations.'});
 const results=await Promise.all([restart(session),restart(session)]);assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);const next=results.find(x=>x.status===200).data.session;
 const actions=[
  [contacts,{action:'save_contact',id:'sam',version:0,name:'Old tab overwrite',role:'Manager',source:'Old draft'}],
  [contacts,{action:'select_contact',contactId:'sam'}],
  [contacts,{action:'create_task',summary:'This old draft must not appear in the next demo.',assignee:'Coordinator'}],
  [workflow,{action:'follow_up',channel:'human_interview',summary:'This old request must stay out of the next demo.'}],
  [workflow,{action:'review',statement_id:'old',status:'accepted',expected_revision:1}],
  [coverage,{runId:1,years:[1992],quote:'1992',reviewed:true}],
 ];
 for(const [route,body] of actions){const result=await post(route,session,body,route===coverage?'reviewer':'coordinator');assert.equal(result.status,409);assert.equal(result.data.error.code,'DEMO_CHANGED');}
 assert.equal((await launch(session,person,preview)).status,409);
 assert.equal((await post(contacts,null,{action:'select_contact',contactId:'sam'})).status,409,'legacy tabs without identity are rejected after restart');
 assert.equal((await post(human,next,{task_id:task.data.task.id})).status,404);
 assert.equal((await post(respondent,next,{token:form.data.task.response_token})).status,404);
 const c=await get(contacts);assert.equal(c.selectedContactId,'morgan');assert.equal(c.contacts[2].name,'Sam Patel');assert.equal(c.tasks.length,0);
 assert.equal((await get(demo)).archived.length,1);
});

test('restart is blocked for an active call, an uncertain submission, and a result awaiting ingestion',async()=>{
 const {db,session}=await setup();const person=await ready(session);const preview=await prepare(session,person);const launched=await launch(session,person,preview);
 assert.equal((await restart(session)).data.error.code,'CALL_STILL_PENDING');assert.equal((await get(demo)).canRestart,false);
 db.failBatch=true;
 assert.equal((await post(calls,session,{action:'poll',run_id:String(launched.data.run_id)})).status,503);
 assert.equal((await restart(session)).status,409,'stored result is not finished until ingestion commits');
 assert.equal((await post(calls,session,{action:'poll',run_id:String(launched.data.run_id)})).status,200);
 assert.equal((await get(demo)).canRestart,true);
 db.sqlite.prepare("INSERT INTO call_runs(interview_id,authorization_version,provider_mode,status,request_payload,live_call_budget_reserved_at,updated_at) VALUES (?,99,'calle_calls','LIVE_CALL_SUBMISSION_UNCERTAIN','{}','2026-09-09','2026-09-09')").run(session.interviewId);
 assert.equal((await restart(session)).status,409,'uncertain live call blocks reset even in synthetic mode');
});

test('restart winning a race before launch reservation prevents an external call',async()=>{
 const {session}=await setup();const person=await ready(session);const mock=liveMock();const preview=await prepare(session,person);
 const previous=CalleCallsProvider.prototype.getGoal;let reached,release;
 const entered=new Promise(resolve=>{reached=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 CalleCallsProvider.prototype.getGoal=async function(){reached();await gate;return previous.call(this);};
 try {
  const launching=launch(session,person,preview);await entered;assert.equal((await restart(session)).status,200);release();
  const result=await launching;assert.equal(result.status,409);assert.equal(result.data.error.code,'DEMO_CHANGED');assert.equal(mock.keys.length,0);
 } finally {release();CalleCallsProvider.prototype.getGoal=previous;mock.restore();}
});

test('a claimed launch blocks restart before provider confirmation, including synthetic calls',async()=>{
 for(const live of [false,true]){
  const {session}=await setup();const person=await ready(session);const mock=live?liveMock():null;const preview=await prepare(session,person);
  const prototype=live?CalleCallsProvider.prototype:FakeGoalRunProvider.prototype,previous=prototype.create;let reached,release;
  const entered=new Promise(resolve=>{reached=resolve;});const gate=new Promise(resolve=>{release=resolve;});
  prototype.create=async function(input){reached();await gate;return previous.call(this,input);};
  try {const launching=launch(session,person,preview);await entered;assert.equal((await restart(session)).status,409);release();assert.equal((await launching).status,200);}
  finally {release();prototype.create=previous;mock?.restore();}
 }
});

test('archived synthetic results remain available after switching to live mode',async()=>{
 const {session}=await setup();await finish(session,await ready(session));assert.equal((await restart(session)).status,200);env.CALL_PROVIDER='calle_calls';
 const old=await archived(session);assert.equal(old.runs.length,1);assert.equal(old.runs[0].provider,'fake');assert.ok(old.statements.length>0);
 assert.equal((await get(evidence)).runs.length,0);
});

test('double clicking launch cannot race a rejected submission with another creation',async()=>{
 const {session}=await setup();const person=await ready(session);const mock=liveMock();const preview=await prepare(session,person);
 const original=globalThis.fetch;let release,reached,posts=0;
 const entered=new Promise(resolve=>{reached=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 globalThis.fetch=async()=>{posts++;reached();await gate;return Response.json({error:{code:'invalid_request',message:'Test rejection'}},{status:400});};
 try {
  const first=launch(session,person,preview);await entered;
  const second=await launch(session,person,preview);assert.equal(second.data.error.code,'CALL_SUBMISSION_IN_PROGRESS');assert.equal(posts,1);
  assert.equal((await restart(session)).status,409);release();assert.equal((await first).status,502);
  assert.equal((await restart(session)).status,200,'only the single rejected creation has finished');
 } finally {release();globalThis.fetch=original;mock.restore();}
});

test('synthetic submission claims cannot be overwritten and can be recovered after interruption',async()=>{
 const {db,session}=await setup();const person=await ready(session);const preview=await prepare(session,person);
 const original=FakeGoalRunProvider.prototype.create;let release,reached;
 const entered=new Promise(resolve=>{reached=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 FakeGoalRunProvider.prototype.create=async function(input){reached();await gate;return original.call(this,input);};
 try {
  const first=launch(session,person,preview);await entered;
  const retryPrepare=await post(calls,session,{...base(session),action:'prepare',contact_id:person.id,contact_version:person.version});assert.equal(retryPrepare.data.error.code,'ACTIVE_CALL_EXISTS');
  const readiness=await get(calls);assert.equal(readiness.pending_attempt.status,'DEMO_CALL_STARTING');assert.equal(readiness.pending_attempt.has_provider_id,false);
  assert.equal((await restart(session)).status,409);
  release();assert.equal((await first).status,200);
 } finally {release();FakeGoalRunProvider.prototype.create=original;}
});

test('rejection of a retry after an uncertain submission preserves its original reservation',async()=>{
 const {session}=await setup();const person=await ready(session);const mock=liveMock();const preview=await prepare(session,person);
 let posts=0;
 globalThis.fetch=async()=>{posts++;return Response.json({error:{code:'test_error',message:'Unknown first outcome'}},{status:posts===1?500:400});};
 try {
  assert.equal((await launch(session,person,preview)).status,502);assert.equal((await launch(session,person,preview)).status,502);
  assert.equal((await get(calls)).live_call_slots_remaining,19);assert.equal((await restart(session)).status,409);
 } finally {mock.restore();}
});
