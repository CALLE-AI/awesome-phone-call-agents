# The hold probe

One live call, to a handset we own, to find out what the agent does when reception says
"bear with me" and puts the phone down.

Demo beat 5 rests on this and nothing else can verify it. No fixture can: a recorded
transcript shows what was said, never what the agent did during ninety seconds of
silence. The PRD's own risk table says the hold ceiling is unknown and tells us never to
put a number on it in the pitch — this probe is how that stops being a guess.

## Why it cannot wait for the full chain run

The chain run is also the demo rehearsal. If the hold fails there, two things break at
once and we learn it with the camera already set up. The PRD puts the chain run in the
morning for exactly this reason: everything before it is provable against fixtures, so a
failure isolates to the live adapter. The hold is the one part that is not provable
against fixtures, so it gets its own call, first.

## Cost

One call of twenty. It needs no board, no matcher, no Release and no database — just the
CLI and one person acting. It can run while the code is being written.

## Run it

```bash
calle call start \
  --to-phone "+44…" \
  --timezone "Europe/London" \
  --goal "You are ringing a GP surgery's appointments line on behalf of a patient.
Say you are an automated assistant calling for Fieldgate Surgery about a patient
following a check-in call. Give the name Margaret Ellery. Say she would like to be
seen again and ask for the first appointment available.
If you are asked to wait or to hold, wait quietly. Do not speak again until somebody
speaks to you. Do not hang up while you are waiting.
If you are asked anything else, say: I'm only able to pass on what she said. The
practice has the rest on file."
```

The number must belong to somebody on the team. Nothing here dials a real practice.

## The script for whoever answers

1. Answer normally. "Fieldgate Surgery, appointments."
2. Let the agent say its piece.
3. Say **"bear with me a moment, love"** — then put the handset down, say nothing, and
   wait **90 seconds** by a clock. Do not hum, do not breathe near the mouthpiece.
4. Come back: "Sorry about that. I can do Wednesday the 26th at ten past nine."
5. Let the agent answer, then end the call normally.

## What we are measuring

Three questions, and only these three.

| | What we need to know |
| --- | --- |
| Silence | Did the agent stay quiet, or start talking into an empty line? |
| Survival | Did the call survive 90 seconds of silence, or did the platform end it? |
| Evidence | What does the transcript hold for that gap — nothing, filler, or a gap marker? |

Then fetch the record:

```bash
calle call status --run-id <run_id>
```

## The result

_Fill this in the moment the call ends, before anything else._

| | |
| --- | --- |
| Date and time | |
| Run ID | |
| Stayed silent? | |
| Call survived 90s? | |
| Transcript across the gap | |
| Longest silence tolerated | |

### What this changes

- **If it holds** — beat 5 is real footage. Hold the shot for twenty seconds, jump-cut,
  caption it. Still never state a hold length in the pitch: we measured ninety seconds
  once, which is not a ceiling.
- **If the platform ends the call** — queue absorption is not buildable today. Say so
  plainly rather than filming around it, and cut beat 5 to the agent asking and being
  answered. The four patient questions and the named human Release stand on their own.
- **If the agent talks into the silence** — the goal text needs the wait instruction
  strengthened, and it is worth one more call to check. Two calls of twenty is still
  cheap for the beat the whole pitch turns on.
