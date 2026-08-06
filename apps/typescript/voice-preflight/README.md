# Voice Preflight

CALL-E speaks your `task` text to a real person. You cannot hear it first. This
app renders that exact text through a text-to-speech API you already pay for, so
you hear what the callee will hear. It also refuses to pass a script whose
critical line has quietly gone missing.

It places no calls and needs no CALL-E account.

## The problem

A `task` is prose until somebody has to say it out loud. Three things go wrong
only at that point. All three are invisible in review.

**A line disappears.** Several apps in this repository depend on one sentence
surviving. `phone-approval-gate` reports approval only when a person reads back a
six digit code, so the sentence asking for it is the whole mechanism. Someone
tidies the wording, the sentence goes, then the call cannot be approved by
anybody. The suite still passes, because nothing tests prose.

**The voice cannot speak the recipient's language.** A recipient carrying
`locale: hi-IN` with an English-only voice is a call that wastes somebody's time
and burns the one attempt you had.

**The script is longer spoken than anyone thought.** Characters do not tell you
seconds. A budget only means something measured against real audio.

## What it does

One HTTP client drives any text-to-speech API from a JSON descriptor, so adding
a provider is a file rather than a code change. It renders the task, measures the
audio, then reports findings and exits non-zero when one of them should stop the
call.

Every finding is a fact about the text or about the audio that came back. None of
them predicts pronunciation, because nothing in this process can know that. The
audio is the ground truth. A person listening to it is the real check.

| Finding | Blocks | Why |
| --- | --- | --- |
| `locked_line_missing` | yes | a line you declared critical is not in the task, so it cannot be spoken |
| `voice_language_mismatch` | yes | the voice does not speak the recipient's language |
| `text_over_provider_limit` | yes | the provider will not accept the script in one request |
| `spoken_too_long` | yes | measured audio exceeds the budget you set |
| `digit_run_unseparated` | no | a run of four or more digits is present, so listen to how it reads |

The last row is deliberately not a refusal. A provider may read `999833` digit by
digit or as a quantity. The only way to know is the audio this tool just
wrote for you.

## Try it without an account

```bash
cd apps/typescript/voice-preflight
npm install
npm run check   # tsc --noEmit
npm test        # 52 tests, no credentials, no network beyond loopback
npm run demo    # the whole flow against a local fake provider
```

The demo runs four cases and the last three all refuse:

```text
1. The script as written, heard before anybody dials
  rendered 196615 bytes, 12.3s spoken
  report  digit_run_unseparated
          A run of 6 digits has no separator. Listen to how the rendered audio reads it.
  Verdict ok

2. Somebody tidied the wording and the code sentence went with it
  REFUSE  locked_line_missing
          It was locked because the gate approves only when a live person returns the code.
  Verdict refused

3. The recipient speaks Hindi and the chosen voice does not
  REFUSE  voice_language_mismatch
  Verdict refused

4. The script grew past the spoken budget the operator set
  REFUSE  spoken_too_long
          The rendered audio runs 49.4s against a budget of 20s.
  Verdict refused
```

The fake provider returns a real PCM WAV whose length is derived from the text,
so case 4 crosses its budget on arithmetic rather than on luck. The duration
in every case is measured from a container rather than estimated.

## Your own provider, your own credits

A descriptor describes one API. Nothing in this app is written against a vendor.

```jsonc
{
  "name": "acme-tts",
  "endpoint": "https://api.acme.example/v1/tts/{voice}",
  "method": "POST",
  "authHeader": "Authorization",
  "authPrefix": "Bearer ",
  "authEnv": "ACME_TTS_KEY",
  "headers": { "model": "s1" },
  "bodyTemplate": "{\"text\":\"{text}\",\"voice\":\"{voice}\"}",
  "audio": { "kind": "body" },
  "format": "mp3",
  "maxChars": 4000,
  "languages": ["en-US", "en-IN"]
}
```

`audio.kind` covers the three shapes providers actually use: `body` for raw bytes,
`base64Field` with a `path` for base64 inside JSON, then `urlField` with a `path`
for a link that gets followed. `examples/` carries descriptors for ElevenLabs and
Fish Audio, plus the local fake the demo uses. See `docs/providers.md` for the
whole field list.

## One run against a real provider

```bash
export ACME_TTS_KEY="..."
npm run voice -- preview --script my-script.json --provider examples/provider.elevenlabs.json
npm run voice -- render  --script my-script.json --provider examples/provider.elevenlabs.json \
  --allow-host api.elevenlabs.io
```

`preview` contacts nothing and reads no credential. `render` needs both the
credential and the host. The host is the part worth explaining.

**The descriptor never holds a credential.** It names the environment variable
that does. A descriptor is the file people commit and paste to each other, so the
loader refuses an `authEnv` that is not shaped like a variable name, plus a
static header carrying a long opaque value, because that is what a key looks like.

**The credential only travels where you said.** This app talks to no fixed vendor,
so there is no default trusted host. Name the host once with `--allow-host` or
`VOICE_ALLOWED_HOSTS` and everything else is refused before a request is built.
Plain http is accepted on loopback only, which is what the fake and the tests use.
https on its own is not enough: it says the transport is encrypted and nothing
about who is on the other end.

Rendered audio is cached under a digest of provider, voice and text and written
`0600`. An unchanged script is never paid for twice. An edited one is always
re-read.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | no blocking finding |
| 20 | a blocking finding, the call should not go out as written |
| 30 | usage or input file error, including a host that was never allowed |
| 40 | the provider refused or answered with no audio |

## Limits, stated rather than implied

**It cannot change the voice CALL-E uses.** `POST /v1/calls` carries `task`,
`recipients`, `result_schema`, `recipient_result_schema`, `metadata` and
`webhook_url`, with `additionalProperties: false`, so there is no field for a
voice or a provider and an unknown one is rejected. This app renders the same text
through your provider so you can hear and gate it. It does not reach the call
audio. It does not claim to.

**Duration needs a WAV container or ffprobe on the path.** With neither, the
length is reported as unknown and the length check is skipped rather than
estimated from character count, because a number nobody measured is worse than an
honest gap.

**A digit run is an observation, not a diagnosis.** The tool tells you where to
listen. It does not tell you what you will hear.

