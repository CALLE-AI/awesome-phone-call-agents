# ServiceNow-Inspired UX/UI Direction for FieldClose

## Status and purpose

This design reference informed the implemented FieldClose public-home,
account-drawer, and route-addressable workspace optimization. It is based on a
visual and interaction review of the public ServiceNow website and the
official Horizon Design System on July 29, 2026.

It is not an instruction to clone ServiceNow's brand, marketing site, or full
Field Service Management product. FieldClose remains a focused,
human-approved commercial HVAC work-order closeout application.

## Direction summary

### Visual thesis

A calm, high-contrast operational workspace — deep blue-green navigation,
quiet light work surfaces, one vivid action accent, strong typography, and
minimal decorative chrome.

### Content plan

1. Orient the operator with workspace, mode, queue, and selected case.
2. Keep the exact closeout brief and current workflow stage dominant.
3. Place approval evidence and the next safe action beside the working content.
4. End every outcome with a clear human next step, never an autonomous close.

### Interaction thesis

- Use a restrained 160–220 ms transition when the selected case or workflow
  stage changes.
- Use a small directional motion on navigational links and row hover states to
  strengthen affordance.
- Keep approval, execution, and terminal-result state changes explicit and
  stable. Never animate a live-call action in a way that creates urgency.

All nonessential motion must respect `prefers-reduced-motion`.

## Implemented experience contract

- `/` is always the public product home. Signed-out account access uses
  `?auth=signin|signup`; signed-in visitors receive an `Open workspace`
  action.
- `/workspace/[workspaceSlug]/cases`, `/exceptions`, and `/audit` are link
  navigation, with case IDs added only on record detail routes.
- The public hero uses original commercial HVAC imagery with separate desktop
  and mobile art direction.
- Hero entrance, account-drawer presence, row affordance, and workspace
  content transitions are short and non-looping.
- Every view has at most one primary button. Navigation is rendered as links,
  while approval, execution, and form submission remain buttons.
- Reduced-motion mode removes transformations and looping spinners instead of
  accelerating them to a near-zero duration.

## What works well on ServiceNow

### 1. A recognizable visual system with few ingredients

The public site creates a strong identity with a dark blue-green foundation,
high-chroma green accent, large white type, generous spacing, and large image
planes. It does not need borders, shadows, or many component shapes to feel
complete.

FieldClose should adopt the discipline, not the exact brand:

- one dark shell color;
- one brand/action accent;
- quiet neutral work surfaces;
- semantic colors reserved for positive, warning, negative, and live-call
  states;
- typography, spacing, and alignment doing more work than shadows.

### 2. Clear primary and secondary calls to action

The ServiceNow home page commonly pairs a filled green capsule action with a
lower-emphasis outlined action. The contrast makes the preferred next step
obvious without hiding the alternative.

The official Horizon button guidance adds an important enterprise rule: use
only one primary button per display, use lower-emphasis variants for other
actions, use links for navigation, and start button labels with a concise verb.

For FieldClose, the pattern should become:

- one primary workflow action in the current stage;
- one secondary action for cancel, back, or preview;
- tertiary text actions for optional or repeated operations;
- separate positive and negative choices only when the operator is genuinely
  deciding between approval and refusal;
- a dedicated live-call treatment that cannot be confused with an ordinary
  brand action.

### 3. A single workspace instead of disconnected screens

ServiceNow describes Workspaces as single-pane experiences for high-volume
operators who manage records and follow structured workflows. Its basic model
is unified navigation, an application shell, and a page layout. Dispatcher
Workspace emphasizes a complete view, configurable filters, clear job status,
and focusing attention on exceptions.

That model fits FieldClose when kept within the product boundary:

- the case queue supplies orientation;
- the selected case remains in one working surface;
- the four closeout stages guide the operator;
- approval evidence and normalized results remain adjacent to the case;
- exceptions are prominent without turning the product into a dispatch,
  scheduling, or outbound-call dashboard.

### 4. Strong section rhythm

The public site alternates large visual planes, proof, short explanatory
blocks, and a focused call to action. Each section has one dominant idea.

For FieldClose, this should translate into workflow planes rather than
marketing sections:

- one heading and one purpose per stage;
- one dominant work area;
- supporting details grouped by meaning rather than placed in many cards;
- a stable location for the next action;
- progressive disclosure for audit evidence and advanced details.

### 5. Accessible structure is part of the design system

Horizon explicitly calls out keyboard access, visible focus, skip links,
logical tab order, semantic HTML, form labels, responsive reflow, contrast,
reduced animation, and high-contrast support.

FieldClose already follows several of these practices. A visual refresh must
preserve and strengthen them rather than replacing native controls with
decorative but inaccessible UI.

## What should not be copied

| ServiceNow pattern | Why it works there | FieldClose decision |
| --- | --- | --- |
| Auto-rotating campaign hero | Surfaces multiple marketing messages | Do not use in the operator workspace. It competes with task focus and can create motion fatigue. |
| Large promotional headline | Establishes a campaign idea | Keep only for public or guide pages. Use compact utility headings in the authenticated product. |
| Multiple marketing CTAs | Supports different visitor intents | Use one primary action per workflow display. |
| Broad product mega-navigation | Supports a large enterprise portfolio | Keep FieldClose navigation narrow: Queue, Exceptions, Audit, and account/workspace controls. |
| Large decorative image collages | Adds narrative and brand energy | Use product-state visuals, empty-state illustrations, or real contextual imagery only when they improve comprehension. |
| Generic green for every success or action | Reinforces the ServiceNow brand | Separate FieldClose brand action, completed state, approval, and live-call risk semantics. |
| AI sparkle as a universal shortcut | Creates a recognizable AI entry point | Do not add an assistant or diagnostic surface. FieldClose is not a general AI agent or HVAC diagnostic tool. |

## Recommended FieldClose button system

### Hierarchy

| Variant | Purpose | FieldClose examples |
| --- | --- | --- |
| Primary | The single key action in the current display | `Review brief`, `Approve fake attempt`, `Run simulation` |
| Secondary | A supplemental action | `Cancel`, `Back to brief`, `View details` |
| Tertiary | Optional or repeated action | `Copy reference`, `Open audit`, `Change workspace` |
| Positive | Confirm one side of an explicit approve/decline decision | `Approve attempt` only when paired with a clearly available refusal or cancel action |
| Negative | Destructive or irreversible action | `Revoke approval`, if such a product action is added later |
| Live-call | A real-world side effect requiring exact authorization | `Place approved live call` |

Navigation labels such as `Project guide` or `Open case` should be links, not
buttons, unless they perform an in-place application action.

### Shape and size

- Public, sign-in, and large empty-state CTA: 48 px high, capsule radius, and
  20–24 px horizontal padding.
- Dense workspace action: 40–44 px high, 10–12 px radius, and 16–20 px
  horizontal padding.
- Critical mobile action: at least 48 px high and full width when appropriate.
- Icon-only control: at least 44 by 44 px, with an accessible name and tooltip.
- Related action groups should use the same button shape and size.

Do not make every field, row, label, and panel pill-shaped. The capsule is an
action signature, not a universal container.

### Color roles

The ServiceNow homepage colors observed during review included a dark
blue-green background and vivid green actions. FieldClose can use that
relationship as inspiration while maintaining a distinct palette.

| Role | Direction |
| --- | --- |
| App shell | Deep blue-green or navy |
| Primary brand action | Bright but contrast-checked green |
| Light canvas | Warm or cool near-white |
| Work surface | White or a minimally tinted neutral |
| Main text | Very dark blue-green |
| Muted text | Neutral slate with sufficient contrast |
| Selected/information | Teal or blue distinct from the action green |
| Completed | Accessible success green distinct from brand green |
| Warning/live preparation | Amber with text and icon |
| Destructive or live execution | Red or deep warning tone with explicit `Real phone call` copy |

The live-call action must never use the ordinary green brand treatment. Green
can imply safety or completion and would understate the external side effect.

### States

Every button must define:

- default;
- hover;
- pressed;
- keyboard focus;
- disabled;
- loading or submitted.

Recommended behavior:

- hover changes color or border and may move a directional icon by 2–4 px;
- pressed returns the element to the surface or translates it by 1 px;
- focus uses a high-contrast 2–3 px outer ring, not color alone;
- disabled controls keep a readable label and expose the reason nearby;
- loading preserves the button width and changes the label to a specific
  progress phrase;
- a submitted live-call action locks and becomes a stable waiting state rather
  than returning to an enabled button.

### Labels

Use a short verb plus object:

- `Create case`
- `Review brief`
- `Approve attempt`
- `Run simulation`
- `Place approved live call`
- `Open audit`

Avoid vague labels such as `Continue`, `Submit`, `Yes`, or `Go` when the exact
effect matters.

## Recommended authenticated workspace

### Desktop

1. **Global shell**
   - Dark, sticky header.
   - FieldClose brand and fake/live mode at the left.
   - Primary navigation in the center or immediately after the brand.
   - Workspace, account, and one page-level action at the right.

2. **Case rail**
   - 280–320 px wide.
   - Queue count, restrained filters, and scan-friendly case rows.
   - Selected row uses surface change plus a left indicator, not color alone.
   - Exceptions show status, reason, and next human task.

3. **Primary work area**
   - Compact record header with work-order reference, site, stage, and mode.
   - Four-stage progress remains visible without becoming a large banner.
   - The exact brief, form, simulation, or result is the dominant content.
   - Avoid a marketing-style hero in this operational surface.

4. **Context and action area**
   - Approval attestations, safety boundary, digest, and next action stay close
     to the content they govern.
   - Use a right inspector on wide displays or an inline section on narrower
     displays.
   - Keep the main action right-aligned and in a stable location.

### Mobile

- Reflow to one column at 320 px without horizontal scrolling.
- Move the case rail into a labeled drawer or queue view.
- Keep the selected case reference and fake/live mode visible.
- Stack actions with the primary action last in reading order and visually
  strongest.
- Keep critical approval evidence above the live-call action.
- Use sticky actions only when they do not hide warnings, errors, or the exact
  recipient and brief context.

## Recommended stage treatments

### Create

- Divide the form into Work order, Authorized contact, Visit context, and
  Approved questions.
- Keep native labels and fieldsets.
- Use a two-column grid only when related fields remain readable.
- Put helper text immediately under the relevant control.
- Replace helper text with the field error when both would repeat the same
  requirement, and focus the first invalid field.
- Keep the form as a full-width single column below the desktop workspace
  breakpoint; never apply list/detail hiding rules to the creation route.
- Keep `Create case` as the only primary action.

### Review and approve

- Present the exact spoken brief as the visual anchor.
- Group disclosure, permitted facts, approved questions, prohibited actions,
  and voicemail boundaries with clear headings and dividers.
- Put the digest and masked recipient in a stable metadata area.
- Show attestation progress explicitly; do not rely on a disabled button alone.

### Execute

- Fake mode uses the normal brand primary action and repeats `No phone call`.
- Live mode uses a distinct warning surface, exact recipient context, calling
  window, approval evidence, and a dedicated live-call button.
- Never introduce urgency, countdowns, pulsing effects, or optimistic success
  animation around a real call.

### Result

- Lead with provider task status and human recommendation as separate fields.
- Use one concise outcome summary.
- Show confidence and unresolved values in a consistent aligned structure.
- Make the human next action more prominent than decorative success treatment.
- Keep `Ready for human closeout review` instead of implying automatic closure.

## Motion and interaction details

### Motion patterns observed on ServiceNow

The public site uses several distinct motion layers:

- The home-page campaign carousel rotates automatically but provides visible
  slide dots and a pause/play control.
- Primary and secondary CTA color and border changes use approximately
  200 ms transitions.
- The desktop mega-navigation opens with an approximately 300 ms opacity
  transition. Supporting arrow indicators also transition rather than jumping
  between states.
- Customer logos move in a continuous horizontal marquee.
- Large marketing sections use scroll-led storytelling, where imagery and
  message states progress as the visitor scrolls.
- Content carousels provide pause, previous, and next controls.
- Product showcase tabs keep the navigation position stable while changing the
  dominant visual and message.

The official Horizon Animation guidance is more conservative than the
marketing site: autoplay is off by default, looping is off by default,
animation should be context-relevant, and each animation should have a clear
focal point and accessible alternative. Unified Navigation also exposes a
Reduced Motion preference.

### What FieldClose should learn from those patterns

1. **Continuity**
   - Keep the surrounding workspace stable while the selected case or workflow
     stage changes.
   - Animate the changed region rather than the entire page.

2. **Causality**
   - Motion should follow an operator action or a real state update.
   - The source and destination of a drawer, inspector, selection, or status
     change should be visually understandable.

3. **Control**
   - Do not autoplay operational content.
   - Any nonessential animation that lasts, repeats, or advances content must
     have a pause or stop mechanism.

4. **Calm**
   - Prefer opacity, color, border, and short translation changes.
   - Avoid springy overshoot, large scale changes, bouncing, or continuous
     decorative movement.

5. **Safety**
   - Approval and live-call motion must reduce ambiguity rather than create
     urgency.
   - Real-world side effects require stable labels, context, and submitted
     states.

### Motion tokens

These are recommended FieldClose targets, not copied ServiceNow tokens.

| Token | Duration | Intended use |
| --- | --- | --- |
| Instant | 0–80 ms | Pressed state, checkbox mark, local value update |
| Micro | 120–140 ms | Icon, underline, focus-adjacent affordance |
| Standard | 160–180 ms | Button, row hover, selection, status color |
| Content | 200–220 ms | Stage content or inspector replacement |
| Overlay | 240–280 ms | Queue drawer, dialog, right inspector |
| Maximum | 320 ms | Large navigation or layout transition |

Recommended easing:

- enter: `cubic-bezier(0.2, 0.75, 0.2, 1)`;
- exit: `cubic-bezier(0.4, 0, 1, 1)`;
- state change: `cubic-bezier(0.4, 0, 0.2, 1)`;
- linear: only for determinate progress or a simple indeterminate spinner.

Recommended movement:

- icon or arrow: 2–4 px;
- row or small content entrance: no more than 4–6 px;
- panel or inspector: no more than 8–16 px;
- scale: avoid by default; if required for a pressed state, keep it between
  `0.98` and `1`.

Do not combine opacity, translation, scale, blur, and shadow changes on one
routine interaction. One or two properties are enough.

### FieldClose motion specifications

| Interaction | Recommended behavior | Avoid |
| --- | --- | --- |
| Primary button hover | Color or border transition over 160–180 ms | Glow, bounce, or large lift |
| Button press | 1 px downward movement or `scale(0.99)` for up to 80 ms | Long compression or elastic return |
| Text link hover | Underline reveal or arrow movement of 2–4 px over 120–160 ms | Moving the full label |
| Queue row hover | Quiet surface change over 140–160 ms | Shifting content enough to disturb scanning |
| Queue row selection | Surface plus left indicator transition over 160–180 ms | Flashing or pulsing selection |
| Workflow stage change | Old content exits quickly; new content fades and rises no more than 6 px over 180–220 ms | Sliding the entire application horizontally |
| Drawer or inspector | Short 8–16 px entrance plus opacity over 240–280 ms | Full-screen parallax or spring overshoot |
| Form validation | Error text appears beside the field; optional 120 ms color transition | Shaking fields or moving unrelated content |
| Approval checklist | Checkmark and progress copy update once over 120–160 ms | Celebratory animation before execution |
| Fake simulation start | Button locks, label changes, and a local progress indicator appears | Implying that a real call is happening |
| Live-call submission | Button locks immediately and becomes a stable `Call submitted` or waiting state | Pulse, countdown, retry animation, or optimistic success |
| Provider status polling | Update status text and timestamp in place | Replaying the entire panel entrance every five seconds |
| Terminal result | One stable state transition and prominent human next action | Confetti, fireworks, or automatic closeout motion |
| Toast or notice | Fade and move no more than 6 px; remain long enough to read | Auto-dismiss of critical safety information |

### Marketing motion that should remain outside the workspace

- Continuous logo marquees.
- Auto-rotating case or result carousels.
- Letter-by-letter headline reveals.
- Scroll-jacked or pinned storytelling.
- Parallax imagery.
- Animated AI sparkle entry points.
- Large visual transformations between workflow stages.

A restrained scroll-led explanation may be appropriate on the public project
guide, but it should never control the authenticated closeout workflow.

### Loading and progress

- Prefer content skeletons for initial queue or record loading when the shape
  of the content is known.
- Use a spinner only for a bounded local wait with nearby progress copy.
- Preserve the previous stable content during background refresh when it is
  still valid.
- Do not replace an entire page with a spinner for a local action.
- Never use motion as the only evidence that work is in progress.
- Provider acceptance and terminal completion must remain separate visual
  states.

### Reduced motion and accessibility

With `prefers-reduced-motion: reduce`:

- remove translation, parallax, marquee, automatic carousel, and layout motion;
- replace stage and drawer movement with an instant or short opacity change;
- stop repeated decorative animation;
- replace a rotating spinner with static progress iconography plus explicit
  text when possible;
- keep focus movement, status announcements, and error messages intact.

The current global reduced-motion rule shortens every animation to `0.01ms`.
Because the loading spinner is infinite, shortening its duration can create
extremely rapid rotation rather than a calm static fallback. A future motion
implementation should explicitly disable the spinner animation and retain
readable progress text in reduced-motion mode.

Visual motion does not replace application semantics:

- move focus deliberately when opening or closing modal UI;
- use `aria-live="polite"` for background status updates;
- use `role="alert"` for blocking errors;
- expose expanded, selected, busy, and submitted states programmatically;
- never announce every polling tick when the meaningful state has not changed.

## Existing FieldClose strengths to preserve

- Focused two-region workbench with a case rail and selected-case surface.
- A visible four-stage human-approved workflow.
- Repeated fake/live mode labeling.
- Masked contact data and bounded provider output.
- Native labels, fieldsets, legends, checkboxes, and a skip link.
- Separate provider status and human recommendation.
- Explicit attestations and locked asynchronous live-call waiting state.

## Highest-value changes for a future implementation

### P0 — workflow clarity and safety

1. Formalize the button hierarchy and enforce one primary action per display.
2. Give live-call execution a dedicated semantic variant distinct from brand
   green.
3. Move page-level actions to a consistent top-right position.
4. Strengthen focus, disabled-reason, loading, and submitted states.
5. Keep the exact brief, masked recipient, and mode adjacent to approval and
   execution.
6. Correct the reduced-motion loading indicator so it becomes static instead
   of rotating at an extremely short duration.

### P1 — visual system and workspace structure

1. Introduce the dark shell plus quiet surface system.
2. Reduce the authenticated page-title scale so the work surface appears in
   the first viewport.
3. Replace unnecessary borders and panel chrome with spacing and surface
   hierarchy.
4. Refine queue rows for faster scanning and clearer exception priority.
5. Add a consistent responsive queue/drawer and context-inspector behavior.

### P2 — polish

1. Implement the shared motion tokens for stage, row, link, and drawer
   transitions.
2. Improve empty states with one useful action and minimal illustration.
3. Tune density for operator preference without changing the information
   architecture.
4. Verify light, dark-shell, forced-color, reduced-motion, and 320 px reflow
   behavior.

## Acceptance criteria for the future UX/UI pass

- Each display has no more than one primary action.
- Buttons use concise verb-first labels that describe the exact effect.
- Links navigate; buttons perform actions.
- All pointer targets are at least 44 by 44 px where practical.
- Keyboard focus is visible on every interactive control.
- Text and non-text contrast meet the project's selected WCAG target.
- The application reflows to 320 px without loss of content or function.
- Reduced-motion users receive no nonessential animation.
- Reduced-motion mode does not accelerate an infinite spinner or other loop.
- Operational content never advances automatically.
- Repeated or long-running nonessential motion provides a pause or stop
  control.
- Workflow motion does not move the exact brief, approval evidence, or
  live-call warning out of view before the operator acts.
- Fake mode and `No phone call` remain explicit near fake execution.
- Live-call execution is not styled like an ordinary positive or brand action.
- The exact masked recipient, brief, authorization evidence, and calling
  window remain visible before a live call.
- Wrong-person, refusal, do-not-call, voicemail, no-answer, partial-answer,
  ambiguous-result, and escalation paths remain structurally supported.
- No design change expands FieldClose into diagnostics, quoting, payments,
  dispatch, scheduling, marketing calls, or autonomous work-order closure.

## Sources

- [ServiceNow public website](https://www.servicenow.com/)
- [About Horizon](https://horizon.servicenow.com/getting-started/about-horizon)
- [Horizon Button guidance](https://horizon.servicenow.com/workspace/components/now-button)
- [Horizon Animation guidance](https://horizon.servicenow.com/workspace/components/now-animation)
- [Horizon Accessibility overview](https://horizon.servicenow.com/guidelines/accessibility/a11y-overview)
- [Horizon Color contrast and APCA](https://horizon.servicenow.com/guidelines/accessibility/color-contrast)
- [Horizon Unified navigation](https://horizon.servicenow.com/guidelines/unified-navigation)
- [Horizon App frameworks](https://horizon.servicenow.com/getting-started/app-frameworks)
- [Horizon Workspace overview](https://horizon.servicenow.com/workspace/overview)
- [Horizon Workspace structure](https://horizon.servicenow.com/workspace/basics/structure)
- [Horizon Grids and layouts](https://horizon.servicenow.com/workspace/foundations/grids-and-layouts)
- [ServiceNow Dispatcher Workspace](https://www.servicenow.com/products/dispatcher-workspace.html)
