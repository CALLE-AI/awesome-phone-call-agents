# Safety Reference: Accessible Outing Verifier

This skill initiates phone calls to public venues to verify physical accessibility constraints on behalf of an outing planner. Getting this wrong can cause three kinds of harm: stranding a disabled person at a physical barrier, wasting the time of venue workers, or disclosing sensitive personal information. These rules protect all three parties.

## 1. Explicit Consent to Dial

- **An outing request on disk is not consent to dial.** The agent must halt after identifying the digital gap and obtain explicit confirmation before calling.
- **Never call personal or residential numbers.** This skill is exclusively for verified public and commercial venues.
- **Strictly one call per venue per outing.** Calling repeatedly is a nuisance; a third call yields rushed, unreliable answers.

## 2. Dry Run Is the Default

Every invocation defaults to offline dry-run against fixture data unless `--real` is explicitly provided.
- A dry run opens no network socket, consumes no telephony credits, and dials nobody.
- Setting `AOV_FORCE_DRY_RUN=1` overrides `--real` across the entire process, guaranteeing a safe demonstration environment.

| Flag / Environment | Mode | Outcome |
|---|---|---|
| *(default)* | Dry-Run | Simulates local verification using bundled fixtures. |
| `--real` | Live Telephony | Calls target venue via CALL-E upon interactive confirmation. |
| `AOV_FORCE_DRY_RUN=1` | Force Dry-Run | Refuses to place outbound calls regardless of command-line flags. |

## 3. The Deterministic Demotion Firewall

The most critical safety feature of this skill is the strict demotion of qualified or hedged speech.

When venue staff responds with uncertainty:
- *"I think the lift should be working today..."*
- *"Maintenance usually finishes in the morning, probably fine."*
- *"As far as I know, it's clear."*

Generic conversational AI bots frequently hallucinate confidence, converting these statements into a boolean `true` or a "90% confidence" score. For a power wheelchair user, a 90% guess can result in being stranded in a stairwell or facing physical injury.

**The Rule:** Any `qualified_confirmation` is **strictly demoted to `UNKNOWN`**. If a non-negotiable constraint is `UNKNOWN`, the whole outing is classified as **`NOT FULLY VERIFIED (SAFETY DEMOTION)`**.

## 4. Phone Number Validation & Masking

- Numbers must follow **E.164 format** (`+15555550199`). Country codes are never inferred.
- Numbers are masked in all output logs and reports (e.g. `+1-555-***-0199`).
- Numbers must be validated before initiating any batch verification.

## 5. Privacy & Caller Protection

- The call states only that a customer is planning an upcoming visit and needs to confirm accessibility logistics.
- The patron's personal name, phone number, diagnosis, medical condition, or personal details are never disclosed.
