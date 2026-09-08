"""Role-play truthfulness and provenance boundaries; all providers are local fakes."""
import copy
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from calls import Ledger,build_request,ROLE_PLAY_SCOPE
from optimizer import Invalid,solve,greedy
from workflow import review_result,apply_review,reconcile,evidence_hash,snapshot_hash
from test_workflow import case,context,response
from test_live_workflow import FakeProvider


class RolePlayTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'role-play.sqlite3'
        self.ledger=Ledger(self.path)
        self.ctx=context();self.ctx.update({'test_mode':True,'batch_id':'flex'})
        self.data=case();self.data['simulation']=True
        self.data['partners'][0]['manager_verified']=False
        self.provider=FakeProvider()
        self.sha=build_request(self.ctx,10000)[1]

    def tearDown(self):self.temp.cleanup()

    def retrieve(self):
        self.ledger.start(self.ctx,self.sha,10000,self.provider)
        return self.ledger.read_result(self.sha,self.provider,clock=lambda:10005)

    def review(self,envelope):
        return review_result(self.data,envelope,10001,ledger=self.ledger,clock=lambda:10006)

    def apply(self,envelope,review,ack=True):
        return apply_review(self.data,envelope,10001,review['review_sha'],ack,
                            ledger=self.ledger,clock=lambda:10006)

    def test_default_request_and_explicit_false_keep_existing_approval_digest(self):
        expected='b9a3e8fc91b9ec9a577853ceb2ef30fcd446e25cdb8b56b4a2a05f7fa6f86528'
        original=context();payload,digest=build_request(original,10000)
        self.assertEqual(digest,expected)
        original['test_mode']=False
        self.assertEqual(build_request(original,10000),(payload,digest))
        self.assertNotIn('test_mode',payload['metadata'])

    def test_test_mode_requires_actual_boolean(self):
        for value in (None,0,1,'true','false',[],{}):
            with self.subTest(value=value):
                self.ctx['test_mode']=value
                with self.assertRaisesRegex(Invalid,'test_mode must be a boolean'):
                    build_request(self.ctx,10000)

    def test_test_does_not_bypass_recipient_consent(self):
        self.ctx['consented']=False
        with self.assertRaisesRegex(Invalid,'permission'):
            self.ledger.start(self.ctx,self.sha,10000,self.provider)
        self.assertEqual(self.provider.creates,0)

    def test_prompt_discloses_recorded_fiction_and_requests_short_duration(self):
        payload,_=build_request(self.ctx,10000);task=payload['task']
        for phrase in ('I am an AI assistant','recorded and transcribed','role-play test using fictional quantities',
                       'no real food','still willing to take part','Do not assume they represent an organization',
                       'target under 60 seconds','end the call by 120 seconds',
                       'not a provider-enforced duration limit','politely stop; do not persuade or retry'):
            self.assertIn(phrase,task)
        self.assertNotIn('Ask whether this organization is willing',task)
        self.assertEqual(payload['metadata']['evidence_scope'],ROLE_PLAY_SCOPE)
        self.assertFalse(payload['metadata']['duration_limit_enforced'])
        self.assertEqual(set(payload),{'task','recipients','result_schema','recipient_result_schema','metadata'})

    def test_switching_mode_invalidates_previous_preview_without_call(self):
        self.ctx['test_mode']=False
        self.assertNotEqual(build_request(self.ctx,10000)[1],self.sha)
        with self.assertRaisesRegex(Invalid,'Approval does not match'):
            self.ledger.start(self.ctx,self.sha,10000,self.provider)
        self.assertEqual(self.provider.creates,0)

    def test_provenance_is_durable_before_creation_and_survives_unknown_outcome(self):
        parent=self
        class UncertainProvider:
            def create(self,payload,key):
                with parent.ledger.connection() as db:
                    details=json.loads(db.execute('SELECT details FROM requests WHERE digest=?',(key,)).fetchone()[0])
                parent.assertTrue(details['test_mode'])
                parent.assertEqual(details['evidence_scope'],ROLE_PLAY_SCOPE)
                parent.assertEqual(details['requested_end_by_seconds'],120)
                parent.assertFalse(details['duration_limit_enforced'])
                raise TimeoutError()
        with self.assertRaisesRegex(Invalid,'Do NOT redial'):
            self.ledger.start(self.ctx,self.sha,10000,UncertainProvider())
        self.assertEqual(Ledger(self.path).state(self.sha)['state'],'unknown_reconcile_manually')
        self.assertFalse(self.ledger.start(self.ctx,self.sha,10000,self.provider)['created'])
        self.assertEqual(self.provider.creates,0)

    def test_restart_keeps_role_play_result_without_second_call(self):
        envelope=self.retrieve()
        self.assertTrue(envelope['request']['test_mode'])
        self.assertEqual(envelope['request']['evidence_scope'],ROLE_PLAY_SCOPE)
        self.assertEqual(Ledger(self.path).read_result(self.sha,None),envelope)
        self.assertFalse(self.ledger.start(self.ctx,self.sha,10000,self.provider)['created'])
        self.assertEqual(self.provider.creates,1)

    def test_changed_mode_cannot_bypass_existing_partner_batch_attempt(self):
        self.retrieve();self.ctx['test_mode']=False
        sha=build_request(self.ctx,10000)[1]
        with self.assertRaisesRegex(Invalid,'already have an attempt'):
            self.ledger.start(self.ctx,sha,10000,self.provider)
        self.assertEqual(self.provider.creates,1)

    def test_review_labels_quantity_as_fictional(self):
        review=self.review(self.retrieve())
        self.assertEqual(review['mode'],'private_role_play_review_no_allocation')
        self.assertEqual(review['candidate']['disposition'],'candidate_role_play_confirmation')
        self.assertEqual(review['candidate']['fictional_capacity'],6)
        self.assertNotIn('capacity',review['candidate'])
        self.assertIn('recorded AI role-play disclosure',review['required_review'])
        self.assertFalse(self.data['partners'][0]['manager_verified'])

    def test_role_play_can_be_reviewed_but_never_allocated_into_live_snapshot(self):
        self.data.pop('simulation')
        envelope=self.retrieve();review=self.review(envelope)
        self.assertTrue(review['test_mode']);self.assertFalse(review['simulation_snapshot'])
        with self.assertRaisesRegex(Invalid,'both test_mode=true'):
            self.apply(envelope,review)
        self.assertFalse(self.data['partners'][0]['manager_verified'])

    def test_dual_opt_in_allocates_only_labeled_fiction_with_provider_provenance(self):
        envelope=self.retrieve();before=copy.deepcopy(self.data)
        output=self.apply(envelope,self.review(envelope))
        self.assertEqual(output['mode'],'provider_role_play_simulation')
        self.assertTrue(output['snapshot']['simulation']);self.assertTrue(output['plan']['simulation'])
        self.assertEqual(output['plan']['portions'],6)
        self.assertFalse(output['plan']['real_donation'])
        self.assertEqual(output['snapshot']['partners'][0]['capacity_scope'],ROLE_PLAY_SCOPE)
        self.assertTrue(output['snapshot']['partners'][0]['confirmation_reference'].startswith('ROLE_PLAY:'))
        provenance=output['provenance']
        self.assertEqual(provenance['source'],'call-e-rest-get')
        self.assertEqual(provenance['provider_id'],envelope['provider_id'])
        self.assertEqual(provenance['request_sha'],self.sha)
        for key,value in output['snapshot']['simulation_provenance'].items():
            self.assertEqual(provenance[key],value)
        canonical=json.dumps(output['snapshot'],sort_keys=True,separators=(',',':')).encode()
        self.assertEqual(output['plan']['input_sha256'],hashlib.sha256(canonical).hexdigest())
        self.assertFalse(provenance['real_organization_capacity_confirmed'])
        self.assertFalse(provenance['real_donation'])
        self.assertEqual(self.data,before)

    def test_snapshot_opt_in_cannot_replace_missing_context_opt_in(self):
        self.ctx['test_mode']=False;self.sha=build_request(self.ctx,10000)[1]
        envelope=self.retrieve()
        with self.assertRaisesRegex(Invalid,'both test_mode=true'):
            self.apply(envelope,self.review(envelope))

    def test_simulation_requires_actual_boolean(self):
        envelope=self.retrieve()
        for value in (None,0,1,'true','false',[],{}):
            with self.subTest(value=value):
                self.data['simulation']=value
                with self.assertRaisesRegex(Invalid,'simulation must be a boolean'):
                    self.review(envelope)

    def test_editing_or_removing_saved_role_play_label_is_rejected(self):
        original=self.retrieve()
        for edit in ('remove','false','scope'):
            envelope=copy.deepcopy(original)
            if edit=='remove':envelope['request'].pop('test_mode')
            elif edit=='false':envelope['request']['test_mode']=False
            else:envelope['request']['evidence_scope']='organization_capacity_inquiry'
            with self.subTest(edit=edit),self.assertRaisesRegex(Invalid,'differs from the durable'):
                self.review(envelope)

    def test_snapshot_simulation_toggle_invalidates_existing_approval(self):
        envelope=self.retrieve();review=self.review(envelope)
        self.data['simulation']=False
        with self.assertRaisesRegex(Invalid,'Approval does not match'):
            self.apply(envelope,review)

    def test_human_evidence_approval_still_required_for_simulation(self):
        envelope=self.retrieve();review=self.review(envelope)
        with self.assertRaisesRegex(Invalid,'explicit human verification'):
            self.apply(envelope,review,False)

    def test_role_play_does_not_bypass_freshness(self):
        envelope=self.retrieve();review=self.review(envelope)
        with self.assertRaisesRegex(Invalid,'stale'):
            apply_review(self.data,envelope,10001,review['review_sha'],True,
                         ledger=self.ledger,clock=lambda:14000)

    def test_declined_role_play_stays_held(self):
        result=response();result['recipients'][0]['structured_result'].update({'willing':'no','capacity_portions':0})
        self.provider.results=[result];envelope=self.retrieve();review=self.review(envelope)
        self.assertEqual(review['candidate']['disposition'],'hold')
        with self.assertRaisesRegex(Invalid,'No affirmative capacity'):
            self.apply(envelope,review)

    def test_stripping_simulation_flag_does_not_erase_snapshot_provenance(self):
        envelope=self.retrieve();output=self.apply(envelope,self.review(envelope))
        self.data=output['snapshot'];self.data.pop('simulation')
        with self.assertRaisesRegex(Invalid,'cannot be relabeled'):
            self.review(envelope)
        self.data.pop('simulation_provenance')
        with self.assertRaisesRegex(Invalid,'cannot be relabeled'):
            self.review(envelope)

    def test_provider_role_play_metadata_cannot_enter_direct_real_reconcile(self):
        result=response();result['metadata']={'test_mode':True,'evidence_scope':ROLE_PLAY_SCOPE}
        data=case()
        with self.assertRaisesRegex(Invalid,'cannot confirm real organization capacity'):
            reconcile(data,'near',result,12,10006,snapshot_hash(data),'fictional-call',
                      confirmed_at=10001,evidence_approval_sha=evidence_hash(result,'near',12,10001,'fictional-call'),
                      acknowledge_review=True)

    def test_optimizer_derivative_retains_labeled_approved_role_play_provenance(self):
        envelope=self.retrieve();approved=self.apply(envelope,self.review(envelope))
        original=copy.deepcopy(approved['snapshot']);derived=solve(approved['snapshot'])
        self.assertGreater(derived['portions'],0)
        self.assertTrue(derived['simulation'])
        self.assertEqual(derived['evidence_scope'],ROLE_PLAY_SCOPE)
        self.assertFalse(derived['real_donation'])
        self.assertFalse(derived['real_organization_capacity_confirmed'])
        self.assertEqual(derived['simulation_provenance'],original['simulation_provenance'])
        self.assertEqual(derived['input_sha256'],approved['plan']['input_sha256'])
        derived['simulation_provenance']['source_reference']='edited derivative'
        self.assertEqual(approved['snapshot'],original)

    def test_optimizer_and_baseline_reject_stripped_simulation_opt_in(self):
        envelope=self.retrieve();approved=self.apply(envelope,self.review(envelope))
        for mode in ('missing',False):
            for solver in (solve,greedy):
                data=copy.deepcopy(approved['snapshot'])
                if mode=='missing':data.pop('simulation')
                else:data['simulation']=mode
                with self.subTest(mode=mode,solver=solver.__name__),self.assertRaisesRegex(Invalid,'cannot be relabeled'):
                    solver(data)

    def test_optimizer_rejects_stripped_top_level_provenance_if_partner_is_role_play(self):
        envelope=self.retrieve();approved=self.apply(envelope,self.review(envelope))
        data=approved['snapshot'];data.pop('simulation');data.pop('simulation_provenance')
        with self.assertRaisesRegex(Invalid,'cannot be relabeled'):solve(data)

    def test_optimizer_rejects_nonboolean_simulation(self):
        for value in ('true','false',1,0,None,[]):
            data=case();data['simulation']=value
            with self.subTest(value=value),self.assertRaisesRegex(Invalid,'simulation must be a boolean'):
                solve(data)

    def test_plain_fictional_snapshot_is_labeled_without_provider_claim(self):
        data=case();data['simulation']=True;derived=solve(data)
        self.assertTrue(derived['simulation']);self.assertEqual(derived['evidence_scope'],'fictional_simulation')
        self.assertFalse(derived['real_donation']);self.assertNotIn('simulation_provenance',derived)
        normal=solve(case());self.assertNotIn('simulation',normal)
        self.assertEqual(normal['portions'],derived['portions'])

    def test_optimizer_rejects_conflicting_role_play_provenance(self):
        envelope=self.retrieve();approved=self.apply(envelope,self.review(envelope))
        for key,value in (('test_mode',False),('evidence_scope','real_capacity'),
                          ('real_donation',True),('real_organization_capacity_confirmed',True)):
            data=copy.deepcopy(approved['snapshot']);data['simulation_provenance'][key]=value
            with self.subTest(key=key),self.assertRaisesRegex(Invalid,'conflicting fictional'):
                solve(data)


if __name__=='__main__':unittest.main()
