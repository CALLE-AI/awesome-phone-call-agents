"""Synthetic REST 0.7.0 lifecycle regressions; never contact a provider.

Shapes follow https://docs.heycall-e.com/api-reference/~schemas. These tests
exercise decision fields and the documented extraction profile, not a live API.
"""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from calls import Ledger,build_request,interpret,normalize_provider_result
from optimizer import Invalid
from workflow import review_result,apply_review
from test_workflow import case,context


CALL_ID='call_synthetic_contract_check'
ROOT=Path(__file__).resolve().parents[1]


def call_task(status):
    pending=status in ('queued','in_progress')
    return {'id':CALL_ID,'object':'call_task','status':status,
        'task':'Fictional recipient capacity inquiry',
        'recipients':[{'id':'rcp_fixture','phones':['+12025550123'],'region':'US','locale':'en-US',
            'status':'pending' if pending else 'completed','structured_result':None,'summary':None,'attempts':[]}],
        'structured_result':None,'summary':None,'task_completed':None if pending else status=='completed',
        'completion_confidence':None,'evidence':[],'metadata':{'synthetic':True},
        'failure_code':None,'failure_message':None,'created_at':'1970-01-01T02:46:40Z',
        'completed_at':None if pending else '1970-01-01T02:46:44Z'}


def affirmative():
    result=call_task('completed')
    recipient=result['recipients'][0]
    recipient['structured_result']={'willing':'yes','capacity_portions':6,'evidence_quote':'Yes, six portions.'}
    recipient['attempts']=[{'id':'attempt_fixture','phone':'+12025550123','status':'completed',
        'started_at':'1970-01-01T02:46:40Z','completed_at':'1970-01-01T02:46:44Z','summary':None,
        'transcript_turns':[{'offset_seconds':3,'speaker':'user','text':'Yes, six portions.'}],
        'provider_call_id':'provider_dashboard_attempt_only','failure_code':None,'failure_message':None}]
    return result


class Provider:
    def __init__(self,results):self.results=results;self.creates=0;self.reads=[]
    def create(self,payload,key):
        self.creates+=1
        return call_task('queued')
    def read(self,cid):
        self.reads.append(cid)
        return copy.deepcopy(self.results[min(len(self.reads)-1,len(self.results)-1)])


class ApiContractTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'calls.sqlite3'
        self.ledger=Ledger(self.path);self.ctx=context();self.ctx['batch_id']='flex'
        self.sha=build_request(self.ctx,10000)[1]
    def tearDown(self):self.temp.cleanup()
    def retrieve(self,results,**kwargs):
        provider=Provider(results);self.ledger.start(self.ctx,self.sha,10000,provider)
        envelope=self.ledger.read_result(self.sha,provider,clock=lambda:10005,**kwargs)
        return provider,envelope

    def test_documented_pending_null_can_reach_affirmative_completion(self):
        sleeps=[]
        provider,env=self.retrieve([call_task('queued'),call_task('in_progress'),affirmative()],
            max_reads=12,sleep=sleeps.append)
        self.assertEqual(provider.reads,[CALL_ID]*3);self.assertEqual(sleeps,[5,5])
        self.assertEqual(env['monitoring'],'completed')
        data=case();data['partners'][0]['manager_verified']=False
        review=review_result(data,env,10003,ledger=self.ledger,clock=lambda:10006)
        result=apply_review(data,env,10003,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
        self.assertEqual(result['plan']['portions'],6);self.assertEqual(provider.creates,1)
        self.assertEqual(result['approval']['source_reference'],CALL_ID)

    def test_each_pending_null_state_is_valid_but_never_confirms(self):
        for status in ('queued','in_progress'):
            with self.subTest(status=status):
                result=call_task(status)
                self.assertEqual(normalize_provider_result(result,CALL_ID),result)
                self.assertEqual(interpret(result,12)['disposition'],'hold')

    def test_pending_budget_exhaustion_does_not_mean_failure_or_cancel(self):
        provider,env=self.retrieve([call_task('in_progress')],max_reads=12,sleep=lambda _:None)
        self.assertEqual(len(provider.reads),12)
        self.assertEqual(env['monitoring'],'pending_resume_same_call')
        self.assertIsNone(env['result']['task_completed'])
        self.assertEqual(self.ledger.state(self.sha)['state'],'submitted')
        self.assertFalse(self.ledger.start(self.ctx,self.sha,10000,provider)['created'])
        self.assertEqual(provider.creates,1)

    def test_failed_stops_polling_and_keeps_uninterpreted_diagnostics(self):
        result=call_task('failed');result.update(failure_code='future_vendor_diagnostic',failure_message='Fictional failure')
        result['recipients'][0]['status']='failed'
        provider,env=self.retrieve([result,affirmative()],max_reads=12,sleep=lambda _:self.fail('Terminal result must not sleep'))
        self.assertEqual(provider.reads,[CALL_ID]);self.assertEqual(env['monitoring'],'terminal_hold')
        self.assertEqual(env['result'],result)
        self.assertEqual(Ledger(self.path).read_result(self.sha,None,clock=lambda:15000),env)
        self.ledger.verify_envelope(env)

    def test_canceled_stops_polling_and_remains_immutable_after_restart(self):
        result=call_task('canceled')
        provider,env=self.retrieve([result,affirmative()],max_reads=12,sleep=lambda _:self.fail('Terminal result must not sleep'))
        self.assertEqual(provider.reads,[CALL_ID]);self.assertEqual(env['monitoring'],'terminal_hold')
        self.assertEqual(Ledger(self.path).read_result(self.sha,provider),env)
        self.assertEqual(provider.reads,[CALL_ID])

    def test_terminal_hold_cannot_redial_using_changed_window(self):
        provider,env=self.retrieve([call_task('failed')])
        self.assertFalse(self.ledger.start(self.ctx,self.sha,10000,provider)['created'])
        self.ctx['call_before']+=100;changed=build_request(self.ctx,10000)[1]
        with self.assertRaises(Invalid):self.ledger.start(self.ctx,changed,10000,provider)
        self.assertEqual(provider.creates,1)

    def test_terminal_hold_cannot_allocate_even_with_positive_extraction(self):
        for status in ('failed','canceled'):
            with self.subTest(status=status):
                result=affirmative();result['status']=status
                # Separate ledgers are separate synthetic test cases, not a retry workflow.
                ledger=Ledger(Path(self.temp.name)/(status+'.sqlite3'))
                provider=Provider([result]);ledger.start(self.ctx,self.sha,10000,provider)
                env=ledger.read_result(self.sha,provider,clock=lambda:10005)
                data=case();review=review_result(data,env,10003,ledger=ledger,clock=lambda:10006)
                self.assertEqual(review['candidate']['disposition'],'hold')
                with self.assertRaises(Invalid):apply_review(data,env,10003,review['review_sha'],True,ledger=ledger,clock=lambda:10006)

    def test_old_terminal_label_upgrades_without_refetch_or_timestamp_refresh(self):
        for status in ('failed','canceled'):
            with self.subTest(status=status):
                ledger=Ledger(Path(self.temp.name)/(status+'.sqlite3'));provider=Provider([call_task(status)])
                ledger.start(self.ctx,self.sha,10000,provider)
                env=ledger.read_result(self.sha,provider,clock=lambda:10005)
                legacy=copy.deepcopy(env);legacy['monitoring']='pending_resume_same_call'
                with ledger.connection() as db:
                    db.execute('UPDATE results SET envelope=? WHERE digest=?',(json.dumps(legacy),self.sha))
                updated=Ledger(ledger.path).read_result(self.sha,None,clock=lambda:15000)
                self.assertEqual(updated,env);ledger.verify_envelope(updated)

    def test_inflight_pending_cannot_replace_concurrently_saved_terminal_hold(self):
        provider=Provider([call_task('in_progress')]);self.ledger.start(self.ctx,self.sha,10000,provider)
        inner=[]
        class RacingRead:
            def read(inner_self,cid):
                inner.append(Ledger(self.path).read_result(self.sha,Provider([call_task('failed')]),clock=lambda:10004))
                return call_task('in_progress')
        env=self.ledger.read_result(self.sha,RacingRead(),clock=lambda:10005)
        self.assertEqual(env,inner[0]);self.assertEqual(env['fetched_at'],10004)
        self.assertEqual(env['monitoring'],'terminal_hold');self.ledger.verify_envelope(env)

    def test_nullable_completion_is_not_coerced_from_other_types(self):
        for value in ('true','false',0,1,[],{}):
            with self.subTest(value=value):
                result=call_task('queued');result['task_completed']=value
                with self.assertRaises(Invalid):normalize_provider_result(result,CALL_ID)

    def test_completed_null_is_retained_but_never_affirmative(self):
        result=affirmative();result['task_completed']=None
        provider,env=self.retrieve([result],max_reads=12,sleep=lambda _:self.fail('Terminal'))
        self.assertEqual(len(provider.reads),1)
        self.assertEqual(interpret(env['result'],12)['disposition'],'hold')

    def test_future_status_is_not_guessed_as_terminal_or_affirmative(self):
        result=affirmative();result['status']='future_post_processing'
        provider,env=self.retrieve([result],max_reads=2,sleep=lambda _:None)
        self.assertEqual(len(provider.reads),2);self.assertEqual(env['monitoring'],'pending_resume_same_call')
        self.assertEqual(interpret(env['result'],12)['disposition'],'hold')

    def test_unknown_speaker_kept_but_separate_user_quote_can_be_reviewed(self):
        result=affirmative();result['recipients'][0]['attempts'][0]['transcript_turns'].append(
            {'offset_seconds':None,'speaker':'unknown','text':'Unattributed background sound.'})
        before=copy.deepcopy(result)
        self.assertEqual(interpret(result,12)['disposition'],'candidate_confirmation')
        self.assertEqual(result,before)

    def test_unknown_speaker_cannot_supply_recipient_evidence(self):
        result=affirmative();result['recipients'][0]['attempts'][0]['transcript_turns'][0]['speaker']='unknown'
        output=interpret(result,12)
        self.assertEqual(output['disposition'],'hold')
        self.assertEqual(output['reason'],'Quote not found in a recipient turn')

    def test_unsupported_speaker_still_holds(self):
        result=affirmative();result['recipients'][0]['attempts'][0]['transcript_turns'].append(
            {'speaker':'operator','text':'Unexpected speaker label'})
        self.assertEqual(interpret(result,12)['reason'],'Malformed transcript turn')

    def test_request_schemas_use_documented_supported_profile(self):
        payload,_=build_request(self.ctx,10000)
        allowed={'type','properties','required','enum','items','description','additionalProperties'}
        types={'object','string','number','integer','boolean','array'}
        def check(schema):
            self.assertIsInstance(schema,dict);self.assertLessEqual(set(schema),allowed)
            self.assertIn(schema['type'],types)
            if 'additionalProperties' in schema:self.assertIs(schema['additionalProperties'],False)
            for child in schema.get('properties',{}).values():check(child)
            if 'items' in schema:check(schema['items'])
        for field in ('result_schema','recipient_result_schema'):
            check(payload[field]);self.assertEqual(payload[field]['properties']['capacity_portions']['type'],'integer')
        self.assertIn('capacity_portions=0',payload['task']);self.assertNotIn('capacity_portions=null',payload['task'])

    def test_unknown_zero_fixture_does_not_confirm(self):
        result=json.loads((ROOT/'call_result_unknown_fixture.json').read_text())
        extracted=result['recipients'][0]['structured_result']
        self.assertEqual((extracted['willing'],extracted['capacity_portions']),('unknown',0))
        self.assertEqual(interpret(result,12)['disposition'],'hold')

    def test_integer_only_extraction_still_enforces_local_positive_offered_bounds(self):
        for capacity in (0,-1,13,10001,True,6.0,None):
            with self.subTest(capacity=capacity):
                result=affirmative();result['recipients'][0]['structured_result']['capacity_portions']=capacity
                self.assertEqual(interpret(result,12)['disposition'],'hold')


if __name__=='__main__':unittest.main()
