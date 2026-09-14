import json, tempfile, unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import handoff_receipt as h

class T(unittest.TestCase):
    def req(self):
        return {"handoff_id":"T-001","subject":"case handoff","sender":{"name":"A","phone":"+12125550101","region":"US","locale":"en-US","authorized":False,"authorization_basis":""},"receiver":{"name":"B","phone":"+12125550102","region":"US","locale":"en-US","authorized":False,"authorization_basis":""},"max_calls":2}
    def test_validate(self): self.assertEqual(h.validate(self.req())["max_calls"],2)
    def test_same_phone_rejected(self):
        r=self.req(); r["receiver"]["phone"]=r["sender"]["phone"]
        with self.assertRaises(ValueError): h.validate(r)
    def test_sender_denial(self):
        s={"reached":"yes","handoff_claimed":"no","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"unknown","handoff_quote":"no","ownership_quote":""}
        self.assertEqual(h.reconcile(s,None)["verdict"],"SENDER_DENIES_HANDOFF")
    def test_ack(self):
        s={"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":"B owns"}
        r={"reached":"yes","case_recognized":"yes","case_reference":"ABC-1","ownership_status":"owns_next_action","recognition_quote":"we have it","ownership_quote":"we own"}
        self.assertEqual(h.reconcile(s,r)["verdict"],"ACKNOWLEDGED_MATCH")
    def test_reference_mismatch(self):
        s={"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":"B owns"}
        r={"reached":"yes","case_recognized":"yes","case_reference":"ABC-2","ownership_status":"owns_next_action","recognition_quote":"we have it","ownership_quote":"we own"}
        self.assertEqual(h.reconcile(s,r)["verdict"],"REFERENCE_MISMATCH")
if __name__=="__main__": unittest.main()
