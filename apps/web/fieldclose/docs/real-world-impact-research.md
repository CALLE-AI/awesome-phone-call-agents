# Real-World Impact Desk Research

- Research date: August 13, 2026
- Method: Public-source desk research
- Direct practitioner interviews: `n = 0`
- Quantitative field baseline: Not established

## Purpose and evidence boundary

This brief records public evidence for the administrative closeout problem that
FieldClose addresses. It is not user research and must not be described as HVAC
contractor feedback. The sources establish that commercial HVAC and adjacent
field-service closeout depends on complete maintenance records, work summaries,
required customer acknowledgements, equipment details, and explicit follow-up
when work remains open. They do not establish how often these gaps occur, how
long a typical contractor spends resolving them, or how much time or money
FieldClose would save.

The direct-practitioner evidence gate therefore remains open. Submission copy
may cite the workflow observations below as desk research, but it must state
that no contractor interviews or measured customer baseline were available.

## Source-backed workflow observations

### 1. Completion needs a traceable record and notification

The U.S. Department of Energy's *Operations & Maintenance Best Practices Guide*
lists work-order generation, prioritization, equipment-level tracking,
historical work-order tracking, and technical-document storage as typical CMMS
functions. Its needs assessment also asks how an organization verifies that
work was done correctly and how completion is communicated. ASHRAE describes
Standard 180 as minimum inspection and maintenance practice for HVAC systems in
new and existing commercial buildings.

**Supported observation:** technical work and administratively usable evidence
are related but distinct concerns. A closeout workflow needs to preserve what
was done, which equipment was involved, and what happened after completion.

**FieldClose inference:** the product should consume a completed work order and
produce bounded, auditable follow-up evidence. It should not replace the CMMS,
maintenance standard, or technician record.

Sources:

- [U.S. Department of Energy, Operations & Maintenance Best Practices Guide, Chapter 4](https://www1.eere.energy.gov/femp/pdfs/OM_4.pdf)
- [ASHRAE, Standards 180 and 211](https://www.ashrae.org/technical-resources/bookstore/standards-180-and-211)

### 2. Closeout is a multi-role handoff with explicit blockers

ServiceTitan's commercial-service workflow describes technicians entering
timestamped work-performed logs, a lead technician checking whether tasks were
completed, and an office manager using the work summary for the customer-facing
work-order document. Its job-closeout documentation lists incomplete required
forms, missing signatures, missing equipment details, and additional work that
still needs scheduling as conditions that block completion.

**Supported observation:** the end of a field appointment can still leave an
office review, customer acknowledgement, or scheduling decision unresolved.
The workflow crosses technician, lead or office staff, and customer roles.

**FieldClose inference:** the initial operator should be an owner-dispatcher or
service coordinator. A call result should create a recommended next action, not
silently close the external work order.

Sources:

- [ServiceTitan, Capture daily job progress with work-performed logs and work summaries](https://help.servicetitan.com/release-hub/docs/capture-daily-job-progress-with-technicianwork-performed-logs-and-work-summaries)
- [ServiceTitan, Complete a job in the Field Mobile App](https://help.servicetitan.com/how-to/complete-job-close-invoice)

### 3. The authorized site contact may be unavailable at the point of service

ServiceTitan documents a commercial rooftop-unit example in which a facility
manager is in a meeting and cannot sign on site, and a commercial refrigeration
example in which the store manager is away from the service interaction. The
documented workflow sends a remote acknowledgement request and tracks its
completion status.

**Supported observation:** commercial service completion and authorized-site-
contact availability do not always coincide. Some confirmation must therefore
happen remotely or later.

**FieldClose inference:** a narrowly scoped phone conversation can be one
remote follow-up channel when the organization is authorized to call. This
source does not prove that phone is more reliable than SMS, email, or a portal,
and FieldClose must not make that comparative claim without field evidence.

Source:

- [ServiceTitan, Send required job signatures remotely](https://help.servicetitan.com/release-hub/docs/send-required-job-signatures-remotely-with-the-servicetitan-field-mobile-app)

### 4. Missing information and unfinished visits require an explicit exception

Jobber documents that an incomplete checklist can remain after a visit is
marked complete and is then surfaced in the activity feed. It also prompts an
operator to complete or remove unfinished visits when closing a job. ServiceTitan
similarly exposes missing forms, signatures, equipment details, or scheduled
work as closeout blockers.

**Supported observation:** a safe system must represent incomplete information
and remaining work rather than equating a completed visit with a fully closed
job.

**FieldClose inference:** `unknown`, refusal, no answer, an unresolved issue, or
a return-visit request should remain visible and route to a human task. CALL-E
must not diagnose the equipment, schedule the return visit, or make the final
business disposition.

Sources:

- [Jobber, Checklists](https://help.getjobber.com/hc/en-us/articles/115009740048-Checklists)
- [Jobber, Job Basics](https://help.getjobber.com/hc/en-us/articles/115009379027-Job-Basics)
- [ServiceTitan, Complete a job in the Field Mobile App](https://help.servicetitan.com/how-to/complete-job-close-invoice)

## Evidence-based current workflow model

The sources support this generic sequence; it is a synthesis, not a transcript
of one contractor's process:

1. A technician finishes the on-site task and records work performed.
2. A lead technician or office operator reviews the record for required forms,
   equipment details, open work, and a usable customer-facing summary.
3. An authorized site contact provides any required acknowledgement or missing
   closeout information, either on site or through a remote channel.
4. Missing information, an unavailable contact, or remaining work stays open
   and creates a follow-up or scheduling decision.
5. An authorized human records the final business disposition and completes the
   external closeout process.

FieldClose is intentionally limited to the approved follow-up and evidence
handoff between steps 2 and 5. It does not perform the technician's work,
invoice the customer, schedule a visit, or close the external system of record.

## North-star metric

**Time from technician completion to human-approved closeout evidence**

For case `i`:

```text
closeout_evidence_latency_i = human_disposition_recorded_at_i
                              - technician_completed_at_i
```

Report the median and 90th percentile only after both timestamps are collected
from real, consented workflows. A case remains in the denominator when the
contact is unreachable or the result needs attention; those outcomes must not
be removed to improve the metric.

For the current submission:

- measured practitioner sample: `n = 0`;
- real baseline: unavailable;
- target improvement: not set;
- demo measurements: simulated and not evidence of customer impact.

Useful guardrail measures are actionable-closeout rate, human-escalation rate,
unreachable rate, incorrect automatic-ready classifications, duplicate-call
prevention rate, and audit completeness. Targets require a real baseline.

## Claims allowed in the submission

- Commercial HVAC closeout relies on documented maintenance information.
- Field-service systems treat required forms, acknowledgements, equipment
  details, and remaining appointments as explicit closeout concerns.
- An authorized site contact is not always available during the service visit,
  so later remote follow-up can be necessary.
- FieldClose demonstrates one human-approved way to structure that follow-up
  and preserve uncertainty.

## Claims not supported by this research

- A typical contractor loses a stated number of hours or dollars to closeout.
- A stated percentage of HVAC jobs has missing customer confirmation.
- Phone is more reliable than email, SMS, or a contractor portal.
- HVAC contractors will accept an AI caller in this workflow.
- FieldClose reduces closeout time, headcount, callbacks, or revenue leakage by
  any stated amount.

These claims require consented practitioner research or measured production
evidence and must remain absent from submission materials until then.
