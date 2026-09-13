"""Local regression tests only. The provider is an injected request spy, not CALL-E."""
from __future__ import annotations
import copy
import json
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
import returnready as rr

NOW = datetime(2026, 9, 7, 12, 0, tzinfo=timezone.utc)


def request():
    return {'merchant': 'Fixture Returns', 'requester': 'Fixture Operator', 'product': 'Keyboard',
            'order_reference': 'TEST-1042', 'phone': '+442079460123', 'region': 'GB', 'locale': 'en-GB',
            'timezone': 'Europe/London', 'written_policy': rr.demo_cases(NOW)['matching']['policy'],
            'consent': {'authorized': True, 'basis': 'Injected local transport only; this fixture number is never dialled.',
                        'expires_at': (NOW + timedelta(hours=2)).isoformat()}}


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        c = rr.demo_cases(NOW)['matching']
        self.p, self.r = c['policy'], c['response']
    def inspect(self): return rr.inspect(self.p, self.r, NOW)
    def rows(self): return self.r['recipients'][0]['structured_result']['fields']
    def turns(self): return self.r['recipients'][0]['attempts'][0]['transcript_turns']
    def test_matches_never_authorize_shipping(self):
        r = self.inspect(); self.assertEqual(r['supported_matches'], 5); self.assertFalse(r['clearance_to_ship'])
        self.assertEqual(r['status'], 'ready_for_human_review')
    def test_changed_address(self):
        c=rr.demo_cases(NOW)['address_conflict'];r=rr.inspect(c['policy'],c['response'],NOW)
        self.assertEqual(r['checks'][1]['status'], 'different_wording');self.assertEqual(r['supported_matches'],4)
    def test_caller_echo_not_evidence(self):
        for t in self.turns(): t['speaker']='bot'
        self.assertEqual(self.inspect()['supported_matches'], 0)
    def test_unknown_speaker_not_evidence(self):
        self.turns()[0]['speaker']='unknown'; self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_summary_cannot_replace_transcript(self):
        self.r['recipients'][0]['attempts']=[];self.r['summary']='All five fields are correct.'
        self.assertEqual(self.inspect()['supported_matches'],0)
    def test_fabricated_quote(self):
        self.rows()[0]['quote']='This was never said.';self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_truncated_identifier_not_supported(self):
        self.rows()[0]['value']='RMA-104';self.p['authorization']['value']='RMA-104'
        self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_truncated_quote_not_supported(self):
        self.rows()[0].update(value='RMA-104',quote='Return authorization: RMA-104');self.p['authorization']['value']='RMA-104'
        self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_value_not_in_quote(self):
        self.rows()[0]['value']='RMA-9999';self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_negation_in_full_turn_survives_short_quote(self):
        self.turns()[0]['text']+=' Do not ship until the new label arrives.'
        self.assertEqual(self.inspect()['checks'][0]['status'],'qualified')
    def test_uncertain_qualifier(self):
        self.turns()[2]['text']+=' This may change.';self.assertEqual(self.inspect()['checks'][2]['status'],'qualified')
    def test_bool_turn_index_is_rejected_as_evidence(self):
        self.rows()[0]['turn_index']=False;self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_negative_turn_index(self):
        self.rows()[0]['turn_index']=-1;self.assertEqual(self.inspect()['checks'][0]['status'],'missing')
    def test_duplicate_field_rejected(self):
        self.rows()[1]=copy.deepcopy(self.rows()[0])
        with self.assertRaises(ValueError):self.inspect()
    def test_unknown_field_rejected(self):
        self.rows()[0]['field']='wire_payment'
        with self.assertRaises(ValueError):self.inspect()
    def test_pending_call(self):
        self.r['status']='in_progress';self.assertEqual(self.inspect()['supported_matches'],0)
    def test_false_task_completion(self):
        self.r['task_completed']=False;self.assertEqual(self.inspect()['supported_matches'],0)
    def test_string_task_completion_is_not_boolean(self):
        self.r['task_completed']='true';self.assertEqual(self.inspect()['supported_matches'],0)
    def test_stale_receipt(self):
        self.r['observed_at']=(NOW-timedelta(hours=25)).isoformat();self.assertEqual(self.inspect()['supported_matches'],0)
    def test_future_receipt(self):
        self.r['observed_at']=(NOW+timedelta(hours=1)).isoformat();self.assertEqual(self.inspect()['supported_matches'],0)
    def test_missing_observed_time(self):
        del self.r['observed_at']
        with self.assertRaises(ValueError):self.inspect()
    def test_timezone_required(self):
        self.r['observed_at']='2026-09-07T12:00:00'
        with self.assertRaises(ValueError):self.inspect()
    def test_no_written_source(self):
        self.p['authorization']=None;self.assertEqual(self.inspect()['checks'][0]['status'],'no_written_source')
    def test_multiple_attempts_not_silently_joined(self):
        self.r['recipients'][0]['attempts']*=2
        with self.assertRaises(ValueError):self.inspect()
    def test_multiple_recipients_rejected(self):
        self.r['recipients']*=2
        with self.assertRaises(ValueError):self.inspect()
    def test_expired_deadline(self):
        val='2026-09-01';self.p['deadline']['value']=val;self.rows()[3].update(value=val,quote=val);self.turns()[3]['text']=val
        self.assertEqual(self.inspect()['checks'][3]['status'],'expired_deadline')
    def test_impossible_deadline_is_not_accepted(self):
        val='2026-99-99';self.p['deadline']['value']=val;self.rows()[3].update(value=val,quote=val);self.turns()[3]['text']=val
        self.assertEqual(self.inspect()['checks'][3]['status'],'date_ambiguous')
    def test_relative_deadline_is_not_guessed(self):
        val='next Friday';self.p['deadline']['value']=val;self.rows()[3].update(value=val,quote=val);self.turns()[3]['text']=val
        self.assertEqual(self.inspect()['checks'][3]['status'],'date_ambiguous')
    def test_hash_changes_with_actual_source(self):
        first=self.inspect()['source_sha256'];self.turns()[0]['text']+=' Extra source context.'
        self.assertNotEqual(first,self.inspect()['source_sha256'])
    def test_policy_hash_changes(self):
        first=self.inspect()['policy_sha256'];self.p['terms']['source']='Different supplied document'
        self.assertNotEqual(first,self.inspect()['policy_sha256'])
    def test_arbitrary_extra_extraction_field_rejected(self):
        self.rows()[0]['approved']=True
        with self.assertRaises(ValueError):self.inspect()


class RequestTests(unittest.TestCase):
    def test_valid_explicit_request(self):self.assertEqual(rr.validate_request(request(),NOW)['region'],'GB')
    def test_no_authorization(self):
        r=request();r['consent']['authorized']=False
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_ambiguous_phone(self):
        r=request();r['phone']='020 1234 5678'
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_reserved_fictional_phone(self):
        r=request();r['phone']='+12025550123'
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_expired_consent(self):
        r=request();r['consent']['expires_at']=NOW.isoformat()
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_unknown_timezone(self):
        r=request();r['timezone']='Mystery/Somewhere'
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_exact_five_policy_fields(self):
        r=request();r['written_policy'].pop('terms')
        with self.assertRaises(ValueError):rr.validate_request(r,NOW)
    def test_payload_real_documented_shapes(self):
        p=rr.payload(rr.validate_request(request(),NOW),'rr_test')
        self.assertEqual(p['recipients'][0]['phones'],['+442079460123'])
        self.assertIn('recipient_result_schema',p);self.assertIn('Do not buy',p['task'])
        self.assertIn('AI assistant',p['task']);self.assertNotIn('webhook_url',p)


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'cases.sqlite3';self.calls=[]
        def spy(method,path,body,key):
            self.calls.append((method,path,body,key))
            if method=='POST':return {'id':'call_local_fixture_1','status':'queued'}
            return {'id':'call_local_fixture_1','status':'completed','task_completed':False,'recipients':[]}
        self.spy=spy;self.ledger=rr.Ledger(self.path,rr.CalleHTTP('TEST-NOT-A-CREDENTIAL',transport=spy))
        self.preview=self.ledger.preview(request(),NOW)
    def tearDown(self):self.temp.cleanup()
    def start(self,now=NOW,hash_=None,confirmation=None):
        p=self.preview
        return self.ledger.start(p['id'],hash_ or p['request_sha256'],confirmation or p['confirmation'],now)
    def test_duplicate_previews_share_same_case(self):
        p=self.ledger.preview(request(),NOW);self.assertEqual(p['id'],self.preview['id']);self.assertTrue(p['existing']);self.assertEqual(self.calls,[])
    def test_uncertain_request_cannot_be_recreated_identically(self):
        self.ledger.provider=rr.CalleHTTP('TEST',transport=lambda *a:{'isError':True})
        self.start();p=self.ledger.preview(request(),NOW);self.assertEqual(p['id'],self.preview['id']);self.assertEqual(p['state'],'uncertain')
    def test_preview_never_calls_provider(self):self.assertEqual(self.calls,[])
    def test_start_posts_once_with_idempotency(self):
        j=self.start();self.assertEqual(j['state'],'running');self.assertEqual(len(self.calls),1)
        self.assertEqual(self.calls[0][0:2],('POST','/v1/calls'));self.assertEqual(self.calls[0][3],self.preview['id'])
    def test_double_click_does_not_redial(self):
        self.start()
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(len(self.calls),1)
    def test_restart_does_not_redial(self):
        self.start();self.ledger=rr.Ledger(self.path,rr.CalleHTTP('TEST',transport=self.spy))
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(len(self.calls),1)
    def test_wrong_hash(self):
        with self.assertRaises(ValueError):self.start(hash_='changed')
        self.assertEqual(self.calls,[])
    def test_wrong_recipient_confirmation(self):
        with self.assertRaises(ValueError):self.start(confirmation='yes')
        self.assertEqual(self.calls,[])
    def test_quiet_hours(self):
        r=request();r['consent']['expires_at']=(NOW+timedelta(days=1)).isoformat()
        self.preview=self.ledger.preview(r,NOW)
        with self.assertRaises(ValueError):self.start(now=NOW.replace(hour=20))
        self.assertEqual(self.calls,[])
    def test_expiry_rechecked_at_start(self):
        with self.assertRaises(ValueError):self.start(now=NOW+timedelta(hours=3))
        self.assertEqual(self.calls,[])
    def test_timeout_is_uncertain_without_automatic_retry(self):
        def timeout(*args):self.calls.append(args);raise TimeoutError('possible credential should not persist')
        self.ledger.provider=rr.CalleHTTP('TEST',transport=timeout)
        j=self.start();self.assertEqual(j['state'],'uncertain');self.assertNotIn('credential',json.dumps(j['detail']))
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(len(self.calls),1)
    def test_explicit_provider_error_is_not_success(self):
        self.ledger.provider=rr.CalleHTTP('TEST',transport=lambda *a:{'id':'call_fake','isError':True})
        self.assertEqual(self.start()['state'],'uncertain')
    def test_missing_id_is_not_success(self):
        self.ledger.provider=rr.CalleHTTP('TEST',transport=lambda *a:{'status':'success'})
        self.assertEqual(self.start()['state'],'uncertain')
    def test_poll_gets_same_call_without_redial(self):
        self.start();j=self.ledger.poll(self.preview['id']);self.assertEqual(j['state'],'completed')
        self.assertEqual(self.calls[-1][0:2],('GET','/v1/calls/call_local_fixture_1'))
        self.assertEqual(sum(c[0]=='POST' for c in self.calls),1)
    def test_poll_does_not_refresh_terminal_observation(self):
        self.start();a=self.ledger.poll(self.preview['id']);b=self.ledger.poll(self.preview['id'])
        self.assertEqual(a['detail']['observed_at'],b['detail']['observed_at'])
    def test_poll_mismatched_call_id(self):
        self.start();self.ledger.provider=rr.CalleHTTP('TEST',transport=lambda *a:{'id':'different','status':'completed'})
        with self.assertRaises(ValueError):self.ledger.poll(self.preview['id'])
    def test_cancel_unstarted(self):
        self.ledger.cancel(self.preview['id'])
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(self.calls,[])
    def test_active_cancel_not_falsely_claimed(self):
        self.start()
        with self.assertRaises(ValueError):self.ledger.cancel(self.preview['id'])
        self.assertEqual(self.ledger.get(self.preview['id'])['state'],'running')
    def test_concurrent_start_only_one_send(self):
        outcomes=[]
        def start():
            try:outcomes.append(self.start()['state'])
            except ValueError:outcomes.append('blocked')
        a,b=threading.Thread(target=start),threading.Thread(target=start);a.start();b.start();a.join();b.join()
        self.assertEqual(len(self.calls),1);self.assertCountEqual(outcomes,['running','blocked'])
    def test_simulated_crash_after_claim_stays_blocked(self):
        with self.ledger.db() as db:db.execute("UPDATE jobs SET state='starting' WHERE id=?",(self.preview['id'],))
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(self.calls,[])
    def test_database_is_private(self):self.assertEqual(self.path.stat().st_mode & 0o777,0o600)
    def test_no_provider_cannot_dial(self):
        self.ledger.provider=None
        with self.assertRaises(ValueError):self.start()
        self.assertEqual(self.calls,[])
    def test_provider_id_path_injection_rejected(self):
        with self.assertRaises(ValueError):self.ledger.provider.status('../private')
        self.assertEqual(self.calls,[])


if __name__=='__main__':unittest.main(verbosity=2)
