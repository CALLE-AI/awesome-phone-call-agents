import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

from evaluator import RecallEvaluator, validate_assessment


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Prevent bearer credentials and learner content from following redirects."""

    def redirect_request(
        self,
        req,
        fp,
        code,
        msg,
        headers,
        newurl,
    ):
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            "LLM redirects are disabled for security.",
            headers,
            None,
        )


class LLMRecallEvaluator(RecallEvaluator):
    """
    Provider-neutral HTTPS LLM evaluator.

    The host application supplies:
    - LLM endpoint
    - approved HTTPS origin
    - API key
    - model name

    The endpoint must match the explicitly approved origin.
    Credentials and learner content are never sent to an arbitrary
    or insecure endpoint.
    """

    def __init__(
        self,
        endpoint=None,
        api_key=None,
        model=None,
        approved_origin=None,
    ):
        self.endpoint = endpoint or os.getenv("LLM_ENDPOINT")
        self.api_key = api_key or os.getenv("LLM_API_KEY")
        self.model = model or os.getenv("LLM_MODEL")
        self.approved_origin = (
            approved_origin or os.getenv("LLM_APPROVED_ORIGIN")
        )

        if not self.endpoint:
            raise ValueError("LLM_ENDPOINT is required.")

        if not self.api_key:
            raise ValueError("LLM_API_KEY is required.")

        if not self.model:
            raise ValueError("LLM_MODEL is required.")

        if not self.approved_origin:
            raise ValueError(
                "LLM_APPROVED_ORIGIN is required."
            )

        self._validate_endpoint()

    def _validate_endpoint(self):
        endpoint = urlparse(self.endpoint)
        approved = urlparse(self.approved_origin)

        if endpoint.scheme != "https":
            raise ValueError(
                "LLM_ENDPOINT must use HTTPS."
            )

        if approved.scheme != "https":
            raise ValueError(
                "LLM_APPROVED_ORIGIN must use HTTPS."
            )

        if not endpoint.netloc:
            raise ValueError(
                "LLM_ENDPOINT must contain a valid host."
            )

        if not approved.netloc:
            raise ValueError(
                "LLM_APPROVED_ORIGIN must contain a valid host."
            )

        if endpoint.username or endpoint.password:
            raise ValueError(
                "LLM_ENDPOINT must not contain embedded credentials."
            )

        if endpoint.scheme != approved.scheme:
            raise ValueError(
                "LLM_ENDPOINT scheme does not match "
                "LLM_APPROVED_ORIGIN."
            )

        if endpoint.netloc.lower() != approved.netloc.lower():
            raise ValueError(
                "LLM_ENDPOINT origin does not match "
                "LLM_APPROVED_ORIGIN."
            )

    def build_prompt(
        self,
        topic,
        study_context,
        learner_response,
    ):
        return f"""
You are an educational active-recall evaluator.

Your job is to evaluate what a learner actually remembers.

Topic:
{topic}

Study context:
{study_context}

Learner response:
{learner_response}

Rules:
1. Compare the learner response against the study context.
2. Do not invent facts that are not supported by the study context.
3. Distinguish uncertainty or forgetting from a genuine misconception.
4. Only record a misconception when the learner's response provides evidence.
5. Be honest about missing concepts.
6. Prefer evidence from the learner's actual response.
7. Return ONLY valid JSON.
8. Do not include Markdown code fences.

Return exactly this structure:
{{
  "topic": "{topic}",
  "recall_score": 0,
  "status": "strong|good|partial|weak|misconception_detected",
  "concepts_remembered": [],
  "weak_areas": [],
  "misconceptions": [
    {{
      "concept": "",
      "student_belief": "",
      "correct_understanding": "",
      "evidence_from_response": ""
    }}
  ],
  "confidence": "high|medium|low",
  "summary": "",
  "recommended_next_review": ""
}}

Scoring guidance:

90-100 = strong recall
75-89 = good recall
50-74 = partial recall
0-49 = weak recall

Use "misconception_detected" when a genuine misconception is
supported by the learner's response.

The recommended review interval should normally be one of:

1 day
3 days
7 days
14 days
30 days
"""

    def evaluate(
        self,
        topic,
        study_context,
        learner_response,
    ):
        if not topic.strip():
            raise ValueError("topic is required")

        if not study_context.strip():
            raise ValueError("study_context is required")

        if not learner_response.strip():
            raise ValueError("learner_response is required")

        prompt = self.build_prompt(
            topic,
            study_context,
            learner_response,
        )

        payload = {
            "model": self.model,
            "prompt": prompt,
        }

        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )

        opener = urllib.request.build_opener(
            NoRedirectHandler()
        )

        try:
            with opener.open(request, timeout=30) as response:
                raw_response = response.read().decode("utf-8")
        except Exception as exc:
            raise RuntimeError(
                f"LLM request failed: {exc}"
            ) from exc

        try:
            response_data = json.loads(raw_response)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "LLM returned invalid JSON."
            ) from exc

        model_text = response_data.get("text")

        if model_text is None:
            model_text = response_data.get("response")

        if model_text is None:
            raise ValueError(
                "LLM response did not contain 'text' or 'response'."
            )

        try:
            assessment = json.loads(model_text)
        except json.JSONDecodeError as exc:
            raise ValueError(
                "LLM output was not valid assessment JSON."
            ) from exc

        return validate_assessment(assessment)