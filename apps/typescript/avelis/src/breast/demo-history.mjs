import {EMMA_CALL_ARCHIVE} from './demo-call-archive.mjs';
// Authored longitudinal history, added only to the fictional Demo workspace.
export function addDemoHistory(db){
 if(db.provider!=='mock')return db;
 const task=db.tasks.find(t=>t.id==='followup-bc-emma');
 if(!task)return db;
 db.demo_call_archive ||= [];
 for(const call of EMMA_CALL_ARCHIVE)if(!db.demo_call_archive.some(c=>c.id===call.id))db.demo_call_archive.push(structuredClone(call));
 if(task.demo_history_version){for(const event of task.events||[]){const call=EMMA_CALL_ARCHIVE.find(c=>c.created_at===event.at);if(call){event.call_record_id=call.id;event.detail=call.summary;}}task.demo_history_version=2;return db;}
 const events=[
  {at:'2026-07-03T14:00:00.000Z',label:'Care-team enrollment · Demo',detail:'Historical episode: Emma’s treatment plan and contact preferences were recorded. Consent for fictional follow-up was documented.'},
  {at:'2026-07-15T14:00:00.000Z',label:'Earlier telephone follow-up · Demo',detail:'Historical episode: Emma reported mild hot flashes and occasional arm tightness. The care team requested a later comparison. This authored history has no separate recording or transcript.'},
  {at:'2026-07-16T15:00:00.000Z',label:'Care-team review recorded · Demo',detail:'Dr Sarah Chen reviewed the reported symptoms and documented the existing follow-up plan. No medication change is recorded.'},
  {at:'2026-08-01T14:00:00.000Z',label:'Monthly follow-up completed · Demo',detail:'Historical episode: mild hot flashes and occasional left arm tightness remained the recorded baseline. This is the last-follow-up context used in the current conversation; no separate recording is available.'},
  {at:'2026-08-02T15:00:00.000Z',label:'Longitudinal comparison planned · Demo',detail:'Dr Sarah Chen recorded that the next contact should compare sleep, hot flashes and left arm symptoms with the August baseline.'},
  {at:'2026-09-11T14:00:00.000Z',label:'Current care order recorded · Demo',detail:'The current endocrine follow-up order was prepared from the existing treatment plan and prior reported concerns.'}
 ];
 for(const event of events){const call=EMMA_CALL_ARCHIVE.find(c=>c.created_at===event.at);if(call){event.call_record_id=call.id;event.detail=call.summary;}}
 task.events=[...events,...(task.events||[])].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
 task.clinical_activity=[
  {id:'demo-history-emma-july-review',action:'Earlier episode · care-team review',note:'Demo Simulation: reviewed the prior report of mild hot flashes and occasional arm tightness; documented follow-up without changing medication instructions.',by:'Dr Sarah Chen',at:'2026-07-16T15:00:00.000Z',result:'COMPLETED'},
  {id:'demo-history-emma-august-plan',action:'Earlier episode · follow-up plan recorded',note:'Demo Simulation: use the August symptom baseline for comparison at the next contact. This historical action does not resolve the current September review.',by:'Dr Sarah Chen',at:'2026-08-02T15:00:00.000Z',result:'COMPLETED'},
  ...(task.clinical_activity||[])
 ];
 task.demo_history_version=2;
 return db;
}
