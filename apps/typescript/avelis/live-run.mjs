import {mkdirSync,openSync,writeFileSync,readFileSync,closeSync,fsyncSync,renameSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {freshBreastLive} from './src/breast/demo.mjs';
import {attachPatientContext} from './src/breast/records.mjs';
import {planContext,generatePlan} from './src/followup-planner.mjs';
import {createCallBody,callsRequest,newIdempotencyKey,adaptCallResponse} from './src/calle-http.mjs';
import {modelWorkflow} from './workflow.mjs';
const nowDefault=()=>new Date().toISOString();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function save(dir,state){
 const tmp=resolve(dir,'state.tmp'),fd=openSync(tmp,'w',0o600);
 try{writeFileSync(fd,JSON.stringify(state,null,2));fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(tmp,resolve(dir,'state.private.json'));
 const parent=openSync(dir,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
function lock(dir){const file=resolve(dir,'process.lock');let fd;try{fd=openSync(file,'wx',0o600);}catch{throw Error('Run is locked. Stop the other process; see README for crash recovery.');}writeFileSync(fd,JSON.stringify({pid:process.pid,host:hostname()}));closeSync(fd);return ()=>unlinkSync(file);}
function config(env,models=true){
 if(!env.CALLE_API_KEY?.trim())throw Error('Configure CALLE_API_KEY privately.');
 if(models&&(!env.AVELIS_PLANNER_KEY?.trim()||!env.AVELIS_PLANNER_MODEL?.trim()||env.AVELIS_PLANNER_ORIGIN!=='https://api.deepseek.com'))throw Error('Configure the DeepSeek key, model and official origin.');
}
export function liveFixture(caseId,at){
 const db=freshBreastLive(at);const patient=db.patients.find(p=>p.id===caseId);if(!patient)throw Error('Unknown fictional case.');
 db.patients=[patient];db.tasks=db.tasks.filter(t=>t.patient_id===caseId);db.calls=[];
 const task=db.tasks[0];db.tasks=[task];patient.synthetic=true;patient.phone='';patient.timezone='UTC';patient.contact_window={start:0,end:24};
 task.due_at=at;task.order.due_at=at;task.contact_reference_at=at;task.status='UNCONFIRMED';delete task.call_id;
 // An operator-authorized software test, never fabricated clinical approval.
 db.technical_test={hosted:true,requested_at:at,max_calls:1};attachPatientContext(db,task,at);
 return {db,patient,task};
}
export function runSummary(state){return {state:state.stage,call_id:state.call_id||null,patient:state.fixture.patient.name,recipient:state.phone.slice(0,3)+'••••'+state.phone.slice(-2),task_status:state.outcome?.task_status||state.fixture.task.status,provider_status:state.parsed?.status||null,note:state.note||null};}
export async function startRun(dir,caseId,env,{authorized=false,fetcher=fetch,sleep=pause,now=nowDefault,maxPolls=60}={}){
 if(!authorized)throw Error('Explicit consent, fictional-roleplay and model-upload flags are required.');config(env);
 const phone=env.AVELIS_LIVE_PHONE?.trim();if(!/^\+[1-9]\d{7,14}$/.test(phone||''))throw Error('Set AVELIS_LIVE_PHONE to the consenting actor’s E.164 number.');
 // Exclusive directory creation makes repeated start commands fail before any API request.
 mkdirSync(dir,{mode:0o700});const release=lock(dir);const at=now(),id=randomUUID();
 try{
 const state={version:1,stage:'PLANNING',created_at:at,case_id:caseId,phone,authorized:true,idempotency_key:newIdempotencyKey(Date.parse(at),id),fixture:liveFixture(caseId,at)};
  save(dir,state);
  try{state.plan=await generatePlan(planContext(state.fixture.task,state.fixture.patient,at,state.fixture.db),env,{fetcher,sleep});}catch{state.stage='PLAN_FAILED';state.note='Planning failed. No call was submitted.';save(dir,state);return state;}
  if(state.plan.status!=='READY'||Date.parse(state.plan.call_at)!==Date.parse(at)||Date.parse(now())-Date.parse(at)>300000){state.stage='PLAN_BLOCKED';state.note='Plan is not ready for this authorized test time. No call submitted.';save(dir,state);return state;}
  const {task,patient,db}=state.fixture;task.plan=state.plan;task.patient_timezone=patient.timezone;task.contact_window=patient.contact_window;
  const call={id,task_id:task.id,provider:'calle',state:'SUBMITTING',created_at:at};db.calls=[call];task.call_id=id;state.fixture.call=call;
  state.request=createCallBody(task,phone,id);
  state.request.task='SUPERVISED SOFTWARE TEST: Make exactly one call attempt. Do not retry, redial or schedule another call. The recipient is a consenting adult actor playing the fictional patient below. Introduce this as an automated software test, not a hospital call. Explain that answers are recorded for test review and obtain agreement. Do not request actual health information. Stop on withdrawal or a real emergency without claiming dispatch. No clinical service or external notification is provided. '+state.request.task;
  task.status='PHONE_ESCALATION';state.stage='SUBMITTING';save(dir,state);
  try{
   const raw=await callsRequest(env.CALLE_API_KEY,'/v1/calls',{method:'POST',body:state.request,idempotencyKey:state.idempotency_key,fetcher});
   // Save ID before adapting the payload. Even malformed details must not cause another POST.
   state.call_id=raw.id;state.stage='WAITING';save(dir,state);
  }catch{state.stage='SUBMISSION_UNKNOWN';state.note='Create response was not safely recorded. Do not start a replacement. Reconcile the saved request/key with CALL-E.';save(dir,state);return state;}
  return await continueRun(dir,state,env,{fetcher,sleep,now,maxPolls});
 }finally{release();}
}
export async function resumeRun(dir,env,{fetcher=fetch,sleep=pause,now=nowDefault,maxPolls=60}={}){
 config(env);const release=lock(dir);
 try{const state=JSON.parse(readFileSync(resolve(dir,'state.private.json'),'utf8'));if(state.version!==1||!state.authorized)throw Error('Invalid run journal.');
 if(!state.call_id)throw Error('No saved Call ID. Resume never submits a call; reconcile the original request with CALL-E.');
 if(state.stage==='DONE')return state;
 return await continueRun(dir,state,env,{fetcher,sleep,now,maxPolls});}finally{release();}
}
async function continueRun(dir,state,env,{fetcher,sleep,now,maxPolls}){
 if(!state.parsed?.finished){
  for(let i=0;i<maxPolls;i++){
   try{const raw=await callsRequest(env.CALLE_API_KEY,'/v1/calls/'+state.call_id,{fetcher});state.raw=raw;state.parsed=adaptCallResponse(raw,state.call_id,state.phone);state.note=null;}
   catch{state.stage='STATUS_PAUSED';state.note='Status could not be confirmed. Resume reads the same Call ID; it never redials.';save(dir,state);return state;}
   state.stage=state.parsed.finished?'RESULT_RECEIVED':'WAITING';save(dir,state);if(state.parsed.finished)break;
   if(i<maxPolls-1)await sleep(10000);
  }
 }
 if(!state.parsed?.finished){state.stage='STATUS_PAUSED';state.note='Polling window ended; the provider may still be calling. Resume later.';save(dir,state);return state;}
 if(state.parsed.status!=='COMPLETED'){state.stage='DONE';state.fixture.task.status='UNRESOLVED';state.note='Terminal call failure/cancellation; no successful assessment inferred and no automatic redial.';save(dir,state);return state;}
 state.stage='ANALYZING';save(dir,state);
 try{
  state.fixture.db.demo_now=now();state.outcome=await modelWorkflow(state.fixture,env,{parsed:state.parsed,fetcher,sleep});
  state.fixture.task.status=state.outcome.task_status;
  state.stage=state.outcome.script_error||state.outcome.plan_error||state.outcome.risk?.level==='UNKNOWN'?'ANALYSIS_PAUSED':'DONE';
  state.note=state.stage==='ANALYSIS_PAUSED'?'Partial analysis retained. Resume may repeat model analysis, never the call.':null;
 }catch{state.stage='ANALYSIS_PAUSED';state.fixture.task.status='UNRESOLVED';state.note='Completed call lacks usable schema/transcript or analysis failed. Original result retained for human review.';}
 save(dir,state);return state;
}
