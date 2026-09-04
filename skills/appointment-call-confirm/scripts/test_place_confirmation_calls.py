"""Credential-free regressions for the destination-region gate."""
import unittest

from place_confirmation_calls import Appointment, _validate_e164_for_region, place_call


class DestinationRegionTests(unittest.TestCase):
    def test_matching_and_shared_calling_codes(self):
        for phone, region in (
            ("+12025550147", "US"),
            ("+14165550100", "CA"),
            ("+447700900123", "GB"),
        ):
            with self.subTest(region=region):
                self.assertIsNone(_validate_e164_for_region(phone, region))

    def test_same_length_does_not_override_country_code(self):
        for phone, region in (("+12025550147", "FR"), ("+447700900123", "IN")):
            with self.subTest(region=region):
                self.assertIsNotNone(_validate_e164_for_region(phone, region))

    def test_requires_ascii_digits_and_complete_match(self):
        for phone in ("+12025550147\n", "+1202555014\u0667"):
            self.assertIsNotNone(_validate_e164_for_region(phone, "US"))

    def test_mismatched_region_stops_before_transport(self):
        appointment = Appointment(
            recipient_name="Example Customer", phone="+12025550147",
            appointment_time="2026-09-05T15:00:00-04:00",
            context="appointment", business_name="Example Business", region="FR",
        )
        # A bare object has no transport methods: any network attempt fails this test.
        result = place_call(object(), "https://api.heycall-e.com", "", appointment, None)
        self.assertIn("_local_error", result)


if __name__ == "__main__":
    unittest.main()
