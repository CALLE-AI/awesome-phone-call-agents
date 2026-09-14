# Real-call plan (8 planned, 6 placed)

> **What actually happened.**
> - **Human calls 1–2 were never dialled.** The consenting participant has a French (+33) number, and CALL-E rejected the task before dialling for both France/English and France/French on this account ("Calls to France in English are not supported right now for this product"). The demo's human channel therefore stays a clearly labelled simulation.
> - **Calls 3–8 went to the Vapi AI line.**
> - **The free CALL-E account runs one call at a time,** so calls were placed strictly in sequence. The runner waits for the line instead of failing.
> - **The first live call changed the task wording.** Its task used prompt revision 1, and CALL-E paraphrased the opening and dropped the DIALTONE token after the voicebot talked over it. Later calls use revision 2, which puts the token requirement first. Each call's `metadata.task_prompt_revision` records which one it used.
> - **That call is not a blind measurement.** It surfaced three bugs, fixed before any real-call numbers were computed:
>   - realtime-event partials were split into fake turns;
>   - "virtual *reservations* assistant" slipped past the disclosure pattern;
>   - the gate had no veto for a self-declared machine.

The simulated sets measure the detector. These eight calls measure it on real telephony: real TTS, codecs, STT and turn-taking, which is what the timing features actually see.

## Results

| # | name | CALL-E counterpart · task_completed | DIALTONE detected | DIALTONE label | notes |
|---|---|---|---|---|---|
| 3 | `to-dialtone-bot` | agent · true | agent 0.99 | agent_asserted | prompt r1; token lost at pickup; code LT2245; used for debugging (not blind) |
| 4 | `baseline-plain-bot` | **human** · true | agent 0.59 | unverified | CALL-E called a voicebot a human |
| 5 | `dialtone-to-plain-bot` | agent · true | agent 0.91 | agent_asserted | r2; token lost; CALL-E asked "person or automated agent?"; code LT7381 |
| 6 | `to-yesbot` | unknown · true | agent 0.86 | **refused** | both agents "confirmed"; no booking system, no code |
| 7 | `to-ivr` | ivr · **true** | ivr 0.90 | unverified | menu looped "Sorry, I didn't get that" and hung up; nothing booked |
| 8 | `to-dialtone-bot-2` | agent · true | agent 0.99 | **refused** | r2; token lost; CALL-E did not ask for a code this time |

Totals:
- **Detection:** counterpart correct on 6 / 6 calls.
- **Handshake:** pickup collision on 6 / 6 calls, and the token was spoken on 0 / 5 protocol calls.
- **Completion:** CALL-E `task_completed: true` on 6 / 6 calls; DIALTONE kept 2 / 6.

## Plan

**Budget:** 8 of CALL-E's 20 free calls, and roughly 10 minutes of Vapi time (well within the $10 signup credit).

**What gets committed:**
- **Only derived results** go in `data/real/results/`: features, detection, verdict, timings and masked numbers.
- **Raw CALL-E responses** (with transcripts) stay in the git-ignored `data/real/raw/`.

**Setup (once):**

```bash
dialtone line setup            # creates 4 Vapi assistants + 1 free US number
```

**Environment variables** used in the commands below:
- `AI` is the free Vapi number.
- `ME` is the consenting human's phone.

**Goal** used for every call: `Book a table for two this Friday at 7 PM under the name Jordan Lee`.

| # | name | counterpart (truth) | line persona | CALL-E task mode | what it tests |
|---|---|---|---|---|---|
| 1 | `to-human` | human | none (consenting person's phone) | dialtone | Human ignores the token; stays in HUMAN mode; human-attested |
| 2 | `to-human-plain` | human | none | plain | Human baseline without the protocol |
| 3 | `to-dialtone-bot` | agent | `dialtone` | dialtone | Handshake + nonce; MACHINE mode; agent-asserted with code |
| 4 | `baseline-plain-bot` | agent | `plain` | plain | Duration baseline for the speed claim |
| 5 | `dialtone-to-plain-bot` | agent | `plain` | dialtone | Uncooperative bot: behavioural detection only |
| 6 | `to-yesbot` | agent | `yesbot` | dialtone | Two agents "confirm"; gate must refuse |
| 7 | `to-ivr` | ivr (emulated on Vapi) | `ivr` | dialtone | Menu detection. Labelled emulated, not a real carrier IVR |
| 8 | `to-dialtone-bot-2` | agent | `dialtone` | dialtone | Repeatability of handshake timing |

Each call follows the same pattern: switch the line persona, then place the call.

```bash
dialtone line use dialtone
dialtone call --to $AI --goal "Book a table for two this Friday at 7 PM under the name Jordan Lee" \
  --principal "Jordan Lee" --mode dialtone --name to-dialtone-bot --label agent --live
```

**After all calls:**

```bash
dialtone eval                                    # adds the real calls to eval/REPORT.md
python -c "from dialtone import demo; demo.build('real', out=__import__('pathlib').Path('web/data/demo.real.json'))"
```

For each call on the Vapi line, run `dialtone line inbound <vapi-call-id>` to show the inbound side classifying its caller.
