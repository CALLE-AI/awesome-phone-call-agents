# Safety

## Side effects

- Exactly one outbound phone call per `--live` invocation of `scripts/place_verify_call.py`, to the operator-supplied number. Nothing else in this skill places calls.
- No recurring jobs, no scheduler, no daemon, no background retries. A retry is a new, explicit operator decision, and reusing the printed idempotency key prevents accidental double-dialing.
- Local files only: payloads are written to paths the operator names. Nothing is transmitted anywhere except the CALL-E API itself.

## Consent and disclosure

- Every call opens by stating the AI identity and verification purpose together, and announces that the call may be recorded, before any question is asked.
- A respondent who objects to speaking with an automated caller is thanked and released immediately; the refusal is recorded as unverifiable, never as an answer.
- Hold time is capped: wait briefly, then thank and end rather than waiting indefinitely.
- Calls target published organizational lines only, never wireless or personal numbers, and are informational verification, never promotional.
- The operator, a human, authorizes each specific recipient before any live call.

## Data handling

- Phone numbers are masked in console output.
- All sample numbers in this skill are reserved fictional numbers such as +15550101234.
- No credentials are stored by this skill; `CALLE_API_KEY` is read from the environment at call time only.
- The dry-run default and the bundled labeled scenario data mean everything except a live call runs with no credentials, no network, and no side effects.

## Medical, legal, financial, and emergency boundaries

This skill calls healthcare organizations, so these boundaries are load-bearing rather than boilerplate.

**It handles directory logistics only.** It asks whether a listing is current: is this the named practice, are they accepting new patients, do they take a named plan. That is the entire scope.

- **No clinical content, in either direction.** The agent does not provide diagnosis, dosage, treatment or triage, and it does not collect symptoms or a reason for the visit. If asked for patient details such as a name, date of birth, or an insurance member number, it says plainly that it does not have them because this is a directory verification call and not an appointment request, and it never invents one, not even a placeholder. That instruction is pinned by a test.
- **No legal or financial advice.** A plan question is a directory question, not a coverage determination. "Do you accept Example PPO" is not, and must not be presented as, an answer to whether a given person's care will be covered or what it will cost.
- **Never for emergencies.** This places one non-urgent verification call and can reach voicemail, a queue, or nobody. It is not a route to care. Anyone who needs urgent help should contact local emergency services, and in the US the 988 Suicide and Crisis Lifeline handles mental-health crises. Do not use this skill, or any automated caller, as a substitute for that.
- **It does not book, cancel, or change anything.** No appointments, no referrals, no records requests, no callbacks. It asks and it records.
- **It is not an authority.** A verified listing means one respondent said one thing on one day, with the exact words retained. It does not establish that a person will be seen, covered, or treated. Everything it emits carries either a transcript span or an explicit abstention so a human can judge it.

### The saved payload

`scripts/poll_result.py` writes the terminal payload to disk, and that file is the most sensitive artifact this skill produces: it contains the recipient's phone number in the clear and a verbatim transcript of a real person who did not choose to be recorded by us.

- It is written **mode 0600**, owner read/write only. The previous default of 0644 left it world-readable on any shared or multi-user machine.
- The mode is enforced on write and re-applied afterwards, so re-running against a path that already exists with loose permissions still ends at 0600.
- Console output is masked, but **the file is not**. Do not paste it into an issue, a chat, or a pull request.

### Retention

This skill deliberately has no retention policy of its own, because it does not know what regime the operator is under. What it does instead:

- It never sends the payload anywhere except back to the CALL-E API it came from.
- It prints a reminder on save that the file holds a real person's number and words, and should be deleted once the verification is recorded.
- Delete with `rm result.json` when done. Nothing in the workflow needs the raw payload after `extract_answer.py` has produced the span-grounded record.

Operators subject to a records regime should keep the derived record, which carries the span and the verdict, rather than the raw transcript, and should set their own retention window for anything they choose to keep.

## Honest failure modes

- If the call yields no usable answer, the output is an explicit abstention. The skill never converts silence, hedging, refusal, or a wrong number into a confident value.
- Calibration reports its coverage on held-out data; operators should re-calibrate on their own labeled scenarios before relying on the threshold in a new domain.
