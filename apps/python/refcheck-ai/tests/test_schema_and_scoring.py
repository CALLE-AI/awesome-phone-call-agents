"""The CALL-E call task, its result schema, and how results are scored."""
import pytest

from conftest import full_result, make_call
from refcheck.results import (
    OUTCOME_TO_STATUS,
    enthusiasm_for_db,
    extract_duration_seconds,
    extract_provider_call_id,
    extract_transcript,
    rehire_to_bool,
)
from refcheck.schema import RATING_VALUES, build_result_schema
from refcheck.scoring import (
    compute_candidate_score,
    compute_reference_score,
    score_to_recommendation,
)
from refcheck.task import build_reference_task
from refcheck.templates import TEMPLATES

# JSON Schema keywords CALL-E rejects.
UNSUPPORTED = {"$ref", "oneOf", "anyOf", "allOf", "patternProperties", "not"}


def walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from walk(v)


class TestResultSchema:
    def test_uses_only_supported_keywords(self, questions):
        for node in walk(build_result_schema(questions)):
            assert not (UNSUPPORTED & set(node)), f"unsupported keyword in {list(node)}"

    def test_objects_are_closed(self, questions):
        """Strict objects — CALL-E rejects additionalProperties: true."""
        for node in walk(build_result_schema(questions)):
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False

    def test_every_template_question_is_required(self, questions):
        answers = build_result_schema(questions)["properties"]["answers"]
        ids = [q["id"] for q in questions]
        assert set(answers["properties"]) == set(ids)
        assert set(answers["required"]) == set(ids)

    def test_schema_follows_the_template_not_a_fixed_list(self):
        """A sales template must produce sales fields, not the standard nine."""
        answers = build_result_schema(TEMPLATES["sales"])["properties"]["answers"]
        assert "q_quota" in answers["properties"]
        assert "q_code_quality" not in answers["properties"]

    @pytest.mark.parametrize("name", sorted(TEMPLATES))
    def test_every_shipped_template_builds_a_valid_schema(self, name):
        schema = build_result_schema(TEMPLATES[name])
        assert schema["properties"]["answers"]["required"]
        for node in walk(schema):
            assert not (UNSUPPORTED & set(node))

    def test_ratings_can_express_not_answered(self, questions):
        answers = build_result_schema(questions)["properties"]["answers"]
        rating = answers["properties"]["q_rehire"]["properties"]["rating"]
        assert rating["enum"] == RATING_VALUES
        assert "not_answered" in rating["enum"]

    def test_ambiguous_fields_offer_an_unknown_value(self, questions):
        props = build_result_schema(questions)["properties"]
        for field in ("spoke_with_referee", "call_outcome", "referee_enthusiasm", "would_rehire"):
            assert "unknown" in props[field]["enum"], field

    def test_every_enum_documents_how_to_choose(self, questions):
        for node in walk(build_result_schema(questions)):
            if "enum" in node:
                assert node.get("description"), f"enum without description: {node['enum']}"

    def test_every_outcome_maps_to_a_call_status(self, questions):
        outcomes = build_result_schema(questions)["properties"]["call_outcome"]["enum"]
        assert set(outcomes) == set(OUTCOME_TO_STATUS)


class TestReferenceTask:
    def test_substitutes_placeholders(self, reference, candidate, questions):
        task = build_reference_task(reference, candidate, questions)
        assert "{candidate_name}" not in task
        assert "{role}" not in task
        assert "{jd_summary}" not in task
        assert "Alex Candidate" in task and "Senior Software Engineer" in task

    def test_names_the_referee_and_the_calling_company(self, reference, candidate, questions):
        task = build_reference_task(reference, candidate, questions)
        assert "Jordan Referee" in task
        assert "Northwind" in task

    def test_missing_jd_summary_does_not_leak_none(self, reference, candidate, questions):
        candidate["job_description_summary"] = None
        task = build_reference_task(reference, candidate, questions)
        assert "None" not in task and "{jd_summary}" not in task

    def test_includes_follow_up_probe(self, reference, candidate, questions):
        task = build_reference_task(reference, candidate, questions)
        assert "Can you give a specific example?" in task

    def test_handles_the_only_confirm_dates_policy(self, reference, candidate, questions):
        task = build_reference_task(reference, candidate, questions)
        assert "DATES OF EMPLOYMENT" in task.upper()
        assert "Do not push" in task

    def test_warns_off_protected_characteristics(self, reference, candidate, questions):
        task = build_reference_task(reference, candidate, questions)
        assert "protected characteristic" in task


class TestScoring:
    def test_all_fives_with_top_enthusiasm_is_capped_at_ten(self):
        answers = {f"q{i}": {"response": "", "rating": "5"} for i in range(4)}
        assert compute_reference_score(answers, "very_enthusiastic") == 10.0

    def test_rehire_carries_double_weight(self):
        """A bad rehire answer must hurt more than a bad low-weight answer."""
        good = {"response": "", "rating": "5"}
        bad = {"response": "", "rating": "1"}
        bad_rehire = compute_reference_score(
            {"q_rehire": bad, "q_relationship": good, "q_role": good}, "neutral"
        )
        bad_minor = compute_reference_score(
            {"q_rehire": good, "q_relationship": bad, "q_role": good}, "neutral"
        )
        assert bad_rehire < bad_minor

    def test_unanswered_questions_are_excluded_not_scored_as_neutral(self):
        """A skipped question is missing evidence, not a middling review."""
        answered_only = compute_reference_score(
            {"q_strengths": {"response": "", "rating": "5"}}, "neutral"
        )
        with_skip = compute_reference_score(
            {
                "q_strengths": {"response": "", "rating": "5"},
                "q_fit": {"response": "", "rating": "not_answered"},
            },
            "neutral",
        )
        assert with_skip == answered_only == 10.0

    def test_returns_none_when_nothing_was_answered(self):
        assert compute_reference_score({}, "positive") is None
        assert compute_reference_score(None, "positive") is None
        assert (
            compute_reference_score({"q_fit": {"rating": "not_answered"}}, "positive") is None
        )

    def test_enthusiasm_shifts_the_score(self):
        answers = {"q_fit": {"response": "", "rating": "3"}}
        assert compute_reference_score(answers, "hesitant") < compute_reference_score(
            answers, "neutral"
        ) < compute_reference_score(answers, "very_enthusiastic")

    def test_score_never_leaves_the_zero_to_ten_range(self):
        worst = compute_reference_score({"q_fit": {"rating": "1"}}, "negative")
        assert 0.0 <= worst <= 10.0

    def test_malformed_answer_entries_are_ignored(self):
        answers = {"q_fit": "not a dict", "q_rehire": {"response": "", "rating": "5"}}
        assert compute_reference_score(answers, "neutral") == 10.0

    def test_unknown_enthusiasm_is_no_bonus(self):
        answers = {"q_fit": {"rating": "4"}}
        assert compute_reference_score(answers, "unknown") == compute_reference_score(
            answers, "neutral"
        )

    def test_candidate_score_averages_references(self):
        assert compute_candidate_score([9.0, 8.0, 7.0]) == 8.0
        assert compute_candidate_score([]) is None

    @pytest.mark.parametrize(
        "score,expected",
        [
            (10.0, "strong_yes"),
            (8.5, "strong_yes"),
            (8.49, "yes"),
            (7.0, "yes"),
            (6.0, "neutral"),
            (4.0, "no"),
            (3.9, "strong_no"),
        ],
    )
    def test_recommendation_thresholds(self, score, expected):
        assert score_to_recommendation(score) == expected


class TestTerminalCallParsing:
    def test_transcript_is_flattened_and_labelled(self):
        transcript = extract_transcript(make_call())
        assert transcript == "Agent: Is this Jordan?\nReferee: Speaking."

    def test_empty_transcript_is_none_not_blank(self):
        assert extract_transcript(make_call(turns=[])) is None

    def test_duration_comes_from_attempt_timestamps(self):
        assert extract_duration_seconds(make_call()) == 8 * 60

    def test_missing_timestamps_give_no_duration(self):
        assert extract_duration_seconds(make_call(completed_at=None)) is None

    def test_provider_call_id_is_read_from_the_attempt(self):
        assert extract_provider_call_id(make_call()) == "provider_001"
        assert extract_provider_call_id(make_call(provider_call_id=None)) is None

    def test_call_with_no_recipients_does_not_crash(self):
        call = make_call()
        call["recipients"] = []
        assert extract_transcript(call) is None
        assert extract_duration_seconds(call) is None
        assert extract_provider_call_id(call) is None


class TestOutcomeMapping:
    @pytest.mark.parametrize(
        "value,expected",
        [("yes", True), ("no", False), ("qualified", None), ("unknown", None), (None, None)],
    )
    def test_qualified_rehire_stays_null_rather_than_collapsing(self, value, expected):
        assert rehire_to_bool(value) is expected

    def test_unknown_enthusiasm_maps_to_none(self):
        assert enthusiasm_for_db("unknown") is None
        assert enthusiasm_for_db(None) is None
        assert enthusiasm_for_db("hesitant") == "hesitant"

    def test_policy_limited_call_still_counts_as_completed(self):
        assert OUTCOME_TO_STATUS["only_confirmed_employment"] == "completed"

    def test_a_full_result_scores_end_to_end(self):
        result = full_result()
        score = compute_reference_score(result["answers"], result["referee_enthusiasm"])
        assert 9.0 <= score <= 10.0
        assert score_to_recommendation(score) == "strong_yes"
