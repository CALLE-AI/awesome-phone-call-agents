from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from measureback.calle import CalleError, _NoRedirect, execute, extract_recipe, generate_payload, get_result, preview


NOW = datetime(2026, 9, 12, 12, tzinfo=timezone.utc)


def request():
    return {
        "request_id": "interview-1",
        "phone": "+12025550123",
        "requester": "Alex",
        "cook_name": "Sam",
        "recipe_title": "Family lentils",
        "region": "US",
        "locale": "en-US",
        "consent": True,
        "sharing_consent": True,
        "window_start": (NOW - timedelta(minutes=10)).isoformat(),
        "window_end": (NOW + timedelta(minutes=10)).isoformat(),
    }


def provider_result():
    cook_text = "This serves 2. Use 100 g lentils. Boil them for 20 minutes."
    capture_text = "Yes, you may transcribe this recipe interview."
    share_text = "Yes, you may share this corrected recipe with Alex."
    evidence = {"turn_id": "t1", "quote": cook_text}
    recipe = {
        "title": "Family lentils", "servings": 2, "servings_evidence": evidence,
        "transcript": [
            {"turn_id": "consent_capture", "speaker": "cook", "text": capture_text},
            {"turn_id": "t1", "speaker": "cook", "text": cook_text},
            {"turn_id": "consent_share", "speaker": "cook", "text": share_text},
        ],
        "ingredients": [{"id": "lentils", "name": "Lentils", "quantity": "100", "unit": "g", "evidence": evidence}],
        "steps": [{"id": "boil", "text": "Boil the lentils", "duration_minutes": "20", "depends_on": [], "evidence": evidence}],
        "corrections": [],
    }
    return {"status": "completed", "recipients": [{
        "structured_result": {
            "consent_to_capture": True, "consent_to_share": True,
            "consent_to_capture_evidence": {"turn_id": "consent_capture", "quote": capture_text},
            "consent_to_share_evidence": {"turn_id": "consent_share", "quote": share_text},
            "consent_withdrawn": False, "withdrawal_evidence": None, "recipe": recipe,
        },
        "attempts": [{"transcript_turns": [
            {"offset_seconds": index * 10, "speaker": "user", "text": turn["text"]}
            for index, turn in enumerate(recipe["transcript"])
        ]}],
    }]}


class CallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.store = Path(self.temporary.name) / "calls.sqlite3"
        self.calls = []

    def tearDown(self):
        self.temporary.cleanup()

    def transport(self, method, path, payload, headers):
        self.calls.append((method, path, payload, headers))
        return {"id": "call_example"} if method == "POST" else provider_result()

    def execute(self, req=None, **kwargs):
        req = req or request()
        return execute(req, preview(req, NOW)["approval_token"], store_path=self.store, api_key="test_key_not_real", now=NOW, transport=self.transport, **kwargs)

    def test_preview_has_no_network_or_full_phone(self):
        with patch("measureback.calle._http", side_effect=AssertionError("network")):
            result = preview(request(), NOW)
        self.assertFalse(result["creates_call"])
        self.assertTrue(result["within_window"])
        self.assertNotIn(request()["phone"], json.dumps(result))
        self.assertFalse(self.store.exists())

    def test_requires_actual_boolean_consents(self):
        for field in ("consent", "sharing_consent"):
            for value in (False, "true", 1, None):
                req = request()
                req[field] = value
                with self.subTest(field=field, value=value), self.assertRaises(CalleError):
                    preview(req, NOW)

    def test_request_must_have_explicit_locale_region_and_e164(self):
        for field, value in (("phone", "2025550123"), ("locale", ""), ("region", "ZZ"), ("language_mode", "guess"), ("cook_name", "Sam\r\nInjected")):
            req = request()
            req[field] = value
            with self.subTest(field=field), self.assertRaises(CalleError):
                preview(req, NOW)

    def test_offset_and_window_validation(self):
        for start, end in (("2026-09-12T12:00:00", request()["window_end"]), (request()["window_end"], request()["window_start"]), ("2026-09-12T12:00:00Z", "2026-09-14T12:00:00Z")):
            req = request()
            req.update(window_start=start, window_end=end)
            with self.subTest(start=start, end=end), self.assertRaises(CalleError):
                preview(req, NOW)

    def test_outside_window_can_preview_but_not_execute(self):
        req = request()
        later = NOW + timedelta(days=1)
        plan = preview(req, later)
        self.assertFalse(plan["within_window"])
        with self.assertRaises(CalleError):
            execute(req, plan["approval_token"], store_path=self.store, api_key="test_key", now=later, transport=self.transport)
        self.assertFalse(self.calls)

    def test_changed_request_invalidates_approval(self):
        req = request()
        token = preview(req, NOW)["approval_token"]
        req["recipe_title"] = "Different recipe"
        with self.assertRaises(CalleError):
            execute(req, token, store_path=self.store, api_key="test_key", now=NOW, transport=self.transport)
        self.assertFalse(self.calls)

    def test_correct_http_contract_and_single_recipient(self):
        result = self.execute()
        method, path, payload, headers = self.calls[0]
        self.assertEqual((method, path), ("POST", "/v1/calls"))
        self.assertEqual(payload["recipients"], [{"phones": [request()["phone"]], "region": "US", "locale": "en-US"}])
        self.assertIn("recipient_result_schema", payload)
        self.assertEqual(headers["Authorization"], "Bearer test_key_not_real")
        self.assertTrue(headers["Idempotency-Key"].startswith("measureback_"))
        self.assertEqual(result["state"], "accepted")
        self.assertNotIn(request()["phone"], json.dumps(result))
        self.assertNotIn("test_key_not_real", json.dumps(result))
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o600)

    def test_restart_reuses_ledger_without_another_post(self):
        first = self.execute()
        second = self.execute()
        self.assertEqual(first["call_id"], second["call_id"])
        self.assertTrue(second["duplicate_prevented"])
        self.assertFalse(second["creates_call"])
        self.assertEqual(len(self.calls), 1)

    def test_concurrent_execution_places_only_one_call(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.execute(), range(4)))
        self.assertEqual(sum(item["creates_call"] for item in results), 1)
        self.assertEqual(len(self.calls), 1)

    def test_same_request_id_cannot_be_reapproved_to_bypass_ledger(self):
        self.execute()
        req = request()
        req["recipe_title"] = "Changed"
        with self.assertRaises(CalleError):
            self.execute(req)
        self.assertEqual(len(self.calls), 1)

    def test_ambiguous_post_is_locked_and_redacted(self):
        req = request()
        def failing(*args):
            raise RuntimeError("sensitive_key " + req["phone"])
        with self.assertRaises(CalleError) as caught:
            execute(req, preview(req, NOW)["approval_token"], store_path=self.store, api_key="test_key", now=NOW, transport=failing)
        self.assertNotIn("sensitive_key", str(caught.exception))
        self.assertNotIn(req["phone"], str(caught.exception))
        result = self.execute()
        self.assertEqual(result["state"], "unknown")
        self.assertTrue(result["duplicate_prevented"])
        self.assertFalse(self.calls)

    def test_missing_call_id_is_also_ambiguous(self):
        req = request()
        with self.assertRaises(CalleError):
            execute(req, preview(req, NOW)["approval_token"], store_path=self.store, api_key="test_key", now=NOW, transport=lambda *args: {})
        self.assertEqual(self.execute()["state"], "unknown")
        self.assertFalse(self.calls)

    def test_submitting_reservation_blocks_after_crash(self):
        self.execute()
        with closing(sqlite3.connect(self.store)) as connection:
            with connection:
                connection.execute("UPDATE calls SET state='submitting', call_id=NULL")
        result = self.execute()
        self.assertEqual(result["state"], "submitting")
        self.assertEqual(len(self.calls), 1)

    def test_missing_key_is_rejected_before_reservation(self):
        req = request()
        with self.assertRaises(CalleError):
            execute(req, preview(req, NOW)["approval_token"], store_path=self.store, api_key="", now=NOW, transport=self.transport)
        self.assertFalse(self.store.exists())

    def test_redirects_are_not_followed(self):
        with self.assertRaises(CalleError):
            _NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://example.invalid/steal")

    def test_get_requires_known_id(self):
        for call_id in ("unknown_id", "../keys", "call_example?token=secret"):
            with self.subTest(call_id=call_id), self.assertRaises(CalleError):
                get_result(call_id, store_path=self.store, api_key="test_key", transport=self.transport)
        self.assertFalse(self.calls)

    def test_completed_get_returns_only_validated_recipe(self):
        self.execute()
        result = get_result("call_example", store_path=self.store, api_key="test_key", transport=self.transport)
        self.assertEqual(result["recipe"]["ingredients"][0]["quantity"], "100")
        self.assertEqual(result["state"], "completed")
        self.assertEqual(result["request_id"], "interview-1")
        self.assertTrue(result["consent_review_required"])
        self.assertEqual(result["consent_evidence"]["capture"]["quote"], "Yes, you may transcribe this recipe interview.")
        self.assertEqual(len(result["consent_evidence"]["source_transcript"]), 3)
        self.assertNotIn("attempts", result)
        self.assertEqual(self.calls[-1][0:2], ("GET", "/v1/calls/call_example"))

    def test_unextracted_later_dialogue_is_in_manual_review_transcript(self):
        self.execute()
        response = provider_result()
        response["recipients"][0]["attempts"][0]["transcript_turns"].append({"speaker": "user", "text": "Actually, do not share this recipe."})
        result = get_result("call_example", store_path=self.store, api_key="test_key", transport=lambda *args: response)
        self.assertTrue(result["consent_review_required"])
        self.assertEqual(result["consent_evidence"]["source_transcript"][-1]["text"], "Actually, do not share this recipe.")

    def test_negative_consent_words_still_require_human_interpretation(self):
        self.execute()
        response = provider_result()
        structured = response["recipients"][0]["structured_result"]
        text = "No, do not share this recipe."
        structured["recipe"]["transcript"][-1]["text"] = text
        structured["consent_to_share_evidence"]["quote"] = text
        response["recipients"][0]["attempts"][0]["transcript_turns"][-1]["text"] = text
        result = get_result("call_example", store_path=self.store, api_key="test_key", transport=lambda *args: response)
        self.assertTrue(result["consent_review_required"])
        self.assertEqual(result["consent_evidence"]["sharing"]["quote"], text)
        self.assertIn("not affirmative consent meaning", result["consent_evidence"]["review_note"])

    def test_poll_failure_does_not_create_another_call(self):
        self.execute()
        with self.assertRaises(CalleError) as caught:
            get_result("call_example", store_path=self.store, api_key="test_key", transport=lambda *args: (_ for _ in ()).throw(RuntimeError("key phone")))
        self.assertNotIn("key phone", str(caught.exception))
        self.assertEqual(len(self.calls), 1)

    def test_returned_recipe_redacts_phone_and_credentials(self):
        self.execute()
        response = provider_result()
        response["recipients"][0]["structured_result"]["recipe"]["title"] = "Recipe +12025550123 test_key iams_live_example"
        result = get_result("call_example", store_path=self.store, api_key="test_key", transport=lambda *args: response)
        encoded = json.dumps(result)
        self.assertNotIn("+12025550123", encoded)
        self.assertNotIn("test_key", encoded)
        self.assertNotIn("iams_live_example", encoded)

    def test_payload_language_modes_are_truthful(self):
        req = request()
        self.assertIn("Use the selected locale", generate_payload(req)["task"])
        req["language_mode"] = "adaptive"
        self.assertIn("best effort", generate_payload(req)["task"])
        self.assertEqual(generate_payload(req)["recipients"][0]["locale"], "en-US")


class ExtractionTests(unittest.TestCase):
    def test_extract_valid_preserves_original_source(self):
        value = provider_result()
        self.assertEqual(extract_recipe(value), value["recipients"][0]["structured_result"]["recipe"])

    def test_no_consent_never_releases_recipe(self):
        for field in ("consent_to_capture", "consent_to_share"):
            value = provider_result()
            value["recipients"][0]["structured_result"][field] = False
            with self.subTest(field=field), self.assertRaises(CalleError):
                extract_recipe(value)

    def test_true_booleans_without_consent_anchors_are_rejected(self):
        for field in ("consent_to_capture_evidence", "consent_to_share_evidence"):
            value = provider_result()
            del value["recipients"][0]["structured_result"][field]
            with self.subTest(field=field), self.assertRaises(CalleError):
                extract_recipe(value)

    def test_consent_quote_must_resolve_to_actual_source(self):
        for quote in (None, "", "I agreed to something I never said."):
            value = provider_result()
            value["recipients"][0]["structured_result"]["consent_to_capture_evidence"]["quote"] = quote
            with self.subTest(quote=quote), self.assertRaises(CalleError):
                extract_recipe(value)

    def test_agent_question_is_not_cook_consent_evidence(self):
        value = provider_result()
        structured = value["recipients"][0]["structured_result"]
        structured["recipe"]["transcript"][0]["speaker"] = "agent"
        value["recipients"][0]["attempts"][0]["transcript_turns"][0]["speaker"] = "bot"
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_indicated_withdrawal_blocks_even_with_earlier_consent(self):
        for withdrawn, evidence in ((True, None), (False, {"turn_id": "t_stop", "quote": "Do not share this."}), (True, {"turn_id": "t_stop", "quote": "Do not share this."})):
            value = provider_result()
            structured = value["recipients"][0]["structured_result"]
            structured.update(consent_withdrawn=withdrawn, withdrawal_evidence=evidence)
            structured["recipe"]["transcript"].append({"turn_id": "t_stop", "speaker": "cook", "text": "Do not share this."})
            value["recipients"][0]["attempts"][0]["transcript_turns"].append({"speaker": "user", "text": "Do not share this."})
            with self.subTest(withdrawn=withdrawn, evidence=evidence), self.assertRaises(CalleError):
                extract_recipe(value)

    def test_missing_withdrawal_state_blocks(self):
        for field in ("consent_withdrawn", "withdrawal_evidence"):
            value = provider_result()
            del value["recipients"][0]["structured_result"][field]
            with self.subTest(field=field), self.assertRaises(CalleError):
                extract_recipe(value)

    def test_exact_quote_matching_does_not_claim_semantic_consent(self):
        # An extraction error can label even a genuine negative utterance as
        # affirmative. Source matching intentionally is not a language classifier;
        # get_result always requires human review of the complete source dialogue.
        value = provider_result()
        structured = value["recipients"][0]["structured_result"]
        text = "No, do not share this recipe."
        structured["recipe"]["transcript"][-1]["text"] = text
        structured["consent_to_share_evidence"]["quote"] = text
        value["recipients"][0]["attempts"][0]["transcript_turns"][-1]["text"] = text
        self.assertEqual(extract_recipe(value)["title"], "Family lentils")

    def test_schema_generated_transcript_cannot_prove_itself(self):
        value = provider_result()
        value["recipients"][0]["attempts"][0]["transcript_turns"][0]["text"] = "I never said any of that."
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_agent_cannot_masquerade_as_cook(self):
        value = provider_result()
        value["recipients"][0]["attempts"][0]["transcript_turns"][0]["speaker"] = "bot"
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_multiple_attempts_require_review(self):
        value = provider_result()
        value["recipients"][0]["attempts"] *= 2
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_generated_transcript_cannot_reorder_actual_turns(self):
        value = provider_result()
        recipe = value["recipients"][0]["structured_result"]["recipe"]
        recipe["transcript"].insert(0, {"turn_id": "t0", "speaker": "agent", "text": "Thanks."})
        value["recipients"][0]["attempts"][0]["transcript_turns"].append({"speaker": "bot", "text": "Thanks."})
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_missing_raw_transcript_requires_review(self):
        value = provider_result()
        value["recipients"][0]["attempts"] = [{}]
        with self.assertRaises(CalleError):
            extract_recipe(value)

    def test_no_recipe_or_unanchored_servings_rejected(self):
        for delete_servings in (False, True):
            value = provider_result()
            if delete_servings:
                del value["recipients"][0]["structured_result"]["recipe"]["servings_evidence"]
            else:
                value["recipients"][0]["structured_result"]["recipe"] = None
            with self.subTest(delete_servings=delete_servings), self.assertRaises(CalleError):
                extract_recipe(value)


if __name__ == "__main__":
    unittest.main()
