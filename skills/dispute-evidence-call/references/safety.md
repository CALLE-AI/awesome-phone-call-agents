# Safety

## Before dialling

- **Explicit intent, every run.** A live call needs the operator's explicit confirmation on that
  run that the person at the number agreed to be called. Nothing carries that confirmation over to
  a later run, and a vague "go ahead" in conversation is not enough.
- **Default to no call.** Preview and dry-run are the defaults. A live call is a separate,
  deliberate command.
- **E.164 only, from the record.** Call only the E.164 number stored on the order, and only when
  it is also on the operator's allowlist. An empty allowlist places no call.
- **Calling hours.** Call only between 08:00 and 21:00 local time at the destination. For a
  country with several time zones, every continental zone must be inside the window. Refuse
  destinations with no calling-hours rule.
- **Fixed script.** The model never writes what the phone says. Compare the task text with the
  template byte for byte before submitting. Never add questions, and never mention banks,
  chargebacks or disputes on the call.
- **No payment data.** The call never asks for card numbers, security codes, one-time codes,
  passwords, bank details or government identifiers. A call where the caller asks for any of them
  is unusable, and the script or provider needs investigating.
- **No duplicate calls.** One call per dispute. Derive the idempotency key from the dispute id,
  keep a local record that the dispute was called, and never retry an ambiguous create
  automatically. Check the provider dashboard before any manual retry.
- **No hidden schedules.** Nothing recurs. A person runs each call on purpose; an unanswered call
  is not redialled automatically.
- **Credentials.** Read the API key from the environment, never print or log it, and send it only
  to the provider's official HTTPS API origins.

## After submission

- **Cancellation.** A submitted call cannot be cancelled through the public CALL-E Developer API.
  Closing the terminal or stopping local polling does not stop the call. Say this before
  submitting, and never claim a call was cancelled.
- **Masking.** Show destinations masked (country code and last four digits) in summaries, logs and
  documents. Mask phone-shaped digit runs in transcript excerpts shown to people.
- **Evidence handling.** A transcript is the customer's personal data. Keep evidence documents
  local and access-controlled, apply a retention policy, and never commit them or paste them into
  shared prompts, issues or chats.
- **Use of results.** Results are advisory evidence for a person to file. A reported `no` stops the
  filing. An ungrounded `yes` is treated as unknown. The call is never used to pressure the
  customer or to ask for the dispute to be withdrawn.

## Boundaries

- **Financial and legal.** This is not legal advice. Dispute rules differ by card network and
  processor, and calling, consent and call-recording rules differ by jurisdiction (for example US
  calling-hour limits and all-party recording consent in some places). Complying with them is the
  operator's responsibility.
- **Fraud claims.** When the customer says the card was stolen or the purchase was not theirs,
  record the `no` and end politely. Never argue, and never ask for card details to "verify".
- **Medical, safety or emergency content.** If the person raises an emergency, a health issue or a
  safety concern, the call ends politely and a person follows up through the appropriate channel.
  This workflow is not for those conversations.
- **Language.** The grounding heuristics are English-only and experimental. Route non-English or
  unclear answers to a person rather than guessing.
