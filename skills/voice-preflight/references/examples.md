# Worked examples

Three scripts. The first passes, the second is the failure this app exists for,
and the third shows a locale decision that has nothing to do with wording.

## 1. An approval call that passes

The critical line is the one asking for the code, because the gate reports
approval only when a live person returns it.

```json
{
  "id": "deployment-approval",
  "task": "This is an automated approval call from the release pipeline. I am not a person and this call is being recorded in the change log. Before I read the request, who am I speaking with? Once the release owner is on the line, read the change once: deploy checkout-api 1.14.2 to production. Then ask for the decision: to approve, read back the six digit approval code shown on the request. To reject, say the word reject.",
  "locale": "en-IN",
  "voiceId": "your-voice-id",
  "maxSpokenSeconds": 45,
  "locked": [
    {
      "text": "read back the six digit approval code shown on the request",
      "reason": "the gate approves only when a live person returns the code, so a script without this sentence cannot be approved by anyone"
    },
    { "text": "I am not a person", "reason": "the AI disclosure has to be spoken" }
  ]
}
```

`preview` exits 0. `render` reports one non-blocking finding if the code itself
appears in the task, because six consecutive digits are a run worth listening to.
That report is why you open the audio.

## 2. The same call after somebody improved the wording

```json
{
  "id": "deployment-approval",
  "task": "This is an automated approval call. I am not a person. Please approve when you are ready.",
  "locale": "en-IN",
  "voiceId": "your-voice-id",
  "maxSpokenSeconds": 45,
  "locked": [
    {
      "text": "read back the six digit approval code shown on the request",
      "reason": "the gate approves only when a live person returns the code, so a script without this sentence cannot be approved by anyone"
    },
    { "text": "I am not a person", "reason": "the AI disclosure has to be spoken" }
  ]
}
```

Shorter, clearer, then nobody can approve anything. Exit 20:

```text
REFUSE  locked_line_missing
        A locked line is not in the task, so it cannot be spoken. It was locked
        because the gate approves only when a live person returns the code.
        evidence: read back the six digit approval code shown on the request
```

Nothing else catches this. The wording reads better, the schema is unchanged, and
every test still passes, because no test asserts prose.

## 3. A recipient whose language the voice does not speak

Same script, `"locale": "hi-IN"`, against a descriptor whose `languages` are
`["en-US", "en-GB"]`. Exit 20:

```text
REFUSE  voice_language_mismatch
        The recipient locale is hi-IN and elevenlabs declares this voice speaks
        en-US, en-GB. A call in the wrong language wastes the callee's time.
```

The comparison is on the language subtag, so `en-IN` against an `en-US` voice is
fine and raises nothing. A voice that cannot speak the recipient's language at all
is a call that burns the one attempt you had.

## Reading the exit code in a pipeline

```bash
set -e
npm run voice -- render --script script.json --provider provider.json --allow-host api.acme.example
# 0  nothing blocked, place the call
# 20 fix the script, do not place the call
# 30 a config or input problem, nothing was sent
# 40 the provider refused, no audio was written
```
