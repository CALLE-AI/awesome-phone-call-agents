import pytest
from pathlib import Path
from streamlit.testing.v1 import AppTest
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.services.workflow import Workflow


APP=Path(__file__).parents[1]/"src/real_estate_buyer_followup/demo/streamlit_app.py"


@pytest.fixture(autouse=True)
def fake_model(monkeypatch):
    # UI always selects Doubao. Tests replace the model boundary, never make
    # real requests or depend on private credentials. Replay remains test data.
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.agent.context import assess_offline
    from real_estate_buyer_followup.agent.planning import plan_offline
    from real_estate_buyer_followup.storage import fixture
    from real_estate_buyer_followup.models import Analysis,PolicySelection
    monkeypatch.setenv('ESTATE_DOUBAO_ANALYSIS_AUTHORIZED','true')
    monkeypatch.setattr(Intelligence,'assess',lambda self,c:assess_offline(c))
    monkeypatch.setattr(Intelligence,'select_policy',lambda self,o,c:PolicySelection(policy_uses=[],policy_questions=[]))
    monkeypatch.setattr(Intelligence,'plan',lambda self,o,a,c:plan_offline(o,a,c))
    monkeypatch.setattr(Intelligence,'analyze',lambda self,r:Analysis.model_validate(fixture('replays.json')[r['replay_case']]['analysis']))


def button(at,label):
    return next(b for b in at.button if b.label==label)


def test_full_broker_ui_walkthrough(tmp_path,monkeypatch):
    db=str(tmp_path/"ui.sqlite3")
    monkeypatch.setenv("ESTATE_DB",db)
    monkeypatch.setenv("ESTATE_ANALYSIS_MODE","replay")
    monkeypatch.setenv("ESTATE_ENABLE_LIVE","false")
    at=AppTest.from_file(APP,default_timeout=30).run()
    assert not at.exception
    assert not Workflow(Settings(db_path=db)).store.list_runs()
    button(at,"生成 Agent 规划 →").click().run()
    assert not at.exception
    assert at.radio[0].value=='② Agent Planning'
    assert any(h.value=='Agent Planning' for h in at.header)
    assert not any(b.label=='生成 Agent 规划 →' for b in at.button)
    w=Workflow(Settings(db_path=db))
    r=w.store.list_runs()[0]
    assert r["status"]=="pending_approval" and r["call"] is None
    assert not button(at,"批准并进入通话").disabled
    button(at,"批准并进入通话").click().run()
    assert not at.exception
    assert w.store.list_runs()[0]["call"] is None
    assert at.radio[0].value=="③ 通话执行"
    button(at,"执行电话回放并处理结果").click().run()
    assert not at.exception
    assert at.radio[0].value=='④ 结果与更新'
    assert w.store.list_runs()[0]['status']=='pending_writeback_approval'
    assert not w.store.history('customer_zhang')
    at.run()  # Rendering must not apply the proposed changes.
    assert not w.store.history('customer_zhang')
    assert not any(b.label=='确认并更新 Mock CRM' for b in at.button)
    assert w.store.list_runs()[0]['writeback_status']=='preview_only'
    assert not w.store.history('customer_zhang')
    at.radio[0].set_value('① 任务准备').run()
    assert all(not v['feedback'] for v in w.crm.context('customer_zhang')['viewings'])
    reopened=AppTest.from_file(APP,default_timeout=30).run()
    assert not reopened.exception
    assert not w.store.history('customer_zhang')
    assert len(w.store.list_runs())==1


def test_mock_analysis_error_retries_analysis_without_executing_call_again(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.integrations.calle import FakeProvider
    from real_estate_buyer_followup.models import Analysis
    from real_estate_buyer_followup.storage import fixture
    db=str(tmp_path/'mock-analysis-retry.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    calls=[];analyses=[]
    original=FakeProvider.submit
    def submit(self,request,key):calls.append(key);return original(self,request,key)
    def analyze(self,run):
        analyses.append(run['id'])
        if len(analyses)==1:raise ValueError('豆包结果分析JSON字段不符合要求，请重试分析')
        return Analysis.model_validate(fixture('replays.json')['preferences']['analysis'])
    monkeypatch.setattr(FakeProvider,'submit',submit);monkeypatch.setattr(Intelligence,'analyze',analyze)
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    button(at,'批准并进入通话').click().run()
    button(at,'执行电话回放并处理结果').click().run()
    w=Workflow(Settings(db_path=db));failed=w.store.list_runs()[0]
    assert not at.exception and len(calls)==1 and failed['status']=='processing_failed'
    assert failed['extraction_status']=='failed' and len(at.error)==1
    button(at,'重试结果分析（不重拨）').click().run()
    assert not at.exception and len(calls)==1 and len(analyses)==2
    assert at.radio[0].value=='④ 结果与更新'
    assert not w.store.history('customer_zhang')


def test_prepare_offers_fixed_mock_or_explicit_live_number(tmp_path,monkeypatch):
    db=str(tmp_path/'phone-options.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('CALLE_API_KEY','')
    at=AppTest.from_file(APP,default_timeout=30).run()
    mode=next(r for r in at.radio if r.label=='通话方式')
    assert mode.value=='fake' and list(mode.options)==['Mock 演示','输入手机号真实拨打']
    assert not any(s.label=='模拟通话案例' for s in at.selectbox)
    button(at,'生成 Agent 规划 →').click().run()
    w=Workflow(Settings(db_path=db));r=w.store.list_runs()[0]
    assert r['replay_case']=='preferences' and r['mode']=='fake' and r['call'] is None
    at.radio[0].set_value('① 任务准备').run()
    next(r for r in at.radio if r.label=='通话方式').set_value('live').run()
    assert any(t.label=='接听手机号' for t in at.text_input)
    assert any('CALLE_API_KEY' in x.value for x in at.info)
    next(t for t in at.text_input if t.label=='接听手机号').input('+12025550123')
    button(at,'生成 Agent 规划 →').click().run()
    assert not at.exception and any('CALLE_API_KEY' in x.value for x in at.error)
    assert len(w.store.list_runs())==1


def test_live_ui_freezes_entered_number_and_waits_for_explicit_execute(tmp_path,monkeypatch):
    db=str(tmp_path/'live-ui.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('CALLE_API_KEY','offline-placeholder')
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    from real_estate_buyer_followup.integrations.calle import LiveProvider
    seen=[]
    def submit(self,request,key):
        seen.append(request)
        return {'id':'live_transport_test','status':'queued','result_status':'pending','transcript':[],'result':None}
    monkeypatch.setattr(LiveProvider,'submit',submit)
    monkeypatch.setattr(LiveProvider,'read',lambda *args:{'id':'live_transport_test','status':'in_progress','result_status':'pending','transcript':[],'result':None})
    at=AppTest.from_file(APP,default_timeout=30).run()
    next(r for r in at.radio if r.label=='通话方式').set_value('live').run()
    next(t for t in at.text_input if t.label=='接听手机号').input('+12025550123')
    button(at,'生成 Agent 规划 →').click().run()
    assert not at.exception and not seen
    assert not any('发送给豆包' in c.label for c in at.checkbox)
    assert button(at,'批准并进入通话').disabled
    next(c for c in at.checkbox if '联系权限' in c.label).check().run()
    button(at,'批准并进入通话').click().run()
    assert not at.exception and not seen
    saved=Workflow(Settings(db_path=db)).store.list_runs()[0]
    assert saved['allow_doubao_analysis'] and saved['analysis_consent']['source']=='project_setting'
    assert any('***0123' in x.value for x in at.warning)
    assert not any('+12025550123' in x.value for x in at.markdown)
    button(at,'拨打这一通真实 CALL-E 电话').click().run()
    assert not at.exception and len(seen)==1 and seen[0]['phone']=='+12025550123'
    at.run()
    assert len(seen)==1


def test_live_page_automatically_follows_existing_call_and_shows_final_transcript(tmp_path,monkeypatch):
    from real_estate_buyer_followup.storage import fixture
    from real_estate_buyer_followup.integrations.calle import LiveProvider
    db=str(tmp_path/'monitor-ui.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('CALLE_API_KEY','offline-placeholder')
    w=Workflow(Settings(db_path=db,analysis_mode='doubao',enable_live=True,calle_key='offline-placeholder'))
    r=w.prepare('customer_zhang','回访',mode='live',phone='+12025550123',locale='en-US')
    r=w.approve(r['id'],r['revision'],True,allow_doubao_analysis=True)
    r.update(status='monitoring',execution_status='queued',call={'id':'already_accepted',
        'status':'queued','result_status':'pending','transcript':[],'result':None})
    w.store.save_run(r,r['revision'])
    reads=[]
    def no_submission(*args):raise AssertionError('Monitoring must not dial')
    def read(self,request,key,resource_id):
        reads.append(resource_id)
        final=len(reads)>=3
        return {'id':resource_id,'status':'completed' if len(reads)>=2 else 'in_progress',
            'result_status':'available' if final else 'pending',
            'transcript':fixture('replays.json')['preferences']['transcript'] if final else [],
            'result':{'summary':'synthetic'} if final else None}
    monkeypatch.setattr(LiveProvider,'submit',no_submission)
    monkeypatch.setattr(LiveProvider,'read',read)
    at=AppTest.from_file(APP,default_timeout=30).run()
    assert not reads and at.radio[0].value=='① 任务准备'
    at.radio[0].set_value('③ 通话执行').run()
    assert not at.exception and reads==['already_accepted']
    assert any(m.value=='通话进行中' for m in at.metric)
    assert not any('不能编造证据' in x.value for x in at.info)
    at.run()
    assert not at.exception and len(reads)==2
    assert any('正在整理' in x.value for x in at.info)
    assert w.store.run(r['id'])['analysis'] is None
    at.run()
    assert not at.exception and len(reads)==3
    assert at.radio[0].value=='④ 结果与更新'
    assert w.store.run(r['id'])['extraction_status']=='completed'
    assert any(x.label=='完整通话转写' for x in at.expander)
    assert any('A房源位置不错，但客厅太小' in x.value for x in at.markdown)
    at.run()
    assert len(reads)==3 and not w.store.history('customer_zhang')


def test_final_live_results_show_without_sending_transcript_until_consent(tmp_path,monkeypatch):
    # A different deployment with no owner authorization retains the guard.
    monkeypatch.setenv('ESTATE_DOUBAO_ANALYSIS_AUTHORIZED','false')
    from real_estate_buyer_followup.storage import fixture
    from real_estate_buyer_followup.models import Analysis
    from real_estate_buyer_followup.integrations.llm import Intelligence
    db=str(tmp_path/'consent-ui.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('CALLE_API_KEY','offline-placeholder')
    w=Workflow(Settings(db_path=db,analysis_mode='doubao',enable_live=True,calle_key='offline-placeholder'))
    r=w.prepare('customer_zhang','回访',mode='live',phone='+12025550123',locale='en-US')
    r=w.approve(r['id'],r['revision'],True)
    r.update(status='result_ready',execution_status='completed',call={'id':'existing_final',
        'status':'completed','result_status':'available','transcript':fixture('replays.json')['preferences']['transcript'],
        'result':{'summary':'这是CALL-E原始总结'}})
    w.store.save_run(r,r['revision'])
    calls=[]
    def analyze(self,run):
        calls.append(run['id'])
        return Analysis.model_validate(fixture('replays.json')['preferences']['analysis'])
    monkeypatch.setattr(Intelligence,'analyze',analyze)
    at=AppTest.from_file(APP,default_timeout=30).run()
    assert at.radio[0].value=='① 任务准备' and not calls
    at.radio[0].set_value('④ 结果与更新').run()
    assert not at.exception and at.radio[0].value=='④ 结果与更新' and not calls
    assert any('这是CALL-E原始总结' in m.value for m in at.markdown)
    assert any(e.label=='完整通话转写' for e in at.expander)
    assert button(at,'同意并分析这通电话').disabled
    at.run();assert not calls
    next(c for c in at.checkbox if '发送给豆包分析' in c.label).check().run()
    button(at,'同意并分析这通电话').click().run()
    assert not at.exception and calls==[r['id']]
    assert w.store.run(r['id'])['call']['id']=='existing_final'
    assert not w.store.history('customer_zhang')


def test_auto_query_pauses_after_three_errors_without_redial(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.calle import LiveProvider,ProviderError
    db=str(tmp_path/'query-errors.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db);monkeypatch.setenv('CALLE_API_KEY','offline-placeholder')
    w=Workflow(Settings(db_path=db,analysis_mode='doubao',enable_live=True,calle_key='offline-placeholder'))
    r=w.prepare('customer_zhang','回访',mode='live',phone='+12025550123',locale='en-US')
    r=w.approve(r['id'],r['revision'],True)
    snapshot={'id':'same_call','status':'queued','result_status':'pending','transcript':[],'result':None}
    r.update(status='monitoring',execution_status='queued',call=snapshot)
    w.store.save_run(r,r['revision'])
    reads=[]
    def read(*args):
        reads.append(1)
        if len(reads)<=3:raise ProviderError('查询暂时失败，未重拨')
        return snapshot
    def submit(*args):raise AssertionError('Read failure cannot trigger redial')
    monkeypatch.setattr(LiveProvider,'read',read);monkeypatch.setattr(LiveProvider,'submit',submit)
    at=AppTest.from_file(APP,default_timeout=30).run()
    assert not reads and at.radio[0].value=='① 任务准备'
    at.radio[0].set_value('③ 通话执行').run()
    at.run();at.run()
    assert not at.exception and len(reads)==3
    assert any('已暂停自动查询' in v.value for v in at.warning)
    at.run();assert len(reads)==3
    button(at,'继续查询这通电话（不重拨）').click().run()
    assert not at.exception and len(reads)==4
    assert w.store.run(r['id'])['call']['id']=='same_call'


def test_review_budget_in_ui_does_not_auto_apply(tmp_path,monkeypatch):
    db=str(tmp_path/"ui-review.sqlite3")
    monkeypatch.setenv("ESTATE_DB",db)
    monkeypatch.setenv("ESTATE_ANALYSIS_MODE","replay")
    monkeypatch.setenv("ESTATE_ENABLE_LIVE","false")
    # Edge fixtures remain loadable for regression tests, not a demo selector.
    Workflow(Settings(db_path=db,analysis_mode='doubao')).prepare('customer_zhang','回访',replay_case='explicit_budget')
    at=AppTest.from_file(APP,default_timeout=30).run()
    assert at.radio[0].value=='① 任务准备'
    at.radio[0].set_value('② Agent Planning').run()
    button(at,"批准并进入通话").click().run()
    button(at,"执行电话回放并处理结果").click().run()
    w=Workflow(Settings(db_path=db))
    assert w.crm.context("customer_zhang")["customer"]["preferences"]["budget_max"]==5000000
    assert not any(b.label=='确认有依据的新值' for b in at.button)
    at.run()
    assert not at.exception
    assert w.crm.context('customer_zhang')['customer']['preferences']['budget_max']==5000000
    assert not w.store.history('customer_zhang')


def test_current_flow_has_no_management_controls_and_preserves_database(tmp_path,monkeypatch):
    import hashlib
    db=tmp_path/"old-demo.sqlite3"
    monkeypatch.setenv("ESTATE_DB",str(db))
    monkeypatch.setenv("ESTATE_ANALYSIS_MODE","replay")
    monkeypatch.setenv("ESTATE_ENABLE_LIVE","false")
    at=AppTest.from_file(APP,default_timeout=30).run()
    before=hashlib.sha256(db.read_bytes()).hexdigest()
    at.run()
    assert not at.exception
    assert not any(e.label in {'演示管理与历史任务','载入历史任务'} for e in at.expander)
    assert not any('新建独立' in b.label for b in at.button)
    assert len(list(tmp_path.glob('*.sqlite3')))==1
    assert hashlib.sha256(db.read_bytes()).hexdigest()==before


def test_planning_two_modules_match_the_approved_task(tmp_path,monkeypatch):
    from real_estate_buyer_followup.agent.planning import task_sections,compile_task
    from real_estate_buyer_followup.models import Plan,Assessment
    db=str(tmp_path/'selected.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    assert [h.value for h in at.subheader]==['① Agent 生成的通话任务','② 经纪人确认']
    assert not at.checkbox and not at.text_area
    assert not any(b.label=='保存勾选与编辑' for b in at.button)
    w=Workflow(Settings(db_path=db));r=w.store.list_runs()[0]
    p,a=Plan.model_validate(r['plan']),Assessment.model_validate(r['assessment'])
    for title,body in task_sections(p,a,r['context']):
        assert any(m.value==body for m in at.markdown)
    expected=compile_task(p,a,r['context'])
    button(at,'批准并进入通话').click().run()
    assert not at.exception
    approved=w.store.list_runs()[0]
    assert approved['status']=='approved' and approved['call'] is None
    assert approved['request']['task']==expected


def test_broker_can_replan_with_one_sentence(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import Plan
    import copy
    seen=[]
    def replan(self,request,plan,assessment,context):
        seen.append(request)
        revised=copy.deepcopy(plan)
        revised['communication_topics'][0]['content']='重点了解B的价格顾虑，区分预算硬约束和性价比判断。'
        return Plan.model_validate(revised)
    monkeypatch.setattr(Intelligence,'replan',replan)
    monkeypatch.setenv('ESTATE_DB',str(tmp_path/'replan.sqlite3'))
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    button(at,'提出修改意见').click().run()
    next(t for t in at.text_input if t.label=='修改要求').input('重点了解 B 的价格顾虑，暂时不问购房时间')
    button(at,'让 Agent 重新规划').click().run()
    assert not at.exception and seen==['重点了解 B 的价格顾虑，暂时不问购房时间']
    assert any('重点了解B的价格顾虑' in m.value for m in at.markdown)
    assert not button(at,'批准并进入通话').disabled


def test_old_scenario_can_be_regenerated_without_rewriting_history(tmp_path,monkeypatch):
    db=str(tmp_path/'old-scenario.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    w=Workflow(Settings(db_path=db));old=w.store.list_runs()[0]
    old['context'].pop('scenario_version')
    w.store.save_run(old,old['revision'])
    at.run()
    assert button(at,'批准并进入通话').disabled
    assert any('旧版案例' in warning.value for warning in at.warning)
    button(at,'按当前案例重新生成规划').click().run()
    assert not at.exception
    assert at.session_state['run_id']!=old['id']
    assert w.store.run(old['id'])==old
    assert not button(at,'批准并进入通话').disabled



def test_planning_failure_is_visible_retryable_and_keeps_same_task(tmp_path,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.agent.context import assess_offline
    db=str(tmp_path/'failed-ui.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    def fail(*args):raise ValueError('模型格式校验失败，请重试')
    monkeypatch.setattr(Intelligence,'assess',fail)
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    assert not at.exception
    assert at.radio[0].value=='② Agent Planning'
    assert any('模型格式校验失败' in e.value for e in at.error)
    w=Workflow(Settings(db_path=db));r=w.store.list_runs()[0]
    assert at.session_state['run_id']==r['id'] and r['status']=='planning_failed'
    at.run()
    assert at.error and button(at,'重试本任务规划（不拨号）')
    # A browser refresh can recover the durable failed task with a new session.
    reopened=AppTest.from_file(APP,default_timeout=30).run()
    assert reopened.radio[0].value=='① 任务准备'
    reopened.radio[0].set_value('② Agent Planning').run()
    assert button(reopened,'重试本任务规划（不拨号）')
    monkeypatch.setattr(Intelligence,'assess',lambda self,c:assess_offline(c))
    button(at,'重试本任务规划（不拨号）').click().run()
    assert not at.exception and not at.error
    assert at.radio[0].value=='② Agent Planning'
    assert w.store.run(r['id'])['status']=='pending_approval'
    assert len(w.store.list_runs())==1


def test_second_plan_does_not_get_replaced_by_old_history_selection(tmp_path,monkeypatch):
    db=str(tmp_path/'history-ui.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    at=AppTest.from_file(APP,default_timeout=30).run()
    button(at,'生成 Agent 规划 →').click().run()
    first=at.session_state['run_id']
    at.radio[0].set_value('① 任务准备').run()
    button(at,'生成 Agent 规划 →').click().run()
    second=at.session_state['run_id']
    assert second!=first and at.radio[0].value=='② Agent Planning'
    at.run()
    assert at.session_state['run_id']==second
    assert not any(s.label=='载入历史任务' for s in at.selectbox)
    reopened=AppTest.from_file(APP,default_timeout=30).run()
    assert reopened.session_state['run_id']==second
    assert len(Workflow(Settings(db_path=db)).store.list_runs())==2


def test_viewing_record_popover_contains_only_visit_facts(tmp_path,monkeypatch):
    db=str(tmp_path/'viewing-only.sqlite3')
    monkeypatch.setenv('ESTATE_DB',db)
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    w=Workflow(Settings(db_path=db,preview_only=False))
    assert all(v['feedback']==[] for v in w.crm.context('customer_zhang')['viewings'])
    # A past approved call may exist, but its feedback is not part of the
    # visit-record popover. It remains in the CRM and audited call results.
    r=w.prepare('customer_zhang','回访')
    r=w.approve(r['id'],r['revision'],True);w.execute(r['id'])
    w.process(r['id'],confirm_writeback=True)
    at=AppTest.from_file(APP,default_timeout=30).run()
    at.radio[0].set_value('① 任务准备').run()
    assert not at.exception
    table=at.dataframe[0].value
    assert list(table.columns)==['带看日期','已看房源','带看状态']
    assert len(table)==2
    assert all(v['feedback'] for v in w.crm.context('customer_zhang')['viewings'])


def test_knowledge_is_two_selected_files_without_full_document_render(tmp_path,monkeypatch):
    monkeypatch.setenv('ESTATE_DB',str(tmp_path/'file-list-ui.sqlite3'))
    monkeypatch.setenv('ESTATE_ENABLE_LIVE','false')
    at=AppTest.from_file(APP,default_timeout=30).run()
    chosen=[c for c in at.checkbox if c.label.endswith('.md')]
    assert [c.label for c in chosen]==['看房反馈分析与回访指导.md','购房政策 FAQ.md']
    assert all(c.value for c in chosen)
    assert not any('## [kb_' in m.value for m in at.markdown)
    next(c for c in chosen if c.label=='购房政策 FAQ.md').uncheck().run()
    button(at,'生成 Agent 规划 →').click().run()
    assert not at.exception
    w=Workflow(Settings(db_path=str(tmp_path/'file-list-ui.sqlite3')))
    assert w.store.list_runs()[0]['context']['knowledge_files']==['followup_guide']
