# Evidence rules

A `MATCH` or `MISMATCH` verdict requires a **verbatim quote from a recipient turn**. This is
checked in `scripts/verdict.py`: the quote you pass as `evidence_span` must appear, character
for character (whitespace and case are normalised), inside one of the recipient's turns. If it
does not, the script forces `UNCLEAR` regardless of what answer you passed.

So: your job is not to decide whether the office accepts the plan. Your job is to find the
sentence where they said so, and copy it exactly. If there is no such sentence, say so by
passing `evidence_span: null`.

## How to extract, per claim

1. Read only the recipient turns (speaker `user`/`recipient`). The bot's turns are the
   questions, not evidence.
2. Find the single turn that most directly answers the claim.
3. If it clearly answers yes or no **about the exact subject of the claim**, set `answer`
   accordingly and set `evidence_span` to the shortest substring of that turn that carries
   the answer. Copy it exactly - do not fix grammar, do not trim mid-word, do not paraphrase.
4. If the recipient hedged, deferred, or answered about something adjacent but not the
   claim's subject, set `answer: "unknown"` and `evidence_span: null`.
5. If the recipient said both yes and no across the call, set `conflicting: true`.

## Worked examples

Claim: "currently accepts the Northline Health plan". Asserted: `true`.

| Recipient said | answer | evidence_span | resulting verdict |
|---|---|---|---|
| "Yes, we take Northline Health, always have." | `yes` | `we take Northline Health` | MATCH |
| "No, we dropped Northline Health in March." | `no` | `we dropped Northline Health in March` | MISMATCH |
| "We take most major commercial plans." | `unknown` | `null` | UNCLEAR - never names Northline Health |
| "I think so? You'd have to check with billing." | `unknown` | `null` | UNCLEAR - hedged |
| "Yes we take it. Actually, I'm not sure, we might have stopped." | - | - | set `conflicting: true` -> UNCLEAR |
| (call went to voicemail, no recipient turns) | - | - | NO_CONTACT (handled automatically) |

## Source role

`source_role` records who answered: `front_desk`, `billing_dept`, `call_center`,
`answering_service`, `voicemail`, `ivr_only`, `unknown`. It does not change the verdict; it is
stored on the attestation so a reviewer knows how much weight to give a `MATCH` from, say, an
after-hours answering service. Use `unknown` if you cannot tell.

## Do not

- do not infer the answer from tone, politeness, or how busy they sounded
- do not combine two turns into one quote
- do not pass a quote from a bot turn
- do not "clean up" the quote - a quote that is not verbatim is worse than no quote, because
  the script will reject it and you will have spent a call for nothing
