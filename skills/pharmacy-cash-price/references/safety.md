# Safety

The side effect is a telephone ringing at a working pharmacy counter. Everything here
exists to keep that call short, honest, and wanted.

## Disclosure is not optional and not automatic

CALL-E does not announce that it is an AI and exposes no parameter for it. The platform's
terms place the duty on the caller, so the disclosure lives in your task text and nowhere
else. Put it in the first sentence, before the question, and assert it in your tests:

> "This is an automated AI assistant calling on behalf of NAME, and this call is
> recorded."

If asked whether you are a real person, say plainly that you are an AI assistant. Never
imply otherwise.

## Authorization is per destination, not per campaign

Finding a pharmacy's number and being allowed to call it are separate decisions.

- Discovery output is a candidate list for a person to read, never a dial list.
- Live calling reads an explicit allowlist of E.164 numbers. An absent or empty allowlist
  authorizes **nothing**, not everything.
- Validate numbers with strict ASCII: `^\+[1-9][0-9]{7,14}$` using `[0-9]`, never `\d`,
  which in Python also matches Arabic-Indic and fullwidth digits and would dial something
  other than what you read. For `+1`, require exactly eleven digits.

## Do not guess, and do not dial twice

- Derive the idempotency key from the content of the request, never from the attempt or a
  random value, so a crash and a restart reuse the key instead of placing a second call.
- **A rejected request is a fact. A timeout is not.** On a timeout or dropped connection
  the call may already be ringing. Halt and let a person reconcile. Never auto-retry and
  never redial after a no-answer.
- CALL-E has no cancel operation. Every control you have is exercised before dialling: the
  allowlist, a maximum call count, and printing the plan first.

## Content boundaries

This is a retail price question. Keep it inside that.

- No patient, no prescription, no date of birth, no insurance details, in either
  direction. If staff ask, say there is no patient. Never invent an identifier.
- No medical advice, no symptoms, no suggestion to start, stop, or change a medication.
- A price is not a recommendation. Which pharmacy is right for someone, and whether to
  move a prescription, involves clinical and practical factors a price survey cannot see.
- One call per pharmacy per run. Repeated calls to a working counter about the same drug
  are a nuisance regardless of intent.
- Accept a refusal immediately. Do not argue, ask twice, or offer to hold.

## Handling what comes back

- Mask phone numbers everywhere: reports, logs, errors, and any provider payload you
  print. Recursively, because numbers move between fields across API versions.
- Never write real transcripts, recordings, call identifiers, or real phone numbers into a
  repository. Use numbers reserved for fiction in fixtures: NANP `555-0100` to `555-0199`,
  or Ofcom's `+44 1632 960xxx`.
- Pin the API origin by parsing it, not by prefix matching, before attaching the bearer
  token, and disable redirect following so a cross-host 302 cannot carry the credential
  away.

## Recording and consent

Call recording law varies by jurisdiction and several US states require all-party consent.
The disclosure sentence handles notice, but publishing what a named employee said is a
further step. Publish the prices and the pharmacy names, which is an ordinary price
survey; do not publish recordings or identifiable audio of staff who did not agree to it.
