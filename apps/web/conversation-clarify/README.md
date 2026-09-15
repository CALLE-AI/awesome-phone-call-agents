# Conversation Clarify

**Email's characteristic failure is not silence. It is a reply that looks like an answer
and isn't — and both of you stop looking.**

> **You:** Does Monday or Tuesday work for the kickoff? Stephen can only join Tuesday.
> **Alex:** Yeah, I'll be there.

You have no idea which day. Another email costs two days and may fail the same way.
Thirty seconds of voice ends it, for a few tens of cents — less than the attention already
spent rereading the thread.

Conversation Clarify is a Chrome extension and a small server. It reads the thread you
have open, points at the sentence that did not settle anything, places **one** bounded
CALL-E call to ask that single question, and writes the answer back into the thread
bound to the recipient's own words — or writes nothing at all and tells you why.

Conversation analysts call this *repair* — how speakers detect and fix trouble in speaking,
hearing or understanding. The unusual part is that the trouble happened in writing and the
fix happens in voice.

Not for calling people who cannot be emailed. The recipient obviously has email; you are
mid-thread with them. **The phone is used when email is insufficient, not when it is
impossible.**

> **In a hurry?** [DEMO.md](DEMO.md) runs the whole thing in four commands with no API key,
> no network, and no phone calls — including the case where it refuses to act.

## What it does

0. Puts a **Call-E Clarify** button next to Reply and Forward, and quietly checks each thread
   you open. If something looks unsettled the button says so — *Call-E Clarify · 1*. The
   automatic check runs **rules only**: the model pass costs money and latency on every
   thread opened, almost all of which are fine, so it is reserved for the full check you get
   by clicking.
1. Reads the open Gmail conversation in the browser, expanding any collapsed messages first
   so the whole thread is analysed rather than fragments, then scrolls the exchange in
   question into view. Nothing is fetched; nothing is stored.
2. Detects one of two failures — an agreement that names no option, or a commitment that
   names no date.
3. Finds the recipient's number **in the thread itself**, and shows it masked.
4. Shows you the exact question, the full caller script, and the masked destination.
5. Places one call, but only when you press a button that names the destination.
6. Applies an evidence gate to the result.
7. Drafts a reply into the thread — or refuses, and says which checks failed. The draft
   states what was agreed; the verbatim quote stays in the panel as evidence for you, since
   it inherits speech-recognition quality and the recipient already knows what they said.

Nothing is ever sent on your behalf.

## Quick start — no calls, no API key

The server starts in fixture mode. A fresh checkout **cannot dial anyone.**

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q          # 109 tests, no network
CONVERSATION_CLARIFY_USER="Your Name" .venv/bin/python -m uvicorn app.main:app --port 8000
```

In a second terminal, serve the front end and open the standalone demo:

```bash
cd extension && python3 -m http.server 8777
# open http://127.0.0.1:8777/test/harness.html
```

That page mirrors Gmail's markup and runs the real reader and the real panel with the
`chrome.*` APIs shimmed, so the whole flow can be seen without installing an extension or
having a Gmail account. The panel shows `fixture — no calls`.

To see the refusal path, which matters more than the happy one:

```bash
CONVERSATION_CLARIFY_FIXTURE=voicemail .venv/bin/python -m uvicorn app.main:app --port 8000
```

Available fixtures: `resolved`, `voicemail`, `no_answer`, `unresolved`, `off_menu`.

## Installing the extension

```
chrome://extensions → Developer mode → Load unpacked → select extension/
```

Then click the extension's toolbar icon. The popup shows whether the server is reachable and
**whether it can dial a real phone**, and is where you set the server address, the shared
token, and your name as the caller should say it. Only `mail.google.com` is matched.

A non-loopback server address needs its own permission grant; if Chrome's prompt dismisses
the popup before answering, the settings page opens to finish the grant there.

## Live calling

Live mode is opt-in and refuses to start without its own secret, because an
unauthenticated endpoint that dials real phones is an open relay.

```bash
export CALLE_API_KEY="iams_live_..."
export CONVERSATION_CLARIFY_MODE=live
export CONVERSATION_CLARIFY_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
export CONVERSATION_CLARIFY_USER="Your Name"
.venv/bin/python -m uvicorn app.main:app --port 8000
```

The panel then shows `live — dials real phones` in red, and every proposal warns before
the confirmation box.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CONVERSATION_CLARIFY_MODE` | `fixture` | `fixture` or `live`. |
| `CONVERSATION_CLARIFY_TOKEN` | dev token | Shared secret. Required in live mode. |
| `CONVERSATION_CLARIFY_USER` | — | Your name, spoken on the call. |
| `CONVERSATION_CLARIFY_FIXTURE` | `resolved` | Which recorded outcome to replay. |
| `CONVERSATION_CLARIFY_ORIGINS` | — | Extra CORS origins. Loopback is allowed already. |
| `CALLE_API_KEY` | — | Read by the server only. |
| `DEFAULT_AI_ENV` | — | `GEMINI` or `ANTHROPIC`. Enables the optional model pass. |
| `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` | — | Key for the selected provider. |
| `GEMINI_MODEL_NAME` / `ANTHROPIC_MODEL_NAME` | — | Model id for the selected provider. |

## How CALL-E is used

`calle-ai==0.7.0`, the one-shot Calls API. `calls.create` with a per-finding
`result_schema`, then polled to a terminal state.

**The key never reaches the browser.** The extension holds a secret for *your* server;
your server holds the CALL-E credential. This is CALL-E's own instruction: *"Do not call
the Developer API directly from a browser, public frontend, or untrusted client."* The
origin is pinned — a configurable base URL carrying a bearer token is refused at startup.

**Polling, not webhooks.** CALL-E webhooks carry no signature or secret, and their docs
say to re-fetch before any sensitive side effect. Rather than accept unsigned input that
could trigger a write, the server polls.

**Three schema constraints shaped the result schema**, each confirmed against the live API:

- A `type` is one value. `{"type": ["string", "null"]}` is rejected, as are `oneOf`,
  `anyOf` and `allOf`. Absence is expressed as an empty string, never `null`.
- `summary`, `status`, `transcript`, `call_id` and timing names are reserved.
- A result is all-or-nothing — an unsatisfiable schema yields `structured_result: null`
  for the whole call, so each `required` field can destroy an otherwise usable verdict.
  Only the two closed enums are required here.

**`answered_by` is requested explicitly** because the Calls API has no built-in answering
machine detection. Without it, a voicemail reads as a resolved thread.

## Optional model pass

Detection is rules by default: deterministic, offline, no key, and readable by anyone who
wants to know exactly what fires. A model raises recall on phrasings the rules were never
written for — *"should we ship to everyone at once, or stagger it over the week?"* answered
with *"whatever you think is best"* is caught by the model and missed by the rules.

```bash
export DEFAULT_AI_ENV=GEMINI          # or ANTHROPIC
export GEMINI_API_KEY="..."
export GEMINI_MODEL_NAME="gemini-2.0-flash"   # any current Gemini model id
```

Off unless both are set. `/health` reports `model_pass`, and a finding the model produced is
labelled **found by model** in the panel.

Three things it cannot do, enforced in code rather than asked for in the prompt:

- **It cannot invent evidence.** Every finding must quote a question and a reply that appear
  verbatim in the thread; quotes are checked against the actual messages and a paraphrase is
  discarded. This is the guard against a confident hallucination becoming a proposal to
  telephone a real person.
- **It cannot produce a destination.** Numbers come from the thread or from you, by the same
  path as before. Nothing in the model layer touches a phone number.
- **It cannot place a call.** A model finding reaches the identical approval gate: you see the
  question and the masked destination, and you press the button that names them.

Rules win where both fire. If the provider is unreachable or returns nonsense, the rules
stand alone and the panel says the pass did not run — rather than silently degrading.

## The evidence gate

Before anything is written, all of these must hold: `status == completed`,
`task_completed`, a non-null `structured_result`, `answered_by == human`,
`resolved == yes`, a non-empty answer, a quote that actually appears in what the recipient
said, and an answer that is one of the options offered — matched whole-word and rejected if
it is negated. Otherwise nothing is drafted and you are told which checks failed.

**`completion_confidence` is deliberately ignored.** On four observed calls that never
rang, CALL-E returned confidence of 0.85, 0.9, 0.9 and 0.82 — all labelled `"high"` —
alongside `task_completed: false`. Confidence expresses certainty in the judgement, not
success of the task.

This is the platform's own position too. From CALL-E's engineering blog, 11 September 2026:
*"A connected call is not necessarily a completed task."*

## Safety

- **Numbers come only from the thread or from you.** No lookup, no inference from a name.
  Strict ASCII E.164 validated with `[0-9]`, not `\d`, which also matches Unicode digits.
  A number without a country code is refused, not completed with a guess.
- **Masked everywhere**, recursively: the destination, provider text that may echo a number
  back in a shape we never sent, the thread text a finding quotes, the task preview, and the
  reasons the gate gives for refusing. Findings are masked before they leave, and
  verification masks the thread too, so comparing a returned finding against the thread still
  compares like with like.
- **Explicit intent per call.** The button names the destination and says whether it dials
  for real. A stored setting is not intent. The dial endpoint also requires a one-time token
  issued with the proposal, so it cannot be driven without first fetching what the call
  would be.
- **One in-flight call per question.** The idempotency key is derived from thread content,
  finding, destination and a nonce for the running process; the attempt counter advances
  only after the previous attempt reaches a terminal state, so a retry is possible and a
  double-click is not.
- **Ambiguous outcomes halt.** Only one thing proves no call was placed: CALL-E answering
  and rejecting the request. A timeout, a connection reset, a broken pipe or a 5xx all leave
  it unknown — the submission may have been accepted and the call dialled before the failure
  — so the idempotency claim is held, reconciliation is required, and no fresh key is
  issued. Guessing "failed" there is how the same person gets dialled twice. A call CALL-E hands back from its
  idempotency store, rather than placing a new one, is refused rather than polled — a stale
  outcome reported as a fresh one is worse than an error.
- **The token and the thread go nowhere unencrypted.** The extension sends them over HTTPS,
  or over plain HTTP only to this machine, and refuses to follow a redirect — which would
  re-send both to wherever it pointed.
- **Provider text is masked on the way out**, including the text quoted back inside a
  finding, the task preview, and the reasons the gate gives for refusing. Error responses
  name the kind of failure, never the provider's own message.
- **A call cannot be recalled.** CALL-E offers no cancellation and a call in flight runs
  to completion. Closing the page does not stop it.

## Commands

```bash
.venv/bin/python -m pytest tests/ -q                     # 109 offline tests
.venv/bin/python -m uvicorn app.main:app --port 8000     # fixture mode
```

## Layout

```
DEMO.md                  the four-command walkthrough, with real output
LICENSE
extension/
  manifest.json          MV3; content script on mail.google.com only
  src/extract.js         reads the thread; refuses rather than half-reading
  src/content.js         the panel
  src/background.js      the only thing that talks to the server
  src/options.html|js    server address, token, your name
  test/fixture-gmail.html  offline extractor check
  test/harness.html        standalone demo, no extension needed
server/
  app/detect.py          the two rule detectors
  app/llm.py             optional model pass; discards anything it cannot substantiate
  app/verify.py          re-establishes an untrusted finding against the thread
  app/numbers.py         E.164, extraction, masking
  app/call_task.py       task text and result schemas
  app/caller.py          fixture and live callers
  app/gate.py            the evidence gate
  app/draft.py           the reply
  fixtures/              five recorded outcomes, reserved numbers only
  tests/
  .env.example
```

## Honest limits

- **Detection is rules by default.** They find the two patterns they are written to find and
  will miss an ambiguity phrased unusually. The optional model pass raises recall but is not
  deterministic: run twice, it may not answer twice the same way. Either way the finding is
  a suggestion, and you decide whether to call.
- **Gmail's markup is obfuscated and changes.** The reader has fallbacks at every step and
  refuses rather than returning a half-read thread, but a Gmail change can break it. The
  paste path exists for that.
- **Collapsed messages are expanded automatically** before reading, and the reader waits for
  them to render rather than reading straight after the click — Gmail renders expanded
  messages asynchronously, and reading too early analyses fragments while reporting that the
  thread was expanded, which is worse than not expanding at all. The panel reports how many
  messages were recovered. If the expand control cannot be found, it falls back to warning
  that parts were skipped.
- **Calls to some regions connect intermittently.** Against an Indian mobile, roughly one
  attempt in four connected; the rest were zero-duration timeouts at the carrier. A
  failed call is ordinary here, not an error.
- **Proposals live in memory** and are lost on restart. Deliberate: a half-remembered
  call is worse than a forgotten one.
- **Not every instruction in the task text is honoured.** Numbered steps hold; prose gets
  reordered. CALL-E discloses that it is an AI in its opening turn whatever the task says —
  the correct norm, and the reason the opening withholds the subject line until the right
  person confirms rather than trying to reorder it. See the skill's safety notes.
- **English only.**

## What this is not

- Not an inbox monitor. The automatic check only looks at the thread you currently have
  open, and only with rules — no model, no call, no storage.
- Not an auto-responder. Nothing is sent; you review and send the draft yourself.
- Not a negotiator. The caller cannot agree, commit, or answer on your behalf.
- Not for cold outreach. It calls someone you are already corresponding with, on a number
  they gave you in that correspondence.
- Not a way to chase someone who hasn't replied.

## License

MIT.
