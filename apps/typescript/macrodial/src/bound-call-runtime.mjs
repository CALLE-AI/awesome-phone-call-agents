const REQUIRED_DIALOGUE_FIELDS = Object.freeze(["opening","known_context","time_presentation","repetition_control","voicemail","clarification","uncertainty","escalation","closing","completion"]);
const AUTHORITY_FIELDS = Object.freeze(["collect_preferences","record_outcome","schedule_appointment","reschedule_appointment","cancel_appointment","offer_discount","quote_price","commit_technician_eta"]);

const fail=(code,message)=>Object.assign(new Error(message),{code,status:422});
const list=value=>Array.isArray(value)?value.map(item=>String(item).trim()).filter(Boolean):[];
const line=(label,value)=>`${label}: ${value}`;

export function restrictiveAuthority(value={}){
  const source=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  return Object.fromEntries(AUTHORITY_FIELDS.map(key=>[key,source[key]===true]));
}

export function validatePlaybookBinding({notification,playbooks,dialogueDefaults}){
  const playbookId=String(notification?.playbook_id||"").trim().toUpperCase();
  if(!playbookId)throw fail("PLAYBOOK_BINDING_REQUIRED","This notification has no Playbook assignment. Assign an active compatible Playbook before calling.");
  const playbook=(playbooks||[]).find(item=>item.playbook_id===playbookId);
  if(!playbook)throw fail("PLAYBOOK_NOT_FOUND",`Assigned Playbook ${playbookId} does not exist.`);
  if(playbook.active!==true)throw fail("PLAYBOOK_INACTIVE",`Assigned Playbook ${playbookId} is inactive.`);
  if(!playbook.workflow_call_code)throw fail("PLAYBOOK_WORKFLOW_UNBOUND",`Playbook ${playbookId} has no explicit Call Code compatibility binding.`);
  if(playbook.workflow_call_code!==notification.call_code)throw fail("PLAYBOOK_INCOMPATIBLE",`Playbook ${playbookId} is configured for ${playbook.workflow_call_code}, not ${notification.call_code}.`);
  if(!Number.isInteger(Number(playbook.version))||Number(playbook.version)<1)throw fail("PLAYBOOK_VERSION_INVALID",`Playbook ${playbookId} has no valid governed version.`);
  if(notification.playbook_version!=null&&Number(notification.playbook_version)!==Number(playbook.version))throw fail("PLAYBOOK_VERSION_MISMATCH",`Notification requires ${playbookId} v${notification.playbook_version}, but v${playbook.version} is stored.`);
  if(!playbook.authority||typeof playbook.authority!=="object"||Array.isArray(playbook.authority)||AUTHORITY_FIELDS.some(field=>typeof playbook.authority[field]!=="boolean"))throw fail("PLAYBOOK_AUTHORITY_INVALID",`Playbook ${playbookId} has no complete authority contract.`);
  for(const field of ["objective","opening_guidance","tone"]){if(!String(playbook[field]||"").trim())throw fail("PLAYBOOK_VALIDATION_FAILED",`Playbook ${playbookId} is missing ${field}.`)}
  for(const field of ["allowed_actions","guardrails","stop_conditions","allowed_outcomes"]){if(!list(playbook[field]).length)throw fail("PLAYBOOK_VALIDATION_FAILED",`Playbook ${playbookId} is missing ${field}.`)}
  const mappings=playbook.outcome_state_transitions;if(!mappings||typeof mappings!=="object"||Array.isArray(mappings)||list(playbook.allowed_outcomes).some(outcome=>!String(mappings[outcome]||"").trim()))throw fail("PLAYBOOK_OUTCOME_MAPPING_INVALID",`Playbook ${playbookId} has incomplete outcome-to-state mappings.`);
  const dialogue={};for(const field of REQUIRED_DIALOGUE_FIELDS){dialogue[field]=String(dialogueDefaults?.[field]||"").trim();if(!dialogue[field])throw fail("DIALOGUE_POLICY_INVALID",`Runtime dialogue policy ${field} is missing.`)}
  return{playbook:{...playbook,authority:restrictiveAuthority(playbook.authority)},dialogue};
}

export function compileBoundCall({notification,customer,playbook,dialogue,businessName}){
  const business=String(businessName||"").trim();if(!business)throw fail("BUSINESS_IDENTITY_REQUIRED","Business identity is required before Playbook calls can run.");
  const starts=new Date(notification.appointment?.starts_at),timezone=notification.appointment?.timezone||"America/New_York";
  if(!Number.isFinite(starts.getTime()))throw fail("APPOINTMENT_CONTEXT_INVALID","Appointment time is invalid.");
  let naturalTime;try{naturalTime=new Intl.DateTimeFormat("en-US",{timeZone:timezone,dateStyle:"full",timeStyle:"short"}).format(starts)}catch{throw fail("APPOINTMENT_CONTEXT_INVALID","Appointment timezone is invalid.")}
  const authority=Object.entries(playbook.authority).map(([key,value])=>`${key}=${value?"ALLOWED":"NOT_ALLOWED"}`).join("; ");
  const task=[
    "MACRODIAL GOVERNED CALL — FOLLOW THIS CONFIGURATION EXACTLY",
    line("BUSINESS",business),line("PLAYBOOK",`${playbook.playbook_id} v${playbook.version||1}`),line("WORKFLOW",notification.call_code),line("TONE",playbook.tone),
    line("OBJECTIVE",playbook.objective),line("AUTHORITY",authority),
    "KNOWN CONTEXT (do not ask the customer to repeat known facts)",line("Customer",`${customer.name} (${customer.customer_id})`),line("Service",notification.service_code),line("Appointment",`${naturalTime} (${timezone})`),line("Technician",notification.appointment?.technician_name||"Not supplied"),
    "BUSINESS-AWARE OPENING",playbook.opening_guidance,
    "DIALOGUE HARDENING",...REQUIRED_DIALOGUE_FIELDS.map(field=>line(field.toUpperCase(),dialogue[field])),
    "ALLOWED ACTIONS",...list(playbook.allowed_actions).map(item=>`- ${item}`),
    "PROHIBITED / NON-FABRICATION RULES",...list(playbook.guardrails).map(item=>`- ${item}`),
    "STOP CONDITIONS",...list(playbook.stop_conditions).map(item=>`- ${item}`),
    line("VALID OUTCOMES",list(playbook.allowed_outcomes).join(", ")),
    "Return exactly one validated outcome_code. MacroDial—not the model—maps that outcome to persisted State."
  ].join("\n");
  const birthday=notification.call_code==="BIRTHDAY_OUTREACH";
  const resultSchema={type:"object",additionalProperties:false,required:["outcome_code","customer_reached","summary",...(birthday?["birthday_outcome","follow_up_required","preferred_follow_up_time"]:[])],properties:{outcome_code:{type:"string",enum:list(playbook.allowed_outcomes)},customer_reached:{type:"boolean"},summary:{type:"string"},...(birthday?{birthday_outcome:{type:"string",enum:["interested","not_interested","follow_up_requested","no_answer","voicemail","other"]},follow_up_required:{type:"boolean"},preferred_follow_up_time:{type:["string","null"],enum:["morning","afternoon","evening",null]}}:{})}};
  return{task,result_schema:resultSchema,natural_time:naturalTime};
}

export function resolveOutcomeTransition({result,playbook,state}){
  const outcome=String(result?.outcome_code||"").trim().toUpperCase();
  if(!playbook.allowed_outcomes.includes(outcome))throw fail("CALL_OUTCOME_INVALID",`CALL-E outcome ${outcome||"(missing)"} is not allowed by ${playbook.playbook_id}.`);
  const mapped=playbook.outcome_state_transitions?.[outcome];
  if(!mapped||!state.states?.some(item=>item.state===mapped))throw fail("OUTCOME_STATE_MAPPING_MISSING",`No valid MacroDial State mapping exists for ${outcome}.`);
  return{outcome_code:outcome,state:mapped};
}

export { REQUIRED_DIALOGUE_FIELDS, AUTHORITY_FIELDS };
