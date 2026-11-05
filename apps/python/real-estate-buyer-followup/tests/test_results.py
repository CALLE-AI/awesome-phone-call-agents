from pathlib import Path
from streamlit.testing.v1 import AppTest
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.demo.results import has_value,crm_suggestions,recording_url


def test_crm_display_filters_missing_values_but_keeps_false_and_zero():
    for value in [None,'','  ','unknown','UNKNOWN','unclear','Not mentioned','Pending review',[],{}]:
        assert not has_value(value)
    assert has_value(False) and has_value(0)
    run={'context':{'properties':[]},'batch':{'accepted':[
        {'kind':'preference','field':'contact_allowed','value':False,'old_value':True},
        {'kind':'preference','field':'budget_max','value':None,'old_value':5000000},
    ],'pending':[
        {'kind':'preference','field':'subway_preference','value':'unknown'},
        {'kind':'preference','field':'living_room_priority','value':'Space matters more','reason':'Evidence review required'},
    ]}}
    rows=crm_suggestions(run)
    assert len(rows)==2
    assert rows[0]['display_new']=='Do not contact'
    assert rows[1]['display_status']=='Pending review'


def test_results_page_orders_business_sections_and_puts_sources_last(tmp_path,monkeypatch):
    db=str(tmp_path/'result-layout.sqlite3')
    settings=Settings(db_path=db)
    w=Workflow(settings)
    r=w.prepare('customer_zhang','Collect feedback on both homes, requirement trade-offs and follow-up preferences')
    r=w.approve(r['id'],r['revision'],True)
    w.execute(r['id']);r=w.process(r['id'])
    r['batch']['pending'].append({'kind':'preference','field':'budget_max','value':'unknown','reason':'no value'})
    w.store.save_run(r,r['revision'])
    monkeypatch.setattr(Settings,'from_env',classmethod(lambda cls:Settings(db_path=db)))
    app=Path(__file__).parents[1]/'src/real_estate_buyer_followup/demo/streamlit_app.py'
    at=AppTest.from_file(app,default_timeout=30).run()
    assert not at.exception and at.radio[0].value=='① Preparation'
    at.radio[0].set_value('④ Results and updates').run()
    assert [h.value for h in at.subheader]==[
        '① Summary and task overview','② Proposed CRM changes','③ Follow-up recommendations','④ Original recording and transcript']
    assert any('Current task' in m.value for m in at.markdown)
    assert any('A Pudong Garden' in m.value for m in at.markdown)
    assert not any('Customer profile · Budget ceiling' in m.value for m in at.markdown)
    assert any(e.label=='Demo transcript (fixed fictional case)' for e in at.expander)
    assert any('no original call recording' in c.value for c in at.caption)
    assert not w.store.history('customer_zhang')
    assert w.store.run(r['id'])['revision']==r['revision']


def test_original_audio_is_not_fabricated():
    assert recording_url({'transcript':[{'speaker':'user','text':'test'}]}) is None
    for url in ['file:///private/record.wav','javascript:alert(1)','https://[invalid']:
        assert recording_url({'recording_url':url}) is None
    # Optional recording extension only; the current CALL-E snapshot has none.
    assert recording_url({'recording_url':'https://media.example.test/record.wav'})=='https://media.example.test/record.wav'
