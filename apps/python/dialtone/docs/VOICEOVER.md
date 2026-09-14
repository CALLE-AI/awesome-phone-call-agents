# DIALTONE: voice-over script

- Record one audio file per scene, named exactly as below (`.m4a`, `.mp3` or `.wav`), into `out/voice/`.
- Speak calmly, at about 150 words per minute. Leave half a second of silence at the start and end.
- Each scene on screen lasts as long as your recording.
- Build the video with `.venv/bin/python scripts/make_video.py --src real --voice-dir out/voice`.

Total: about 2 min 45 s.

---

## 1. `intro` (about 20 s, over the title slide)

> Thousands of builders are teaching AI agents to call businesses. And more and more, those businesses answer with a voicebot. So very soon, a CALL-E call will be answered by another AI. Today, the calling agent can't tell. DIALTONE is the missing layer for that call.

## 2. `calls` (about 45 s, over the three-channel replay)

> Same task, three counterparts, one clock. This replay shows the design. Channel one is a person. The agent discloses it's an AI, adds a short spoken token, and the person just ignores it. DIALTONE keeps human mode, and the booking comes back human-attested. Channel two is a voicebot that speaks the protocol. It echoes the code, both sides switch to a compressed machine mode, and the result is marked agent-asserted, not human-attested. Channel three is a bot that says yes to everything. Both agents say the table is booked, and CALL-E reports task completed. DIALTONE refuses it: a binding booking, confirmed only by a machine, with no code and no record.

## 3. `live` (about 40 s, over the real-calls page)

> Then we placed real CALL-E calls to a voicebot line we built. Real telephony taught us three things. First, two AIs talk over each other: the voicebot greets the instant it picks up, CALL-E's opening gets cut off, and the token is lost. That's a protocol finding, not a bug we can hide. Second, where the handshake never landed, DIALTONE's behavioural detector had to identify the machine from its words and timing. Third, in one live call CALL-E itself reported the voicebot as a human and marked the task complete. DIALTONE would not attest it.

## 4. `how` (about 20 s, over the how-it-works slide)

> Under the hood, the protocol compiles into the CALL-E task. CALL-E's live event stream gives DIALTONE millisecond timing and interruptions. DIALTONE re-derives who was on the line, then relabels task completed. It can downgrade a result. It never upgrades one.

## 5. `eval` (about 30 s, over the honest-numbers page)

> We didn't want a ninety-nine percent claim. Forty transcripts, written blind to the detector's code: eighty-two percent on the first run. Typical calls score ninety-six; hard ones, like a rep reading a script or a bot faking ums, only fifty-four. A second blind set found zero false human attestations. Every miss is listed on screen.

## 6. `close` (about 12 s, over the closing slide)

> DIALTONE. A handshake any inbound voicebot can adopt in three sentences, and one rule: two agents agreeing is not a commitment.
