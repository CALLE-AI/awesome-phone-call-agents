// Illustrative protocol for fictional-patient demos. Not an approved clinical SOP.
export const PHASES={post_op:'Post-operative recovery',chemotherapy:'Chemotherapy',radiotherapy:'Radiotherapy',endocrine_therapy:'Endocrine therapy',systemic_therapy:'Targeted / other systemic therapy',survivorship:'Long-term follow-up'};
export const COMMON=[
 ['emergency.breathing','Are you having severe difficulty breathing right now?'],['emergency.awareness','Have you had any new confusion or difficulty staying awake?'],['emergency.chest_pain','Are you having severe chest pain right now?'],
 ['overall','Since your last follow-up, how have you been overall? Have you noticed anything new or getting worse?'],
 ['treatment.execution','How is the current treatment plan going? Have any doses or appointments been missed, stopped or changed?'],
 ['screen.breast_change','Have you noticed a new lump or change in the breast, chest wall, armpit or collarbone area?'],
 ['screen.persistent_symptoms','Any new symptoms that are persisting or getting worse, such as pain, a cough, breathing changes, headaches or unexpected weight changes?'],
 ['visits.plan','Is your recorded next appointment still arranged, or has anything changed?'],
 ['qol.impact','How are sleep, eating, day-to-day activities and your mood? Have symptoms made any of these difficult?']
];
export const BRANCHES={
 post_op:[['post_op.wound','How is the wound: any redness, swelling, discharge, bleeding or increasing pain?'],['post_op.infection','Have you had fever or chills?'],['post_op.arm','Any arm swelling, tightness, pain or difficulty moving it?'],['post_op.rehab','How are the arm activities or rehabilitation exercises in your existing care plan going?']],
 chemotherapy:[['chemo.fever','Have you had fever, chills or other signs of infection?'],['chemo.gastrointestinal','Any nausea, vomiting, diarrhoea or trouble eating or drinking?'],['chemo.mouth','Any mouth sores affecting eating or drinking?'],['chemo.bleeding_fatigue','Any unusual bleeding, bruising or marked tiredness?'],['chemo.neuropathy','Any numbness or tingling in your hands or feet?'],['chemo.cycle','Has the last or next chemotherapy cycle changed from the recorded plan?']],
 radiotherapy:[['radio.skin','How is the treated skin: any redness, pain, peeling or broken areas?'],['radio.pain_fatigue','Any pain or tiredness that has changed?'],['radio.breathing','Any new cough or shortness of breath?'],['radio.attendance','Have the planned radiotherapy sessions gone ahead?']],
 endocrine_therapy:[['endocrine.adherence','Are you still taking the prescribed endocrine treatment? Any missed doses or stopping it?'],['endocrine.effects','How have hot flashes, sleep, joints, mood or vaginal symptoms changed?'],['endocrine.bleeding','Have you had any unusual vaginal bleeding or spotting?']],
 systemic_therapy:[['systemic.regimen','Are you following the recorded treatment plan, or have any treatments been delayed or stopped?'],['systemic.effects','Have you noticed any new or worsening symptoms since your treatment?']],
 survivorship:[['survivorship.changes','Since your last review, are there any new or persistent changes you want the breast care team to know about?'],['survivorship.screening','Have the follow-up examinations already arranged by your team been booked or completed?']]
};
export const SYMPTOM_FIELDS=['onset','duration','severity','trend','frequency','associated','functional_impact','red_flags'];
export const SYMPTOM_EXTRA={pain:['location'],fever:['temperature_c','last_treatment','chills'],breathing:['at_rest'],arm_swelling:['side','distribution','redness','warmth','pain','movement'],bleeding:['location'],hot_flash:['sleep_impact'],adherence:['missed_frequency','reason'],other:['description']};
export const DRAFT_PROTOCOL={id:'breast-demo',version:'1',review_state:'DRAFT',reviewed_by:null,reviewed_at:null,label:'Breast cancer follow-up · Demo protocol, clinical review pending',branches:BRANCHES,common:COMMON,
 routine_days:{post_op:14,chemotherapy:7,radiotherapy:7,endocrine_therapy:30,systemic_therapy:14,survivorship:90},
 // No numerical clinical threshold is invented. A hospital can define this in a draft.
 fever_threshold_c:null,
 emergency_text:'Demo Simulation: routine questions stop here. The hospital emergency pathway would be activated; no emergency service or care team has been contacted by this demo.',
 clinician_text:'Your reported concerns will be recorded for the care team to review. I cannot change treatment instructions or promise when they will contact you.',
 max_followup_calls:2,live_turn_control_verified:false,regimen_questions:[]};
export function phasesOf(person){return person?.oncology?.current_treatment?.phases||[];}
export function requiredTopics(person,protocol=DRAFT_PROTOCOL){const seen=new Set();return [...protocol.common,...(person?.reference_at&&person?.oncology?.next_visit&&person.oncology.next_visit<person.reference_at.slice(0,10)?[['visits.attended','The recorded visit date has passed. Did you attend, or is it still outstanding?']]:[]),...phasesOf(person).flatMap(p=>protocol.branches[p]||[]),...(protocol.regimen_questions||[]).filter(q=>q.regimen===person?.oncology?.current_treatment?.drug&&(!q.phase||phasesOf(person).includes(q.phase))).map(q=>[q.code,q.question])].filter(([code])=>!seen.has(code)&&seen.add(code));}
export function liveBreastReadiness(person,protocol){
 if(!person?.oncology||!phasesOf(person).length)return 'Breast cancer context and treatment phase must be recorded.';
 if(!protocol||protocol.review_state!=='APPROVED'||!protocol.reviewed_by||!protocol.reviewed_at)return 'Hospital protocol approval is required. Current protocol is a demo draft.';
 if(!protocol.live_turn_control_verified)return 'Real-time emergency interruption has not been verified for this telephone integration.';
 return null;
}
// Keep stable topic identifiers for evidence/risk routing while editing draft wording.
export function prepareProtocolDraft(p){
 if(!p||typeof p!=='object')throw Error('Open the protocol editor and try again.');
 const topicList=(rows,baseline,label,category)=>{
  if(!Array.isArray(rows)||rows.length>40||new Set(rows.map(r=>r?.[0])).size!==rows.length)throw Error(label+': use at most 40 unique questions.');
  if(category==='general'&&COMMON.filter(([code])=>code.startsWith('emergency.')).some(([code])=>!rows.some(r=>r?.[0]===code)))throw Error('Emergency safety checks must be retained.');
  return rows.map((row,i)=>{if(!Array.isArray(row)||row.length!==2||!baseline.some(([code])=>code===row[0])&&!new RegExp('^custom\\.'+category+'_[a-z0-9_]+$').test(row[0]))throw Error(label+': invalid question identifier.');if(typeof row[1]!=='string'||!row[1].trim()||row[1].trim().length>500)throw Error(label+' — question '+(i+1)+': enter 1–500 characters.');return [row[0],row[1].trim()];});
 };
 const common=topicList(p.common??COMMON,COMMON,'General follow-up','general');
 const branches=Object.fromEntries(Object.entries(BRANCHES).map(([phase,baseline])=>[phase,topicList(p.branches?.[phase]??baseline,baseline,PHASES[phase],phase)]));
 const rows=p.regimen_questions??[];if(!Array.isArray(rows)||rows.length>20)throw Error('Add at most 20 treatment-specific questions.');
 const used=new Set(),reserved=new Set(rows.map(q=>q?.code).filter(c=>/^regimen\.[a-z0-9_]+$/.test(c)));let sequence=1;
 const regimen_questions=[];
 for(const [i,q] of rows.entries()){
  if(!q||typeof q!=='object')throw Error('Additional question '+(i+1)+': enter a treatment name and question.');
  const regimen=typeof q.regimen==='string'?q.regimen.trim():'',question=typeof q.question==='string'?q.question.trim():'';
  if(!regimen&&!question)continue;
  if(!regimen||regimen.length>200)throw Error('Additional question '+(i+1)+': enter a treatment name (up to 200 characters).');
  if(!question||question.length>500)throw Error('Additional question '+(i+1)+': enter the question (up to 500 characters).');
  let code=q.code;if(!/^regimen\.[a-z0-9_]+$/.test(code)||used.has(code)){do{code='regimen.question_'+sequence++;}while(reserved.has(code)||used.has(code));}
  if(q.phase&&!Object.hasOwn(PHASES,q.phase))throw Error('Choose a valid treatment phase.');
  used.add(code);regimen_questions.push({code,regimen,question,...(q.phase?{phase:q.phase}:{})});
 }
 return {...p,common,branches,regimen_questions};
}
export function saveProtocolDraft(db,input,actor,now){
 db.audit_log ||= [];const prior=db.audit_log.find(a=>a.id===input.id);if(prior){if(prior.request!==JSON.stringify(input))throw Error('Request ID already used.');return;}
 if(!input.id||input.revision!==(db.protocol_revision||0))throw Error('Protocol changed. Refresh before saving.');
 const p=prepareProtocolDraft(input.protocol);if(!p||!Object.keys(PHASES).every(k=>Number.isInteger(p.routine_days?.[k])&&p.routine_days[k]>=1&&p.routine_days[k]<=365))throw Error('Record a draft interval from 1 to 365 days for every phase.');
 if(p.fever_threshold_c!==null&&(!Number.isFinite(p.fever_threshold_c)||p.fever_threshold_c<35||p.fever_threshold_c>42))throw Error('Fever threshold must be blank or a valid Celsius value for clinical review.');
 if(typeof p.emergency_text!=='string'||!p.emergency_text.trim()||p.emergency_text.length>2000)throw Error('Record the draft emergency wording.');

 // Emergency gates are retained. No UI action approves a SOP.
 db.protocol={...structuredClone(DRAFT_PROTOCOL),common:p.common,branches:p.branches,routine_days:p.routine_days,fever_threshold_c:p.fever_threshold_c,emergency_text:p.emergency_text,regimen_questions:p.regimen_questions,version:String((db.protocol_revision||0)+2)};db.protocol_revision=(db.protocol_revision||0)+1;
 db.audit_log.push({id:input.id,action:'save_protocol_draft',reviewer:actor.name,at:now,request:JSON.stringify(input)});
}
