from __future__ import annotations

import unittest

from pawpassage.models import ContractError, mask_phone, parse_case
from tests.helpers import raw_case


class CaseContractTests(unittest.TestCase):
    def test_example_is_valid_and_complete(self) -> None:
        case = parse_case(raw_case())
        self.assertEqual(case.case_id, "PAW-DEMO-001")
        self.assertEqual(len(case.checkpoints), 3)
        self.assertEqual(case.checkpoint("AIRLINE_DESK").region, "US")

    def test_contract_is_closed_at_every_level(self) -> None:
        value = raw_case()
        value["owner_name"] = "should never be accepted"
        with self.assertRaisesRegex(ContractError, "extra=.*owner_name"):
            parse_case(value)

        value = raw_case()
        value["checkpoints"][0]["account_number"] = "123"
        with self.assertRaisesRegex(ContractError, "account_number"):
            parse_case(value)

        value = raw_case()
        value["checkpoints"][0]["propositions"][0]["notes"] = "free text"
        with self.assertRaisesRegex(ContractError, "notes"):
            parse_case(value)

    def test_phone_must_be_exact_e164(self) -> None:
        for invalid in ["15550101001", "+1 555 010 1001", "+0123456789", "+123"]:
            value = raw_case()
            value["checkpoints"][0]["phone_e164"] = invalid
            with (
                self.subTest(invalid=invalid),
                self.assertRaisesRegex(ContractError, "E.164"),
            ):
                parse_case(value)

    def test_unsupported_hong_kong_destination_is_blocked_not_relabelled(self) -> None:
        value = raw_case()
        value["checkpoints"][0]["region"] = "HK"
        with self.assertRaisesRegex(ContractError, "region"):
            parse_case(value)

        value = raw_case()
        value["checkpoints"][0]["phone_e164"] = "+85200000000"
        value["checkpoints"][0]["region"] = "MY"
        with self.assertRaisesRegex(ContractError, "calling code must match"):
            parse_case(value)

        value = raw_case()
        value["checkpoints"][0]["phone_e164"] = "+60000000000"
        value["checkpoints"][0]["region"] = "MY"
        self.assertEqual(parse_case(value).checkpoints[0].region, "MY")

    def test_source_must_be_https_without_credentials(self) -> None:
        for invalid in [
            "http://example.invalid/rules",
            "https://user:pass@example.invalid/rules",
        ]:
            value = raw_case()
            value["checkpoints"][0]["official_source_url"] = invalid
            with (
                self.subTest(invalid=invalid),
                self.assertRaisesRegex(ContractError, "HTTPS"),
            ):
                parse_case(value)

    def test_exactly_three_ordered_propositions_are_required(self) -> None:
        value = raw_case()
        value["checkpoints"][0]["propositions"].pop()
        with self.assertRaisesRegex(ContractError, "exactly 3"):
            parse_case(value)

        value = raw_case()
        value["checkpoints"][0]["propositions"][0]["id"] = "P2"
        with self.assertRaisesRegex(ContractError, "P1, P2, P3"):
            parse_case(value)

    def test_mask_phone_reveals_only_country_prefix_and_last_four(self) -> None:
        self.assertEqual(mask_phone("+15550101001"), "+1******1001")
        self.assertNotIn("555010", mask_phone("+15550101001"))


if __name__ == "__main__":
    unittest.main()
