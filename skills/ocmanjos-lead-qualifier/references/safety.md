# Safety

This skill places real outbound phone calls and must be used with care.

## Consent and phone numbers

- Only call phone numbers sourced from an explicit customer enquiry. Do not guess, infer, or reuse numbers from unrelated sources.
- Mask phone numbers in any user-facing summary or log output. Use fictional numbers such as +15550101234 in documentation and examples.
- Respect opt-out signals. If a customer has asked not to be contacted, that must block the call regardless of other qualification criteria.

## Credential handling

- Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY) must be stored in a local .env file, never committed to version control.
- The anon key used here is scoped by Supabase Row Level Security and is safe for client-side use, but should still not be shared publicly.

## Review before calling

- Always review CALL-E's plan_call output (ready_to_run, confirm_summary) before calling run_call. Do not automate run_call without a human review step for a new deployment.
- Each call consumes CALL-E call credits. Test with a small, known set of enquiries before running against a full production dataset.

## Disqualifiers

- Do not call leads marked as already purchased, a known competitor, or opted out. These are hard blocks in the scoring logic and must not be bypassed.

## Data accuracy

- This skill only calls leads where a real price could be matched from the price sheet. It does not call on guessed or estimated values.
- Known limitation: keyword extraction may not correctly price every product variant. Review matched_keyword and estimated_value output before trusting a scoring decision for a new product category.

## Explicit intent and scope

- This skill only initiates a call after a human operator has reviewed the qualifying lead and manually run plan_call and run_call — it does not autonomously trigger calls.
- Only E.164-formatted phone numbers sourced directly from a genuine customer enquiry are authorized destinations. No other number format or source is permitted.
- If the qualification data is ambiguous (missing category match, no price found, unclear enquiry text), the skill returns call: false rather than guessing. Ambiguity always resolves to not calling.
- Cancellation: since run_call has not yet been invoked at the qualification stage, cancellation is simply not running the call. Once a call is placed via CALL-E, this skill has no cancellation capability — that is a CALL-E platform-level constraint, not something this skill can override.
