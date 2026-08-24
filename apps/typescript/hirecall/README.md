# HireCall

Recruiter screening desk for internship / junior hiring. Upload an Excel of candidates, Gemini writes a CALL-E script from each resume, CALL-E dials one person at a time, then Gemini scores the answers before the next queued number is dialed.

Path: `apps/typescript/hirecall`

## For judges (fast path)

You do **not** need an Indian Excel. Use **Judge test** on the home page.

### Setup

```powershell
cd apps/typescript/hirecall
npm install
copy .env.example .env
```

Put **both** keys in `.env` (never commit this file). Judge test still needs Gemini for the summary after the call.

| Key | Required for Judge test? | Needed for |
| --- | --- | --- |
| `CALLE_API_KEY` | Yes | Live phone call. Without it, Call does not dial. |
| `GEMINI_API_KEY` | Yes, if you want the Gemini score and summary | After hangup, Gemini writes 0–10 and the summary. The fake script is already saved, so Gemini is not used to write the prompt. Without this key you get a fallback score, not a Gemini summary. |

Restart after editing `.env`:

```powershell
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### How Judge test works

1. On the home page, open **Judge test**.
2. Name, job role, fake resume, and fake CALL-E prompt are already filled (demo intern Priya Sharma).
3. Type **your** phone with a country code, e.g. `+14155550123` or `+14155550123`.
4. Create judge test. A ready batch opens. Click **Call**.
5. **On the call:** CALL-E speaks the fake script. Gemini is **not** on the phone.
6. **After you hang up:** HireCall stores duration, CALL-E id, and the answers table. **`GEMINI_API_KEY` is required here** — Gemini reads those answers and writes the score and summary. Same as a real Excel candidate. Without the key there is no Gemini summary.
7. Open **Screening** on that row to see score, summary, time, duration, and CALL-E id. Leave the page open so it can poll through “Writing summary”.

## Recruiter flow (Excel)

1. Download the template (`public/samples/candidates.sample.xlsx`) or use CSV.
2. Upload it. HireCall keeps the rows, not the file. Each upload is one batch.
3. Set **job role** and **Scoring criteria** (ticks, pass mark, Gemini mark vs you mark).
4. **Prepare resume** fetches Drive/HTTP text. Gemini writes `call_prompt` from that resume.
5. **Call** or **Call ready candidates**. One live call at a time. Next queued person waits until Gemini has scored the previous screen.
6. **Call again needed** after a completed but unclear screen rewrites the next script. No answer / call-me-later keeps the same script.

### Spreadsheet columns

Required: `name`, `phone` (E.164 with country code), `job_role`.

Optional: `consent` (`yes` / `no`), `resume_link` (Drive or HTTP; file stays on Drive).

## Who talks when

| Step | Who |
| --- | --- |
| Prepare resume (Excel) | Gemini writes the CALL-E script from resume text |
| Judge test create | No Gemini. Fake resume and fake script are already stored |
| Live call | CALL-E speaks the stored script |
| After the call | Gemini scores 0–10 and writes the summary from the structured answers |

## Side effects

- Local SQLite at `data/hirecall.db` (gitignored). No S3. Spreadsheet is discarded after import.
- With `CALLE_API_KEY`, Call places a real outbound CALL-E call to the stored number.
- Resume fetch reads a public Drive/HTTP link and stores **text only**.
- Phone numbers in samples are fictional. Judge test dials the number you type.

## Credentials

Copy `.env.example` to `.env`. Keys stay on the server. `CALLE_BASE_URL` defaults to `https://api.heycall-e.com`.

## Cancellation

**Deactivate** (or **Deactivate all**) is a soft delete: `active = 0`. Restore from **Inactive** on the dashboard or **Restore Excel** on the batch page. There is no background daemon; polling only runs while the batch page is open.

## Dry-run / no-call

Without `CALLE_API_KEY`, Call shows an error and does not dial. Without `GEMINI_API_KEY`, Excel prepare still saves a local dry-run script, and post-call scoring uses a fallback score instead of a Gemini summary.
