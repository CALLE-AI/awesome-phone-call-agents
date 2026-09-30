import unittest

from app import Verdict, confidence_for, map_verdict


class VerdictSemanticsTests(unittest.TestCase):
    def test_direct_authoritative_confirmation_verifies(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "confirmed",
                    "evidence_quality": "direct",
                    "authority_status": "authoritative",
                }
            ),
            Verdict.VERIFIED,
        )

    def test_direct_authoritative_contradiction_contradicts(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "contradicted",
                    "evidence_quality": "direct",
                    "authority_status": "authoritative",
                }
            ),
            Verdict.CONTRADICTED,
        )

    def test_non_authoritative_confirmation_stays_unresolved(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "confirmed",
                    "evidence_quality": "direct",
                    "authority_status": "non_authoritative",
                }
            ),
            Verdict.UNRESOLVED,
        )

    def test_unknown_authority_stays_unresolved(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "confirmed",
                    "evidence_quality": "direct",
                    "authority_status": "unknown",
                }
            ),
            Verdict.UNRESOLVED,
        )

    def test_unknown_claim_is_unresolved(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "unknown",
                    "evidence_quality": "insufficient",
                    "authority_status": "authoritative",
                }
            ),
            Verdict.UNRESOLVED,
        )

    def test_qualified_confirmation_does_not_verify(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "confirmed",
                    "evidence_quality": "qualified",
                    "authority_status": "authoritative",
                }
            ),
            Verdict.UNRESOLVED,
        )

    def test_qualified_authoritative_contradiction_can_contradict(self):
        self.assertEqual(
            map_verdict(
                {
                    "claim_status": "contradicted",
                    "evidence_quality": "qualified",
                    "authority_status": "authoritative",
                }
            ),
            Verdict.CONTRADICTED,
        )

    def test_unresolved_can_still_be_high_confidence(self):
        call = {"completion_confidence": {"score": 0.9, "label": "high"}}
        self.assertEqual(confidence_for(call), 0.9)


if __name__ == "__main__":
    unittest.main()
