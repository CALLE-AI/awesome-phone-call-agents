# Devpost submission copy

## Project name
Rescue Relay

## Tagline
Bring the right help together—from the first report to a safe place.

## Inspiration
When someone stops to help an animal, finding a phone number is only the beginning. They still need to discover who can safely reach the animal, who can transport it, where it can be received, what each option costs, and whether the people involved have actually agreed to help.

Rescue Relay focuses on that gap: turning separate phone conversations into one clear, accountable rescue plan without taking the reporter out of the decision.

## What it does
The reporter describes what they see, gives the location and clarifies the outcome they are trying to achieve. Rescue Relay checks trusted, approved contacts for the services, availability and prices needed to fulfil that goal.

The first complete plan pauses the search. The reporter can keep it or ask for another option, compare complete plans and choose the one that works for them. Choosing an offer does not book anyone. A separate approval step confirms the selected helpers, tasks and price limits before those helpers receive confirmation callbacks.

The workspace then follows the rescue through human-confirmed updates. A helper agreeing to help is not treated as an automatic departure or arrival. The case closes only when the reporter records the outcome and confirms that the animal is safe.

## How we built it
Rescue Relay uses Python, FastAPI and SQLite, with a lightweight HTML, CSS and JavaScript interface. CALL-E’s REST API handles the live phone transport. The app submits a task for one approved saved destination, records the provider call ID, polls the result and analyses the saved recipient transcript turns. Availability inquiries and approved-helper callbacks have different purposes and permissions.

An optional OpenAI-compatible HTTPS endpoint supports intake and offer interpretation when its exact origin is explicitly allowlisted; redirects are disabled. Credential-free loopback `/v1` development is also supported. Other remote origins are rejected before any client or case-data request is created. A conservative built-in fallback makes the fictional demonstration reproducible without credentials.

The product demonstration and live experience share the same frontend and rescue workflow. The final recording was captured with Playwright by typing and clicking the running v5.6 app against an isolated fictional-data API. It is not a separate presentation interface.

## Challenges we ran into
The difficult part was not displaying a successful call. It was preserving the difference between an offer, an approval and an actual confirmed action. A conditional answer cannot be counted as coverage. A missing price cannot quietly become free. A comparison cannot silently change the reporter’s selected plan. A timeout cannot safely trigger an automatic redial.

Another challenge was making those boundaries understandable without filling the dashboard with implementation commentary. The final interface keeps the next action, price, helper status and closing note visible, while saved conversations and technical history stay available on demand.

## Accomplishments we are proud of
A complete end-to-end journey: report, clarification, comparable offers, explicit plan approval, selected-helper confirmation, progress and safe closure. The same report also supports unresolved conditions and incomplete callback recovery without discarding prior evidence.

The final package includes a reproducible short product demo, a longer chaptered user tutorial, responsive screens and automated checks for the decision boundaries—not just the happy ending.

## What we learned
A trustworthy calling experience needs more than a fluent conversation. It needs clear limits, preserved uncertainty and a visible point at which a person makes the decision. Removing repeated explanations made the workspace calmer without removing the approvals that matter.

## What is next
Validate the local live workflow with consenting rescue partners, then add the account isolation, access controls, privacy controls and operational supervision required before considering a real shared deployment. Explore a clearer handoff between responders and receiving teams based on their actual feedback.

## Built during the hackathon
Rescue Relay was created on September 4, 2026, during the submission period. The v5.6 release preserves IF/THEN/ELSE rescue goals through intake, planning and progress, and handles CALL-E `call_not_ready` responses without unsafe replacement calls.

## Built with
Python · FastAPI · SQLite · CALL-E REST API · HTTPX · JavaScript · HTML · CSS · Playwright · FFmpeg · optional OpenAI API

## Product demonstration and verification
Public video: https://www.youtube.com/watch?v=GcaoplYcIh0

Public mock-only product test: https://rescue-relay.onrender.com (HTTP Basic credentials are in Devpost’s private testing instructions.)

The public video is a 2:55 product demonstration of the running v5.6 application. It uses fictional test contacts, scenarios and USD prices to protect privacy while showing the complete working workflow. Live CALL-E transport is implemented in the submitted source through the documented Calls API.

---

## Fields to complete in Devpost, not in the public story

- Actual repository pull-request URL.
- Email associated with the submitting CALL-E account.
- Team details and, optionally, a verified fictional demo URL.

After the consented live check, update the verification note only with what actually occurred. Do not invent provider IDs, testimonials, adoption figures, money saved or rescue outcomes.
