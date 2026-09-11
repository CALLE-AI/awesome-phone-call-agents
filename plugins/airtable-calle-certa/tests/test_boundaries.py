"""Hazard tests for the two boundaries.

Every test here is a call that must not happen. None of them touch the network,
require credentials, or place a call.
"""

import unittest

from certa.consent import authorize, derive_token
from certa.types import (
    ApplicantSuppliedNumber,
    BoundaryError,
    ConsentedEmployerContact,
    ConsentReceipt,
    NumberSource,
    Relationship,
    SourcedNumber,
    VerificationRequest,
    mask,
    source_number,
)

SPEC = "voe-employer-v1"

# Reserved-for-fiction ranges only. +1 555 01xx is reserved for fictional use
# (NANP), and no test in this suite dials anything.
FICTIONAL_A = "+15550100471"
FICTIONAL_B = "+15550102038"


def a_receipt(receipt_id: str = "CR-1") -> ConsentReceipt:
    return ConsentReceipt(
        receipt_id=receipt_id,
        disclosure_version="voe-disclosure-2026-01",
        signed_at="2026-09-09T09:00:00Z",
    )


def a_request(
    request_id: str = "VR-1041",
    phone: str = FICTIONAL_A,
    *,
    consent: ConsentReceipt | None = None,
    sourced: bool = True,
    cancelled: bool = False,
) -> VerificationRequest:
    return VerificationRequest(
        request_id=request_id,
        applicant_ref="APP-8823",
        employer_name="Cascade Freight Systems",
        applicant_name="Dana Okafor",
        consent=a_receipt() if consent is None else consent,
        applicant_supplied=ApplicantSuppliedNumber(raw="+15550109999"),
        sourced=(
            source_number(phone, NumberSource.OFFICIAL_SITE) if sourced else None
        ),
        cancelled=cancelled,
    )


def token_for(request: VerificationRequest, spec: str = SPEC) -> str:
    assert request.sourced is not None
    assert request.consent is not None
    return derive_token(
        request_id=request.request_id,
        phone_e164=request.sourced.e164,
        relationship=Relationship.EMPLOYER,
        task_spec_version=spec,
        consent_receipt_id=request.consent.receipt_id,
    )


class ConstructionBoundary(unittest.TestCase):
    """The dial-ready types cannot be built by hand."""

    def test_consented_contact_cannot_be_constructed_directly(self):
        with self.assertRaises(BoundaryError):
            ConsentedEmployerContact(
                request_id="VR-1041",
                applicant_ref="APP-8823",
                employer_name="Cascade Freight Systems",
                applicant_name="Dana Okafor",
                number=source_number(FICTIONAL_A, NumberSource.OFFICIAL_SITE),
                relationship=Relationship.EMPLOYER,
                consent_receipt_id="CR-1",
                consent_token="whatever",
                task_spec_version=SPEC,
            )

    def test_sourced_number_cannot_be_constructed_directly(self):
        with self.assertRaises(BoundaryError):
            SourcedNumber(e164=FICTIONAL_A, source=NumberSource.OFFICIAL_SITE)


class ProvenanceBoundary(unittest.TestCase):
    """Boundary 2: the number on the application is never dialable."""

    def test_no_conversion_from_applicant_supplied_to_sourced(self):
        supplied = ApplicantSuppliedNumber(raw=FICTIONAL_A)
        # No method on the type produces a SourcedNumber, and no module-level
        # function accepts one. If either ever appears, this fails.
        for name in dir(supplied):
            attr = getattr(supplied, name, None)
            self.assertNotIsInstance(attr, SourcedNumber)
        import certa.types as t

        for name in dir(t):
            obj = getattr(t, name)
            if callable(obj) and getattr(obj, "__module__", "") == t.__name__:
                annotations = getattr(obj, "__annotations__", {})
                self.assertNotIn(
                    ApplicantSuppliedNumber,
                    annotations.values(),
                    f"{name} accepts an ApplicantSuppliedNumber; boundary 2 "
                    "requires that no code path converts one into a dialable "
                    "number",
                )

    def test_number_source_has_no_application_member(self):
        values = {s.value for s in NumberSource}
        for forbidden in ("application", "applicant", "form", "self_reported"):
            self.assertNotIn(forbidden, values)

    def test_request_without_sourced_number_is_refused(self):
        request = a_request(sourced=False)
        with self.assertRaises(BoundaryError) as ctx:
            authorize(
                request,
                relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC,
                presented_token="anything",
            )
        self.assertIn("never dialed", str(ctx.exception))


class ConsentBoundary(unittest.TestCase):
    """Boundary 1: only this row's own consent authorises this row's call."""

    def test_valid_token_authorises(self):
        request = a_request()
        contact = authorize(
            request,
            relationship=Relationship.EMPLOYER,
            task_spec_version=SPEC,
            presented_token=token_for(request),
        )
        self.assertIsInstance(contact, ConsentedEmployerContact)
        self.assertEqual(contact.number.e164, FICTIONAL_A)

    def test_fill_down_a_token_across_rows_is_refused(self):
        """The gesture this whole design exists to stop."""
        row_a = a_request("VR-1041", FICTIONAL_A)
        row_b = a_request("VR-1042", FICTIONAL_B)
        stolen = token_for(row_a)
        with self.assertRaises(BoundaryError) as ctx:
            authorize(
                row_b,
                relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC,
                presented_token=stolen,
            )
        self.assertIn("copied from another row", str(ctx.exception))

    def test_editing_the_questions_revokes_consent(self):
        request = a_request()
        old = token_for(request, spec="voe-employer-v1")
        with self.assertRaises(BoundaryError):
            authorize(
                request,
                relationship=Relationship.EMPLOYER,
                task_spec_version="voe-employer-v2",
                presented_token=old,
            )

    def test_a_different_receipt_does_not_verify(self):
        request = a_request()
        good = token_for(request)
        replaced = VerificationRequest(
            request_id=request.request_id,
            applicant_ref=request.applicant_ref,
            employer_name=request.employer_name,
            applicant_name=request.applicant_name,
            consent=a_receipt("CR-2"),
            applicant_supplied=request.applicant_supplied,
            sourced=request.sourced,
        )
        with self.assertRaises(BoundaryError):
            authorize(
                replaced,
                relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC,
                presented_token=good,
            )

    def test_missing_consent_receipt_is_refused(self):
        """A row that has a number but no consent names the consent gap."""
        request = VerificationRequest(
            request_id="VR-1043",
            applicant_ref="APP-8825",
            employer_name="Apex Holdings",
            consent=None,
            sourced=source_number(FICTIONAL_B, NumberSource.DIRECTORY),
        )
        with self.assertRaises(BoundaryError) as ctx:
            authorize(
                request,
                relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC,
                presented_token="anything",
            )
        self.assertIn("no consent recorded", str(ctx.exception))

    def test_cancelled_request_never_authorises(self):
        request = a_request(cancelled=True)
        with self.assertRaises(BoundaryError) as ctx:
            authorize(
                request,
                relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC,
                presented_token=token_for(request),
            )
        self.assertIn("cancelled", str(ctx.exception))

    def test_empty_token_is_refused(self):
        request = a_request()
        for empty in ("", None):
            with self.assertRaises(BoundaryError):
                authorize(
                    request,
                    relationship=Relationship.EMPLOYER,
                    task_spec_version=SPEC,
                    presented_token=empty,
                )


class MostActionableGapFirst(unittest.TestCase):
    """With several gaps, name the one to fix first."""

    def test_a_row_with_neither_names_the_missing_number(self):
        request = VerificationRequest(
            request_id="VR-1099", applicant_ref="APP-9", employer_name="Sterling Corp",
            applicant_name="Priya Menon", consent=None, sourced=None,
        )
        with self.assertRaises(BoundaryError) as ctx:
            authorize(
                request, relationship=Relationship.EMPLOYER,
                task_spec_version=SPEC, presented_token="",
            )
        message = str(ctx.exception)
        self.assertIn("no independently sourced employer number", message)
        self.assertNotIn("no consent recorded", message)


class NumberHandling(unittest.TestCase):
    """E.164 is required, never repaired, and never rendered in full."""

    def test_non_e164_is_rejected_not_repaired(self):
        for bad in ("5550100471", "+1 555 010 0471", "555-010-0471", "", "+0123456789"):
            with self.assertRaises(BoundaryError, msg=bad):
                source_number(bad, NumberSource.OFFICIAL_SITE)

    def test_mask_never_reveals_the_middle(self):
        masked = mask(FICTIONAL_A)
        self.assertTrue(masked.endswith("0471"))
        self.assertNotIn("5550100", masked)
        self.assertLess(sum(c.isdigit() for c in masked), len(FICTIONAL_A) - 4)

    def test_mask_handles_an_empty_label_without_leaking(self):
        """A blank label must not fall back to the raw number."""
        self.assertEqual(mask(""), "(no number)")

    def test_unknown_source_is_rejected(self):
        with self.assertRaises(BoundaryError):
            source_number(FICTIONAL_A, "application")  # type: ignore[arg-type]


class ClosedSets(unittest.TestCase):
    def test_relationship_is_employer_only(self):
        self.assertEqual([r.value for r in Relationship], ["employer"])

    def test_no_free_text_relationship(self):
        request = a_request()
        with self.assertRaises(BoundaryError):
            authorize(
                request,
                relationship="neighbour",  # type: ignore[arg-type]
                task_spec_version=SPEC,
                presented_token=token_for(request),
            )


if __name__ == "__main__":
    unittest.main()
