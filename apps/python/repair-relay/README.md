# Repair Relay

Collect repair-appointment availability by phone, then review the recipient's words before accepting an available window. Built for coordinators at repair cafes and small service teams.

**Development prototype.** Local tests use synthetic fixtures. The CALL-E integration has not yet been authenticated or tested against the live service. There is no submitted hackathon entry, booked appointment, or established user-impact claim.

## Try without calling anyone

Requires Python 3.11 or later; no third-party Python packages.

```sh
python relay.py preview examples/case.json
python relay.py evaluate examples/case.json examples/result.json
python -m unittest -v
```

The bundled case uses a fictional US number and is marked synthetic. Live dispatch rejects it even with a matching approval digest. The evaluated result shows Saturday availability with an exact recipient quote; it is explicitly a fabricated demonstration fixture.

## Workflow

1. Prepare a case with the organization, repair, consented US recipient, and candidate windows with UTC offsets.
2. Review `preview` output and the destination in your private case file. Console output masks the phone number; the approval digest binds the complete destination and exact request contents.
3. Set `CALLE_API_KEY` in your process environment using the key from the official CALL-E dashboard. Keep real case files and databases private.
4. With authorization to place this particular call, run `python relay.py send private/case.json --approve DIGEST`.
5. Run `python relay.py refresh DIGEST` to retrieve the result. Inspect the recipient quote and available windows.
6. Record your review using `python relay.py decide DIGEST accept_availability --reason "Reviewed the recipient evidence"`, or use `reject`.

The SQLite database defaults to `relay.sqlite3`; choose another path with the global `--db` option. It contains contact information and transcripts and is excluded from Git. Keep it in a private local directory. The application does not publish or transmit the database.

## Side effects and limits

- `preview`, `evaluate`, and the tests never call CALL-E.
- `send` creates a real outbound call task through `POST /v1/calls`. It is not a simulation. CALL-E account credits may be consumed.
- `refresh` only retrieves an existing task through `GET /v1/calls/{id}`.
- The approval digest prevents sending a changed preview without new review. A unique database record prevents the same request being dispatched twice, including after an ambiguous timeout. This protection is local to that database; retain it across runs.
- An uncertain creation must be reconciled through the provider dashboard. There is deliberately no automatic retry or invented cancellation endpoint. Use the provider's supported controls to stop an active task; this prototype cannot cancel a call.
- Availability collection never authorizes repairs, agrees to prices, or books an appointment. Acceptance records only the coordinator's review of availability.
- Quote matching checks evidence presence, not semantic truth. The human must inspect ambiguity, corrections, and the surrounding conversation. Do not use the result as an autonomous booking signal.
- This version supports one US recipient per case and English calls. Production scheduling, multi-contact intersections, and live-provider validation remain unfinished.
- Use only for routine repair availability. It does not diagnose repairs, provide medical/legal/financial advice, or handle emergencies. No recurring schedules are created.

## Interactive review console

Run `python -m http.server 8766 --bind 127.0.0.1 --directory console/dist` and open http://127.0.0.1:8766. Review the four fictional responses, open their transcripts, accept supported availability, mark follow-ups, and export a coordinator handoff. Session capacity prevents adding more proposals than places. No appointment is booked and this static console cannot place calls. Closing or resetting the tab discards review state; exported handoffs remain on your computer.

An optional CALL-E result import displays a local transcript for manual inspection. Imported responses lack the original case windows and cannot be accepted into the sample session. The console and Python live-call workflow are separate at this stage; there is no automatic database synchronization.

## Attribution and provenance

Original application code was created with OpenAI Codex assistance for the CALL-E hackathon. Significant AI assistance is disclosed here. No claims are made that a person independently wrote all code or that synthetic results came from a real call.

The adapter follows the official [CALL-E API examples](https://github.com/CALLE-AI/call-e-integrations#api), inspected September 12, 2026. CALL-E is a separately operated service with its own terms. No sponsor code or assets are bundled in this application.

## Submission work remaining

Registration and the Devpost draft are in place. Remaining: authenticate CALL-E, verify the real response contract, conduct an authorized test call, connect the end-to-end experience, create the required public contribution PR, record a public demo video, submit through Devpost, and verify submission receipt.
