import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startRun,resumeRun,runSummary} from './live-run.mjs';import {sampleCase} from './workflow.mjs';
const env={CALLE_API_KEY:'fake-call-key',AVELIS_LIVE_PHONE:'+12025550101',AVELIS_PLANNER_KEY:'fake-model-key',AVELIS_PLANNER_MODEL:'test',AVELIS_PLANNER_ORIGIN:'https://api.deepseek.com'};
const now=()=> '2026-09-14T12:00:00.000Z';
const reply=x=>({ok:true,status:200,json:async()=>x});const model=x=>reply({choices:[{message:{content:JSON.stringify(x)}}]});
function temp(t){const base=mkdtempSync(join(tmpdir(),'avelis-run-'));t.after(()=>rmSync(base,{recursive:true,force:true}));return join(base,'run');}
function fake({pending=false,lost=false,planBlocked=false,noSchema=false}={}){
 const stats={posts:0,gets:0,models:0};const original=sampleCase().call,report=original.conversation_report;
 const raw=(status)=>({id:'call_fake',object:'call_task',status,structured_result:null,recipients:[{id:'r',phones:[env.AVELIS_LIVE_PHONE],status:status==='completed'?'completed':'pending',structured_result:noSchema?null:report,attempts:status==='completed'?[{id:'a',status:'completed',started_at:now(),completed_at:now(),transcript_turns:original.transcript.split('\n').map(line=>({speaker:line.startsWith('Patient:')?'user':'bot',text:line.replace(/^(Patient|Agent): /,'')}))}]:[]}]});
 return {stats,setPending:v=>pending=v,fetcher:async(url,o)=>{
  if(url.startsWith('https://api.heycall-e.com/')){
   if(o.method==='POST'){stats.posts++;stats.key=o.headers['Idempotency-Key'];stats.body=JSON.parse(o.body);if(lost)throw Error('Lost response');return reply(raw('queued'));}
   stats.gets++;return reply(raw(pending?'in_progress':'completed'));
  }
  assert.equal(url,'https://api.deepseek.com/chat/completions');stats.models++;const body=JSON.parse(o.body),p=body.messages[0].content,ctx=JSON.parse(body.messages[1].content);
  if(p.startsWith('You plan '))return model(ctx.task_status==='UNCONFIRMED'&&!planBlocked?{decision:'ready',call_at:ctx.operator_requested_at,purpose:'Compare hot flashes and arm symptoms with previous records',reason:'Operator-authorized actor test at the requested instant'}:{decision:'wait_clinician',call_at:null,purpose:'Review symptoms',reason:'Clinical judgment required'});
  const evidence=report.oncology.symptoms[0].facts[0].evidence.slice(0,1);
  if(p.startsWith('Classify '))return model({level:'YELLOW',routing:'HUMAN_REVIEW',reason:'Symptoms require review',triggers:[{label:'Symptoms',evidence}],missing:[]});
  if(p.startsWith('Write '))return model({title:'Emma follow-up',script:'Hello Emma, this is Dr Sarah Chen. Is now a private time to talk? How have the hot flashes and sleep been since the last call? What has changed with your arm?',evidence,unresolved:['Current symptoms']});
  if(p.startsWith('Review '))return model({accepted:true,issues:[]});
  return model({supported:true,coverage_complete:false,identity_valid:true,consent_valid:true,needs_review:true,stop_contact:false,contact_agreement_valid:false,issues:['Unassessed topic']});
 }};
}
test('real-mode runner composes planning, one POST, recipient schema, classification and reviewed script with fake APIs',async t=>{
 const dir=temp(t),f=fake();const r=await startRun(dir,'bc-emma',env,{authorized:true,now,sleep:async()=>{},fetcher:f.fetcher,maxPolls:1});
 assert.equal(f.stats.posts,1);assert.equal(r.stage,'DONE');assert.equal(r.outcome.risk.level,'YELLOW');assert.equal(r.outcome.clinician_script.reviewed,true);assert.equal(r.fixture.task.status,'HUMAN_REVIEW');
 assert.match(f.stats.body.task,/Compare hot flashes/);assert.ok(f.stats.body.recipient_result_schema);assert.equal(f.stats.key,r.idempotency_key);
 assert.equal(statSync(dir).mode&0o777,0o700);assert.equal(statSync(join(dir,'state.private.json')).mode&0o777,0o600);
 assert.doesNotMatch(readFileSync(join(dir,'state.private.json'),'utf8'),/fake-call-key|fake-model-key/);assert.doesNotMatch(JSON.stringify(runSummary(r)),/12025550101/);
 await assert.rejects(startRun(dir,'bc-emma',env,{authorized:true,now,fetcher:f.fetcher}));assert.equal(f.stats.posts,1);
 await resumeRun(dir,env,{fetcher:f.fetcher});assert.equal(f.stats.posts,1);
});
test('polling timeout resumes same ID after restart and performs analysis without another POST',async t=>{
 const dir=temp(t),f=fake({pending:true});const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher:f.fetcher,maxPolls:1});assert.equal(r.stage,'STATUS_PAUSED');
 f.setPending(false);const done=await resumeRun(dir,env,{now,fetcher:f.fetcher,maxPolls:1});assert.equal(done.stage,'DONE');assert.equal(done.outcome.task_status,'HUMAN_REVIEW');assert.equal(f.stats.posts,1);
});
test('ambiguous submission retains original key and prevents blind resubmission',async t=>{
 const dir=temp(t),f=fake({lost:true});const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher:f.fetcher});assert.equal(r.stage,'SUBMISSION_UNKNOWN');assert.ok(r.request);assert.ok(r.idempotency_key);
 await assert.rejects(resumeRun(dir,env,{fetcher:f.fetcher}),/No saved Call ID/);assert.equal(f.stats.posts,1);
});
test('missing consent and a blocked plan never dial',async t=>{
 const dir=temp(t),f=fake({planBlocked:true});await assert.rejects(startRun(dir,'bc-emma',env,{fetcher:f.fetcher}));assert.equal(f.stats.models,0);
 const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher:f.fetcher});assert.equal(r.stage,'PLAN_BLOCKED');assert.equal(f.stats.posts,0);
});
test('a completed call without schema is retained as unresolved',async t=>{
 const dir=temp(t),f=fake({noSchema:true});const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher:f.fetcher,maxPolls:1});assert.equal(r.stage,'ANALYSIS_PAUSED');assert.equal(r.fixture.task.status,'UNRESOLVED');assert.ok(r.raw);assert.equal(f.stats.posts,1);
});
test('an active or stale lock never starts a competing recovery',async t=>{
 const dir=temp(t);mkdirSync(dir);writeFileSync(join(dir,'process.lock'),'{}');await assert.rejects(resumeRun(dir,env),/locked/);
});
test('GET errors pause without creating a replacement call',async t=>{
 const dir=temp(t),f=fake();const fetcher=async(url,o)=>url.startsWith('https://api.heycall-e.com/')&&o.method==='GET'?{ok:false,status:503,json:async()=>({error:{code:'temporary'}})}:f.fetcher(url,o);
 const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher,maxPolls:1});assert.equal(r.stage,'STATUS_PAUSED');assert.equal(r.call_id,'call_fake');assert.equal(f.stats.posts,1);
 const done=await resumeRun(dir,env,{now,fetcher:f.fetcher,maxPolls:1});assert.equal(done.stage,'DONE');assert.equal(f.stats.posts,1);
});
test('terminal failure is unresolved and recipient mismatch is never analyzed',async t=>{
 for(const wrongRecipient of [false,true]){
  const dir=temp(t),f=fake();const fetcher=async(url,o)=>{
   if(url.startsWith('https://api.heycall-e.com/')&&o.method==='GET')return reply({id:'call_fake',object:'call_task',status:'failed',recipients:[{id:'r',phones:[wrongRecipient?'+12025550102':env.AVELIS_LIVE_PHONE],status:'failed',attempts:[]}]});
   return f.fetcher(url,o);
  };
  const r=await startRun(dir,'bc-emma',env,{authorized:true,now,fetcher,maxPolls:1});assert.equal(r.stage,wrongRecipient?'STATUS_PAUSED':'DONE');assert.equal(r.outcome,undefined);if(!wrongRecipient)assert.equal(r.fixture.task.status,'UNRESOLVED');assert.equal(f.stats.posts,1);
 }
});
