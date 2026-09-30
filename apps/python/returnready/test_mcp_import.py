"""Synthetic adapter regressions. None of these tests contact CALL-E."""
import copy
import json
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
import returnready as rr
import mcp_import as mi

NOW = datetime(2000, 1, 3, 12, 0, tzinfo=timezone.utc)
RUN = 'synthetic_run_001'


def fixture(now=NOW):
    demo = rr.demo_cases(now)['matching']
    turns = demo['response']['recipients'][0]['attempts'][0]['transcript_turns']
    transcript = '\n'.join(f"[00:00:{i*8:02d}] USER: {t['text']}" for i, t in enumerate(turns))
    raw = {'run_id': RUN, 'status': 'COMPLETED', 'result': {
        'call_id': 'synthetic_call_001', 'call_ids': ['synthetic_call_001'], 'batch': None,
        'outcome': {'task_completed': True, 'completion_confidence': {'score': 1.0}},
        'extracted': {'calling': {'calls': [{'status': 'COMPLETED', 'duration_seconds': 48}], 'callee_count': 1}},
        'transcript': transcript}, 'next_step': {'action': 'report_completed'}}
    return raw, demo['policy'], demo['response']['recipients'][0]['structured_result']['fields']


class MCPImportTests(unittest.TestCase):
    def setUp(self):
        self.raw, self.policy, self.fields = fixture()
        self.args = dict(expected_run_id=RUN, observed_at=NOW.isoformat(),
                         consent={'state': 'granted', 'basis': 'Synthetic recipient permission fixture.'}, now=NOW)

    def adapt(self, **kw):
        return mi.adapt(self.raw, fields=self.fields, **{**self.args, **kw})

    def test_unavailable_consent_overrides_provider_success(self):
        r=self.adapt(consent={'state':'not_granted','basis':'Permission unavailable in synthetic example.'})
        self.assertFalse(r['task_completed']);self.assertEqual(rr.inspect(self.policy,r,NOW)['supported_matches'],0)
        self.assertTrue(r['mcp_receipt']['provider_task_completed'])

    def test_unknown_consent_is_blocked(self):
        self.assertFalse(self.adapt(consent={'state':'unknown','basis':'Not established.'})['task_completed'])

    def test_blocked_result_does_not_retain_transcript_or_claims(self):
        r=self.adapt(consent={'state':'not_granted','basis':'No permission.'})
        self.assertEqual(r['recipients'][0]['attempts'][0]['transcript_turns'],[])
        self.assertEqual(r['recipients'][0]['structured_result']['fields'],[])
        self.assertNotIn('RMA-1042',json.dumps(r));self.assertFalse(r['mcp_receipt']['automatic_retry'])

    def test_blocked_raw_text_need_not_be_parsed(self):
        self.raw['result']['transcript']='private material in an unsupported format'
        self.assertFalse(self.adapt(consent={'state':'not_granted','basis':'No permission.'})['task_completed'])

    def test_provider_blocked_action_wins_over_success_claim(self):
        self.raw['next_step']['action']='report_blocked'
        self.assertFalse(self.adapt()['task_completed'])

    def test_nested_blocked_action_is_respected(self):
        self.raw['result']['extracted']['repair']={'decision':{'next_step':{'action':'report_blocked'}}}
        self.assertFalse(self.adapt()['task_completed'])

    def test_explicit_refusal_cannot_be_overridden_by_consent_checkbox(self):
        self.raw['result']['transcript']+='\n[00:00:35] USER: I am not able to grant permissions.'
        r=self.adapt();self.assertFalse(r['task_completed']);self.assertTrue(r['mcp_receipt']['recipient_refusal_detected'])
        self.assertEqual(r['recipients'][0]['attempts'][0]['transcript_turns'],[])

    def test_caller_refusal_words_are_not_recipient_consent(self):
        self.raw['result']['transcript']+='\n[00:00:35] BOT: Say do not record to stop.'
        self.assertTrue(self.adapt()['task_completed'])

    def test_false_provider_flag_is_blocked(self):
        self.raw['result']['outcome']['task_completed']=False
        self.assertFalse(self.adapt()['task_completed'])

    def test_truthy_string_flag_is_rejected(self):
        self.raw['result']['outcome']['task_completed']='true'
        with self.assertRaises(ValueError):self.adapt()

    def test_explicit_errors_are_not_success(self):
        for location in ('root','result'):
            for key,value in [('isError',True),('ok',False),('error','local fixture failure')]:
                with self.subTest(location=location,key=key):
                    raw=copy.deepcopy(self.raw);(raw if location=='root' else raw['result'])[key]=value
                    self.assertFalse(mi.adapt(raw,**self.args)['task_completed'])

    def test_failed_transport_is_blocked(self):
        self.raw['status']='FAILED';self.assertFalse(self.adapt()['task_completed'])

    def test_nonterminal_status_rejected(self):
        for s in ('READY','RUNNING','PENDING','completed'):
            self.raw['status']=s
            with self.subTest(status=s),self.assertRaises(ValueError):self.adapt()

    def test_wrong_run_is_rejected(self):
        with self.assertRaises(ValueError):self.adapt(expected_run_id='other_run')

    def test_multiple_call_ids_rejected(self):
        self.raw['result']['call_ids'].append('different')
        with self.assertRaises(ValueError):self.adapt()

    def test_multiple_attempts_rejected(self):
        self.raw['result']['extracted']['calling']['calls']*=2
        with self.assertRaises(ValueError):self.adapt()

    def test_batch_rejected(self):
        self.raw['result']['batch']={}
        with self.assertRaises(ValueError):self.adapt()

    def test_multiple_callees_rejected(self):
        self.raw['result']['extracted']['calling']['callee_count']=2
        with self.assertRaises(ValueError):self.adapt()

    def test_future_observation_rejected(self):
        with self.assertRaises(ValueError):self.adapt(observed_at=(NOW+timedelta(seconds=1)).isoformat())

    def test_timezone_required(self):
        with self.assertRaises(ValueError):self.adapt(observed_at='2000-01-03T12:00:00')

    def test_stale_result_is_not_refreshed(self):
        old=(NOW-timedelta(hours=25)).isoformat();r=self.adapt(observed_at=old)
        self.assertEqual(r['observed_at'],old)
        session=rr.save_session(self.policy,r,False)
        reopened=rr.restore_session(session,NOW)
        self.assertEqual(reopened['report']['supported_matches'],0)
        self.assertEqual(reopened['response']['observed_at'],old)

    def test_no_extraction_is_invented(self):
        r=mi.adapt(self.raw,**self.args)
        self.assertEqual(rr.inspect(self.policy,r,NOW)['supported_matches'],0)
        self.assertEqual(r['recipients'][0]['structured_result']['fields'],[])

    def test_explicit_source_quotes_reuse_existing_review_engine(self):
        r=self.adapt();review=rr.inspect(self.policy,r,NOW)
        self.assertEqual(review['supported_matches'],5);self.assertFalse(review['clearance_to_ship'])
        self.assertEqual(review['status'],'ready_for_human_review')

    def test_source_turns_and_time_preserved(self):
        r=self.adapt();turns=r['recipients'][0]['attempts'][0]['transcript_turns']
        self.assertEqual(turns[1]['offset_seconds'],8);self.assertEqual(turns[1]['speaker'],'user')
        self.assertEqual(turns[1]['text'],self.fields[1]['quote'])

    def test_caller_only_evidence_rejected(self):
        self.raw['result']['transcript']=self.raw['result']['transcript'].replace('USER:','BOT:')
        self.assertEqual(rr.inspect(self.policy,self.adapt(),NOW)['supported_matches'],0)

    def test_invented_annotation_does_not_match(self):
        self.fields[1]['value']='Invented address'
        self.assertEqual(rr.inspect(self.policy,self.adapt(),NOW)['supported_matches'],4)

    def test_malformed_transcript_rejected_when_processing_permitted(self):
        self.raw['result']['transcript']='USER: no timestamp'
        with self.assertRaises(ValueError):self.adapt()

    def test_out_of_order_transcript_rejected(self):
        self.raw['result']['transcript']='[00:00:10] USER: First\n[00:00:01] USER: Earlier'
        with self.assertRaises(ValueError):self.adapt()

    def test_unsupported_timestamp_rejected(self):
        self.raw['result']['transcript']='[00:70:10] USER: Invalid'
        with self.assertRaises(ValueError):self.adapt()

    def test_input_is_unchanged(self):
        raw=copy.deepcopy(self.raw);fields=copy.deepcopy(self.fields);r=self.adapt()
        r['recipients'][0]['structured_result']['fields'][0]['value']='edited'
        self.assertEqual(self.raw,raw);self.assertEqual(self.fields,fields)

    def test_receipt_cannot_claim_permission_with_blocked_inputs(self):
        r=self.adapt(consent={'state':'not_granted','basis':'Not granted.'});r['mcp_receipt']['processing_permitted']=True
        with self.assertRaises(ValueError):rr.inspect(self.policy,r,NOW)

    def test_receipt_cannot_request_automatic_retry(self):
        r=self.adapt();r['mcp_receipt']['automatic_retry']=True
        with self.assertRaises(ValueError):rr.inspect(self.policy,r,NOW)

    def test_withheld_receipt_cannot_contain_transcript(self):
        r=self.adapt(consent={'state':'not_granted','basis':'No permission.'})
        r['recipients'][0]['attempts'][0]['transcript_turns']=[{'speaker':'user','text':'private'}]
        with self.assertRaises(ValueError):rr.inspect(self.policy,r,NOW)

    def test_observation_cannot_be_refreshed_independently(self):
        r=self.adapt();r['observed_at']=(NOW+timedelta(minutes=1)).isoformat()
        with self.assertRaises(ValueError):rr.inspect(self.policy,r,NOW)

    def test_blocked_session_reopens_with_metadata_only(self):
        session=mi.to_session(self.raw,policy=self.policy,**{**self.args,'consent':{'state':'not_granted','basis':'No permission.'}})
        reopened=rr.restore_session(session,NOW)
        self.assertFalse(reopened['synthetic']);self.assertEqual(reopened['report']['supported_matches'],0)
        self.assertTrue(reopened['report']['mcp_receipt']['transcript_withheld'])

    def test_no_network_in_adapter(self):
        with patch('urllib.request.urlopen',side_effect=AssertionError('network forbidden')):
            self.adapt()

    def test_oversized_input_rejected(self):
        self.raw['extra']='x'*180001
        with self.assertRaises(ValueError):self.adapt()

    def test_cli_refuses_to_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'raw.json').write_text(json.dumps(self.raw));(root/'policy.json').write_text(json.dumps(self.policy));(root/'saved.json').write_text('original')
            proc=subprocess.run([sys.executable,str(Path(mi.__file__)),'--input',str(root/'raw.json'),'--policy',str(root/'policy.json'),'--expected-run-id',RUN,'--observed-at','2000-01-03T00:00:00Z','--consent','unknown','--consent-basis','Unconfirmed.','--output',str(root/'saved.json')],capture_output=True,text=True)
            self.assertEqual(proc.returncode,2);self.assertEqual((root/'saved.json').read_text(),'original')


if __name__=='__main__':unittest.main()
