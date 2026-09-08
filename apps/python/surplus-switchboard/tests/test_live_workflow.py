"""Real adapter boundary and complete orchestration, with no external service calls."""
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from calls import (Ledger,LiveTransport,build_request,interpret,strict_json,
                   normalize_provider_result,save_private_json)
from workflow import review_result,apply_review,reconcile,evidence_hash,snapshot_hash
from optimizer import Invalid
from test_workflow import case,context,response


class FakeProvider:
    def __init__(self,results=None):
        self.creates=0;self.reads=[];self.results=results or [response()]
    def create(self,payload,key):
        self.creates+=1
        return {'call_id':'fictional-call-123'}
    def read(self,cid):
        self.reads.append(cid)
        return copy.deepcopy(self.results[min(len(self.reads)-1,len(self.results)-1)])


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'ledger.sqlite3'
        self.ledger=Ledger(self.path)
        self.ctx=context();self.ctx['batch_id']='flex'
        self.data=case();self.data['partners'][0]['manager_verified']=False
        self.provider=FakeProvider()
        self.sha=build_request(self.ctx,10000)[1]
    def tearDown(self):self.temp.cleanup()
    def retrieve(self,provider=None):
        provider=provider or self.provider
        self.ledger.start(self.ctx,self.sha,10000,provider)
        return self.ledger.read_result(self.sha,provider,clock=lambda:10005)
    def review(self,envelope=None):
        return review_result(self.data,envelope or self.retrieve(),10001,ledger=self.ledger,clock=lambda:10006)
    def test_complete_preview_create_poll_review_reconcile(self):
        self.assertEqual(self.provider.creates,0)
        env=self.retrieve();review=self.review(env)
        self.assertEqual(review['candidate']['disposition'],'candidate_confirmation')
        self.assertFalse(self.data['partners'][0]['manager_verified'])
        output=apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
        self.assertEqual(output['snapshot']['partners'][0]['confirmed_at'],10001)
        self.assertEqual(output['approval']['request_sha'],self.sha)
        self.assertEqual(output['plan']['portions'],6)
        self.assertEqual(self.provider.creates,1)
    def test_one_category_call_does_not_enable_bread(self):
        env=self.retrieve();review=self.review(env)
        output=apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
        self.assertEqual(output['snapshot']['partners'][0]['accepts'],['produce'])
        self.assertNotIn('limited',[a['batch'] for a in output['plan']['allocations']])
    def test_poll_bound_and_resume_same_provider_id(self):
        provider=FakeProvider([{'status':'in_progress','task_completed':None,'recipients':[]}]);self.ledger.start(self.ctx,self.sha,10000,provider)
        sleeps=[]
        env=self.ledger.read_result(self.sha,provider,max_reads=3,clock=lambda:10005,sleep=sleeps.append)
        self.assertEqual(sleeps,[5,5]);self.assertEqual(len(provider.reads),3)
        self.assertEqual(env['monitoring'],'pending_resume_same_call')
        provider.results=[response()]
        env=Ledger(self.path).read_result(self.sha,provider,clock=lambda:10006)
        self.assertEqual(env['monitoring'],'completed');self.assertEqual(provider.creates,1)
        self.assertEqual(set(provider.reads),{'fictional-call-123'})
    def test_cached_completion_survives_restart(self):
        env=self.retrieve()
        self.assertEqual(Ledger(self.path).read_result(self.sha,None),env)
        self.assertEqual(len(self.provider.reads),1)
    def test_missing_ledger_call_cannot_read_or_create(self):
        with self.assertRaises(Invalid):self.ledger.read_result(self.sha,self.provider)
        self.assertEqual(self.provider.creates,0);self.assertEqual(self.provider.reads,[])
    def test_uncertain_create_stays_held_on_read(self):
        class Uncertain(FakeProvider):
            def create(self,payload,key):raise TimeoutError()
        with self.assertRaises(Invalid):self.ledger.start(self.ctx,self.sha,10000,Uncertain())
        with self.assertRaises(Invalid):self.ledger.read_result(self.sha,self.provider)
        self.assertEqual(self.provider.reads,[])
    def test_changed_window_cannot_bypass_existing_attempt(self):
        self.retrieve();self.ctx['call_before']+=10
        sha=build_request(self.ctx,10000)[1]
        with self.assertRaises(Invalid):self.ledger.start(self.ctx,sha,10000,self.provider)
        self.assertEqual(self.provider.creates,1)
    def test_read_failure_retains_created_call_without_redial(self):
        self.ledger.start(self.ctx,self.sha,10000,self.provider)
        with patch.object(self.provider,'read',side_effect=TimeoutError('private diagnostic')):
            with self.assertRaisesRegex(Invalid,'Resume this call ID'):self.ledger.read_result(self.sha,self.provider)
        self.assertEqual(self.ledger.state(self.sha)['state'],'submitted')
        self.assertFalse(self.ledger.start(self.ctx,self.sha,10000,self.provider)['created'])
        self.assertEqual(self.provider.creates,1)
    def test_mismatched_provider_id_held(self):
        result=response();result['call_id']='other-call'
        with self.assertRaises(Invalid):self.retrieve(FakeProvider([result]))
    def test_wrapped_response_not_guessed(self):
        with self.assertRaises(Invalid):self.retrieve(FakeProvider([{'data':response()}]))
    def test_poll_budget_bounds(self):
        for count in (0,13,True):
            with self.assertRaises(Invalid):self.ledger.read_result(self.sha,self.provider,max_reads=count)
    def test_review_requires_original_partner_batch_category(self):
        for key,value in (('partner_id','far'),('batch_id','missing'),('category','bread')):
            env=self.retrieve();env['request'][key]=value
            with self.assertRaises(Invalid):self.review(env)
    def test_envelope_cannot_be_imported_with_another_ledger(self):
        env=self.retrieve()
        with self.assertRaises(Invalid):
            review_result(self.data,env,10001,ledger=Ledger(Path(self.temp.name)/'other.sqlite3'),clock=lambda:10006)
    def test_review_cannot_import_raw_fixture(self):
        with self.assertRaises(Invalid):self.review(response())
    def test_snapshot_change_invalidates_review(self):
        env=self.retrieve();review=self.review(env);self.data['batches'][0]['portions']=5
        with self.assertRaises(Invalid):apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
    def test_evidence_change_invalidates_review(self):
        env=self.retrieve();review=self.review(env)
        env['result']['recipients'][0]['structured_result']['capacity_portions']=5
        with self.assertRaises(Invalid):apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
    def test_explicit_human_ack_required(self):
        env=self.retrieve();review=self.review(env)
        with self.assertRaises(Invalid):apply_review(self.data,env,10001,review['review_sha'],False,ledger=self.ledger,clock=lambda:10006)
    def test_reimport_does_not_renew_old_confirmation(self):
        env=self.retrieve()
        with self.assertRaises(Invalid):review_result(self.data,env,10001,ledger=self.ledger,clock=lambda:14000)
    def test_review_approval_cannot_replay_after_real_freshness_expires(self):
        env=self.retrieve();review=self.review(env)
        with self.assertRaises(Invalid):
            apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:14000)
    def test_allocation_uses_current_clock_after_human_review(self):
        self.data['batches'][0]['expires_at']=10100
        env=self.retrieve();review=self.review(env)
        output=apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10101)
        self.assertEqual(output['snapshot']['now'],10101)
        self.assertEqual(output['plan']['portions'],0)
    def test_timestamp_must_fit_actual_call_interval(self):
        for confirmed,now in ((9999,10006),(10006,10006),(10001,10004)):
            with self.assertRaises(Invalid):review_result(self.data,self.retrieve(),confirmed,ledger=self.ledger,clock=lambda:now)
    def test_unknown_completion_never_allocates(self):
        provider=FakeProvider([{'status':'in_progress','task_completed':None,'recipients':[]}]);env=self.retrieve(provider);review=self.review(env)
        self.assertEqual(review['candidate']['disposition'],'hold')
        with self.assertRaises(Invalid):apply_review(self.data,env,10001,review['review_sha'],True,ledger=self.ledger,clock=lambda:10006)
    def test_output_never_overwrites_existing_evidence(self):
        path=Path(self.temp.name)/'result.json';save_private_json(path,{'first':True})
        with self.assertRaises(FileExistsError):save_private_json(path,{'second':True})
        self.assertEqual(json.loads(path.read_text()),{'first':True})
    def test_multiple_attempts_cannot_reuse_earlier_affirmative_quote(self):
        value=response();value['recipients'][0]['attempts'].append({'transcript_turns':[{'speaker':'user','text':'No, stop.'}]})
        self.assertEqual(interpret(value,12)['disposition'],'hold')
    def test_malformed_transcript_turn_is_not_ignored(self):
        value=response();value['recipients'][0]['attempts'][0]['transcript_turns'].append(None)
        self.assertEqual(interpret(value,12)['disposition'],'hold')


class TransportTests(unittest.TestCase):
    def test_get_uses_only_fixed_origin_and_no_create(self):
        with patch('calls.request.build_opener') as factory:
            factory.return_value.open.return_value=io.BytesIO(json.dumps(response()).encode())
            LiveTransport('fictional-key').read('fictional-call-123')
            req=factory.return_value.open.call_args.args[0]
            self.assertEqual(req.full_url,'https://api.heycall-e.com/v1/calls/fictional-call-123')
            self.assertEqual(req.method,'GET');self.assertIsNone(req.data)
            self.assertIsNone(req.get_header('Idempotency-key'))
    def test_post_exact_payload_and_idempotency_key(self):
        with patch('calls.request.build_opener') as factory:
            factory.return_value.open.return_value=io.BytesIO(b'{"call_id":"fictional-call-123"}')
            LiveTransport('fictional-key').create({'task':'fictional'},'digest')
            req=factory.return_value.open.call_args.args[0]
            self.assertEqual(req.method,'POST');self.assertEqual(json.loads(req.data),{'task':'fictional'})
            self.assertEqual(req.get_header('Idempotency-key'),'digest')
    def test_unsafe_id_rejected_before_network(self):
        with patch('calls.request.build_opener') as factory:
            for cid in ('../calls','id?redirect=https://example.com','id\r\nX-Test: 1','https://example.com'):
                with self.assertRaises(Invalid):LiveTransport('fictional-key').read(cid)
            factory.assert_not_called()
    def test_redirects_disabled(self):
        with patch('calls.request.build_opener') as factory:
            factory.return_value.open.return_value=io.BytesIO(b'{"status":"running"}')
            LiveTransport('fictional-key').read('fictional')
            handler=factory.call_args.args[0]
            self.assertIsNone(handler().redirect_request(None,None,302,'',{},'https://other.invalid'))
    def test_credentials_reject_control_characters(self):
        for key in ('','key\n','key\r','key\t','key secret'):
            with self.assertRaises(Invalid):LiveTransport(key)
    def test_json_duplicate_or_nonfinite_is_rejected(self):
        for raw in ('{"status":"completed","status":"running"}','{"capacity":NaN}'):
            with self.assertRaises(Invalid):strict_json(raw)
    def test_oversized_provider_response_rejected(self):
        with patch('calls.request.build_opener') as factory:
            factory.return_value.open.return_value=io.BytesIO(b' '*2_000_001)
            with self.assertRaises(Invalid):LiveTransport('fictional-key').read('fictional')
    def test_strict_task_completion_type(self):
        value=response();value['task_completed']='true'
        with self.assertRaises(Invalid):normalize_provider_result(value,'fictional')


if __name__=='__main__':unittest.main()
