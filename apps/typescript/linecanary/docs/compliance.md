# Compliance posture

LineCanary is designed to occupy the lowest-risk tier of automated calling:
**scheduled test calls to lines you own or are explicitly authorized to
monitor.** This document explains the rules that shape the product and the
duties that remain with the operator. It is engineering documentation, not
legal advice.

## Why this use case is low-risk by construction

Rules like the US TCPA (and the FCC's 2024 ruling treating AI-generated
voices as "artificial voices"), state mini-TCPAs, and the EU's ePrivacy
regime target calls *to other people* — consumers who did not ask to be
called. LineCanary's subject is different: the operator directs calls at
their own business lines. The called party and the calling party are the
same organization, which is why ownership verification is a hard gate, not a
checkbox.

## Product-enforced safeguards

- **Ownership verification before any monitoring call.** Greeting-code
  verification proves control of the line (only someone who administers it
  can put the code in the greeting); attestation records a written statement
  of authority for lines under a client agreement. The runner refuses
  unverified lines, and a verification does not survive a phone-number
  change.
- **AI disclosure in the first sentence.** Every task — monitoring and
  verification alike — leads with: *"This is an automated test call from
  LineCanary, monitoring this line on behalf of its owner."* This matches
  the direction of the EU AI Act's transparency obligations (Art. 50,
  applicable since Aug 2026), several US state bot-disclosure laws, and the
  pending FCC AI-disclosure rulemaking. It costs nothing and is always on.
- **Human-answer escape hatch.** The task instructs the agent: if an
  unexpected live person answers and the call seems to reach them personally
  rather than a business line, apologize briefly and end the call.
- **One call per check per invocation.** The host scheduler owns recurrence,
  so call volume is visible and controlled where schedules are reviewed.
- **No unconsented outreach by design.** There is no feature that calls
  numbers the operator has not verified or attested. "Free audit" growth
  tactics — calling businesses you do not control — are out of scope and
  unsupported.

## Operator duties

- **Only monitor lines you control or are authorized in writing to
  monitor.** For client lines (agencies, MSPs), keep the authorization in
  the client agreement and record it via the `attestation` ownership method
  so the audit trail names it.
- **Keep check frequency proportionate.** A canary that calls a line every
  minute burns money and can trip carrier robocall analytics. Business-hours
  cron schedules at 15–60 minute intervals are the intended shape.
- **Mind recording/transcription law.** Transcripts of calls are recordings
  in some jurisdictions (e.g. two-party-consent US states) even when both
  ends are yours. Monitoring your own lines with your own disclosure
  satisfies the common cases; consult counsel before monitoring lines in
  jurisdictions you do not know.
- **Respect the provider's terms.** CALL-E's terms prohibit unconsented
  calling, spam, impersonation and more; LineCanary's design keeps you
  inside them, but the account and the responsibility are yours.
