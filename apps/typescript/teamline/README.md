# TeamLine

> When a conversation works better than a text.

TeamLine is an AI Voice Communication Assistant for Coaches. This focused app demonstrates a two-call CALL-E workflow:

1. **Find something out:** a coach explicitly starts a bounded Athletic Director call that gathers facility facts and returns a structured result.
2. **Human decision:** TeamLine leaves schedule changes and requests with the coach. Nothing is approved automatically.
3. **Pass something along:** only after explicit coach approval, a second call communicates the approved change to a Parent or Guardian and captures attendance, transportation, and follow-up responses.

The included scenario, team, facility, and phone-number examples are fictional. The app is an independently runnable community demo, not a supported CALL-E API or a production team-management system.

## Safe no-call demo

Requirements: Node.js 22 or later.

```bash
cd apps/typescript/teamline
npm install
npm run check
npm test
npm start
```

Open `http://127.0.0.1:3000`. Sandbox mode is the default. It needs no credential, uses deterministic local fixtures, and cannot place a telephone call.

The fixture follows the complete two-step flow. Enter the fictional reserved US number `+1 202-555-0142`, confirm consent, start the Athletic Director fixture, check its result, approve the derived change as the coach, then start and check the Parent fixture.

## Optional live mode

Live mode creates real outbound calls and consumes CALL-E usage. Use only a number whose recipient has agreed to receive each call.

Set the API key in the server process environment; never put it in browser code, a URL, a JSON request, a source file, or a committed `.env` file.

PowerShell:

```powershell
$env:CALLE_MODE = "live"
$env:CALLE_API_KEY = "<PASTE_CALL_E_PROJECT_KEY_LOCALLY>"
npm start
```

Bash:

```bash
export CALLE_MODE=live
export CALLE_API_KEY="<PASTE_CALL_E_PROJECT_KEY_LOCALLY>"
npm start
```

The server accepts only the official `https://api.heycall-e.com` endpoint. The key remains server-side. The browser displays a LIVE CALL-E MODE warning and asks for a second confirmation immediately before each outbound call.

## Call and result behavior

- A call occurs only after the user enters a US number, confirms consent, and selects that role's explicit call button.
- The full number exists in page memory, request-scope server validation, and the provider launch request only. Server workflow state retains the final four digits and a non-public one-way fingerprint used to require the same number for reconciliation; public state never returns the full number, fingerprint, intent key, or provider call identifier.
- The Athletic Director result schema separates confirmed facility facts, unresolved questions, and requests requiring coach review.
- TeamLine cannot reschedule, spend, arrange transportation, or promise staff, equipment, or another commitment.
- The Parent call stays locked until the coach explicitly approves a complete facility result.
- The Parent result independently records attendance, transportation need, and whether coach follow-up is required.
- `Check existing call result` retrieves the same provider call. It never creates or restarts a call, and there is no automatic polling.
- TeamLine assigns and records a server-owned logical intent before provider dispatch. If create times out or returns an ambiguous response, TeamLine treats the intent as potentially accepted and blocks every new start for that role.
- `Reconcile existing call intent` resubmits only that unresolved intent with its original idempotency key. A timeout is never treated as permission to redial or create a fresh intent.
- Provider or retrieval errors never trigger an automatic retry. Reconciliation is a separate, explicit user action and requires the same authorized phone number to be re-entered if it is no longer in page memory.
- `Try the call again` appears only after CALL-E explicitly returns no-answer, voicemail/answering-machine, or no-conversation evidence. It creates one new call only after another explicit confirmation and the 10-second cooldown.
- Duplicate and concurrent starts or result checks are rejected.
- Closing or restarting the local server clears its in-memory demo state. It does not cancel a call already accepted by CALL-E; use the CALL-E dashboard for provider-side call administration.
- The app creates no recurring schedule, so there is no recurring job to cancel.

## Result handling and privacy

The app retains bounded structured fields only. It does not request, display, or store recordings or transcripts. Unknown or incomplete results stay unresolved. A retrieval failure is not treated as no answer, and a provider failure is not treated as a completed conversation.

The server does not log the phone number, API key, request payload, or authorization header. Errors shown to the browser are deliberately generic. This example is limited to ordinary team operations; do not use it for emergencies or for medical, legal, financial, safeguarding, or other sensitive decisions.

## Tests

`npm test` uses only injected fake providers and the deterministic sandbox. Tests verify the complete no-call flow, consent and phone validation, coach authority, separate result schemas, no automatic redial, stable server-owned intent reconciliation after ambiguous creation, explicit no-answer retry, cooldown, duplicate protection, same-call result retrieval, and privacy-minimized public state.

No test requires CALL-E credentials or network access, and no test places a telephone call.

## Demos

- [Functional TeamLine demo](https://teamline-judge-console.netlify.app/teamline/demo)
- [TeamLine demo video](https://youtu.be/2btXyqeA3Wg)
