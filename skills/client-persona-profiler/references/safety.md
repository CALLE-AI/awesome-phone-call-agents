# Safety Reference — client-persona-profiler

## Core Safety Commitments

This skill never places a call, modifies call state, or takes autonomous
action on any persona recommendation.

---

## Identity and Privacy

**One-way hashing**: All caller identity inputs (phone number, `caller_id`)
are SHA-256 hashed before storage. The raw identity never reaches the profile
store, the output card, or any log file.

**No PII in output**: The persona card must not contain raw phone numbers,
email addresses, account identifiers, or personally identifying information.
`validate_profile.py` checks for common PII patterns and fails if any are found.

**Local storage only**: Profiles are stored as JSONL files on the local
filesystem in the directory the operator specifies. No data is sent to a
cloud service, third-party API, or external system by this skill.

---

## Archetype Inference Limits

**Probabilistic labels**: The DISC archetype classification is probabilistic
and advisory only. It must not be used as the sole basis for any adverse
treatment of a customer (refusal of service, pricing discrimination,
escalation to collections, or similar).

**Confidence disclosure**: When the leading DISC dimension does not exceed
the second by the configured margin, the skill returns
`archetype: "Undetermined"` and sets `UNDETERMINED_ARCHETYPE` in `flags`.
This is the correct and honest output when evidence is insufficient.

**Minimum turn count**: The skill requires at least `--min-turns` turns
(default: 4) before emitting an archetype label. Calls shorter than this
threshold set `LOW_TURN_COUNT` in `flags`. Operators should not act on
archetype labels from very short calls.

**Protected attributes out of scope**: The skill must not be used to infer
race, ethnicity, religion, political views, health or disability status,
sexual orientation, or any other sensitive protected attribute from voice
or language. These attributes are explicitly excluded from the DISC marker
library and the playbook design.

---

## Data Retention

**Append-only**: Profile records are append-only. Past interactions are never
overwritten. If a caller disputes their profile or requests deletion, the
operator must delete the profile JSONL file manually.

**Retention limits**: Operators must comply with applicable data-protection
law (e.g. GDPR, CCPA) when retaining caller profiles. The skill does not
enforce a retention limit; the operator is responsible for implementing one.

---

## Consent and Recording

**Call recording consent**: Operators must ensure that callers have consented
to call recording under applicable law (e.g. two-party consent states in the
US, GDPR Article 6 in the EU) before transcripts are processed by this skill.
The skill does not verify consent; this is the operator's responsibility.

---

## Medical, Legal, Financial, and Emergency Content

The skill scans the transcript for a narrow list of sensitive subject-matter
keywords (medical, legal, financial-advice, and emergency terms). When any
match, it sets `REQUIRES_HUMAN_REVIEW` in `flags` and lists the matched
topics in `sensitive_topics`. The scan is a coarse heuristic: it can miss
sensitive content that avoids the keywords and can flag benign calls that
happen to use them. The persona card must be reviewed by a qualified human
before any action is taken on the recommended playbook.

---

## Playbook Authority

The `recommended_playbook` is a strategy suggestion, not an instruction.
The calling agent and operator decide whether and how to apply it. The skill
does not commit the operator to any particular communication approach.
