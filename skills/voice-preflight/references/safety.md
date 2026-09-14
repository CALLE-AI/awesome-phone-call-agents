# Safety

## What a spoken script may not ask for

A phone agent speaks to a person who cannot see a screen, cannot check a URL and
has no way to verify who is calling. That asymmetry is the whole risk, so a script
never solicits anything a caller could use against the callee.

Never ask a person to say aloud: a Social Security or national identity number, a
full card number, a CVV, a bank account number, a PIN, a password, a date of birth
used as an identity check, plus a one-time code the callee received from somewhere
else. A code that CALL-E's own caller printed on the request is different in kind,
because the caller already knows it and is checking that a live person is holding
it. A code that arrived by SMS from a bank is the exact material a scam call wants,
and no script should ask for one.

Do not lock a line that contains a secret. A `locked` entry is written into the
script file. Script files get committed and pasted.

## The disclosure has to be spoken

An AI generated voice is artificial for the purposes of the US TCPA, per the FCC
declaratory ruling of 2024-02-08. Whatever your jurisdiction requires, the practical
consequence is the same: if a disclosure is part of your script, it belongs in
`locked`, because a tidy-up that removes it is exactly the failure this app exists
to catch. That is what the second locked line in `examples/script.example.json`
demonstrates.

## Credentials

The descriptor names an environment variable. It never holds the value. The
loader refuses a descriptor that appears to. Rendered audio is written `0600`
because synthesised speech of a real script is not public material.

The credential travels only to a host the operator named, checked before any
request is built rather than after a client has already handed the key over. Plain
http reaches loopback only.

## What this app does not do

It places no calls, holds no phone numbers and needs no CALL-E account or
credential. It cannot change the voice a CALL-E call uses, because the API has no
field for one.

It also cannot tell you how a provider will pronounce anything. It renders the
audio so a person can listen. Any output that reads like a prediction about speech
would be a claim nobody measured, which is why the digit-run finding reports the
run and never a reading.

## Cost

Rendering calls a provider and providers bill characters. Audio is cached under a
digest of provider, voice and text, so an unchanged script is rendered once. An
edited script is a new render, which is the point: the version you heard is the
version you approved.
