# Stop Conditions are enforced twice, and the deterministic layer wins

A Stop Condition is expressed both as an instruction in the agent's call prompt and
as a deterministic scan of the finished transcript. The two are not redundant, and
the scan — not the model — decides whether a Review Item is flagged.

They exist for different people. The prompt exists for the Patient: it is what makes
the call end kindly, at the right moment, with the Safety Line. The scan exists for
the Practice: it is what makes "the agent never grades severity" a property of the
system rather than a request made of a model. A prompt instruction is a request, and
a model that silently misses a red-flag phrase produces an item that looks clean and
is never reviewed — the one failure we cannot detect after the fact.

Where they disagree, the item is flagged. A model failure can therefore delay or
degrade a call, but it cannot produce an unflagged Review Item.

## Consequences

The red-flag list is maintained in two places and must not drift; keep one list and
compile both uses from it. Expect flagged items where the call itself ran to
completion normally — that is the scan doing its job, not a bug.
