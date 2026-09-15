"""Tests for recording consent.

The token is a hash, so this is the only path by which a hand-entered row can
become callable. Everything it refuses is a call that must not happen.
"""

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from certa.airtable import FieldMap, FixtureAirtable, to_row
from certa.audit import AuditLog
from certa.consent import authorize
from certa.grant import GrantError, grant_consent, revoke_consent
from certa.tasks import TASK_SPEC_VERSION
from certa.types import Relationship

from tests.test_airtable import FIELDS, SCHEMA, SOURCED, record

TABLE = "Verification Requests"
DISCLOSURE = "voe-disclosure-2026-01"
FIXED = datetime(2026, 9, 11, 9, 30, tzinfo=timezone.utc)


def ungranted(**overrides):
    blank = {
        FIELDS.consent_receipt_id: "",
        FIELDS.consent_disclosure_version: "",
        FIELDS.consent_signed_at: "",
        FIELDS.consent_token: "",
    }
    blank.update(overrides)
    return record(**blank)


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.audit = AuditLog(Path(self._tmp.name) / "audit.jsonl", fsync=False)
        self.client = FixtureAirtable(SCHEMA, [])

    def tearDown(self):
        self._tmp.cleanup()

    def grant(self, rec=None, **kw):
        return grant_consent(
            self.client, self.audit, table=TABLE,
            row=to_row(rec or ungranted(), FIELDS),
            disclosure_version=kw.pop("disclosure_version", DISCLOSURE),
            now=kw.pop("now", FIXED), **kw,
        )


class Recording(Base):
    def test_a_granted_row_becomes_callable(self):
        """The point of the whole module: a hand-entered row can now be called."""
        g = self.grant()
        written = self.client.writes[0]["fields"]
        row = to_row(ungranted(**{
            FIELDS.consent_receipt_id: written[FIELDS.consent_receipt_id],
            FIELDS.consent_disclosure_version: written[FIELDS.consent_disclosure_version],
            FIELDS.consent_signed_at: written[FIELDS.consent_signed_at],
            FIELDS.consent_token: written[FIELDS.consent_token],
        }), FIELDS)
        contact = authorize(
            row.request, relationship=Relationship.EMPLOYER,
            task_spec_version=TASK_SPEC_VERSION, presented_token=row.presented_token,
        )
        self.assertEqual(contact.number.e164, SOURCED)
        self.assertEqual(contact.consent_receipt_id, g.receipt_id)

    def test_receipt_id_is_reproducible_not_random(self):
        a = self.grant().receipt_id
        self.client.writes.clear()
        self.assertEqual(self.grant().receipt_id, a)

    def test_grant_is_recorded_in_the_audit_chain(self):
        self.grant()
        events = [r["event"] for r in self.audit.records()]
        self.assertIn("consent.recorded", events)
        self.assertTrue(self.audit.verify_chain().ok)

    def test_audit_records_the_disclosure_version_agreed_to(self):
        self.grant(disclosure_version="voe-disclosure-2027-04")
        rec = next(r for r in self.audit.records() if r["event"] == "consent.recorded")
        self.assertEqual(rec["detail"]["disclosure_version"], "voe-disclosure-2027-04")

    def test_audit_never_stores_the_raw_number(self):
        self.grant()
        self.assertNotIn(SOURCED, "".join(str(r) for r in self.audit.records()))


class Refusals(Base):
    """Nothing here can invent a consent out of an incomplete row."""

    def test_no_sourced_number_cannot_be_consented_to(self):
        with self.assertRaises(GrantError) as ctx:
            self.grant(ungranted(**{FIELDS.sourced_number: ""}))
        self.assertIn("consent is to a specific number", str(ctx.exception).lower())

    def test_no_applicant_name_is_refused(self):
        with self.assertRaises(GrantError) as ctx:
            self.grant(ungranted(**{FIELDS.applicant_name: ""}))
        self.assertIn("nothing to consent to", str(ctx.exception))

    def test_no_employer_is_refused(self):
        with self.assertRaises(GrantError):
            self.grant(ungranted(**{FIELDS.employer_name: ""}))

    def test_a_cancelled_request_is_refused(self):
        with self.assertRaises(GrantError):
            self.grant(ungranted(**{FIELDS.cancelled: True}))

    def test_a_missing_disclosure_version_is_refused(self):
        with self.assertRaises(GrantError) as ctx:
            self.grant(disclosure_version="  ")
        self.assertIn("which wording the applicant actually agreed to", str(ctx.exception))

    def test_a_refused_grant_writes_nothing(self):
        with self.assertRaises(GrantError):
            self.grant(ungranted(**{FIELDS.sourced_number: ""}))
        self.assertEqual(self.client.writes, [])
        self.assertEqual(self.audit.count(), 0)


class Revoking(Base):
    def test_revoke_clears_the_token(self):
        revoke_consent(self.client, self.audit, table=TABLE,
                       row=to_row(record(), FIELDS))
        written = self.client.writes[0]["fields"]
        self.assertEqual(written[FIELDS.consent_token], "")
        self.assertEqual(written[FIELDS.consent_receipt_id], "")

    def test_revoke_is_audited(self):
        revoke_consent(self.client, self.audit, table=TABLE,
                       row=to_row(record(), FIELDS))
        self.assertIn("consent.revoked", [r["event"] for r in self.audit.records()])


if __name__ == "__main__":
    unittest.main()
