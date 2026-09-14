# Safety Reference: Accessible Outing Verifier

This skill ships an offline fixture runner and a proposed phone-verification pattern. It does not initiate calls or establish venue safety. A future integration must protect patrons, venue workers and private information using the following operator rules.

## 1. Explicit Consent to Dial

- **An outing request on disk is not consent to dial.** The agent must halt after identifying the digital gap and obtain explicit confirmation before calling.
- **Never call personal or residential numbers.** This skill is exclusively for verified public and commercial venues.
- **Strictly one call per venue per outing.** Calling repeatedly is a nuisance; a third call yields rushed, unreliable answers.

## 2. Dry Run Is the Default

Every supported invocation is offline against fixture data. `--real` is refused; no live adapter or interactive authorization mechanism is implemented.
- A dry run opens no network socket, consumes no telephony credits, and dials nobody.
- `AOV_FORCE_DRY_RUN` is not a supported setting and is not needed by this offline-only helper.

| Flag / Environment | Mode | Outcome |
|---|---|---|
| *(default)* | Dry-Run | Simulates local verification using bundled fixtures. |
| `--real` | Unsupported | Exits without reading a profile or making a call. |

## 3. The Deterministic Demotion Firewall

The most critical safety feature of this skill is the strict demotion of qualified or hedged speech.

When venue staff responds with uncertainty:
- *"I think the lift should be working today..."*
- *"Maintenance usually finishes in the morning, probably fine."*
- *"As far as I know, it's clear."*

Generic conversational AI bots frequently hallucinate confidence, converting these statements into a boolean `true` or a "90% confidence" score. For a power wheelchair user, a 90% guess can result in being stranded in a stairwell or facing physical injury.

**The Demonstrated Rule:** The fixed `qualified_confirmation` example is demoted to `UNKNOWN`. An unknown critical constraint should remain unverified. The helper does not parse arbitrary language, bind live evidence, or guarantee detection of uncertainty; a confirmed label is not proof that an outing is physically safe. Human verification and a backup plan remain necessary.

## 4. Phone Number Validation & Masking

- Numbers must follow **E.164 format** (`+15555550199`). Country codes are never inferred.
- The offline helper masks its phone field. Other profile text is not automatically anonymized; use synthetic data only. A future integration must mask phone-bearing reports and logs.
- Numbers must be validated before initiating any batch verification.

## 5. Privacy & Caller Protection

- The call states only that a customer is planning an upcoming visit and needs to confirm accessibility logistics.
- The patron's personal name, phone number, diagnosis, medical condition, or personal details are never disclosed.
