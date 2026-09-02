# Kanverse Human API

**A goal-driven calling layer that turns phone-only real-world services into structured, callable workflows.**

Kanverse Human API uses CALL-E for individual phone calls while a CallChain orchestration layer manages the overall mission.

## Example

> Find a repair shop that can replace my phone screen tomorrow for under £80.

Human API can work through multiple **authorized** phone targets, evaluate the bounded structured result of each CALL-E interaction, and stop when the user's goal is achieved.

## Flow

Goal → Plan → Human Approval → CALL-E Call → Evaluate → Continue or Stop

## Safety model

Dry Run and Live Mode have deliberately different execution paths.

### Dry Run

- Dry Run is the default.
- It is fully local in the browser.
- Previewing or simulating a Dry Run does **not** contact CALL-E.
- It does not require CALL-E authentication or network access.
- It consumes no CALL-E call credit.

### Live Mode

Live Mode fails closed unless the server is explicitly configured.

The server requires:

- HTTP Basic authentication for every `/api/*` request.
- `HUMAN_API_LIVE_ENABLED=true`.
- Strict E.164 destination validation.
- An explicit destination allowlist in `HUMAN_API_ALLOWED_NUMBERS`.
- `liveIntent: true` for planning and again for each run.
- A fresh one-time, short-lived server approval token before `run_call` can execute.

The browser never receives the CALL-E `plan_id`, `confirm_token`, or real `run_id`. The server keeps those values in memory and exposes only opaque temporary tokens to the client.

Status responses are intentionally bounded and phone-number-redacted. Raw transcripts, raw CALL-E output, and raw phone numbers are not returned to the browser.

Changing execution mode invalidates the current mission/plan. Every real call still requires an explicit **Confirm & Call** action in the UI.

## CALL-E integration

The server uses the official `@call-e/core` MCP client directly:

- `plan_call`
- `run_call`
- `get_call_run`

No request-controlled shell command is constructed or executed.

Authentication reuses the token cache created by:

```bash
calle auth login
```

By default that cache is read from `~/.calle-mcp/cli`. `CALLE_MCP_CACHE_ROOT` and `CALLE_MCP_SERVER_URL` can be used when a different CALL-E setup is required.

If the CLI authentication status reports a full MCP server URL, set the same URL before starting Live Mode. For example:

```powershell
$env:CALLE_MCP_SERVER_URL="https://seleven-mcp-sg.airudder.com/mcp/openagent_oauth"
```

You can confirm the URL used by your authenticated CLI with:

```powershell
calle.cmd auth status
```


## CallChain

If a call does not satisfy the goal, Human API prepares the next authorized target for **new user confirmation**.

If the structured outcome satisfies the goal, the chain stops with **GOAL ACHIEVED**.

If the outcome is ambiguous, Human API stops with **REVIEW NEEDED** rather than continuing automatically.

This separates responsibilities:

**CALL-E handles the call. Human API handles the mission.**

## Running the prototype

Requirements:

- Node.js 18+
- npm
- CALL-E CLI authenticated with `calle auth login` for Live Mode

Install dependencies:

```bash
npm install
```

For Dry Run only, start the server without Live configuration:

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

Dry Run remains local and does not call `/api/plan`, `/api/run`, or `/api/status`.

### Enabling Live Mode locally

Use test-only credentials and explicitly authorize only the phone numbers you intend to call.

PowerShell example:

```powershell
$env:HUMAN_API_USER="demo-user"
$env:HUMAN_API_PASSWORD="replace-with-a-strong-local-password"
$env:HUMAN_API_LIVE_ENABLED="true"
$env:HUMAN_API_ALLOWED_NUMBERS="+442073238000"
npm.cmd start
```

Multiple authorized destinations can be comma-separated:

```powershell
$env:HUMAN_API_ALLOWED_NUMBERS="+441234567890,+442071234567"
```

Do not commit real credentials or secrets to the repository.

## Security notes

This hackathon prototype intentionally uses in-memory approval/run token maps. Restarting the Node process invalidates outstanding tokens.

The server exposes only the minimum result data needed by the orchestration UI: status, a bounded/redacted summary, task-completion boolean, and bounded confidence metadata.

The browser history is rendered with DOM `textContent` rather than interpolating CALL-E result text into HTML.

## Technology

- JavaScript
- HTML / CSS
- Node.js
- Express
- `@call-e/core`
- CALL-E MCP tools

## Project

Created for the CALL-E **Your Code Is Calling** Hackathon.

**Human ↔ Machine ↔ World**
