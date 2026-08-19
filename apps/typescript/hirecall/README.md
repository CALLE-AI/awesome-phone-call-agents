# HireCall

Recruiter screening desk for internship / junior hiring. This first slice is the dashboard and spreadsheet import only. It does **not** place phone calls.

## What this step does

- Recruiter uploads an Excel or CSV file
- HireCall reads the rows and **throws the file away**
- SQLite stores only candidate fields: name, phone, consent, resume link
- Dashboard shows the roster plus counts (consented, ready, missing resume)

Calling, ChatGPT questions, and shortlist summaries come later.

## Spreadsheet columns

Required:

- `name`
- `phone`

Optional:

- `consent` — `yes` / `no` (also accepts `y`, `true`, `1`)
- `resume_link` — Google Drive (or other) URL; the file stays on Drive

A sample file is at `public/samples/candidates.sample.csv`.

## Setup

From this folder:

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

SQLite is created at `data/hirecall.db` on first upload. That database file is gitignored.

## Side effects

- Writes candidate rows to a local SQLite file
- Does not upload files to S3
- Does not keep the spreadsheet
- Does not call CALL-E or OpenAI yet
- Does not read resume contents yet

## Credentials

None for this step. No API keys are required.

## Dry-run / preview

Every upload is a data import only. Nothing is dialed.

## Cancellation

Use **Clear roster** on the dashboard to delete imported candidate rows.
