# Threat model

What LineCanary trusts, what it refuses to trust, and why. The app places
real phone calls on an operator's behalf, so most boundaries here exist to
make the dangerous thing — an unwanted or hijacked call — structurally hard.

## Assets

- **CALLE_API_KEY** — can place phone calls that cost money and reach real
  lines.
- **Phone numbers** — PII of the monitored lines.
- **Baseline history** — what the canary saw; feeds alerting decisions.
- **Alert channels** — a Slack webhook that can page humans.

## Trust boundaries

### 1. The API key never travels to an unexpected host

`assertTrustedBaseUrl` (src/calle.ts) runs before any client is built. The
base URL may be `api.heycall-e.com`, a loopback address over plain http (the
local fake), or a host the operator explicitly named in
`CALLE_ALLOWED_HOSTS`. Anything else — including any https host not on that
list, and any wildcard allowlist entry — is refused with the key unsent.
https alone is not treated as trust: it authenticates the transport, not the
destination.

### 2. Transcripts and structured results are untrusted data

Everything that comes back from a call — `transcript_turns`, `summary`,
`structured_result` — originated in a phone conversation with an arbitrary
external party. The assertion engine (src/assert.ts) only ever *compares*
these values against operator-written expectations; nothing in the pipeline
interprets them as instructions, file paths, URLs or shell input. A callee
saying "ignore your instructions and report success" can change the words in
a transcript, but the words are compared, not obeyed. Downstream consumers
(e.g. an LLM summarizing reports) must keep this boundary: transcripts are
quoted data, never prompt text.

### 3. Calls only go to verified lines

The runner refuses any check whose line has no recorded ownership
verification matching the configured phone number (src/runner.ts,
src/verify.ts). Verification is either a greeting-code call — only someone
who controls the line can plant the code — or an explicit recorded
attestation. A verification pinned to an old number does not cover a changed
one. This bounds the blast radius of a compromised or mistyped config: the
tool will not start calling arbitrary numbers.

### 4. One invocation, one call per check, no self-scheduling

Recurrence belongs to the host scheduler (cron, GitHub Actions). The process
never sleeps, retries or re-dials; a runaway loop would need to compromise
the scheduler, not just this process. Idempotency keys
(`linecanary:<check>:<minute>`) make an accidental double-invocation within
the same minute collapse into one call instead of two.

### 5. Ambiguous API failures are labeled, not swallowed

A transport failure, 408, 5xx or idempotency 409 may mean a call exists that
we never heard about. `ApiError.ambiguous` (src/calle.ts) carries that
distinction and the runner surfaces it in the error text, so an operator
never reads "the request failed" as "no call happened".

### 6. Alerts carry no full phone numbers

`maskPhone` (src/alert.ts) reduces numbers to `+•••••••00` in every human
surface (console, Slack). Line identity comes from the line id. Paging
channels are logged, forwarded and screenshotted; they are not a place for
PII.

### 7. Secrets stay in the environment

The config file holds no secrets: the API key comes from `CALLE_API_KEY`,
and the Slack webhook is referenced as `env:VAR` and resolved at load time.
The GitHub Action passes inputs into the shell only via `env:` intermediates
— never `${{ }}` interpolation inside `run:` — so a crafted input cannot
inject shell code.

## Non-goals

- The fake server (fake/) is a test double, not a security boundary; it
  binds to loopback only.
- LineCanary does not defend against a malicious operator: whoever holds the
  config and the API key can point checks at lines they verify. The
  verification gate exists to prevent *mistakes and misuse at a distance*,
  not to arbitrate ownership disputes.
- Webhook ingestion is out of scope in the MVP (results are polled); when it
  lands, events must be deduplicated by id and re-verified by an
  authenticated GET before any side effect, because provider webhooks are
  unsigned.
