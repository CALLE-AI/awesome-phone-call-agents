// Deliberately conservative English demo protocol. Unrecognized wording abstains.
// Transcript labels and exact, whole-turn quotes are required; no model confidence is trusted.
import {contactAgreementStamp} from './care-followup.mjs';
export function parseTurns(transcript) {
  if(typeof transcript!=='string')return [];
  return transcript.split('\n').filter(line=>line.trim()).map((line,index)=>{
    const match=/^(CALL-E Agent|Agent|Patient)\s*:\s*(.*)$/i.exec(line);
    return {index,speaker:match?(/^Patient$/i.test(match[1])?'patient':'agent'):'unknown',text:match?match[2]:line};
  });
}
const uncertain=/\b(probably|maybe|perhaps|think|not sure|might|guess|can't remember|cannot remember)\b/i;
const singleQuestion=text=>(text.match(/\?/g)||[]).length===1&&!/\b(and|or)\b/i.test(text);
const affirmative=text=>/^(yes|yes,? of course|of course|yes,? i do|i agree)[.!]*$/i.test(text.trim());
const reported=text=>/\b(said|says|told|according to|my (husband|wife|roommate|mother|father))\b|["“”]/i.test(text);
const taskSubjects={Medication:/\b(medication|medicine|dose|pills?)\b/i,Mobility:/\b(exercises?|physiotherapy|mobility)\b/i,'Wound check':/\bwound\b/i,'Symptom check':/\b(symptom|recovery|check.in)\b/i,Appointment:/\b(appointment|clinic visit)\b/i};
const taskQuestion=(text,type)=>singleQuestion(text)&&(/\b(have|did) you\b.*\b(complet|tak|finish|do|check)/i.test(text)||type==='Appointment'&&/\b(can|will) you (attend|make)\b/i.test(text))&&!/\b(why|who|someone|husband|wife)\b/i.test(text)&&(taskSubjects[type]?.test(text)||/^have you completed (?:today['’]s |your |the )?(?:care |follow-up )?task\?$/i.test(text));
function completion(text,question='',type='Medication'){
  text=text.replaceAll('’',"'");
  if(uncertain.test(text)||reported(text)||/\?|\b(if|unless|provided|depending|yesterday|last week|last month)\b/i.test(text))return null;
  if(taskQuestion(question,type)&&/^(yes|yes,? i did|yes,? of course|of course)[.!]*$/i.test(text.trim()))return 'completed';
  if(taskQuestion(question,type)&&/^(no|not yet|no,? not yet)[.!]*$/i.test(text.trim()))return 'not_completed';
  const stripped=text.replace(/\bno side effects[.!]?/ig,'').replace(/\bi am not dizzy[.!]?/ig,'').trim();
  const no=/\b(i (haven't|have not|didn't|did not) (take|taken|complete)|i stopped taking|not yet)\b/i.test(stripped)||/^no[, .]+i (forgot|haven't|have not)/i.test(stripped);
  if(no)return 'not_completed';
  // Task-specific confirmations are interpreted only in their own care context.
  const specific={
    Appointment:{yes:/^(yes[,! ]+)?i (can|will) (attend|make) (my |the )?(follow.up )?(appointment|clinic visit)\b/i,no:/\bi (can't|cannot|won't|will not) (attend|make) (my |the )?(follow.up )?(appointment|clinic visit)\b/i},
    Mobility:{yes:/^(yes[,! ]+)?i (did|finished|have done|have finished) (my |the )?(prescribed )?(exercises|physiotherapy|exercise task)\b/i,no:/\bi (haven't|have not|didn't|did not) (do|done|finish) (my |the )?(prescribed )?(exercises|physiotherapy)\b/i},
    'Wound check':{yes:/^(yes[,! ]+)?i (checked|have checked) (my |the )?wound\b/i,no:/\bi (haven't|have not|didn't|did not) (check|checked) (my |the )?wound\b/i},
    'Symptom check':{yes:/^(yes[,! ]+)?i (finished|have finished|did) (my |the |today's )?(recovery |symptom )?check.in\b/i,no:/\bi (haven't|have not|didn't|did not) (do|done|finish) (my |the |today's )?(recovery |symptom )?check.in\b/i},
  }[type];
  if(specific?.no.test(stripped))return 'not_completed';
  if(specific?.yes.test(stripped)){if(/\bi (haven't|have not|didn't|did not) (do|done|finish|complete) (it|them|that)\b/i.test(stripped))return null;return 'completed';}
  if(/(?:^|[.!]\s*|\bbut\s+)(?:yes,?\s+)?i (took|have taken|completed|'ve taken)\b.*\b(today|this morning|task)\b/i.test(stripped))return 'completed';
  return null;
}
function clinicalAlerts(turns){
  const alerts=[];
  for(const turn of turns){
    if(turn.speaker!=='patient'||reported(turn.text))continue;
    const body=turn.text.replace(/\b(no side effects|not dizzy|don't feel dizzy|do not feel dizzy)\b/ig,'');
    if(/\b(i (feel|felt|am) (dizzy|unwell)|makes? me feel dizzy|made me feel dizzy|worried about side effects|having side effects)\b/i.test(body))alerts.push({code:'PATIENT_CONCERN',quote:turn.text,turn_index:turn.index});
    if(/\b(my|the) wound (is|looks|has become) (red|swollen|leaking|bleeding)\b|\bi (have|am having) (new |worsening )?(pain|bleeding|a fever)\b/i.test(body))alerts.push({code:'PATIENT_CONCERN',quote:turn.text,turn_index:turn.index});
    if(/\b(should i|can i)\b.*\b(take|dose|medication|stop)\b/i.test(body))alerts.push({code:'MEDICAL_QUESTION',quote:turn.text,turn_index:turn.index});
    if(/\b(can|could|please|want)\b.*\b(doctor|care team|clinician)\b.*\bcall\b/i.test(body))alerts.push({code:'CALLBACK_REQUEST',quote:turn.text,turn_index:turn.index});
  }
  return alerts;
}
function evidenceFor(raw,key,turns){
  const item=raw?.evidence?.[key];
  if(!item||!Number.isInteger(item.turn_index)||typeof item.quote!=='string')return null;
  const turn=turns[item.turn_index];
  if(!turn||turn.speaker!=='patient'||turn.text!==item.quote||!item.quote.trim())return null;
  return {quote:item.quote,turn_index:item.turn_index};
}
const supports={
  task_status:(value,text,question,type)=>completion(text,question,type)===value,
  reason:(value,text)=>{
    if(uncertain.test(text)||reported(text)||/\?/.test(text)||/\b(not dizzy|no side effects|didn't forget|did not forget)\b/i.test(text))return false;
    return ({forgot:/\b(i forgot|forgot to)\b/i,side_effect_concern:/\b(i (felt|feel) dizzy|made me feel dizzy|makes me feel dizzy|side effects? (worry|concern)|worried about side effects?)\b/i,cannot_access_medication:/\b(can't afford|cannot afford|ran out|cannot get|can't get)\b/i,does_not_understand_instruction:/\b(don't understand|do not understand)\b/i,does_not_want_to_take:/\b(don't want to take|do not want to take)\b/i})[value]?.test(text)===true;
  },
  intent:(value,text)=>value==='will_complete_later'&&!reported(text)&&!uncertain.test(text)&&!/\b(won't|will not|might not)\b/i.test(text)&&/\b(i'll|i will) (take|complete)\b/i.test(text),
  callback_requested:(value,text)=>value===true&&/\b(can|could|please|want)\b.*\b(doctor|care team|clinician)\b.*\bcall\b/i.test(text),
  needs_human_followup:(value,text)=>value===true&&(/\b(should i|can i)\b.*\b(take|dose|medication|stop)\b/i.test(text)||/\b(can|could|please|want)\b.*\b(doctor|care team|clinician)\b.*\bcall\b/i.test(text)),
};
export function gateOutcome(raw,transcript,patient='Emma',status='COMPLETED',taskType='Medication'){
  const turns=parseTurns(transcript);const alerts=clinicalAlerts(turns);const patientText=turns.filter(t=>t.speaker==='patient').map(t=>t.text).join('\n');
  const result={identity_confirmed:null,consent_confirmed:null,task_status:'unclear',reason:'unknown',intent:'unknown',callback_requested:null,needs_human_followup:raw?.reason==='side_effect_concern',next_action:'human_followup',summary:'Insufficient evidence. Human verification required.',patient_quote:null,time_preference:null,evidence:{}};
  const fields={};let unresolved=null;
  if(status!=='COMPLETED')unresolved=({NO_ANSWER:'NO_ANSWER',VOICEMAIL:'VOICEMAIL',DECLINED:'REFUSED'})[status]||'CALL_FAILED';
  // Reject call-level failure claims even when the provider labels the transport completed.
  if(/\b(voicemail|leave (a |your )?message|after the (beep|tone))\b/i.test(patientText)||turns.some(t=>t.speaker==='unknown'&&/voicemail|beep/i.test(t.text)))unresolved='VOICEMAIL';
  else if(/\b(roommate|her husband|her wife|wrong number|she('s| is) not here|answering service)\b/i.test(patientText))unresolved='WRONG_PERSON';
  else if(/\b(don't want to talk|do not want to talk|stop calling|refuse|do not consent)\b/i.test(patientText))unresolved='REFUSED';
  const identity=evidenceFor(raw,'identity_confirmed',turns);const identityTurn=identity&&turns[identity.turn_index];
  const question=identity&&turns[identity.turn_index-1];
  const escaped=patient.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const self=new RegExp(`^(I am|I'm|This is) ${escaped}[.!]*$`,'i');
  const asked=question?.speaker==='agent'&&singleQuestion(question.text)&&new RegExp(`(?:speaking with|are you) ${escaped}\\?`,'i').test(question.text);
  if(!unresolved&&raw?.identity_confirmed===true&&identity&&(self.test(identityTurn.text)||asked&&(affirmative(identityTurn.text)||self.test(identityTurn.text.replace(/^yes,?\s+/i,''))))){result.identity_confirmed=true;result.evidence.identity_confirmed=identity;}
  const consent=evidenceFor(raw,'consent_confirmed',turns);const consentQuestion=consent&&turns[consent.turn_index-1];
  if(result.identity_confirmed&&consent&&consent.turn_index>identity.turn_index&&raw?.consent_confirmed===true&&consentQuestion?.speaker==='agent'&&singleQuestion(consentQuestion.text)&&/agree to continue\?/i.test(consentQuestion.text)&&affirmative(consent.quote)){result.consent_confirmed=true;result.evidence.consent_confirmed=consent;}
  if(!unresolved&&!result.identity_confirmed)unresolved='IDENTITY_UNCONFIRMED';
  if(!unresolved&&!result.consent_confirmed)unresolved='CONSENT_UNCONFIRMED';
  // This can detect supported transcript protocol violations; it cannot prevent speech already made.
  if(!unresolved&&turns.some(t=>t.speaker==='agent'&&t.index<consent.turn_index&&/medication|prescribed|dose/i.test(t.text)))unresolved='PRIVACY_PROTOCOL_VIOLATION';
  for(const key of Object.keys(supports)){
    const item=evidenceFor(raw,key,turns);const previous=item&&turns[item.turn_index-1];
    const ok=!unresolved&&item&&item.turn_index>consent.turn_index&&previous?.speaker==='agent'&&singleQuestion(previous.text)&&supports[key](raw?.[key],item.quote,previous.text,taskType);
    const issue=ok?null:unresolved?'IDENTITY_OR_CALL_UNVERIFIED':!raw?.evidence?.[key]?'NO_EVIDENCE':!item?'SOURCE_MISMATCH':reported(item.quote)?'REPORTED_SPEECH':!previous||!singleQuestion(previous.text)?'QUESTION_CONTEXT':'MEANING_UNCLEAR';
    fields[key]={issue,proposed_value:raw?.[key]??null,proposed_evidence:raw?.evidence?.[key]?.quote??null,value:ok?raw[key]:key==='task_status'?'unclear':key==='reason'||key==='intent'?'unknown':null,evidence:ok?item:null};
    if(ok){result[key]=raw[key];result.evidence[key]=item;}
  }
  // All complete patient turns must agree on completion. Do not cherry-pick one Yes.
  const statuses=turns.filter(t=>t.speaker==='patient'&&consent&&t.index>consent.turn_index).flatMap(t=>['completed','not_completed'].filter(value=>supports.task_status(value,t.text,turns[t.index-1]?.text||'',taskType)));
  if(statuses.includes('completed')&&statuses.includes('not_completed')){result.task_status='unclear';delete result.evidence.task_status;fields.task_status={...fields.task_status,issue:'CONTRADICTORY_ANSWERS',value:'unclear',evidence:null};}
  let routing='UNRESOLVED';
  if(!unresolved){
    if(alerts.length||result.reason==='side_effect_concern'||fields.needs_human_followup.value===true||result.callback_requested===true){routing='HUMAN_REVIEW';result.needs_human_followup=true;}
    else if(raw?.reason==='side_effect_concern'||raw?.needs_human_followup===true)unresolved='INSUFFICIENT_EVIDENCE';
    else if(uncertain.test(patientText)||result.task_status==='unclear')unresolved='AMBIGUOUS';
    else if(result.task_status==='completed')routing='COMPLETED';
    else if(result.task_status==='not_completed'&&result.intent==='will_complete_later')routing='WILL_DO_LATER';
    else unresolved='INSUFFICIENT_EVIDENCE';
  }
  const preference=evidenceFor(raw,'time_preference',turns);
  if(routing==='WILL_DO_LATER'&&preference&&typeof raw.time_preference==='string'&&raw.time_preference.trim()&&preference.turn_index===result.evidence.intent.turn_index&&preference.quote.includes(raw.time_preference)){result.time_preference=raw.time_preference;result.evidence.time_preference=preference;}
  if(routing==='WILL_DO_LATER'&&preference&&preference.turn_index>consent.turn_index&&turns[preference.turn_index-1]?.speaker==='agent'&&(turns[preference.turn_index-1].text.match(/\?/g)||[]).length===1&&/\b(call|contact)\b/i.test(turns[preference.turn_index-1].text)&&contactAgreementStamp(preference.quote)){
    result.time_preference=preference.quote;result.evidence.time_preference=preference;
  }
  result.next_action=routing==='COMPLETED'?'resolve':routing==='WILL_DO_LATER'?'remind_later':'human_followup';
  result.patient_quote=alerts[0]?.quote||result.evidence.reason?.quote||result.evidence.needs_human_followup?.quote||result.evidence.callback_requested?.quote||result.evidence.task_status?.quote||null;
  result.summary=routing==='UNRESOLVED'?'Conversation remains unresolved. Human verification required.':routing==='HUMAN_REVIEW'?'Evidence supports care-team review.':routing==='COMPLETED'?'Patient explicitly confirmed task completion.':'Patient reported noncompletion and a plan to act later.';
  return {result,gate:{version:1,status:routing==='UNRESOLVED'?'UNRESOLVED':'PASSED',reason:unresolved,alerts,fields},routing};
}
