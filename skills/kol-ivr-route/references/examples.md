# Examples

## Verified fixture

The bot asks, “What is the current status of claim 4417?” The claims-status representative repeats 4417 and says it was paid $1,217 on August 12. The exact question and answer appear in their respective transcript sides. A fixture log independently records keys `2 -> 1`, matching the reported route. Kol may mark the fixture `verified`.

## Correct numbers, wrong destination

Provider services says claim 4417 was paid $1,217 on August 12. Every number appears in the transcript, but no payer quote establishes the claims-status department. Kol returns `contradicted`. Correctly shaped data from the wrong desk is not safe.

## Question never asked

The structured result contains a paid status, but the agent transcript does not contain the claim-specific question. Kol returns `needs_review`; an answer cannot be bound to a question that was not asked.

## Stale cached route

The model reports keys `2 -> 1`, while the owned fixture log records `2 -> 3`. Kol returns `contradicted`, quarantines the cached route, and requires exploration on the next run.

## Live CALL-E response without a separate route witness

The transcript supports the claim fields and CALL-E reports the menu path, but no fixture log, DTMF audio, or independent provider event exists. Kol returns `needs_review`. This is intentional: a model report cannot corroborate itself.
