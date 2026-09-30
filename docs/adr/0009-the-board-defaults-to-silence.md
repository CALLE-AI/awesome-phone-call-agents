# The board defaults to silence

The Release form opened with the Patient's whole sentence already sitting in the field
that will be spoken to a receptionist (`holdfor/templates/detail.html:118`). Narrowing it
was possible; it was also the extra step, taken at the end of a shift, on the screen where
the safe answer is the one nobody has to notice.

The field now starts empty. Her words are shown above it as evidence to read and select
from, not as content already queued to send. A Release with no approved words is valid and
always was — `_narrowed_words` accepts an empty string — so the default outcome of
inattention becomes that nothing is spoken rather than that everything is.

This is the only defence Read Scope has at this point, and it has to be structural. The
Read Scope table forbids drug names, doses and diagnoses on both calls, but Carried Words
are verbatim Patient speech: "the co-codamol makes me sick" is a legitimate span, and a
substring check cannot tell that it names a drug. The alternative was a list of drug
names, which would make three people at a hackathon the authors of a clinical vocabulary —
refused for the red-flag list in ADR 0005 for that reason, and worse here, because a
partial list gives cover. "My water tablets" is in no formulary.

## Consequences

A Reviewer must do something deliberate for the Patient's words to travel, which adds an
action to the path the PRD calls the point of the product. That is the trade: the quote is
the evidence reception hears instead of an agent's opinion, and it costs a selection. The
fixture transcripts were written without a single drug name in them, so the test suite does
not exercise this at all — the risk arrives with the first real Patient, and no test will
warn us first.
