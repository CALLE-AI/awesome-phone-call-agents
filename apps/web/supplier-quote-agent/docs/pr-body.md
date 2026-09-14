# PR body for `CALLE-AI/awesome-phone-call-agents`

**This is the body of the submission pull request, opened 2026-09-13 against
`CALLE-AI/awesome-phone-call-agents` from a fork** (issue #9). The sections below the
divider are that PR's description verbatim; the sections above it record how the branch
name, target directory and checklist evidence were arrived at, each checked against that
repository's own scripts rather than by eye.

Structure below mirrors that repository's actual
[`.github/pull_request_template.md`](https://github.com/CALLE-AI/awesome-phone-call-agents/blob/main/.github/pull_request_template.md)
as of 8 September 2026 — Summary / Type / Checklist, with their eight checklist items
verbatim.

---

## Naming — verified against their own script

| | Value |
|---|---|
| Branch | `feat/supplier-quote-agent` |
| PR title | `feat(apps): add supplier quote agent` |
| Commit | `feat(apps): add supplier quote agent` |

`apps` is one of the scopes their `docs/git-naming-conventions.md` recommends. Checked
with their validator rather than by eye:

```
$ python3 scripts/check_branch_name.py --branch feat/supplier-quote-agent
Branch name follows docs/git-naming-conventions.md: feat/supplier-quote-agent

$ python3 scripts/check_branch_name.py --branch feature/supplier-quote-agent
Invalid branch name: feature/supplier-quote-agent
Expected <type>/<short-kebab-summary> from docs/git-naming-conventions.md.
Allowed types: feat, fix, docs, chore, refactor, test, ci, build, release, hotfix, spike.
```

`feature/…` — the form originally written into our `SPEC.md` — is rejected. Use `feat/…`.

## Target directory — one decision for the owner

**Recommended: `apps/web/supplier-quote-agent/`.**

Their `CONTRIBUTING.md` asks for `apps/<language-or-runtime>/<app-name>/`. This app is
plain JavaScript on Node with a browser dashboard, not TypeScript; `apps/web/` already
holds their one other JavaScript/Node app (`web/local-atlas`), so it is the honest fit.
`apps/typescript/` — what our `SPEC.md` originally named — would misdescribe the
language. Either passes their validator; the owner may still prefer `apps/typescript/`
for visibility.

Copy the whole of `entries/call-e/` into that directory. Nothing outside `entries/call-e/`
goes into their repository.

## Before opening it

```bash
git config core.hooksPath .githooks          # enables their pre-push branch-name hook
python3 scripts/create_branch.py feat/supplier-quote-agent
# copy entries/call-e/ -> apps/web/supplier-quote-agent/  (exclude node_modules/)
python3 scripts/validate_repository.py
```

Add a row to their `apps/README.md` table:

```markdown
| [`web/supplier-quote-agent`](web/supplier-quote-agent/) | JavaScript / Node | Outbound supplier-quote calls where the agent plans, dials, cancels and re-plans, but approval is structurally unreachable from the tool surface: approve/reject are never registered as tools, refuse any non-owner actor, and cannot be reached through the generic update path. Fake-provider, no-call path by default. |
```

---

# ↓ Everything below is the PR body itself ↓

## Summary

Adds `apps/web/supplier-quote-agent/`, a runnable procurement-call app built on the
CALL-E MCP integration.

An agent can plan a supplier call, dial an approved one, cancel a call in flight, and
re-plan one that failed. It cannot approve a call. Approval is a dashboard button a
person presses, and that is enforced structurally rather than by prompt instruction:

1. `approve_task` / `reject_task` are never added to the tool registry, so tool discovery
   cannot surface them;
2. both refuse any actor but the owner even when called directly on the internal
   `invoke()` chokepoint;
3. the generic `update_task` write path refuses to set those statuses at all.

`place_call` then refuses any task that is not already `approved`, and its refusal names
the remedy: *"Ask the owner to approve it from the dashboard — no tool call can approve a
task."* Re-planning a finished call returns the task to `planned`, never `approved`, so a
second call to the same supplier needs a second human approval.

Both callers — the dashboard's buttons and the agent's tools — go through one endpoint
(`POST /api/invoke`) and one function (`invoke(tool, args, actor)`). Each registered
tool's `execute()` is a single delegating line, so a tool cannot reach the data store
without passing the same guards a button passes. Every invocation, refusals included, is
appended to an activity log with the actor's name.

Calls go through a `CallProvider` adapter. The default `FakeCallProvider` is
deterministic — no network, no real timers, canned outcomes from JSON — so the entire test
suite and the whole demo run with no credentials and place no calls. `CallEProvider` is
the real integration and takes its `fetch` by injection, which is how its request shape
and response parsing are unit-tested against fixtures without opening a socket. It refuses
to dial when `CALLE_API_KEY` is unset.

Node 20+, Express, React, Jest, ESLint. 65 tests across 6 suites; `npm test` and
`npm run lint` both green.

## Type

- [ ] New skill
- [x] New runnable app
- [ ] New workflow plugin
- [ ] New provider adapter
- [ ] New scheduler recipe
- [ ] README awesome-list entry
- [ ] Safety or documentation update
- [ ] Validation or tooling update

## Checklist

- [x] Repository-facing content is written in English.
- [x] Branch name, commit messages, and PR title follow `docs/git-naming-conventions.md`.
- [x] No secrets, tokens, private phone numbers, call recordings, or private transcripts are included.
- [x] Real-world side effects are clearly described.
- [x] Phone numbers are masked in documentation and test fixtures unless they are clearly fictional.
- [x] Recurring workflows include cancellation behavior.
- [x] Runnable code has a dry-run, fake-server, or no-call path by default.
- [x] `python3 scripts/validate_repository.py` passes.

### Evidence for each checklist line

| Line | Evidence |
|---|---|
| English only | No CJK anywhere in the app: `grep -rlP '[\x{3400}-\x{9fff}]'` over every `.js/.jsx/.json/.md/.html` returns nothing. Their validator's `validate_english_only()` also covers `apps/` and passes. |
| Naming conventions | `check_branch_name.py --branch feat/supplier-quote-agent` exits 0 (output above). |
| No secrets | Only environment-variable *names* appear (`CALLE_API_KEY`, `CALLE_BASE_URL`, `CALL_PROVIDER`), never values. The single literal in the tests is `'test-key'`, an obvious fixture passed to an injected `fetch` that never leaves the process. No `.env`, `.pem` or credential file is tracked. |
| Side effects described | `README.md` opens with a "Safety model" table, and has dedicated "Credentials and real calls" and "Cancelling and rolling back" sections. `docs/architecture.md` has "Where a real call could happen" — exactly one function, gated on two environment variables. |
| Fictional phone numbers | Every number in the app is in the NANP block reserved for fiction, `+1-555-0100`…`+1-555-0199`. Full list: `555-0100`, `555-0101`, `555-0102`, `555-0103`, `555-0104`, `555-0123`. |
| Cancellation | There are no recurring or scheduled workflows — no cron, queue or retry daemon; a call happens only on an explicit `place_call` against a human-approved task. For a call already in flight, `cancel_call` aborts it (the fake provider races its pacing against the abort signal, so a call stuck ringing is genuinely interrupted), and `retry_with_plan` rolls a task back to `planned`. **Stated plainly in the README rather than overclaimed: against the real provider `cancel_call` cancels the task, not the phone call** — the Calls API "does not expose an operation for clients to cancel a call after it has been created", so a call already dialing runs to completion. Documented under "Cancelling and rolling back". |
| No-call path by default | `FakeCallProvider` is the default; `CallEProvider` requires `CALL_PROVIDER=calle` **and** `CALLE_API_KEY`. `tests/call-flow.test.js` asserts `process.env.CALLE_API_KEY` is undefined and that `place_call` still succeeds. |
| Validator passes | Run locally against a fresh clone of this repository with the app copied into `apps/web/supplier-quote-agent/`: `Repository validation passed.` (exit 0). The owner should re-run it in their own clone immediately before opening the PR. |

## Safety notes

- **Real-world side effect:** with `CALL_PROVIDER=calle` and a valid `CALLE_API_KEY`,
  `place_call` places a genuine outbound phone call, billed to the CALL-E account behind
  the key. Without both, no call is possible and the provider refuses.
- **No autonomous dialing:** an approval is per-task and does not persist across a retry.
- **State is in memory:** restarting the process is itself a complete rollback.
- **No authentication:** `actor` is a string in the request body. This is a local demo
  app; anything internet-facing would need the owner identity to come from a real session.

## Testing

```bash
npm install
npm test          # 65 passing, 6 suites
npm run lint      # 0 errors
bash verify.sh    # docs present, then test + lint
```

No test opens a socket, sets a real API key, or constructs `CallEProvider` with the real
`fetch`.
