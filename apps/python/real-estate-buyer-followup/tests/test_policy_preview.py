import re
import copy
import json
import pytest
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.knowledge import load_knowledge
from real_estate_buyer_followup.agent.context import assess_offline,validate_assessment,selected_context
from real_estate_buyer_followup.agent.planning import plan_offline,compile_task
from real_estate_buyer_followup.models import PolicyUse,Plan,Assessment


def test_default_preview_never_writes_even_when_confirmed_and_reloaded(tmp_path):
    s=Settings(db_path=str(tmp_path/'preview.sqlite3'))
    w=Workflow(s)
    before=w.crm.context('customer_zhang')
    r=w.prepare('customer_zhang','Follow-up')
    r=w.approve(r['id'],r['revision'],True);w.execute(r['id'])
    for _ in range(2):
        r=w.process(r['id'],confirm_writeback=True)
        assert r['writeback_status']=='preview_only' and r['receipt'] is None
        assert r['batch']['accepted']
    restored=Workflow(s)
    assert restored.crm.context('customer_zhang')==before
    assert not restored.store.history('customer_zhang')
    with restored.store.tx() as db:
        assert db.execute('SELECT count(*) FROM receipts').fetchone()[0]==0
        assert db.execute('SELECT count(*) FROM notifications').fetchone()[0]==0
        assert all(json.loads(row[0])['feedback']==[] for row in db.execute('SELECT data FROM viewings'))
    with pytest.raises(ValueError,match='writes are prohibited'):restored.crm.apply(r,r['batch'],'forced')
    with pytest.raises(ValueError,match='preview-only'):restored.resolve(r['id'],'anything','approve')


def test_preview_uses_original_fixture_without_erasing_legacy_database(tmp_path):
    path=str(tmp_path/'legacy.sqlite3')
    writer=Workflow(Settings(db_path=path,preview_only=False))
    r=writer.prepare('customer_zhang','Follow-up');r=writer.approve(r['id'],r['revision'],True)
    writer.execute(r['id']);writer.process(r['id'],confirm_writeback=True)
    assert all(v['feedback'] for v in writer.crm.context('customer_zhang')['viewings'])
    preview=Workflow(Settings(db_path=path))
    assert all(not v['feedback'] for v in preview.crm.context('customer_zhang')['viewings'])
    assert all(v['feedback'] for v in writer.crm.context('customer_zhang')['viewings'])


def test_knowledge_has_sources_and_only_selected_content_goes_to_task(tmp_path):
    entries=load_knowledge()
    assert len(entries)==7
    assert all((e['source'].startswith('https://') or e['kind']=='broker_guidance') and e['reviewed']=='2026-11-02' for e in entries)
    w=Workflow(Settings(db_path=str(tmp_path/'knowledge.sqlite3')))
    ctx=w.crm.context('customer_zhang');ctx['knowledge_library']=entries
    assessment=assess_offline(ctx)
    chosen=next(e for e in entries if e['id']=='kb_sh_commercial_mortgage')
    assessment.policy_uses=[PolicyUse(source_id=chosen['id'],excerpt=chosen['text'].split('\n')[0],reason='B exceeds the budget; prepare conditional loan guidance without encouraging a budget increase')]
    validate_assessment(assessment,ctx)
    curated=selected_context(ctx,assessment)
    assert [e['id'] for e in curated['knowledge_library']]==[chosen['id']]
    plan=plan_offline('Follow-up',assessment,curated)
    task=compile_task(plan,assessment,ctx)
    assert chosen['title'] in task
    assert 'kb_sh_newhome_points' not in task
    assert chosen['source'] in curated['knowledge_library'][0]['source']
    assert chosen['source'] not in task  # Provenance stays in the local snapshot.
    assert chosen['effective'] in task
    assert 'Applicability:' in task
    invalid=assessment.model_copy(deep=True);invalid.policy_uses[0].excerpt='The customer certainly qualifies for the maximum loan'
    with pytest.raises(ValueError,match='copied from the knowledge source'):validate_assessment(invalid,ctx)
    future=copy.deepcopy(ctx);next(e for e in future['knowledge_library'] if e['id']==chosen['id'])['effective']='2099-01-01'
    with pytest.raises(ValueError,match='not yet effective'):validate_assessment(assessment,future)


def test_task_is_a_readable_projection_not_an_internal_analysis_dump(tmp_path):
    w=Workflow(Settings(db_path=str(tmp_path/'projection.sqlite3')))
    ctx=w.crm.context('customer_zhang')
    assessment=assess_offline(ctx)
    plan=plan_offline("Follow up on Ms. Zhang's recent viewings",assessment,ctx)
    before=assessment.model_dump()
    task=compile_task(plan,assessment,ctx)
    assert task.startswith('Identity and objective\nYou are an AI follow-up assistant acting for the broker. Contact Ms. Zhang for viewing feedback, requirement changes and next-step preferences.')
    for title in ['Task objective','Call context','Communication directions','Execution strategy and boundaries','Expected output']:
        assert '\n\n'+title+'\n' in task
    for field in ['excluded','insights','confidence','source_ids','selected_sources','action','customer_profile','source_initial']:
        assert not re.search(r'\b'+re.escape(field)+r'\b', task)
    assert assessment.model_dump()==before
    assert assessment.insights and plan.communication_topics[0].source_ids
    assert 'p1 maps to A Pudong Garden' in task and 'p2 maps to B Riverside Residence' in task


def test_precall_snapshot_does_not_contain_followup_tradeoff(tmp_path):
    from real_estate_buyer_followup.storage import fixture
    w=Workflow(Settings(db_path=str(tmp_path/'chronology.sqlite3')))
    before=w.crm.context('customer_zhang')
    history=before['communications']
    assert [x['recorded_at'] for x in history]==['2026-10-12','2026-10-20','2026-10-30']
    signal=next(x for x in history if x['id']=='source_preference_change')
    assert 'living-room space also matters' in signal['text'] and 'compare after seeing' in signal['text']
    assert 'farther' not in signal['text'] and 'more important' not in signal['text']
    assert 'priority relative to transport and budget is unconfirmed' in before['customer']['preferences']['living_room_priority']
    assert all(not v['feedback'] for v in before['viewings'])
    r=w.prepare('customer_zhang','Follow-up')
    # Deliberately misleading old model summary must not become factual context.
    r['plan']['call_context']={'Customer and task background':'Space prioritized; metro distance may relax'}
    plan=Plan.model_validate(r['plan'])
    plan.verification_items=['Do the current prices match the viewing records?']
    assessment=Assessment.model_validate(r['assessment'])
    assessment.policy_questions=['What is the exact metro distance?']
    task=compile_task(plan,assessment,r['context'])
    assert '01 Independent feedback for both properties' in task and '02 Current requirements and trade-offs' in task
    assert '03 Follow-up preferences' in task
    assert '?' not in task and 'Unverified; do not infer' not in task
    assert 'Space prioritized; metro distance may relax' not in task
    assert 'Living room 18 m²' in task and 'Living room 30 m²' in task
    assert 'Actual viewing feedback has not yet been collected' in task
    after=fixture('replays.json')['preferences']['transcript'][3]['text']
    assert 'Living-room space matters more now' in after and 'accept a longer metro walk' in after
    assert all(after not in item['text'] for item in history)


def test_new_model_plans_require_directions_and_real_sources(tmp_path):
    from real_estate_buyer_followup.agent.planning import validate_directions
    w=Workflow(Settings(db_path=str(tmp_path/'directions.sqlite3')))
    ctx=w.crm.context('customer_zhang')
    plan=plan_offline('Follow-up',assess_offline(ctx),ctx)
    invalid=plan.model_copy(deep=True)
    invalid.communication_topics[0].content='Do you like this home?'
    with pytest.raises(ValueError,match='not concrete questions'):validate_directions(invalid,ctx)
    invalid=plan.model_copy(deep=True)
    invalid.communication_topics[0].source_ids=['invented']
    with pytest.raises(ValueError,match='invalid sources'):validate_directions(invalid,ctx)
    assert validate_directions(plan,ctx)==plan


def test_policy_paragraph_selection_copies_source_without_model_rewriting(tmp_path):
    w=Workflow(Settings(db_path=str(tmp_path/'paragraphs.sqlite3')))
    ctx=w.crm.context('customer_zhang');ctx['knowledge_library']=load_knowledge()
    a=assess_offline(ctx)
    e=next(e for e in ctx['knowledge_library'] if e['id']=='kb_sh_newhome_points')
    a.policy_uses=[PolicyUse(source_id=e['id'],paragraph_indices=[0],excerpt='Text incorrectly changed by the model',reason='Explain new-home points')]
    validate_assessment(a,ctx)
    assert a.policy_uses[0].excerpt==e['paragraphs'][0]['text']
    a.policy_uses[0].paragraph_indices=[99]
    with pytest.raises(ValueError,match='Paragraph index'):validate_assessment(a,ctx)


def test_focused_model_selection_uses_only_library_ids_and_extracts_paragraph(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import PolicySelection
    w=Workflow(Settings(db_path=str(tmp_path/'focused.sqlite3')))
    ctx=w.crm.context('customer_zhang');ctx['knowledge_library']=load_knowledge()
    e=next(e for e in ctx['knowledge_library'] if e['id']=='kb_sh_newhome_points')
    def selected(self,model,instructions,data):
        assert model is PolicySelection
        assert all(sid.startswith('kb_') for sid in data['available_sources'])
        assert data['objective']=='Explain points'
        return PolicySelection(policy_uses=[PolicyUse(source_id=e['id'],paragraph_indices=[0],reason='Customer explicitly asks about points')],policy_questions=['First establish whether this is a new or resale home'])
    monkeypatch.setattr(Intelligence,'_json',selected)
    value=Intelligence(Settings(),mode='doubao').select_policy('Explain points',ctx)
    assert value.policy_uses[0].excerpt==e['paragraphs'][0]['text']


def test_policy_selection_is_part_of_planning_and_frozen_task(tmp_path,monkeypatch):
    from real_estate_buyer_followup.models import PolicySelection
    w=Workflow(Settings(db_path=str(tmp_path/'stages.sqlite3')))
    calls=[]
    class AI:
        def assess(self,c):
            calls.append('understand');assert c['knowledge_library']==[]
            return assess_offline(c)
        def select_policy(self,o,c):
            calls.append('select')
            return PolicySelection(policy_uses=[PolicyUse(source_id='kb_sh_newhome_points',paragraph_indices=[0],reason='Explain the points mechanism')],policy_questions=['New versus resale home unknown'])
        def plan(self,o,a,c):
            calls.append('plan')
            assert a.policy_uses[0].excerpt
            return plan_offline(o,a,selected_context(c,a))
    monkeypatch.setattr(w,'_ai',lambda *args:AI())
    r=w.prepare('customer_zhang','Explain points')
    assert calls==['understand','select','plan']
    r=w.approve(r['id'],r['revision'],True)
    assert 'New-home points' in r['request']['task']
    assert 'kb_sh_commercial_mortgage' not in r['request']['task']


def test_file_selection_limits_knowledge_snapshot_to_current_documents(tmp_path):
    from real_estate_buyer_followup.knowledge import knowledge_files,KNOWLEDGE_DIR
    catalog=knowledge_files()
    assert [f['name'] for f in catalog]==['viewing-feedback-guide.md','shanghai-purchase-faq.md']
    assert sorted(p.name for p in KNOWLEDGE_DIR.glob('*.md')) == ['shanghai-purchase-faq.md', 'viewing-feedback-guide.md']
    guide=load_knowledge(['followup_guide'])
    assert len(guide)==2 and all(e['document_id']=='followup_guide' for e in guide)
    assert len(load_knowledge(['purchase_faq']))==5
    assert load_knowledge([])==[]
    w=Workflow(Settings(db_path=str(tmp_path/'files.sqlite3')))
    r=w.prepare('customer_zhang','Follow-up',knowledge_file_ids=['followup_guide'])
    assert r['context']['knowledge_files']==['followup_guide']
    assert all(e['document_id']=='followup_guide' for e in r['context']['knowledge_library'])
    r=w.approve(r['id'],r['revision'],True)
    assert w.execute(r['id'])['call']['simulation'] is True


def test_exported_request_is_complete_and_matches_task_and_schema():
    from pathlib import Path
    root=Path(__file__).parents[1]
    request=json.loads((root/'examples/calle-request-preview.json').read_text())
    schema=json.loads((root/'examples/calle-result-schema.json').read_text())
    assert set(request)=={'task','phone','locale','result_schema','metadata','idempotency_key'}
    assert request['phone']=='<SYNTHETIC_NO_CALL>'
    assert request['task']==(root/'examples/calle-task-preview.txt').read_text()
    assert request['result_schema']==schema
    assert len(schema['properties'])==14
    assert set(schema['required'])==set(schema['properties'])
    assert all(p['type']=='string' for p in schema['properties'].values())
    assert 'Distinguish a hard budget ceiling from dissatisfaction with value for money' in request['task']
    assert 'If Ms. Zhang says a longer metro walk is acceptable' in request['task']
    assert '?' not in request['task'] and 'Unverified; do not infer' not in request['task']
    assert 'p1 maps to A Pudong Garden' in request['task'] and 'p2 maps to B Riverside Residence' in request['task']
    assert 'source_ids' not in request['task'] and 'confidence' not in request['task']
