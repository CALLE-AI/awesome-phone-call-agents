import unittest
from test_workflow import case,response
from workflow import reconcile as reconcile_approved,snapshot_hash,demo,evidence_hash
from optimizer import Invalid

def reconcile(data,partner,result,offered,now,approval,reference):
 return reconcile_approved(data,partner,result,offered,now,approval,reference,confirmed_at=now,
   evidence_approval_sha=evidence_hash(result,partner,offered,now,reference),acknowledge_review=True)

class Tests(unittest.TestCase):
 def test_fixture_handoff_requires_approval(self):self.assertIsNone(demo(False)['after'])
 def test_fixture_handoff_works(self):
  r=demo(True);self.assertEqual(r['before']['portions'],6);self.assertEqual(r['after']['portions'],12)
 def test_snapshot_binding(self):
  d=case();h=snapshot_hash(d);d['batches'][0]['portions']=5
  with self.assertRaises(Invalid):reconcile(d,'near',response(),12,10000,h,'fictional')
 def test_does_not_mutate_input(self):
  d=case();h=snapshot_hash(d);reconcile(d,'near',response(),12,10000,h,'fictional');self.assertEqual(snapshot_hash(d),h)
 def test_unknown_cannot_be_promoted(self):
  d=case();r=response();r['recipients'][0]['structured_result']['willing']='unknown'
  with self.assertRaises(Invalid):reconcile(d,'near',r,12,10000,snapshot_hash(d),'fictional')
 def test_unknown_partner_rejected(self):
  d=case()
  with self.assertRaises(Invalid):reconcile(d,'missing',response(),12,10000,snapshot_hash(d),'fictional')
if __name__=='__main__':unittest.main()
