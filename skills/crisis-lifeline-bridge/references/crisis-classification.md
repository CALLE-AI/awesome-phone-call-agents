# Crisis Classification

How the host agent should classify a person's situation before engaging this skill. This is guidance for the calling agent — the skill itself trusts the severity + need the host passes in.

## Severity 1-5

| Severity | Meaning | Action |
| --- | --- | --- |
| 1 | Venting / mild stress | Normal supportive reply. Do not engage this skill. |
| 2 | Ongoing difficulty, coping | Supportive reply, optional gentle resource mention. |
| 3 | Significant distress, some risk | Supportive reply + offer to find real help. |
| 4 | Acute crisis, concrete unmet need | **Engage this skill**: research + verify + refer. |
| 5 | Imminent danger / active self-harm | **Do NOT run verification.** Direct to emergency + national crisis line NOW. |

Severity 5 is an emergency boundary, not a routing case. See `safety-crisis-boundaries.md`.

## Need markers
Classify the concrete need so research targets the right service:

- `housing` — homelessness, eviction, unsafe housing -> shelters, housing intake, 211.
- `food` — food insecurity, hunger -> food banks, pantries, meal programs.
- `dv` — domestic violence, abuse, unsafe partner/home -> DV hotlines, safe shelters, advocates.
- `deportation` — immigration fear, detention, status -> immigration legal aid, know-your-rights orgs.
- `medical` — untreated illness, no access to care -> community clinics, medical assistance (non-emergency).
- `self_harm` — suicidal ideation, self-harm -> national crisis/suicide line first; warmlines.
- `fraud` — financial exploitation, scam victimization -> consumer protection, legal aid, adult protective services.
- `isolation` — severe loneliness, no support system -> warmlines, community/peer support.

A person may present several. Address the most acute, addressable need first.

## Inferring location
Use ONLY location the person or their public profile actually states. If unknown, ask, or fall back to the national line for the stated country. Never infer from locale, IP, timezone, or phone number.

## Output the skill expects
```json
{
  "severity": 4,
  "need": "housing",
  "location": { "country": "US", "region": "CO", "city": "Denver" },
  "person_consented_to_call": false
}
```
`severity >= 4` + a concrete `need` + a resolvable `location` (or a country fallback) is the trigger to research, verify, and refer.
