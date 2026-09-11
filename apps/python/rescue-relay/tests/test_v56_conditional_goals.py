"""Conditional goal and workflow regressions. All models/calls are local fixtures."""
import asyncio
from contextlib import closing
from copy import deepcopy
import json

import pytest
import app as relay
from coordinator import (Coordinator, RescueDefinition, PlannerUnavailable, build_coverage,
                         scope_issue, rule_analysis, validate_analysis, contact_supports)
from calling import call_task, scripted_conversation, start_call_task
from conditional_plan import (fallback_definition, gate_states, validate_graph, bind_rules)
from goal_dialogue import SCOPE_QUESTION
from intake import rule_review, validate_review, INSTRUCTION
from rescue_intent import conditional_goal, conditional_transport, extract_goal
from test_v51_plans import start, add
from test_rescue_flow import execute

WORDS = 'i want a scenario where IF he needs a clinic then transport else just feed him'
GOAL = 'Arrange an on-site veterinary assessment; if clinic care is necessary, transport the dog to an agreed receiving clinic; otherwise arrange appropriate feeding.'
ORIGINAL = 'An on-site veterinary assessment and feeding, with transport to a clinic only if the professional assessment confirms medical necessity.'
REPORT = {'summary': 'A malnourished dog is at the traffic stop at the Oakland Park junction.',
          'location': 'traffic stop at the oakland park junction', 'animal_type': 'dog', 'expected_outcome': ''}
CAPS = ['veterinary_assessment', 'safe_containment', 'transport', 'receiving_care', 'feeding']


def data(words=WORDS, original=''):
    return {'report': {**REPORT, 'expected_outcome': original},
            'messages': [{'role': 'user', 'text': words}], 'new_reply': True}


def semantic(d, goal=GOAL, **changes):
    latest = d['messages'][-1]['text'] if d['messages'] else d['report']['expected_outcome']
    result = {'understanding': 'You want an assessment, transport only when clinically needed, and otherwise feeding. These are branches of one rescue goal.',
        'location': d['report']['location'], 'animal_type': 'dog', 'expected_outcome': goal,
        'outcome_quote': latest, 'location_quote': '', 'animal_quote': '', 'questions': [], 'goal_options': [],
        'goal_assessment': {'status': 'actionable', 'source': 'explicit', 'source_quotes': [latest],
            'matches_report': True, 'within_scope': True, 'preserves_constraints': True,
            'updates_goal': bool(d['report']['expected_outcome'] and d['report']['expected_outcome'] != goal),
            'rationale': 'Both requested outcomes address the reported animal-welfare concern.',
            'required_capabilities': CAPS}}
    result['goal_assessment'].update(changes)
    return result


def rules(d):
    return validate_review(rule_review(d), d)


def planner():
    p=Coordinator();p.enabled=p.required=False
    return p


def definition(goal=GOAL):
    return asyncio.run(planner().define({**REPORT, 'expected_outcome': goal}))


def test_exact_reported_conversation_accepts_whole_if_else_goal_without_stage_menu():
    d=data(original=ORIGINAL)
    d['goal_clarification']={'kind':'conditional', 'goal':ORIGINAL, 'question':SCOPE_QUESTION}
    raw=semantic(d)
    raw['questions']=[{'field':'expected_outcome','question':SCOPE_QUESTION}]
    r=validate_review(raw,d)
    assert r['ready'] and r['expected_outcome']==GOAL
    assert not r['questions'] and r['goal_clarification'] is None
    assert r['goal_choices']==[{'label':'Use this conditional rescue goal','reply':GOAL,'kind':'goal'}]
    assert 'otherwise feeding' in r['understanding']
    assert 'new plan and your approval' not in json.dumps(r)


@pytest.mark.parametrize('words', [WORDS, GOAL,
    'Please assess him, feed him, and take him to a clinic only if necessary.',
    'Arrange feeding unless the veterinarian says clinic care is required; then arrange transport.',
    'Arrange appropriate temporary care if an owner is not verified, otherwise reunite the dog with the verified owner.'])
def test_conditional_intake_does_not_force_a_choice_even_in_the_limited_fallback(words):
    r=rules(data(words))
    assert r['ready'] and conditional_goal(r['expected_outcome'])
    assert not r['questions'] and len(r['goal_choices'])==1


def test_fallback_preserves_else_and_feeding_and_the_exact_user_goal():
    r=rules(data())
    assert r['expected_outcome']==WORDS
    assert 'else just feed him' in extract_goal(WORDS)
    assert 'choice before finding help' not in r['scope_note']


@pytest.mark.parametrize('new_reply', [True, False])
def test_saved_obsolete_stage_question_does_not_survive_reload_or_yes(new_reply):
    d=data('yes',GOAL);d['new_reply']=new_reply
    d['goal_clarification']={'kind':'conditional','goal':GOAL,'question':SCOPE_QUESTION}
    r=rules(d)
    assert r['ready'] and r['expected_outcome']==GOAL and not r['questions']


def test_exact_legacy_menu_echo_is_retired_but_real_targeted_questions_are_not():
    d=data();raw=semantic(d,status='needs_clarification')
    raw['questions']=[{'field':'expected_outcome','question':SCOPE_QUESTION}]
    raw['understanding']+=' '+SCOPE_QUESTION
    assert validate_review(raw,d)['ready']
    raw=semantic(d,status='needs_clarification')
    raw['questions']=[{'field':'expected_outcome','question':'Should temporary shelter also be arranged when the clinic cannot receive him?'}]
    r=validate_review(raw,d)
    assert not r['ready'] and r['questions']==raw['questions']


def test_missing_location_is_not_a_reason_to_reopen_conditional_goal():
    d=data();d['report']['location']=''
    r=validate_review(semantic(d),d)
    assert not r['ready'] and r['expected_outcome']==GOAL
    assert [q['field'] for q in r['questions']]==['location']
    assert r['goal_choices'][0]['kind']=='goal'


@pytest.mark.parametrize('bad_goal', [
    'Transport the dog to a clinic now.',
    'Assess the dog and arrange transport if clinic care is necessary.',
])
def test_semantic_paraphrase_cannot_drop_if_or_else(bad_goal):
    d=data()
    with pytest.raises(ValueError):validate_review(semantic(d,bad_goal),d)


def test_optional_buttons_cannot_replace_the_whole_goal_with_just_one_branch():
    d=data();raw=semantic(d)
    raw['goal_options']=[{'label':'Transport now','reply':'Arrange unconditional transport to a clinic.',
        'source_quote':WORDS,'matches_report':True,'within_scope':True},
        {'label':'Assessment and possible transport','reply':'Assess and transport the dog if needed.',
        'source_quote':WORDS,'matches_report':True,'within_scope':True}]
    r=validate_review(raw,d)
    assert len(r['goal_choices'])==1 and r['goal_choices'][0]['reply']==GOAL


def test_condition_does_not_make_an_out_of_scope_errand_valid():
    d=data('If the dog wants a burger, order mac and cheese; otherwise buy a burger.')
    r=validate_review(semantic(d,d['messages'][-1]['text']),d)
    assert not r['ready'] and not r['goal_choices']


def test_prompt_allows_unknown_future_conditions_and_does_not_teach_forced_stage_choice():
    assert 'currently approves one actionable stage at a time' not in INSTRUCTION
    assert 'Unknown is neither true nor false' in INSTRUCTION
    assert 'ELSE' in INSTRUCTION and 'not a missing' in INSTRUCTION


def test_confirming_conditional_goal_saves_only_report_not_calls(client):
    r=client.post('/api/incidents',json={**REPORT,'expected_outcome':GOAL,'goal_confirmed':True})
    assert r.status_code==201,r.text
    assert r.json()['expected_outcome']==GOAL
    with closing(relay.connect()) as db:
        assert db.execute('SELECT count(*) FROM calls').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM coordination_runs').fetchone()[0]==0


def test_planner_preserves_assessment_then_true_transport_and_false_feeding():
    d=definition();states=gate_states(d)
    assert d['goal']==GOAL and len(d['decisions'])==1
    by_id={n['id']:n for n in d['requirements']}
    assert states['veterinary_assessment']=='initial'
    assert by_id['transport']['gates']==[{'decision_id':'clinic_needed','when':True}]
    assert by_id['feeding']['gates']==[{'decision_id':'clinic_needed','when':False}]
    assert set(states.values())=={'initial','pending'}
    assert 'value' not in d['decisions'][0]


def test_feeding_regardless_is_not_confused_with_else_only_feeding():
    d=definition(ORIGINAL)
    by_id={n['id']:n for n in d['requirements']}
    assert not by_id['feeding']['gates']
    assert by_id['feeding']['after']==['veterinary_assessment']
    assert by_id['transport']['gates']


@pytest.mark.parametrize('bad_value',[None,'false',0,1,{},[]])
def test_unknown_or_malformed_results_never_activate_the_else_branch(bad_value):
    states=gate_states(definition(),{'clinic_needed':{'value':bad_value}})
    assert states['feeding']=='pending' and states['transport']=='pending'


@pytest.mark.parametrize('value',[True,False])
def test_only_matching_branch_becomes_eligible(value):
    states=gate_states(definition(),{'clinic_needed':{'value':value}})
    assert states['transport']==('eligible' if value else 'not_needed')
    assert states['feeding']==('not_needed' if value else 'eligible')


@pytest.mark.parametrize('mutation', ['flat','omit_else','omit_feeding','ungated_transport','ungated_feeding','ungrounded','wrong_assessor'])
def test_invalid_flattened_or_ungrounded_plans_are_rejected(mutation):
    d=definition();d.pop('_meta')
    if mutation=='flat':d['decisions']=[];[n.update(gates=[]) for n in d['requirements']]
    elif mutation=='omit_else':
        d['requirements']=[n for n in d['requirements'] if n['id']!='feeding']
    elif mutation=='omit_feeding':
        next(n for n in d['requirements'] if n['id']=='feeding').update(id='scene_observation',label='Observe from a distance')
    elif mutation in {'ungated_transport','ungated_feeding'}:
        next(n for n in d['requirements'] if n['id']==mutation.removeprefix('ungated_')).update(gates=[])
    elif mutation=='ungrounded':d['decisions'][0]['source_quote']='Made up authorization from someone else'
    else:d['decisions'][0]['assessed_by']='feeding'
    assert scope_issue(GOAL,d)


def test_model_cannot_flatten_conditional_goal_and_backup_explains_rejection(monkeypatch):
    p=planner();p.enabled=True
    async def bad(*_):return {'goal':GOAL,'requirements':[{'id':'transport','label':'Transport to a clinic','reason':'Send a driver now.'}]}
    monkeypatch.setattr(p,'_json',bad)
    d=asyncio.run(p.define({**REPORT,'expected_outcome':GOAL}))
    assert d['_meta']['engine']=='rules' and d['decisions']
    assert 'conditional' in d['_meta']['fallback_reason'].lower()


def test_model_path_supports_a_nonmedical_condition_without_a_canned_service_menu(monkeypatch):
    goal='Arrange reunification if the dog’s owner is verified; otherwise arrange temporary foster care.'
    raw={'goal':goal,'decisions':[{'id':'owner_verified','condition':'the reported owner is verified',
        'source_quote':goal,'assessed_by':'verify_owner'}], 'requirements':[
        {'id':'verify_owner','label':'Verify the owner','reason':'Establish the legitimate owner.'},
        {'id':'reunification','label':'Safe reunification','reason':'Return to the verified owner.',
         'gates':[{'decision_id':'owner_verified','when':True}]},
        {'id':'temporary_foster','label':'Temporary foster care','reason':'Safe care while an owner is not verified.',
         'gates':[{'decision_id':'owner_verified','when':False}]}]}
    p=planner();p.enabled=p.required=True
    async def fixture(*_):return raw
    monkeypatch.setattr(p,'_json',fixture)
    d=asyncio.run(p.define({**REPORT,'expected_outcome':goal}))
    assert d['_meta']['engine']=='llm' and len(d['decisions'])==1
    assert gate_states(d,{'owner_verified':{'value':False}})['temporary_foster']=='eligible'


def test_complex_condition_fallback_stops_instead_of_discarding_the_goal():
    goal='Arrange transport to a clinic if it can accept him; otherwise coordinate temporary foster care.'
    with pytest.raises(PlannerUnavailable,match='complete conditional goal is saved'):
        asyncio.run(planner().define({**REPORT,'expected_outcome':goal}))


@pytest.mark.parametrize('mutation',['unknown_condition','unknown_assessor','cycle','duplicate_gate','contradiction','invented_result'])
def test_conditional_graph_rejects_dangling_cycles_and_model_written_results(mutation):
    d=definition();d.pop('_meta')
    transport=next(n for n in d['requirements'] if n['id']=='transport')
    if mutation=='unknown_condition':transport['gates'][0]['decision_id']='missing'
    elif mutation=='unknown_assessor':d['decisions'][0]['assessed_by']='missing'
    elif mutation=='cycle':d['requirements'][0]['after']=['transport']
    elif mutation=='duplicate_gate':transport['gates']*=2
    elif mutation=='contradiction':transport['after']=['feeding']
    else:d['decisions'][0]['value']=True
    with pytest.raises(ValueError):RescueDefinition.model_validate(d)


def test_nested_conditions_require_all_parent_gates_and_do_not_force_unused_decisions():
    d=definition();d.pop('_meta')
    d['requirements'].append({'id':'check_capacity','label':'Check clinic capacity','reason':'Verify appropriate receiving care.',
        'gates':[{'decision_id':'clinic_needed','when':True}]})
    d['decisions'].append({'id':'capacity','condition':'the receiving clinic confirms capacity','source_quote':GOAL,'assessed_by':'check_capacity'})
    transport=next(n for n in d['requirements'] if n['id']=='transport')
    transport['gates'].append({'decision_id':'capacity','when':True})
    validate_graph(d)
    assert gate_states(d,{'clinic_needed':{'value':False}})['transport']=='not_needed'
    assert gate_states(d,{'clinic_needed':{'value':True}})['transport']=='pending'
    assert gate_states(d,{'clinic_needed':{'value':True},'capacity':{'value':True}})['transport']=='eligible'


def test_inquiry_keeps_both_branches_and_does_not_authorize_travel():
    d=definition();coverage=build_coverage(d,[])
    task=call_task({**REPORT,'expected_outcome':GOAL},{'name':'Trusted vet','description':'Veterinary assessment'},d,coverage)
    assert GOAL in task and 'goal_decisions' in task and 'feeding' in task
    assert 'Unknown is not a negative assessment' in task
    assert 'please do not start work or travel' in task


def test_an_offer_for_the_user_condition_is_not_a_new_supervisor_prerequisite():
    d=definition();coverage=build_coverage(d,[]);contact={'name':'Trusted driver'}
    identity='Yes, this is Trusted driver. I can speak for our team.'
    offer='I confirm we can transport the dog only if the veterinary assessment finds clinic care medically necessary.'
    evidence={'transcript':[{'speaker':'recipient','text':identity},{'speaker':'recipient','text':offer}]}
    r=rule_analysis(REPORT,d,evidence,contact,coverage)
    assert next(a for a in r['assessments'] if a['requirement_id']=='transport')['status']=='committed'
    evidence['transcript'][-1]['text']=offer[:-1]+' and if our supervisor approves.'
    r=rule_analysis(REPORT,d,evidence,contact,coverage)
    assert next(a for a in r['assessments'] if a['requirement_id']=='transport')['status']=='conditional'


def test_callback_requires_recipient_readback_and_cannot_infer_acceptance():
    d=definition();need=next(n for n in bind_rules(d)['requirements'] if n['id']=='transport')
    contact={'name':'Trusted driver'}
    evidence={'transcript':[{'speaker':'recipient','text':'Yes, this is Trusted driver. I can speak for our team.'},
        {'speaker':'recipient','text':f'I confirm I accept {need["label"]}; ready now.'}]}
    p=planner();r=asyncio.run(p.confirm_start(contact,[need],evidence))
    assert r['status']=='conditional' and not r['confirmed_requirement_ids']
    # Assistant-only claims cannot acknowledge scope on the recipient's behalf.
    evidence['transcript'].insert(1,{'speaker':'assistant','text':need['start_rule']})
    assert asyncio.run(p.confirm_start(contact,[need],evidence))['status']=='conditional'
    evidence['transcript'].insert(1,{'speaker':'recipient','text':'I confirm this start rule: '+need['start_rule']})
    r=asyncio.run(p.confirm_start(contact,[need],evidence))
    assert r['status']=='confirmed' and 'standby' in r['summary']


def setup_run(client,split=False):
    with closing(relay.connect()) as db:
        db.execute('UPDATE businesses SET active=0');db.commit()
    if split:
        add(client,'Visiting vet',['veterinary_assessment'],price=500)
        add(client,'Conditional transport team',['safe_containment','transport','receiving_care'],price=1000)
        add(client,'Feeding helper',['feeding'],price=200)
    else:
        add(client,'Complete conditional team',CAPS,price=1500)
    run=start(client,{**REPORT,'expected_outcome':GOAL,'goal_confirmed':True})
    assert run['status']=='covered', json.dumps(run.get('events',[]))
    assert not run['scope_warning'] and len(run['plan']['decisions'])==1
    return run


def record(client,run,value=False,note='The assigned veterinary professional reported this assessment after examining the dog.'):
    return client.post(f'/api/runs/{run["id"]}/decisions/clinic_needed',json={
        'plan_token':run['plan_token'],'value':value,'confirmed_assessment':True,'note':note})


def counts():
    with closing(relay.connect()) as db:
        return tuple(db.execute('SELECT count(*) FROM '+table).fetchone()[0] for table in ('calls','rescue_actions','provider_requests'))


@pytest.mark.parametrize('value',[True,False])
def test_full_lifecycle_activates_only_matching_branch_without_extra_calls_or_fake_completions(client,value):
    run=setup_run(client,split=True)
    assert record(client,run,value).status_code==409  # no execution before plan approval
    run=execute(client,run)
    assert run['status']=='active',json.dumps(run['actions'])
    assert len(run['decision_options'])==1 and run['decision_options'][0]['can_record']
    pending=[a for a in run['actions'] if a['waiting_for_condition']]
    assert len(pending)==2
    for action in pending:
        response=client.post(f'/api/actions/{action["id"]}/progress',json={'progress':'arrived' if action['stationary'] else 'on_the_way'})
        assert response.status_code==409
    before=counts()
    reply=record(client,run,value);assert reply.status_code==200,reply.text
    assert counts()==before and reply.json()['calls_placed']==0
    run=client.get('/api/runs/'+run['id']).json()
    states={n['id']:n['gate_state'] for n in run['plan']['requirements']}
    assert states['transport']==('eligible' if value else 'not_needed')
    assert states['feeding']==('not_needed' if value else 'eligible')
    assert run['report_snapshot']['goal']==GOAL
    assert not run['decision_options'][0]['can_record']
    for action in run['actions']:
        if action['not_required']:
            assert action['progress']=='ready'  # never fabricated as finished
            assert client.post(f'/api/actions/{action["id"]}/progress',json={'progress':'on_the_way'}).status_code==409
            continue
        for step in (['arrived','finished'] if action['stationary'] else ['on_the_way','arrived','finished']):
            response=client.post(f'/api/actions/{action["id"]}/progress',json={'progress':step,'note':'Reported by the helper.'})
            assert response.status_code==200,response.text
    response=client.post(f'/api/runs/{run["id"]}/complete',json={'confirmed_safe':True,'note':'The selected branch is complete and the animal is safe.'})
    assert response.status_code==200,response.text
    assert counts()==before
    saved=client.get('/api/runs/'+run['id']).json()
    assert saved['status']=='completed' and saved['decision_results']['clinic_needed']['source']=='reporter'


def test_result_replay_is_idempotent_and_cannot_change_to_the_opposite_branch(client):
    run=execute(client,setup_run(client))
    before=counts()
    assert record(client,run).status_code==200
    again=record(client,run)
    assert again.status_code==200 and again.json()['status']=='already_recorded'
    assert record(client,run,True).status_code==409
    assert counts()==before


def test_recording_result_requires_explicit_assessment_evidence_and_current_plan(client):
    run=execute(client,setup_run(client))
    body={'plan_token':run['plan_token'],'value':False,'confirmed_assessment':True,'note':'The vet reported that clinic care is not required.'}
    path=f'/api/runs/{run["id"]}/decisions/clinic_needed'
    for changes,status in [({'confirmed_assessment':False},422),({'note':'yes'},422),({'value':None},422),
        ({'value':0},422),({'value':'false'},422),({'plan_token':'0'*64},409)]:
        response=client.post(path,json={**body,**changes});assert response.status_code==status,response.text
    assert client.get('/api/runs/'+run['id']).json()['decision_results']=={}


def test_unknown_result_blocks_completion_and_mixed_helper_finishing(client):
    run=execute(client,setup_run(client))
    action=run['actions'][0]
    for step in ['on_the_way','arrived']:
        assert client.post(f'/api/actions/{action["id"]}/progress',json={'progress':step}).status_code==200
    assert client.post(f'/api/actions/{action["id"]}/progress',json={'progress':'finished'}).status_code==409
    assert client.post(f'/api/runs/{run["id"]}/complete',json={'confirmed_safe':True,'note':'The animal is safe.'}).status_code==409


def test_reported_assessment_persists_across_additive_migration_and_restart(client):
    run=execute(client,setup_run(client));assert record(client,run).status_code==200
    before=counts();relay.init_db()
    after=client.get('/api/runs/'+run['id']).json()
    assert after['decision_results']['clinic_needed']['value'] is False
    assert after['decision_results']['clinic_needed']['assessor_name']=='Complete conditional team'
    assert counts()==before


def test_callback_fact_sheet_keeps_full_goal_rules_and_original_price_ceiling(client):
    run=execute(client,setup_run(client,split=True))
    for action in run['actions']:
        facts=action['message']['fact_sheet']
        assert GOAL in facts and 'unknown is neither YES nor NO' in facts
        assert 'never perform both' in facts.lower()
        assert 'new rescue goal' in facts and 'ceiling is USD' in facts
        assert 'Do not ask a conditional driver or handler to begin work or travel now' in facts
        assert 'begin each assigned task at this location' not in facts
        assert 'gated tasks remain on standby' in start_call_task(REPORT,{'name':'A helper'},facts).lower() or 'conditional tasks' in start_call_task(REPORT,{'name':'A helper'},facts).lower()

@pytest.mark.parametrize('words', ['assessment first', 'on-site veterinary assessment first', 'the first option', 'second option', 'that is all'])
def test_order_reminder_or_completion_never_erases_a_previously_understood_else(words):
    r=rules(data(words,GOAL))
    assert r['ready'] and r['expected_outcome']==GOAL and len(r['goal_choices'])==1


def test_latest_else_constraint_cannot_be_lost_behind_a_stale_quote():
    d=data(original=ORIGINAL);raw=semantic(d,goal=ORIGINAL)
    raw['goal_assessment'].update(updates_goal=True,source_quotes=[ORIGINAL,WORDS])
    with pytest.raises(ValueError,match='alternative branch'):
        validate_review(raw,d)


def test_grounded_semantic_scope_revision_is_not_limited_to_old_stage_menu():
    words='Change this to arranging a qualified responder to provide appropriate food and water. Cancel the clinic contingency in the draft.'
    d=data(words,GOAL)
    new='Arrange appropriate food and water support for the malnourished dog with a qualified responder.'
    raw=semantic(d,new,updates_goal=True,source_quotes=[GOAL,words])
    r=validate_review(raw,d)
    assert r['ready'] and r['expected_outcome']==new


def test_fallback_does_not_truncate_a_late_else_into_an_unconditional_goal():
    words='Please assess the dog and transport him to a clinic if necessary. '+('Arrange veterinary assessment without changing the original branches or budget. '*10)+'Otherwise arrange appropriate feeding.'
    assert len(words)>600 and extract_goal(words)==''
    r=rules(data(words))
    assert not r['ready'] and not r['expected_outcome']


def test_global_no_transport_still_applies_inside_a_conditional_goal():
    goal='No transport. If the verified owner can collect the dog, arrange a safe handover; otherwise arrange appropriate feeding.'
    d=definition()
    for decision in d['decisions']:
        decision['source_quote']=goal
    assert 'excludes' in scope_issue(goal,d)


def test_negative_else_does_not_forbid_a_requested_true_transport_branch():
    goal='Arrange a veterinary assessment; if clinic care is necessary transport him; otherwise no transport.'
    d=definition();d['requirements']=[n for n in d['requirements'] if n['id']!='feeding']
    d['requirements'].append({'id':'welfare_report','label':'Report back without transport','reason':'Communicate the no-transport assessment result.',
        'gates':[{'decision_id':'clinic_needed','when':False}],'after':[]})
    d['decisions'][0]['source_quote']=goal
    assert not scope_issue(goal,d)


def test_fallback_will_not_guess_through_explicit_negated_feeding():
    goal='No feeding. Arrange a veterinary assessment, then transport him to a clinic only if necessary.'
    assert fallback_definition(goal) is None


def test_grounded_model_condition_does_not_require_a_magic_if_word(monkeypatch):
    goal='Arrange a veterinary assessment. Transport depends on its findings, with appropriate feeding in the alternative.'
    raw=definition();raw.pop('_meta');raw['goal']=goal;raw['decisions'][0]['source_quote']=goal
    p=planner();p.enabled=p.required=True
    async def fixture(*_):return raw
    monkeypatch.setattr(p,'_json',fixture)
    d=asyncio.run(p.define({**REPORT,'expected_outcome':goal}))
    assert d['_meta']['engine']=='llm' and d['decisions']


def test_known_then_else_directions_cannot_be_reversed():
    d=definition()
    for n in d['requirements']:
        for g in n.get('gates',[]):g['when']=not g['when']
    assert 'reverse' in scope_issue(GOAL,d)


def test_negative_medical_predicate_requires_model_not_guessed_inversion():
    goal='Arrange transport to a clinic if the examination says care is not necessary; otherwise feed him.'
    assert fallback_definition(goal) is None


def test_inherited_branch_rules_are_carried_into_display_and_callback_contracts():
    d=definition();d['requirements'].append({'id':'arrival_update','label':'Confirm clinic arrival',
        'reason':'Report that the conditional trip reached its agreed receiving location.','after':['transport'],'gates':[]})
    n=next(n for n in bind_rules(d)['requirements'] if n['id']=='arrival_update')
    assert n['effective_gates']==[{'decision_id':'clinic_needed','when':True}]
    assert 'must communicate YES' in n['start_rule']
    assert gate_states(d,{})['arrival_update']=='pending'
