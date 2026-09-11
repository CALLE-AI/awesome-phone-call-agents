# Why these four questions

RingFence's verification call ([`ringfence/verify_call.py`](../ringfence/verify_call.py),
`QUESTIONS`) never asks "is this really you" — a coached or panicked victim
mid-scam will answer "yes" to that. Instead it asks four open, non-leading
questions, each targeting a specific, well-documented imposter-scam red flag
rather than a taxonomy invented for this project. The FTC's consumer
guidance on recognizing imposter/impostor scams (ftc.gov/consumer-advice —
"How to avoid a scam" and its recurring "callers who ask for these things
are always scammers" framing) and the FBI's elder-fraud reporting
(fbi.gov/news/stories/elder-fraud-in-focus) both describe the same small set
of pressure tactics repeatedly, across scam sub-types — that repetition is
why these four, and not some longer list, were chosen.

## 1. "Did anyone ask you to keep this transaction private, or not to tell your bank or family?"

**Targets: secrecy / isolation demand.** Every major consumer-protection
source on imposter scams — FTC guidance and FBI elder-fraud reporting alike
— names secrecy as close to a universal marker: a legitimate transaction is
never something the other party needs you to hide from your own bank or
family. Isolating the victim from anyone who might recognize the scam (a
bank teller, a relative, a friend) is a load-bearing step in the scam
script, not an incidental detail — remove the target's ability to get a
second opinion, and the scam's other pressure tactics work far better.

## 2. "Is there time pressure — were you told this has to happen today or right now?"

**Targets: manufactured urgency.** Consumer-protection guidance consistently
identifies artificial urgency ("you must act right now, before it's too
late") as a core scam pressure tactic, precisely because it is the
mechanism that prevents the victim from pausing to verify. A genuine
institution's transaction rarely depends on completing in the next hour;
manufactured urgency is a tell, not a legitimate feature of most real
payments.

## 3. "Can you describe your relationship to the recipient, in your own words?"

**Targets: a relationship-knowledge mismatch.** Fabricated-relative and
romance-scam narratives depend on the victim accepting a claimed identity
("your grandson," "your online partner of two months") without being asked
to describe that relationship in their own words, before any detail the
scammer said is repeated back to them. Asked in this order — before, not
after — the question catches a genuine gap between what the victim
actually knows about the recipient and what the scam's story requires them
to believe. This is exactly why AI voice-cloning ("your grandson's voice")
is such an effective attack per the FBI's elder-fraud reporting: it can
fake a voice, but the underlying relationship still has to be described
honestly by the person being asked, not supplied by the caller.

## 4. "Were you asked to pay by wire, gift card, or cryptocurrency specifically?"

**Targets: insistence on an irreversible payment method.** Scammers
consistently prefer payment rails that cannot be reversed or clawed back —
wire, gift card, and cryptocurrency are the three named again and again in
FTC guidance and FBI reporting for exactly this reason. A legitimate large
transaction is rarely conditioned on using one specific irreversible method;
an insistence on it, named unprompted by the account holder rather than
suggested by the question, is a strong signal.

## Explicit "stop / hold everything" — not a question, a standing override

At any point in the call, an explicit request from the account holder to
stop or hold the transaction ends the call and blocks the transaction
immediately, without the remaining questions being asked. This is stated
plainly in [`ringfence/decide.py`](../ringfence/decide.py)'s disposition
table: it must be easy to stop a transaction and hard to force one through,
never the reverse. See `fixtures/07_hold_requested.json` for the case this
protects.
