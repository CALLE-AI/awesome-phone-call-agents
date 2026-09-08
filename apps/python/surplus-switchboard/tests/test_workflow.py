import copy
import itertools
import json
from pathlib import Path
import random
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from optimizer import solve,greedy,validate,Invalid
from calls import build_request,Ledger,interpret

ROOT=Path(__file__).resolve().parents[1]

def case():
    return {'now':10000,'confirmation_ttl':3600,
      'batches':[{'id':'flex','portions':6,'category':'produce','ready_at':9000,'expires_at':20000,'operator_cleared':True},
                 {'id':'limited','portions':6,'category':'bread','ready_at':9000,'expires_at':20000,'operator_cleared':True}],
      'partners':[{'id':'near','capacity':6,'confirmed_at':9990,'receive_by':20000,'manager_verified':True,'accepts':['produce','bread']},
                  {'id':'far','capacity':6,'confirmed_at':9990,'receive_by':20000,'manager_verified':True,'accepts':['produce']}],
      'lanes':[{'batch':'flex','partner':'near','minutes':1},{'batch':'flex','partner':'far','minutes':2},
               {'batch':'limited','partner':'near','minutes':3}]}

def context():
    return {'consented':True,'consent_reference':'fictional-test-opt-in','phone':'+12025550123',
     'call_not_before':9000,'call_before':11000,'partner_id':'near','batch_id':'demo',
     'category':'produce','operator_name':'Fictional demonstration kitchen','offered_portions':12}

def response():
    return {'status':'completed','task_completed':True,'recipients':[{'structured_result':
     {'willing':'yes','capacity_portions':6,'evidence_quote':'Yes, six portions.'},
     'attempts':[{'transcript_turns':[{'speaker':'user','text':'Yes, six portions.'}]}]}]}

class FlowTests(unittest.TestCase):
    def test_rerouting_beats_greedy(self):
        d=case();self.assertEqual(greedy(d),(6,6));r=solve(d)
        self.assertEqual((r['portions'],r['portion_minutes']),(12,30))
    def test_certificate(self):
        r=solve(case());self.assertEqual(r['portions'],r['max_flow_certificate']['cut_capacity'])
        self.assertFalse(r['max_flow_certificate']['sink_reachable'])
    def test_stale_confirmation(self):
        d=case();d['partners'][0]['confirmed_at']=0;self.assertEqual(solve(d)['portions'],6)
    def test_future_confirmation(self):
        d=case();d['partners'][0]['confirmed_at']=10001;self.assertEqual(solve(d)['portions'],6)
    def test_unverified_capacity(self):
        d=case();d['partners'][0]['manager_verified']=False;self.assertEqual(solve(d)['portions'],6)
    def test_uncleared_food(self):
        d=case();d['batches'][0]['operator_cleared']=False;self.assertEqual(solve(d)['portions'],6)
    def test_expiry_equality_rejected(self):
        d=case();d['batches'][0]['expires_at']=10060;self.assertEqual(solve(d)['portions'],6)
    def test_receive_cutoff(self):
        d=case();d['partners'][0]['receive_by']=10010;self.assertEqual(solve(d)['portions'],6)
    def test_ready_time_used(self):
        d=case();d['batches'][0]['ready_at']=19900;self.assertEqual(solve(d)['portions'],6)
    def test_no_lanes(self):
        d=case();d['lanes']=[];self.assertEqual(solve(d)['portions'],0)
    def test_boolean_capacity_invalid(self):
        d=case();d['partners'][0]['capacity']=True
        with self.assertRaises(Invalid):solve(d)
    def test_duplicate_id_invalid(self):
        d=case();d['batches'].append(d['batches'][0])
        with self.assertRaises(Invalid):solve(d)
    def test_duplicate_lane_invalid(self):
        d=case();d['lanes'].append(d['lanes'][0])
        with self.assertRaises(Invalid):solve(d)
    def test_unknown_lane_invalid(self):
        d=case();d['lanes'][0]['batch']='missing'
        with self.assertRaises(Invalid):solve(d)
    def test_random_exact_oracle(self):
        rng=random.Random(70926)
        for _ in range(200):
            d=case()
            for b in d['batches']:b['portions']=rng.randrange(4)
            for p in d['partners']:p['capacity']=rng.randrange(4);p['accepts']=['produce','bread']
            d['lanes']=[{'batch':b['id'],'partner':p['id'],'minutes':rng.randrange(8)}
              for b in d['batches'] for p in d['partners'] if rng.random()<.85]
            bs,ps,lanes,_=validate(d);best=(0,0)
            # Independent exhaustive allocation enumeration, not another flow implementation.
            for xs in itertools.product(range(4),repeat=len(lanes)):
                if any(sum(x for x,l in zip(xs,lanes) if l['batch']==b['id'])>b['portions'] for b in bs):continue
                if any(sum(x for x,l in zip(xs,lanes) if l['partner']==p['id'])>p['capacity'] for p in ps):continue
                objective=(-sum(xs),sum(x*l['minutes'] for x,l in zip(xs,lanes)))
                best=min(best,objective)
            result=solve(d)
            self.assertEqual((-result['portions'],result['portion_minutes']),best)
            self.assertEqual(result['portions'],result['max_flow_certificate']['cut_capacity'])

class CallTests(unittest.TestCase):
    def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'calls.db';self.ledger=Ledger(self.path)
    def tearDown(self):self.tmp.cleanup()
    def test_preview_schema(self):
        p,h=build_request(context(),10000);self.assertEqual(len(h),64);self.assertEqual(p['recipients'][0]['phones'],['+12025550123'])
    def test_permission_required(self):
        c=context();c['consented']=False
        with self.assertRaises(Invalid):build_request(c,10000)
    def test_window_closed(self):
        with self.assertRaises(Invalid):build_request(context(),11000)
    def test_window_not_started(self):
        with self.assertRaises(Invalid):build_request(context(),8999)
    def test_bad_phone(self):
        c=context();c['phone']='911'
        with self.assertRaises(Invalid):build_request(c,10000)
    def test_approval_binds_number(self):
        c=context();_,h=build_request(c,10000);c['phone']='+12025550124'
        with self.assertRaises(Invalid):self.ledger.start(c,h,10000,None)
    def test_approval_binds_quantity(self):
        c=context();_,h=build_request(c,10000);c['offered_portions']=13
        with self.assertRaises(Invalid):self.ledger.start(c,h,10000,None)
    def test_success_duplicate_not_replayed(self):
        class T:
            count=0
            def create(self,p,k):self.count+=1;return {'call_id':'fixture-123'}
        t=T();c=context();_,h=build_request(c,10000)
        self.assertTrue(self.ledger.start(c,h,10000,t)['created'])
        self.assertFalse(self.ledger.start(c,h,10000,t)['created']);self.assertEqual(t.count,1)
    def test_timeout_not_replayed(self):
        class T:
            count=0
            def create(self,p,k):self.count+=1;raise TimeoutError('simulated')
        t=T();c=context();_,h=build_request(c,10000)
        with self.assertRaises(Invalid):self.ledger.start(c,h,10000,t)
        self.assertEqual(self.ledger.start(c,h,10000,t)['state'],'unknown_reconcile_manually');self.assertEqual(t.count,1)
    def test_malformed_response_hold(self):
        class T:
            def create(self,p,k):return {'status':'accepted'}
        c=context();_,h=build_request(c,10000)
        with self.assertRaises(Invalid):self.ledger.start(c,h,10000,T())
        self.assertEqual(self.ledger.state(h)['state'],'unknown_reconcile_manually')
    def test_restart_no_redial(self):
        c=context();_,h=build_request(c,10000)
        with closing(sqlite3.connect(self.path)) as db:
            with db:db.execute('INSERT INTO calls VALUES (?,?,NULL)',(h,'submitting'))
        self.assertFalse(Ledger(self.path).start(c,h,10000,None)['created'])
    def test_concurrent_creation_once(self):
        class T:
            count=0
            def create(self,p,k):self.count+=1;return {'id':'fixture-456'}
        t=T();c=context();_,h=build_request(c,10000)
        with ThreadPoolExecutor(max_workers=4) as ex:
            rs=list(ex.map(lambda _:Ledger(self.path).start(c,h,10000,t),range(4)))
        self.assertEqual(t.count,1);self.assertEqual(sum(r['created'] for r in rs),1)
    def test_consent_revoked_at_dispatch(self):
        c=context();_,h=build_request(c,10000);c['consented']=False
        with self.assertRaises(Invalid):self.ledger.start(c,h,10000,None)
    def test_affirmative_still_human_review(self):
        r=interpret(response(),12);self.assertEqual(r['capacity'],6);self.assertTrue(r['requires_human_review'])
    def test_bot_quote_cannot_confirm(self):
        r=response();r['recipients'][0]['attempts'][0]['transcript_turns'][0]['speaker']='bot'
        self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_missing_quote_hold(self):
        r=response();r['recipients'][0]['structured_result']['evidence_quote']='I accept twelve.'
        self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_overcapacity_hold(self):
        r=response();r['recipients'][0]['structured_result']['capacity_portions']=13
        self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_boolean_capacity_hold(self):
        r=response();r['recipients'][0]['structured_result']['capacity_portions']=True
        self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_completion_does_not_mean_consent(self):
        for status in ('no','unknown'):
            r=response();r['recipients'][0]['structured_result']['willing']=status
            self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_multiple_recipients_hold(self):
        r=response();r['recipients'].append(r['recipients'][0]);self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_task_completed_string_hold(self):
        r=response();r['task_completed']='true';self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_extra_field_hold(self):
        r=response();r['recipients'][0]['structured_result']['assign_now']=True
        self.assertEqual(interpret(r,12)['disposition'],'hold')
    def test_null_capacity_hold(self):
        r=response();r['recipients'][0]['structured_result']['capacity_portions']=None
        self.assertEqual(interpret(r,12)['disposition'],'hold')

if __name__=='__main__':unittest.main()
