# CallSuite

CallSuite catches important things an AI phone agent forgets to say after its instructions change.

The demo uses an appointment reminder. Both versions confirm the appointment, but the shorter version forgets the required $25 cancellation fee. CallSuite stops that version before release and clears the corrected version.

## Try the judge demo

Requirements: Node.js 22 or newer and pnpm.

```sh
pnpm install
pnpm demo:serve
```

Open <http://127.0.0.1:4173>, switch between **Broken version** and **Fixed version**, then click **Run safety check**.

This demo:

- needs no API key or phone number;
- places no phone call;
- shows the instruction change that caused the problem;
- checks appointment confirmation and fee disclosure; and
- explains whether to continue or stop in plain language.

`pnpm demo` generates the same standalone dashboard and JSON proof without starting the local server.

## The problem

Phone-agent instructions are production behavior. A small edit such as “keep the reminder concise” can silently remove a required disclosure even when the rest of the call sounds successful.

Ordinary code tests cannot hear that omission. CallSuite turns the business requirements into repeatable checks and gives a clear release decision:

| Example | What happened | Decision |
|---|---|---|
| Broken instructions | Appointment confirmed, fee omitted | Stop |
| Fixed instructions | Appointment confirmed, fee disclosed | Continue |
| Phone service failure | The call never reached the phone | Stop safely without blaming the instructions or recipient |

## What CallSuite does

1. Keeps each CALL-E task as a reviewable text file.
2. Reads reviewed call evidence from a privacy-safe JSON fixture.
3. Checks whether every required fact was communicated.
4. Produces a human-readable dashboard and matching JSON result.
5. Returns a stable result number that a release script can use.

| Result | Meaning | Release action |
|---:|---|---|
| `0` | Every required check passed | Continue |
| `1` | A completed call missed a requirement | Stop and fix the task instructions |
| `2` | The evidence is incomplete or uncertain | Stop for human review |
| `3` | CALL-E, delivery, or the test runner failed | Stop without blaming the workflow or recipient |

The phone call's final status is checked first. A failed or timed-out call can never be reported as a successful test, even if another result field looks positive.

## How it uses CALL-E

The live path imports the official TypeScript package, constructs `CalleClient`, and submits one `createAndWait` request at runtime. Before the client is constructed, CallSuite requires the recipient to match an explicit allowlist. It never retries a call automatically.

The same decision code handles both live CALL-E results and the credential-free replay used in the judge demo. This keeps the safe demo reproducible without replacing the real integration with a mock product path.

The judge demo uses clearly labelled, fictional evidence for the broken, fixed, and phone-service-failure cases. It publishes no real-call outcome, timing, identifier, transcript, or recording.

## Run the complete verification

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm demo
```

The current suite contains 70 tests. It covers the four decisions above, sensitive-data rejection and masking, exact recipient authorization, task selection, one-request execution, the local demo server, and matching dashboard/JSON results.

To inspect one example directly:

```sh
pnpm replay fixtures/broken-omission.sanitized.json \
  --test-case fixtures/cancellation-fee.test-case.json \
  --json \
  --html artifacts/replay.html
```

## Project map

```text
prompts/     broken and fixed CALL-E task instructions
fixtures/    reviewed example evidence and required checks
src/         replay, decision logic, reports, demo, and live CALL-E boundary
test/        credential-free automated tests
docs/        demo script and submission copy
```

The two task versions are:

- `prompts/concise-regression.md`: confirms attendance but omits the fee;
- `prompts/good.md`: confirms attendance and states the fee.

## Optional live-call path

Live mode has a real-world side effect: it places exactly one outbound phone call. Use it only with a phone number you own or have explicit permission to test.

1. Copy `.env.example` to `.env`.
2. Add the CALL-E API key, test phone number, exact allowlist entry, region, and locale.
3. Preview a task without contacting CALL-E:

```sh
pnpm spike:dry-run --variant concise-regression
pnpm spike:dry-run --variant good
```

4. Only after the recipient approves that specific call, run one selected task:

```sh
pnpm spike:live --variant good
```

There is no scheduler, batch mode, or automatic retry. To cancel, do not run the live command; if it has already been submitted, CallSuite waits for CALL-E's terminal result and does not start another request. If submission returns an ambiguous error, do not rerun it until an operator checks CALL-E and confirms that no call was created.

### Workflow boundaries

The included scenario is a fictional appointment reminder that tests a business disclosure. It does not provide medical advice, make a diagnosis, change or cancel an appointment, collect health information, accept legal or financial terms, take payment, or handle emergencies. Do not use CallSuite as an emergency service or as a substitute for medical, legal, or financial professionals.

Every live run handles one pre-approved recipient and one selected task. CallSuite has no recurring schedule, bulk dialer, hidden follow-up, purchase action, or automatic retry.

## Safety and privacy

- Live calls require an exact, explicitly authorized recipient.
- The credential-bearing client is fixed to CALL-E's HTTPS API origin and refuses redirects.
- Replay and the judge demo never load `.env` or create a CALL-E client.
- `.env`, runtime call artifacts, logs, and generated reports are ignored by Git.
- Committed fixtures contain no real phone number, raw transcript, recording URL, call ID, or API credential.
- Provider errors and runtime artifacts mask phone-like values and recording links, including numbers formatted differently from the configured target.
- The fixture loader rejects missing privacy declarations and likely sensitive content.
- Incomplete evidence and delivery failures stop safely without assigning blame.

## Built for the CALL-E hackathon

CallSuite was created during the hackathon submission period. The work includes the CALL-E runtime integration, authorization boundary, repeatable requirement checks, four safe outcomes, standalone reports, interactive judge demo, and 67-test verification suite.

The application code is contributed under this repository's MIT license. It includes no third-party media or bundled private data.
