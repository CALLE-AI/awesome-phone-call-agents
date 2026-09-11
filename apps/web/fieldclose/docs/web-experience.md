# FieldClose Web Experience

## Status

The authenticated fake-provider and protected live-call web workflows are
implemented through normalized result review, generation of a human next
action, and the role-gated final disposition that resolves the task and closes
the FieldClose case.

The interface never calls CALL-E directly. It requests bounded application commands from the FieldClose server and renders only masked or normalized data.

## Design direction

The implementation follows
[ServiceNow-Inspired UX/UI Direction for FieldClose](servicenow-inspired-ux-ui-direction.md),
which translates selected public-site and Horizon Workspace patterns into the
focused FieldClose workflow without expanding the product boundary.

### Submission UI freeze

The current route map, primary navigation, workflow stages, result model, and
screen hierarchy are frozen through the hackathon submission. Pre-submission UI
work is limited to defects, accessibility and responsive corrections, clearer
safety copy, evidence capture, and a fictional preset that fills the existing
case form for the golden path.

The preset must not introduce a new route or stage, bypass exact-brief review,
select live mode, or approve an attempt. New dashboards, settings surfaces,
agent capabilities, question families, and navigation destinations are deferred
until after submission.

## Entry experience

The public `/` route is an operations-center preview rather than a marketing
hero. It immediately presents fictional work-order metrics, a compact closeout
queue, one operator action panel, the five-stage workflow, bounded agent
authority, human quality controls, and the fake-only demo boundary. This lets
evaluators understand the daily-use product structure before creating an
account without suggesting that any displayed record or call is real.

`Sign in` and `Explore demo workspace` open a URL-backed right-side account
drawer:

- `/?auth=signin` opens password or email-code access;
- `/?auth=signup` opens credential registration followed by six-digit email
  verification;
- GitHub OAuth remains a lower-emphasis evaluator action;
- an optional `returnTo` is accepted only when it starts with `/workspace`;
- Escape, the close button, overlay click, and browser history close the
  drawer without leaving the product context.

The legacy `/about` route redirects to `/#workflow`. An authenticated visitor
may still read the public site; its primary action changes to `Open workspace`.

After authentication, the application idempotently creates or returns the user's isolated fake-only demo workspace and lists every workspace the user can access. When an administrator has separately provisioned an eligible protected CALL-E workspace, the operator can switch to it from the workspace rail. A workspace is treated as live only when its persisted kind is `protected`, its provider is `call_e`, and live calls are allowed.

## Workspace routing

The operator workspace is URL-addressable:

- `/workspace` resolves the last accessible workspace and opens its case queue;
- `/workspace/[workspaceSlug]/cases` lists closeout cases;
- `/workspace/[workspaceSlug]/cases/new` creates one case;
- `/workspace/[workspaceSlug]/cases/[caseId]` runs the staged case workflow;
- `/workspace/[workspaceSlug]/exceptions[/caseId]` lists or inspects human
  exceptions;
- `/workspace/[workspaceSlug]/audit[/caseId]` selects or inspects append-only
  case history.

The slug is resolved to the existing workspace ID before API calls. Route
parameters, rather than parallel React selection state, identify the current
workspace, view, and case. Workspace switching stores only the last slug,
clears record context, and returns to the new case queue.

## Operator workflow

### 1. Create a fictional case

The form begins with safe demo values, including a North American `555-01xx` number. The operator supplies the work-order reference, fictional site, authorized role, timezone, completed-visit context, exact spoken reference text, and requested question families.

The UI labels internal technician notes separately from permitted spoken context. Fake mode supplies only fictional values. Live mode starts with blank contact fields and additionally requires an authorized E.164 number, a non-demo authorization basis, and a bounded authorization note. It does not let the browser assert provider state or bypass server-side live-call gates.

### 2. Review the exact brief

The preview presents:

- disclosure and represented contractor;
- masked recipient and timezone;
- exact objective and permitted reference text;
- approved questions;
- prohibited actions;
- voicemail and clarification boundaries;
- the abbreviated server-calculated brief digest.

The canonical phone number is never rendered.

### 3. Approve one attempt

The fake approval button remains disabled until the operator confirms all three conditions:

1. the fictional demo contact is authorized;
2. the exact purpose and questions were reviewed;
3. the operator understands that no real phone call will be placed.

The browser sends the reviewed case version, server digest, bounded calling-window data, and exact attestations. The server creates the attempt and idempotency key.

In live mode, the approval is visually distinct and requires four exact attestations: authorized contact, reviewed brief, authorization for one real CALL-E call, and confirmed recipient consent. The approval binds the recipient, case version, brief digest, consent record, and same-day local calling window to one attempt.

### 4. Run a deterministic simulation

The operator selects a named outcome such as clear closeout, return-visit request, wrong person, do-not-call, malformed provider output, or ambiguous creation timeout. The interface repeats `No phone call` immediately beside the execution action.

Only the scenario identifier reaches the API. The server route constructs the fake provider and the application layer independently rejects a provider labelled for live calls in a demo workspace.

### 5. Execute one protected live call

The live execution panel explicitly labels the action as an external side effect and places `Real phone call` beside the action. It never exposes the CALL-E API key or invokes the provider from browser code.

After the server stores the accepted call ID, the create action locks rather
than offering a retry. The workbench displays the provider call identifier,
`Status polling active`, and `Checking CALL-E status`, then asks the FieldClose
backend to refresh the existing call every five seconds before loading redacted
case state. If provider acceptance occurred but the local acceptance write did
not complete, the panel offers `Recover CALL-E acceptance`; that action reuses
the same attempt and provider idempotency key after the server's 60-second
creation-claim lease. During the lease, repeated execution stays `in_progress`
without a second provider invocation. At 600 seconds, an unresolved
final lookup moves the case to manual reconciliation; the operator can still
refresh that same call later without redialing.

Status polling is foreground-only. The first automatic check is scheduled about
five seconds after the accepted case detail is displayed. Leaving or closing
the page stops the timer because FieldClose has no background browser or server
worker for this loop. Reopening a nonterminal case loads the persisted accepted
attempt and resumes five-second status checks against that same provider call.
If the case already reached manual reconciliation, reopen leaves automatic
polling stopped and keeps the explicit `Refresh provider status` action.

### 6. Review the result

The result keeps provider task status separate from business recommendation. It shows:

- the normalized route;
- the bounded summary;
- contact verification;
- observed operating report;
- unresolved-issue and return-visit values with confidence;
- escalation evidence when present;
- the human next action.

Even a clear completed simulation is labelled `Ready for human closeout review`, never automatically closed.

### 7. Record the human disposition

After reviewing the result, an owner or operator can select only a
route-appropriate outcome:

- accept the closeout recommendation;
- record a return-visit handoff without confirming an appointment;
- record a manual follow-up handoff;
- record that no further automated action will be taken.

The control shows the current task and normalized evidence beside the decision,
requires a bounded note for either handoff, and submits the expected case
version and task identifier. It never offers scheduling, invoicing, diagnosis,
price, or external work-order mutation.

After a successful disposition, the view shows the resolved task, recorded
operator and timestamp, final FieldClose case status, and audit event. Repeating
the same submission returns that decision; a stale or conflicting submission is
rejected and reloads the current state.

## Exceptions and audit

The Exceptions view filters the workspace queue to cases in `needs_attention` or `failed` and displays their persisted human tasks and supporting result evidence.

The Audit view shows append-only case transitions in order, including a human-readable actor label, actor type, and timestamp. Raw actor identifiers stay in the append-only record but are not presented as operator-facing copy. It renders the redacted application history rather than provider transcripts or canonical contact data.

## Responsive and accessible behavior

- Primary views and actions use text labels rather than color or icon alone.
- Desktop views prioritize compact operational modules, data tables, action
  panels, status pills, and explicit five-stage progress over presentation
  sections.
- Fake mode is repeated in the header, workspace context, approval, and execution controls.
- Protected live mode uses a restrained amber treatment, explicit text, and four structural attestations; color is never its only warning.
- Switching workspace clears selected case and approval state before loading the newly scoped queue.
- Desktop record views keep the scoped queue beside the selected record.
  Mobile layouts use separate list and detail routes rather than a horizontal
  record carousel.
- The case-creation route is a full-width form at desktop, tablet, and mobile
  sizes. The mobile Cases list retains a single visible `New case` action even
  when records already exist.
- Native labels, fieldsets, legends, checkboxes, and status text support keyboard and assistive-technology use.
- Invalid case fields receive a field-specific message, `aria-invalid`, and
  focus. Safe not-found and access-denied states settle without leaving a
  loading indicator active.
- Field and form validation stays beside the affected input or form. Approval,
  execution, refresh, disposition, and sign-out failures use the single global
  action alert. A visible multi-field registration summary is not a second live
  region; the field-specific messages provide the alert announcements.
- Disabled approval communicates the three required attestations structurally.
- A skip link reaches the main content when focused.
- Reduced-motion preferences disable entrance, drawer, route, spinner, and
  smooth-scroll animation.
- The public account drawer and protected live workflow are verified at a
  390-pixel mobile viewport without horizontal overflow.

## Browser verification

The Playwright suite covers:

1. public operations preview, fictional queue, workflow, and guardrails;
2. legacy project-guide redirect into the merged homepage;
3. password, email-code, registration, verification persistence, and drawer
   focus/close behavior;
4. public mobile navigation and overflow protection;
5. deep-linked fictional case creation, brief review, approval, fake
   execution, normalized result, audit navigation, and browser history;
6. protected workspace selection, authorized live-case creation, exact
   four-attestation approval, one asynchronous CALL-E acceptance, locked
   bounded status-check state, and mobile overflow protection.

The authenticated browser tests intercept the HTTP boundary with deterministic fixtures. This proves browser behavior without weakening production authentication or requiring email delivery, GitHub, encryption secrets, PostgreSQL, or any live provider in the browser process. Separate PostgreSQL integration evidence exercises credential signup, hashed OTP verification, username/password login, email-code login, and one-time code consumption through the actual Better Auth handler. The live browser fixture asserts the exact `mode`, authorization evidence, four attestations, and protected execution request while remaining incapable of placing a phone call.

Run the browser evidence with:

```bash
pnpm test:e2e
```
