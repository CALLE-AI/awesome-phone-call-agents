'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Flow = require('../static/rescue-flow.js');
const clone = x => JSON.parse(JSON.stringify(x));
const base = {
  id:'run',status:'partial',mode:'mock',engine_version:5,legacy:false,actions:[],
  definition:{requirements:[{id:'scene_observation'}]},scope_warning:'',
  plan:{contact_offers:[{name:'Neighborhood Support',conditions:['supervisor confirms availability']}],requirements:[]},
  plan_options:[],selected_plan_id:null,can_approve:false,can_continue:false,can_check_unmatched:true,
  continue_blocked_code:'no_capability_match',activity:{active:false,uncertain:false},
  contact_availability:[{contact_id:'old',name:'Neighborhood Support',status:'already_contacted'},
    {contact_id:'paws',name:'Paws & Care',status:'no_capability_match'},
    {contact_id:'street',name:'Street Animal Response',status:'no_capability_match'}]
};
test('exact paused report has an enabled concrete next step, not Keep going',()=>{
 const f=Flow.next(base);assert.equal(f.action,'chooseNextContact');assert.equal(f.kind,'find');
 assert.match(f.body,/Neighborhood Support has not confirmed/);assert.equal(f.label,'Choose someone to ask');
 assert.deepEqual(Flow.contacts(base).map(c=>c.contact_id),['paws','street']);
});
test('derived display neither changes source data nor assumes capabilities',()=>{
 const input=clone(base),before=clone(input);for(let i=0;i<4;i++){Flow.next(input);Flow.contacts(input);}
 assert.deepEqual(input,before);assert.equal(input.plan_options.length,0);assert.equal(input.can_approve,false);
});
for (const status of ['already_contacted','not_approved','inactive','mock_only','duplicate_number']) {
 test(`${status} never appears in the actionable chooser`,()=>{
  const r=clone(base);r.contact_availability.push({contact_id:'excluded',status});
  assert(!Flow.contacts(r).some(c=>c.contact_id==='excluded'));
 });
}
for(const status of ['queued','running','starting'])test(`${status} prioritizes the working indicator over new calls`,()=>{
 const r={...clone(base),status,activity:{active:true}};assert.equal(Flow.next(r).kind,'working');assert.equal(Flow.contacts(r).length,0);
});
test('matching contacts still need server permission',()=>{
 const r=clone(base);r.contact_availability.push({contact_id:'match',status:'eligible'});
 assert(!Flow.contacts(r).some(c=>c.contact_id==='match'));r.can_continue=true;
 assert(Flow.contacts(r).some(c=>c.contact_id==='match'));r.can_check_unmatched=false;
 assert.deepEqual(Flow.contacts(r).map(c=>c.contact_id),['match']);
});
test('uncertain provider call blocks new inquiries even with stale eligibility flags',()=>{
 const r=clone(base);r.activity.uncertain=true;assert.equal(Flow.next(r).action,'reviewEvidence');assert.deepEqual(Flow.contacts(r),[]);
});
test('stopped inquiry stays stopped, with explicit continuation available',()=>{
 const r={...clone(base),status:'stopped'};assert.equal(Flow.next(r).title,'Inquiries are stopped');assert.equal(Flow.next(r).action,'chooseNextContact');assert.equal(r.status,'stopped');
});
for(const [code,kind,action] of [
 ['no_contacts','add','addCompareContact'],['call_limit','limit','reviewEvidence'],
 ['mode_changed','mode','openSettings'],['other_run_busy','busy','refreshAvailability'],
 ['review_required','review','reviewEvidence']
])test(`${code} points to a permitted recovery action`,()=>{
 const r={...clone(base),can_continue:false,can_check_unmatched:false,continue_blocked_code:code};
 assert.equal(Flow.next(r).kind,kind);assert.equal(Flow.next(r).action,action);assert.deepEqual(Flow.contacts(r),[]);
});
test('scope mismatch and legacy plans cannot be approved or re-inquired from this UI',()=>{
 for(const override of [{scope_warning:'Wrong goal'},{legacy:true},{engine_version:2}]){
  const r={...clone(base),...override,can_approve:true};assert.equal(Flow.next(r).action,'correctGoal');assert.deepEqual(Flow.contacts(r),[]);
 }
});
test('one complete plan leads to review, never implicit approval',()=>{
 const r={...clone(base),status:'covered',can_approve:true,selected_plan_id:'plan-a',plan_options:[{id:'plan-a'}]};
 assert.equal(Flow.next(r).kind,'ready');assert.equal(Flow.next(r).action,'startRescue');assert.equal(Flow.next(r).label,'Review & approve');assert.deepEqual(r.actions,[]);
});
test('complete alternatives without a selection lead to comparison',()=>{
 const r={...clone(base),status:'covered',plan_options:[{id:'plan-a'}]};assert.equal(Flow.next(r).action,'comparePlans');
});
test('existing approved actions never expose inquiry or approval controls',()=>{
 const r={...clone(base),status:'active',actions:[{status:'confirmed',progress:'ready'}],can_approve:true};
 assert.equal(Flow.next(r).kind,'tracking');assert.equal(Flow.next(r).action,'');assert.deepEqual(Flow.contacts(r),[]);
});
test('one failed callback cannot pretend all helpers are ready',()=>{
 const r={...clone(base),status:'attention',actions:[{status:'confirmed'},{status:'needs_attention'}]};
 assert.equal(Flow.next(r).kind,'attention');assert.equal(Flow.next(r).action,'reviewEvidence');assert.match(Flow.next(r).body,/Check the last reply/);
});
test('only a finished active rescue offers safe closure',()=>{
 const r={...clone(base),status:'active',actions:[{status:'confirmed',progress:'finished'}]};assert.equal(Flow.next(r).action,'completeRescue');
 r.actions.push({status:'confirmed',progress:'arrived'});assert.equal(Flow.next(r).action,'');
});
test('completed rescue is read-only with a share action',()=>{
 const r={...clone(base),status:'completed',actions:[{status:'confirmed',progress:'finished'}]};assert.equal(Flow.next(r).action,'shareUpdate');assert.deepEqual(Flow.contacts(r),[]);
});
test('observation label requires a nonempty, observation-only definition',()=>{
 assert(Flow.observationOnly(base));assert(!Flow.observationOnly({}));assert(!Flow.observationOnly({definition:{requirements:[]}}));
 assert(!Flow.observationOnly({definition:{requirements:[{id:'scene_observation'},{id:'receiving_care'}]}}));
});
test('missing legacy fields produce a review action without throwing',()=>assert.equal(Flow.next({}).action,'reviewEvidence'));

test('a stopped complete plan does not loop into a comparison that cannot enable approval',()=>{
 const r={...clone(base),status:'stopped',selected_plan_id:'saved',plan_options:[{id:'saved'}]};
 assert.equal(Flow.next(r).action,'chooseNextContact');assert.equal(r.can_approve,false);
});
for(const code of ['call_limit','mode_changed','other_run_busy','review_required'])test(`stale permissions cannot bypass ${code}`,()=>{
 const r={...clone(base),can_continue:true,can_check_unmatched:true,continue_blocked_code:code};
 assert.deepEqual(Flow.contacts(r),[]);assert.notEqual(Flow.next(r).action,'chooseNextContact');
});
for(const status of ['failed','completed'])test(`${status} cannot expose stale contact permissions`,()=>{
 assert.deepEqual(Flow.contacts({...clone(base),status,can_continue:true}),[]);
});

const pending = {...clone(base),followup_options:[{contact_id:'old',call_id:'call1',name:'Neighborhood Support',conditions:['supervisor confirms availability']}]};
test('pending supervisor confirmation has a direct action before adding new contacts',()=>{
 const r={...clone(pending),continue_blocked_code:'no_contacts',can_check_unmatched:false};
 assert.equal(Flow.next(r).kind,'condition');assert.equal(Flow.next(r).action,'checkOfferCondition');
 assert.match(Flow.next(r).title,/before approval/);assert.equal(Flow.next(r).label,'Check supervisor confirmation');
});
test('non-supervisor condition uses a truthful generic label',()=>{
 const r=clone(pending);r.followup_options[0].conditions=['equipment repaired'];
 assert.equal(Flow.next(r).label,'Check the pending condition');assert(!Flow.next(r).body.includes('supervisor'));
});
test('a complete selected plan prioritizes approval over unused conditional alternatives',()=>{
 const r={...clone(pending),status:'covered',can_approve:true,selected_plan_id:'a',plan_options:[{id:'a'}]};
 assert.equal(Flow.next(r).action,'startRescue');assert.equal(Flow.next(r).label,'Review & approve');
});
test('a stopped conditional run permits only a new explicit recheck',()=>{
 assert.equal(Flow.next({...clone(pending),status:'stopped'}).action,'checkOfferCondition');
});
for(const override of [
 {status:'running'},{status:'failed'},{status:'interrupted'},{status:'completed'},
 {activity:{uncertain:true}},{scope_warning:'changed goal'},{legacy:true},
 {continue_blocked_code:'call_limit'},{continue_blocked_code:'mode_changed'},
 {continue_blocked_code:'other_run_busy'},{actions:[{status:'confirmed'}]}
])test(`stale followup permissions cannot bypass ${JSON.stringify(override)}`,()=>{
 const r={...clone(pending),...override};assert.deepEqual(Flow.followups(r),[]);
 assert.notEqual(Flow.next(r).action,'checkOfferCondition');
});

// v5.3.6: actionable callback recovery without inventing engagement.
const recovery = {action_id:'a',name:'Neighborhood Support',title:'Confirm the final price',reason:'The last reply did not confirm the approved price.',label:'Confirm with helper'};
test('missing callback price surfaces one recovery action, not instructions to read a log',()=>{
 const r={...clone(base),status:'attention',actions:[{status:'needs_attention'}],callback_recovery:recovery};
 const before=clone(r),f=Flow.next(r);assert.equal(f.action,'retryCallback');assert.equal(f.kind,'recover');
 assert.equal(f.title,'Confirm the final price');assert.deepEqual(r,before);assert.deepEqual(Flow.contacts(r),[]);
});
for (const props of [{status:'running'},{status:'starting'},{status:'completed'},{status:'interrupted'},{activity:{uncertain:true}},{scope_warning:'changed'},{legacy:true},{engine_version:2}]) {
 test(`stale retry hint is not used in ${JSON.stringify(props)}`,()=>{
  const r={...clone(base),status:'attention',actions:[{status:'needs_attention'}],callback_recovery:recovery,...props};
  assert.notEqual(Flow.next(r).action,'retryCallback');
 });
}
test('confirmed helpers have inline progress controls, not a second primary explanation button',()=>{
 const r={...clone(base),status:'active',actions:[{status:'confirmed',progress:'ready'}]};
 const f=Flow.next(r);assert.equal(f.action,'');assert.equal(f.body,'');
});

// v5.5: recovering an original provider operation is not a new callback.
const savedProvider = {label:'Recover saved call result',explanation:'Read the existing Call ID.'};
test('an unresolved saved operation exposes recovery rather than a redial',()=>{
 const r={...clone(base),mode:'live',status:'failed',activity:{uncertain:true},provider_recovery:savedProvider};
 assert.equal(Flow.next(r).action,'recoverProvider');assert.deepEqual(Flow.contacts(r),[]);
});
for(const props of [{mode:'mock'},{status:'completed'},{status:'running'},{status:'active'},{scope_warning:'Changed goal'},{legacy:true},{engine_version:2}]) {
 test(`stale provider recovery is not actionable for ${JSON.stringify(props)}`,()=>{
  const r={...clone(base),mode:'live',status:'failed',provider_recovery:savedProvider,...props};
  assert.notEqual(Flow.next(r).action,'recoverProvider');
 });
}

// v5.6: future IF/ELSE assessment is plan scope, not an unanswered goal menu.
const conditionalRun = {...clone(base),status:'active',engine_version:3,
  plan:{decisions:[{id:'clinic_needed'}],requirements:[{id:'assessment',gate_state:'initial'},{id:'transport',gate_state:'pending'},{id:'feeding',gate_state:'pending'}]},
  actions:[{status:'confirmed',progress:'arrived'},{status:'confirmed',progress:'ready',waiting_for_condition:true}],
  decision_options:[{id:'clinic_needed',can_record:true}]};
test('a pending rescue condition asks for the assigned assessment rather than another goal',()=>{
 const r=clone(conditionalRun),before=clone(r),f=Flow.next(r);
 assert.equal(f.action,'reviewGoalConditions');assert.match(f.body,/complete goal is approved/);
 assert.deepEqual(r,before);assert.deepEqual(Flow.contacts(r),[]);
});
test('unknown conditions prevent completion even with stale finished helper progress',()=>{
 const r=clone(conditionalRun);r.actions.forEach(a=>a.progress='finished');
 assert.notEqual(Flow.next(r).action,'completeRescue');
});
test('unused branch is not a helper required to fabricate finished progress',()=>{
 const r=clone(conditionalRun);r.plan.requirements[1].gate_state='not_needed';r.plan.requirements[2].gate_state='eligible';
 r.actions=[{status:'confirmed',progress:'finished'},{status:'confirmed',progress:'ready',not_required:true}];
 r.decision_options[0].can_record=false;assert.equal(Flow.next(r).action,'completeRescue');
});
test('unfinished chosen branch still prevents close after assessment',()=>{
 const r=clone(conditionalRun);r.plan.requirements[1].gate_state='not_needed';r.plan.requirements[2].gate_state='eligible';
 r.decision_options[0].can_record=false;assert.equal(Flow.next(r).kind,'tracking');
 assert.match(Flow.next(r).body,/Only the matching branch/);
});
for(const props of [{scope_warning:'Changed scope'},{legacy:true},{engine_version:2},{activity:{uncertain:true}},{status:'completed'},{status:'starting'}]){
 test(`stale assessment hint is not actionable for ${JSON.stringify(props)}`,()=>{
  assert.notEqual(Flow.next({...clone(conditionalRun),...props}).action,'reviewGoalConditions');
 });
}
