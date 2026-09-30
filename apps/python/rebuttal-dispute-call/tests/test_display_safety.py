"""Credential-free regressions for destination validation and display-only masking."""
import contextlib
import copy
import io
import unittest
from unittest.mock import patch

from rebuttal_dispute_call import call, cli, rules
from rebuttal_dispute_call.fake import FakeCalle

PHONE = "+12125550101"
ORDER = {"merchant": "Example Outfitters", "order_id": "1042", "items": "Trail shoes", "amount": "$89"}


class DisplaySafetyTests(unittest.TestCase):
    def test_invalid_destinations_never_reach_create(self):
        for phone in (PHONE + "\n", PHONE + "\r\n", "+1２１２５５５０１０１"):
            with self.subTest(phone=phone):
                self.assertEqual(rules.destination_e164(phone), rules.NOT_E164)
                fake = FakeCalle()
                with self.assertRaises(ValueError):
                    call.place(fake, dispute_id="demo", phone=phone, **ORDER)
                self.assertEqual(fake.requests, [])
        self.assertIsNone(rules.destination_e164(PHONE))

    def test_cli_masks_arbitrary_display_text(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            cli.say(f"Customer quote: call {PHONE} or (212) 555-0102")
        self.assertNotIn(PHONE, out.getvalue())
        self.assertNotIn("(212) 555-0102", out.getvalue())

    def test_pdf_masks_every_rendered_field_without_changing_evidence(self):
        from reportlab.pdfgen import canvas
        rec = call.CallRecord("call_demo", "completed", True, 0.9, {}, "", [],
                              [{"speaker": "user", "text": f"Call {PHONE}", "offset_seconds": 0}])
        g = call.Grounding({}, {"purchaser": PHONE},
                           [call.Check("quote", True, PHONE, PHONE)], True, False)
        before = copy.deepcopy((rec, g))
        rendered = []
        draw = canvas.Canvas.drawString

        def capture(pdf, x, y, text, *args, **kwargs):
            rendered.append(text)
            return draw(pdf, x, y, text, *args, **kwargs)

        with patch.object(canvas.Canvas, "drawString", capture):
            pdf = call.evidence_pdf(rec, g, merchant=PHONE, order_id=PHONE,
                                    dispute_id="demo", phone=PHONE)
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertNotIn(PHONE, "\n".join(rendered))
        self.assertIn(call.mask(PHONE), "\n".join(rendered))
        self.assertEqual((rec, g), before)


if __name__ == "__main__":
    unittest.main()
