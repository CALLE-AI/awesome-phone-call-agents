import copy
import json
from pathlib import Path
import pytest
from real_estate_buyer_followup.config import Settings
from real_estate_buyer_followup.storage import dump, fixture
from real_estate_buyer_followup.services.workflow import Workflow
from real_estate_buyer_followup.integrations.calle import FakeProvider, ProviderError, LiveProvider
from real_estate_buyer_followup.agent.context import assess_offline, validate_assessment
from real_estate_buyer_followup.agent.planning import plan_offline, result_schema
from real_estate_buyer_followup.agent.extraction import build_batch
from real_estate_buyer_followup.models import Analysis


@pytest.fixture
def w(tmp_path):
    return Workflow(Settings(db_path=str(tmp_path/'crm.sqlite3'),preview_only=False))


def execute(w, case="preferences"):
    r=w.prepare("customer_zhang","Follow up on Ms. Zhang's recent viewings",replay_case=case)
    r=w.approve(r["id"],r["revision"],True)
    return w.execute(r["id"])


def finish(w, case="preferences"):
    r=execute(w,case)
    return w.process(r["id"],confirm_writeback=True)


def test_context_and_plan_change_with_evidence(w):
    ctx=w.crm.context("customer_zhang")
    a=assess_offline(ctx)
    assert {i.category for i in a.insights}=={"fact","hypothesis","conflict","gap"}
    assert "source_irrelevant" not in a.selected_sources
    assert not any(i.category=="fact" and i.source_ids==["source_space_observation"] for i in a.insights)
    plan=plan_offline('Follow-up',a,ctx)
    assert len(plan.communication_topics)==3 and not plan.questions
    assert all(t.source_ids and t.content for t in plan.communication_topics)
    changed=copy.deepcopy(ctx)
    changed["communications"]=[s for s in changed["communications"] if s["id"] not in {"source_space_observation","source_budget_old","source_budget_latest","source_preference_change"}]
    changed["properties"][1]["price"]=4800000
    fresh=plan_offline('Follow-up',assess_offline(changed),changed)
    assert fresh.communication_topics[1].content!=plan.communication_topics[1].content
    with pytest.raises(ValueError):
        a.insights[0].source_ids=["invented"]
        validate_assessment(a,ctx)


def test_real_writeback_and_repeat_replay_are_idempotent(w):
    r=finish(w)
    ctx=w.crm.context("customer_zhang")
    assert ctx["customer"]["preferences"]["budget_max"]==5000000
    assert ctx["customer"]["preferences"]["living_room_priority"]=='high'
    assert 'living room' in ctx["viewings"][0]["feedback"][0]["text"]
    assert 'exceeds budget' in ctx["viewings"][1]["feedback"][0]["text"]
    before=w.store.history("customer_zhang")
    w.process(r["id"],confirm_writeback=True);w.execute(r["id"])
    assert w.store.history("customer_zhang")==before
    assert len(before)==5
    assert all(json.loads(x["evidence"])["snapshot_id"] for x in before)
    assert Workflow(w.settings).store.run(r["id"])["status"]=="review_required"


def test_ambiguous_budget_and_unknown_attribution_do_not_mutate_crm(w):
    r=finish(w,"uncertain_budget")
    assert r["receipt"]["pending"]
    assert w.crm.context("customer_zhang")["customer"]["preferences"]["budget_max"]==5000000
    c=r["receipt"]["pending"][0]
    with pytest.raises(ValueError):w.resolve(r["id"],c["id"],"approve")
    other=finish(w,"ambiguous_property")
    assert other["receipt"]["unresolved"]
    assert all(not x["feedback"] for x in w.crm.context("customer_zhang")["viewings"])


def test_high_impact_change_requires_review_and_is_applied_once(w):
    r=finish(w,"explicit_budget")
    assert not r["receipt"]["applied"]
    cid=r["receipt"]["pending"][0]["id"]
    w.resolve(r["id"],cid,"approve")
    w.resolve(r["id"],cid,"approve")
    assert w.crm.context("customer_zhang")["customer"]["preferences"]["budget_max"]==5500000
    assert len(w.store.history("customer_zhang"))==1


def test_handoff_is_evidence_bound_and_notification_is_deduplicated(w):
    r=finish(w,"high_intent")
    assert r["receipt"]["handoff"]["priority"]=="high"
    assert r["receipt"]["handoff"]["signals"][0]["condition"]
    assert w.crm.context("customer_zhang")["customer"]["handoff_required"]
    w.process(r["id"],confirm_writeback=True)
    assert len(w.crm.notifications(r["id"]))==1
    assert 'no appointment or price promised' in r["receipt"]["handoff"]["action"]


def test_missing_evidence_and_final_unavailable(w):
    r=finish(w,"missing_evidence")
    assert not r["receipt"]["applied"] and r["receipt"]["pending"]
    unavailable=finish(w,"no_answer")
    assert unavailable["status"]=="no_business_result"
    assert not w.store.history("customer_zhang")


def test_edit_requires_reapproval_and_review_is_bound_to_body(w):
    r=w.prepare("customer_zhang",'Follow-up')
    rev=r["revision"]
    with pytest.raises(ValueError):w.approve(r["id"],rev,False)
    r=w.approve(r["id"],rev,True)
    changed=copy.deepcopy(r["plan"]);changed['communication_topics'][0]['content']='Collect genuine impressions of A and B separately and record their concerns.'
    r=w.edit(r["id"],r["revision"],changed)
    assert r["status"]=="pending_approval"
    assert w.execute(r["id"])["call"] is None
    with pytest.raises(ValueError):w.approve(r["id"],rev,True)
    r=w.approve(r["id"],r["revision"],True)
    assert 'Collect genuine impressions of A and B separately' in r['request']['task']
    r["request"]["task"]="tampered"
    w.store.save_run(r,r["revision"])
    with pytest.raises(ValueError):w.execute(r["id"])


def test_opt_out_blocks_previously_approved_and_new_calls(w):
    earlier=w.prepare("customer_zhang",'Follow-up')
    earlier=w.approve(earlier["id"],earlier["revision"],True)
    finish(w,"opt_out")
    assert not w.crm.context("customer_zhang")["customer"]["contact_allowed"]
    with pytest.raises(ValueError):w.execute(earlier["id"])
    with pytest.raises(ValueError):w.prepare("customer_zhang",'Follow up again')


def test_legacy_approved_task_requires_reapproval_before_submission(w):
    from real_estate_buyer_followup.storage import digest
    r=w.prepare('customer_zhang','Follow-up')
    r=w.approve(r['id'],r['revision'],True)
    r['request']['task']='legacy task with internal analysis JSON'
    r['approved_digest']=digest(r['request'])
    w.store.save_run(r,r['revision'])
    with pytest.raises(ValueError,match='approve again'):w.execute(r['id'])
    assert w.store.run(r['id'])['call'] is None
    r=w.edit(r['id'],r['revision'],r['plan'])
    r=w.approve(r['id'],r['revision'],True)
    assert r['request']['task'].startswith('Identity and objective\n')
    assert w.execute(r['id'])['call']['simulation'] is True


def test_transaction_rollback_and_same_batch_retry(w):
    r=execute(w)
    def fail():raise RuntimeError("injected before commit")
    with pytest.raises(RuntimeError):w.process(r["id"],fail_hook=fail,confirm_writeback=True)
    assert not w.store.history("customer_zhang")
    assert all(not v["feedback"] for v in w.crm.context("customer_zhang")["viewings"])
    assert w.crm.context("customer_zhang")["customer"]["version"]==1
    assert len(w.process(r["id"],confirm_writeback=True)["receipt"]["applied"])==5


def test_stale_customer_does_not_get_overwritten(w):
    r=execute(w)
    with w.store.tx() as db:
        row=db.execute("SELECT data FROM customers").fetchone();c=json.loads(row[0])
        c["version"]+=1;c["preferences"]["budget_max"]=4900000
        db.execute("UPDATE customers SET version=?,data=?",(c["version"],dump(c)))
    with pytest.raises(ValueError,match='revision'):w.process(r["id"],confirm_writeback=True)
    assert w.crm.context("customer_zhang")["customer"]["preferences"]["budget_max"]==4900000


def test_lost_submission_recovers_same_identity_and_pending_result(w,tmp_path):
    class Uncertain(FakeProvider):
        def __init__(self):self.keys=[]
        def submit(self,request,key):
            self.keys.append(key)
            result=super().submit(request,key)
            if len(self.keys)==1:raise ProviderError("lost accepted response",uncertain=True)
            result["result_status"]="pending" # Telephone done, result still processing.
            return result
        def read(self,request,key,resource_id):
            return FakeProvider.submit(self,request,key)
    provider=Uncertain();w.provider_override=provider
    r=w.prepare("customer_zhang",'Follow-up');r=w.approve(r["id"],r["revision"],True)
    with pytest.raises(ValueError):w.execute(r["id"])
    recovered=Workflow(w.settings,provider=provider)
    with pytest.raises(ValueError):recovered.execute(r["id"])
    r=recovered.execute(r["id"],recover=True)
    assert r["status"]=="monitoring" and provider.keys[0]==provider.keys[1]
    with pytest.raises(ValueError):recovered.process(r["id"],confirm_writeback=True)
    recovered.refresh(r["id"])
    assert recovered.process(r["id"],confirm_writeback=True)["status"]=="review_required"


def test_wrong_property_and_bot_quote_are_rejected(w):
    r=execute(w,"high_intent")
    analysis=Analysis.model_validate(fixture("replays.json")["high_intent"]["analysis"])
    analysis.feedback[0].property_id="property_a"
    analysis.signals[0].property_id="property_c"
    analysis.changes=[]
    batch=build_batch(r,analysis)
    assert not any(e["kind"]=="feedback" for e in batch["accepted"])
    assert batch["pending"] and batch["unresolved"]
    assert batch["handoff"]["priority"]=="normal"


def test_schema_is_flat_and_client_render_contains_no_provider_calls(w):
    schema=result_schema(w.crm.context("customer_zhang"))
    assert len(schema["properties"])<=32 and schema["additionalProperties"] is False
    assert all(p["type"]=="string" for p in schema["properties"].values())
    # Headless browser-level checks live in test_demo.py; this assertion is not
    # used as evidence of UI correctness.


def test_live_adapter_calls_pinned_sdk_contract_without_network(w,monkeypatch):
    s=Settings(enable_live=True,calle_key="offline-placeholder",live_phone="+12025550123",live_locale="en-US",analysis_mode="doubao")
    seen={}
    class Calls:
        def create(self,**kwargs):seen.update(kwargs);return {"id":"call_contract"}
        def get(self,rid):return {"id":rid}
    class Client:
        def __init__(self,**kwargs):assert kwargs["base_url"]=="https://api.heycall-e.com";self.calls=Calls()
    calle=pytest.importorskip("calle")
    monkeypatch.setattr(calle,"CalleClient",Client)
    provider=LiveProvider(s)
    request={"phone":s.live_phone,"locale":s.live_locale,"task":"test","result_schema":{},"metadata":{}}
    assert provider.submit(request,"stable")["id"]=="call_contract"
    assert seen["idempotency_key"]=="stable"
    assert provider.read(request,"stable","call_contract")["id"]=="call_contract"
    request["phone"]="not-a-phone"
    with pytest.raises(ProviderError):provider.submit(request,"stable")


def test_live_number_is_frozen_per_plan_and_sdk_submission_is_explicit(w,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    calle=pytest.importorskip('calle')
    seen=[]
    class Calls:
        def create(self,**kwargs):
            seen.append(kwargs)
            return {'id':'sdk_'+str(len(seen)),'status':'queued','result_status':'pending','transcript':[],'result':None}
        def get(self,rid):
            return {'id':rid,'status':'completed','result_status':'available','transcript':fixture('replays.json')['preferences']['transcript'],'result':{}}
    class Client:
        def __init__(self,**kwargs):self.calls=Calls()
    monkeypatch.setattr(calle,'CalleClient',Client)
    monkeypatch.setattr(w,'_ai',lambda run=None:Intelligence(Settings(),mode='replay'))
    w.settings.enable_live=True;w.settings.calle_key='offline-placeholder';w.settings.analysis_mode='doubao'
    r=w.prepare('customer_zhang','Follow-up',mode='live',phone='+12025550123',locale='en-US')
    assert not seen and r['live_destination']=={'phone':'+12025550123','locale':'en-US'}
    with pytest.raises(ValueError):w.approve(r['id'],r['revision'],False)
    r=w.approve(r['id'],r['revision'],True)
    assert not seen and r['request']['phone']=='+12025550123'
    w.settings.live_phone='+12025550124';w.settings.live_locale='id-ID'
    w.execute(r['id']);w.execute(r['id'])
    assert len(seen)==1 and seen[0]['phone']=='+12025550123' and seen[0]['locale']=='en-US'
    assert w.refresh(r['id'])['call']['id']=='sdk_1'
    assert len(seen)==1
    new=w.prepare('customer_zhang','Follow-up',mode='live',phone='+12025550124',locale='en-US')
    assert new['id']!=r['id'] and new['live_destination']['phone']=='+12025550124'
    with pytest.raises(ValueError,match='E.164'):w.prepare('customer_zhang','Follow-up',mode='live',phone='123',locale='en-US')


def test_live_rejection_reports_supported_reason_without_provider_payload(monkeypatch):
    calle=pytest.importorskip('calle')
    from calle.errors import CalleAPIError
    class Calls:
        def create(self,**kwargs):
            raise CalleAPIError(code='unsupported_language',message='private-provider-payload',status_code=422)
    class Client:
        def __init__(self,**kwargs):self.calls=Calls()
    monkeypatch.setattr(calle,'CalleClient',Client)
    p=LiveProvider(Settings(enable_live=True,calle_key='offline-placeholder'))
    with pytest.raises(ProviderError,match='selected language') as e:
        p.submit({'phone':'+12025550123','locale':'zh-CN'},'same-key')
    assert not e.value.uncertain and 'private-provider-payload' not in str(e.value)


def test_literal_quote_is_not_enough_for_unrelated_change(w):
    r=execute(w,"high_intent")
    analysis=Analysis.model_validate({"summary":"incorrect inference","changes":[
        {"field":"living_room_priority","value":'high',"reason":"unsupported","uncertain":False,
         "evidence":{"turn_index":1,"quote":r["call"]["transcript"][1]["text"]}}],
        "feedback":[],"signals":[],"unresolved":[]})
    batch=build_batch(r,analysis)
    assert not batch["accepted"] and batch["pending"]


def test_structured_opt_out_without_transcript_blocks_dispatch(w):
    r=execute(w,"high_intent")
    r["call"]["transcript"]=[]
    r["call"]["result"]={"contact_preference":"do_not_contact"}
    analysis=Analysis(summary="missing evidence",changes=[],feedback=[],signals=[],unresolved=[])
    batch=build_batch(r,analysis)
    assert batch["contact_review_block"] and batch["handoff"]["priority"]=="suppressed"
    assert not batch["accepted"]


def test_doubao_adapter_checks_references_and_does_not_silently_fallback(w,monkeypatch):
    import openai
    from types import SimpleNamespace
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.agent.context import assess_offline
    ctx=w.crm.context("customer_zhang")
    output=assess_offline(ctx).model_dump()
    calls=[]
    class Responses:
        def create(self,**kwargs):
            calls.append(kwargs)
            return SimpleNamespace(status="completed",output_text=dump(output))
    class Client:
        def __init__(self,**kwargs):assert kwargs["base_url"].startswith("https://ark.cn-beijing.volces.com");self.responses=Responses()
        def __enter__(self):return self
        def __exit__(self,*args):pass
    monkeypatch.setattr(openai,"OpenAI",Client)
    s=Settings(doubao_key="offline-test",doubao_model="configured-model",analysis_mode="doubao")
    ai=Intelligence(s)
    assert ai.assess(ctx).insights
    assert calls[0]["store"] is False
    assert '"enum":' in calls[0]["instructions"]
    assert '"customer_profile"' in calls[0]["instructions"]
    output["insights"][0]["source_ids"]=["made-up-source"]
    with pytest.raises(ValueError):ai.assess(ctx)
    ai.settings.doubao_key=""
    with pytest.raises(ValueError):ai.assess(ctx)


def test_concurrent_execution_claim_does_not_submit_twice(w):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    entered=threading.Event();release=threading.Event()
    class Slow(FakeProvider):
        count=0
        def submit(self,request,key):
            self.count+=1;entered.set();assert release.wait(3)
            return super().submit(request,key)
    provider=Slow();w.provider_override=provider
    r=w.prepare("customer_zhang",'Follow-up');w.approve(r["id"],r["revision"],True)
    with ThreadPoolExecutor(max_workers=1) as pool:
        first=pool.submit(w.execute,r["id"])
        assert entered.wait(3)
        with pytest.raises(ValueError):w.execute(r["id"])
        release.set();first.result()
    assert provider.count==1


def test_monitoring_advances_same_call_until_business_result_then_processes_once(w,monkeypatch):
    class Pending(FakeProvider):
        submissions=0
        reads=0
        def submit(self,request,key):
            self.submissions+=1
            self.original=super().submit(request,key)
            return {**self.original,'status':'queued','result_status':'pending','transcript':[],'result':None}
        def read(self,request,key,resource_id):
            assert resource_id==self.original['id']
            self.reads+=1
            if self.reads==1:
                return {**self.original,'status':'completed','result_status':'pending','transcript':[],'result':None}
            return self.original
    p=Pending();w.provider_override=p
    r=execute(w)
    r=w.advance_call(r['id'])
    assert r['status']=='monitoring' and r['execution_status']=='completed'
    assert r['analysis'] is None
    r=w.advance_call(r['id'])
    assert r['status']=='pending_writeback_approval' and r['analysis'] and r['batch']
    assert not w.store.history('customer_zhang')
    w.advance_call(r['id'])
    assert p.submissions==1 and p.reads==2


def test_automatic_monitor_never_resubmits_or_retries_failed_analysis(w,monkeypatch):
    r=execute(w)
    before=w.prepare('customer_zhang','Not dialed')
    calls=[]
    class Failing:
        def analyze(self,run):calls.append(run['id']);raise ValueError('temporary analysis failure')
    monkeypatch.setattr(w,'_ai',lambda *args:Failing())
    with pytest.raises(ValueError):w.advance_call(r['id'])
    assert w.store.run(r['id'])['status']=='processing_failed'
    assert w.advance_call(r['id'])['status']=='processing_failed'
    assert calls==[r['id']]
    assert w.advance_call(before['id'])['call'] is None


def test_live_result_requires_destination_specific_consent_before_model_analysis(w,monkeypatch):
    r=execute(w)
    r['mode']='live'
    w.store.save_run(r,r['revision'])
    calls=[]
    class Analyzer:
        def analyze(self,run):
            calls.append(run['id'])
            return Analysis.model_validate(fixture('replays.json')['preferences']['analysis'])
    monkeypatch.setattr(w,'_ai',lambda *args:Analyzer())
    r=w.advance_call(r['id'])
    assert r['status']=='awaiting_analysis_consent' and not calls
    with pytest.raises(ValueError,match='not authorized yet'):w.process(r['id'])
    with pytest.raises(ValueError,match='explicitly authorize'):w.authorize_analysis(r['id'],r['revision'])
    r=w.authorize_analysis(r['id'],r['revision'],confirmed=True)
    assert r['analysis_consent']['provider']=='doubao' and r['allow_doubao_analysis']
    r=w.advance_call(r['id'])
    assert r['status']=='pending_writeback_approval' and calls==[r['id']]
    assert not w.store.history('customer_zhang')


def test_owner_authorization_automatically_applies_to_current_flow(w,monkeypatch):
    r=execute(w)
    r.update(mode='live',status='awaiting_analysis_consent')
    w.store.save_run(r,r['revision'])
    w.settings.doubao_analysis_authorized=True
    calls=[]
    class Analyzer:
        def analyze(self,run):
            calls.append(run['id'])
            return Analysis.model_validate(fixture('replays.json')['preferences']['analysis'])
    monkeypatch.setattr(w,'_ai',lambda *args:Analyzer())
    r=w.advance_call(r['id'])
    assert r['status']=='pending_writeback_approval' and calls==[r['id']]
    assert r['allow_doubao_analysis'] and r['analysis_consent']['source']=='project_setting'
    w.advance_call(r['id'])
    assert calls==[r['id']] and not w.store.history('customer_zhang')


def test_proposed_updates_survive_restart_and_require_explicit_confirmation(w):
    r=execute(w)
    staged=w.process(r['id'])
    assert staged['status']=='pending_writeback_approval'
    assert not w.store.history('customer_zhang')
    restored=Workflow(w.settings)
    assert restored.process(r['id'])['status']=='pending_writeback_approval'
    assert not restored.store.history('customer_zhang')
    final=restored.process(r['id'],confirm_writeback=True)
    assert len(final['receipt']['applied'])==5
    c=restored.crm.context('customer_zhang')['customer']
    assert c['preferences']['budget_max']==5000000
    assert c['preferences']['subway_walk_limit_minutes']==10
    assert c['preferences']['next_viewing_interest']=='Willing to consider suitable homes'
    assert c['intent']=='Interested in further viewings' and not c['handoff_required']
    restored.process(r['id'],confirm_writeback=True)
    assert len(restored.store.history('customer_zhang'))==5


def test_refusal_blocks_other_calls_before_crm_confirmation(w):
    earlier=w.prepare('customer_zhang','Follow-up')
    w.approve(earlier['id'],earlier['revision'],True)
    refusal=execute(w,'opt_out')
    w.process(refusal['id'])
    assert w.crm.context('customer_zhang')['customer']['contact_allowed'] is True
    with pytest.raises(ValueError,match='Contact restriction'):w.execute(earlier['id'])


def test_existing_database_is_not_reseeded_with_new_history(w):
    with w.store.tx() as db:
        # Mimic an older database. Reopening must not add the new seed ID.
        db.execute("UPDATE communications SET id='legacy_initial', data=json_set(data,'$.id','legacy_initial') WHERE id='source_initial'")
    reopened=Workflow(w.settings)
    ids={x['id'] for x in reopened.crm.context('customer_zhang')['communications']}
    assert 'legacy_initial' in ids and 'source_initial' not in ids


def test_natural_language_replanning_invalidates_approval_and_preserves_evidence(w,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import Plan
    r=w.prepare('customer_zhang','Follow-up')
    r=w.approve(r['id'],r['revision'],True)
    before=copy.deepcopy(r)
    def replan(self,request,plan,assessment,context):
        assert request=="Focus on B's price concerns; do not ask about purchase timing for now"
        updated=copy.deepcopy(plan)
        updated['communication_topics'][0]['content']="Focus on B's price concerns; distinguish a hard budget constraint from value-for-money concerns."
        return Plan.model_validate(updated)
    monkeypatch.setattr(Intelligence,'replan',replan)
    r=w.replan(r['id'],r['revision'],"Focus on B's price concerns; do not ask about purchase timing for now")
    assert r['status']=='pending_approval' and r['approved_digest'] is None
    assert r['context']==before['context'] and r['assessment']==before['assessment']
    assert r['plan_history'][0]['previous_plan']==before['plan']
    assert w.execute(r['id'])['call'] is None
    with pytest.raises(ValueError):w.replan(r['id'],before['revision'],'Revise again')
    def fail(*args):raise ValueError('model unavailable')
    monkeypatch.setattr(Intelligence,'replan',fail)
    saved=w.store.run(r['id'])
    with pytest.raises(ValueError):w.replan(r['id'],r['revision'],'Focus on price')
    assert w.store.run(r['id'])==saved


def test_invalid_source_gets_one_correction_without_mutating_context(w,monkeypatch):
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import Assessment
    ctx=w.crm.context('customer_zhang');before=copy.deepcopy(ctx)
    valid=assess_offline(ctx)
    invalid=valid.model_copy(deep=True);invalid.insights[0].source_ids=['C001']
    seen=[]
    def output(self,model,instructions,data):
        seen.append(data)
        return invalid if len(seen)==1 else valid
    monkeypatch.setattr(Intelligence,'_json',output)
    ai=Intelligence(Settings(),mode='doubao')
    assert ai.assess(ctx)==valid
    assert len(seen)==2 and 'previous_output' in seen[1] and 'correction' in seen[1]
    assert ctx==before
    seen.clear()
    monkeypatch.setattr(Intelligence,'_json',lambda self,*args:(seen.append(1) or invalid))
    with pytest.raises(ValueError,match='source references still fail validation'):ai.assess(ctx)
    assert len(seen)==2


@pytest.mark.parametrize('permanent',[False,True])
def test_json_syntax_error_has_bounded_regeneration_and_safe_message(w,monkeypatch,permanent):
    import openai
    from types import SimpleNamespace
    from real_estate_buyer_followup.integrations.llm import Intelligence
    from real_estate_buyer_followup.models import Plan
    ctx=w.crm.context('customer_zhang')
    good=plan_offline('Follow-up',assess_offline(ctx),ctx).model_dump()
    calls=[]
    class Responses:
        def create(self,**kwargs):
            calls.append(kwargs)
            assert kwargs['text']=={'format':{'type':'json_object'}}
            text='{"objective" "PRIVATE_MODEL_OUTPUT"}' if permanent or len(calls)==1 else dump(good)
            return SimpleNamespace(status='completed',output_text=text)
    class Client:
        def __init__(self,**kwargs):self.responses=Responses()
        def __enter__(self):return self
        def __exit__(self,*args):pass
    monkeypatch.setattr(openai,'OpenAI',Client)
    ai=Intelligence(Settings(doubao_key='test-only',doubao_model='test-only'),mode='doubao')
    if permanent:
        with pytest.raises(ValueError,match='two consecutive') as err:ai._json(Plan,'JSON',{'context':ctx})
        assert 'PRIVATE_MODEL_OUTPUT' not in str(err.value)
        assert 'validation error' not in str(err.value)
    else:
        assert ai._json(Plan,'JSON',{'context':ctx}).objective=='Follow-up'
    assert len(calls)==2
    assert 'format_correction' in calls[1]['input'][0]['content']
    assert 'PRIVATE_MODEL_OUTPUT' not in calls[1]['input'][0]['content']


def test_analysis_uses_strict_schema_and_corrects_invalid_field_shape(w,monkeypatch,caplog):
    import openai
    from types import SimpleNamespace
    from real_estate_buyer_followup.integrations.llm import Intelligence
    r=execute(w)
    calls=[]
    good=fixture('replays.json')['preferences']['analysis']
    invalid={**good,'summary':'PRIVATE_SYNTHETIC_OUTPUT','changes':{}}
    class Responses:
        def create(self,**kwargs):
            calls.append(kwargs)
            fmt=kwargs['text']['format']
            assert fmt['type']=='json_schema' and fmt['strict'] is True
            schema=fmt['schema']
            assert schema['required']==list(schema['properties'])
            for definition in schema['$defs'].values():
                if definition.get('type')=='object':
                    assert definition['additionalProperties'] is False
                    assert set(definition['required'])==set(definition['properties'])
            assert schema['$defs']['Feedback']['properties']['property_id']['enum']==['property_a','property_b']
            payload=json.loads(kwargs['input'][0]['content'])
            assert 'knowledge_library' not in payload['context']
            return SimpleNamespace(status='completed',output_text=dump(invalid if len(calls)==1 else good))
    class Client:
        def __init__(self,**kwargs):self.responses=Responses()
        def __enter__(self):return self
        def __exit__(self,*args):pass
    monkeypatch.setattr(openai,'OpenAI',Client)
    ai=Intelligence(Settings(doubao_key='offline-test',doubao_model='offline-test'),mode='doubao')
    assert ai.analyze(r).feedback
    assert len(calls)==2
    assert 'format_correction' in calls[1]['input'][0]['content']
    assert 'PRIVATE_SYNTHETIC_OUTPUT' not in caplog.text
