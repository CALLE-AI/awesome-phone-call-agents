/**
 * ONE generation, TWO calls.
 *
 * It used to be a single request that wrote three radio scripts and chose the
 * media in the same breath. That call took 82 seconds and failed, twice, on
 * station ids the model invented - so the guard threw away the scripts as
 * well, which had been fine both times. Two things were wrong with that shape:
 * the creative work was hostage to the selection work, and the whole thing had
 * to fit in one function's budget.
 *
 * Split by what can go wrong in each half:
 *
 *   creative   product, audience, tone, language. There is no id and no
 *              inventory in the prompt, so there is nothing here to invent.
 *   selection  ids only, from an enum in a tool schema. See lib/plan-tool.ts.
 *
 * They do not read each other's output, so they run at the same time and the
 * generation costs about as long as its slower half rather than the sum.
 *
 * This lives in lib/ rather than in the route because a route module may only
 * export its handlers - and a generation nobody can drive from a script is a
 * generation nobody can check against a real brief.
 */
import Anthropic from "@anthropic-ai/sdk";

import {
  shortlist,
  stationMenu,
  creatorMenu,
  joinCatalogue,
  sampleRecommendations,
  type Catalogue,
} from "@/lib/catalogue";
import { SELECTION_TOOL, buildSelectionTool, selectionToPlan } from "@/lib/plan-tool";

const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID;
const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {}),
});

const MODEL = "claude-sonnet-5";

const CREATIVE_SYSTEM = `You are Arc AI, an expert Pakistani advertising strategist and creative director
with 15+ years experience building campaigns for top Pakistani brands including Shan Foods, Tapal,
Khaadi, Jazz, Nestle Pakistan, and Engro Foods.

You understand:
- Pakistani consumer psychology and cultural nuances (Ramadan, Eid, cricket season, wedding season)
- Market-specific insights: urban Karachi vs Lahore vs Islamabad demographics differ significantly
- Language: Urdu scripts should be in Roman Urdu (spoken Urdu phonetics), not Nastaliq

Your radio scripts MUST:
- Sound natural when spoken aloud (not like they are being read from a page)
- Have clear structure: Hook (5s) -> Context/Problem (8-10s) -> Solution/Product (10-12s) -> CTA (5s)
- Be culturally relevant - reference real Pakistani consumer moments, not generic Western scenarios
- Match the specified tone exactly
- Be about THIS product. A script that would read the same for a shampoo and a
  cafe is a failed script.

Never produce scripts that sound like Western advertising translated to Urdu.

You are writing copy only. Do not name a radio station, a creator or any other
outlet, and do not allocate budget - someone else is choosing where this runs.

Always output ONLY a valid JSON object - no markdown, no code blocks, no explanation.`;

const SELECTION_SYSTEM = `You are Arc AI, a Pakistani media buyer choosing where a campaign should run.

You know the Pakistani FM radio landscape and the micro-influencer ecosystem: which
formats reach which listeners, how drive-time differs from daytime, and how a
creator's niche and city decide whether their followers are the brief's audience.

You choose ONLY from the inventory supplied in the user message, by id. You never
state a station's listener count, a creator's follower count, a rate, or any other
figure - those come from our own records and are filled in after you answer. Your
job is which ones, in what order, and why.`;

/** The brief's cities, however the wizard spelled the field. */
function cities(brief: Record<string, unknown>): string[] {
  const raw = brief.targetCities ?? brief.cities ?? brief.primaryCity;
  if (Array.isArray(raw)) return raw.map(String);
  return typeof raw === "string" && raw ? [raw] : [];
}

function creativePrompt(brief: Record<string, unknown>): string {
  return `Write the creative for this campaign:

Brand/Product: ${brief.productName}
Description: ${brief.productDescription}
Campaign Goal: ${brief.campaignGoal}
Target Audience: ${brief.targetAudience}
Cities: ${cities(brief).join(", ") || "Pakistan"}
Tone: ${brief.tone}
${brief.specialOffer ? `Special Offer: ${brief.specialOffer}` : ""}
${brief.competitors ? `Competitors: ${brief.competitors}` : ""}

Return ONLY a valid JSON object with this EXACT structure (no markdown, no code blocks):
{
  "scripts": [
    {
      "id": "script_1",
      "language": "urdu",
      "duration": 30,
      "title": "Descriptive title for this script",
      "hook": "Opening 5 seconds - gripping first line spoken aloud",
      "body": "Main body 15-20 seconds - the core message with product benefit",
      "callToAction": "Closing 5 seconds - specific action to take",
      "voiceDirection": "e.g. Warm female voice, conversational pace, slight Urdu accent",
      "bestTimeSlots": ["Morning Drive 7-9am", "Afternoon 3-5pm"],
      "targetSegment": "Who this script resonates with most"
    },
    { "id": "script_2", "language": "english", "duration": 30, "title": "...", "hook": "...", "body": "...", "callToAction": "...", "voiceDirection": "...", "bestTimeSlots": ["..."], "targetSegment": "..." },
    { "id": "script_3", "language": "bilingual", "duration": 30, "title": "...", "hook": "...", "body": "...", "callToAction": "...", "voiceDirection": "...", "bestTimeSlots": ["..."], "targetSegment": "..." }
  ],
  "campaignInsights": "2-3 sentences of genuine strategic insight specific to this brief and Pakistani market context",
  "bestLaunchTiming": "Specific day/time recommendation with reasoning",
  "riskFactors": "Any genuine concerns or market-specific risks to watch"
}

The time slots are creative guidance about when this script plays best. Do not
name any station, creator or outlet anywhere in your answer.`;
}

function selectionPrompt(brief: Record<string, unknown>, menu: Catalogue): string {
  const channels = (brief.channels as string[] | undefined) ?? [];
  return `Choose the media for this campaign:

Brand/Product: ${brief.productName}
Description: ${brief.productDescription}
Campaign Goal: ${brief.campaignGoal}
Target Audience: ${brief.targetAudience}
Cities: ${cities(brief).join(", ") || "Pakistan"}
Budget: ${brief.budgetCurrency} ${Number(brief.totalBudget).toLocaleString()}
Duration: ${brief.duration} days
Channels: ${channels.join(", ") || "radio, influencer"}

STATIONS YOU MAY CHOOSE - nothing else exists:
${menu.stations.length ? stationMenu(menu) : "(none - this brief did not ask for radio)"}

CREATORS YOU MAY CHOOSE - nothing else exists:
${menu.creators.length ? creatorMenu(menu) : "(none - this brief did not ask for influencer)"}

How to choose:
1. MATCH THE CITY. The brief names its cities; prefer lines in those cities, and
   where a line from elsewhere earns its place, say why in the rationale.
2. Many lines say "rate not on file". That is correct and expected. Never
   estimate a rate for them - finding out what they charge is what the phone
   call is for.
3. Best first. Recommend 3-5 stations and 4-6 creators; fewer is fine if the
   brief does not justify more, and padding the list is worse than a short one.

Call ${SELECTION_TOOL} with your answer.`;
}

function buildMockResponse(brief: Record<string, unknown>, cat: Catalogue) {
  const product = (brief.productName as string) || "your product";
  const sample = sampleRecommendations(cat, cities(brief));
  return {
    scripts: [
      {
        id: "script_1",
        language: "urdu",
        duration: 30,
        title: "Sample - Morning Drive",
        hook: `${product} ke saath subah ki shuruat karo`,
        /* Deliberately says what it is. The old sample body was finished ad
           copy for a shampoo, and it read as a real script for whatever
           product was interpolated into it - a cafe included. */
        body: `Sample script for ${product}. This copy is canned, not written: no model produced it.`,
        callToAction: "Aaj hi try karein - har bade store mein available",
        voiceDirection: "Warm female voice, medium pace",
        bestTimeSlots: ["Morning Drive 7-9am", "Afternoon 3-5pm"],
        targetSegment: "Sample segment",
      },
      {
        id: "script_2",
        language: "english",
        duration: 30,
        title: "Sample - Professional",
        hook: `Your choice deserves the best - choose ${product}`,
        body: `Sample script for ${product}. This copy is canned, not written: no model produced it.`,
        callToAction: "Available at leading stores nationwide.",
        voiceDirection: "Confident female voice, upbeat",
        bestTimeSlots: ["Evening Drive 5-7pm", "Morning 8-10am"],
        targetSegment: "Sample segment",
      },
      {
        id: "script_3",
        language: "bilingual",
        duration: 30,
        title: "Sample - Family",
        hook: `${product} - because your family deserves the best`,
        body: `Sample script for ${product}. Yeh offline plan hai; asli copy model likhta hai.`,
        callToAction: "Abhi order karein ya nearest store visit karein.",
        voiceDirection: "Warm, relatable voice - mix of Urdu and English",
        bestTimeSlots: ["Afternoon 12-2pm", "Evening 6-8pm"],
        targetSegment: "Sample segment",
      },
    ],
    /* Ids and judgement only, exactly like a model response. It goes through
       the same join and the same validation below, so the sample plan cannot
       recommend inventory that does not exist without failing the way a bad
       generation fails. */
    stationRecommendations: sample.stations,
    influencerMatches: sample.creators,
    budgetAllocation: { radio: 55, influencer: 35, platformFee: 10 },
    campaignInsights: `Sample plan for ${product} - no model was reached, so this is our offline plan rather than strategy written for this brief.`,
    bestLaunchTiming: "Monday morning 7am for maximum weekly impact - avoid launching on Fridays",
    riskFactors: "Ensure product availability in all targeted cities before the campaign goes live.",
  };
}

/** Raised when the model could not be reached at all - a missing key, a
 *  rejected key, a network failure. Distinct from a reply we could read and
 *  had to reject. */
class ModelUnavailable extends Error {}

/** Anything the API itself refused or could not answer is an outage, whatever
 *  its status code. A reply we could read and disliked is not. */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new ModelUnavailable(e instanceof Error ? e.message : String(e));
  }
}

/** Scripts, insight, timing, risk. No ids, no inventory, no budget. */
async function askForCreative(brief: Record<string, unknown>): Promise<Record<string, unknown>> {
  const message = await call(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: CREATIVE_SYSTEM,
      messages: [{ role: "user", content: creativePrompt(brief) }],
    })
  );

  /* The FIRST block is not the answer. Adaptive thinking is on by default on
     this model and decides per request whether to think, so content[0] is a
     thinking block on some calls and a text block on others - and thinking
     blocks carry no text unless you ask for a summary. Reading content[0]
     blindly meant JSON.parse("") on exactly the calls that thought about it,
     which is a failure that comes and goes for no visible reason. */
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  let jsonStr = text.trim();
  const blockMatch = jsonStr.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (blockMatch) jsonStr = blockMatch[1].trim();
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) jsonStr = objMatch[0];

  return JSON.parse(jsonStr) as Record<string, unknown>;
}

/**
 * Stations and creators, by id, through the tool schema.
 *
 * tool_choice forces the call, so there is no branch where the model answers in
 * prose and we are back to parsing whatever it felt like writing.
 */
async function askForSelection(
  brief: Record<string, unknown>,
  menu: Catalogue,
  problems: string[]
): Promise<Record<string, unknown>> {
  /* On a retry the model is told which ids were refused, by name. Sending the
     identical prompt again and hoping is not a retry. */
  const correction = problems.length
    ? `\n\nYour previous answer was REJECTED and none of it was used:\n` +
      problems.map((p) => `- ${p}`).join("\n") +
      `\nChoose only from the ids listed above.`
    : "";

  const message = await call(() =>
    client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SELECTION_SYSTEM,
      tools: [buildSelectionTool(menu)],
      tool_choice: { type: "tool", name: SELECTION_TOOL },
      messages: [{ role: "user", content: selectionPrompt(brief, menu) + correction }],
    })
  );

  const use = message.content.find((b) => b.type === "tool_use");
  if (!use || use.type !== "tool_use") {
    throw new Error("the model answered without calling the tool");
  }
  return selectionToPlan(use.input);
}

/** Reach we can source: what the chosen lines actually reach, added up. The
 *  model used to supply this number and had no way of knowing it. */
function reachOf(plan: Record<string, unknown>): number {
  const rows = [
    ...(Array.isArray(plan.stationRecommendations) ? plan.stationRecommendations : []),
    ...(Array.isArray(plan.influencerMatches) ? plan.influencerMatches : []),
  ] as Record<string, unknown>[];
  return rows.reduce(
    (t, r) => t + (Number(r.estimatedDailyListeners) || 0) + (Number(r.estimatedFollowers) || 0),
    0
  );
}


/**
 * Make sure a line carried in from a directory is in the plan.
 *
 * The model chooses on merit and may not pick it - it may be in the wrong
 * city, or its channel may be excluded. But someone who clicked "start a
 * campaign with this line" has already chosen, and a plan that quietly drops
 * their choice is a plan that ignored them.
 *
 * An id we do not carry is dropped without comment. A stale bookmark is not
 * worth an error message.
 */
function pinInto(
  plan: Record<string, unknown>,
  cat: Catalogue,
  pin: string | null
): Record<string, unknown> {
  if (!pin) return plan;

  const station = cat.stations.find((s) => s.stationId === pin);
  if (station) {
    const rows = (Array.isArray(plan.stationRecommendations) ? plan.stationRecommendations : []) as Record<string, unknown>[];
    if (rows.some((r) => r.stationId === pin)) return plan;
    return {
      ...plan,
      stationRecommendations: [
        { recommendedSlots: [], audienceMatchScore: null, rationale: null, ...station },
        ...rows,
      ],
    };
  }

  const creator = cat.creators.find((c) => c.id === pin || c.username === pin);
  if (creator) {
    const rows = (Array.isArray(plan.influencerMatches) ? plan.influencerMatches : []) as Record<string, unknown>[];
    if (rows.some((r) => r.id === creator.id)) return plan;
    return {
      ...plan,
      influencerMatches: [
        { matchScore: null, matchRationale: null, ...creator },
        ...rows,
      ],
    };
  }
  return plan;
}

/** What a generation produced, and by which path. */
export interface PlanResult {
  plan: Record<string, unknown> | null;
  source: "model" | "sample";
  /** Why the sample was served. Only set when source is "sample". */
  sampleReason?: string;
  /** Why nothing was produced. Only set when plan is null. */
  problems?: string[];
  failed?: "media" | "creative";
  generationTimeMs: number;
}

/**
 * Write the creative and choose the media, at the same time.
 *
 * Never returns a half-plan: either both halves came from the model, or the
 * offline sample is served whole and labelled as the sample.
 */
export async function generatePlan(
  brief: Record<string, unknown>,
  cat: Catalogue,
  /** A catalogue id the user arrived with, from a directory card. Included in
   *  the plan whatever the model chose, so the line they clicked from is the
   *  line they get. Silently ignored when it is not in the catalogue. */
  pin: string | null = null
): Promise<PlanResult> {
  const start = Date.now();

  /* The menu the model actually sees: this brief's cities and channels, a
     dozen of each, rather than every row of the catalogue. */
  const menu = shortlist(cat, { cities: cities(brief), channels: brief.channels as string[] });

  const creativeJob = askForCreative(brief).then(
    (data) => ({ data, error: null as string | null, outage: null as string | null }),
    (e: unknown) =>
      e instanceof ModelUnavailable
        ? { data: null, error: null, outage: e.message }
        : {
            data: null,
            error: `the creative reply was not valid JSON (${e instanceof Error ? e.message : String(e)})`,
            outage: null,
          }
  );

  const selectionJob = (async () => {
    let problems: string[] = [];
    /* One retry, then stop. A third attempt spends more of the wizard's
       slowest step to make the same mistake again. */
    for (let attempt = 1; attempt <= 2; attempt++) {
      let raw: Record<string, unknown>;
      try {
        raw = await askForSelection(brief, menu, problems);
      } catch (e) {
        if (e instanceof ModelUnavailable) {
          return { data: null, problems: [] as string[], outage: e.message };
        }
        problems = [e instanceof Error ? e.message : String(e)];
        continue;
      }
      /* The schema already refused anything outside the enum. This is the
         check that the schema did its job, and it is the only thing standing
         between a bad id and a saved plan. */
      const checked = joinCatalogue(raw, cat);
      if (checked.ok) return { data: checked.data, problems: [] as string[], outage: null };
      problems = checked.problems;
      console.warn(`Media selection attempt ${attempt} rejected:`, problems.join("; "));
    }
    return { data: null, problems, outage: null as string | null };
  })();

  const [creative, selection] = await Promise.all([creativeJob, selectionJob]);
  const unavailable = creative.outage ?? selection.outage;
  const generationTimeMs = () => Date.now() - start;

  if (unavailable) {
    /* No key, a rejected key or no network. The sample plan is
       catalogue-backed, so it is still a plan we could actually sell - but it
       is never labelled as the model's work, and half a real plan is not
       offered as a whole one. */
    console.warn("Anthropic API unavailable, using sample plan:", unavailable);
    const plan = joinCatalogue(buildMockResponse(brief, cat), cat).data;
    return {
      plan: { ...plan, estimatedTotalReach: reachOf(plan) },
      source: "sample",
      sampleReason: unavailable,
      generationTimeMs: generationTimeMs(),
    };
  }

  if (creative.data && selection.data) {
    const plan = pinInto({ ...creative.data, ...selection.data }, cat, pin);
    return {
      plan: { ...plan, estimatedTotalReach: reachOf(plan) },
      source: "model",
      generationTimeMs: generationTimeMs(),
    };
  }

  /* Nothing is saved. A plan quietly missing its media, or missing its
     scripts, reads as complete and is not. */
  const mediaFailed = selection.problems.length > 0;
  return {
    plan: null,
    source: "model",
    failed: mediaFailed ? "media" : "creative",
    problems: mediaFailed ? selection.problems : [creative.error ?? "unknown"],
    generationTimeMs: generationTimeMs(),
  };
}
