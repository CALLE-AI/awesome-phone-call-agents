# Arc - Brand & UI Direction (v1.1)

Hand this to Claude Code as the source of truth for all visual work.
Work on branch `feat/branding`. Do not merge to `main` until the landing page is signed off.

**v1.1 amendments (post-audit).** The audit in §1 has been run; its findings changed two
instructions in v1. Both are corrected in place below - see §1 (dark-mode instruction, void)
and §8 (hex criterion, rescoped). New §9 defines the scope tracks that replace
"convert the whole app". Where v1 and v1.1 disagree, v1.1 wins.

---

## 0. Hard constraints - read before writing any code

- **Tailwind only.** Do not add a component framework (HeroUI, MUI, Chakra, Mantine). If a primitive is needed, use **shadcn/ui** - it copies source into the repo and is driven by the same tokens.
- **Zero hardcoded colors in components.** Every color goes through a token. If you write `#` or `rgb(` inside a `.tsx` file, that is a bug.
- **Light mode is the default now. Dark mode ships later off the same token names.** So never name a token `--white` or `--gray-900`. Name it by role: `--surface`, `--ink`, `--muted`. When dark mode arrives, only the values change - no component is touched.
- **Presentation layer only.** Do not change API routes, data fetching, auth, or CALL-E integration logic. If a visual change requires a logic change, stop and flag it.
- Quality floor, no announcement needed: responsive down to 375px, visible keyboard focus rings, `prefers-reduced-motion` respected.

---

## 1. First task - audit, then report back

Before changing anything, run and report:

```bash
cat package.json | grep -E '"(tailwindcss|next|react)"'
head -80 app/globals.css
ls components/ui 2>/dev/null
grep -rn "#[0-9a-fA-F]\{3,6\}" app components --include=*.tsx | wc -l
grep -rn "dark:" app components --include=*.tsx | wc -l
```

Report four things:
1. Tailwind v3 or v4 (this decides whether tokens live in `tailwind.config.ts` or in `@theme` inside `globals.css`)
2. Is shadcn/ui already installed
3. How many hardcoded hex values exist
4. How many `dark:` variants exist

**If hardcoded hex count is above ~40, stop and clean that up first.** Converting those to tokens is the whole job - re-theming after that is trivial. Do not start restyling pages on top of a scattered color layer.

~~The existing `dark:` classes are a trap. The app is currently dark-first. Do not invert them one by one. Strip them, make light the base, and re-add dark later as a single `[data-theme="dark"]` block that overrides token values only.~~

**VOID (v1.1).** The audit found **zero** `dark:` variants. The app is dark-first, but through
**inline `style={{}}` objects**, not Tailwind variants - 1,374 of 1,516 hex sit inline, `0` are
arbitrary values like `bg-[#2e2b50]`, and 38 of 53 `.tsx` files use `style={{`. There is nothing
to strip. The real conversion work is inline style objects to token-driven classes, which is a
larger job than v1 assumed - hence the scope tracks in §9.

The forward-looking half of the instruction still stands: **light is the base, and dark arrives
later as a single `[data-theme="dark"]` block that overrides token values only.**

---

## 2. Palette

Pastel-editorial. Soft colored fields, pure-white cards, near-black type. Confident and playful - not corporate SaaS, not neon dark-mode dev tool.

| Token | Hex | Use |
|---|---|---|
| `--bone` | `#FBFAF7` | page background, warm off-white |
| `--paper` | `#FFFFFF` | cards, panels |
| `--ink` | `#141118` | all primary text, primary button fill |
| `--graphite` | `#6C6676` | secondary text, labels, captions |
| `--hairline` | `#E8E4EF` | borders, dividers, table rules |
| `--lilac` | `#DCD8FB` | field/section background |
| `--lilac-deep` | `#A79BF2` | chart fill, active state |
| `--blush` | `#FBC7E6` | field/section background |
| `--blush-deep` | `#F08FCE` | chart fill, emphasis |
| `--butter` | `#FAEDA1` | highlight marker, secondary button |
| `--butter-deep` | `#F2D64F` | chart fill, warning-adjacent |

Semantic aliases (components use only these):
`--bg: --bone` / `--surface: --paper` / `--text: --ink` / `--text-muted: --graphite` / `--border: --hairline` / `--primary: --ink` / `--primary-fg: --paper` / `--accent: --butter`

**Pastels are fills only, never text.** (v1.1, added after the Track C audit.)
Measured against `--paper`: `--lilac-deep` 2.44:1, `--blush-deep` 2.20:1,
`--butter-deep` 1.45:1 - all fail WCAG AA for body text. Text is `--ink` or
`--graphite`, full stop. Pastels carry meaning as backgrounds, chart fills,
pill fills and tuner segments.

**Status tokens** (approved v1.1 - the pastel palette has none, and the app has
215 status occurrences). Each is contrast-checked as text on both `--paper` and
`--bone`; the `-bg` companions are fills only.

| Token | Hex | On paper | Use |
|---|---|---|---|
| `--success` | `#1F7A5C` | 5.25:1 | success text and icons |
| `--success-bg` | `#DDF3E9` | fill | success pill/field |
| `--warning` | `#8A5A00` | 5.93:1 | warning text |
| `--warning-bg` | `--butter` | fill | warning pill/field |
| `--danger` | `#C4356B` | 5.16:1 | error text, destructive action |
| `--danger-bg` | `#FBE4EE` | fill | error pill/field |
| `--focus` | `--lilac-deep` | - | focus ring; visible on bone AND on the ink button |

**Primary button is near-black with white text.** Not lilac, not a gradient. The pastels are fields and fills; the black is the action. This contrast is what makes the reference look expensive instead of soft.

**Density rule.** On the landing page, pastel fields may cover large areas. Inside the authenticated app, pastel covers no more than ~15% of any screen - white cards on `--bone`, pastel reserved for status pills, chart fills, and the tuner strip. Dense data on a pastel field is unreadable.

---

## 3. Typography

Three roles. Load via `next/font/google`, subset `latin`, `display: 'swap'`.

- **Display - Gabarito.** Bold geometric with warm, slightly quirky terminals. Headings only, weights 600-800, tracking `-0.02em`. Do not use it for body text.
- **Body - Inter.** Weights 400/500. `font-feature-settings: "cv11"` for a friendlier lowercase l.
- **Data - JetBrains Mono.** Weight 500, only for frequencies (`101.6 FM`), station call signs, timestamps, rates, and durations. This is not decoration - tabular alignment is functionally correct for rate cards and airtime grids, and mono reads as broadcast-native.

Scale (clamp for fluid sizing):
```
display   clamp(2.75rem, 6vw, 4.5rem)   Gabarito 800  -0.03em  1.05
h1        clamp(2rem, 4vw, 3rem)         Gabarito 700  -0.02em  1.1
h2        1.75rem                        Gabarito 700  -0.02em  1.2
h3        1.25rem                        Gabarito 600  -0.01em  1.3
body      1rem                           Inter 400              1.6
small     0.875rem                       Inter 400              1.5
label     0.75rem                        Inter 500   0.04em  uppercase
data      0.875rem                       JetBrains Mono 500     tabular-nums
```

**Highlight marker.** Reference uses a butter-yellow block behind key words. Build it as a reusable `<Mark>` component - inline, `--butter` background, ~0.15em padding, 4px radius, sits behind the text baseline. Use it at most **once per screen**. It stops working the moment it repeats.

---

## 4. Shape and depth

```
radius-card     24px
radius-control  12px
radius-pill     999px
```

One shadow only, on cards:
```
0 1px 2px rgba(20,17,24,0.04), 0 8px 32px rgba(20,17,24,0.06)
```

No shadow on buttons, inputs, or pills. No gradients except inside the tuner strip. No glassmorphism, no borders on cards that already have a shadow.

Spacing: 4px base scale. Cards get 24-32px internal padding. Sections get 96-128px vertical rhythm on the landing page, 32-48px inside the app.

---

## 5. Signature element - the tuner strip

This is the one thing Arc is remembered by. Build it once, reuse it in two places.

A horizontal segmented band, like an FM dial. Segments in `--lilac` / `--blush` / `--butter` at varying widths, separated by 2px `--bone` gaps, `--hairline` tick marks above, mono labels below.

- **On the landing page:** it is the hero. Segments are stations. Labels are real frequencies. A subtle scroll-triggered fill animation on load, once, then still.
- **Inside the app:** it is the daypart/airtime visualization on a media plan. Segments are time blocks, widths are actual durations, labels are dayparts. Same component, real data.

Because it does a real job in the product, it reads as identity rather than decoration. Do not add floating pastel blobs, orbs, or mesh gradients anywhere - the strip is the entire visual signature and it is enough.

---

## 6. Work order

Do not go page by page. Build bottom-up, and stop for review after each stage.

1. **Tokens** - CSS variables in `globals.css`, wired into Tailwind (`@theme` for v4, `theme.extend` for v3). Fonts loaded. Nothing else.
2. **Primitives** - Button (primary/secondary/ghost), Input, Select, Card, Badge/Pill, Table, Tabs, Dialog, Toast. If shadcn/ui is installed, re-theme the existing ones rather than writing new.
3. **Kitchen sink page** at `/dev/ui` showing every primitive in every state - default, hover, focus, disabled, loading, error. **Screenshot this and show me before moving on.** This is the review gate.
4. **App shell** - nav, sidebar, page header, empty states.
5. **Landing page** - full pastel strength, tuner strip hero.
6. **App screens** - campaign review, media plan, call cards. Density rule applies.

Delete `/dev/ui` before the final submission build, or keep it behind a dev-only guard.

---

## 7. Copy rules

Words are design material here, not filler.

- Buttons name what happens: "Call the shortlist", not "Submit". The action keeps the same name through the flow - a button that says "Call" produces a toast that says "Calling".
- Sentence case everywhere except `label` tokens.
- Empty states are an invitation, not an apology: "No stations shortlisted yet. Add one to start calling."
- Errors say what broke and what to do: "Couldn't reach that number. Check the country code and try again." Never "Something went wrong."
- Speak the user's language, not the system's: "stations", "creators", "airtime", "rate card" - never "records", "entities", "payloads".

---

## 8. Definition of done for this branch

- [ ] Zero hardcoded hex in **Track A and Track B files only** (see §9). Track C is explicitly out of scope and will still contain hex - that is expected, not a failure.
- [ ] `/dev/ui` renders every primitive in every state, screenshotted and approved
- [ ] Landing page **rebuilt from scratch** (new files, not converted) light-mode with tuner strip hero
- [ ] `npm run build` passes clean
- [ ] Keyboard tab order works, focus rings visible on every interactive element
- [ ] Renders correctly at 375px, 768px, 1440px
- [ ] No dark-mode work started yet - tokens are structured so it is a values-only change later

---

## 9. Scope tracks (v1.1)

### Handoff — state of `feat/branding`

**Shipped today.** Design system (tokens, fonts, primitives in `components/ui/`,
`/dev/ui` kitchen sink), landing page rebuilt with original copy, auth screens,
the five-step campaign wizard, onboarding **deleted** and replaced by
`getOrCreateBrand`, the app shell on every route, and every main screen
redesigned: dashboard, campaigns, radio, influencers, analytics, billing.

**Data honesty pass.** The dashboard was rendering three fabricated campaigns
over the real ones - removed. Radio said "8 of 239", influencers said "312
verified" - both now report the real catalogue count of 8. Analytics shows an
empty state at zero campaigns and a SAMPLE-marked UI otherwise. Invoices are
marked SAMPLE. See the standing rule below.

**Outstanding, and it shapes tomorrow.**

- **The attribution section was REMOVED from analytics, not marked.** Funnel,
  the three attribution models, conversion rates, ROAS and attributed revenue
  were roughly half the page with nothing behind them. A SAMPLE pill over that
  much area tells a reader the feature does not exist, slowly; cutting says it
  once. **To bring it back it needs, in order:** conversion tracking (a pixel
  or a link-attribution scheme - neither exists), revenue per conversion (no
  order value is stored anywhere), and a touchpoint log tying an exposure to a
  conversion. Removed with it, for the same reason: the 30-day reach chart (no
  time series exists - only createdAt and bookedAt), the best-performing time
  slots chart (no traffic-lift data), the average-engagement card (no source),
  the report generator (produced no file), and the date-range and chart-metric
  filters (filtered nothing once the chart went).
- **Analytics has three states, and most brands see the middle one.** No
  campaigns, campaigns-but-no-plan-data, and real figures. Only one brand in
  the database has plan data; every other brand's campaigns predate the wizard
  storing one, so they get a page saying reporting starts with the next
  campaign rather than a wall of zeros.
- **"Committed", never "spend".** `SUM(bookedTotalPkr)` is what a brand has
  committed to, not what it has paid - no payment is tied to a campaign
  anywhere in the app. `lib/analytics.ts` is the single query behind both the
  analytics page and the dashboard card so the two cannot disagree.

- **B-01 shipped four booking states, not eight - deliberately.** A line on a
  media plan reaches `SELECTED` -> `CALLING` -> `CONFIRMED` / `DECLINED` ->
  `BOOKED`, and `MediaPlanItem` now carries the terms (`spots`,
  `bookedDates`, `bookedSlots`, `bookedTotalPkr`, `bookedAt`) alongside the
  estimate and the call-confirmed rate. `MediaPlanItem` IS the booking object;
  no parallel `Booking` model was added, and the one that used to exist was
  dropped for being empty and unreferenced.
  **Not modelled, and why:**
  - `pending_approval` - needs a station-side actor. There are no station
    accounts, no portal and no inbound channel, so nobody can approve.
  - `live` - needs flight dates on the line and a clock. `Campaign.flightStart`
    and `flightEnd` are null on every row, because the brief captures a
    duration in days and never a start date.
  - `delivered` - needs proof: airtime logs, post URLs. Nothing collects any.
  - `reconciled` / `disputed` - need payments tied to a line. Stripe's webhook
    only touches `Brand.plan`; JazzCash only reads `brandUser`. Neither knows
    a campaign exists.
  Adding any of these means adding the thing underneath first. A state whose
  transition nothing can trigger is a label, not a state.

- **TOP ITEM - the CALL-E success path is unproven, and the route is the
  blocker, not our code.** `persistCompletedCall` writing a real result,
  `rate_per_spot` reaching `MediaPlanItem.confirmedRatePkr`, and a line
  reaching CONFIRMED have never run against a real completed call.

  **What the provider constraint is.** Outbound to Pakistan is not reliably
  available to this account: connection is intermittent, and on the calls that
  do connect the speech recognition on that route has mangled spoken numbers -
  which is fatal when `rate_per_spot` must arrive as a number. Neither is
  tunable from our side; the API and SDK expose no audio, codec or voice
  controls, only `locale` and `region`.

  The per-call measurements, configurations and provider identifiers behind
  that are held privately and go to CALL-E on request. They are not published
  here: they describe calls to people who answered a cold call and did not
  agree to appear in a public repository.

  **To prove the success path without Pakistan:** one answered call to a
  supported region. That needs a number somebody can actually answer.

  **The simulated path is verified end to end and is the demo fallback.** With
  no `CALLE_API_KEY`, `/api/calle/confirm` returns immediately, persists the
  Call row with `mock: true` and `outcome: RESULT`, the card shows a
  **SIMULATED** badge, the plan line reaches CONFIRMED, and booking and
  campaign detail follow. Campaign detail marks a confirmed rate that came
  from a simulated call with a **Simulated** pill beside it - without that,
  a generated rate rendered identically to one heard on a real call.

- **TOP ITEM - the CALL-E success path is unproven.** `persistCompletedCall`,
  `rate_per_spot` landing in `MediaPlanItem.confirmedRatePkr`, and a line
  reaching `CONFIRMED` have never run against a real completed call. Blocked,
  not broken: two live calls to the second demo handset were rejected downstream at
  zero seconds with no transcript - SIP **486 Busy Here**, then SIP **480
  Temporarily Unavailable**, both reported by CALL-E as
  `failure_code: call_failed`. Neither was `unsupported_region`, so CALL-E
  placed the calls and the destination carrier rejected them; the signature is
  carrier-side filtering of inbound international calls into Pakistan.
  Pakistan IS supported, but on an **International** line region that CALL-E
  documents as "primarily intended for testing" - a local PK line must be
  requested from them.
  **To prove it:** one answered call to a **Local**-region number - US (+1),
  Singapore (+65), Malaysia (+60), UAE (+971), Australia (+61), Mexico (+52)
  or Brazil (+55). CALL-E provides no test or sandbox number, so a real
  answerable number is required, and the person answering has to quote a rate
  when asked or the structured result comes back empty and proves nothing.
  UAE is the best fit: it is the only Local country already in Arc's own
  market data (`City.DUBAI`, `City.ABU_DHABI`).
  The FAILURE path is proven - verified twice against real rejected calls,
  writing no verdict, no rate, and leaving every confirmed column null.
  **Correction to the earlier reading:** this is probably NOT carrier
  filtering. CALL-E's event stream shows both calls `in_progress` for roughly
  two minutes before failing, not an instant rejection, and both were placed
  at **02:24 and 02:38 in the morning Pakistan time** (21:24 / 21:38 UTC).
  486 Busy Here and 480 Temporarily Unavailable are what a phone on Do Not
  Disturb at half past two in the morning returns. Retry during Pakistani
  daytime before concluding anything about the route.

- **DONE - the media plan now persists.** `Campaign` gained the plan's
  aggregates (`budgetTotal`, `currency`, `durationDays`, `estStationCost`,
  `estInfluencerCost`, `estPlatformFee`, `estTotalCost`, `estTotalReach`) and
  a `brief` Json column; `MediaPlanItem` holds one row per selected station or
  creator with the estimate and the call-confirmed figures side by side;
  `CampaignScript` holds the scripts as edited; `Call` holds one row per
  CALL-E attempt, with `mock` as a column so a simulated call stays
  distinguishable forever. `Booking` was dropped - 0 rows, zero references.
  Baselined with `migrate resolve --applied` and applied with
  `migrate deploy`; the 18 pre-existing campaigns kept every row and simply
  carry nulls. They are NOT back-filled: a plan that was never captured
  cannot be reconstructed, and the detail page says so rather than inventing
  one.

- **`Campaign` has no reach, spend, engagement, channel or airtime fields** -
  only `id, name, status, createdAt, brandId`. This is why four dashboard stat
  cards and the whole analytics page are SAMPLE, why campaign table cells show
  an em dash, and why the per-campaign tuner strip was dropped. Any real
  reporting needs schema work first.
- **`Booking` has no call result fields** - only `type` and `status`. There is
  no calls table at all, so the dashboard's call card is permanently a sample
  and CALL-E results have nowhere to persist. This is the gap to close before
  the call flow can show anything real.
  the demo.
- **Billing shows placeholder bank details.** The JazzCash and Easypaisa
  merchant numbers, and the Meezan account number, IBAN and Swift code, are
  literals in `BillingPortal`. They tell a user where to send money, so they
  carry a SAMPLE mark - but a mark is a stopgap. Replace them with Arc's real
  accounts or remove the section before anyone can act on it.
- **Clerk runs keyless.** No Clerk env vars; `.clerk/.tmp/keyless.json` holds
  a temporary development instance still named "My Application", with a 15
  character password minimum, email-code verification, smart CAPTCHA and
  `oauth_google` on Clerk's shared dev credentials. Claim the instance and
  move the keys into env before submission.
- **Three pages are still pre-rebrand inline styles.** Redesign, not cleanup:
  `CheckoutFlow` (123 inline style blocks - the largest remaining block of
  pre-rebrand markup in the app, and it sits on the payment path, so it is the
  one a judge is most likely to reach with money on screen),
  `InfluencerMarket` (53) and `StationDirectory` (25). The two list pages now
  sit between rebuilt detail pages, so the change in design is visible when
  clicking through. `CheckoutFlow` is also the last reader of `plan.color` in
  `lib/config/pricing.ts`.
- **No `Station`, `Creator` or `Invoice` tables.** Stations and creators are
  static catalogues in `app/radio/_data.ts` and `app/influencers/_data.ts` (8
  each); invoices are a literal in `BillingPortal`.
- `BatchCallPanel`, `LiveCallCard`, `BudgetDonut` and `WizardContext` are
  untouched by the branding work and still carry pre-rebrand styling.
- Detail-page breadcrumbs lost the entity name when the shell took over the
  trail; a crumb-override context would restore it.
- The sidebar wordmark is still the old Arial-black `ARC`, not the Gabarito
  `Arc` used on the landing page and auth screens.
- `/api/payments/jazzcash/create` still reads `brandUser` directly rather than
  through `getOrCreateBrand`.



v1 implied a whole-app conversion. The audit found ~1,809 hardcoded hex across 38 files, which
does not fit the deadline. Scope is now three tracks. **Track membership decides whether a file
may be opened at all.**

### Track A - landing page: rebuild, do not convert

Rebuild the landing page from scratch on the new tokens. **New files, clean from line one.**
Do not open the existing landing page to convert it - it is 1,564 lines of hand-written CSS in
`app/globals.css` plus `app/page.tsx`, and converting is slower than rewriting. The old landing
styles get deleted, not migrated.

### Track B - demo path: convert in place

Campaign review, the media plan, `LiveCallCard`, and whatever they directly import. These are
existing files, converted to tokens in place. Exact file list is fixed at the top of Stage 2 -
if a file is not on that list it is Track C.

### Track C - everything else: do not open

`BillingPortal`, `CheckoutFlow`, `AnalyticsDashboard`, `CreatorProfile`, `InfluencerMarket`,
`StationProfile`, `StationDirectory`, `DashboardHome`, onboarding steps, and every other screen
not named in Track B.

**Do not open these files at all.** Not to convert, not to tidy, not to fix an obvious hex while
passing through. They keep their current dark inline styles and will look inconsistent with the
rest of the app. That is the accepted trade, not a bug to report.

One consequence to hold: `LiveCallCard` (Track B) is imported by `BookingSidebar` and
`CreatorProfile`, both Track C. Restyling it changes how those two screens render. Track C files
are still not opened - the visual mismatch inside them is accepted.

### No invented data (standing rule)

**No page may display a number, campaign, invoice or metric that is not either
read from the database or visibly marked SAMPLE.** This is a hackathon
submission and a judge will open these pages; a fabricated figure sitting
beside a real one destroys trust in both.

Three consequences that already bite:

- Where a page has no real data, show the **empty state** - do not render
  illustrative numbers in its place.
- Where a figure is genuinely illustrative, it carries a **SAMPLE pill**, the
  same device the dashboard call card uses.
- Never attach invented detail to a **real named record**. A fabricated airtime
  strip on a real campaign is worse than a standalone sample, because the name
  makes it look verified.

Counts must come from the source they describe. "Showing 8 of 239" implies a
catalogue of 239 to filter and is a lie; "239 FM stations across Pakistan" as a
market fact is not.

### Deferred

**The app shell covers `/dashboard` only.** `Sidebar` + `TopBar` live in
`app/dashboard/layout.tsx`, so `/campaigns`, `/radio`, `/influencers`,
`/analytics` and `/settings/billing` each render their own header and share no
layout. Consequence: the unfinished-brief resume banner (`ResumeBrief`) appears
on the dashboard only, not app-wide. Giving the other routes the shell is a
restructure, not a placement change, and is deliberately deferred.

### Decisions locked

- **Primitives live in `components/ui/` at the repo root.** The repo currently has no
  `components/` directory - all 53 components sit in colocated `app/**/_components/`. Root
  `components/ui/` is new, is where shadcn writes by default, and is what §8 already assumed.
  Colocated `_components/` stays as-is for screen-specific components.

- **Colors-as-data become token names, never find-replaced.** Records carrying a literal color
  (e.g. `color: "#0D9488"` on creator rows in `DashboardHome`) move to a palette-name union -
  `'lilac' | 'blush' | 'butter'` - resolved to a value in **one** mapping module. A hex sitting
  in a data structure is a data-modelling change, not a styling change; it never gets swept up
  in a bulk replace. This applies when such a record is inside Track A or B. Track C records
  stay untouched.

### Track B - exact file list (fixed, Stage 2)

Five files. 149 hex, 8 `rgba()`, 1,236 lines total. Anything not on this list is Track C.

| File | Hex | Why in scope |
|---|---:|---|
| `app/campaigns/create/_components/StepReview.tsx` | 78 | Campaign review |
| `app/_components/BatchCallPanel.tsx` | 33 | Media plan - renders `PlanRow[]` |
| `app/_components/LiveCallCard.tsx` | 32 | Call card; type source for BatchCallPanel |
| `app/campaigns/create/_components/BudgetDonut.tsx` | 6 | `dynamic()` import inside StepReview |
| `app/campaigns/create/_components/WizardContext.tsx` | 0 | Direct import of StepReview; state only, no visual work expected |

### Settled questions - do not relitigate

**The media plan is not a screen.** No route or component is named that. The concept lives in
`lib/calle-media.ts` as a "ranked media-plan row", and those rows are produced and rendered by
`BatchCallPanel` inside campaign review. **The media plan is the `PlanRow` table in
`BatchCallPanel`, and that table is the tuner strip's second home** (§5). Segments are time
blocks, widths are actual durations, labels are dayparts - driven by real `PlanRow` data.

**The campaign-create wizard stays out.** `app/campaigns/create/page.tsx` and the four earlier
steps (`StepBrief`, `StepGenerating`, `StepScripts`, `StepSelect`) are Track C. The demo
deep-links straight into campaign review with a shortlist already present; the 3-minute video
has no room to walk a 5-step wizard, so those screens never appear on camera. They stay dark and
unconverted. Do not add them "for coherence".

**`app/campaigns/[id]/page.tsx` is Track C.** It is the campaign *detail* route, not the review
step - separate server-rendered page with its own `STATUS_STYLE` colors-as-data map. Excluded
despite the name overlap.
