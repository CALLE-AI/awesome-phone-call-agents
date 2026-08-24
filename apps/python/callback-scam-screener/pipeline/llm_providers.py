"""Thin, provider-agnostic wrapper around single-turn LLM completions, used
by signal_catalog.tag_transcript_llm. "Bring your own keys" shouldn't mean
"bring your own Anthropic key specifically" — add a provider by writing one
function with this signature and adding one PROVIDERS entry. Only "gemini"
is currently registered, since it's the only one proven against a real API
call so far — see the PROVIDERS comment below.

Pricing in guardrails.MODEL_PRICING_PER_MTOK must be kept in step with
whichever provider/model is actually used, since LLMBudgetGuard depends on
it to estimate real spend from real token counts.

NOTE: the Gemini path originally targeted client.models.generate_content()
with gemini-2.5-flash — a real run hit a real 404, since that model and
method are deprecated ("no longer available to new users", Google's error
pointed at https://ai.google.dev/gemini-api/docs/migrate-to-interactions).
Switched to the Interactions API (client.interactions.create(), model
gemini-3.6-flash, interaction.output_text, interaction.usage.total_
{input,output}_tokens) per that migration guide — still unconfirmed against
an actual successful real call in this project as of this fix, same
"documented but not yet proven" caveat RealCallEClient's REST shape needed
before its own real test (see caller.py).
"""
import os
from dataclasses import dataclass

import truststore

# Defer to the OS's own certificate validation for every SSL connection this
# process makes, instead of OpenSSL's strict PEM-based checks against
# certifi's bundle. Needed on Windows machines where an HTTPS-scanning
# antivirus feature installs a root CA that Windows trusts but OpenSSL 3.x's
# stricter X.509 parsing rejects (e.g. "Basic Constraints of CA cert not
# marked critical") — real failure mode hit during this project's own live
# call testing. Must run before any LLM SDK opens a connection.
truststore.inject_into_ssl()


@dataclass
class LLMResponse:
    text: str
    input_tokens: int
    output_tokens: int


def _call_anthropic(prompt: str, model: str) -> LLMResponse:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not set. This project does not ship or share an API key — "
            "set your own ANTHROPIC_API_KEY (from console.anthropic.com), or use --llm-provider gemini."
        )
    import anthropic  # imported after the key check, so a missing key doesn't require the SDK installed

    client = anthropic.Anthropic()
    response = client.messages.create(model=model, max_tokens=2048, messages=[{"role": "user", "content": prompt}])
    return LLMResponse(
        text=response.content[0].text,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )


def _call_gemini(prompt: str, model: str) -> LLMResponse:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. This project does not ship or share an API key — "
            "set your own key (from aistudio.google.com/apikey)."
        )
    from google import genai  # imported after the key check — see _call_anthropic

    client = genai.Client(api_key=api_key)
    interaction = client.interactions.create(model=model, input=prompt)
    return LLMResponse(
        text=interaction.output_text,
        input_tokens=interaction.usage.total_input_tokens,
        output_tokens=interaction.usage.total_output_tokens,
    )


# Anthropic is implemented (_call_anthropic above) but deliberately not
# registered here yet — unlike the Gemini path, it has never been exercised
# against a real API call in this project, only its error handling. Add
# "anthropic": {"call": _call_anthropic, "default_model": "claude-sonnet-5"}
# back once that's actually been verified end-to-end.
PROVIDERS = {
    "gemini": {"call": _call_gemini, "default_model": "gemini-3.6-flash"},
}


def call_llm(prompt: str, provider: str, model: str | None = None) -> LLMResponse:
    if provider not in PROVIDERS:
        raise ValueError(f"Unknown LLM provider {provider!r}. Choose from: {', '.join(sorted(PROVIDERS))}")
    entry = PROVIDERS[provider]
    return entry["call"](prompt, model or entry["default_model"])
