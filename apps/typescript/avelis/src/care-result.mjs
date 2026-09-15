import {unavailableModelRisk} from './breast/model-risk.mjs';
import {evaluateBreastRisk} from './breast/risk.mjs';
import {gateConversation} from './conversation-gate.mjs';
import { gateOutcome } from './outcome-gate.mjs';
import {ensureFollowup, closeConfirmedParents} from './care-followup.mjs';
const reasons=new Set(['forgot','side_effect_concern','cannot_access_medication','does_not_understand_instruction','does_not_want_to_take','other','unknown']);
// Structured data is accepted only from CALL-E's extracted result or JSON report.
// Agent questions and unstructured transcript keywords are never patient evidence.
export function extractResult(payload) {
  const data=payload?.result;
  if(!data||typeof data!=='object')return null;
  const candidates=[data.extracted?.care_result];
  for(const report of [data.post_summary,data.summary]) {
    if(typeof report!=='string')continue;
    const snippets=[report,...Array.from(report.matchAll(/```(?:json)?\s*([\s\S]*?)```/g),match=>match[1])];
    for(const text of snippets)try{candidates.push(JSON.parse(text).care_result);}catch{}
  }
  for(const value of candidates) {
    if(!value||typeof value!=='object')continue;
    if(!['identity_confirmed','callback_requested','needs_human_followup'].every(key=>typeof value[key]==='boolean'))continue;
    if(!['completed','not_completed','unclear'].includes(value.task_status)||!reasons.has(value.reason)||!['resolve','remind_later','human_followup'].includes(value.next_action))continue;
    if(!['intent','summary'].every(key=>typeof value[key]==='string'&&value[key].trim().length>0&&value[key].length<=10000))continue;
    if(value.time_preference!==null&&(typeof value.time_preference!=='string'||!value.time_preference.trim()||value.time_preference.length>200))continue;
    return Object.fromEntries(['identity_confirmed','task_status','reason','intent','callback_requested','needs_human_followup','next_action','summary','patient_quote','time_preference','consent_confirmed','evidence'].map(key=>[key,value[key]]));
  }
  return null;
}
export function applyOutcome(db,call,payload,verification=null,modelRisk=null) {
  const task=db.tasks.find(task=>task.id===call.task_id);
  const report=payload?.result?.extracted?.conversation_result;
  const decision=report?gateConversation(report,payload.result.transcript,task,verification,payload.status,{requireModelRisk:call.provider==='calle'&&task.care_program==='breast',modelRisk}):gateOutcome(extractResult(payload),payload?.result?.transcript,task.patient,payload.status,task.care_type||task.type);
  if(task.care_program==='breast'&&!decision.risk)decision.risk=call.provider==='calle'?unavailableModelRisk(task):evaluateBreastRisk(null,{oncology:task.oncology_context},task.clinical_protocol);
  if(report){call.conversation_report=decision.report;call.semantic_verification=verification;call.report_verified=decision.gate.status==='PASSED';if(decision.stop_contact){const person=db.patients?.find(p=>p.id===task.patient_id);if(person){person.auto_followup=false;person.authorization=null;person.revision=(person.revision||0)+1;}for(const pending of (db.calls||[]).filter(c=>c.state==='SCHEDULED'&&db.tasks.find(t=>t.id===c.task_id)?.patient_id===task.patient_id)){pending.state='FINISHED';pending.status='CANCELED';pending.error='Patient requested contact to stop.';}}}
  if(decision.risk){call.risk_assessment=decision.risk;task.risk_level=decision.risk.level;task.safety_hold=['RED','YELLOW'].includes(decision.risk.level);if(task.safety_hold){const p=db.patients?.find(p=>p.id===task.patient_id);if(p)p.safety_hold=true;for(const pending of (db.calls||[]).filter(c=>c.state==='SCHEDULED'&&db.tasks.find(t=>t.id===c.task_id)?.patient_id===task.patient_id)){pending.state='FINISHED';pending.status='CANCELED';pending.error='Breast care review required before another contact.';const other=db.tasks.find(t=>t.id===pending.task_id);delete other.call_id;other.plan.status='WAITING_CLINICIAN';}}}
  if(decision.risk&&call.report_verified&&decision.risk.level!=='UNKNOWN'){const p=db.patients?.find(p=>p.id===task.patient_id);if(p?.oncology){p.oncology.last_followup={date:(call.updated_at||new Date().toISOString()).slice(0,10),issues:[decision.report.care_summary]};p.revision=(p.revision||0)+1;}}
  const result=decision.result;call.result=result;call.gate=decision.gate;
  if(decision.routing==='UNRESOLVED'){
    call.routing='UNRESOLVED';task.status='UNRESOLVED';call.unresolved_reason=decision.gate.reason;
    call.error='A completed call is not a resolved care task. '+decision.gate.reason.replaceAll('_',' ')+'. Human verification required.';
    return;
  }
  // Clinical concern takes precedence even over a contradictory completion flag.
  if(decision.routing==='HUMAN_REVIEW'){
    result.needs_human_followup=true;result.next_action='human_followup';task.status='HUMAN_REVIEW';call.routing='HUMAN_REVIEW';call.review_id=`review-${call.id}`;
    if(!db.reviews.some(item=>item.id===call.review_id))db.reviews.push({id:call.review_id,task_id:task.id,call_id:call.id,status:'OPEN',patient_quote:result.patient_quote,summary:result.summary,reason:result.reason,delivery:'LOCAL_QUEUE_ONLY',priority:decision.risk?.level||'YELLOW',rule_triggers:decision.risk?.triggers||[]});
  }else if(result.task_status==='completed'&&result.next_action==='resolve'){
    task.status='COMPLETED';task.completion_source='PATIENT_CALL';call.routing='COMPLETED';
    closeConfirmedParents(db,task,call.updated_at||new Date().toISOString(),'PATIENT_CALL');
  }else if(result.followup_required||result.task_status==='not_completed'&&result.intent==='will_complete_later'&&result.next_action==='remind_later'){
    task.status='WILL_DO_LATER';call.routing='WILL_DO_LATER';call.followup_id=`followup-${call.id}`;
    const child=ensureFollowup(db,task,call.followup_id,result.time_preference);if(report){child.plan={status:'NEEDS_PLAN',call_at:null,policy:'AI will plan the next contact from this conversation and the original instruction.'};child.scheduling_status='PLANNING';child.prior_findings=decision.report;}
  }else{
    task.status='UNRESOLVED';call.routing='UNRESOLVED';call.error='The result needs review. No completion or reminder time was inferred.';
  }
}
