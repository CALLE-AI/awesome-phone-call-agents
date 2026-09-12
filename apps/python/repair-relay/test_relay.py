import copy
import json
import sqlite3
import unittest
from pathlib import Path
from relay import assess, connect, decide, preview, refresh, send, validate_case

ROOT = Path(__file__).parent


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.case = json.loads((ROOT / 'examples/case.json').read_text())
        self.result = json.loads((ROOT / 'examples/result.json').read_text())
        self.db = connect(':memory:')
        self.addCleanup(self.db.close)

    def test_preview_is_stable_and_changes_with_recipient(self):
        first = preview(self.case)
        self.assertEqual(first, preview(self.case))
        self.case['contact']['phone'] = '+12025550124'
        self.assertNotEqual(first['approval_digest'], preview(self.case)['approval_digest'])

    def test_consent_and_timezones_required(self):
        self.case['contact']['consent'] = False
        with self.assertRaises(ValueError):
            preview(self.case)
        self.case['contact']['consent'] = True
        self.case['windows'][0]['start'] = '2026-09-18T09:00:00'
        with self.assertRaises(ValueError):
            validate_case(self.case)

    def test_synthetic_cannot_send(self):
        with self.assertRaises(ValueError):
            send(self.db, self.case, preview(self.case)['approval_digest'], lambda *a: self.fail('Must not call'))

    def test_stale_approval_cannot_send(self):
        self.case['synthetic'] = False
        with self.assertRaises(ValueError):
            send(self.db, self.case, 'stale', lambda *a: self.fail('Must not call'))

    def test_duplicate_and_uncertain_create_never_retry(self):
        self.case['synthetic'] = False
        digest = preview(self.case)['approval_digest']
        calls = []
        def lost_response(*args):
            calls.append(args)
            raise TimeoutError()
        with self.assertRaises(RuntimeError):
            send(self.db, self.case, digest, lost_response)
        with self.assertRaises(sqlite3.IntegrityError):
            send(self.db, self.case, digest, lost_response)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.db.execute('SELECT state FROM calls').fetchone()[0], 'unknown')

    def test_full_transport_contract_and_review(self):
        self.case['synthetic'] = False
        digest = preview(self.case)['approval_digest']
        def create(method, path, body, key):
            self.assertEqual((method, path, key), ('POST', '/v1/calls', digest))
            self.assertEqual(body['recipients'][0]['region'], 'US')
            return {'id': 'call_test'}
        send(self.db, self.case, digest, create)
        def read(method, path):
            self.assertEqual((method, path), ('GET', '/v1/calls/call_test'))
            return self.result
        self.assertEqual(refresh(self.db, digest, read)['state'], 'review_ready')
        decision = decide(self.db, digest, 'accept_availability', 'Read transcript and verified window')
        self.assertFalse(decision['appointment_booked'])

    def test_quote_must_be_recipient_words(self):
        self.result['recipients'][0]['structured_result']['quote'] = 'Would Friday morning or Saturday from one to three work?'
        self.assertEqual(assess(self.case, self.result)['state'], 'needs_review')

    def test_unknown_window_rejected(self):
        self.result['recipients'][0]['structured_result']['available_window_ids'] = ['invented']
        self.assertEqual(assess(self.case, self.result)['windows'], [])

    def test_completed_transport_is_not_task_success(self):
        self.result['task_completed'] = False
        self.assertEqual(assess(self.case, self.result)['state'], 'needs_review')

    def test_malformed_provider_fields_do_not_crash(self):
        for result in [None, [], {'status': 'completed', 'task_completed': True, 'recipients': None},
                       {'status': 'completed', 'task_completed': True, 'recipients': [None]}]:
            with self.subTest(result=result):
                self.assertEqual(assess(self.case, result)['state'], 'needs_review')
        self.result['recipients'][0]['attempts'] = [{'transcript_turns': None}]
        self.assertEqual(assess(self.case, self.result)['state'], 'needs_review')

    def test_changed_result_invalidates_review(self):
        self.case['synthetic'] = False
        digest = preview(self.case)['approval_digest']
        send(self.db, self.case, digest, lambda *args: {'id': 'call_test'})
        refresh(self.db, digest, lambda *args: self.result)
        decide(self.db, digest, 'accept_availability', 'Reviewed original transcript')
        refresh(self.db, digest, lambda *args: self.result)
        self.assertEqual(self.db.execute('SELECT decision FROM calls').fetchone()[0], 'accept_availability')
        self.result['recipients'][0]['structured_result']['outcome'] = 'unavailable'
        refresh(self.db, digest, lambda *args: self.result)
        self.assertIsNone(self.db.execute('SELECT decision FROM calls').fetchone()[0])


if __name__ == '__main__':
    unittest.main()
