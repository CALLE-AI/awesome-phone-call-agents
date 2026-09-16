# DIALTONE v1: calling protocol for when the other end is also an AI

Status: experimental draft, version 1. It is proposed as an open convention that inbound and outbound voice-agent vendors could both adopt.

## 1. Problem

Outbound agents like CALL-E increasingly reach inbound voicebots instead of people. Today three things go wrong on those calls:

1. **Wasted turns.** The caller spends a human-paced disclosure, small talk and slow confirmations on a machine, and can get stuck in the other side's script loops.
2. **The wrong register.** If a caller wrongly concludes it is talking to a machine, it drops full disclosure and a humane pace with a real person. This is the costly error.
3. **The accountability gap.** Two models can agree with each other ("Absolutely, that's confirmed!") and both report `task_completed: true`, while no person and no system of record committed to anything.

DIALTONE addresses all three with a detection layer, a spoken handshake, and an attestation gate.

## 2. Roles

| Term | Meaning |
|---|---|
| caller | The outbound agent (here, a CALL-E call task) |
| counterpart | Whatever answers: `human`, `ivr` (a menu or phone tree), or `agent` (a conversational AI) |
| principal | The person on whose behalf the caller acts |

## 3. The handshake

The only channel two voice agents are guaranteed to share is the audio. SIP headers do not survive PSTN hops, and hosted agents cannot be modified mid-call. The handshake is therefore spoken, short, and robust to TTS, then a phone codec, then STT.

**Offer** (caller, appended to its AI disclosure in the first turn):

> Hi, I'm an AI assistant calling on behalf of Jordan Lee. **Dialtone one, code four seven two.**

- `one` is the protocol version.
- The code is a fresh 3-digit nonce per call, spoken as words.

**Acknowledgement** (a DIALTONE-aware counterpart, in its next turn):

> **Dialtone one acknowledged, code four seven two. Automated agent. Human review: no.**

- The nonce must match. An acknowledgement with a wrong or missing nonce is recorded but not trusted.
- `Human review: yes | no | pending` declares whether a person will review the commitment the agent is about to make. The attestation gate reads this field.

**Matching** is tolerant of STT variants: `dial tone 1`, `dial-tone one`, digits or number words, and stray punctuation. See `dialtone/protocol.py` for the regular expressions and `tests/test_core.py` for the cases.

**A human who hears the token** loses about one second. If they repeat it back ("dial tone one? what's that?"), it is not an acknowledgement. The caller explains in one sentence that it is a signal for automated systems.

## 4. Mode switch

| Counterpart | Mode | Caller behaviour |
|---|---|---|
| human | HUMAN | Full disclosure, one question at a time, let them finish, natural pace |
| ivr | MENU | Navigate with DTMF or short spoken options; do not converse with recordings |
| agent | MACHINE | No repeated disclosure or small talk; `field: value` sentences; ask for outcome, confirmation code and `Human review`; hang up when answered |

A MACHINE-mode request and reply look like this:

> **caller:** Request: table booking. Party: 2. Time: Friday 7 PM. Name: Jordan Lee. Flexibility: plus or minus one hour.
> **agent:** Status: confirmed. Code: L T four four seven one. Party: 2. Time: Friday 7 PM. Human review: no.

**When unsure, HUMAN.** The protocol is biased toward the counterpart being human, because treating a person as a machine is worse than wasting a few seconds on a bot.

### How the switch is implemented on CALL-E

CALL-E is a hosted outbound agent. It is steered by task text and returns its transcript after the call, so DIALTONE cannot take over the audio mid-call. Instead:

1. `protocol.compile_task()` compiles the handshake and the three mode rulebooks into the CALL-E `task`. CALL-E's own model performs the in-call switch.
2. After the call, DIALTONE's classifier re-derives the counterpart independently from `transcript_turns[].offset_seconds` and text. It checks whether the switch was justified, and when a live system could have committed to it.
3. The attestation gate re-labels CALL-E's `task_completed`.

Once CALL-E exposes a mid-call hook, the same classifier can run live. It already works on transcript prefixes (`Transcript.window`).

## 5. Detection without cooperation

Most voicebots will not speak DIALTONE. The fallback is a small, interpretable multinomial logistic model over 18 features in four families:

- **timing**: first-greeting delay, response-latency level and regularity. Turn ends are estimated from word count, because CALL-E exposes turn start offsets only.
- **interruption**: barge-in or overlap rate, and backchannels (`mm-hmm`, `yeah`).
- **lexical**: formulaic phrasing, disfluencies and false starts, turn-length mean and variation, echoing the caller's words.
- **structural**: IVR menu markers, "sorry, I didn't get that" rejects, verbatim repeats, DTMF use, and self-disclosure ("virtual assistant").

It abstains (`unknown`) until the counterpart has spoken. It is evaluated at 3, 5, 8 and 15 seconds as well as on the full call. The results, including failures, are in `eval/REPORT.md`.

## 6. Attestation labels

Every call result is re-labelled:

| Label | Meaning | `dialtone_task_completed` |
|---|---|---|
| `human_attested` | A person on the line explicitly confirmed it | follows CALL-E |
| `system_asserted` | A phone system read back a record or reference | follows CALL-E |
| `agent_asserted` | An AI agent said it: an informational answer, or a commitment backed by a verifiable artifact (confirmation code, written confirmation) | follows CALL-E |
| `refused` | A binding commitment (booking, cancellation, refund, payment, reschedule) "confirmed" only by an AI agent, with no artifact, or with an agent that admitted it cannot finalize | **false** |
| `unverified` | Nothing confirmed, CALL-E did not report completion, or the counterpart is uncertain (confidence < 0.6) | **false** |

**Invariant:** the gate can downgrade `task_completed` but never upgrades it. `human_attested` is never granted when the counterpart is uncertain.

## 7. What DIALTONE does not do

- **It is not authentication.** The nonce proves an acknowledgement responds to *this* call. It does not prove who operates the agent. A malicious bot can speak the protocol; it gains nothing, because an agent's word is never promoted to `human_attested`.
- **It does not replace verification.** An `agent_asserted` confirmation code should be re-verified through the business's own channel before anyone relies on it.
- **It does not detect synthetic voices from audio.** It works on the transcript and timing that the calling platform exposes.

## 8. Adoption path for inbound vendors

An inbound voicebot supports DIALTONE v1 by adding three sentences to its system prompt:

1. Acknowledge the token with the nonce.
2. Answer in `field: value` form afterwards.
3. State `Human review` honestly.

The `dialtone` persona in `dialtone/line/vapi.py` is a working example.
