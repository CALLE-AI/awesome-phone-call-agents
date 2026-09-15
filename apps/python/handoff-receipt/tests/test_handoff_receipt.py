import json, tempfile, unittest
from pathlib import Path
from unittest import mock
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
    def test_unicode_digit_rejected(self):
        r=self.req(); r["sender"]["phone"]="+١2125550101"
        with self.assertRaises(ValueError): h.validate(r)
    def test_sender_denial(self):
        s={"reached":"yes","handoff_claimed":"no","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"unknown","handoff_quote":"no","ownership_quote":""}
        self.assertEqual(h.reconcile(s,None)["verdict"],"SENDER_DENIES_HANDOFF")
    def test_ack(self):
        s={"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":"B owns"}
        r={"reached":"yes","case_recognized":"yes","case_reference":"ABC-1","ownership_status":"owns_next_action","recognition_quote":"we have it","ownership_quote":"we own"}
        self.assertEqual(h.reconcile(s,r)["verdict"],"ACKNOWLEDGED_MATCH")
        self.assertIs(h.reconcile(s,r)["advisory"],True)
    def test_reference_mismatch(self):
        s={"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":"B owns"}
        r={"reached":"yes","case_recognized":"yes","case_reference":"ABC-2","ownership_status":"owns_next_action","recognition_quote":"we have it","ownership_quote":"we own"}
        self.assertEqual(h.reconcile(s,r)["verdict"],"REFERENCE_MISMATCH")
    def test_positive_sender_gate(self):
        good={"reached":"yes","handoff_claimed":"yes","case_reference":"ABC-1"}
        self.assertTrue(h.sender_allows_receiver(good))
        for s in (None,{"reached":"no","handoff_claimed":"yes","case_reference":"ABC-1"},{"reached":"yes","handoff_claimed":"unknown","case_reference":"ABC-1"},{"reached":"yes","handoff_claimed":"yes","case_reference":"?"}): self.assertFalse(h.sender_allows_receiver(s))
    def test_main_never_calls_receiver_after_sender_not_reached(self):
        r=self.req(); r["sender"].update(authorized=True,authorization_basis="owned sender"); r["receiver"].update(authorized=True,authorization_basis="owned receiver")
        sender_payload={"status":"completed","task_completed":True,"recipients":[{"structured_result":{"reached":"no","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":""},"transcript":[{"role":"recipient","content":"sent"}]}]}
        with tempfile.TemporaryDirectory() as td:
            rp=Path(td)/"r.json"; rp.write_text(json.dumps(r),encoding="utf-8")
            with mock.patch.object(h,"call",return_value=sender_payload) as c: h.main(["--request",str(rp),"--live","--confirm","I_AUTHORIZE_UP_TO_TWO_CALLS"])
            self.assertEqual(c.call_count,1); self.assertEqual(c.call_args.args[1],"sender")
    def test_main_never_calls_receiver_after_bad_reference(self):
        r=self.req(); r["sender"].update(authorized=True,authorization_basis="owned sender"); r["receiver"].update(authorized=True,authorization_basis="owned receiver")
        sender_payload={"status":"completed","task_completed":True,"recipients":[{"structured_result":{"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"?","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":""},"transcript":[{"role":"recipient","content":"sent"}]}]}
        with tempfile.TemporaryDirectory() as td:
            rp=Path(td)/"r.json"; rp.write_text(json.dumps(r),encoding="utf-8")
            with mock.patch.object(h,"call",return_value=sender_payload) as c: h.main(["--request",str(rp),"--live","--confirm","I_AUTHORIZE_UP_TO_TWO_CALLS"])
            self.assertEqual(c.call_count,1)
    def test_redirect_rejected(self):
        handler=h.RejectRedirects()
        with self.assertRaises(RuntimeError): handler.redirect_request(mock.Mock(),None,302,"Found",{},"https://evil.example/")
    def test_direct_urlopen_not_used(self):
        self.assertIsNot(h.open_api,h.urlrequest.urlopen)
    def test_redact_phone_in_subject(self): self.assertNotIn("+12125550123",h.redact("case +12125550123 urgent"))
    def test_view_redacts_name_and_subject(self):
        r=self.req(); r["subject"]="call +12125550123"; r["sender"]["name"]="Desk +12125550124"
        v=h.view(r); self.assertNotIn("12125550123",v["subject"]); self.assertNotIn("12125550124",v["sender"]["name"])
    def test_preview_task_redacted(self):
        r=self.req(); r["subject"]="case +12125550123"
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"r.json"; p.write_text(json.dumps(r),encoding="utf-8")
            with mock.patch("builtins.print") as pr: h.main(["--request",str(p)])
            self.assertNotIn("12125550123",pr.call_args.args[0])
    def test_error_redaction(self): self.assertNotIn("12125550123",h.redact("failed +12125550123"))
    def test_outcome_is_advisory(self): self.assertIs(h.outcome("UNKNOWN","x")["advisory"],True)
    def test_poll_timeout_documents_no_cancel_proof(self):
        self.assertIn("does not prove remote cancellation",Path(h.__file__).read_text(encoding="utf-8"))
if __name__=="__main__": unittest.main()
