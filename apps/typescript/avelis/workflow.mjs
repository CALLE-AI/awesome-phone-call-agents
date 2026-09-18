import {freshBreastWorkspace} from './src/breast/demo.mjs';
import {planContext,generatePlan,applyPatientTime} from './src/followup-planner.mjs';
import {scriptContext,generateClinicianScript} from './src/breast/model-script.mjs';
import {classifyBreastRisk,unavailableModelRisk} from './src/breast/model-risk.mjs';
import {verifyConversation} from './src/conversation-verifier.mjs';
import {repairExtraction} from './src/extraction-repair.mjs';
import {checkConversation} from './src/conversation-gate.mjs';
import {applyOutcome} from './src/care-result.mjs';
import {createCallBody,callsRequest,adaptCallResponse} from './src/calle-http.mjs';

export function sampleCase(id='bc-emma'){
 const db=freshBreastWorkspace();const patient=db.patients.find(p=>p.id===id);
 if(!patient)throw Error('Choose a documented fictional case ID.');
 const task=db.tasks.find(t=>t.patient_id===id&&t.call_id),call=db.calls.find(c=>c.id===task.call_id);
 return {db,patient,task,call};
}
export function previewCall(id='bc-emma'){
 const {task}=sampleCase(id);const body=createCallBody(task,'+12025550101','fictional-preview');
 return {mode:'Demo Simulation',side_effects:'None. Request is not submitted.',...body,recipients:[{phones:['+12•••••••01'],locale:'en-US'}]};
}
// Request construction is shared with the live runner.
// Existing-call inspection is one GET, with explicit expected-recipient binding.
export async function inspectCall(id,env,options={}){
 if(!/^call_[A-Za-z0-9_-]+$/.test(id||'')||!/^\+[1-9]\d{7,14}$/.test(env.AVELIS_LIVE_PHONE||''))throw Error('Provide a call ID and its exact authorized E.164 recipient in AVELIS_LIVE_PHONE.');
 const raw=await callsRequest(env.CALLE_API_KEY,'/v1/calls/'+id,options);
 return adaptCallResponse(raw,id,env.AVELIS_LIVE_PHONE);
}
export async function modelWorkflow(fixture,env,{parsed=null,...options}={}){
 const db=structuredClone(fixture.db),patient=db.patients.find(p=>p.id===fixture.patient.id),task=db.tasks.find(t=>t.id===fixture.task.id);const call=db.calls.find(c=>c.id===task.call_id);
 // Preserve original input separately from corrected/verified output.
 const transcript=parsed?parsed.transcript:call.transcript;
 const original=parsed?parsed.payload?.result?.extracted?.conversation_result:call.conversation_report;
 if(!original||!transcript||parsed&&parsed.status!=='COMPLETED')throw Error('A completed matching breast-schema conversation is required; no outcome was inferred.');
 if(parsed?.started_at){call.created_at=parsed.started_at;task.contact_reference_at=parsed.started_at;}
 let report=structuredClone(original),verification;
 try{
  if(!checkConversation(report,transcript,task).ok)report=await repairExtraction(report,transcript,task,env,options);
  verification=await verifyConversation(report,transcript,task,patient,call.created_at,env,options);
 }catch{verification={supported:false,issues:['Evidence review unavailable or rejected. Clinician verification required.']};}
 let risk=unavailableModelRisk(task);
 if(verification.supported)try{risk=await classifyBreastRisk({task,report,transcript,verification},env,options);}catch{}
 call.provider='calle';call.transcript=transcript;call.provider_structured_result=original;
 delete call.conversation_report;delete call.result;
 applyOutcome(db,call,{status:'COMPLETED',result:{transcript,extracted:{conversation_result:report}}},verification,risk);
 let script=null,scriptError=null;
 try{script=await generateClinicianScript(scriptContext({db,patient,task,call,clinician:{name:'Dr Sarah Chen'}}),env,options);}catch{scriptError='Clinician draft unavailable after bounded generation/review. Review the transcript and gaps directly.';}
 // Plans are recommendations only; no timer, follow-up call or clinical action is executed.
 let plan=null,planError=null;
 try{const context=planContext(task,patient,db.demo_now,db);plan=applyPatientTime(await generatePlan(context,env,options),context);}catch{planError='Contact planning unavailable; clinician review required.';}
 return {mode:parsed?'Existing fictional-roleplay call + model analysis':'Demo Simulation + live DeepSeek analysis',patient:patient.name,task_status:task.status,original_extraction:original,reviewed_report:call.conversation_report,verification,risk:call.risk_assessment,clinician_script:script,script_error:scriptError,plan,plan_error:planError,external_actions:'Model requests only; no new phone call, clinical action or external notification.'};
}
