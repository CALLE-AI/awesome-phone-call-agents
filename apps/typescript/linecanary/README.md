# LineCanary

**Synthetic monitoring and CI regression testing for business phone lines and deployed voice agents.**

Your phone line is your front door — and when an IVR menu or an AI receptionist silently breaks, nobody notices until customers stop getting through. Websites solved this decades ago with uptime monitoring; phone lines never got their Pingdom.

LineCanary places scheduled [CALL-E](https://heycall-e.com) calls to lines **you own**, walks the caller journey like a real customer, asserts the structured results against your expectations, diffs them against the line's own historical baseline, and alerts the moment something regresses. The same checks run as a GitHub Action, turning "did the voice-agent deploy break the phone?" into a CI gate.

```
LineCanary live @ 2026-08-03 — ATTENTION
  ✗  ivr-billing-path (clinic-main +••••••00): fail, answered in 11s
       billing_option: expected "3", got "5"
  regressions:
    [new_failure] ivr-billing-path: billing_option: expected "3", got "5"
    [assertion_regressed] ivr-billing-path: billing_option: expected "3", got "5" (passed 2026-08-02)
```

## How it works

1. **Describe checks as code.** `linecanary.config.json` lives in your repo: which lines, what the test caller should do, what the structured result must look like, how fast the line must answer.
2. **Verify ownership.** LineCanary refuses to call a line until you prove control of it — put a short code in the line's greeting and run `linecanary verify`; or record a written attestation for client lines. Compliance is a gate, not a footnote.
3. **Run on your schedule — inside your window.** Cron or GitHub Actions owns recurrence; each invocation places at most one call per check, and only inside your configured `callWindow`. Every call opens with an AI disclosure.
4. **Assert, baseline, diff.** Deterministic assertions on the schema-validated result (`equals`/`contains`/`matches`/`oneOf`/`exists`), timing bounds from transcript offsets, confidence floors — then regression detection against the line's own history (new failures, regressed assertions, answer-time blowouts, confidence drops, recoveries).
5. **Get paged with substance.** Console + exit codes for CI, Slack webhook for humans. Alerts name the check, the assertion and the delta — never full phone numbers.
6. **Start from a phone call, not a blank config.** `linecanary discover <line> --live` places one mapping call (only on a line you have already verified); AI listens to the whole journey and drafts your checks in config format — review, merge, monitor.
7. **See it, share it.** `linecanary serve` renders the operator dashboard — line health, answer-time trends, regression events, and the full timed transcript of what the canary heard on every call. `/status/<line-id>` (or `linecanary status --html --line <id>`) renders a public, client-safe status page **per line** — uptime percentage included, no tasks, no transcripts, no numbers, and never another client's lines. `/check/<id>` is the call log: every stored call browsable with its full transcript.

## Quickstart

```bash
npm ci                                  # installs the pinned, integrity-checked dependency tree
npx tsx src/cli.ts init                 # writes linecanary.config.json + prints your next steps
# edit lines + checks, record each line's code in its own greeting (e.g. "Canary ID, L C 7 3 9 1")
export CALLE_API_KEY=calle_live_…
npx tsx src/cli.ts verify main-office --live   # one call listens for the code — proves you control the line
npx tsx src/cli.ts run                  # dry-run: prints the plan, calls nothing
npx tsx src/cli.ts run --live           # places the calls, writes baselines
npx tsx src/cli.ts serve                # dashboard at http://127.0.0.1:4477
npx tsx src/cli.ts status --html status.html --title "Main line"  # public status page
npx tsx src/cli.ts explain ivr-billing-branch   # AI incident note (needs ANTHROPIC_API_KEY)
npx tsx src/cli.ts discover main-office --live  # one call maps the line, AI drafts your checks
```

A live run where every check is skipped as unverified exits `1` (fail-closed); runs outside the configured `callWindow` stay green, because the next in-window run catches up.

No CALL-E account yet? `npm run demo` runs the whole loop — healthy day, silent IVR breakage, regression alert — against a local fake server with zero network and zero calls.

## Config reference

```jsonc
{
  "lines": [{
    "id": "main-office",
    "phone": "+15550100",              // E.164 only
    "region": "US", "locale": "en-US",
    "ownership": { "method": "greeting_code", "code": "LC-7391" }
    // or { "method": "attestation", "statement": "Authorized under MSA …" }
  }],
  "checks": [{
    "id": "reception-hours",
    "line": "main-office",
    "task": "Ask what the Saturday opening hours are. Record the answer.",
    "resultSchema": {                   // strict JSON Schema, validated by CALL-E on the call
      "type": "object",
      "properties": { "answered": { "type": "boolean" }, "hours_answer": { "type": "string" } },
      "required": ["answered"],
      "additionalProperties": false
    },
    "assert": [
      { "path": "answered", "equals": true },
      { "path": "hours_answer", "matches": "saturday|weekend" }   // case-insensitive
    ],
    "timing": { "maxSecondsToAnswer": 20 },
    "minConfidence": 0.6
  }],
  "alerts": { "slackWebhookUrl": "env:LINECANARY_SLACK_WEBHOOK" },
  "baselineDir": "baselines",
  "callWindow": { "timezone": "America/Los_Angeles", "start": "08:00", "end": "20:00", "days": [1,2,3,4,5] },
  "historyLimit": 200
}
```

`callWindow` is a hard guard: outside it, live runs place no calls (skipped as `outside-call-window`) — your monitoring never becomes a 3 a.m. nuisance call. `historyLimit` controls stored runs per check (default 200 ≈ four days at 30-minute cadence).

Exit codes: `0` all good · `1` regressions or check failures · `2` the run itself broke (config, credentials, API). Baselines are plain JSON under `baselineDir` — commit them, cache them in Actions, or mount them on a volume.

## CI and scheduled monitoring

`action.yml` packages the CLI as a composite GitHub Action; `examples/github-workflow.example.yml` shows both jobs — cron-scheduled monitoring with baselines in the Actions cache, and a post-deploy smoke gate (`only: <check-id>`) for voice-agent releases.

## Design principles

- **Dry-run is the default.** `run` without `--live` prints the plan and calls nothing.
- **The host owns recurrence.** No internal scheduler, no self-retry: one invocation, at most one call per check, idempotency-keyed against double-fires.
- **Transcripts are data, never instructions.** Everything a callee says is compared against expectations, not obeyed. See [docs/threat-model.md](docs/threat-model.md).
- **Own lines only.** Ownership verification is enforced in the runner, and every call self-identifies as an automated test call. See [docs/compliance.md](docs/compliance.md).
- **No framework, two dependencies.** `@call-e/calle` for calls and `@anthropic-ai/sdk` for the optional `explain` analysis (loaded lazily — never touched unless you use it); tests drive the real SDKs against fakes.
- **Regressions get explained, not just reported.** `linecanary explain <check>` runs a two-model pipeline — a fast model digests the call transcripts, a frontier model writes the incident note: what broke, the evidence, the likely layer at fault, next steps. Transcripts stay inside data tags end to end.

## Prior art and scope

Enterprise call-assurance suites (Cyara, Hammer/VistaCX, Klearcom) do outside-in test calling for large contact centers on enterprise contracts. Voice-AI eval platforms (simulation testing, log-based observability) test agents pre-deploy or analyze production traffic from the inside. The CALL-E ecosystem's `n8n` examples include a one-shot IVR quality probe. LineCanary's slice is deliberately different: **continuous black-box monitoring over the real phone network, cross-platform (any IVR, any voice-agent vendor), defined as code in your repo, with baseline-diff alerting and a CI gate, self-serve and priced for teams managing a handful of lines** — the shape a solo agency or small business can actually adopt.

| Path | Responsibility |
| --- | --- |
| `src/` | config, CALL-E port, assertion engine, baseline diff, runner, alerts, dashboard + status pages, CLI |
| `fake/` | local fake CALL-E API server (loopback only, no credentials, no calls) |
| `test/` | unit + e2e tests, real SDK against the fake server |
| `demo/` | `npm run demo` — pass → silent breakage → regression alert |
| `examples/` | config + GitHub workflow examples |
| `docs/` | [threat model](docs/threat-model.md) · [compliance](docs/compliance.md) |
