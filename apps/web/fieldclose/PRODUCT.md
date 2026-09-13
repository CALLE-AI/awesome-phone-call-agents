# FieldClose

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary user:** owner-dispatcher or service coordinator at a small commercial HVAC contractor. They receive word that a technician has "finished" a job but the office still lacks customer confirmation, and it is their job to close the loop.

## Product Purpose

FieldClose turns "the technician is done" into "the job is actually closed." It converts a completed work order with missing customer confirmation into one human-approved CALL-E phone workflow and a structured, actionable follow-up for a human operator. Success means every uncertain closeout outcome ends in a trustworthy, recorded next step decided by a person, not by the agent.

## Positioning

The meaningfully different mechanism: **one human-approved phone call as the trusted closeout instrument.** Approval binds the exact recipient and exact call brief before any call can be placed; results that are uncertain or incomplete are never automatically closed. A competitor could not truthfully copy "recommendations never close work automatically."

## Operating Context

- Small commercial HVAC contractors; office-side dispatcher reviewing jobs remotely between site visits.
- Two runtime modes: a **fake-only public demo** (safe, no phone call) and a **protected staging environment** (CALL-E + SMTP configured; live calls paused until an operator authorizes the exact recipient and brief).
- Workflow: completed work order → dispatcher reviews contact/purpose/exact call brief → dispatcher explicitly approves one CALL-E call → CALL-E returns a structured result → ready for human closeout review → a person makes the final operational decision.
- Durable human decision boundary: no diagnosis, pricing, scheduling promise, invoice approval, payment handling, or automatic work-order closure by the agent.

## Capabilities and Constraints

- Approved-bound calling; uncertainty-preserving results; one-attempt duplicate protection; explicit human decision boundary; ambiguous-creation reconciliation; durable, role-gated human-disposition closure with audit evidence.
- Credential + email-code authentication, authenticated workspaces, protected HTTP API, protected-workspace operator UI, allow-listed protected-workspace provisioning with immutable administration evidence.
- Product scope and UI information architecture are **frozen for submission** (hackathon).
- No authorized live CALL-E result, end-to-end authentication-email delivery, GitHub OAuth, or general role-management UI is claimed yet.

## Brand Commitments

- Name: **FieldClose**. Tagline: "Turn 'the technician is done' into 'the job is actually closed.'"
- Mark: an F-shaped geometric logo (currently ink-green with an orange corner accent) — the mark shape is preserved, its colors may move with the palette.
- Voice: focused, human-first, explicit about the human decision boundary. "Every operational decision stays human."
- Visual direction (user-confirmed): **borrow the ServiceNow enterprise platform design language** (deep navy ink, bright accent, large-heading typography, enterprise component system), while keeping FieldClose's warmer, small-contractor-friendly character. Full frontend coverage: public home, sign-in, and the authenticated workspace.

## Evidence on Hand

- Public fake-only demo deployed at <https://fieldclose.dramaforge.icu/>; separate protected staging environment for integration evidence.
- Demo hero images in `public/images/`; brand mark in `public/brand/fieldclose-mark.svg` and concept logo PNG.
- `README.md` carries the full product definition, status, and competition focus.

## Product Principles

1. The human boundary is the product. Every recommendation, exception, and ambiguous outcome routes back to a person; the agent never closes work.
2. Approval precedes action. The exact recipient and exact call brief must be approved before a call is placed.
3. Uncertainty is preserved, not smoothed over. Results and confidence are shown with their source, never overstated.
4. Evidence is not a business decision. Provider-reported completion is technical state; closeout is a human decision.
5. Closeout is explicit. Progress through stages stays visible and a final operational decision is always made.

## Accessibility & Inclusion

No product-specific accessibility standard was established beyond web best practice; the interface is keyboard-operable and responsive across desktop and mobile.
