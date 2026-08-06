# CALL-E CLI Bootstrap

How to resolve and use the `calle` CLI for the verification call. This skill uses the existing CALL-E one-off call workflow — it does not add any CALL-E backend API or new MCP tools.

## Install (once, per host)
```bash
npx -y skills add https://github.com/CALLE-AI/call-e-integrations --skill calle -g
npm install -g @call-e/cli   # if the calle CLI is not already available
```

## Required attribution env
Set these for every invocation:
```bash
export CALLE_SOURCE=skills_sh
export CALLE_INTEGRATION=skills_sh_skill
export CALLE_INTEGRATION_VERSION=0.1.0
```

## Auth
```bash
calle auth login --start-only --no-browser-open   # prints an authorization URL
# user completes browser authorization, then:
calle auth login --no-browser-open                 # finishes the pending login
calle auth status                                  # { usable: true }
```
The token is cached locally (e.g. `~/.calle-mcp/cli/<hash>/token.json`). Never print or embed it.

## The three tools
```bash
calle mcp tools     # must include: plan_call, run_call, get_call_run
```

## Verification-call flow
The canonical pattern passes the operator's request verbatim through `user_input`, then supplies the agency phone number, then runs:
```bash
# 1) PLAN - pass the goal via user_input; do NOT guess the number.
calle mcp call --args-json '{
  "user_input":"Verify this homeless-services intake line is real and in service. Ask intake hours and whether beds are available tonight. You are confirming service details only and represent no one."
}' plan_call --json
# -> returns { plan_id, ready_to_run:false, questions:[{key:"to_phones",...}], display_goal, ... }

# 2) When (and only when) a real, consented, non-sample number is available, provide it:
calle call plan --plan-id <plan_id> --to-phone "+1XXXXXXXXXX" --region US --language en \
  --timezone America/New_York --json
# -> ready_to_run:true

# 3) RUN the planned call, then fetch status:
calle call run --plan-id <plan_id> --json         # places ONE outbound call
calle call status --plan-id <plan_id> --json       # get_call_run: structured result
```

### Response shape (verified live)
`plan_call` returns `plan_id`, `ready_to_run`, `display_goal` (the planner expands a terse goal into a full call script with voicemail / disconnected / suspicious-line fallbacks), `questions[]`, `confirm_summary`, and `expires_at`. `ready_to_run` stays `false` until a real `to_phone` is supplied — so **planning alone never places a call**. This skill uses that as its dry-run gate.

### Timeouts
`tools/call` can be slow to warm on a cold server. Use `--poll-timeout-seconds 120` for plan/run.

## Provider separation
CALL-E places the call. Any recurrence or scheduling belongs to the host — this skill does neither; it performs exactly one verification call per run in `--live` mode.
