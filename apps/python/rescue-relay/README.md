# Rescue Relay

**The right help. Together.** · Version 5.6.0

Rescue Relay helps a person reporting an animal in need bring trusted responders together: clarify the outcome, collect availability and price offers, choose a complete plan, approve the selected helpers, and keep the rescue current until a safe outcome is confirmed.

This update preserves IF/THEN/ELSE rescue goals through intake, planning and progress, and corrects CALL-E `call_not_ready` handling. Read [UPGRADE_5_6.md](UPGRADE_5_6.md) for changes, migration instructions and limits. The existing pricing, approval and witnessed-progress workflow remains.

## Start in Demo mode

Requires Python 3.13 for the verified environment. No Node build, API key or model download is needed to try the fictional example. Internet access is needed once to install Python dependencies.

From the app folder (`rescue-relay-app` in the complete kit):

```bash
python -m venv .venv
# macOS / Linux:
source .venv/bin/activate
# Windows PowerShell instead:
# .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python run.py
```

Open **http://127.0.0.1:8000**. Choose **Try the demo** and follow the prompts. This creates fictional contact records and fills an editable report; it does not submit the report for you. The complete written guide is [TUTORIAL.md](TUTORIAL.md).

Public product test: https://rescue-relay.onrender.com — a mock-only Render Free service with no CALL-E or LLM credentials. HTTP Basic protects every route except `/health`; reviewer credentials are supplied privately in the Devpost testing instructions.

For a new installation, copy `.env.example` to `.env` to customise settings. Do not overwrite an existing `.env` or database when upgrading. 5.6.0 adds a default-empty decision-results field, retaining the earlier original-request ledger and provider fields through additive migrations. Back up the stopped database before upgrading.

`APP_ENV=production` fails closed unless both `BASIC_AUTH_USERNAME` and `BASIC_AUTH_PASSWORD` are set. Authentication is enforced before static files, run/transcript reads, or editable-data endpoints. Keep these credentials in environment configuration; they are never returned by the API or included in frontend assets.

## Watch the app

Choose **Walkthrough** in the app’s toolbar, or open `static/tutorial.html` directly after extracting the complete kit. The player includes both videos, chapter navigation and a written guide. The MP4 files also play on their own.

| Media | Location |
| --- | --- |
| Submission demo, less than 3 minutes | `static/media/rescue-relay-demo.mp4` |
| Complete user walkthrough | `static/media/rescue-relay-tutorial.mp4` |
| Captions and actual chapter timestamps | Matching `.srt`, `.vtt`, `.chapters.json` files |
| Start-to-finish instructions | `TUTORIAL.md` |

The short product demonstration was recorded from v5.6 and shows the current **Send → select → Confirm goal → Find help** sequence. The longer tutorial remains a historical v5.4 supplement. Both recordings are caption-led, without voiceover or music. The product demonstration uses real UI actions against an isolated fictional-data API; it is not a mock-up or scripted slide deck. Demo and Live use the same HTML, CSS and JavaScript; live consent, provider status and test-only reply controls differ intentionally.

## What the workflow does

Select an understood goal, then use **Confirm goal** to save it. Only the separate **Find help** action begins information-only inquiries to approved saved contacts. The first complete plan pauses further inquiries. The reporter may keep that offer, ask for another, compare complete plans and explicitly choose one. Selection alone does not book a helper.

**Conditional goals stay whole:** assess first; enable transport only for the positive clinic-necessity result, or feeding for the requested ELSE result. Unknown activates neither branch. Helpers must receive the assessment result before contingent work starts; the reporter records that result without initiating another call.

**Review & approve** shows the selected helpers, tasks and price limits. Approval starts separate confirmation callbacks only to those helpers. Pending replies, incomplete prices and changed terms remain unresolved. Progress and safe closure depend on human-confirmed updates, not timers or inferred arrival.

Conversations and price evidence remain under **Details & history**. Implementation history is further collapsed. The next action and useful outcome stay on the main screen.

## CALL-E integration

`calling.py` implements the REST transport using `httpx`: `POST https://api.heycall-e.com/v1/calls`, then `GET /v1/calls/{id}`. It supplies a single approved destination, a task, a result schema and a stable idempotency key. The original complete body and key are committed before POST, and the returned Calls API ID is saved immediately. It reads nested recipient transcript turns and records provider status. Inquiry and approved-helper callback tasks are separate.

Live configuration requires all of `CALL_MODE=live`, `ENABLE_LIVE_CALLS=true` and a valid `CALLE_API_KEY`, followed by a server restart. Live API access intentionally requires localhost. Demo numbers cannot be used as live destinations. Follow [submission/LIVE_VERIFICATION.md](submission/LIVE_VERIFICATION.md) with your own consenting test participant and keep provider evidence private.

Stop halts subsequent work, not necessarily a call already submitted to CALL-E. A timeout or uncertain provider result pauses the workflow; it does not trigger a replacement call or an invented success. Recover a known ID with GET only. Every unconfirmed create outcome—including `call_not_ready` without a Calls API ID—halts after the first POST for reconciliation and is never replayed automatically. A known-ID `call_not_ready` remains pending and is checked with GET only. Sanitized `error.message` and `error.details.questions` guidance is shown while the bounded private response remains local; `python scripts/diagnose_calle.py` inspects saved operations without making a call. Older missing originals cannot safely be rebuilt. See [UPGRADE_5_6.md](UPGRADE_5_6.md).

Official integration reference: https://github.com/CALLE-AI/call-e-integrations

## Optional language model

The coordinator accepts the pre-approved official OpenAI origin or an exact HTTPS origin explicitly listed in `LLM_ALLOWED_ORIGINS`. The configured base path must end in `/v1`; redirects, insecure remote URLs, hostname lookalikes, embedded URL credentials, query strings and fragments are rejected. A credential-free loopback `/v1` endpoint remains available for local development and never receives the environment key. Blank or rejected settings use the conservative built-in fallback when `LLM_FALLBACK=true`; they are not external AI inference.

Both modes retain the same review and approval boundaries. The model may interpret observations and offers; it does not authorise payments, invent arrivals, diagnose an animal or replace human consent. Source/provenance remains available in technical history.

## Verify and re-record

```bash
python -m pip install -r requirements-dev.txt
python -m playwright install chromium
pytest -q
node --test tests/rescue_flow_ui.test.cjs
python scripts/test_release_browser.py
python scripts/test_v55_browser.py
python scripts/test_v56_browser.py
python scripts/test_v56_provider_browser.py
python scripts/test_player_media.py
python scripts/test_v535_browser.py
python scripts/test_v536_browser.py
python scripts/record_tutorial.py --mode both --quick
```

To render both MP4s, install **ffmpeg and ffprobe** on PATH, then run:

```bash
python scripts/record_tutorial.py --mode both
python scripts/build_walkthrough_data.py
```

The recorder uses a temporary database, forcibly disables live calls and clears model/provider credentials. It types and clicks the visible app. `--mode demo` renders only the submission cut; `--mode full` renders the complete tutorial. See [demo/README.md](demo/README.md) for capture details and constraints.

`CHROMIUM_PATH` may point to an installed Chromium binary. Restricted browser environments can use the existing `BROWSER_HTTP_BRIDGE=1` harness, which forwards the real isolated API but does not validate production browser-origin, storage or CSP enforcement. Default runs navigate the local app normally.

## Publishing and privacy

This is a **single-process, single-workspace prototype**, not a public multi-tenant dispatch service. Keep live usage local and use **one worker**, without hot reload. Do not expose a live-key-enabled server publicly.

A public demo must have a separate, disposable fictional database, `CALL_MODE=mock`, `ENABLE_LIVE_CALLS=false`, no provider or model secrets, and no personal contact or incident data. There is no visitor account isolation; visitors share the demo workspace. Prefer a local judging build when isolation cannot be provided. See [PUBLISHING.md](PUBLISHING.md).

Saved reports, contacts, transcripts and private original provider requests live in SQLite. Original request bodies contain unmasked destinations; keep database backups private. The browser retains the intake draft in session storage when available. Clipboard export falls back to a downloaded text file. Check every export and screenshot before sharing; masked phone display does not make all report content anonymous.

This app is not an emergency service or veterinary advice. It coordinates trusted contacts; it does not guarantee availability, provide diagnosis or authorise treatment.

## Submission pack

[Devpost text](submission/DEVPOST.md) · [PR description](submission/PR_DESCRIPTION.md) · [Catalog entry](submission/CATALOG_ENTRY.md) · [Live verification](submission/LIVE_VERIFICATION.md) · [UI sources](docs/UI_PROVENANCE.md) · [5.6 verification](docs/VERIFICATION_5_6.md) · [Historical 5.4 verification](docs/VERIFICATION.md)

There was no licence file in the supplied project archive. Review the ownership and licensing of your code before public distribution; this release does not invent an author identity or third-party licence grant.
