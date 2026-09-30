# Originality and overlap audit

Audit date: 2026-09-04 (Asia/Shanghai)

## Scope checked

- Repository instructions, root README, contribution guide, design principles,
  and production workflow guidance were read in full.
- The local repository snapshot contained 39 skill directories, 71 app
  directories, and 5 plugin directories.
- Names, README descriptions, and repository Markdown were searched for pet,
  animal, veterinary, quarantine, relocation, airline, and adjacent travel
  concepts.
- The public GitHub Issues API returned 295 issue/PR records. Their titles were
  checked for the same concept terms. This is a title-level public-record audit,
  not a claim that every historical discussion body was semantically reviewed.

No existing pet, animal-travel, veterinary-document, or quarantine-checkpoint
contribution was found in those surfaces.

## Closest concepts and why PawPassage is different

| Existing contribution | Adjacent idea | Material difference |
| --- | --- | --- |
| PLAN B travel recovery, PR #126 | Travel and provider calls | Chooses disruption-recovery options under budget/deadline constraints. PawPassage neither replans nor books travel; it verifies a fixed three-proposition evidence contract across animal-journey checkpoints. |
| PermitDiff | Compares written and phone permit facts | Municipality/contractor permit cases. PawPassage has an animal-travel-specific multi-checkpoint matrix, explicit medical/border authority boundary, and no permit truth claim. |
| CaseChaser | Tracks claims, refunds, repairs, or delivery promises | Repeated case escalation and promise tracking. PawPassage is one attempt per checkpoint and does not chase or enforce a promise. |
| Local Atlas | Reuses current facts learned from local businesses | General local place questions and caching. PawPassage does not publish or cache business facts for others; it binds private route propositions to one review packet. |
| AccessLine / Openings / pharmacy-stock-check | High-stakes service availability | Human healthcare and accessibility workflows. PawPassage refuses clinical decisions and checks only administrative animal-journey propositions. |
| Callsweep / Ringer | Consumer calls, quotes, bookings, negotiation | Those products can compare or transact with businesses. PawPassage structurally forbids price negotiation, payment, reservation, and selection. |

## Chosen concept

PawPassage addresses a distinct operational failure: a cross-border pet journey
depends on multiple official service desks whose verbal and written operational
requirements may diverge. The product does not try to replace official written
rules or professional judgment. Its novel unit is a human-approved,
three-proposition checkpoint whose contradictions remain visible in a
route-level evidence matrix.

The design is useful to a Hong Kong-based traveler calling supported
international desks, including Malaysia. CALL-E's checked region list does not
currently include `HK`, so the implementation rejects Hong Kong as a call
destination instead of falsely sending `MY` or another code.
