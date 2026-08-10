# Call Brief

The brief is the instruction given to the voice agent. It defines what may be said, what must be asked, and where the call stops.

All phone numbers in this document are fictional examples.

## Structure

1. **Disclosure** - automated call, on whose behalf, and why. First, always.
2. **Reference** - the opaque job reference.
3. **Problem** - one sentence, no personal detail.
4. **The bounded questions** - only those matching the declared result schema.
5. **Stop conditions** - what ends the call.

## Template

```text
This is an automated call on behalf of {ORGANIZATION}.
I'm calling about job reference {JOB_REFERENCE}, a {TRADE} issue.

The reported problem is: {PROBLEM_SUMMARY}

I have three questions:
1. Are you able to take this job?
2. If so, what is the earliest you could attend?
3. Do you have an estimated cost?

I can't confirm or accept anything on this call. Someone from
{ORGANIZATION} will follow up to confirm.
Thank you for your time.
```

The closing line is not politeness. It removes any reading of the call as an acceptance.

## Worked Example

Fields:

```text
ORGANIZATION    = Northgate Property Services
JOB_REFERENCE   = JOB-4417
TRADE           = plumbing
PROBLEM_SUMMARY = a leaking pipe under a kitchen sink
VENDOR_PHONE    = +15550100447   (fictional)
```

Not in the brief, and never spoken: the building address, the unit number, the resident's name, the resident's phone number, when the resident is home.

## Rules For Writing The Brief

- **Ask only what the schema declares.** An unasked question has no field to hold its answer, and the answer will be discarded.
- **Ask closed questions.** "Are you able to take this job?" has three answers. "What's your availability like?" has infinitely many.
- **Do not stack questions.** One idea per question. A vendor answering "yes" to a compound question has answered something, and you do not know what.
- **Do not offer a price.** Asking "would $40 work?" makes the caller the party that named a figure.
- **Do not describe urgency as pressure.** State the preferred window as a fact.
- **Do not authorize.** No "go ahead", no "we'll take it", no "book you in".

## Stop Conditions

End the call, and record the reason, when:

- the questions are answered
- the vendor declines
- the vendor asks not to be contacted again
- the vendor asks for identifying information about the person the job is for
- the vendor asks to negotiate
- the recipient is clearly not the intended vendor

The last three end the call politely and route to a human. They are correct outcomes, not failures.

## Language And Region

Set language and region explicitly from the vendor's contact record. Do not infer them from the phone number's country code, the caller's locale, or the text of the problem summary. A wrong guess makes the call unintelligible and wastes it.
