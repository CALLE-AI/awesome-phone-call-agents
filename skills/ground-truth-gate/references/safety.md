# Safety

A gated claim places a real phone call to a real person who did not ask to be called. Everything below exists because of that sentence.

## Consent and intent

- A call happens only when the user asked for the answer. Curiosity on the agent's part is not intent. This is enforced, not merely stated: `Claim.user_requested` is required, and `decide()` returns `blocked` without it.
- Every call opens with disclosure, before any question: that the caller is an automated assistant, who it is calling on behalf of, and that the call may be recorded. `build_task()` is the only place a task string is built, so there is no path to an undisclosed call, and `self_test.py` fails if any clause goes missing.
- The caller asks one question, once, and does not broaden it. It leaves no voicemail, never asks for personal data about anyone, and never reads an identifier aloud to establish trust.
- The user sees, before the call is placed, who will be called, the single question that will be asked, and that a real call will happen. No call is placed from a summary the user did not read.
- Never place a gated call inside a loop, a batch sweep, or a scheduled job the user did not explicitly configure for that purpose. One claim, one call.
- Repeating a call because the first attempt returned `unknown` is a new call and needs the same intent. Two attempts is a limit, not a default.
- The called party may refuse to answer. `refused_to_answer` is a normal, successful outcome of the workflow, not an error to retry around.

## Numbers

- Phone numbers are supplied by the user or read from a record the user controls. Never inferred from a business name, a web search, a directory, or a previous unrelated call.
- Numbers must be valid E.164 before use. An invalid number is a blocker to report, never a string to repair by guessing a country code.
- Never guess the country code, the region, or the language. If the destination region is not on the supported list, the pre-check fails closed and the claim stays provisional.
- Mask numbers in every user-facing line, log, and error. `+15****00`, not the full number.

## Credentials

- The API key is read from the environment. It never appears in a task string, a prompt, a metadata field, a log line, a transcript, a commit, or an error message.
- The dry run path needs no credential at all, and it is the default. A missing key produces a printed request body, not a failed call.
- Webhook endpoints must be HTTPS, and a delivery must be verified before it is trusted. CALL-E deliveries are unsigned, so the body alone is never evidence: re-fetch `GET /v1/calls/{id}` and write back from that. An unauthenticated webhook accepted at face value is a way to write a false correction into a record.
- HTTPS alone is not enough. A webhook URL pointing at `localhost`, a private range, or a cloud metadata address makes the call provider fetch something inside a network boundary, so the receiver must be a public endpoint you control. `require_public_https()` refuses those destinations, refuses userinfo in the host, and refuses a bare origin: the path must carry at least 16 characters of unguessable secret, because that secret is the only thing standing in for a signature.
- That check is syntactic by default. `gate.py` opens no sockets, so a hostname that *resolves* into a private range still passes unless the caller supplies a `resolver`. `scripts/place_call.py` is what actually sends the request and should pass one.

## Boundaries the gate does not cross

- Medical, legal, financial, immigration, and emergency questions are treated as logistics only. Confirming that a clinic is in network for a plan is logistics. Interpreting whether a treatment is covered, advisable, or lawful is not, and no phone verdict makes it so.
- The gate never handles a claim whose resolution is time-critical to someone's safety. An emergency is not a claim to triage: a provisional answer plus a call that lands in minutes is the wrong shape for it, and the caller is instructed to end the call if the conversation turns that way.
- The gate never asks the called party for personal data about a third party, and never reads a user's identifiers aloud to establish trust.
- The gate never records a person's words as a commitment. `quoted_answer` is what was said, at one moment, by one person who may be wrong.
- A confirmed verdict is scoped to the moment of the call. `valid_until_note` carries any expiry the person stated. A stale confirmation is treated exactly like stale web text: it re-enters triage.

## Side effects, cancellation, and storage

- Side effects: one outbound phone call per gated claim, plus one correction written into the claim record.
- Cancellation: the user can withdraw a claim before the call is placed, and then no call happens. Once a call is in flight it cannot be recalled, and the user is told that plainly rather than promised a cancel that does not exist.
- Idempotency: the caller sets the idempotency key on the create request and reuses it, with byte-equivalent logical input, when retrying a timeout. `gate.py` builds a body and does not send it, so it sets no key. `scripts/place_call.py` is what actually places the call, and it derives the key from the request body itself (`idempotency_key()`) rather than generating one per invocation, so a retry after a timeout replays the same request instead of dialing the same person twice.
- Exactly-once write back: the terminal webhook's top level event `id` is the key for processing side effects. Recording it before applying a correction is what stops a redelivered event from correcting the same claim twice.
- Storage: the claim record holds the question, the provisional answer, the verdict, the quoted answer, the confidence input, the masked number, and timestamps. It does not hold the API key or the full number.
- Every correction is visible to the user who received the provisional answer. A correction nobody sees did not correct anything.
