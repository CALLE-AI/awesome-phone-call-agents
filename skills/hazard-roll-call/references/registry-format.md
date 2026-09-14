# Registry CSV format

One row per opted-in person. Header names are case-insensitive. Required: `person_id`, `name`,
`phone`, `consent`.

| Column | Meaning | Rules |
| --- | --- | --- |
| `person_id` | Stable id | Unique; used in idempotency keys and tickets |
| `name` | Name the agent uses | Spoken on the call |
| `phone` | E.164 (`+14155550101`) | Invalid rows are skipped; duplicates collapse to the first row |
| `locale` | BCP 47 hint for CALL-E (`hi-IN`, `es-US`) | Default `en-US`; one locale per person, never mixed |
| `region` | ISO country code for routing (`US`, `IN`) | Inferred from the phone prefix when blank |
| `age` | Years | Feeds the risk score |
| `lives_alone` | `yes`/`no` | +2 risk |
| `has_cooling` | `yes`/`no`/blank | `no` +3, blank +1 (heat and smoke) |
| `medical_risks` | `;`-separated keywords: cardiac, respiratory, copd, dialysis, oxygen, ventilator, dementia, diabetes, insulin, pregnancy, mobility | Weighted; oxygen/ventilator/dialysis/insulin weigh more in `outage-medical` |
| `address`, `lat`, `lng` | For the dashboard map and door-knock list; never sent to CALL-E | Optional |
| `contact_name`, `contact_phone`, `contact_locale` | Emergency contact CALL-E can phone | Contact phone must be E.164 or it is ignored |
| `consent`, `consent_date` | Opt-in record | `consent` must be `yes`/`true`; no consent means no call |
| `notes` | Free text for operators | Not spoken, not sent |
| `scenario` | Dry-run only | Which scripted conversation the fake server plays; ignored live |

Dry-run scenarios: `green`, `yellow`, `red`, `red-confusion`, `caregiver`, `voicemail`, `unreachable`,
`unverified`, `slow-green` (23 s of silence before the first bot word), and for contacts
`contact-commit`, `contact-decline`, `contact-no-answer`, `contact-ems`. The fake server localizes the
person's lines for `hi`, `ta`, `es` and `zh` locales.

Two samples ship: `data/registry.sample.csv` (Phoenix, mixed languages) and
`data/registry.sample.ahmedabad.csv` (Hindi, Tamil and English speakers with Indian coordinates).

Keep real registries out of the repository: name them `data/<something>.private.csv` (git-ignored).
Indian numbers are dialled through CALL-E's international line, so tell registrants which number will
call them.
