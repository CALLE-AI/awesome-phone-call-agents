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
    r=w.prepare('customer_zhang','回访')
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
    with pytest.raises(ValueError,match='禁止写入'):restored.crm.apply(r,r['batch'],'forced')
    with pytest.raises(ValueError,match='仅预览'):restored.resolve(r['id'],'anything','approve')


def test_preview_uses_original_fixture_without_erasing_legacy_database(tmp_path):
    path=str(tmp_path/'legacy.sqlite3')
    writer=Workflow(Settings(db_path=path,preview_only=False))
    r=writer.prepare('customer_zhang','回访');r=writer.approve(r['id'],r['revision'],True)
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
    assessment.policy_uses=[PolicyUse(source_id=chosen['id'],excerpt=chosen['text'].split('\n')[0],reason='B超过预算，准备贷款边界解释，不能鼓励客户加预算')]
    validate_assessment(assessment,ctx)
    curated=selected_context(ctx,assessment)
    assert [e['id'] for e in curated['knowledge_library']]==[chosen['id']]
    plan=plan_offline('回访',assessment,curated)
    task=compile_task(plan,assessment,ctx)
    assert chosen['title'] in task
    assert 'kb_sh_newhome_points' not in task
    assert chosen['source'] in curated['knowledge_library'][0]['source']
    assert chosen['source'] not in task  # Provenance stays in the local snapshot.
    assert chosen['effective'] in task
    assert '使用条件：' in task
    invalid=assessment.model_copy(deep=True);invalid.policy_uses[0].excerpt='客户肯定能贷满'
    with pytest.raises(ValueError,match='原文'):validate_assessment(invalid,ctx)
    future=copy.deepcopy(ctx);next(e for e in future['knowledge_library'] if e['id']==chosen['id'])['effective']='2099-01-01'
    with pytest.raises(ValueError,match='尚未生效'):validate_assessment(assessment,future)


def test_task_is_a_readable_projection_not_an_internal_analysis_dump(tmp_path):
    w=Workflow(Settings(db_path=str(tmp_path/'projection.sqlite3')))
    ctx=w.crm.context('customer_zhang')
    assessment=assess_offline(ctx)
    plan=plan_offline('跟进张女士上次看房情况',assessment,ctx)
    before=assessment.model_dump()
    task=compile_task(plan,assessment,ctx)
    assert task.startswith('身份与目标\n你是经纪人委托的AI回访助手。联系张女士，分别了解两套房的看房反馈、需求变化和下一步意愿。')
    for title in ['任务目标','通话上下文','规划沟通内容','执行策略与边界','预期输出']:
        assert '\n\n'+title+'\n' in task
    for field in ['excluded','insights','confidence','source_ids','selected_sources','action','customer_profile','source_initial']:
        assert field not in task
    assert assessment.model_dump()==before
    assert assessment.insights and plan.communication_topics[0].source_ids
    assert 'p1对应A 浦东花园' in task and 'p2对应B 滨江公馆' in task


def test_precall_snapshot_does_not_contain_followup_tradeoff(tmp_path):
    from real_estate_buyer_followup.storage import fixture
    w=Workflow(Settings(db_path=str(tmp_path/'chronology.sqlite3')))
    before=w.crm.context('customer_zhang')
    history=before['communications']
    assert [x['recorded_at'] for x in history]==['2026-10-12','2026-10-20','2026-10-30']
    signal=next(x for x in history if x['id']=='source_preference_change')
    assert '客厅' in signal['text'] and '再比较' in signal['text']
    assert '远一点' not in signal['text'] and '更重要' not in signal['text']
    assert '优先级未确认' in before['customer']['preferences']['living_room_priority']
    assert all(not v['feedback'] for v in before['viewings'])
    r=w.prepare('customer_zhang','回访')
    # Deliberately misleading old model summary must not become factual context.
    r['plan']['call_context']={'客户与任务背景':'空间优先，可适当放宽地铁距离'}
    plan=Plan.model_validate(r['plan'])
    plan.verification_items=['两套房源的实际价格是否与带看时资料一致？']
    assessment=Assessment.model_validate(r['assessment'])
    assessment.policy_questions=['地铁距离具体是多少？']
    task=compile_task(plan,assessment,r['context'])
    assert '01 两套房源的独立反馈' in task and '02 当前购房需求与取舍' in task
    assert '03 后续跟进意愿' in task
    assert '？' not in task and '待核实，不能自行补全' not in task
    assert '空间优先，可适当放宽地铁距离' not in task
    assert '客厅18㎡' in task and '客厅30㎡' in task
    assert '尚未收集实际看房反馈' in task
    after=fixture('replays.json')['preferences']['transcript'][3]['text']
    assert '客厅空间更重要，可以接受离地铁远一点' in after
    assert all(after not in item['text'] for item in history)


def test_new_model_plans_require_directions_and_real_sources(tmp_path):
    from real_estate_buyer_followup.agent.planning import validate_directions
    w=Workflow(Settings(db_path=str(tmp_path/'directions.sqlite3')))
    ctx=w.crm.context('customer_zhang')
    plan=plan_offline('回访',assess_offline(ctx),ctx)
    invalid=plan.model_copy(deep=True)
    invalid.communication_topics[0].content='您喜欢这套房吗？'
    with pytest.raises(ValueError,match='不要写具体问句'):validate_directions(invalid,ctx)
    invalid=plan.model_copy(deep=True)
    invalid.communication_topics[0].source_ids=['invented']
    with pytest.raises(ValueError,match='无效资料'):validate_directions(invalid,ctx)
    assert validate_directions(plan,ctx)==plan


def test_policy_paragraph_selection_copies_source_without_model_rewriting(tmp_path):
    w=Workflow(Settings(db_path=str(tmp_path/'paragraphs.sqlite3')))
    ctx=w.crm.context('customer_zhang');ctx['knowledge_library']=load_knowledge()
    a=assess_offline(ctx)
    e=next(e for e in ctx['knowledge_library'] if e['id']=='kb_sh_newhome_points')
    a.policy_uses=[PolicyUse(source_id=e['id'],paragraph_indices=[0],excerpt='模型误改的文字',reason='解释新房积分机制')]
    validate_assessment(a,ctx)
    assert a.policy_uses[0].excerpt==e['paragraphs'][0]['text']
    a.policy_uses[0].paragraph_indices=[99]
    with pytest.raises(ValueError,match='段落编号'):validate_assessment(a,ctx)


def test_focused_model_selection_uses_only_library_ids_and_extracts_paragraph(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import PolicySelection
    w=Workflow(Settings(db_path=str(tmp_path/'focused.sqlite3')))
    ctx=w.crm.context('customer_zhang');ctx['knowledge_library']=load_knowledge()
    e=next(e for e in ctx['knowledge_library'] if e['id']=='kb_sh_newhome_points')
    def selected(self,model,instructions,data):
        assert model is PolicySelection
        assert all(sid.startswith('kb_') for sid in data['available_sources'])
        assert data['objective']=='解释积分'
        return PolicySelection(policy_uses=[PolicyUse(source_id=e['id'],paragraph_indices=[0],reason='客户明确问积分')],policy_questions=['先确认新房还是二手房'])
    monkeypatch.setattr(Intelligence,'_json',selected)
    value=Intelligence(Settings(),mode='doubao').select_policy('解释积分',ctx)
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
            return PolicySelection(policy_uses=[PolicyUse(source_id='kb_sh_newhome_points',paragraph_indices=[0],reason='解释积分机制')],policy_questions=['新房还是二手房未知'])
        def plan(self,o,a,c):
            calls.append('plan')
            assert a.policy_uses[0].excerpt
            return plan_offline(o,a,selected_context(c,a))
    monkeypatch.setattr(w,'_ai',lambda *args:AI())
    r=w.prepare('customer_zhang','解释积分')
    assert calls==['understand','select','plan']
    r=w.approve(r['id'],r['revision'],True)
    assert '新房积分' in r['request']['task']
    assert 'kb_sh_commercial_mortgage' not in r['request']['task']


def test_file_selection_limits_knowledge_snapshot_and_preserves_old_document(tmp_path):
    from real_estate_buyer_followup.knowledge import knowledge_files,KNOWLEDGE_DIR
    catalog=knowledge_files()
    assert [f['name'] for f in catalog]==['看房反馈分析与回访指导.md','购房政策 FAQ.md']
    assert (KNOWLEDGE_DIR/'shanghai-homebuying.md').exists()
    guide=load_knowledge(['followup_guide'])
    assert len(guide)==2 and all(e['document_id']=='followup_guide' for e in guide)
    assert len(load_knowledge(['purchase_faq']))==5
    assert load_knowledge([])==[]
    w=Workflow(Settings(db_path=str(tmp_path/'files.sqlite3')))
    r=w.prepare('customer_zhang','回访',knowledge_file_ids=['followup_guide'])
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
    assert '区分预算绝对无法提高与性价比不满意' in request['task']
    assert '若张女士提及地铁距离可放宽' in request['task']
    assert '？' not in request['task'] and '待核实，不能自行补全' not in request['task']
    assert 'p1对应A 浦东花园' in request['task'] and 'p2对应B 滨江公馆' in request['task']
    assert 'source_ids' not in request['task'] and 'confidence' not in request['task']
