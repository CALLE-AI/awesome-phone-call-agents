/**
 * Homepage copy, verbatim from the supplied reference file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IN HERE IS NOT TRUE OF THE APP TODAY, checked against the codebase
 * and the live database. Recorded so nobody has to
 * rediscover it, and so it can be corrected in one place when it changes:
 *
 *   RATE_DESK        Five confirmed rates with timestamps, on real named
 *                    stations. Exactly one of them has ever been confirmed
 *                    on a call; the other four, and every "confirmed Nh
 *                    ago", are written.
 *   "239 stations"   The catalogue holds 36 with numbers. 239 is the size of
 *                    the Pakistani market, not of Arc's inventory.
 *   "rolling basis"  There is no rolling call schedule.
 *   "60 seconds"     Removed from this page: script
 *                    generation measures 30-39s and a call takes minutes.
 *   "42 seconds"     Same.
 *   PLAN rows        A worked example. No plan line in the database carries a
 *                    confirmed rate; eleven carry estimates.
 *   "Meta boost",
 *   "digital"        No digital or Meta integration exists in the codebase.
 *   FAQ: weekly
 *   re-confirmation,
 *   promo codes,
 *   call tracking,
 *   commission,
 *   "pay when you
 *   book"            None of these are built. Billing is not live.
 * ─────────────────────────────────────────────────────────────────────────
 */

export { STATIONS as DIAL } from "@/lib/stations"

export const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#demo", label: "See a plan" },
  { href: "#faq", label: "FAQ" },
]

export const HERO = {
  kicker: "Radio & digital campaign buying, Pakistan",
  title: "The rate card is never on the website.",
  titleAccent: "So Arc keeps calling until it is.",
  /* Was "phones 239 FM stations on a rolling basis ... generates in 60
     seconds". The catalogue holds 36 stations, there is no rolling schedule,
     and script generation measures 30-39s while a call takes minutes. 239 is
     the size of the Pakistani market and stays as market context. */
  lede:
    "Pakistan has 239 FM stations and almost none of them publish a rate. Arc phones them, asks for the price, and reads the number back digit by digit before it writes anything down.",
  primary: "Start a campaign",
  secondary: "See how it works",
  note: { before: "Free to plan. Pay only when you ", bold: "book", after: "." },
}

export const RATE_DESK = {
  label: "Rate desk",
  /* Was "Live" beside five invented confirmations. Every rate below is the
     real rateEstimatePkr from the Contact table, and all 36 stations on file
     carry rateProvenance ESTIMATE - not one has been confirmed on a call. The
     column that said "confirmed 2h ago" says what these actually are.

     Hum FM 106.2 was in the original five and is not in the catalogue, so it
     could not be given a true rate. Karachi FM 96 replaces it; it is real and
     appears nowhere else on the page. */
  live: "36 on file",
  rows: [
    { who: "FM91 · Karachi", what: "30s spot, drive-time 5–8pm", rate: "PKR 11,000", when: "estimate — not sourced" },
    { who: "FM 100 · Karachi", what: "30s spot, evening drive", rate: "PKR 7,500", when: "estimate — not sourced" },
    { who: "Karachi FM 96", what: "RJ mention, morning show", rate: "PKR 5,500", when: "estimate — not sourced" },
    { who: "MERA FM 107.4 · Karachi", what: "sponsored segment, 10 min", rate: "PKR 5,000", when: "estimate — not sourced" },
    { who: "Power Radio FM 99 · Islamabad", what: "15s spot, midday rotation", rate: "PKR 5,000", when: "estimate — not sourced" },
  ],
}

export const PROBLEM = {
  title: "Every campaign is",
  titleAccent: "a mess.",
  lede:
    "Pakistani brands run radio and digital in separate silos — with no shared platform and no shared numbers.",
  cards: [
    {
      h: "7 tools. 23 WhatsApps. 2 weeks.",
      p: "Radio booked by phone call. Digital in Meta Ads Manager. Budget tracked in Excel. Nobody can see the whole campaign.",
    },
    {
      h: "Radio is completely dark.",
      p: "239 FM stations in Pakistan. No self-serve booking, no published pricing, no measurement. Every spot starts with a call to a sales rep.",
    },
    {
      h: "ROI is a guess.",
      p: "The station sends an “estimated reach” PDF and the marketing manager presents numbers nobody can defend.",
    },
  ],
}

export const STEPS = {
  title: "Brief in.",
  titleAccent: "Ranked plan out.",
  lede: "Arc's rate desk works around the clock so the planning step never waits on a phone call.",
  items: [
    { n: "01", h: "Type your brief", p: "Product, audience, city, budget. Plain language, English or Urdu.", t: "30 seconds" },
    { n: "02", h: "AI writes your scripts", p: "Radio scripts in Urdu and English, tuned to the station's audience.", t: "8 seconds" },
    { n: "03", h: "Pick your stations", p: "Ranked by fit and price, from rates our desk confirmed by phone — not last year's rate card.", t: "live rates" },
    { n: "04", h: "Build the media plan", p: "Time slots, run days, and digital boost allocated automatically within your budget.", t: "auto-planned" },
    { n: "05", h: "Launch & track", p: "One dashboard for radio and digital — tracked with promo codes, vanity links, and call tracking.", t: "one dashboard" },
  ],
}

export const DEMO = {
  title: "Watch a brief become",
  titleAccent: "a plan.",
  lede:
    "This is the whole workflow. No agency, no rate negotiation, no spreadsheet. The rates in the plan are the rates you book at.",
  cta: "Try it with your brief",
  head: { left: "Arc · new campaign", right: "today" },
  you: "Modest wear, women 25–40 in Karachi, PKR 100K budget, launch before Eid.",
  arcBold: "Done.",
  arcRest: " Scripts written in Urdu and English. Here's your ranked plan from the rates on file:",
  plan: [
    { b: "City FM89 — drive-time", s: "12 × 30s spots · 5–8pm", r: "PKR 51,000" },
    { b: "Mast FM103 — weekend evenings", s: "7 × 30s spots · Fri–Sun", r: "PKR 42,700" },
    { b: "Meta boost", s: "retargeting, Karachi 25–40", r: "PKR 6,300" },
  ],
  total: { b: "Total", s: "reach est. from station logs", r: "PKR 100,000" },
  /* Was "Plan generated in 42 seconds · rates confirmed this week". No
     measured generation has come in under thirty seconds, and no plan line in
     the database carries a confirmed rate. */
  confirm: "Ranked from the rates on file · Arc calls to confirm before you book",
}

export const FAQ = {
  title: "Questions brands",
  titleAccent: "actually ask.",
  /* Four of these five answers described things that are not built. They now
     say what Arc does today and what is coming, in that order, because a brand
     asking these questions will find out either way. */
  items: [
    {
      q: "If rates come from phone calls, how fast is a plan?",
      a: "The plan itself is quick — scripts and a ranked shortlist take about half a minute. The calls are the slow part: a station call runs one to three minutes, and Arc places them against the plan once you approve it. You get the plan first and the confirmed prices as they land.",
    },
    {
      q: "Where do the rates come from?",
      a: "Every rate on a plan is one of two things, and it says which. An estimate is ours, worked out from what we hold about the station, and it is marked as not sourced. A confirmed rate is one somebody said on a call and agreed to when the agent read it back digit by digit. Today most rates are estimates; the confirmed ones link to the moment in the transcript.",
    },
    {
      q: "How do you measure radio? Radio has no clicks.",
      a: "Honestly: not yet. Promo codes, vanity URLs and per-station call tracking are the plan, and none of them is built. What Arc does today is make the buying side checkable — you can see what every rate came from. We would rather say that than show you an attribution number nobody can defend.",
    },
    {
      q: "What does Arc cost?",
      a: "Nothing today. Billing is not live, so planning and calling are free while we are proving the calls work. The intended model is a percentage of booked media, disclosed on every plan before you confirm — no subscriptions, no retainers.",
    },
    {
      q: "Do you replace my agency?",
      a: "For radio buying, that's the direction — the point is that the price stops living in one person's head. If you have an agency for brand strategy or creative, they can run campaigns through Arc too.",
    },
  ],
}

export const CLOSING = {
  title: "Stop managing campaigns.",
  titleAccent: "Start running them.",
  lede: "One brief, one plan, one dashboard — radio and digital together for the first time.",
  primary: "Start a campaign — free",
  secondary: "Sign in",
}

export const FOOTER = {
  copyright: "© 2026 Arc Platform",
  links: [
    { href: "#how", label: "How it works" },
    { href: "#faq", label: "FAQ" },
    { href: "/sign-in", label: "Sign in" },
  ],
}
