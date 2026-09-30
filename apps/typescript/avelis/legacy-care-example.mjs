import {applyOutcome} from './src/care-result.mjs';
import {mockPayload} from './src/mock-payload.mjs';
import {callsRequest,adaptCallResponse} from './src/calle-http.mjs';
function route(payload,patient='Emma'){
 const db={tasks:[{id:'task',patient,type:'Medication',task:'Confirm prescribed medication',status:'UNCONFIRMED'}],reviews:[]};
 const call={id:'example',task_id:'task',updated_at:new Date().toISOString()};
 applyOutcome(db,call,payload);
 return {task_status:db.tasks[0].status,accepted_fields:call.gate.fields,next_action:call.result.next_action,follow_up_created:db.tasks.length>1,human_review_created:db.reviews.length>0};
}
function continuity(){
 const db={tasks:[{id:'original',patient:'Emma',patient_id:'patient-emma',type:'Medication',task:'Confirm prescribed medication',status:'UNCONFIRMED'}],reviews:[]};
 const first={id:'initial-call',task_id:'original',updated_at:'2026-09-12T14:00:00.000Z'};
 applyOutcome(db,first,mockPayload(first.id,'forgot'));
 const firstResult=JSON.stringify(first.result);const child=db.tasks.find(task=>task.source_task_id==='original');
 const later={id:'follow-up-call',task_id:child.id,updated_at:'2026-09-13T14:00:00.000Z'};
 applyOutcome(db,later,mockPayload(later.id,'completed'));
 return {scenario:'linked_follow_up',initial_route:first.routing,follow_up_route:later.routing,original_task_status:db.tasks.find(task=>task.id==='original').status,follow_up_task_status:child.status,first_result_preserved:JSON.stringify(first.result)===firstResult,first_evidence:first.result.evidence.task_status};
}
if(process.argv[2]==='--inspect-call'){
 const id=process.argv[3];const phone=process.env.AVELIS_LIVE_PHONE;const patient=process.env.AVELIS_TEST_PATIENT;
 if(!/^call_[A-Za-z0-9_-]+$/.test(id||'')||!/^\+[1-9]\d{7,14}$/.test(phone||'')||!patient)throw Error('Supply an existing call ID, the exact authorized AVELIS_LIVE_PHONE and AVELIS_TEST_PATIENT.');
 const raw=await callsRequest(process.env.CALLE_API_KEY,'/v1/calls/'+id);
 const parsed=adaptCallResponse(raw,id,phone);
 if(!parsed.finished)console.log(JSON.stringify({status:parsed.status,task_status:'UNRESOLVED'}));
 else console.log(JSON.stringify(route(parsed.payload,patient),null,2));
}else if(process.argv.length===2){
 console.log('Demo Simulation — fictional transcripts; no network requests or calls.');
 for(const scenario of ['completed','forgot','side_effect','no_answer'])console.log(JSON.stringify({scenario,...route(mockPayload('example',scenario))},null,2));
 console.log(JSON.stringify(continuity(),null,2));
}else throw Error('Use node app.mjs for simulation, or --inspect-call call_ID for an authorized read-only check.');
