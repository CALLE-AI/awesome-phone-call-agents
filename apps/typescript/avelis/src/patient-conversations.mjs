// One read model for UI, activity and planning. Demo-only archives never enter Live.
export function patientConversations(db,patientId,{before=null,finishedOnly=false}={}){
 const rows=[...(db.calls||[]).filter(c=>c.patient_id===patientId||(db.tasks||[]).some(t=>t.id===c.task_id&&t.patient_id===patientId)),...(db.provider==='mock'?(db.demo_call_archive||[]).filter(c=>c.patient_id===patientId):[])];
 return [...new Map(rows.map(c=>[c.id,c])).values()].filter(c=>(!finishedOnly||c.state==='FINISHED')&&(!before||(c.updated_at||c.created_at)<=before)).sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));
}
export function currentCareAction(db,task){
 const children=(db.tasks||[]).filter(t=>(t.source_task_id===task.id||t.previous_task_id===task.id)&&!['COMPLETED','CANCELED'].includes(t.status));
 if(task.reviewed_outcome){const next=children[0];return {title:'Current care-team decision',text:task.reviewed_outcome.note,at:task.reviewed_outcome.at,by:task.reviewed_outcome.reviewer,next_task_id:next?.id,next_at:next?.plan?.call_at};}
 if(task.schedule_note)return {title:'Current care-team contact plan',text:task.schedule_note,at:task.scheduled_at};
 return null;
}
export function orderCallAttempts(db,task){
 const rootOf=x=>{const seen=new Set();while(x.source_task_id&&!seen.has(x.id)){seen.add(x.id);const parent=db.tasks.find(y=>y.id===x.source_task_id);if(!parent)break;x=parent;}return x.id;};const root=rootOf(task),family=new Set(db.tasks.filter(x=>rootOf(x)===root).map(x=>x.id));
 return db.calls.filter(c=>family.has(c.task_id)&&!['CANCELED','EXPIRED'].includes(c.status));
}
