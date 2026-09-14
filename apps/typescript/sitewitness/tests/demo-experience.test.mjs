import assert from 'node:assert/strict';
import test from 'node:test';
import { database, env, invoke, authorizedRequest } from './helpers/route-runtime.mjs';
import { normalizeEvidenceResult, extractTranscript, citeQuote, evidenceIsVisible } from '../app/lib/evidence.ts';
import { demoFixture } from '../app/lib/demo-fixtures.ts';
const workflow = await import('../app/api/workflow/route.ts');
const contacts = await import('../app/api/case-file/route.ts');
const calls = await import('../app/api/calle/route.ts');
const evidence = await import('../app/api/case-evidence/route.ts');
const brief = { interview_id:'INT-047-BAKER-LIVE-002', authorization_version:1, site_key:'dry_cleaner', selected_channel:'automated_callback', automated_call_allowed:true, transcription_allowed:true, contact_id:'morgan' };
async function setup() { env.CALL_PROVIDER='fake'; env.LIVE_CALLS_ENABLED='false'; const db=database(); await workflow.GET(authorizedRequest()); return db; }
async function ready() { const saved=await invoke(contacts,{action:'save_contact',id:'morgan',version:0,name:'Morgan Lee',role:'Former manager',source:'referral',expectedPeriod:'1991–1996',phone:'+15550123456',phoneSource:'Rehearsal participant',permissionNote:'Test participant permission for synthetic rehearsal',automatedAllowed:true,transcriptionAllowed:true,permissionReconfirmed:true}); assert.equal(saved.status,200); return saved.data.contacts[0]; }
async function launch(scenario='bounded') { const contact=await ready(); const prepared=await invoke(calls,{...brief,action:'prepare',contact_version:contact.version,scenario}); assert.equal(prepared.status,200); const launched=await invoke(calls,{...brief,action:'launch',contact_version:contact.version,authorization_version:prepared.data.authorization_version,preview_fingerprint:prepared.data.variables_fingerprint,preview_confirmed:true}); assert.equal(launched.status,200); return {contact,prepared:prepared.data,runId:launched.data.run_id}; }

test('records referral starts without a callable number and supports a durable owned task',async()=>{
 await setup(); const state=await (await contacts.GET(authorizedRequest())).json(); assert.equal(state.contacts[0].hasPhone,false); assert.equal(state.contacts[0].readiness,'Contact details needed');
 assert.equal((await invoke(calls,{...brief,action:'prepare',contact_version:0})).status,422);
 const task=await invoke(contacts,{action:'create_task',title:'Find a respondent',summary:'Ask the property team for a suitable prior manager and permission.',assignee:'Pamela',contactId:null}); assert.equal(task.status,200);
 assert.equal((await (await contacts.GET(authorizedRequest())).json()).tasks[0].assignee,'Pamela');
 assert.equal(env.DB.sqlite.prepare('SELECT COUNT(*) AS n FROM call_runs WHERE goal_run_id IS NOT NULL').get().n,0);
});
test('a coordinator can narrow the next approved brief without placing a call', async()=>{
 const db=await setup(); const contact=await ready();
 const base={...brief,action:'prepare',contact_version:contact.version};
 const original=await invoke(calls,base);
 const focus='The first interview addresses only 1992–1993. Ask this earlier operator about personally observed operations in 1987–1991.';
 const targeted=await invoke(calls,{...base,follow_up_focus:focus});
 assert.equal(targeted.status,200);
 assert.ok(targeted.data.task.includes(focus));
 assert.ok(targeted.data.plan.evidenceGap.includes(focus));
 assert.notEqual(targeted.data.variables_fingerprint,original.data.variables_fingerprint);
 const stored=JSON.parse(db.sqlite.prepare('SELECT request_payload FROM call_runs').get().request_payload);
 assert.ok(stored.task.includes(focus));
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM call_runs WHERE goal_run_id IS NOT NULL').get().n,0);
 assert.equal((await invoke(calls,{...base,follow_up_focus:'x'.repeat(801)})).status,422);
 assert.equal((await invoke(calls,{...base,follow_up_focus:42})).status,422);
});
test('rejects overlong phones and stale contact changes; new number needs renewed permission',async()=>{
 await setup(); assert.equal((await invoke(contacts,{action:'save_contact',id:'morgan',version:0,phone:'+1234567890123456'})).status,422);
 const contact=await ready(); const updated=await invoke(contacts,{action:'save_contact',id:'morgan',version:contact.version,name:'Morgan Lee',role:'Former manager',phone:'+15550987654',phoneSource:'Participant',permissionNote:'Prior permission',automatedAllowed:true,transcriptionAllowed:true}); assert.equal(updated.data.contacts[0].readiness,'Permission needed');
 assert.equal((await invoke(calls,{...brief,action:'prepare',contact_version:contact.version})).status,422);
});
test('bounded rehearsal yields cited evidence and a named lead with no invented contact details; poll is idempotent',async()=>{
 const db=await setup(); const {runId}=await launch(); assert.equal((await invoke(calls,{...brief,action:'prepare'})).status,409);
 assert.equal((await invoke(calls,{action:'poll',run_id:String(runId)})).data.terminal,true);
 const result=await (await evidence.GET(authorizedRequest())).json(); assert.equal(result.statements.length,3); assert.ok(result.statements.every(s=>s.citation.status==='matched')); assert.equal(result.runs[0].evidence.outcome,'bounded');
 const leads=(await (await contacts.GET(authorizedRequest())).json()).contacts; const lead=leads.find(item=>item.sourceRun===runId); assert.equal(lead.name,'Carol'); assert.equal(lead.hasPhone,false); assert.match(lead.source,/Synthetic rehearsal/);
 db.sqlite.prepare("UPDATE case_workflow SET assigned_role='coordinator', status='FOLLOW_UP_REQUIRED'").run();
 await invoke(calls,{action:'poll',run_id:String(runId)}); assert.equal(db.sqlite.prepare('SELECT assigned_role FROM case_workflow').get().assigned_role,'coordinator');
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ingested_statements').get().n,3);
});
test('database interruption retains provider evidence and resumes atomic ingestion on the same call',async()=>{
 const db=await setup(); const {runId}=await launch(); db.failBatch=true;
 assert.equal((await invoke(calls,{action:'poll',run_id:String(runId)})).status,503);
 assert.ok(db.sqlite.prepare('SELECT goal_result FROM call_runs').get().goal_result); assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ingested_statements').get().n,0);
 assert.equal((await (await evidence.GET(authorizedRequest())).json()).runs[0].terminal,false);
 assert.equal((await invoke(calls,{action:'poll',run_id:String(runId)})).data.terminal,true);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ingested_statements').get().n,3);
});
test('direct observations preserve actual years and decline returns no fabricated factual statements',async()=>{
 await setup(); let run=await launch('direct'); await invoke(calls,{action:'poll',run_id:String(run.runId)}); let data=await (await evidence.GET(authorizedRequest())).json(); assert.match(data.statements[0].fact,/1992–1993/); assert.doesNotMatch(data.statements[0].fact,/1991–1994/); assert.equal(data.runs[0].evidence.leads.length,0);
 await setup(); run=await launch('declined'); await invoke(calls,{action:'poll',run_id:String(run.runId)}); data=await (await evidence.GET(authorizedRequest())).json(); assert.equal(data.statements.length,0); assert.equal(data.runs[0].evidence.outcome,'human_follow_up'); assert.equal((await (await workflow.GET(authorizedRequest())).json()).workflow.assigned_role,'coordinator');
});
test('reviews enforce real IDs, actual quotes, revisions and complete human review',async()=>{
 const db=await setup(); const {runId}=await launch(); await invoke(calls,{action:'poll',run_id:String(runId)});
 const base={action:'review',statement_id:`CALLE-GOAL-${runId}-1`,status:'accepted',expected_revision:1};
 assert.equal((await invoke(workflow,base)).status,403);
 assert.equal((await invoke(workflow,{...base,statement_id:'missing'},'reviewer')).status,404);
 assert.equal((await invoke(workflow,{action:'disposition',disposition:'PARTIALLY_RESOLVED',rationale:'The evidence bounds some questions and leaves the rest open.'},'reviewer')).status,409);
 assert.equal((await invoke(workflow,base,'reviewer')).status,201);
 const edit={action:'edit',statement_id:base.statement_id,expected_revision:1,fact:'The respondent managed the property from 1991 through 1996.',note:'Preserve respondent attribution.'};
 assert.equal((await invoke(workflow,edit,'reviewer')).status,201);
 assert.equal((await invoke(workflow,base,'reviewer')).status,409);
 let data=await (await evidence.GET(authorizedRequest())).json(); assert.equal(data.statements[0].status,'pending'); assert.equal(data.statements[0].revision,2);
 for(const s of data.statements) assert.equal((await invoke(workflow,{action:'review',statement_id:s.id,status:'accepted',expected_revision:s.revision},'reviewer')).status,201);
 // Old reviews remain durable even after more than 100 later actions.
 for(let i=0;i<101;i++) db.sqlite.prepare("INSERT INTO review_actions (statement_id,action,expected_revision,payload,reviewer_role,created_at) VALUES ('unrelated','rejected',1,'{}','reviewer','2026-09-07')").run();
 data=await (await evidence.GET(authorizedRequest())).json(); assert.equal(data.statements[0].status,'accepted'); assert.equal(data.statements[0].revision,2);
 assert.equal((await invoke(workflow,{action:'disposition',disposition:'PARTIALLY_RESOLVED',rationale:'Reviewed observations are supported; earlier operations still need another source.'},'reviewer')).status,201);
});
test('malformed profile, missing/duplicate branches, unsupported bounds and assistant quotes fail checks',()=>{
 const valid=demoFixture('bounded'); assert.equal(normalizeEvidenceResult(valid.result,'evidence-v2').profile,'evidence-v2');
 for(const modify of [r=>delete r.schema_version,r=>r.branch_results=[],r=>r.branch_results[1].id=r.branch_results[0].id,r=>{r.limitations=[];r.unknowns=[];}]) {const r=structuredClone(valid.result);modify(r);assert.throws(()=>normalizeEvidenceResult(r,'evidence-v2'));}
 const turns=extractTranscript(valid.raw,12); assert.equal(citeQuote('What years did you personally know the property?',turns).status,'unmatched'); assert.deepEqual(extractTranscript({recipients:[{attempts:[null,{transcript_turns:{}}]}]},1),[]);
 const legacy=normalizeEvidenceResult({factual_statements:'Managed around 1992–1993',source_type:'direct observation',supporting_quotes:'I managed it around 1992 to 1993.',uncertainty_notes:'Dates uncertain'}); assert.equal(legacy.outcome,'unknown'); assert.equal(legacy.branches.length,0);
 assert.equal(evidenceIsVisible('secure_form','calle_calls'),true);assert.equal(evidenceIsVisible('human_interview','calle_calls'),true);assert.equal(evidenceIsVisible('fake','calle_calls'),false);
});

test('unfinished ingestion remains visible and blocks a new authorization after reload',async()=>{
 const db=await setup(); const {runId}=await launch(); db.failBatch=true; await invoke(calls,{action:'poll',run_id:String(runId)});
 const readiness=await (await calls.GET(authorizedRequest())).json(); assert.equal(readiness.pending_attempt.run_id,runId); assert.equal(readiness.pending_attempt.has_provider_id,true);
 assert.equal((await invoke(calls,{...brief,action:'prepare'})).status,409);
});
test('concurrent polls commit evidence and workflow transition once',async()=>{
 const db=await setup(); const {runId}=await launch(); const results=await Promise.all([invoke(calls,{action:'poll',run_id:String(runId)}),invoke(calls,{action:'poll',run_id:String(runId)})]);
 assert.ok(results.some(r=>r.data.terminal)); assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM ingested_statements').get().n,3);
 assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='CALLE_GOAL_RESULT_INGESTED'").get().n,1);
});
test('invalid extraction retains original transcript without fabricated fallback statements',async()=>{
 const db=await setup(); const {runId}=await launch(); const fixture=demoFixture('bounded');delete fixture.result.schema_version;
 db.sqlite.prepare('UPDATE call_runs SET goal_result=?,response_payload=? WHERE id=?').run(JSON.stringify(fixture.result),JSON.stringify(fixture.raw),runId);
 const result=await invoke(calls,{action:'poll',run_id:String(runId)}); assert.equal(result.data.status,'INVALID_RESULT'); assert.equal(result.data.terminal,true);
 const data=await (await evidence.GET(authorizedRequest())).json(); assert.equal(data.statements.length,0);assert.ok(data.runs[0].turns.length);assert.ok(data.runs[0].validationError);
});
test('an unverified quote cannot be accepted and open contact work prevents full resolution',async()=>{
 const db=await setup(); const {runId}=await launch();await invoke(calls,{action:'poll',run_id:String(runId)});
 db.sqlite.prepare("UPDATE ingested_statements SET evidence='Words never spoken' WHERE id=?").run(`CALLE-GOAL-${runId}-1`);
 assert.equal((await invoke(workflow,{action:'review',statement_id:`CALLE-GOAL-${runId}-1`,status:'accepted',expected_revision:1},'reviewer')).status,409);
 for(const s of (await (await evidence.GET(authorizedRequest())).json()).statements) await invoke(workflow,{action:'review',statement_id:s.id,status:s.id.endsWith('-1')?'rejected':'accepted',expected_revision:1},'reviewer');
 await invoke(contacts,{action:'create_task',title:'Obtain source',summary:'Ask the prior manager for records about the missing years.',assignee:'Coordinator'});
 assert.equal((await invoke(workflow,{action:'disposition',disposition:'RESOLVED_BY_REVIEWER',rationale:'The reviewed evidence has been considered for the case.'},'reviewer')).status,409);
});
test('ambiguous submission keeps its reservation; retry uses the same task/key and clears stale errors',async()=>{
 await setup(); const contact=await ready(); env.CALL_PROVIDER='calle_calls';env.LIVE_CALLS_ENABLED='true';env.CALLE_API_KEY='test-only';
 const originalFetch=globalThis.fetch; const captured=[];let attempt=0;
 globalThis.fetch=async(url,options)=>{assert.match(String(url),/^https:\/\/api\.heycall-e\.com/); if(options?.method==='POST'){captured.push(JSON.parse(options.body)); attempt++; if(attempt===1) return Response.json({error:{code:'server_error',message:'Test failure after acceptance'}},{status:500}); return Response.json({id:'call_mock',status:'queued',recipients:[],structured_result:null});} const f=demoFixture('direct');return Response.json({...f.raw,id:'call_mock',status:'completed',structured_result:f.result});};
 try {
  const prep=(await invoke(calls,{...brief,action:'prepare',contact_version:contact.version})).data;
  const body={...brief,action:'launch',contact_version:contact.version,authorization_version:prep.authorization_version,preview_fingerprint:prep.variables_fingerprint,preview_confirmed:true,live_confirmation:'PLACE LIVE CALL'};
  assert.equal((await invoke(calls,body)).status,502);assert.equal((await (await calls.GET(authorizedRequest())).json()).live_call_slots_remaining,19);
  const launched=await invoke(calls,body);assert.equal(launched.status,200);assert.equal(captured[0].task,prep.task);assert.deepEqual(captured[1],captured[0]);
  const result=await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)});assert.equal(result.data.terminal,true);assert.equal(result.data.error,null);assert.equal((await (await evidence.GET(authorizedRequest())).json()).statements.length,3);
 }finally{globalThis.fetch=originalFetch;env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;}
});

test('late submission success or failure cannot overwrite an already ingested retry',async()=>{
 for(const lateFailure of [false,true]) {
  await setup();const contact=await ready();env.CALL_PROVIDER='calle_calls';env.LIVE_CALLS_ENABLED='true';env.CALLE_API_KEY='test-only';
  const originalFetch=globalThis.fetch;let release, reached;const submitted=new Promise(resolve=>reached=resolve);let posts=0;
  globalThis.fetch=async(_url,options)=>{if(options?.method==='POST'){posts++;if(posts===1){reached();return new Promise(resolve=>release=resolve);}return Response.json({id:'call_mock',status:'queued',recipients:[]});}const f=demoFixture('direct');return Response.json({...f.raw,id:'call_mock',status:'completed',structured_result:f.result});};
  try {
   const prep=(await invoke(calls,{...brief,action:'prepare',contact_version:contact.version})).data;
   const body={...brief,action:'launch',contact_version:contact.version,authorization_version:prep.authorization_version,preview_fingerprint:prep.variables_fingerprint,preview_confirmed:true,live_confirmation:'PLACE LIVE CALL'};
   const first=invoke(calls,body);await submitted;
   assert.equal((await invoke(calls,body)).data.error.code,'CALL_SUBMISSION_IN_PROGRESS');
   // Simulate recovery after a worker interruption expires the submission lease.
   env.DB.sqlite.prepare("UPDATE audit_events SET created_at='2020-01-01' WHERE event_type='CALL_LAUNCH_CLAIMED'").run();
   const second=await invoke(calls,body);await invoke(calls,{action:'poll',run_id:String(second.data.run_id)});
   release(lateFailure?Response.json({error:{code:'server_error',message:'Late mock response'}},{status:500}):Response.json({id:'call_mock',status:'queued',recipients:[]}));await first;
   const row=env.DB.sqlite.prepare('SELECT goal_result,goal_error,status,live_call_budget_reserved_at FROM call_runs').get();assert.ok(row.goal_result);assert.equal(row.goal_error,null);assert.equal(row.status,'COMPLETED');assert.ok(row.live_call_budget_reserved_at);
  } finally {globalThis.fetch=originalFetch;env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;}
 }
});
