import {requiredTopics,DRAFT_PROTOCOL} from './breast/protocol.mjs';
import {unavailableModelRisk} from './breast/model-risk.mjs';
import {breastSchema} from './breast/schema.mjs';
import {checkBreastReport} from './breast/validation.mjs';
import {evaluateBreastRisk} from './breast/risk.mjs';
import {parseTurns} from './outcome-gate.mjs';
import {withinWindow,localStamp,localToInstant} from './contact-time.mjs';
import {conversationSchema} from './conversation-schema.mjs';
// Validate the actual schema at the trust boundary, not merely provider compliance.
function shape(value,schema){
 if(schema.type==='object')return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>k in schema.properties)&&schema.required.every(k=>shape(value[k],schema.properties[k]));
 if(schema.type==='array')return Array.isArray(value)&&value.length<=40&&value.every(v=>shape(v,schema.items));
 if(schema.type==='integer')return Number.isInteger(value);
 if(schema.type==='boolean')return typeof value==='boolean';
 return typeof value==='string'&&value.length<=6000&&(!schema.enum||schema.enum.includes(value));
}
export function checkConversation(raw,transcript,task){
 const issues=[];const turns=parseTurns(transcript);if(!shape(raw,raw?.schema_version==='3'?breastSchema:conversationSchema))return {ok:false,issues:['INVALID_STRUCTURE']};
 const exact=(items,speaker='patient')=>items.every(e=>turns[e.turn_index]?.speaker===speaker&&turns[e.turn_index].text===e.quote&&!!e.quote.trim());
 const c=raw.conversation;if(!exact(c.identity_evidence)||!exact(c.consent_evidence)||c.identity==='confirmed'&&!c.identity_evidence.length||c.consent==='agreed'&&!c.consent_evidence.length)issues.push('IDENTITY_OR_CONSENT_EVIDENCE');
 const identityEnd=Math.max(-1,...c.identity_evidence.map(e=>e.turn_index));const consentEnd=Math.max(-1,...c.consent_evidence.map(e=>e.turn_index));
 if(c.consent==='agreed'&&Math.min(...c.consent_evidence.map(e=>e.turn_index))<=identityEnd)issues.push('CONSENT_ORDER');
 const groups=[...raw.instruction_results,...raw.patient_reports,...raw.patient_requests,...raw.open_questions,raw.review,raw.contact_preference];
 for(const item of groups){if(!exact(item.evidence)||item.evidence.some(e=>e.turn_index<=consentEnd))issues.push('SOURCE_MISMATCH');}
 const instruction=task.order?.instruction||task.task;
 const protocolQuotes=raw.schema_version==='3'?requiredTopics({oncology:task.oncology_context,reference_at:task.contact_reference_at},task.clinical_protocol||DRAFT_PROTOCOL).map(x=>x[1]):[];
 if(!raw.instruction_results.length)issues.push('NO_INSTRUCTION_COVERAGE');
 for(const r of raw.instruction_results){if(!r.order_quote.trim()||!(instruction.includes(r.order_quote)||protocolQuotes.includes(r.order_quote)))issues.push('INVENTED_INSTRUCTION');if(r.completion_state==='previously_confirmed'&&!task.prior_findings?.instruction_results?.some(p=>p.order_quote===r.order_quote&&['completed','previously_confirmed'].includes(p.completion_state)))issues.push('UNVERIFIED_PRIOR_COMPLETION');if(['completed','not_completed','partially_completed'].includes(r.completion_state)&&!r.evidence.length)issues.push('MISSING_RESULT_EVIDENCE');}
 if([...raw.patient_reports,...raw.patient_requests].some(x=>!x.evidence.length))issues.push('MISSING_REPORT_EVIDENCE');
 if(!exact(raw.contact_preference.proposal_evidence,'agent'))issues.push('CONTACT_PROPOSAL_MISMATCH');
 if(raw.contact_preference.agreement_state!=='none'&&!raw.contact_preference.evidence.length)issues.push('MISSING_CONTACT_EVIDENCE');
 if(raw.schema_version==='3')issues.push(...checkBreastReport(raw,transcript,task));
 return {ok:!issues.length,issues:[...new Set(issues)]};
}
export function verifiedAgreement(report,verification,now,person){
 const p=report?.contact_preference;if(p?.agreement_state!=='agreed'||verification?.contact_agreement_valid!==true||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(p.at))return null;
 const time=Date.parse(p.at);if(!Number.isFinite(time)||time<=Date.parse(now)||time>Date.parse(now)+7*86400000||!withinWindow(p.at,person))return null;
 try{localToInstant(localStamp(p.at,person.timezone),person.timezone);}catch{return null;}
 return {at:new Date(time).toISOString(),timezone:person.timezone,patient_evidence:p.evidence[0],proposal_evidence:p.proposal_evidence[0]||null};
}
export function gateConversation(raw,transcript,task,verification,status='COMPLETED',options={}){
 const checked=checkConversation(raw,transcript,task);let routing='UNRESOLVED';let reason='SEMANTIC_VERIFICATION_REQUIRED';
 const reports=checked.ok?raw.patient_reports:[];const requests=checked.ok?raw.patient_requests:[];
 const verified=checked.ok&&verification?.supported===true&&verification?.coverage_complete===true&&verification?.identity_valid===true&&verification?.consent_valid===true;
 const clinical=raw?.review?.required===true||reports.some(x=>x.reason==='side_effect_concern')||requests.some(x=>['clinician_contact','explanation'].includes(x.kind))||verification?.needs_review===true;
 const stop=requests.some(x=>x.kind==='stop_contact')||verification?.stop_contact===true||raw?.conversation?.ending==='patient_stopped';
 if(!checked.ok)reason=checked.issues.join(', ');
 else if(status!=='COMPLETED')reason='CALL_FAILED';
 else if(verified&&raw.conversation.identity==='confirmed'&&raw.conversation.consent==='agreed'){
  if(clinical)routing='HUMAN_REVIEW';
  else if(stop)reason='CONTACT_STOPPED';
  else if(raw.conversation.ending!=='completed')reason='CONVERSATION_INCOMPLETE';
  else if(raw.instruction_results.some(x=>x.completion_state==='unclear')||raw.open_questions.some(x=>['unclear','contradictory'].includes(x.cause)))reason='AMBIGUOUS';
  else if(raw.instruction_results.every(x=>['completed','previously_confirmed'].includes(x.completion_state))&&!raw.open_questions.length&&!raw.patient_requests.length)routing='COMPLETED';
  else routing='WILL_DO_LATER'; // Outstanding administrative work enters planning even without a spoken time.
 }
 const risk=options.requireModelRisk?(options.modelRisk||unavailableModelRisk(task)):raw?.schema_version==='3'||task.care_program==='breast'?evaluateBreastRisk(checked.ok?raw:null,{oncology:task.oncology_context,reference_at:task.contact_reference_at},task.clinical_protocol,{verified:verification?.supported===true,complete:verified&&raw.conversation.identity==='confirmed'&&raw.conversation.consent==='agreed'&&status==='COMPLETED'&&raw.conversation.ending==='completed'&&!stop&&!verification?.needs_review&&!raw.open_questions.length}):null;
 if(options.requireModelRisk){routing=risk.routing;if(routing==='UNRESOLVED')reason='MODEL_RISK_REQUIRES_VERIFICATION';}
 if(risk){if(['RED','YELLOW'].includes(risk.level))routing='HUMAN_REVIEW';else if(risk.level==='UNKNOWN'){routing='UNRESOLVED';reason='PROTOCOL_INFORMATION_INCOMPLETE';}else if(!verified){routing='UNRESOLVED';reason='SEMANTIC_VERIFICATION_REQUIRED';}}
 if(risk&&task.patient_context?.issues?.length){risk.missing.push(...task.patient_context.issues);if(risk.level==='GREEN'){risk.level='UNKNOWN';risk.action='verify_information';routing='UNRESOLVED';reason='PATIENT_RECORDS_REQUIRE_VERIFICATION';}}
 const quote=risk?.triggers.flatMap(t=>t.evidence)[0]||(checked.ok?[...raw.patient_reports,...raw.patient_requests,...raw.instruction_results].flatMap(x=>x.evidence)[0]:null);
 const result={identity_confirmed:verified,consent_confirmed:verified,task_status:verified?(raw.instruction_results.every(x=>['completed','previously_confirmed'].includes(x.completion_state))?'completed':raw.instruction_results.some(x=>['not_completed','partially_completed'].includes(x.completion_state))?'not_completed':'unclear'):'unclear',reason:reports.find(x=>x.reason!=='unknown')?.reason||'unknown',intent:reports.some(x=>x.kind==='intention')?'will_complete_later':'unknown',callback_requested:requests.some(x=>x.kind==='clinician_contact')||false,needs_human_followup:(options.requireModelRisk?routing==='HUMAN_REVIEW':clinical)||routing==='UNRESOLVED',next_action:routing==='COMPLETED'?'resolve':routing==='WILL_DO_LATER'?'remind_later':'human_followup',summary:verified?raw.care_summary:'Conversation requires verification. Proposed findings are retained below.',patient_quote:quote?.quote||null,time_preference:checked.ok?raw.contact_preference.wording||null:null,evidence:{},followup_required:routing==='WILL_DO_LATER'};
 return {result,routing,risk,report:checked.ok?raw:null,stop_contact:stop,gate:{version:2,status:verified?'PASSED':'UNRESOLVED',reason:routing==='UNRESOLVED'?reason:null,issues:checked.issues,semantic:verification||null,fields:Object.fromEntries(['task_status','reason','intent'].map(key=>[key,{value:result[key],evidence:verified?(key==='task_status'?raw.instruction_results.find(x=>x.evidence.length)?.evidence[0]:reports.find(x=>key==='reason'?x.reason===result.reason:x.kind==='intention')?.evidence[0])||null:null,issue:verified?null:'SEMANTIC_VERIFICATION_REQUIRED'}])),alerts:[]}};
}
