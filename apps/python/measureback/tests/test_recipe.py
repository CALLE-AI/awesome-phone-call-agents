"""Adversarial coverage for evidence integrity and deterministic recipe arithmetic."""

from copy import deepcopy
from decimal import Decimal
from fractions import Fraction
import unittest

from measureback.recipe import RecipeValidationError, scale_recipe, validate_recipe


def example():
    return {
        "title": "Family dal",
        "servings": 2,
        "servings_evidence": {"turn_id": "t1", "quote": "For two people"},
        "transcript": [
            {"turn_id": "t0", "speaker": "agent", "text": "How do you make dal?"},
            {"turn_id": "t1", "speaker": "cook", "text": "For two people use one bowl of lentils. My bowl holds 180 grams of lentils. Add 400 ml water, one tomato and salt to taste. Simmer for 20 minutes."},
            {"turn_id": "t2", "speaker": "cook", "text": "Actually use 500 ml water, not 400 ml. Rest for 5 minutes after simmering."},
        ],
        "ingredients": [
            {"id": "lentils", "name": "Lentils", "quantity": "1", "unit": "bowl", "evidence": {"turn_id": "t1", "quote": "one bowl of lentils"}, "calibration": {"quantity": "180", "unit": "g", "evidence": {"turn_id": "t1", "quote": "My bowl holds 180 grams of lentils."}}},
            {"id": "water", "name": "Water", "quantity": "500", "unit": "ml", "evidence": {"turn_id": "t2", "quote": "Actually use 500 ml water, not 400 ml."}},
            {"id": "tomato", "name": "Tomato", "quantity": "1", "unit": "piece", "evidence": {"turn_id": "t1", "quote": "one tomato"}},
            {"id": "salt", "name": "Salt", "quantity": None, "unit": "to_taste", "evidence": {"turn_id": "t1", "quote": "salt to taste"}},
        ],
        "steps": [
            {"id": "simmer", "text": "Simmer the lentils", "duration_minutes": "20", "depends_on": [], "evidence": {"turn_id": "t1", "quote": "Simmer for 20 minutes."}},
            {"id": "rest", "text": "Rest after simmering", "duration_minutes": "5", "depends_on": ["simmer"], "evidence": {"turn_id": "t2", "quote": "Rest for 5 minutes after simmering."}},
        ],
        "corrections": [{"ingredient_id": "water", "field": "quantity", "previous": "400", "updated": "500", "evidence": {"turn_id": "t2", "quote": "Actually use 500 ml water, not 400 ml."}}],
    }


class RecipeTests(unittest.TestCase):
    def assert_invalid(self, recipe):
        with self.assertRaises(RecipeValidationError):
            validate_recipe(recipe)

    def test_valid_recipe_is_independent_copy(self):
        source = example()
        validated = validate_recipe(source)
        self.assertEqual(validated, source)
        validated["ingredients"][0]["name"] = "Changed"
        self.assertEqual(source["ingredients"][0]["name"], "Lentils")

    def test_double_batch_uses_measured_bowl(self):
        result = scale_recipe(example(), 4)
        self.assertEqual(result["ingredients"][0]["scaled"]["quantity"], "360")
        self.assertEqual(result["ingredients"][0]["scaled"]["unit"], "g")
        self.assertEqual(result["ingredients"][1]["scaled"]["quantity"], "1000")

    def test_times_and_dependency_order_never_scale(self):
        source = example()
        result = scale_recipe(source, 1000)
        self.assertEqual(result["steps"], source["steps"])
        self.assertIn("unchanged", result["timing_note"])

    def test_unknown_bowl_remains_unresolved(self):
        source = example()
        del source["ingredients"][0]["calibration"]
        result = scale_recipe(source, 4)
        self.assertIsNone(result["ingredients"][0]["scaled"])
        self.assertEqual(result["ingredients"][0]["status"], "unresolved")
        self.assertEqual(result["unresolved_questions"][0]["kind"], "calibration")

    def test_cup_has_no_assumed_standard_volume(self):
        source = example()
        source["ingredients"][0]["unit"] = "cup"
        del source["ingredients"][0]["calibration"]
        result = scale_recipe(source, 4)
        self.assertEqual(result["ingredients"][0]["status"], "unresolved")

    def test_calibrated_cup_can_scale(self):
        source = example()
        source["ingredients"][0]["unit"] = "cup"
        source["ingredients"][0]["calibration"]["unit"] = "ml"
        result = scale_recipe(source, 3)
        self.assertEqual(result["ingredients"][0]["scaled"]["quantity"], "270")
        self.assertEqual(result["ingredients"][0]["scaled"]["unit"], "ml")

    def test_volume_is_not_converted_to_mass(self):
        result = scale_recipe(example(), 4)
        self.assertEqual(result["ingredients"][1]["scaled"]["unit"], "ml")

    def test_to_taste_remains_without_numeric_quantity(self):
        item = scale_recipe(example(), 8)["ingredients"][3]
        self.assertEqual(item["status"], "to_taste")
        self.assertIsNone(item["scaled"])

    def test_fractional_piece_is_flagged_not_rounded(self):
        result = scale_recipe(example(), 3)
        item = result["ingredients"][2]
        self.assertEqual(item["scaled"]["quantity"], "1.5")
        self.assertEqual(item["status"], "needs_review")
        self.assertTrue(result["review_required"])

    def test_whole_piece_is_not_flagged(self):
        item = scale_recipe(example(), 4)["ingredients"][2]
        self.assertEqual(item["status"], "scaled")

    def test_unknown_quantity_is_not_treated_as_zero(self):
        source = example()
        source["ingredients"][2]["quantity"] = None
        result = scale_recipe(source, 4)
        self.assertIsNone(result["ingredients"][2]["scaled"])
        self.assertEqual(result["unresolved_questions"][0]["kind"], "quantity")

    def test_decimal_arithmetic_is_exact(self):
        source = example()
        source["ingredients"][2].update(quantity="0.1", unit="g")
        item = scale_recipe(source, 6)["ingredients"][2]
        self.assertEqual(item["scaled"]["quantity"], "0.3")
        self.assertFalse(item["scaled"]["approximate"])

    def test_repeating_decimal_retains_exact_fraction(self):
        source = example()
        source["servings"] = 3
        source["ingredients"][2].update(quantity="1", unit="g")
        result = scale_recipe(source, 1)["ingredients"][2]["scaled"]
        self.assertEqual(result["quantity"], "0.333333")
        self.assertEqual(result["exact_fraction"], "1/3")
        self.assertTrue(result["approximate"])

    def test_tiny_positive_quantity_is_not_displayed_as_zero(self):
        source = example()
        source["servings"] = 1000
        source["ingredients"][2].update(quantity="0.000001", unit="g")
        result = scale_recipe(source, 1)["ingredients"][2]["scaled"]
        self.assertGreater(Decimal(result["quantity"]), 0)

    def test_scaling_is_reproducible_and_does_not_mutate(self):
        source = example()
        before = deepcopy(source)
        self.assertEqual(scale_recipe(source, 7), scale_recipe(source, 7))
        self.assertEqual(source, before)

    def test_scaling_uses_source_not_previously_rounded_result(self):
        source = example()
        source["servings"] = 3
        item = scale_recipe(source, 7)["ingredients"][0]["scaled"]
        self.assertEqual(Fraction(item["exact_fraction"]), Fraction(420))

    def test_servings_reject_boolean_float_null_and_out_of_bounds(self):
        for value in (True, False, 2.0, None, "2", 0, -1, 1001):
            with self.subTest(value=value):
                source = example()
                source["servings"] = value
                self.assert_invalid(source)

    def test_target_servings_are_strict(self):
        for value in (True, False, 2.0, None, "2", 0, -1, 1001):
            with self.subTest(value=value), self.assertRaises(RecipeValidationError):
                scale_recipe(example(), value)

    def test_quantity_rejects_unsafe_number_spellings(self):
        for value in (True, 1, 1.0, "NaN", "Infinity", "-1", "1e3", " 1", "1 ", "1/2", ".5", "01", "1.0000001", "1000001", "0", "9" * 10000):
            with self.subTest(value=str(value)[:30]):
                source = example()
                source["ingredients"][2]["quantity"] = value
                self.assert_invalid(source)

    def test_valid_quantity_bounds(self):
        for value in ("0.000001", "1000000", "0.5", "2.250000"):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][2]["quantity"] = value
                validate_recipe(source)

    def test_invalid_units_are_rejected(self):
        for value in (None, True, [], "handful", "oz", "CUP"):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][2]["unit"] = value
                self.assert_invalid(source)

    def test_to_taste_cannot_have_a_numeric_amount(self):
        source = example()
        source["ingredients"][3]["quantity"] = "1"
        self.assert_invalid(source)

    def test_calibration_only_allowed_for_household_units(self):
        source = example()
        source["ingredients"][0]["unit"] = "g"
        self.assert_invalid(source)

    def test_calibration_must_be_measured_mass_or_volume(self):
        for value in ("bowl", "cup", "piece", None, []):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][0]["calibration"]["unit"] = value
                self.assert_invalid(source)

    def test_null_or_partial_calibration_rejected(self):
        for value in (None, {}, {"quantity": "180", "unit": "g"}):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][0]["calibration"] = value
                self.assert_invalid(source)

    def test_calibration_evidence_must_resolve(self):
        source = example()
        source["ingredients"][0]["calibration"]["evidence"]["quote"] = "A model guessed 180g"
        self.assert_invalid(source)

    def test_quote_must_be_verbatim(self):
        source = example()
        source["ingredients"][2]["evidence"]["quote"] = "two tomatoes"
        self.assert_invalid(source)

    def test_evidence_cannot_reference_nonexistent_turn(self):
        source = example()
        source["ingredients"][2]["evidence"]["turn_id"] = "missing"
        self.assert_invalid(source)

    def test_evidence_cannot_cite_agent(self):
        source = example()
        source["ingredients"][2]["evidence"] = {"turn_id": "t0", "quote": "How do you make dal?"}
        self.assert_invalid(source)

    def test_blank_evidence_is_not_proof(self):
        for value in ("", " ", None, True):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][2]["evidence"]["quote"] = value
                self.assert_invalid(source)

    def test_evidence_extra_fields_rejected(self):
        source = example()
        source["ingredients"][2]["evidence"]["verified"] = True
        self.assert_invalid(source)

    def test_optional_serving_evidence_must_be_valid(self):
        source = example()
        source["servings_evidence"]["quote"] = "For twenty people"
        self.assert_invalid(source)

    def test_duplicate_turn_id_rejected(self):
        source = example()
        source["transcript"].append(deepcopy(source["transcript"][1]))
        self.assert_invalid(source)

    def test_duplicate_ingredient_id_rejected(self):
        source = example()
        source["ingredients"].append(deepcopy(source["ingredients"][0]))
        self.assert_invalid(source)

    def test_duplicate_step_id_rejected(self):
        source = example()
        source["steps"].append(deepcopy(source["steps"][0]))
        self.assert_invalid(source)

    def test_dependency_cycle_rejected(self):
        source = example()
        source["steps"][0]["depends_on"] = ["rest"]
        self.assert_invalid(source)

    def test_missing_dependency_rejected(self):
        source = example()
        source["steps"][0]["depends_on"] = ["missing"]
        self.assert_invalid(source)

    def test_self_dependency_rejected(self):
        source = example()
        source["steps"][0]["depends_on"] = ["simmer"]
        self.assert_invalid(source)

    def test_duplicate_dependency_rejected(self):
        source = example()
        source["steps"][1]["depends_on"] = ["simmer", "simmer"]
        self.assert_invalid(source)

    def test_future_listed_dependency_valid(self):
        source = example()
        source["steps"].reverse()
        self.assertEqual(validate_recipe(source)["steps"], source["steps"])

    def test_step_evidence_must_resolve(self):
        source = example()
        source["steps"][0]["evidence"]["quote"] = "Boil forever"
        self.assert_invalid(source)

    def test_unknown_duration_is_preserved(self):
        source = example()
        source["steps"][0]["duration_minutes"] = None
        self.assertIsNone(scale_recipe(source, 4)["steps"][0]["duration_minutes"])

    def test_duration_bounds_and_type(self):
        for value in (True, 20, "-1", "NaN", "10081"):
            with self.subTest(value=value):
                source = example()
                source["steps"][0]["duration_minutes"] = value
                self.assert_invalid(source)
        source = example()
        source["steps"][0]["duration_minutes"] = "0"
        validate_recipe(source)

    def test_correction_history_is_preserved_not_invented(self):
        source = example()
        self.assertEqual(scale_recipe(source, 4)["corrections"], source["corrections"])
        source["corrections"] = []
        self.assertEqual(scale_recipe(source, 4)["corrections"], [])

    def test_correction_must_end_at_current_value(self):
        source = example()
        source["corrections"][0]["updated"] = "600"
        self.assert_invalid(source)

    def test_correction_cannot_reference_missing_ingredient(self):
        source = example()
        source["corrections"][0]["ingredient_id"] = "missing"
        self.assert_invalid(source)

    def test_correction_field_is_limited(self):
        source = example()
        source["corrections"][0]["field"] = "name"
        self.assert_invalid(source)

    def test_correction_evidence_must_resolve(self):
        source = example()
        source["corrections"][0]["evidence"]["quote"] = "Use 900 ml"
        self.assert_invalid(source)

    def test_correction_cannot_be_noop(self):
        source = example()
        source["corrections"][0]["previous"] = "500"
        self.assert_invalid(source)

    def test_correction_chain_must_connect(self):
        source = example()
        source["corrections"].insert(0, {"ingredient_id": "water", "field": "quantity", "previous": "200", "updated": "300", "evidence": {"turn_id": "t1", "quote": "400 ml water"}})
        self.assert_invalid(source)

    def test_connected_correction_chain_is_valid(self):
        source = example()
        source["transcript"].insert(1, {"turn_id": "early", "speaker": "cook", "text": "Start with 200 ml, actually make that 400 ml water."})
        source["corrections"].insert(0, {"ingredient_id": "water", "field": "quantity", "previous": "200", "updated": "400", "evidence": {"turn_id": "early", "quote": "Start with 200 ml, actually make that 400 ml water."}})
        validate_recipe(source)

    def test_correction_chain_cannot_reverse_transcript_time(self):
        source = example()
        source["corrections"].insert(0, {"ingredient_id": "water", "field": "quantity", "previous": "200", "updated": "400", "evidence": {"turn_id": "t2", "quote": "400 ml"}})
        source["corrections"][1]["evidence"] = {"turn_id": "t1", "quote": "400 ml water"}
        self.assert_invalid(source)

    def test_missing_root_field_rejected(self):
        for key in ("title", "servings", "ingredients", "transcript", "steps", "corrections"):
            with self.subTest(key=key):
                source = example()
                del source[key]
                self.assert_invalid(source)

    def test_wrong_root_types_rejected(self):
        for value in (None, [], True, "recipe", 3):
            with self.subTest(value=value):
                self.assert_invalid(value)

    def test_wrong_array_types_rejected(self):
        for key in ("ingredients", "transcript", "steps", "corrections"):
            for value in (None, True, {}, "items"):
                with self.subTest(key=key, value=value):
                    source = example()
                    source[key] = value
                    self.assert_invalid(source)

    def test_required_arrays_cannot_be_empty(self):
        for key in ("ingredients", "transcript", "steps"):
            with self.subTest(key=key):
                source = example()
                source[key] = []
                self.assert_invalid(source)

    def test_unknown_root_fields_rejected(self):
        source = example()
        source["trusted"] = True
        self.assert_invalid(source)

    def test_invalid_ids_rejected(self):
        for value in (None, True, "", "with spaces", "../file", "a" * 65):
            with self.subTest(value=value):
                source = example()
                source["ingredients"][2]["id"] = value
                self.assert_invalid(source)

    def test_unsupported_transcript_speaker_rejected(self):
        for value in (None, True, {}, "system", "doctor"):
            with self.subTest(value=value):
                source = example()
                source["transcript"][0]["speaker"] = value
                self.assert_invalid(source)

    def test_oversize_arrays_and_text_rejected(self):
        source = example()
        source["ingredients"] *= 101
        self.assert_invalid(source)
        source = example()
        source["title"] = "x" * 201
        self.assert_invalid(source)
        source = example()
        source["transcript"][0]["text"] = "x" * 4001
        self.assert_invalid(source)

    def test_control_characters_rejected(self):
        source = example()
        source["title"] = "Dal\x00injected"
        self.assert_invalid(source)

    def test_non_latin_quotes_remain_verbatim(self):
        source = example()
        quote = "\u0928\u092e\u0915 \u0938\u094d\u0935\u093e\u0926 \u0905\u0928\u0941\u0938\u093e\u0930\u0964"
        source["transcript"][1]["text"] += " " + quote
        source["ingredients"][3]["evidence"]["quote"] = quote
        item = scale_recipe(source, 4)["ingredients"][3]
        self.assertEqual(item["evidence"]["quote"], quote)


if __name__ == "__main__":
    unittest.main()
