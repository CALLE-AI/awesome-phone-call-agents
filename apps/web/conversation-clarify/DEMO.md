# Demo — the whole thing in four commands

Every command below runs with **no API key, no network, and no phone calls**. The outputs
shown are the real ones. All numbers are in the reserved fictional `+1 555 01xx` block.

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests/ -q
```

```
109 passed
```

---

## 1 — Start it. It cannot dial anyone.

```bash
CONVERSATION_CLARIFY_USER="Charles Miller" .venv/bin/python -m uvicorn app.main:app --port 8000
```

```bash
curl -s localhost:8000/health
```

```json
{
  "app": "conversation-clarify",
  "mode": "fixture",
  "dials_real_phones": false,
  "model_pass": "off"
}
```

Fixture mode is the default. A fresh checkout has no path to a telephone.

---

## 2 — Give it a thread where the reply looks like an answer

Save this as `thread.json`:

```json
{
  "subject": "Kickoff scheduling",
  "messages": [
    {"sender": "Charles Miller", "from_me": true,
     "body": "Hi Robert — we can start the kickoff on Monday or Tuesday next week. Stephen can only join on Tuesday. Which works for you?"},
    {"sender": "Robert Jones", "from_me": false,
     "body": "Yeah, count me in.\n\nThanks,\nRobert\n\n--\nRobert Jones\nOperations, Northwind Ltd\n+1 555 010 0142"}
  ]
}
```

```bash
curl -s -X POST localhost:8000/v1/analyze \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer local-dev-token' \
  -d @thread.json
```

```json
{
  "counterparty": "Robert Jones",
  "finding": {
    "kind": "unclear_choice",
    "confidence": "high",
    "source": "rules",
    "headline": "They agreed without saying which: Monday or Tuesday",
    "call_question": "Which one did you mean, Monday or Tuesday?"
  },
  "phone_candidates": [
    {"masked": "+15*******42", "dialable": true, "sender": "Robert Jones"}
  ]
}
```

"Yeah, count me in" is grammatically an answer and settles nothing. Note where the number
came from: **Robert's own signature**, in this thread. Nothing was looked up. It comes back
masked, and the full number never leaves the server.

Note also that the options — *Monday or Tuesday* — are in a different sentence from the
question mark, which is how people actually write.

---

## 3 — Propose the call. Still nothing dialled.

```bash
curl -s -X POST localhost:8000/v1/proposals \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer local-dev-token' \
  -d '{"thread": <thread.json>, "finding_index": 0,
       "recipient_name": "Robert Jones", "phone_typed": "+15550100142"}'
```

```json
{
  "destination_masked": "+15*******42",
  "attempt": 1,
  "will_dial_a_real_phone": false,
  "mode": "fixture"
}

idempotency_key: cr-cf0d8ccc-5e58c974a67c8d1f-1-0142-38629c8a-a1
```

The response also carries the full task text the caller will be given, and a one-time
`confirm_token`. The dial endpoint requires that token, so a call cannot be started without
first fetching what it would be.

The key is built from a nonce for this server process, the thread content, which ambiguity
it is, the destination, and a digest of the exact request. Identical request, identical key —
a double-click cannot dial twice. Changed request, different key, because it is a different
call. And a restart changes the nonce, so a retry after one places a new call rather than
replaying the old one.

---

## 4 — Place it, and read the result

```bash
curl -s -X POST localhost:8000/v1/proposals/$ID/call \
  -H 'Content-Type: application/json' -H 'Authorization: Bearer local-dev-token' \
  -d '{"confirm": "'"$TOKEN"'"}'

curl -s localhost:8000/v1/proposals/$ID -H 'Authorization: Bearer local-dev-token'
```

```
state  : resolved
answer : Tuesday
quote  : 'I meant Tuesday.'

draft:
  Hi Robert,

  Thanks for taking the quick call just now. Confirming what we settled: Tuesday.

  Noting it here so it is written down — do correct me if I have it wrong.

  Thanks,
  Charles Miller
```

The quote is evidence **for you** that the answer came from a sentence someone spoke. It is
deliberately not in the draft: the recipient knows what they said, and the quote inherits
speech-recognition quality. On a real call this transcribed as *"Up. 2 page summary
actually."* — correct answer, unusable as a quotation.

---

## The part that matters more — when it refuses

Restart with a different recorded outcome and run exactly the same steps:

```bash
CONVERSATION_CLARIFY_FIXTURE=voicemail .venv/bin/python -m uvicorn app.main:app --port 8000
```

```
state : unresolved
The call did not settle it — nothing has been drafted.
  - CALL-E did not judge the task complete
  - a person did not answer (endpoint: voicemail)
  - the question was not settled (resolved: unknown)
  - the call returned no answer
  - the call returned no verbatim quote to stand behind the answer
```

The thread is untouched. Nothing is drafted, and every failed check is named in plain
language.

Five recorded outcomes are available, each a real payload shape:

| `CONVERSATION_CLARIFY_FIXTURE` | What it exercises |
| --- | --- |
| `resolved` | A person answered and named an option |
| `voicemail` | A machine answered |
| `no_answer` | Modelled on a real zero-duration `408` — the handset never rang |
| `unresolved` | A person answered and did not settle it |
| `off_menu` | Extraction returned "Wednesday" for a Monday/Tuesday question |

`off_menu` is the one worth running. The call "succeeded", a human answered, and a confident
answer came back — and it is still refused, because *Wednesday was never one of the options*.

---

## See the actual interface

```bash
cd ../extension && python3 -m http.server 8777
# open http://127.0.0.1:8777/test/harness.html
```

That page mirrors Gmail's markup and runs the **real** reader and the **real** panel with the
`chrome.*` APIs shimmed — so the whole interface can be seen without installing an extension
or having a Gmail account. The panel shows `fixture — no calls`.

To install it properly: `chrome://extensions` → Developer mode → Load unpacked → `extension/`,
then set the server address and your name in its options. It matches `mail.google.com` only.

---

## Live calling

Everything above ran without a CALL-E key. Live mode is opt-in, refuses to start without its
own shared secret, and pins credential-bearing traffic to the official origin. See
[README.md](README.md#live-calling).
