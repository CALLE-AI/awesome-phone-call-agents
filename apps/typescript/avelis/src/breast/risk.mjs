import {requiredTopics,DRAFT_PROTOCOL,phasesOf,SYMPTOM_FIELDS,SYMPTOM_EXTRA} from './protocol.mjs';
export const findFact=(facts,code)=>facts.find(f=>f.code===code);
const yes=(facts,code)=>findFact(facts,code)?.value==='yes';
export function evaluateBreastRisk(report,person,protocol=DRAFT_PROTOCOL,{verified=false,complete=false}={}){
 const o=report?.oncology;if(!o)return {level:'UNKNOWN',action:'verify_information',triggers:[],missing:['Breast follow-up report missing'],protocol_version:protocol.version,protocol_review_state:protocol.review_state};
 const facts=o.observations||[],symptoms=o.symptoms||[],triggers=[];const add=(level,rule,label,evidence=[])=>triggers.push({level,rule,label,evidence});
 // This engine reads evidence-checked structured facts. It does not diagnose or interpret raw text.
 if(verified){
  for(const [code,label] of [['emergency.breathing','Reported severe breathing difficulty'],['emergency.awareness','Reported altered awareness'],['emergency.chest_pain','Reported severe chest pain']])if(yes(facts,code))add('RED',code,label,findFact(facts,code).evidence);
  for(const s of symptoms){const sf=s.facts||[];const evidence=sf.flatMap(f=>f.evidence||[]);const value=k=>findFact(sf,k)?.value;
   if(yes(sf,'red_flags'))add('RED','symptom.red_flag','Symptom emergency feature reported',evidence);
   if(evidence.length&&s.name==='fever'&&phasesOf(person).includes('chemotherapy'))add('RED','chemo.reported_fever','Fever reported during chemotherapy · draft urgent pathway',evidence);
   if(s.name==='fever'&&protocol.fever_threshold_c!==null&&Number.isFinite(Number(value('temperature_c')))&&Number(value('temperature_c'))>=protocol.fever_threshold_c)add('RED','fever.hospital_threshold','Configured draft fever threshold reached',evidence);
   if(value('new')==='yes'&&['persistent','worsening'].includes(value('trend')))add('YELLOW','symptom.new_persistent','New persistent or worsening symptom',evidence);
   if(value('severity')==='severe')add('YELLOW','symptom.severe','Severe symptom reported',evidence);
   if(value('functional_impact')==='yes'||value('sleep_impact')==='yes')add('YELLOW','symptom.impact','Symptoms affect daily life or sleep',evidence);
   if(s.name==='arm_swelling'&&value('trend')==='worsening')add('YELLOW','arm.progressive','Progressive arm swelling',evidence);
   if(s.name==='adherence')add('YELLOW','treatment.adherence','Treatment adherence problem reported',evidence);
   if(s.name==='bleeding'&&value('location')==='vaginal'&&/tamoxifen/i.test(person?.oncology?.current_treatment?.drug||''))add('YELLOW','tamoxifen.bleeding','Unusual vaginal bleeding reported during tamoxifen treatment',evidence);
  }
  for(const [code,label] of [['screen.breast_change','New breast, chest wall or regional lump/change'],['screen.persistent_symptoms','New persistent symptom reported'],['visits.overdue','Recorded follow-up overdue'],['visits.unable','Patient cannot attend because of symptoms'],['treatment.problem','Treatment stopped, missed or delayed'],['qol.impact','Symptoms affect quality of life'],['endocrine.bleeding','Unusual vaginal bleeding reported']])if(yes(facts,code))add('YELLOW',code,label,findFact(facts,code).evidence);
  if(report.review?.required||report.patient_requests?.some(r=>['clinician_contact','explanation','practical_help'].includes(r.kind)))add('YELLOW','patient.request','Patient needs care-team review',report.review?.evidence||[]);
 }
 const missing=[];if(findFact(facts,'visits.attended')?.value==='no'&&verified)add('YELLOW','visits.missed','Recorded visit was not attended',findFact(facts,'visits.attended').evidence);
 const symptomTopics=['post_op.wound','post_op.infection','post_op.arm','chemo.fever','chemo.gastrointestinal','chemo.mouth','chemo.bleeding_fatigue','chemo.neuropathy','radio.skin','radio.pain_fatigue','radio.breathing','endocrine.effects','endocrine.bleeding','systemic.effects','survivorship.changes'];
 for(const code of symptomTopics)if(['yes','changed'].includes(findFact(facts,code)?.value)&&!symptoms.length)missing.push(code+': symptom details not collected');
 if(['changed','no'].includes(findFact(facts,'treatment.execution')?.value)&&verified)add('YELLOW','treatment.changed','Reported treatment execution differs from the care plan',findFact(facts,'treatment.execution').evidence);
 if(['changed','no'].includes(findFact(facts,'visits.plan')?.value)&&verified)add('YELLOW','visits.changed','Recorded visit plan changed or not arranged',findFact(facts,'visits.plan').evidence);
 for(const [code] of requiredTopics(person,protocol))if(!findFact(facts,code)||findFact(facts,code).value==='unknown')missing.push(code);
 for(const s of symptoms)for(const key of ['new',...SYMPTOM_FIELDS,...(SYMPTOM_EXTRA[s.name]||[])])if(!findFact(s.facts,key)||findFact(s.facts,key).value==='unknown')missing.push(s.name+'.'+key);
 if(!verified)missing.push('Evidence / semantic verification');
 if(!phasesOf(person).length||o.phase_report!=='consistent')missing.push('Treatment phase confirmation');
 if(o.respondent!=='patient')missing.push('Direct patient follow-up');
 if(!complete)missing.push('Completed conversation');
 missing.push(...(o.limitations||[]));
 const level=triggers.some(t=>t.level==='RED')?'RED':triggers.some(t=>t.level==='YELLOW')?'YELLOW':missing.length?'UNKNOWN':'GREEN';
 return {level,action:level==='RED'?'hospital_emergency_pathway':level==='YELLOW'?'clinician_callback':level==='GREEN'?'routine_followup':'verify_information',triggers,missing:[...new Set(missing)],protocol_version:protocol.version,protocol_review_state:protocol.review_state,disclaimer:'Protocol routing, not a diagnosis. Demo thresholds require hospital approval.'};
}
export function nextBreastQuestion(report,person,protocol=DRAFT_PROTOCOL){
 const risk=evaluateBreastRisk(report,person,protocol,{verified:true,complete:false});if(risk.level==='RED')return {node:'EMERGENCY_HANDOFF',question:protocol.emergency_text,risk};
 const o=report.oncology;if(o.respondent!=='patient')return {node:o.respondent==='authorized_proxy'?'PROXY_LOGISTICS':'END_IDENTITY_UNCONFIRMED',question:'Please arrange a convenient time for the patient to contact the care team. Do not disclose or collect clinical information.'};const facts=o.observations;const unanswered=code=>!facts.some(f=>f.code===code);
 for(const [code,question] of protocol.common.filter(([c])=>c.startsWith('emergency.')))if(unanswered(code))return {node:'EMERGENCY_SCREEN',code,question};
 if(protocol.common.some(([c])=>c==='overall')&&unanswered('overall'))return {node:'OPEN_QUESTION',code:'overall',question:protocol.common.find(([c])=>c==='overall')[1]};
 for(const s of o.symptoms)for(const field of ['new',...SYMPTOM_FIELDS,...(SYMPTOM_EXTRA[s.name]||[])])if(!s.facts.some(f=>f.code===field))return {node:'SYMPTOM_SUBTREE',symptom:s.name,code:field,question:symptomQuestion(s.name,field)};
 for(const [code,question] of [...requiredTopics(person,protocol)].sort((a,b)=>Number(a[0].startsWith('screen.')||a[0].startsWith('visits.')||a[0].startsWith('qol.'))-Number(b[0].startsWith('screen.')||b[0].startsWith('visits.')||b[0].startsWith('qol.'))))if(unanswered(code))return {node:code.startsWith('screen.')?'NEW_PERSISTENT_SCREEN':code.startsWith('visits.')?'FOLLOWUP_PLAN':code.startsWith('qol.')?'QUALITY_OF_LIFE':'TREATMENT_SCREEN',code,question};
 return {node:'SUMMARY',question:'Let me recap what you reported and what remains unresolved.',risk:evaluateBreastRisk(report,person,protocol,{verified:true,complete:true})};
}
function symptomQuestion(name,field){const label=name.replaceAll('_',' ');return ({new:`Is this ${label} new since your last follow-up?`,onset:`When did the ${label} start?`,duration:'How long does it last?',severity:'How severe does it feel to you?',trend:'Is it improving, staying the same, persisting or getting worse?',frequency:'How often does it happen?',associated:'Have you noticed any other symptoms alongside it?',functional_impact:'Does it affect sleep, eating or your usual activities?',red_flags:'Is there severe breathing difficulty, fainting, new confusion or another severe problem right now?',side:'Is the swelling on the side of your breast surgery?',distribution:'Where is the swelling: hand, forearm or the whole arm?',redness:'Is the area red?',warmth:'Does it feel unusually warm?',pain:'Is it painful?',movement:'Does it limit arm movement?',temperature_c:'What temperature have you measured, in Celsius?',last_treatment:'When was your most recent treatment?',chills:'Have you had chills?',location:'Where is it?',at_rest:'Does the breathing problem happen at rest?',sleep_impact:'Does it disturb your sleep?',missed_frequency:'How often have doses or treatments been missed?',reason:'What has made following the plan difficult?',description:'Could you describe what you noticed?'}[field]||`Please describe ${field}.`);}
