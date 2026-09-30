"""Tamper tests for the audit chain.

If the README says the log is hash-chained and tamper-evident, a test has to
prove it. These mutate the file on disk and assert the chain reports where it
broke.
"""

import json
import tempfile
import threading
import unittest
from pathlib import Path

from certa.audit import GENESIS, AuditError, AuditLog
from certa.types import mask

FICTIONAL = "+15550100471"


class ChainBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.path = Path(self._tmp.name) / "audit.jsonl"
        self.log = AuditLog(self.path, fsync=False)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def seed(self, n: int = 3) -> None:
        for i in range(n):
            self.log.append(
                "call.authorized",
                request_id=f"VR-10{i}",
                masked_number=mask(FICTIONAL),
                number_source="official_site",
                consent_token="a" * 64,
            )

    def lines(self) -> list[dict]:
        return [json.loads(line) for line in self.path.read_text().splitlines() if line]

    def rewrite(self, records: list[dict]) -> None:
        self.path.write_text(
            "".join(
                json.dumps(r, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                + "\n"
                for r in records
            )
        )


class ChainIntegrity(ChainBase):
    def test_empty_log_is_intact(self):
        status = self.log.verify_chain()
        self.assertTrue(status.ok)
        self.assertEqual(status.records, 0)
        self.assertEqual(status.head, GENESIS)

    def test_appended_chain_verifies(self):
        self.seed(5)
        status = self.log.verify_chain()
        self.assertTrue(status.ok, str(status))
        self.assertEqual(status.records, 5)

    def test_first_record_chains_to_genesis(self):
        self.seed(1)
        self.assertEqual(self.lines()[0]["prev_hash"], GENESIS)

    def test_head_advances_and_is_anchorable(self):
        self.seed(2)
        first_head = self.log.head()
        self.seed(1)
        self.assertNotEqual(first_head, self.log.head())


class Tampering(ChainBase):
    def test_editing_a_record_breaks_the_chain(self):
        self.seed(4)
        records = self.lines()
        records[1]["request_id"] = "VR-FORGED"
        self.rewrite(records)

        status = self.log.verify_chain()
        self.assertFalse(status.ok)
        self.assertEqual(status.broken_at, 1)
        self.assertIn("edited", status.reason)

    def test_deleting_a_record_from_the_middle_breaks_the_chain(self):
        self.seed(4)
        records = self.lines()
        del records[2]
        self.rewrite(records)

        status = self.log.verify_chain()
        self.assertFalse(status.ok)
        self.assertIn("removed or reordered", status.reason)

    def test_reordering_records_breaks_the_chain(self):
        self.seed(4)
        records = self.lines()
        records[1], records[2] = records[2], records[1]
        self.rewrite(records)

        self.assertFalse(self.log.verify_chain().ok)

    def test_forging_a_hash_without_the_prev_link_breaks_the_chain(self):
        self.seed(3)
        records = self.lines()
        records[1]["detail"] = {"note": "quietly added"}
        # Recompute this record's own hash but leave the next record's
        # prev_hash pointing at the old value.
        from certa.audit import compute_hash

        records[1]["hash"] = compute_hash(records[1]["prev_hash"], records[1])
        self.rewrite(records)

        status = self.log.verify_chain()
        self.assertFalse(status.ok)
        self.assertEqual(status.broken_at, 2)
        self.assertIn("prev_hash", status.reason)

    def test_corrupt_json_is_reported_not_silently_skipped(self):
        self.seed(2)
        with self.path.open("a") as handle:
            handle.write("{not json\n")
        with self.assertRaises(AuditError):
            self.log.verify_chain()

    def test_tail_truncation_is_a_documented_limit(self):
        """Honest about what a bare chain cannot detect.

        Removing records from the end leaves a shorter but internally valid
        chain. The defence is anchoring head() externally, which is documented
        rather than claimed.
        """
        self.seed(5)
        anchored_head = self.log.head()
        records = self.lines()[:3]
        self.rewrite(records)

        status = self.log.verify_chain()
        self.assertTrue(status.ok, "a truncated chain is still internally valid")
        self.assertNotEqual(
            status.head, anchored_head, "an anchored head is what catches this"
        )


class Durability(ChainBase):
    def test_fsync_is_on_by_default(self):
        """A record must be durable before the call it authorises can ring."""
        self.assertTrue(AuditLog(self.path).fsync)


class Concurrency(ChainBase):
    """Dispatch is concurrent, so the chain must survive parallel appends.

    Without serialising the read of head/seq with the write that consumes
    them, two threads claim the same sequence number and the chain breaks.
    """

    def test_parallel_appends_keep_the_chain_intact(self):
        threads = [
            threading.Thread(
                target=self.log.append,
                args=("call.authorized",),
                kwargs={"request_id": f"VR-{i:04d}", "consent_token": "c" * 64},
            )
            for i in range(24)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        status = self.log.verify_chain()
        self.assertTrue(status.ok, str(status))
        self.assertEqual(status.records, 24)

    def test_sequence_numbers_are_unique_under_load(self):
        threads = [
            threading.Thread(target=self.log.append, args=("call.dispatched",))
            for _ in range(16)
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        seqs = [r["seq"] for r in self.log.records()]
        self.assertEqual(sorted(seqs), list(range(16)))

    def test_a_reopened_log_continues_the_existing_chain(self):
        self.seed(3)
        reopened = AuditLog(self.path, fsync=False)
        reopened.append("call.reconciled", request_id="VR-9999")
        self.assertTrue(reopened.verify_chain().ok)
        self.assertEqual(reopened.verify_chain().records, 4)


class PrivacyInTheLog(ChainBase):
    def test_unmasked_number_is_refused(self):
        with self.assertRaises(AuditError):
            self.log.append("call.authorized", masked_number=FICTIONAL)

    def test_consent_token_is_stored_as_a_prefix_only(self):
        token = "b" * 64
        record = self.log.append("call.authorized", consent_token=token)
        self.assertNotEqual(record["consent_token_prefix"], token)
        self.assertTrue(token.startswith(record["consent_token_prefix"]))
        self.assertLessEqual(len(record["consent_token_prefix"]), 16)

    def test_masked_number_survives_the_round_trip(self):
        self.log.append("call.authorized", masked_number=mask(FICTIONAL))
        stored = self.lines()[0]["masked_number"]
        self.assertTrue(stored.endswith("0471"))
        self.assertNotIn("5550100", stored)


if __name__ == "__main__":
    unittest.main()
