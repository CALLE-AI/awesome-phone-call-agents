# ConfirmCall Day Board

Front-desk day board for clinics, tutors, and service shops. Import a day's appointments, preview one disclosed CALL-E confirmation script per booking, run confirmations (fixture by default), and capture **yes / no / reschedule** — without writing the calendar.

Companion skill: [`skills/confirmcall-day-board`](../../../skills/confirmcall-day-board/).

## Problem

No-shows burn staff time. Calling every booking by hand does not scale. ConfirmCall runs a structured confirmation pass and leaves diary changes to a human.

## Safety

- **Fixture by default** — `npm run fixture` never dials.
- **Preview before live** — `npm run preview` prints scripts with masked numbers.
- **Live refused without key** — `npm run live` exits unless `CALLE_API_KEY` is set, and this minimal demo still does not auto-dial (points you at CALL-E CLI / full app).
- **Consent required** per appointment.
- **No calendar writes.**

## Setup

```bash
cd apps/typescript/confirmcall-day-board
npm install
```

Sample board: `skills/confirmcall-day-board/assets/sample-day-board.json` (fictional numbers).

## Usage

```bash
npm run preview   # print CALL-E scripts
npm run fixture   # Maya confirmed, Jordan reschedule, Eli declined
```

## Full product

The full Next.js ConfirmCall workbench (CSV import, live `@call-e/calle` client, webhook) lives in Mark Yukhimets' ConfirmCall Origin project from the CALL-E hackathon build. This awesome-repo package is the portable skill + dry-run app for community reuse and Devpost PR submission.
