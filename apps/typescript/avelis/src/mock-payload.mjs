export function mockPayload(runId,response='forgot') {
  if(response==='no_answer')return {run_id:runId,status:'NO_ANSWER',activity:[],result:{transcript:null}};
  const human=response==='side_effect';const completed=response==='completed';
  const quote=human?'I stopped taking it because it made me feel dizzy.':completed?"Yes, I completed today's medication task.":"No, I haven't taken it today. I forgot. I'll take it after dinner.";
  const result={identity_confirmed:true,task_status:completed?'completed':'not_completed',reason:human?'side_effect_concern':completed?'unknown':'forgot',intent:human?'stopped_due_to_concern':completed?'already_completed':'will_complete_later',callback_requested:false,needs_human_followup:human,next_action:human?'human_followup':completed?'resolve':'remind_later',summary:human?'Patient reports stopping medication because of dizziness. Human follow-up is needed.':completed?'Patient confirmed completing the task.':'Patient forgot and intends to complete the task after dinner.',patient_quote:quote,time_preference:human||completed?null:'After dinner'};
  const reply=human?"Thank you for telling me. I'll record this for human follow-up. I cannot give medication advice or make medical decisions.":completed?'Thank you for confirming.':"Thank you. I'll record your plan and create a follow-up task.";
  const identity="Yes, this is Emma.";const consent="Yes.";
  const lines=['CALL-E Agent: May I confirm I am speaking with Emma?',`Patient: ${identity}`,'CALL-E Agent: Do you agree to continue?',`Patient: ${consent}`,'CALL-E Agent: Have you completed today’s medication task?',`Patient: ${quote}`];
  result.consent_confirmed=true;
  result.evidence={identity_confirmed:{quote:identity,turn_index:1},consent_confirmed:{quote:consent,turn_index:3},task_status:{quote,turn_index:5},reason:{quote,turn_index:5},intent:{quote,turn_index:5},time_preference:{quote,turn_index:5}};
  // Preserve the patient's exact casing in a supported preference.
  result.time_preference=human||completed?null:'after dinner';
  if(['voicemail','wrong_person','refused','ambiguous'].includes(response)){
    const texts={voicemail:'Please leave a message after the beep.',wrong_person:"She is not here, I am her roommate.",refused:"I don't want to talk to an AI.",ambiguous:'I think I probably did.'};
    if(response==='voicemail')lines.splice(0,lines.length,`Patient: ${texts[response]}`);
    else if(response==='wrong_person')lines.splice(1,lines.length-1,`Patient: ${texts[response]}`);
    else if(response==='refused')lines.splice(3,lines.length-3,`Patient: ${texts[response]}`);
    else lines[5]=`Patient: ${texts[response]}`;
    result.summary='No reliable care-task answer was established.';for(const key of ['task_status','reason','intent'])result.evidence[key]={quote:texts[response],turn_index:5};
    result.task_status='completed';result.reason='unknown';result.intent='unknown';result.time_preference=null;
  }
  lines.push(`CALL-E Agent: ${['voicemail','wrong_person','refused','ambiguous'].includes(response)?'Thank you. I will leave this unresolved for review.':reply}`);
  return {run_id:runId,status:'COMPLETED',activity:[],result:{summary:result.summary,extracted:{care_result:result},transcript:lines.join('\n')}};
}
