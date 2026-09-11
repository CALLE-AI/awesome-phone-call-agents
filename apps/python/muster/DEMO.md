# Muster demo

**Hosted:** https://muster-95953931159.us-central1.run.app

Six enrolled subjects. Only one closes without a person. No credentials, no
calls.

```bash
cd apps/python/muster
python3 -m muster.cli demo
```

| Subject | Scenario | Grade | Why it matters |
| --- | --- | --- | --- |
| Agnes Oduro | `clean` | `CONFIRMED_LIVE` | The only automatic pass in the set. |
| Tomas Weber | `third_party` | `THIRD_PARTY_CLAIM` | A relative says he is fine and cannot come to the phone. This is the shape of the Japanese case, where a family drew a pension for thirty-two years after the death. Vouching is never a pass. |
| Marguerite Baptiste | `voicemail` | `UNPROVEN` | An answering machine greets the caller in her own voice. A recording cannot answer a challenge minted seconds ago. |
| Henry Achterberg | `clean` | `NEEDS_HUMAN` | He answers correctly and passes every challenge, and is still routed to a person, because he is enrolled as hearing-impaired. A machine never fails him. |
| Sofia Kallas | `coached` | `NEEDS_HUMAN` | Every answer is right. An unattributed voice supplies them eight seconds before she repeats them. Right answers, wrong provenance. |
| Beatrice Nkrumah | `clean` | `CONFIRMED_LIVE`, `REGISTER_CONTRADICTED` | The death register records her death. She just repeated three words minted ninety seconds ago. The correction case is opened against the register, not against her, and her payment does not stop. |

Three of those are the point of the whole system. **Henry passes and is still
not closed.** **Sofia gives perfect answers and is still not closed.** And
**Beatrice is recorded as dead by the register and is demonstrably not.**

## Try a different outcome for the same person

```bash
python3 -m muster.cli demo s-1041 --scenario third_party
python3 -m muster.cli demo s-1041 --scenario reassigned
```

The scripted responses are built from the live plan, so the words echoed back
are the ones actually issued for that call. A scenario cannot pass by
hard-coding the right answer.

## See what would be said, without calling

```bash
python3 -m muster.cli plan s-1041 --show-payload
```

Prints the spoken script and the exact `POST /v1/calls` body. The recipient
number is masked.

## Console

```bash
python3 -m muster.api        # http://localhost:8080
```

The Register lists the roster; clicking a subject runs the attestation and
shows the grade, the reasons, the challenge that was issued, the evidence
quotes and the transcript timeline. Unattributed turns are styled distinctly,
because they are the coaching signal.

## Credentials, without spending a call

```bash
export CALLE_API_KEY=...
python3 -m muster.cli verify
```

Read-only. Lists published Goals to prove the key is accepted.
