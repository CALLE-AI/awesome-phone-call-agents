import test from 'node:test';
import assert from 'node:assert/strict';
import {freshBreastWorkspace} from './src/breast/demo.mjs';
import {clinicianFollowupScript} from './src/breast/clinician-script.mjs';
const db=freshBreastWorkspace();
function record(id){const patient=db.patients.find(p=>p.id===id);const task=db.tasks.find(t=>t.patient_id===id&&t.call_id);const call=db.calls.find(c=>c.id===task.call_id);return {patient,task,call};}
test('worsening symptoms require review and preserve the corrected patient source',()=>{const r=record('bc-emma');assert.equal(r.call.risk_assessment.level,'YELLOW');assert.ok(r.call.transcript.includes('Maybe three days?'));assert.ok(r.call.transcript.includes('Yes, about a week.'));const onset=r.call.conversation_report.oncology.symptoms.find(s=>s.name==='arm_swelling').facts.find(f=>f.code==='onset');assert.equal(onset.evidence[0].quote,'Yes, about a week. Sorry, I got the days mixed up.');assert.ok(r.patient.safety_hold);});
test('emergency stops routine screening and creates a handover draft without mutating the record',()=>{const r=record('bc-olivia');assert.equal(r.call.risk_assessment.level,'RED');assert.ok(!r.call.protocol_trace.some(t=>t.topic==='overall'));const before=JSON.stringify(r);assert.match(clinicianFollowupScript(r),/Urgent handover/);assert.equal(JSON.stringify(r),before);});
test('stable assessment links a next routine task; uncertain onset remains unknown',()=>{const r=record('bc-nora');assert.equal(r.call.risk_assessment.level,'GREEN');assert.ok(db.tasks.some(t=>t.previous_task_id===r.task.id));const e=record('bc-ellen');assert.ok(e.call.conversation_report.oncology.symptoms.some(s=>s.facts.some(f=>f.code==='onset'&&f.value==='unknown')));});
