"""Additional tests on recovered prototype; all provider traffic is injected or loopback."""
from datetime import datetime,timedelta,timezone
from pathlib import Path
import copy,json,sqlite3,tempfile,threading,unittest
import returnready as rr
from test_returnready import request,NOW

class CompletionTests(unittest.TestCase):
 def setUp(self):
  c=rr.demo_cases(NOW)['matching'];self.p,self.r=copy.deepcopy(c['policy']),copy.deepcopy(c['response'])
 def rows(self):return self.r['recipients'][0]['structured_result']['fields']
 def turns(self):return self.r['recipients'][0]['attempts'][0]['transcript_turns']
 def result(self):return rr.inspect(self.p,self.r,NOW)
 def test_late_destination_correction_blocks_earlier_match(self):
  self.turns().append({'speaker':'user','text':'Correction: the address is now 22 Different Road.'});r=self.result();self.assertEqual(r['supported_matches'],4);c=r['checks'][1];self.assertEqual(c['status'],'revision_review');self.assertEqual(c['revision_turns'][0]['turn_index'],5);self.assertIn('22 Different Road',r['open_questions'][0])
 def test_same_turn_revision_retains_the_whole_turn(self):
  self.turns()[0]['text']+=' Sorry, the authorization changed to RMA-9000.';r=self.result();self.assertEqual(r['checks'][0]['status'],'revision_review');self.assertIn('RMA-9000',r['checks'][0]['source_turn'])
 def test_shipping_revision_does_not_clear_earlier_wording(self):
  self.turns().append({'speaker':'user','text':'Actually the customer pays shipping.'});self.assertEqual(self.result()['checks'][2]['status'],'revision_review')
 def test_deadline_revision(self):
  self.turns().append({'speaker':'user','text':'Correction: the deadline is 2026-09-20.'});self.assertEqual(self.result()['checks'][3]['status'],'revision_review')
 def test_terms_revision(self):
  self.turns().append({'speaker':'user','text':'The refund terms changed to store credit.'});self.assertEqual(self.result()['checks'][4]['status'],'revision_review')
 def test_unscoped_revision_holds_all_earlier_extractions(self):
  self.turns().append({'speaker':'user','text':'Wait, scratch that.'});self.assertEqual(self.result()['supported_matches'],0)
 def test_caller_revision_is_not_recipient_evidence(self):
  self.turns().append({'speaker':'bot','text':'Correction: the address is 22 Different Road.'});self.assertEqual(self.result()['supported_matches'],5)
 def test_unrelated_revision_does_not_hold_destination(self):
  self.turns().append({'speaker':'user','text':'Actually the refund is store credit.'});self.assertEqual(self.result()['checks'][1]['status'],'wording_matches')
 def test_earlier_correction_before_current_value_not_reapplied(self):
  self.turns().insert(0,{'speaker':'user','text':'Correction: the destination changed.'})
  for row in self.rows():row['turn_index']+=1
  self.assertEqual(self.result()['supported_matches'],5)
 def test_single_spoken_value_does_not_claim_that_everything_is_complete(self):
  self.rows().pop();r=self.result();self.assertEqual(r['supported_matches'],4);self.assertFalse(r['clearance_to_ship'])
 def test_mcp_error_flag_cannot_be_a_completed_call(self):
  self.r['isError']=True;self.assertEqual(self.result()['supported_matches'],0)
 def test_false_ok_cannot_be_a_completed_call(self):
  self.r['ok']=False;self.assertEqual(self.result()['supported_matches'],0)
 def test_explicit_error_cannot_be_a_completed_call(self):
  self.r['error']={'message':'provider failure'};self.assertEqual(self.result()['supported_matches'],0)
 def test_clarification_contains_both_written_and_spoken_values(self):
  c=rr.demo_cases(NOW)['address_conflict'];r=rr.inspect(c['policy'],c['response'],NOW);q=r['open_questions'][0];self.assertIn('10 Example Lane',q);self.assertIn('22 Different Road',q)
 def test_session_roundtrip_recomputes_and_ignores_claimed_approval(self):
  saved=rr.save_session(self.p,self.r,True);saved['approved']=True;saved['report']={'clearance_to_ship':True};opened=rr.restore_session(saved,NOW);self.assertFalse(opened['report']['clearance_to_ship']);self.assertTrue(opened['synthetic'])
 def test_session_open_uses_current_freshness(self):
  saved=rr.save_session(self.p,self.r,True);r=rr.restore_session(saved,NOW+timedelta(hours=25));self.assertEqual(r['report']['supported_matches'],0)
 def test_corrupt_session_is_rejected(self):
  saved=rr.save_session(self.p,self.r,True);saved['inputs']['policy']['shipping']['value']='Changed';self.assertRaises(ValueError,rr.restore_session,saved,NOW)
 def test_saved_inputs_are_detached_from_live_objects(self):
  saved=rr.save_session(self.p,self.r,True);self.p['shipping']=None;self.assertIsNotNone(saved['inputs']['policy']['shipping'])
 def test_saved_synthetic_flag_must_be_explicit_boolean(self):self.assertRaises(ValueError,rr.save_session,self.p,self.r,'true')
 def test_saved_extra_input_field_is_rejected(self):
  saved=rr.save_session(self.p,self.r,True);saved['inputs']['approved']=True;saved['inputs_sha256']=rr.digest(saved['inputs']);self.assertRaises(ValueError,rr.restore_session,saved,NOW)
 def test_late_correction_demo_reproduces_old_risk(self):
  c=rr.demo_cases(NOW)['later_correction'];self.assertEqual(c['report']['supported_matches'],4);self.assertFalse(c['report']['clearance_to_ship'])
 def test_unknown_session_version_is_rejected(self):
  saved=rr.save_session(self.p,self.r,True);saved['version']=2;self.assertRaises(ValueError,rr.restore_session,saved,NOW)

class DurablePollingTests(unittest.TestCase):
 def test_first_terminal_result_survives_concurrent_late_poll(self):
  with tempfile.TemporaryDirectory()as d:
   started=threading.Event();finish=threading.Event();calls=[]
   def transport(method,path,body,key):
    calls.append(method)
    if method=='POST':return {'id':'call_test','status':'queued'}
    if threading.current_thread().name=='slow':started.set();self.assertTrue(finish.wait(5));return {'id':'call_test','status':'completed','task_completed':True,'sentinel':'late'}
    return {'id':'call_test','status':'failed','sentinel':'first'}
   ledger=rr.Ledger(Path(d)/'cases.sqlite3',rr.CalleHTTP('test',transport));preview=ledger.preview(request(),NOW);ledger.start(preview['id'],preview['request_sha256'],preview['confirmation'],NOW)
   failures=[]
   def slow():
    try:ledger.poll(preview['id'])
    except BaseException as e:failures.append(e)
   t=threading.Thread(target=slow,name='slow');t.start();self.assertTrue(started.wait(5));first=ledger.poll(preview['id']);finish.set();t.join(5);self.assertFalse(t.is_alive());self.assertFalse(failures)
   final=ledger.get(preview['id']);self.assertEqual(final['detail']['sentinel'],'first');self.assertEqual(final['detail']['observed_at'],first['detail']['observed_at']);self.assertEqual(final['state'],'provider_terminal')
   before=len(calls);ledger.poll(preview['id']);self.assertEqual(len(calls),before)
 def test_database_context_closes_the_connection(self):
  with tempfile.TemporaryDirectory()as d:
   ledger=rr.Ledger(Path(d)/'test.db')
   with ledger.db()as db:self.assertEqual(db.execute('select 1').fetchone()[0],1)
   self.assertRaises(sqlite3.ProgrammingError,db.execute,'select 1')

if __name__=='__main__':unittest.main(verbosity=2)
