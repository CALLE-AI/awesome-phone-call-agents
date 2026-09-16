"""The number decides the route; coverage decides whether to dial at all."""

from __future__ import annotations

import unittest

from certa.dialplan import COVERAGE, UnsupportedRegion, resolve
from certa.types import E164

# Never a real subscriber: see test_india_resolves_to_in.
FICTIONAL_IN = "+911000000000"


class TestResolve(unittest.TestCase):
    def test_india_resolves_to_in(self) -> None:
        """The case that failed live: a +91 number dialed with no region.

        The national number here is in India's 1xx series, reserved for short
        codes and emergency services, so it can never be a subscriber line.
        Only the country code matters to what is under test.
        """
        destination = resolve(FICTIONAL_IN)
        self.assertEqual(destination.region, "IN")
        self.assertEqual(destination.locale, "en")

    def test_longest_prefix_wins_over_shorter_code(self) -> None:
        """+216 is Tunisia; +1 216 is Cleveland. Reading from the front separates them."""
        self.assertEqual(resolve("+21671234567").region, "TN")
        self.assertEqual(resolve("+12165551234").region, "US")

    def test_eight_eight_zero_is_bangladesh_not_japan(self) -> None:
        self.assertEqual(resolve("+8801712345678").region, "BD")
        self.assertEqual(resolve("+818012345678").region, "JP")
        self.assertEqual(resolve("+886912345678").region, "TW")

    def test_canadian_area_code_resolves_to_ca(self) -> None:
        self.assertEqual(resolve("+14165551234").region, "CA")
        self.assertEqual(resolve("+12125551234").region, "US")

    def test_locale_is_the_first_listed_language(self) -> None:
        self.assertEqual(resolve("+5511987654321").locale, "pt")
        self.assertEqual(resolve("+33612345678").locale, "fr")


class TestRefusals(unittest.TestCase):
    def test_uncovered_country_is_refused_by_name(self) -> None:
        """A row should say 'we do not reach China', not 'verification failed'."""
        with self.assertRaises(UnsupportedRegion) as caught:
            resolve("+8613800138000")
        message = str(caught.exception)
        self.assertIn("coverage", message)
        # It must not claim the number is unreadable -- a code is right there.
        self.assertNotIn("could be read", message)

    def test_nanp_territory_is_named_not_dialed_as_us(self) -> None:
        """+1 876 is Jamaica. Dialing it as US is how you get a mystery 404."""
        with self.assertRaises(UnsupportedRegion) as caught:
            resolve("+18765551234")
        self.assertIn("Jamaica", str(caught.exception))

    def test_every_nanp_territory_is_refused(self) -> None:
        from certa.dialplan import _NANP_ELSEWHERE

        for area in _NANP_ELSEWHERE:
            with self.assertRaises(UnsupportedRegion, msg=f"+1 {area} was dialed"):
                resolve(f"+1{area}5551234")

    def test_non_e164_input_is_refused(self) -> None:
        for bad in ("911000000000", "+0123456789", "", "not a number"):
            with self.assertRaises(UnsupportedRegion):
                resolve(bad)


class TestCoverageTable(unittest.TestCase):
    def test_codes_are_digits_and_regions_are_iso_shaped(self) -> None:
        for code, destination in COVERAGE.items():
            self.assertTrue(code.isdigit(), code)
            self.assertTrue(1 <= len(code) <= 3, code)
            self.assertRegex(destination.region, r"^[A-Z]{2}$")
            self.assertTrue(destination.languages, destination.region)

    def test_no_code_is_a_prefix_of_another(self) -> None:
        """A prefix collision would make longest-prefix matching ambiguous."""
        for code in COVERAGE:
            for other in COVERAGE:
                if code != other:
                    self.assertFalse(
                        other.startswith(code),
                        f"{other} starts with {code}; the table is ambiguous",
                    )

    def test_every_covered_country_resolves_to_itself(self) -> None:
        for code, destination in COVERAGE.items():
            number = f"+{code}{'5' * (11 - len(code))}"
            self.assertTrue(E164.match(number), number)
            self.assertEqual(resolve(number).region, destination.region)


if __name__ == "__main__":
    unittest.main()
