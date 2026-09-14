# Working on Withheld

A Next.js + TypeScript app. The core (`src/core`) is plain TypeScript with no
framework imports and is the part worth reading first; the console in `src/app`
is a thin viewer over it.

## The one rule

The person's phone number must never reach CALL-E, the script, or the call.

The number lives in the errand file so the app can *prove* it was never said —
`buildScript` refuses to emit a script containing it, and every leg re-scans the
transcript for it afterwards. If you are tempted to pass it to the provider for
any reason, the answer is no; that is the entire product.

## House rules

- **Fixture replay is the default.** Every test and every CLI command except
  `run --real` must work with no API key and place no calls.
- **Nothing trusts the provider.** CALL-E's `structuredResult`, `taskCompleted`
  and `completionConfidence` are recorded, never used to decide anything. Every
  answer is re-derived from `transcriptTurns` and carries the turn that supports
  it. An answer with no supporting turn is `null`, not a guess.
- **Fail closed.** When the evidence is ambiguous, say so. `outcome_unknown` and
  `window_unconfirmed` are correct answers. Inventing a booking is not.
- **Unattributed turns confirm nothing.** CALL-E labels a turn `unknown` when
  diarisation fails. It can never confirm a window or bind an answer, but it is
  still scanned for leaks.
- **No scheduler.** The app proposes the next leg and stops. Recurrence and
  timers belong to the host.
- **Findings are masked.** A privacy report that quotes the leak is not a report.

## Commands

```
npm test                                              # no network, no key
npx tsc --noEmit                                      # typecheck
npm run withheld -- preview data/errands/clinic-referral.json
npm run withheld -- replay  data/errands/clinic-referral.json
npm run dev                                           # the console
```
