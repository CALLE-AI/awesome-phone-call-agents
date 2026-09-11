# PositiveContact Video Runbook

Target length: 2 minutes 45 seconds to 2 minutes 55 seconds. No new live call or call
audio is needed. Record the public verification proof, then use the local fixture for the
one operator action.

## The CALL-E screen question

The current CALL-E account view exposes conversation detail. It does not give this project
a separate summary page. Do not call the conversation-detail screen a summary screen and
do not show it in the video because it can expose private call data.

Use this public section instead:

`https://positive-contact-demo.onrender.com/board#live-verification`

PositiveContact creates those two redacted cards from the structured results returned by
CALL-E. They contain no name, phone number, email, transcript, CALL-E call ID or health
detail. They are also excluded from the 12-contact fictional event and its metrics.

## Before recording

### 1. Check the public page

Open the Render link above and wait for the free instance to wake. Confirm that it shows
two cards. Verification call 2 must say:

- Reached: `Live person`
- Notice heard: `Yes`
- Support asked: `Medical question`
- Safe category: `Powered equipment`
- Timing: `Before outage`
- Provider consent: `Yes`
- Emergency risk: `No`
- PositiveContact route: `Human review`
- `No provider call has been placed`

If any of that is missing, do not record yet. The latest deployment is not live.

### 2. Start a fresh local fixture

Run this in Terminal. It cannot place a phone call.

```bash
cd apps/python/positive-contact
python3 -m venv /tmp/positive-contact-video-venv
/tmp/positive-contact-video-venv/bin/pip install -e ".[dev]"

pc_video_dir=$(mktemp -d /tmp/positive-contact-video.XXXXXX)
/tmp/positive-contact-video-venv/bin/pc run \
  --mode fixture \
  --stop-before-cutoff \
  --db "$pc_video_dir/demo.db"

/tmp/positive-contact-video-venv/bin/pc serve \
  --mode fixture \
  --db "$pc_video_dir/demo.db" \
  --port 8000
```

Leave that Terminal window running, but keep it outside the recorded area.

### 3. Prepare six browser tabs

Put them in this order:

1. `https://positive-contact-demo.onrender.com/board#live-verification`
2. `http://127.0.0.1:8000/review`
3. `http://127.0.0.1:8000/support`
4. `http://127.0.0.1:8000/reports`
5. `https://positive-contact-demo.onrender.com/api/v1/status`
6. `https://github.com/Abhinav0905/CALLE-AI/blob/feat/positive-contact/apps/python/positive-contact/positive_contact/transports/calle.py#L106-L160`

On tab 2, scroll to Walter's card. On tab 3, leave the pending support form visible. On
tab 4, keep the top metric table visible. Use 90% to 100% browser zoom.

Close or hide email, Devpost, CALL-E account pages, `.env`, Terminal and notifications.
Do one silent rehearsal. Then use macOS `Shift-Command-5`, choose **Record Selected
Portion** and capture only the browser. Recording first and adding narration afterward is
usually easier than speaking while clicking.

## Exact shot list and narration

### 0:00-0:15 | What the product does

**Screen:** Start near the top of the Render Contact ladder. Point to the title and event
summary.

**Say:**

> PositiveContact is an outage-care workflow built on CALL-E. A utility warning is not
> successful because a call completed. The job stays open until a live person acknowledges
> the notice, or an operator takes over.

### 0:15-0:55 | Two real CALL-E checks

**Screen:** Scroll to **Redacted live CALL-E verification**. Point to call 1, then move
across the fields and **Next step** on call 2.

**Say:**

> CALL-E's account page gives conversation detail, not a separate summary. This is
> PositiveContact's redacted summary of two calls I authorized to my own phone. It
> publishes no number, name, call ID or transcript. Call one reached me and captured the
> warning acknowledgement, but category, timing and provider permission were incomplete,
> so the app stopped for human review. Call two captured powered-equipment support before
> the outage, provider permission and no emergency risk. It also stays with a person. No
> provider call has been placed.

### 0:55-1:10 | The fictional contact ladder

**Screen:** Scroll below the verification cards. Point to one `CONFIRMED` row, one
`NEEDS HUMAN` row and the voicemail row.

**Say:**

> The lower table is a separate fictional event. Confirmed means transcript evidence shows
> a person acknowledged the warning. Voicemail never counts, and unresolved contacts keep
> moving toward human review or a field visit.

### 1:10-1:37 | Medical-support boundary

**Screen:** Switch to tab 2, **Human review**. Point to Walter's safety boundary and the
four coded fields. Do not click **Confirm contact** or **Record a refusal**.

**Say:**

> This fixture case retains only a coded category, broad timing, provider-contact
> permission and emergency risk. The agent gave no medical advice and stored no diagnosis,
> medicine, dose or equipment model. A person owns the medical-support decision.

### 1:37-2:15 | One operator-approved provider fixture

**Screen:** Switch to tab 3, **Support desk**. Type `demo-op` in **Operator ID**. Choose
**Northbay Equipment Support (demo)**. Tick the one-call authorization. Click **Authorize
provider call** once. Wait for the page to return, then point to the green `COMPLETED`
badge and **Provider result**.

**Say before clicking:**

> The request is pending. I enter my operator ID, choose an approved provider, accept the
> one-call statement and authorize it. This button runs an offline CALL-E-shaped fixture.
> It calls nobody and spends no credit.

**Say after the result appears:**

> The result reports general availability within two hours. No resident identity or
> clinical detail was sent. Nothing was ordered or reserved, so a person still owns the
> next step.

### 2:15-2:34 | Evidence, not call counts

**Screen:** Switch to tab 4, **Evidence report**. Point first to **Positive contact
confirmed**, then **Calls placed** and their denominators.

**Say:**

> The evidence report separates phone activity from successful contact. Each figure has
> its denominator. A completed call alone can never become proof that somebody heard the
> warning.

### 2:34-2:52 | API and runtime code

**Screen:** Show tab 5 for about four seconds. Then show tab 6 and point to the
`/v1/calls` POST and the read-back request.

**Say:**

> The public API exposes safe event status. The live adapter posts to CALL-E with a strict
> result schema and a stable idempotency key, then reads the call back before acting. This
> is the integration behind the dashboard.

### 2:52-2:58 | Close

**Screen:** Return to the completed Support desk result.

**Say:**

> PositiveContact turns one warning call into a tracked, consent-aware workflow, with a
> person controlling every support handoff.

## If something goes wrong

- **The Render verification cards are absent:** stop. Wait for deployment. Do not replace
  them with the private CALL-E conversation page.
- **The provider form is absent:** check that tab 3 starts with `127.0.0.1`, not the Render
  URL. The public demo is intentionally read-only.
- **The provider request already says completed:** the database was reused. Stop the server
  and repeat the fixture setup so `mktemp` creates a new directory.
- **Nothing changes after the click:** wait two seconds, then refresh once. Never click the
  authorization button twice. If the result is still absent, discard the take and start a
  fresh fixture.
- **Any private detail appears:** stop and discard that take.
- **The take exceeds three minutes:** shorten pauses and pointer movement. Do not speed up
  the footage until the text becomes hard to read.

## After recording

Export at 1080p. Upload to YouTube or Vimeo as a public or unlisted video that anyone with
the link can view. Open the link in a signed-out private window and watch it from start to
finish. Only then add the URL to `devpost-submission.md` and the Devpost project form.
