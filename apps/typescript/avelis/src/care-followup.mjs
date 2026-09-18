// Follow-up contacts preserve the original order and never set medication timing.
export function ensureFollowup(db, task, id, preference = null) {
  let child = db.tasks.find(t => t.id === id);
  if (!child) {
    child = {id, patient:task.patient, patient_id:task.patient_id, type:'Follow-up',
      custom_demo_order:task.custom_demo_order||false, care_type:task.care_type || task.type, task:'Confirm completion: '+task.task,
      order:task.order ? structuredClone(task.order) : undefined, source_task_id:task.id,
      due_time:null, due_at:null, status:'PENDING', revision:0, events:[],
      time_preference:preference || 'Not specified', scheduling_status:'NEEDS_TIME_CONFIRMATION'};
    if(task.care_program==='breast')Object.assign(child,{care_program:'breast',type:task.type,task:'Breast care follow-up: '+task.task,oncology_context:structuredClone(task.oncology_context),clinical_protocol:structuredClone(task.clinical_protocol)});
    db.tasks.push(child);
  }
  return child;
}

export function closeConfirmedParents(db, task, at, source) {
  const seen = new Set([task.id]);
  while (task.source_task_id && task.status === 'COMPLETED') {
    const parent = db.tasks.find(t => t.id === task.source_task_id);
    if (!parent || seen.has(parent.id) || parent.status !== 'WILL_DO_LATER' || parent.patient !== task.patient) break;
    if (db.reviews.some(r => r.task_id === parent.id && r.status !== 'COMPLETED')) break;
    seen.add(parent.id);
    parent.status = 'COMPLETED'; parent.revision = (parent.revision || 0) + 1;
    parent.completion_source = source; parent.confirmed_by_followup = task.id;
    parent.events ||= [];
    parent.events.push({at, label:'Completion confirmed on follow-up', detail:'The later confirmation closes this task. The original order and first conversation are retained.'});
    task = parent;
  }
}

// Normalize only a full date/time explicitly spoken by the patient. Relative or
// vague preferences remain unconfirmed, even if the model proposes a date.
export function contactAgreementStamp(quote) {
  if (typeof quote !== 'string') return null;
  // Positive, first-person requests only. A timestamp inside a refusal, quoted
  // instruction, hypothetical, or plan to call somebody else is not consent.
  const normalized=quote.replaceAll('’',"'").trim();
  const match=/^(?:yes[,!.]?\s+)?(?:please\s+)?(?:call|contact) me (?:on |at )?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\s+UTC[.!]?$/i.exec(normalized)
    || /^(?:yes[,!.]?\s+)?(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\s+UTC works for (?:a |the )?follow-up (?:call|contact)[.!]?$/i.exec(normalized);
  return match ? match[1]+'T'+match[2]+':00.000Z' : null;
}
export function explicitContactTime(evidence, now) {
  const stamp=contactAgreementStamp(evidence?.quote);
  if(!stamp)return null;
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== stamp || ms <= Date.parse(now) || ms > Date.parse(now)+7*86400000) return null;
  return stamp;
}
