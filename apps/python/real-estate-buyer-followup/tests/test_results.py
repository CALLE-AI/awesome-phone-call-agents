from pathlib import Path
from streamlit.testing.v1 import AppTest
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.demo.results import has_value,crm_suggestions,recording_url


def test_crm_display_filters_missing_values_but_keeps_false_and_zero():
    for value in [None,'','  ','unknown','UNKNOWN','unclear','未提及','待确认',[],{}]:
        assert not has_value(value)
    assert has_value(False) and has_value(0)
    run={'context':{'properties':[]},'batch':{'accepted':[
        {'kind':'preference','field':'contact_allowed','value':False,'old_value':True},
        {'kind':'preference','field':'budget_max','value':None,'old_value':5000000},
    ],'pending':[
        {'kind':'preference','field':'subway_preference','value':'unknown'},
        {'kind':'preference','field':'living_room_priority','value':'空间更重要','reason':'需核对依据'},
    ]}}
    rows=crm_suggestions(run)
    assert len(rows)==2
    assert rows[0]['display_new']=='不再联系'
    assert rows[1]['display_status']=='待确认'


def test_results_page_orders_business_sections_and_puts_sources_last(tmp_path,monkeypatch):
    db=str(tmp_path/'result-layout.sqlite3')
    settings=Settings(db_path=db)
    w=Workflow(settings)
    r=w.prepare('customer_zhang','分别了解两套房的反馈，确认需求取舍与后续意愿')
    r=w.approve(r['id'],r['revision'],True)
    w.execute(r['id']);r=w.process(r['id'])
    r['batch']['pending'].append({'kind':'preference','field':'budget_max','value':'unknown','reason':'no value'})
    w.store.save_run(r,r['revision'])
    monkeypatch.setattr(Settings,'from_env',classmethod(lambda cls:Settings(db_path=db)))
    app=Path(__file__).parents[1]/'src/real_estate_buyer_followup/demo/streamlit_app.py'
    at=AppTest.from_file(app,default_timeout=30).run()
    assert not at.exception and at.radio[0].value=='① 任务准备'
    at.radio[0].set_value('④ 结果与更新').run()
    assert [h.value for h in at.subheader]==[
        '① 内容总结与任务概述','② 建议更新的 CRM 字段','③ 后续行动建议','④ 原始录音与转写']
    assert any('本次任务' in m.value for m in at.markdown)
    assert any('A 浦东花园' in m.value for m in at.markdown)
    assert not any('客户档案 · 预算上限' in m.value for m in at.markdown)
    assert any(e.label=='演示转写（固定虚构案例）' for e in at.expander)
    assert any('没有原始电话录音' in c.value for c in at.caption)
    assert not w.store.history('customer_zhang')
    assert w.store.run(r['id'])['revision']==r['revision']


def test_original_audio_is_not_fabricated():
    assert recording_url({'transcript':[{'speaker':'user','text':'test'}]}) is None
    for url in ['file:///private/record.wav','javascript:alert(1)','https://[invalid']:
        assert recording_url({'recording_url':url}) is None
    # Optional recording extension only; the current CALL-E snapshot has none.
    assert recording_url({'recording_url':'https://media.example.test/record.wav'})=='https://media.example.test/record.wav'
