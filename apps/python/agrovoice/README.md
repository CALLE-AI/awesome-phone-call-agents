AgroVoice — Cocoa Farmer Data-Collection Callback App
A customer/farmer callback app that uses CALL-E to place AI voice calls
to smallholder cocoa farmers, ask a few structured questions (village,
harvest volume, logistics issues), and return the answers as a
schema-validated JSON result — no smartphone or app required on the
farmer's side.
Built for the CALL-E: Your Code Is Calling hackathon.
What it does
Places a CALL-E call to a farmer's phone number, using a natural-language
task and a strict `result_schema` (village, harvest_bags,
logistics_issues, call_outcome).
Polls the call until a terminal status is reached.
Never fabricates data: if `structured_result` is `null` or a field is
empty, the record is stored as-is (flagged, not guessed).
Persists results to a local SQLite database and exports an aggregated
Excel report.
Setup
```bash
pip install requests pandas openpyxl
```
Credential handling
The app reads your CALL-E API key from an environment variable —
never hardcode it:
```bash
# Windows (CMD)
set CALLE_API_KEY=your_key_here
# Windows (PowerShell)
$env:CALLE_API_KEY="your_key_here"
# macOS / Linux
export CALLE_API_KEY="your_key_here"
```
Get a key at https://dashboard.heycall-e.com/account/api-keys.
Side effects
Running this app in "single farmer" or "batch" mode places one or more
real outbound phone calls through CALL-E, which consumes CALL-E
credits and rings the destination number(s). There is no scheduled/
recurring behavior — each run places exactly the calls you explicitly
request, once.
Dry-run / preview behavior
Before entering a phone number, the app always prints the exact task
text and JSON schema that will be sent to CALL-E, so you can review
what the farmer will be asked before any call is placed. There is
currently no automated dry-run mode that skips the real call entirely —
treat any number you enter as a number that will be called.
Cancellation
This app does not create any recurring or scheduled job — there is
nothing to cancel after a run completes. If a single call is stuck in
`queued` for too long, stopping the script (Ctrl+C) does not cancel the
call on CALL-E's side; it only stops local polling.
Sample data
All phone numbers in `demo_numbers.py` are fictional, reserved
numbers (`+1 555 01xx xxx` pattern) and are not real destinations.
Replace them with your own authorized number(s) before running a real
test call.
Files
`agrovoice_pipeline.py` — main app
`demo_numbers.py` — fictional demo phone number list
`sample_farmers.csv` — example CSV format for batch calling
License
MIT
