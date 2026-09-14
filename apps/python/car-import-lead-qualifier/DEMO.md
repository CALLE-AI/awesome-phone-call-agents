# Car Import Lead Qualifier three-minute demo

This script leads with evidence rather than architecture. The strongest thing about this
app is not how it is built — it is that it has already called real people, and that two
defects in it were found and fixed because of what those people said. Spend the middle of
the video there.

One real call is placed, to an entrant-owned number that has explicitly agreed to receive
it.

## 0:00–0:25 — The problem

"A vehicle importer collects inquiries all week: a quote form, a calculator page, a
partner referral. Every row is a phone number and a sentence about a car. None of them
says whether the person is ready to buy, still comparing, or already gone. The two leads
worth a specialist's time look exactly like the rest until someone dials."

Show `example_leads.json` on screen. Point at the rows and say: "Nothing here tells you
which one is real."

## 0:25–0:55 — Preview is the default

Run the default mode and let the output speak:

```bash
uv run python -m qualifier.runner --leads example_leads.json
```

1. Point at `"creates_phone_call": false` — "this is what you get by default; the phone
   has not rung."
2. Point at the masked number `+25*******001` and at `"market": "Mozambique / pt-MZ /
   Africa/Maputo"`.
3. Say: "The market came from the number that will actually be dialled, not from a field
   in the file. There is deliberately no `country` key. A mislabelled CRM row cannot cause
   a call in the wrong language or at three in the morning."
4. Point at `within_business_hours` and the `next_local_window`.

Placing a call needs `--execute`, plus a separate `--confirm-lead-consent`, plus a
server-side key, and every lead must already carry `submitted_import_inquiry: true` or the
file will not parse.

## 0:55–1:40 — What real calls already taught

Open [`docs/field-notes.md`](docs/field-notes.md). This is the section that separates this
project from a prototype.

1. Show the runs table: ten executions, six leads, four campaigns, and every route except
   `payment_support` reached live.
2. **The conversion.** "On this call the person confirmed the inquiry, said they were
   ready to buy, gave a twenty-thousand-dollar budget, and corrected the delivery port
   from the one on file to Nacala. The structured result carries the correction instead of
   the stale CRM value. They heard a wrong detail and argued with it — that is the script
   being understood, not just tolerated."
3. **The three defects.** "All three were invisible in a dry run. One question asked two
   things at once, so people confirmed the vehicle and the type was never collected. The
   budget bands had open borders — twenty thousand dollars sat exactly on the line between
   two of them. And the worst: a person answered five questions, the provider said the
   task was incomplete, and routing would have called them a third time. The first two
   lost data; the third would have bothered a person. All three are fixed, and the vehicle
   type fix is verified live: a later call returned `pickup`, not `unknown`."
4. **The provider findings.** "Two reports to CALL-E became three tracked issues: hotline
   availability, a fifteen-second CLI default timeout, and the troubleshooting docs. They
   also confirmed that CALL-E maps a failed result to `DECLINED` even when media was never
   established — which this app had already coded around before the issue existed."

## 1:40–2:25 — One live call

Use an entrant-owned number that has agreed to receive the call. Keep the lead file
private and gitignored.

```bash
export CALLE_API_KEY=...
uv run python -m qualifier.runner --leads my-leads.json \
  --execute --confirm-lead-consent \
  --state-file .state/demo.json --output demo-results.json
```

1. Say the flags out loud as you type them: "`--execute`, and separately
   `--confirm-lead-consent`, because confirming that every lead asked to be contacted is a
   claim the operator makes, not something the app can check."
2. Show the phone ringing, and the disclosure in the opening line: the caller states it is
   an AI assistant before anything else.
3. Let a short stretch of the conversation play — enough to hear one question and one
   answer.

Never show the API key, the unmasked number, or a `call_id`. A call id addresses a record
the provider will return a transcript for.

## 2:25–3:00 — The decision, and the line that matters

Show the result file.

1. Point at `structured_result` and then at `decision` — "seven answers become one action
   the sales team can take: close it, book a specialist, nurture, retry, or stop calling
   this number."
2. Then tell the opt-out story from the field notes: "On one real call the provider
   reported `task_completed: true` at 0.86 confidence — a clean, successful call by every
   signal CALL-E gives you. It still routed to `suppress_number`, because the person said
   they were not the right person and did not continue after the AI disclosure. Opt-out
   signals are evaluated before any commercial signal. A completed call is not permission
   to call again."
3. Close with: "CALL-E does the dialling and the speech. This app decides who may be
   called, when, in which language, and — most importantly — who must not be called
   again."

## Recording checklist

- Use `example_leads.json` for everything except the single live call; its numbers are a
  reserved US test range and an unallocated Mozambican prefix.
- The live call goes to an entrant-owned number with explicit agreement. Say so on camera.
- Never on screen: `CALLE_API_KEY`, an unmasked phone number, a `call_id`, or an
  idempotency key.
- Keep `my-leads.json`, `call-results*.json`, `call-state*.json` and `.state/` out of the
  recording's file tree; all are gitignored for the same reason.
- Place the real call once. If it fails, keep the failure in the video or re-record from
  the top — do not retry silently, since the retry ladder is part of what is being shown.
- Keep the video public on YouTube or Vimeo, and show the GitHub pull-request URL.
- Browser and terminal at 100% zoom; hide notifications, personal tabs, and account email.
