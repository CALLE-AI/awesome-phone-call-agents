import io, json, tempfile, unittest
from pathlib import Path
import sys
from urllib import error as urlerror
from urllib import request as urlrequest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import handoff_receipt as h

class T(unittest.TestCase):
    def req(self):
        return {"handoff_id":"T-001","subject":"case handoff","sender":{"name":"A","phone":"+12125550101","region":"US","locale":"en-US","authorized":False,"authorization_basis":""},"receiver":{"name":"B","phone":"+12125550102","region":"US","locale":"en-US","authorized":False,"authorization_basis":""},"max_calls":2}
    def sender(self,**kw):
        s={"reached":"yes","handoff_claimed":"yes","receiver_name":"B","case_reference":"ABC-1","next_owner_claim":"receiver","handoff_quote":"sent","ownership_quote":"B owns"}; s.update(kw); return s
    def receiver(self,**kw):
        r={"reached":"yes","case_recognized":"yes","case_reference":"ABC-1","ownership_status":"owns_next_action","recognition_quote":"we have it","ownership_quote":"we own"}; r.update(kw); return r

    def test_validate(self): self.assertEqual(h.validate(self.req())["max_calls"],2)
    def test_same_phone_rejected(self):
        r=self.req(); r["receiver"]["phone"]=r["sender"]["phone"]
        with self.assertRaises(ValueError): h.validate(r)
    def test_unicode_digit_e164_rejected(self):
        r=self.req(); r["sender"]["phone"]="+1٢125550101"
        with self.assertRaises(ValueError): h.validate(r)
    def test_sender_denial(self):
        self.assertEqual(h.reconcile(self.sender(handoff_claimed="no"),None)["verdict"],"SENDER_DENIES_HANDOFF")
    def test_ack(self):
        result=h.reconcile(self.sender(),self.receiver())
        self.assertEqual(result["verdict"],"ACKNOWLEDGED_MATCH"); self.assertIs(result["advisory"],True)
    def test_reference_mismatch(self):
        self.assertEqual(h.reconcile(self.sender(),self.receiver(case_reference="ABC-2"))["verdict"],"REFERENCE_MISMATCH")

    def test_receiver_gate_requires_sender_reached(self):
        self.assertFalse(h.sender_ready_for_receiver(self.sender(reached="no")))
    def test_receiver_gate_requires_positive_handoff(self):
        self.assertFalse(h.sender_ready_for_receiver(self.sender(handoff_claimed="unknown")))
    def test_receiver_gate_requires_safe_reference(self):
        self.assertFalse(h.sender_ready_for_receiver(self.sender(case_reference="??")))
    def test_receiver_gate_accepts_complete_positive_sender(self):
        self.assertTrue(h.sender_ready_for_receiver(self.sender()))

    def test_credential_bearing_redirect_rejected(self):
        req=urlrequest.Request("https://api.example.test/v1/calls",headers={"Authorization":"Bearer SECRET","Idempotency-Key":"abc"})
        with self.assertRaises(urlerror.HTTPError):
            h.RejectCredentialRedirect().redirect_request(req,None,302,"Found",{},"https://other.example.test/redirect")

    def test_display_redacts_phone_bearing_fields(self):
        r=self.req(); r["subject"]="call +12125550199 about case"; r["sender"]["name"]="Desk 212-555-0198"
        v=h.view(r)
        self.assertNotIn("+12125550199",v["subject"]); self.assertNotIn("212-555-0198",v["sender"]["name"])
        self.assertIn("[REDACTED_PHONE]",v["subject"]); self.assertIn("[REDACTED_PHONE]",v["sender"]["name"])

    def test_preview_redacts_phone_from_task_copy(self):
        r=self.req(); r["subject"]="call +12125550199 about case"
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/"request.json"; p.write_text(json.dumps(r),encoding="utf-8")
            out=io.StringIO()
            with mock.patch("sys.stdout",out): h.main(["--request",str(p)])
            rendered=out.getvalue()
        self.assertNotIn("+12125550199",rendered)
        self.assertIn("[REDACTED_PHONE]",rendered)
        self.assertIn("PREVIEW_NO_CALL",rendered)

    def sender_payload(self, **kw):
        sr=self.sender(**kw)
        return {"status":"completed","task_completed":True,"recipients":[{"structured_result":sr,"transcript":[{"role":"recipient","content":sr["handoff_quote"] + (" " + sr["ownership_quote"] if sr["ownership_quote"] else "")}]}]}

    def test_main_does_not_call_receiver_when_sender_not_reached(self):
        r=self.req()
        for role in ("sender","receiver"):
            r[role]["authorized"]=True; r[role]["authorization_basis"]="test authorization"
        with tempfile.TemporaryDirectory() as td:
            rp=Path(td)/"request.json"; rp.write_text(json.dumps(r),encoding="utf-8")
            sender_payload=self.sender_payload(reached="no",handoff_claimed="yes")
            with mock.patch.object(h,"call",return_value=sender_payload) as call_mock, mock.patch("sys.stdout",io.StringIO()):
                h.main(["--request",str(rp),"--live","--confirm","I_AUTHORIZE_UP_TO_TWO_CALLS","--state",str(Path(td)/"state.json")])
            self.assertEqual(call_mock.call_count,1)
            self.assertEqual(call_mock.call_args.args[1],"sender")

    def test_main_does_not_call_receiver_when_sender_reference_invalid(self):
        r=self.req()
        for role in ("sender","receiver"):
            r[role]["authorized"]=True; r[role]["authorization_basis"]="test authorization"
        with tempfile.TemporaryDirectory() as td:
            rp=Path(td)/"request.json"; rp.write_text(json.dumps(r),encoding="utf-8")
            sender_payload=self.sender_payload(case_reference="??")
            with mock.patch.object(h,"call",return_value=sender_payload) as call_mock, mock.patch("sys.stdout",io.StringIO()):
                h.main(["--request",str(rp),"--live","--confirm","I_AUTHORIZE_UP_TO_TWO_CALLS","--state",str(Path(td)/"state.json")])
            self.assertEqual(call_mock.call_count,1)

    def test_main_calls_receiver_only_after_complete_positive_sender_gate(self):
        r=self.req()
        for role in ("sender","receiver"):
            r[role]["authorized"]=True; r[role]["authorization_basis"]="test authorization"
        receiver=self.receiver()
        receiver_payload={"status":"completed","task_completed":True,"recipients":[{"structured_result":receiver,"transcript":[{"role":"recipient","content":"we have it we own"}]}]}
        with tempfile.TemporaryDirectory() as td:
            rp=Path(td)/"request.json"; rp.write_text(json.dumps(r),encoding="utf-8")
            with mock.patch.object(h,"call",side_effect=[self.sender_payload(),receiver_payload]) as call_mock, mock.patch("sys.stdout",io.StringIO()):
                h.main(["--request",str(rp),"--live","--confirm","I_AUTHORIZE_UP_TO_TWO_CALLS","--state",str(Path(td)/"state.json")])
            self.assertEqual(call_mock.call_count,2)
            self.assertEqual(call_mock.call_args_list[1].args[1],"receiver")

    def test_error_display_redacts_phone_like_text(self):
        self.assertEqual(h.redact_display("provider failed for +12125550199"),"provider failed for [REDACTED_PHONE]")

if __name__=="__main__": unittest.main()
