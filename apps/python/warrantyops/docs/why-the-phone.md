# Why the phone

This is an impact artifact, not run evidence. The three evidence-class pills
elsewhere in this repository — `Recorded CALL-E result`, `Synthetic
scenario`, `Fictional case data` — classify *runs* of this system; no quote
below is a run, so none of those pills applies here. Every quote below is an
**external, public citation**, reproduced verbatim, labelled with its source
and the date it was checked (2026-09-12). Nothing on this page is
paraphrased, and no quantified market, frequency, productivity or
recovered-money figure appears anywhere below — by design, not omission.

## 1. The job exists: public job-description bullets

Warranty administrators are publicly hired to chase rejected, returned and
unpaid claims with the manufacturers and distributors who hold them. These
bullets are quoted word for word from public postings and templates:

> "Resubmits all rejected claims promptly or receives authorization to write
> them off."

— Automotive Warranty Administrator, job description, autojobs.com,
checked 2026-09-12. ([source](https://www.autojobs.com/jobs/warranty-administrator-job-description/))

> "Follows up on payment of outstanding claims."

— same posting, autojobs.com, checked 2026-09-12.
([source](https://www.autojobs.com/jobs/warranty-administrator-job-description/))

> "Review returned/rejected claims and prepare appeals as needed."

— Warranty Administrator, Volvo Group job posting (Corona, CA),
jobs.volvogroup.com, checked 2026-09-12.
([source](https://jobs.volvogroup.com/job/Corona-Warranty-Administrator-CA-92883/1351870355/))

> "Monitor claim status, including submissions, approvals, rejections, and
> payments."

— same posting, jobs.volvogroup.com, checked 2026-09-12.
([source](https://jobs.volvogroup.com/job/Corona-Warranty-Administrator-CA-92883/1351870355/))

> "Check claims rejected and resubmit errors or, in conjunction with
> manager, investigate reason for rejection"

— Warranty Administrator, job-description template, velvetjobs.com,
checked 2026-09-12.
([source](https://www.velvetjobs.com/job-descriptions/warranty-administrator))

> "Track claim status and follow up with manufacturers to resolve delays,
> discrepancies, or outstanding issues"

— Warranty Administrator/Claims Processor, Mechanical Concepts LLC posting
(New Orleans), mechanicalconceptsllc.com, checked 2026-09-12.
([source](https://www.mechanicalconceptsllc.com/warranty-administrator-claims-processor-new-orleans/))

Read together, the bullets describe a person whose standing assignment
includes rejected and returned claims, resubmission or appeal, and follow-up
with the manufacturer until the claim resolves. That is the job this tool
serves. The bullets say nothing about how often this happens or what it
costs, and neither does this page.

## 2. The policy side: what public claim-policy sources show

One verbatim regulation excerpt was found that governs the
dealer-to-franchisor claim-approval relationship this tool operates in:

> "A franchisor shall not disapprove a claim unless the claim meets one of
> the following categories:"

— New Mexico Motor Vehicle Division, dealer warranty-claim protest page,
nmvb.ca.gov, checked 2026-09-12. The same page requires each disapproval
notice to "state the specific grounds upon which the disapproval is based,"
within 30 days of receipt.
([source](https://www.nmvb.ca.gov/protest/protests_warranty_claims_dealer.html))

The excerpt is quoted for what it is: a public claim-policy source showing
this counterparty relationship is real and regulated — and that at least one
regulator requires specific written grounds for a disapproval.

**Not found in public sources:** a verbatim public OEM, dealer-portal or
insurer excerpt showing a claim returned with a bare code and no stated
reason (searched 2026-09-12; public pages found were consumer advice and
forum discussions, not policy documents, and none was quoteable). No such
excerpt is claimed, implied or reconstructed here. The fictional
demonstration case W-1042 (`proof/w1042-proof.html`, labelled `Fictional
case data`) depicts that shape for demonstration only; it is not evidence
that any real portal behaves that way.

## 3. The sequence this tool governs

The tool assumes — and its kernel enforces — that the phone is the **last**
step of a specific, checkable sequence, never the first:

```text
portal status check            the portal shows the claim's state but not
                               an actionable reason or next step
        ↓
documented-code resolution     no published code sheet covers the returned
                               code, or the code alone states no reason
        ↓
written follow-up              emails or messages to the claims desk that
                               produced no reply
        ↓
someone must call              the gap persists after the routes above
        ↓
governed one-call inquiry      one authorized, disclosed CALL-E call; every
                               asserted value grounded in what the
                               counterparty actually said; nothing written
                               back until a human approves it against an
                               unchanged source record
```

The kernel refuses to dial without the first three steps recorded in a
structured exhaustion manifest (`ORDINARY_ROUTE_NOT_EXHAUSTED`), and refuses
if the source record already states the next step
(`SOURCE_ALREADY_ANSWERS`). The sequence, not this page, is the reason a
call is ever permitted — and the job bullets in §1 are the public evidence
that the person at step four exists.
