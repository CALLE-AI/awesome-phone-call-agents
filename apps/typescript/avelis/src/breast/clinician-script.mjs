// A transparent, editable record-based draft; no model call or clinical decisions.
export function clinicianFollowupScript({patient,task,call}){
 const report=call?.conversation_report, risk=call?.risk_assessment, name=patient?.name||task?.patient;
 const usable=call?.report_verified===true;
 const context=task?.patient_context?.oncology||task?.oncology_context||patient?.oncology;
 const observations=report?.oncology?.observations||[];
 const source=f=>{for(const e of f.evidence||[])lines.push(`Source, turn ${e.turn_index+1}: “${e.quote}”`);};

 const lines=[`CLINICIAN FOLLOW-UP DRAFT — ${name}`,`Based on contact ${call?.id||'not recorded'}. Review and adapt before use; this draft does not record an action or contact the patient.`, '', '1. Identity and permission', `“Hello, this is Dr [name] from [care team]. May I confirm I’m speaking with ${name}? Is now a suitable time to talk privately?”`, 'Confirm identity and permission before discussing care details.'];
 if(context)lines.push('',`Recorded context: ${context.surgery||'Surgery not recorded'}${context.surgery_date?' ('+context.surgery_date+')':''}.`, `Treatment at this contact: ${context.current_treatment?.drug||'Not recorded'}.`, `Contact date: ${call?.created_at||'Not recorded'}. Background is from the care record; confirm any changes.`);
 if(risk?.level==='RED'){
  lines.push('', '2. Urgent handover — do not start a routine questionnaire', 'Check whether the reported emergency is still happening and whether the patient has already received help. Follow your hospital’s approved emergency pathway immediately; do not delay it to complete this script.');
  for(const t of risk.triggers.filter(t=>t.level==='RED')){lines.push(`Reported concern: ${t.label}`);for(const e of t.evidence.slice(0,1))lines.push(`Source, transcript turn ${e.turn_index+1}: “${e.quote}”`);}
  lines.push('These are recorded flags, not a diagnosis. Confirm the situation yourself.','', '3. Record the handover','Document whom you reached, the current situation, action taken, receiving team and time. Confirm responsibility and the next step; do not mark external help as delivered without confirmation.');return lines.join('\n');
 }
 lines.push('', '2. Establish what needs attention');
 if(!usable)lines.push('The AI findings have not been fully verified. Start with: “How have you been since our last contact? Is there anything new or getting worse?” Verify the original conversation before relying on its proposed findings.');
 else{
  lines.push(risk?.level==='GREEN'?'“At your last follow-up you reported no new concerns. Has anything changed since then?”':'“I’m following up on the concerns you shared in your last call. Could you tell me how things are today?”');
  for(const symptom of report?.oncology?.symptoms||[]){const label=symptom.name==='other'?(symptom.facts.find(f=>f.code==='description')?.value||'reported symptom'):symptom.name==='hot_flash'?'hot flashes':symptom.name.replaceAll('_',' ');lines.push(`“How is the ${label} now? Has it changed since the last call?”`);for(const f of symptom.facts.filter(f=>['onset','trend','functional_impact','sleep_impact'].includes(f.code)&&f.value!=='unknown').slice(0,3)){lines.push(`Previously reported ${f.code.replaceAll('_',' ')}: ${f.detail}`);if(f.evidence[0])lines.push(`Source, turn ${f.evidence[0].turn_index+1}: “${f.evidence[0].quote}”`);}}
  for(const f of observations.filter(f=>['visits.plan','visits.attended','systemic.regimen','endocrine.adherence','treatment.execution'].includes(f.code))){
   if(['visits.plan','visits.attended'].includes(f.code)&&['no','changed'].includes(f.value)){lines.push(`“You said the visit${context?.next_visit?' arranged for '+context.next_visit:''} was missed or changed. Has it been rearranged? What got in the way, and what help would make attending easier?”`);source(f);}
   if(f.code==='systemic.regimen'&&f.value==='unknown'){lines.push('“You were unsure about the next treatment after the missed review. Have you heard from the team since then?”','Verify the appointment and treatment schedule with the care team before confirming a date.');source(f);}
   if(f.code==='endocrine.adherence'){lines.push(`“You previously described how you were taking ${context?.current_treatment?.drug||'your prescribed endocrine treatment'}. Have any doses been missed or changed since that call?”`);source(f);}
  }
  for(const trigger of risk?.triggers||[])if(!trigger.rule.startsWith('symptom.')&&!trigger.rule.startsWith('arm.'))lines.push(`Clarify with the patient: ${trigger.label}.`);
 }
 lines.push('', '3. Clarify treatment and practical barriers');
 if(context?.current_treatment?.phases?.includes('survivorship'))lines.push('“Have the follow-up visits and examinations arranged by your care team gone ahead? Is there anything making it difficult to attend?”');
 else if(context?.current_treatment?.phases?.includes('post_op'))lines.push('“How are you managing the recovery instructions and arm exercises your team gave you? Has anything made them difficult?”');
 else lines.push('“Since that call, has anything changed in how you are following your care plan? What support do you need?”');
 if(task?.patient_context?.conflicts?.length)lines.push('Reconcile the differing source records explicitly; do not assume the newest account is correct.');
 if(risk?.missing?.length){const labels={'other.onset':'When the reported skin change began','systemic.regimen':'Whether the next treatment is still scheduled as recorded'};lines.push('Outstanding information to verify: '+risk.missing.map(code=>labels[code]||code.replaceAll('_',' ').replaceAll('.',' — ')).join('; '));}
 for(const q of report?.open_questions||[])lines.push('Unresolved question: '+q.question);
 for(const r of report?.patient_requests||[])lines.push('Patient request to address: '+r.description);
 lines.push('', '4. Agree the next step', `Recorded workflow: ${call?.next_contact_plan?.purpose||call?.next_contact_plan?.policy||risk?.action?.replaceAll('_',' ')||'Clinician assessment required'}`, 'Clinician decision / action: [complete after assessment under the hospital protocol]', '“Let’s confirm what happens next, who will arrange it, and when you should expect contact. Could you tell me that back in your own words?”', '', '5. Document', 'Current findings; verified corrections; clinical assessment; action actually taken; responsible person; agreed contact time; unresolved issues. Preserve the original AI report.');
 return lines.join('\n');
}
