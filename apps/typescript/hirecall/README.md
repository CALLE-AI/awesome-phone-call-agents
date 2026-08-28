# HireCall

Recruiter screening desk for internship / junior hiring. Upload an Excel of candidates, Gemini writes a CALL-E script from each resume, CALL-E dials one person at a time, then Gemini scores the answers before the next queued number is dialed.

Path: `apps/typescript/hirecall`

## For judges (fast path)

You do **not** need an Indian Excel. Use **Judge test** on the home page.

Live ringing is **off by default**. Without `HIRECALL_LIVE_CALLS=true`, Call completes a local dry-run and does not dial.

### Setup

```powershell
cd apps/typescript/hirecall
npm install
copy .env.example .env
```

Put these values in `.env` (never commit this file).

| Key | Default | Needed for |
| --- | --- | --- |
| `HIRECALL_OPERATOR_TOKEN` | empty (APIs return 401) | Unlock the desk. Enter the same value on the home page. Without it, candidate and call APIs refuse anonymous requests. |
| `HIRECALL_LIVE_CALLS` | `false` (no-call dry-run) | Set `true` only to place a real CALL-E call, including Judge test. |
| `CALLE_API_KEY` | empty | Live phone call when live calls are on. |
| `GEMINI_API_KEY` | empty | After hangup (or dry-run complete), Gemini writes 0–10 and the summary. The fake Judge test script is already saved, so Gemini is not used to write the prompt. |

Restart after editing `.env`:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Enter the operator token from `.env` before the roster loads.

### How Judge test works

1. On the home page, open **Judge test**.
2. Name, job role, fake resume, and fake CALL-E prompt are already filled (demo intern Priya Sharma).
3. Type **your** phone with a country code, e.g. `+14155550123`. Sample numbers in the Excel template are reserved fictional NANP `555` numbers, not real lines.
4. Create judge test. A ready batch opens. Click **Call**.
5. **Dry-run (default):** HireCall stores a completed fake result. Your phone does not ring.
6. **Live call:** only if `HIRECALL_LIVE_CALLS=true` and `CALLE_API_KEY` are set. CALL-E speaks the fake script. Gemini is **not** on the phone.
7. **After the call or dry-run ends:** HireCall stores duration, CALL-E or dry-run id, and the answers table. **`GEMINI_API_KEY` is required here** — Gemini reads those answers and writes the score and summary.
8. Open **Screening** on that row to see score, summary, time, duration, and CALL-E id. Leave the page open so it can poll through “Writing summary”.

## Recruiter flow (Excel)

1. Download the template (`public/samples/candidates.sample.xlsx`) or use CSV.
2. Upload it. HireCall keeps the rows, not the file. Each upload is one batch.
3. Set **job role** and **Scoring criteria** (ticks, pass mark). Gemini scores 0–10. You click **Next round** or **Rejected** after you read Screening.
4. **Prepare resume** fetches Drive/HTTP text. Gemini writes `call_prompt` from that resume.
5. **Call** or **Call ready candidates**. One live or dry-run call at a time. Next queued person waits until Gemini has scored the previous screen.
6. **Call again needed** after a completed but unclear screen rewrites the next script. No answer / call-me-later keeps the same script.

### Spreadsheet columns

Required: `name`, `phone` (E.164 with country code), `job_role`.

Optional: `consent` (`yes` / `no`), `resume_link` (public HTTPS Drive or file URL; file stays on Drive). Private, loopback, and plain HTTP links are refused.

## Who talks when

| Step | Who |
| --- | --- |
| Prepare resume (Excel) | Gemini writes the CALL-E script from resume text |
| Judge test create | No Gemini. Fake resume and fake script are already stored |
| Live call | CALL-E speaks the stored script |
| Dry-run call | No CALL-E request. A local completed result is stored |
| After the call | Gemini scores 0–10 and writes the summary from the structured answers |

## Side effects

- Local SQLite at `data/hirecall.db` (gitignored). No S3. Spreadsheet is discarded after import.
- With `HIRECALL_LIVE_CALLS=true` and `CALLE_API_KEY`, Call places a real outbound CALL-E call to the stored number. This consumes CALL-E credit and rings a real phone.
- Resume fetch reads a public HTTPS Drive or file link and stores **text only**. Private, loopback, and HTTP URLs are refused. Redirects are checked the same way before they are followed.
- Phone numbers in samples are reserved fictional NANP numbers (`+14155550123`, `+14155550124`, `+14155550125`). The roster, status popup, screening view, and API responses show phones **masked** (last four digits only). Judge test stores the number you type; it dials that number only when live calls are on.
- `CALLE_BASE_URL` defaults to and accepts only the exact origin `https://api.heycall-e.com`. HTTP, loopback, and other hosts are refused so the production key is not sent there.

## Credentials

Copy `.env.example` to `.env`. Keys stay on the server. Do not commit `.env`. Set `HIRECALL_OPERATOR_TOKEN` and type that same value on the home page. APIs return 401 without it.

## Cancellation

There is **no recurring scheduler**. Nothing runs unattended.

**Deactivate** (or **Deactivate all**) is a soft delete: `active = 0`. Restore from **Inactive** on the dashboard or **Restore Excel** on the batch page. Polling only runs while the batch page is open.

Deactivate stops HireCall from **starting the next** call in that Excel. It does **not** hang up a call that CALL-E already started. That phone may keep ringing.

HireCall has no hang-up or cancel API. The CALL-E SDK does not expose one.

To try to stop a live ringing call:

1. Open the CALL-E dashboard: https://dashboard.heycall-e.com
2. Copy the **CALL-E id** from Screening for that person.
3. Look that id up in the dashboard. Use a stop control there if CALL-E offers one. If they do not, the call may run until it ends on its own.

In **dry-run**, Call never reaches the phone network, so there is nothing to cancel there.

If CALL-E create or poll does not clearly succeed or fail (timeout, 5xx, network), HireCall leaves that person queued or calling and **does not** mark them failed or dial the next number. A definite CALL-E rejection (4xx) can mark that row failed; the rest of the queue still waits until you click Call or Call ready.

HireCall uses a screening result only when the CALL-E snapshot matches this candidate’s script, phone, and metadata and the call completed. Gemini may write a 0–10 score. **Next round** and **Rejected** are saved only when you click them.

The CALL-E idempotency key is a hash of the full create payload (script, phone, schema, metadata including attempt). The same retry keeps the same key. A changed script or phone, or Call again, gets a new key.

## Dry-run / no-call

**Dry-run is the default.** `HIRECALL_LIVE_CALLS` is not `true`, so Call does not create a CALL-E task and does not dial. It stores a completed local result with a `dry-run:` id.

Without `GEMINI_API_KEY`, Excel prepare still saves a local dry-run script, and post-call scoring uses a fallback score instead of a Gemini summary.
