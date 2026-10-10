# Demo video script (target 2:30, hard cap 3:00)

Record: screen (form + review page) with phone audio on speaker. One take of a real call; edit the ring/wait out.

| t | On screen | Say |
| --- | --- | --- |
| 0:00 | Title card: "Nota Intake — the form is four fields; the phone call is the intake" | "Small law firms lose clients in the intake form. Older clients, people at work, Spanish speakers on an English site — they don't finish it. So we made the form four fields and let the phone do the intake." |
| 0:15 | nota-intake.pages.dev, toggle to Español, pick +52 → shows Español/English; pick +1 → English only with the Spanish note | "Everything the client sees is in English or Spanish. The interview language follows the phone number — CALL-E's region table drives this picker, and it tells you honestly what your number supports." |
| 0:35 | Fill: name, +1 number, email, matter "contract dispute with a vendor", consent, Call me now | "I submit — and my phone rings." |
| 0:45 | Phone answered on speaker; screen stays on the "calling you now" message | (Let the call run ~60s: disclaimer, matter, opposing party "Acme Corp", court date, urgency, best time, email spelled back, consent.) Cut long pauses. |
| 1:50 | /review, click Sync — record flips to *interviewed*, confidence high | "Thirty seconds later the paralegal has this: matter type, summary, the other party's name for the conflict check, the deadline, urgency, confirmed email, consent — and the full transcript." |
| 2:10 | Type "Tuesday Sept 9 at 10 AM", click Schedule reminder call | "One click schedules a reminder call, in the client's language, with its own result schema — confirmed or reschedule request." |
| 2:25 | Terminal: the `call_not_ready` rejection for Spanish on a +1 number | "One limit we hit: CALL-E doesn't do Spanish on US numbers yet. The script is written and wired — it's one row in a JSON file when they turn it on. Until then those callers go to a human, and the form says so." |
| 2:45 | Architecture card (Pages → Functions → CALL-E → webhook → KV → review) | "No servers: Cloudflare Pages, a few Functions, KV, and the CALL-E API. Repo and live link in the description." |

Rules for the take: real call, no re-voicing; keep the disclaimer audible (it's the legal point); show the
opposing_party field on screen — that's the line judges who've worked in a firm will notice.
