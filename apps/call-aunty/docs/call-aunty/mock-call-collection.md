# Call Aunty mock calls

Fictional phone-survey fixtures for CALL-E dry-run and CI. All names, numbers, and stories are synthetic. Structured answers stay in canonical English even when the spoken script is Bangla, Hindi, Urdu, Tamil, or Telugu.

Live CALL-E spoken-language support is separate from these mock scripts. A Bangla mock transcript does not claim that the live provider can speak Bangla.

## Question bank

`CALL_AUNTY_SURVEY` has a consent gate plus 20 reusable questions (`q01`–`q20`). Contact method (`q19`) is skipped unless follow-up is requested (`q18`).

| Id | Type | Sensitive branch |
| --- | --- | --- |
| consent | boolean | Required. Refusal ends the survey. |
| q01 | single select | Very negative skips “what worked best”, recommend/use-again, and biggest-benefit prompts. |
| q05 | multi select | Skipped after a very negative experience or distress. |
| q06 | free text | Distress language persists `safety_concern_reported`, not a quote. |
| q09–q10 | scale | Skipped after a negative experience or distress. |
| q18–q19 | contact | No follow-up → skip `q19`. Very negative + wants contact → human callback. Never collect a real address. |
| q20 | boolean | Skipped after distress so comments are not marked quotable. |

## Scenarios

| Id | Outcome | What it proves |
| --- | --- | --- |
| `aunty-complete-positive` | completed | Happy-path extraction. |
| `aunty-complete-positive-bn` | completed | Same answers spoken in Bangla. |
| `aunty-declines` | declined | Refusal collects only `consent: false`. |
| `aunty-reschedule` | rescheduled | Callback is not consent. |
| `aunty-skip-question` | completed | `q18 = false` skips `q19`. |
| `aunty-voicemail` | voicemail | No fabricated answers. |
| `aunty-technical-failure` | technical_failure | Resume at `q02`, do not re-ask consent. |
| `aunty-sensitive-distress` | completed | Safety script, stop probing, persist a code. |

## Multilingual scripts

`lib/mock-calls/scripts.ts` has agent frames and question prompts for `en`, `bn`, `hi`, `ur`, `ta`, and `te`. Urdu is RTL.

```ts
import { localizeScenario, getCallAuntyScenario } from "@/lib/mock-calls";

const hindi = localizeScenario(getCallAuntyScenario("aunty-complete-positive"), "hi");
```

`localizeScenario` rewrites agent/system lines. Extracted answers stay canonical (`Very positive`, not `খুব ইতিবাচক`).

## Sensitive-answer branching

`applySurveyAnswer` updates flags and the next askable question:

- **Consent refused** → end survey.
- **Very negative / somewhat negative** → skip recommend questions; acknowledge without arguing.
- **Distress** (severe pain, bleeding, trouble breathing, emergency language, including localized cues) → safety script, skip remaining optional questions, persist `safety_concern_reported`.
- **Skip remaining** (“don’t ask me more”) → stop probing.
- **Contact opt-out** → skip `q19`; do not ask for a phone or email.
- **PII in free text** → redact.

The safety script tells the person to seek in-person care and does not collect more clinical detail.

## Tests

`tests/call-aunty-survey.test.ts` covers consent gating, skip rules, distress branching, and script packs for every app language.
