---
name: voice-preflight
description: Hear a CALL-E phone call task spoken by your own text-to-speech provider before a real person does, then refuse a script whose critical line would not survive being spoken.
license: MIT
---

# Voice Preflight

CALL-E speaks your `task` text to a person on the phone. You cannot hear it
first. The platform exposes no voice or provider field, so the only way to
know how a script sounds is to render the same text yourself.

This skill covers doing that with a provider you already pay for, then gating the
call on what the audio and the text actually show.

## When to use it

Before any call whose success depends on a specific string reaching the callee.
That includes a one-time code a person has to read back, a callback number, a
disclosure a rule requires you to speak, an amount, plus a reference somebody will
repeat to you. Also use it whenever a `task` has been edited, because the failure
this catches is a line disappearing during a tidy-up.

Skip it for a call whose script carries no such string. A general enquiry has
nothing to survive verbatim.

## The procedure

1. **Declare what must survive.** Write the script file with a `locked` entry per
   critical line, each with the exact `text` and a `reason`. The reason is quoted
   back in the refusal, so it travels with the failure instead of living in
   somebody's head.
2. **Set the spoken budget.** `maxSpokenSeconds` is your number, not a default.
   Pick the length past which the callee will hang up.
3. **Preview first.** `preview` reads no credential and contacts nothing. It shows
   what would be sent, where the credential would go and the offline findings.
4. **Render and listen.** `render` synthesises through your provider and measures
   the audio. Open the file. The tool tells you where to listen, it does not tell
   you what you will hear.
5. **Gate on the exit code.** 0 means nothing blocked, 20 means the script should
   not go out as written, 30 is a config or input error, 40 means the provider
   refused.

```bash
export ELEVENLABS_API_KEY="..."
npm run voice -- preview --script my-script.json --provider examples/provider.elevenlabs.json
npm run voice -- render  --script my-script.json --provider examples/provider.elevenlabs.json \
  --allow-host api.elevenlabs.io
```

## Rules that are not negotiable

- **The descriptor never holds a credential.** It names the environment variable
  that does. Committing a key inside a descriptor is the one mistake this design
  exists to prevent, so the loader refuses an `authEnv` that is not shaped like a
  variable name, plus a static header carrying a long opaque value.
- **Name the host before you send.** There is no default trusted host, because
  this talks to no fixed vendor. https alone says the transport is encrypted and
  nothing about who is on the other end.
- **Never treat a digit-run report as a diagnosis.** It says a run of digits is
  present. Whether a provider reads it digit by digit is a question the audio
  answers.
- **Never estimate a duration.** When the container cannot be measured, the length
  check is skipped and the output says so. A number nobody measured is worse than
  an honest gap.
- **This does not change the voice CALL-E uses.** `POST /v1/calls` has no field for
  a voice or a provider, then it rejects unknown properties. Do not tell an operator
  otherwise.

See `references/safety.md` for what a script may and may not ask a person to say,
and `references/examples.md` for three worked scripts.
