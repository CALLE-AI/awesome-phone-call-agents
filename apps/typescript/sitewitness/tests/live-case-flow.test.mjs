import assert from 'node:assert/strict';
import test from 'node:test';
import { database, env, invoke, authorizedRequest } from './helpers/route-runtime.mjs';
import { demoFixture } from '../app/lib/demo-fixtures.ts';
import { INTERVIEW_ID } from '../app/lib/case-file.ts';
import { RESEARCH_YEARS, coverageSignature, defaultCoverageQuote, yearsInText } from '../app/lib/case-coverage.ts';
const workflow = await import('../app/api/workflow/route.ts');
const contacts = await import('../app/api/case-file/route.ts');
const calls = await import('../app/api/calle/route.ts');
const evidence = await import('../app/api/case-evidence/route.ts');
const coverage = await import('../app/api/case-coverage/route.ts');
const human = await import('../app/api/human-interview/route.ts');
const base = { interview_id:INTERVIEW_ID, authorization_version:1, site_key:'dry_cleaner', selected_channel:'automated_callback', automated_call_allowed:true, transcription_allowed:true };
async function setup() { env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;const db=database();await workflow.GET(authorizedRequest());return db; }
async function ready(id='morgan') {
 const state=await (await contacts.GET(authorizedRequest())).json();const person=state.contacts.find(item=>item.id===id);
 const saved=await invoke(contacts,{action:'save_contact',id,version:person.version,name:person.name,role:person.role,expectedPeriod:person.expectedPeriod,phone:'+15550123456',phoneSource:'Test participant',permissionNote:'Test participant consented to calling and transcription',automatedAllowed:true,transcriptionAllowed:true,permissionReconfirmed:true});
 assert.equal(saved.status,200);return saved.data.contacts.find(item=>item.id===id);
}
async function prepare(person) { return invoke(calls,{...base,action:'prepare',contact_id:person.id,contact_version:person.version,scenario:'direct'}); }
function launchBody(person,prepared) { return {...base,action:'launch',contact_id:person.id,contact_version:person.version,authorization_version:prepared.data.authorization_version,preview_fingerprint:prepared.data.variables_fingerprint,preview_confirmed:true,live_confirmation:'PLACE LIVE CALL'}; }

async function withRecordedFixture(fixture, check) {
 const db = await setup();
 const person = await ready('carol');
 env.CALL_PROVIDER='calle_calls'; env.LIVE_CALLS_ENABLED='true'; env.CALLE_API_KEY='test-only';
 const originalFetch = globalThis.fetch;
 const requests = [];
 globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/api\.heycall-e\.com/);
  if (options?.method === 'POST') {
   requests.push(JSON.parse(options.body));
   return Response.json({id:`review-source-${requests.length}`,status:'queued',recipients:[]});
  }
  return Response.json({...fixture.raw,id:'review-source-1',status:'completed',structured_result:fixture.result});
 };
 try {
  const prepared = await prepare(person); assert.equal(prepared.status,200);
  const launched = await invoke(calls,launchBody(person,prepared)); assert.equal(launched.status,200);
  const runId = launched.data.run_id;
  assert.equal((await invoke(calls,{action:'poll',run_id:String(runId)})).status,200);
  const data = await (await evidence.GET(authorizedRequest())).json();
  const originalPayload = db.sqlite.prepare('SELECT response_payload FROM call_runs WHERE id=?').get(runId).response_payload;
  await check({db,runId,data,requests,originalPayload});
  assert.equal(db.sqlite.prepare('SELECT response_payload FROM call_runs WHERE id=?').get(runId).response_payload,originalPayload,'human year review must never rewrite the provider recording or transcript');
 } finally {
  globalThis.fetch=originalFetch; env.CALL_PROVIDER='fake'; env.LIVE_CALLS_ENABLED='false'; delete env.CALLE_API_KEY;
 }
}

test('fresh real case excludes earlier calls, reviews and contacts but preserves history and call budget',async()=>{
 const db=await setup();const fixture=demoFixture('direct');
 db.sqlite.prepare("INSERT INTO call_runs (id,interview_id,authorization_version,provider_mode,status,goal_run_id,goal_result,response_payload,request_payload,live_call_budget_reserved_at,updated_at) VALUES (500,'INT-047-BAKER',1,'calle_calls','COMPLETED','old-call',?,?,?,'2026-09-01','2026-09-01')").run(JSON.stringify(fixture.result),JSON.stringify(fixture.raw),JSON.stringify({schema_version:'evidence-v2',plan:{respondentRole:'Earlier participant'},contact_id:'morgan'}));
 db.sqlite.prepare("INSERT INTO audit_events(event_type,entity_id,detail,created_at) VALUES ('CALLE_GOAL_RESULT_INGESTED','CALL-EVIDENCE-500','{}','2026-09-01')").run();
 db.sqlite.prepare("INSERT INTO ingested_statements VALUES ('CALLE-GOAL-500-1','GAP-DRY-001','calle_calls','Old fact','first_hand','uncertain','Old quote','','2026-09-01')").run();
 db.sqlite.prepare("INSERT INTO review_actions(statement_id,action,expected_revision,payload,reviewer_role,created_at) VALUES ('CALLE-GOAL-500-1','accepted',1,'{}','reviewer','2026-09-01')").run();
 db.sqlite.prepare("INSERT INTO evidence_gap_dispositions(evidence_gap_id,disposition,rationale,reviewer_role,created_at) VALUES ('GAP-DRY-001','PARTIALLY_RESOLVED','Earlier rationale','reviewer','2026-09-01')").run();
 db.sqlite.prepare("INSERT INTO follow_up_tasks(id,evidence_gap_id,channel,summary,status,created_at) VALUES (500,'GAP-DRY-001','human_interview','Earlier task','SCHEDULED','2026-09-01')").run();
 env.CALL_PROVIDER='calle_calls';
 const state=await (await contacts.GET(authorizedRequest())).json();assert.equal(state.contacts.length,3);assert.ok(state.contacts.every(item=>!item.hasPhone));
 const current=await (await evidence.GET(authorizedRequest())).json();assert.equal(current.runs.length,0);assert.equal(current.statements.length,0);assert.equal(current.coverage.years.length,0);
 const wf=await (await workflow.GET(authorizedRequest())).json();assert.equal(wf.reviews.length,0);assert.equal(wf.dispositions.length,0);assert.equal(wf.tasks.length,0);assert.equal(wf.latest_call,null);
 const archived=await (await evidence.GET(authorizedRequest('http://localhost/api/case-evidence?archive=1'))).json();assert.equal(archived.runs[0].id,500);
 const readiness=await (await calls.GET(authorizedRequest())).json();assert.equal(readiness.external_calls_created,0);assert.equal(readiness.live_call_slots_remaining,19);
 assert.equal((await invoke(calls,{action:'poll',run_id:'500'})).status,404);
 assert.equal((await invoke(calls,{...base,action:'prepare',interview_id:'INT-047-BAKER'})).status,409);
 assert.equal((await invoke(workflow,{action:'reset'},'demo_admin')).status,409);
 assert.equal((await invoke(workflow,{action:'cancel_request',task_id:'500',reason:'Not current'})).status,404);
 assert.equal((await human.GET(authorizedRequest('http://localhost/api/human-interview?task_id=500'))).status,404);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM call_runs').get().n,1);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM review_actions').get().n,1);
});

test('reviewed interview years leave six years open and scope the next actual call independently of claims',async()=>{
 const db=await setup(); const person=await ready();
 env.CALL_PROVIDER='calle_calls';env.LIVE_CALLS_ENABLED='true';env.CALLE_API_KEY='test-only';
 const originalFetch=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/^https:\/\/api\.heycall-e\.com/);
  if(options?.method==='POST'){requests.push(JSON.parse(options.body));return Response.json({id:`test-${requests.length}`,status:'queued',recipients:[]});}
  const fixture=demoFixture('direct');return Response.json({...fixture.raw,id:'test-1',status:'completed',structured_result:fixture.result});
 };
 try {
  const prepared=await prepare(person);assert.equal(prepared.status,200);assert.equal(requests.length,0);
  const launched=await invoke(calls,launchBody(person,prepared));assert.equal(launched.status,200);assert.equal(requests.length,1);
  await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)});
  let data=await (await evidence.GET(authorizedRequest())).json();assert.equal(data.runs[0].contactId,'morgan');assert.equal(data.runs[0].sequence,1);assert.equal(data.coverage.years.length,0);
  const confirm={runId:launched.data.run_id,years:[1992,1993],quote:data.runs[0].evidence.knowledge_quote,reviewed:true};
  assert.equal((await invoke(coverage,{...confirm,reviewed:false},'reviewer')).status,422);
  assert.equal((await invoke(coverage,{...confirm,years:[1987]},'reviewer')).status,422);
  assert.equal((await invoke(coverage,{...confirm,quote:'What years did you personally know the property?'},'reviewer')).status,422);
  assert.equal((await invoke(coverage,confirm,'coordinator')).status,403);
  assert.equal((await invoke(coverage,confirm,'reviewer')).status,200);
  data=await (await evidence.GET(authorizedRequest())).json();assert.deepEqual(data.coverage.years,[1992,1993]);assert.deepEqual(data.coverage.missingYears,[1987,1988,1989,1990,1991,1994]);assert.equal(data.suggestion.contactId,'carol');
  assert.equal(data.coverage.records[0].reviewScope,'years');
  assert.ok(data.statements.every(item=>item.status==='pending'),'saving the date quotation must not accept factual claims');
  assert.equal(requests.length,1,'human review cannot make an additional phone call');
  const carol=await ready('carol');const followup=await prepare(carol);assert.equal(followup.status,200);assert.match(followup.data.task,/Remaining years without reviewed testimony: 1987–1991 and 1994/);assert.match(followup.data.task,/Ask this respondent about 1987–1991/);assert.match(followup.data.task,/Carol Chen/);
  assert.equal(requests.length,1,'preparing a follow-up cannot dial');
  await invoke(contacts,{action:'reopen_review'},'reviewer');
  assert.equal((await invoke(workflow,{action:'disposition',disposition:'RESOLVED_BY_REVIEWER',rationale:'Only two years have reviewed testimony and the rest remain unknown.'},'reviewer')).status,409);
  const first=data.statements[1];
  assert.equal((await invoke(workflow,{action:'edit',statement_id:first.id,expected_revision:first.revision,fact:first.fact,note:'Recheck the operations separately from the reviewed dates.'},'reviewer')).status,201);
  assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage.years,[1992,1993],'editing a factual claim must preserve separately reviewed years');
  assert.equal((await invoke(coverage,{...confirm,years:[1992]},'reviewer')).status,200);
  assert.equal((await invoke(calls,launchBody(carol,followup))).data.error.code,'EVIDENCE_CHANGED');assert.equal(requests.length,1);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM call_runs WHERE goal_run_id IS NOT NULL").get().n,1);
 } finally {globalThis.fetch=originalFetch;env.CALL_PROVIDER='fake';env.LIVE_CALLS_ENABLED='false';delete env.CALLE_API_KEY;}
});
test('date suggestions distinguish a continuous range from separate years',()=>{
 assert.deepEqual(yearsInText('I worked from 1987 through 1991.'),[1987,1988,1989,1990,1991]);
 assert.deepEqual(yearsInText('I was there in 1992 and 1994.'),[1992,1994]);
 assert.deepEqual(yearsInText('I do not remember.'),[]);
});

test('two reviewed calls can cover all years without saving another partial decision', async () => {
 await setup();
 const morgan = await ready();
 env.CALL_PROVIDER = 'calle_calls'; env.LIVE_CALLS_ENABLED = 'true'; env.CALLE_API_KEY = 'test-only';
 const originalFetch = globalThis.fetch;
 const requests = [];
 const carolQuote = 'I operated the shop from 1987 all the way to 1994.';
 const completeFixture = demoFixture('direct');
 const originalQuote = completeFixture.result.knowledge_period.quote;
 const replaceQuote = value => typeof value === 'string'
   ? value.replaceAll(originalQuote, carolQuote)
   : Array.isArray(value) ? value.map(replaceQuote)
     : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceQuote(item)])) : value;
 const carolFixture = replaceQuote(completeFixture);
 carolFixture.result.knowledge_period.value = '1987 through 1994';
 carolFixture.result.statements[0].fact = 'The respondent operated the shop from 1987 through 1994.';
 globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/api\.heycall-e\.com/);
  if (options?.method === 'POST') {
   requests.push(JSON.parse(options.body));
   return Response.json({id:`coverage-call-${requests.length}`,status:'queued',recipients:[]});
  }
  const fixture = requests.length === 1 ? demoFixture('direct') : carolFixture;
  return Response.json({...fixture.raw,id:`coverage-call-${requests.length}`,status:'completed',structured_result:fixture.result});
 };
 const finish = async person => {
  const prepared = await prepare(person); assert.equal(prepared.status, 200);
  const launched = await invoke(calls, launchBody(person, prepared)); assert.equal(launched.status, 200);
  assert.equal((await invoke(calls, {action:'poll', run_id:String(launched.data.run_id)})).status, 200);
  return launched.data.run_id;
 };
 const reviewAll = async () => {
  const data = await (await evidence.GET(authorizedRequest())).json();
  for (const item of data.statements.filter(item => item.status === 'pending'))
   assert.equal((await invoke(workflow,{action:'review',statement_id:item.id,status:'accepted',expected_revision:item.revision},'reviewer')).status,201);
 };
 try {
  const morganRun = await finish(morgan);
  await reviewAll();
  assert.equal((await invoke(coverage,{runId:morganRun,years:[1992,1993],quote:originalQuote,reviewed:true},'reviewer')).status,200);
  let wf = await (await workflow.GET(authorizedRequest())).json();
  assert.equal(wf.workflow.status, 'FOLLOW_UP_REQUIRED');
  assert.equal(wf.dispositions.length, 1);
  assert.equal(wf.dispositions[0].disposition, 'PARTIALLY_RESOLVED');
  const carol = await ready('carol');
  const planned = await invoke(contacts,{action:'create_task',contactId:'carol',title:'Conduct the next interview',summary:'Interview Carol about the missing years.',assignee:'Case coordinator'});
  assert.equal(planned.status, 200);
  const taskId = planned.data.tasks[0].id;
  const carolRun = await finish(carol);
  const full = {runId:carolRun,years:[1987,1988,1989,1990,1991,1992,1993,1994],quote:carolQuote,reviewed:true};
  assert.equal((await invoke(coverage,{...full,reviewed:false},'reviewer')).status,422,'confirmation of the date quotation remains mandatory');
  assert.equal((await invoke(coverage,full,'reviewer')).status,200,'year review does not require all factual claims to be accepted');
  const unreviewedDecision = await invoke(workflow,{action:'disposition',disposition:'RESOLVED_BY_REVIEWER',rationale:'The full date range has been confirmed, but the separate claims have not been reviewed.'},'reviewer');
  assert.equal(unreviewedDecision.status,409);
  assert.equal(unreviewedDecision.data.error.code,'REVIEW_INCOMPLETE','complete year coverage must not bypass final claim review');
  await reviewAll();
  assert.equal((await invoke(coverage,{...full,quote:'I operated the shop from 1987 through 1994.'},'reviewer')).status,422,'do not rewrite the actual transcript to make the range work');
  const saved = await invoke(coverage,full,'reviewer');
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data.coverage.years,full.years);
  assert.deepEqual(saved.data.coverage.missingYears,[]);
  assert.equal(saved.data.coverage.records.find(item=>item.runId===carolRun).quote,carolQuote);
  wf = await (await workflow.GET(authorizedRequest())).json();
  assert.equal(wf.workflow.status,'AWAITING_EP_REVIEW');
  assert.equal(wf.workflow.assigned_role,'reviewer');
  assert.equal(wf.dispositions.length,1,'full coverage must not insert a partial case disposition');
  assert.equal((await (await evidence.GET(authorizedRequest())).json()).suggestion,null);
  const decision = {action:'disposition',disposition:'RESOLVED_BY_REVIEWER',rationale:'Reviewed firsthand testimony establishes onsite dry cleaning throughout 1987–1994; current environmental conditions are not determined.'};
  const blocked = await invoke(workflow,decision,'reviewer');
  assert.equal(blocked.status,409); assert.equal(blocked.data.error.code,'OPEN_WORK_REMAINS');
  assert.equal((await invoke(contacts,{action:'complete_task',id:taskId})).status,200);
  assert.equal((await invoke(workflow,decision,'reviewer')).status,201);
  wf = await (await workflow.GET(authorizedRequest())).json();
  assert.equal(wf.workflow.status,'RESOLVED');
  assert.equal(wf.dispositions[0].disposition,'RESOLVED_BY_REVIEWER');
  assert.equal(requests.length,2,'coverage review and disposition cannot place calls');
 } finally {
  globalThis.fetch=originalFetch; env.CALL_PROVIDER='fake'; env.LIVE_CALLS_ENABLED='false'; delete env.CALLE_API_KEY;
 }
});

test('reopening Carol year review preserves Morgan and original evidence, and permits a later confirmation', async () => {
 const db = await setup();
 const morgan = await ready();
 env.CALL_PROVIDER='calle_calls'; env.LIVE_CALLS_ENABLED='true'; env.CALLE_API_KEY='test-only';
 const originalFetch = globalThis.fetch;
 const requests = [];
 const carolQuote = 'I operated the shop from 1987 through 1994.';
 const carolFixture = demoFixture('direct');
 carolFixture.raw.recipients[0].attempts[0].transcript_turns[3].text = carolQuote;
 carolFixture.result.knowledge_period.quote = carolQuote;
 carolFixture.result.statements[0].evidence_quote = carolQuote;
 globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/api\.heycall-e\.com/);
  if (options?.method === 'POST') {
   requests.push(JSON.parse(options.body));
   return Response.json({id:`reopen-${requests.length}`,status:'queued',recipients:[]});
  }
  const fixture = requests.length === 1 ? demoFixture('direct') : carolFixture;
  return Response.json({...fixture.raw,id:`reopen-${requests.length}`,status:'completed',structured_result:fixture.result});
 };
 const finish = async person => {
  const prepared = await prepare(person); assert.equal(prepared.status,200);
  const launched = await invoke(calls,launchBody(person,prepared)); assert.equal(launched.status,200);
  assert.equal((await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)})).status,200);
  return launched.data.run_id;
 };
 const reopen = (caseId, runId) => db.sqlite.prepare("INSERT INTO audit_events(event_type,entity_id,detail,actor,created_at) VALUES ('CASE_YEARS_REOPENED', ?, ?, 'EP Reviewer', ?)").run(`${caseId}:COVERAGE:${runId}`,JSON.stringify({runId}),new Date().toISOString());
 try {
  const morganRun = await finish(morgan);
  const morganQuote = demoFixture('direct').result.knowledge_period.quote;
  assert.equal((await invoke(coverage,{runId:morganRun,years:[1992,1993],quote:morganQuote,reviewed:true},'reviewer')).status,200);
  const carol = await ready('carol');
  const carolRun = await finish(carol);
  const confirmation = {runId:carolRun,years:RESEARCH_YEARS,quote:carolQuote,reviewed:true};
  assert.equal((await invoke(coverage,confirmation,'reviewer')).status,200);
  const before = await (await evidence.GET(authorizedRequest())).json();
  assert.deepEqual(before.coverage.years,RESEARCH_YEARS);
  const staleBrief = await prepare(morgan); assert.equal(staleBrief.status,200);
  const originalPayloads = db.sqlite.prepare('SELECT id,response_payload FROM call_runs ORDER BY id').all();
  reopen('UNRELATED-CASE',carolRun);
  assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage,before.coverage,'another case cannot reopen this review');
  reopen(before.session.caseId,carolRun);
  const reopened = await (await evidence.GET(authorizedRequest())).json();
  assert.deepEqual(reopened.coverage.years,[1992,1993]);
  assert.deepEqual(reopened.coverage.missingYears,[1987,1988,1989,1990,1991,1994]);
  assert.deepEqual(reopened.coverage.records.map(record=>record.runId),[morganRun]);
  assert.deepEqual(reopened.statements,before.statements,'reopening date review must not accept, reject, or edit claims');
  assert.ok(reopened.statements.every(statement=>statement.status==='pending'));
  assert.deepEqual(db.sqlite.prepare('SELECT id,response_payload FROM call_runs ORDER BY id').all(),originalPayloads);
  assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='CASE_YEARS_CONFIRMED'").get().n,2,'original approvals remain in the audit history');
  const blocked = await invoke(calls,launchBody(morgan,staleBrief));
  assert.equal(blocked.status,409); assert.equal(blocked.data.error.code,'EVIDENCE_CHANGED');
  assert.equal(requests.length,2,'undoing review cannot place another call');
  assert.equal((await invoke(coverage,confirmation,'reviewer')).status,200);
  const confirmed = await (await evidence.GET(authorizedRequest())).json();
  assert.deepEqual(confirmed.coverage.years,RESEARCH_YEARS,'a later explicit confirmation restores the selected review');
  assert.equal(confirmed.coverage.records.length,2);
  assert.deepEqual(confirmed.statements,before.statements);
 } finally {
  globalThis.fetch=originalFetch; env.CALL_PROVIDER='fake'; env.LIVE_CALLS_ENABLED='false'; delete env.CALLE_API_KEY;
 }
});

test('spoken years are selectable without assuming excluded years are supported',()=>{
 assert.deepEqual(yearsInText('I worked from nineteen ninety-two to nineteen ninety-three.'),[1992,1993]);
 assert.deepEqual(yearsInText('nineteen eighty-seven through nineteen ninety-one'),[1987,1988,1989,1990,1991]);
});

test('an ambiguous unrelated answer stays pending while reviewed 1992–1993 years enable an approved follow-up call', async () => {
 const db = await setup();
 const morgan = await ready();
 env.CALL_PROVIDER = 'calle_calls'; env.LIVE_CALLS_ENABLED = 'true'; env.CALLE_API_KEY = 'test-only';
 const fixture = demoFixture('direct');
 const dateQuote = "Yes. I was there from about '92 to '93.";
 fixture.raw.recipients[0].attempts[0].transcript_turns[3].text = dateQuote;
 fixture.result.knowledge_period.quote = dateQuote;
 fixture.result.statements[0].evidence_quote = dateQuote;
 fixture.raw.recipients[0].attempts[0].transcript_turns.push(
  {speaker:'bot',text:'Did you personally enter the other areas?',offset_seconds:70},
  {speaker:'user',text:'No.',offset_seconds:75},
  {speaker:'bot',text:'Do you have another contact number?',offset_seconds:80},
  {speaker:'user',text:'No.',offset_seconds:85},
 );
 fixture.result.statements.push({fact:'The respondent did not personally enter the other areas.',source_type:'knowledge_limitation',certainty:'uncertain',evidence_quote:'No.'});
 const originalFetch = globalThis.fetch;
 const requests = [];
 globalThis.fetch = async (url, options) => {
  assert.match(String(url), /^https:\/\/api\.heycall-e\.com/);
  if (options?.method === 'POST') {
   requests.push(JSON.parse(options.body));
   return Response.json({id:`ambiguous-${requests.length}`,status:'queued',recipients:[]});
  }
  return Response.json({...fixture.raw,id:'ambiguous-1',status:'completed',structured_result:fixture.result});
 };
 try {
  const prepared = await prepare(morgan);
  const launched = await invoke(calls, launchBody(morgan, prepared)); assert.equal(launched.status,200);
  assert.equal((await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)})).status,200);
  let data = await (await evidence.GET(authorizedRequest())).json();
  const ambiguous = data.statements.find(item=>item.evidence==='No.');
  assert.ok(ambiguous); assert.equal(ambiguous.citation.status,'ambiguous'); assert.equal(ambiguous.status,'pending');
  const saved = await invoke(coverage,{runId:launched.data.run_id,years:[1993,1992,1992],quote:fixture.result.knowledge_period.quote,reviewed:true},'reviewer');
  assert.equal(saved.status,200); assert.deepEqual(saved.data.coverage.years,[1992,1993]);
  assert.equal(saved.data.coverage.records[0].quote,dateQuote,'shortened years must save without rewriting the respondent quotation');
  data = await (await evidence.GET(authorizedRequest())).json();
  assert.equal(data.suggestion.contactId,'carol');
  assert.deepEqual(data.coverage.missingYears,[1987,1988,1989,1990,1991,1994]);
  assert.ok(data.statements.every(item=>item.status==='pending'));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM review_actions').get().n,0,'year review creates no claim approvals');
  const carol = await ready('carol');
  const followup = await prepare(carol); assert.equal(followup.status,200);
  assert.match(followup.data.task,/Remaining years without reviewed testimony: 1987–1991 and 1994/);
  assert.equal(requests.length,1,'preparing another brief cannot dial');
  assert.equal((await invoke(calls,launchBody(carol,followup))).status,200,'a separately approved call may proceed while unrelated claims remain pending');
  assert.equal(requests.length,2);
  data = await (await evidence.GET(authorizedRequest())).json();
  assert.equal(data.statements.find(item=>item.id===ambiguous.id).status,'pending');
  assert.deepEqual(data.coverage.years,[1992,1993]);
 } finally {
  globalThis.fetch = originalFetch; env.CALL_PROVIDER='fake'; env.LIVE_CALLS_ENABLED='false'; delete env.CALLE_API_KEY;
 }
});

test('legacy coverage still requires its original reviewed statement signature', async () => {
 const db = await setup();
 const person = await ready();
 const prepared = await prepare(person);
 const launched = await invoke(calls,launchBody(person,prepared));
 await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)});
 let data = await (await evidence.GET(authorizedRequest())).json();
 for (const item of data.statements)
  assert.equal((await invoke(workflow,{action:'review',statement_id:item.id,status:'accepted',expected_revision:item.revision},'reviewer')).status,201);
 data = await (await evidence.GET(authorizedRequest())).json();
 assert.equal((await invoke(coverage,{runId:launched.data.run_id,years:[1992,1993],quote:data.runs[0].evidence.knowledge_quote,reviewed:true},'reviewer')).status,200);
 const event = db.sqlite.prepare("SELECT id,detail FROM audit_events WHERE event_type='CASE_YEARS_CONFIRMED' ORDER BY id DESC LIMIT 1").get();
 const legacy = JSON.parse(event.detail);
 delete legacy.reviewScope;
 legacy.signature = coverageSignature(data.statements);
 db.sqlite.prepare('UPDATE audit_events SET detail=? WHERE id=?').run(JSON.stringify(legacy),event.id);
 assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage.years,[1992,1993],'previously saved valid coverage must remain readable');
 await invoke(contacts,{action:'reopen_review'},'reviewer');
 const item = data.statements[0];
 assert.equal((await invoke(workflow,{action:'edit',statement_id:item.id,expected_revision:item.revision,fact:item.fact,note:'Revisit the evidence underlying this legacy review.'},'reviewer')).status,201);
 assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage.years,[],'stale legacy coverage must not be silently promoted to a year-only review');
});

test('a reviewer can repair an extracted quotation without replacing the provider record',async()=>{
 const db=await setup();const person=await ready();const prepared=await prepare(person);const launched=await invoke(calls,launchBody(person,prepared));await invoke(calls,{action:'poll',run_id:String(launched.data.run_id)});
 const runId=launched.data.run_id;const statementId=`CALLE-GOAL-${runId}-1`;
 const originalPayload=db.sqlite.prepare('SELECT response_payload FROM call_runs WHERE id=?').get(runId).response_payload;
 db.sqlite.prepare('UPDATE ingested_statements SET evidence=? WHERE id=?').run('Unusable extracted fragment',statementId);
 const data=await (await evidence.GET(authorizedRequest())).json();const item=data.statements.find(item=>item.id===statementId);
 const edit={action:'edit',statement_id:statementId,expected_revision:item.revision,fact:item.fact,note:'Use the complete exact date statement from the transcript.',evidence_quote:'I managed it around 1992 to 1993.'};
 assert.equal((await invoke(workflow,{...edit,evidence_quote:'Invented words'},'reviewer')).status,409);
 assert.equal((await invoke(workflow,edit,'reviewer')).status,201);
 assert.equal((await invoke(workflow,{action:'review',statement_id:statementId,status:'accepted',expected_revision:2},'reviewer')).status,201);
 const changed=(await (await evidence.GET(authorizedRequest())).json()).statements.find(item=>item.id===statementId);
 assert.equal(changed.evidence,'I managed it around 1992 to 1993.');assert.equal(changed.originalEvidence,'Unusable extracted fragment');assert.equal(changed.citation.status,'matched');
 assert.equal(db.sqlite.prepare('SELECT response_payload FROM call_runs WHERE id=?').get(runId).response_payload,originalPayload);
});

test('Carol can save her original 1987–1994 answer when the provider extraction combines separate quotations', async () => {
 const fixture = demoFixture('direct');
 const actualQuote = "I worked there from 1987 to '94 in the back room doing most of the dry cleaning.";
 const providerQuote = "I worked there from 1987 to 1994 in the back room doing most of the dry cleaning. / I was there for all of 1994. And then after that, I don't know. Know.";
 fixture.raw.recipients[0].attempts[0].transcript_turns[3].text = actualQuote;
 fixture.raw.recipients[0].attempts[0].transcript_turns.push(
  {speaker:'user',text:"I was there for all of 1994. And then after that, I don't know. Know.",offset_seconds:80},
 );
 fixture.result.knowledge_period.quote = providerQuote;
 fixture.result.statements[0].evidence_quote = providerQuote;
 await withRecordedFixture(fixture, async ({runId,data,requests}) => {
  const run = data.runs.find(item=>item.id===runId);
  assert.equal(run.evidence.knowledge_quote,providerQuote);
  const source = defaultCoverageQuote(run.evidence.knowledge_quote,run.turns);
  assert.equal(source.quote,actualQuote);
  assert.deepEqual(yearsInText(source.quote),RESEARCH_YEARS);
  const body = {runId,years:RESEARCH_YEARS,...source,reviewed:true};
  assert.equal((await invoke(coverage,{...body,quote:providerQuote,interpretationNote:'These extracted sentences describe the full study period.'},'reviewer')).status,422,'an interpretation note must not make an invented composite quotation valid');
  const saved = await invoke(coverage,body,'reviewer');
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data.coverage.years,RESEARCH_YEARS);
  assert.equal(saved.data.coverage.records[0].sourceTurnId,source.sourceTurnId);
  assert.equal(saved.data.coverage.records[0].quote,actualQuote);
  const refreshed = await (await evidence.GET(authorizedRequest())).json();
  assert.deepEqual(refreshed.coverage.years,RESEARCH_YEARS);
  assert.equal(refreshed.runs[0].evidence.knowledge_quote,providerQuote,'choosing the original answer preserves the original extraction for review');
  assert.ok(refreshed.statements.every(item=>item.status==='pending'));
  assert.equal(requests.length,1,'saving dates cannot make another phone call');
 });
});

test('a repeated answer can be reviewed against one selected respondent turn while false source references fail', async () => {
 const fixture = demoFixture('direct');
 const quote = 'I worked there from 1987 through 1994.';
 fixture.raw.recipients[0].attempts[0].transcript_turns[3].text = quote;
 fixture.raw.recipients[0].attempts[0].transcript_turns.push(
  {speaker:'bot',text:quote,offset_seconds:80},
  {speaker:'user',text:quote,offset_seconds:85},
 );
 fixture.result.knowledge_period.quote = quote;
 fixture.result.statements[0].evidence_quote = quote;
 await withRecordedFixture(fixture, async ({runId,data}) => {
  const turns = data.runs.find(item=>item.id===runId).turns;
  const respondent = turns.filter(item=>item.speaker==='respondent' && item.text===quote).at(-1);
  const assistant = turns.find(item=>item.speaker==='assistant' && item.text===quote);
  const body = {runId,quote,years:RESEARCH_YEARS,reviewed:true};
  assert.equal((await invoke(coverage,body,'reviewer')).status,422,'a repeated answer requires the reviewer to identify its source turn');
  for (const sourceTurnId of [assistant.id,'invented-turn',turns[1].id])
   assert.equal((await invoke(coverage,{...body,sourceTurnId},'reviewer')).status,422);
  const saved = await invoke(coverage,{...body,sourceTurnId:respondent.id},'reviewer');
  assert.equal(saved.status,200);
  assert.equal(saved.data.coverage.records[0].sourceTurnId,respondent.id);
  assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage.years,RESEARCH_YEARS);
 });
});

test('a documented human year correction survives reload, invalidates an older call brief, and leaves final claim review required', async () => {
 const fixture = demoFixture('direct');
 const quote = 'I started in 1987 and stayed until the end of 1994.';
 fixture.raw.recipients[0].attempts[0].transcript_turns[3].text = quote;
 fixture.result.knowledge_period.quote = quote;
 fixture.result.statements[0].evidence_quote = quote;
 await withRecordedFixture(fixture, async ({db,runId,data,requests}) => {
  const sourceTurnId = data.runs.find(item=>item.id===runId).turns.find(item=>item.text===quote).id;
  const body = {runId,quote,sourceTurnId,years:RESEARCH_YEARS,reviewed:true};
  assert.deepEqual(yearsInText(quote),[1987,1994],'the parser should expose its limited suggestions, not invent certainty');
  assert.equal((await invoke(coverage,{...body,years:[1987,1994]},'reviewer')).status,200);
  const morgan = await ready('morgan');
  const oldBrief = await prepare(morgan); assert.equal(oldBrief.status,200);
  for (const interpretationNote of [undefined,'','         ','Too short','x'.repeat(1001),42])
   assert.equal((await invoke(coverage,{...body,interpretationNote},'reviewer')).status,422,'selecting years beyond parser suggestions requires a usable review note');
  const interpretationNote = 'The respondent describes continuous work from the start of 1987 through the end of 1994.';
  assert.equal((await invoke(coverage,{...body,interpretationNote,reviewed:false},'reviewer')).status,422);
  assert.equal((await invoke(coverage,{...body,interpretationNote,years:[...RESEARCH_YEARS,1995]},'reviewer')).status,422);
  assert.equal((await invoke(coverage,{...body,interpretationNote},'coordinator')).status,403);
  const saved = await invoke(coverage,{...body,interpretationNote:`  ${interpretationNote}  `},'reviewer');
  assert.equal(saved.status,200);
  assert.deepEqual(saved.data.coverage.years,RESEARCH_YEARS);
  assert.equal(saved.data.coverage.records[0].interpretationNote,interpretationNote);
  assert.equal(saved.data.coverage.records[0].sourceTurnId,sourceTurnId);
  const refreshed = await (await evidence.GET(authorizedRequest())).json();
  assert.deepEqual(refreshed.coverage.years,RESEARCH_YEARS);
  assert.deepEqual(refreshed.coverage.missingYears,[]);
  assert.ok(refreshed.statements.every(item=>item.status==='pending'));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM review_actions').get().n,0);
  const blocked = await invoke(workflow,{action:'disposition',disposition:'RESOLVED_BY_REVIEWER',rationale:'Date coverage has been reviewed but the other claims are still pending.'},'reviewer');
  assert.equal(blocked.status,409);
  assert.equal(blocked.data.error.code,'REVIEW_INCOMPLETE');
  const stale = await invoke(calls,launchBody(morgan,oldBrief));
  assert.equal(stale.status,409);
  assert.equal(stale.data.error.code,'EVIDENCE_CHANGED');
  assert.equal(requests.length,1,'a stale approval cannot dial');
 });
});

test('manual date review still works when a contextual answer has no machine-parsed years', async () => {
 const fixture = demoFixture('direct');
 const quote = 'I was there continuously for the entire period you just asked about.';
 fixture.raw.recipients[0].attempts[0].transcript_turns[2].text = 'Did you work there throughout 1987 through 1994?';
 fixture.raw.recipients[0].attempts[0].transcript_turns[3].text = quote;
 fixture.result.knowledge_period.quote = quote;
 fixture.result.statements[0].evidence_quote = quote;
 await withRecordedFixture(fixture, async ({runId,data}) => {
  const sourceTurnId = data.runs.find(item=>item.id===runId).turns.find(item=>item.text===quote).id;
  const body = {runId,quote,sourceTurnId,years:RESEARCH_YEARS,reviewed:true};
  assert.deepEqual(yearsInText(quote),[]);
  assert.equal((await invoke(coverage,body,'reviewer')).status,422);
  const interpretationNote = 'I reviewed the preceding question naming 1987 through 1994 and the respondent confirms continuous work throughout that period.';
  const saved = await invoke(coverage,{...body,interpretationNote},'reviewer');
  assert.equal(saved.status,200,'a verified quotation and documented human interpretation must not depend on parser support');
  assert.deepEqual((await (await evidence.GET(authorizedRequest())).json()).coverage.years,RESEARCH_YEARS);
 });
});
