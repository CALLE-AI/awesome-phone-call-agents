import {parseTurns} from '../outcome-gate.mjs';
import {requiredTopics,DRAFT_PROTOCOL,SYMPTOM_FIELDS,SYMPTOM_EXTRA} from './protocol.mjs';
export function checkBreastReport(raw,transcript,task){
 const o=raw.oncology;if(!o)return ['BREAST_CONTEXT_MISSING'];const issues=[];const turns=parseTurns(transcript);const person={oncology:task.oncology_context,reference_at:task.contact_reference_at};const protocol=task.clinical_protocol||DRAFT_PROTOCOL;
 const consentEnd=Math.max(-1,...raw.conversation.consent_evidence.map(e=>e.turn_index));
 const codes=new Set([...requiredTopics(person,protocol).map(x=>x[0]),'visits.overdue','visits.unable','treatment.problem']);
 const check=(facts,allowed)=>{if(new Set(facts.map(f=>f.code)).size!==facts.length)issues.push('DUPLICATE_FACT');for(const f of facts){if(!allowed.has(f.code))issues.push('UNKNOWN_PROTOCOL_FIELD');if(f.value!=='unknown'&&!f.evidence.length)issues.push('MISSING_FACT_EVIDENCE');for(const e of f.evidence)if(turns[e.turn_index]?.speaker!=='patient'||turns[e.turn_index].text!==e.quote||e.turn_index<=consentEnd)issues.push('BREAST_EVIDENCE_MISMATCH');}};
 check(o.observations,codes);
 for(const f of o.observations)if(!(f.code.startsWith('emergency.')||['visits.overdue','visits.unable','treatment.problem'].includes(f.code)?['yes','no','unknown']:['yes','no','unknown','stable','as_planned','changed','not_applicable']).includes(f.value))issues.push('INVALID_FACT_VALUE');
 if(new Set(o.symptoms.map(s=>s.name)).size!==o.symptoms.length)issues.push('DUPLICATE_SYMPTOM_CATEGORY');
 for(const s of o.symptoms){if(!s.facts.some(f=>f.evidence.length))issues.push('MISSING_SYMPTOM_EVIDENCE');for(const f of s.facts){if(f.code==='trend'&&!['improving','stable','persistent','worsening','unknown'].includes(f.value))issues.push('INVALID_SYMPTOM_TREND');if(f.code==='severity'&&!['mild','moderate','severe','unknown'].includes(f.value))issues.push('INVALID_SYMPTOM_SEVERITY');}check(s.facts,new Set(['new',...SYMPTOM_FIELDS,...(SYMPTOM_EXTRA[s.name]||[])]));for(const f of s.facts)if(['new','functional_impact','red_flags','redness','warmth','pain','movement','sleep_impact','chills','at_rest'].includes(f.code)&&!['yes','no','unknown'].includes(f.value))issues.push('INVALID_SYMPTOM_VALUE');}
 if(o.respondent==='authorized_proxy'){
  if(o.symptoms.length||o.observations.some(f=>!['visits.plan'].includes(f.code)))issues.push('PROXY_SCOPE_EXCEEDED');
  const proxy=task.oncology_context?.proxy_authorizations?.find(p=>p.name===o.proxy_name&&p.scopes?.includes('logistics')&&Date.parse(p.expires_at)>Date.parse(task.contact_reference_at||new Date().toISOString()));if(!proxy)issues.push('UNAUTHORIZED_PROXY');
 }
 return [...new Set(issues)];
}
