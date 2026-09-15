"""Credential-free checks for the negotiated room-budget boundary."""

import unittest

from validate_offer import validate_offer


class RoomBudgetTests(unittest.TestCase):
    def test_offer_within_budget(self):
        self.assertTrue(validate_offer({"availability": "available", "negotiated_total": 80}, 100))

    def test_offer_at_budget(self):
        self.assertTrue(validate_offer({"availability": "available", "negotiated_total": 100}, 100))

    def test_offer_above_budget(self):
        self.assertFalse(validate_offer({"availability": "available", "negotiated_total": 101}, 100))

    def test_unnegotiated_total_above_budget(self):
        self.assertFalse(validate_offer({"availability": "available", "total_price": 101}, 100))


if __name__ == "__main__":
    unittest.main()
