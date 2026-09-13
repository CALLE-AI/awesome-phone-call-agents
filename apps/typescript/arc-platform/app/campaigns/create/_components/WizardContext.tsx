"use client";

import { createContext, useContext, useReducer, useEffect, useCallback } from "react";

/* ─── Types ─── */
export interface RadioScript {
  id: string; language: "urdu" | "english" | "bilingual"; duration: number;
  title: string; hook: string; body: string; callToAction: string;
  voiceDirection: string; bestTimeSlots: string[]; targetSegment: string;
}

/**
 * Everything except the cost, the score and the rationale is joined from the
 * catalogue server-side - see lib/catalogue.ts.
 *
 * `estimatedReachForCampaign` is gone. Reach for a flight depends on how many
 * spots run and for how long, and it is not a number we hold; the model was
 * inventing it. `estimatedDailyListeners` is the catalogue's real figure and
 * answers a slightly different question honestly, which beats answering the
 * right question with a number nobody can source.
 */
export interface StationRec {
  stationId: string; stationName: string;
  city: string | null; frequency: string | null;
  audienceProfile: string | null;
  estimatedDailyListeners: number | null;
  recommendedSlots: string[];
  /** NULL when no rate is on file, which is most of the catalogue. Never 0 -
   *  a zero renders as a real price and would undo the reason for calling. */
  estimatedCostPKR: number | null;
  /** NULL when nothing scored this line - a row the buyer added from the
   *  directory rather than one the model returned. Not 0: zero renders as a
   *  score, and "Arc rated your own choice 0 out of 100" is a worse lie than
   *  no rating at all. */
  audienceMatchScore: number | null; rationale: string | null;
}

export interface InfluencerMatch {
  id: string; username: string; displayName: string;
  platform: string;
  niche: string | null; city: string | null;
  estimatedFollowers: number | null;
  audienceBasis: string | null;
  /** Null when no rate is on file. See StationRec. */
  estimatedCostPKR: number | null;
  /** Null for a hand-picked creator. See StationRec.audienceMatchScore. */
  matchScore: number | null; matchRationale: string | null;
}

export interface GeneratedData {
  scripts: RadioScript[]; stationRecommendations: StationRec[];
  influencerMatches: InfluencerMatch[];
  budgetAllocation: { radio: number; influencer: number; platformFee: number };
  estimatedTotalReach: number; campaignInsights: string;
  bestLaunchTiming: string; riskFactors: string; generationTimeMs: number;
  /** Which path produced this plan. "sample" means no API key was configured
   *  and the offline plan was served - it must never be labelled as the model's
   *  work. */
  source?: "model" | "sample";
  sampleReason?: string;
}

export interface BriefData {
  productName: string; productDescription: string; industry: string;
  targetAudience: string; ageMin: number; ageMax: number;
  gender: "all" | "female" | "male"; primaryCity: string; targetCities: string[];
  campaignGoal: "awareness" | "leads" | "sales" | "launch" | "retention";
  totalBudget: number; budgetCurrency: "PKR" | "AED" | "SAR";
  channels: Array<"radio" | "influencer" | "digital">;
  /// ISO yyyy-mm-dd. The flight's end is computed from duration rather than
  /// entered, so a second date field can never disagree with the chip.
  startDate: string;
  duration: 7 | 14 | 30 | 60; tone: "warm" | "professional" | "urgent" | "playful" | "emotional";
  specialOffer: string; competitors: string;
}

export interface WizardState {
  step: "brief" | "generating" | "scripts" | "select" | "review";
  brief: BriefData;
  generated: GeneratedData | null;
  selections: { selectedScriptIds: string[]; selectedStationIds: string[]; selectedInfluencerIds: string[] };
  /** A catalogue id carried in from a directory's "start a campaign with this
   *  line". The plan is asked to include it and it arrives pre-selected, so
   *  the line you clicked from is still the line you get. Null for a wizard
   *  opened the ordinary way, and null for an id that is not in the
   *  catalogue - an unknown id is ignored in silence, never surfaced as an
   *  error, because a stale bookmark is not something to scold anyone about. */
  pinnedExternalId: string | null;
  draftId: string | null;
  editedScripts: Record<string, Partial<RadioScript>>;
  /** Set once the campaign actually exists on the server.
   *
   *  Launching used to leave the draft sitting in localStorage, and nothing
   *  else ever removed it except the Discard button. Two things followed. The
   *  dashboard kept offering "You have an unfinished brief - you stopped at
   *  Review" beside the campaign that brief had already become, both true from
   *  their own source and neither aware of the other. And pressing Resume
   *  reopened the finished brief, so pressing Launch again POSTed a SECOND
   *  campaign - which is how two identical campaigns came to be created a
   *  minute apart, both ACTIVE.
   *
   *  A launched brief is not an unfinished one. The persist effect deletes the
   *  key while this is set, so no later dispatch can write it back. */
  launched: boolean;
}

/* ─── Initial State ─── */
const INITIAL_BRIEF: BriefData = {
  productName: "", productDescription: "", industry: "", targetAudience: "",
  ageMin: 18, ageMax: 45, gender: "all", primaryCity: "Karachi", targetCities: [],
  campaignGoal: "awareness", totalBudget: 0, budgetCurrency: "PKR",
  channels: [], startDate: "", duration: 30, tone: "warm", specialOffer: "", competitors: "",
};

const INITIAL_STATE: WizardState = {
  step: "brief", brief: INITIAL_BRIEF, generated: null,
  selections: { selectedScriptIds: [], selectedStationIds: [], selectedInfluencerIds: [] },
  pinnedExternalId: null,
  draftId: null, editedScripts: {},
  launched: false,
};

/* ─── Actions ─── */
type Action =
  | { type: "SET_STEP"; step: WizardState["step"] }
  | { type: "UPDATE_BRIEF"; brief: Partial<BriefData> }
  | { type: "SET_GENERATED"; generated: GeneratedData }
  | { type: "SET_PINNED"; externalId: string | null }
  | { type: "TOGGLE_SCRIPT"; id: string }
  | { type: "ADD_STATION"; station: StationRec }
  | { type: "ADD_INFLUENCER"; influencer: InfluencerMatch }
  | { type: "TOGGLE_STATION"; id: string }
  | { type: "TOGGLE_INFLUENCER"; id: string }
  | { type: "EDIT_SCRIPT"; scriptId: string; field: keyof RadioScript; value: string }
  | { type: "SET_DRAFT_ID"; id: string }
  | { type: "LAUNCHED"; id: string }
  | { type: "LOAD_STATE"; state: WizardState }
  | { type: "RESET" };

/** Exported for tests. The add-from-directory cases below are the ones worth
 *  pinning: both must be idempotent and both must tick what they add. */
export function reducer(state: WizardState, action: Action): WizardState {
  switch (action.type) {
    case "SET_STEP":
      return { ...state, step: action.step };
    case "UPDATE_BRIEF":
      return { ...state, brief: { ...state.brief, ...action.brief } };
    case "SET_PINNED":
      return { ...state, pinnedExternalId: action.externalId };
    case "SET_GENERATED": {
      /* The pinned line arrives already ticked. Coming from a station's card
         to "start a campaign with this line" and then having to hunt for it
         in the results is the kind of small betrayal that makes a product
         feel careless. If the generator did not include it - it may not carry
         a phone, or the brief may exclude its channel - nothing is ticked and
         nothing complains. */
      const pin = state.pinnedExternalId;
      if (!pin) return { ...state, generated: action.generated };

      const inStations = action.generated.stationRecommendations?.some((r) => r.stationId === pin);
      const inCreators = action.generated.influencerMatches?.some((r) => r.id === pin);
      const sel = state.selections;
      return {
        ...state,
        generated: action.generated,
        selections: {
          ...sel,
          selectedStationIds:
            inStations && !sel.selectedStationIds.includes(pin)
              ? [...sel.selectedStationIds, pin]
              : sel.selectedStationIds,
          selectedInfluencerIds:
            inCreators && !sel.selectedInfluencerIds.includes(pin)
              ? [...sel.selectedInfluencerIds, pin]
              : sel.selectedInfluencerIds,
        },
      };
    }
    case "TOGGLE_SCRIPT": {
      const ids = state.selections.selectedScriptIds;
      const next = ids.includes(action.id)
        ? ids.filter(i => i !== action.id)
        : ids.length < 2 ? [...ids, action.id] : ids;
      return { ...state, selections: { ...state.selections, selectedScriptIds: next } };
    }
    /* Added by hand from the directory. Ticked on arrival: choosing it from a
       search box IS the selection, and making the buyer find it again in the
       list below to tick it is the small betrayal SET_GENERATED avoids for
       pinned lines. Idempotent - adding the same row twice is a no-op, not a
       duplicate React key. */
    case "ADD_STATION": {
      const g = state.generated;
      if (!g) return state;
      if (g.stationRecommendations.some(r => r.stationId === action.station.stationId)) return state;
      const ids = state.selections.selectedStationIds;
      return {
        ...state,
        generated: { ...g, stationRecommendations: [action.station, ...g.stationRecommendations] },
        selections: {
          ...state.selections,
          selectedStationIds: ids.includes(action.station.stationId) ? ids : [...ids, action.station.stationId],
        },
      };
    }
    case "ADD_INFLUENCER": {
      const g = state.generated;
      if (!g) return state;
      if (g.influencerMatches.some(r => r.id === action.influencer.id)) return state;
      const ids = state.selections.selectedInfluencerIds;
      return {
        ...state,
        generated: { ...g, influencerMatches: [action.influencer, ...g.influencerMatches] },
        selections: {
          ...state.selections,
          selectedInfluencerIds: ids.includes(action.influencer.id) ? ids : [...ids, action.influencer.id],
        },
      };
    }
    case "TOGGLE_STATION": {
      const ids = state.selections.selectedStationIds;
      const next = ids.includes(action.id) ? ids.filter(i => i !== action.id) : [...ids, action.id];
      return { ...state, selections: { ...state.selections, selectedStationIds: next } };
    }
    case "TOGGLE_INFLUENCER": {
      const ids = state.selections.selectedInfluencerIds;
      const next = ids.includes(action.id) ? ids.filter(i => i !== action.id) : [...ids, action.id];
      return { ...state, selections: { ...state.selections, selectedInfluencerIds: next } };
    }
    case "EDIT_SCRIPT": {
      return {
        ...state,
        editedScripts: {
          ...state.editedScripts,
          [action.scriptId]: {
            ...(state.editedScripts[action.scriptId] || {}),
            [action.field]: action.value,
          },
        },
      };
    }
    case "SET_DRAFT_ID":
      return { ...state, draftId: action.id };
    case "LAUNCHED":
      return { ...state, draftId: action.id, launched: true };
    case "LOAD_STATE":
      /* A brief saved before a field existed rehydrates without it, and the
         reducer trusts whatever localStorage hands back. Merging over the
         initial brief means a resumed draft gets defaults for anything added
         since - startDate would otherwise arrive undefined and reach a date
         input as such. */
      return {
        ...INITIAL_STATE,
        ...action.state,
        brief: { ...INITIAL_BRIEF, ...(action.state?.brief ?? {}) },
        selections: { ...INITIAL_STATE.selections, ...(action.state?.selections ?? {}) },
      };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

/* ─── Context ─── */
const WizardCtx = createContext<{
  state: WizardState;
  dispatch: React.Dispatch<Action>;
} | null>(null);

const STORAGE_KEY = "arc_campaign_wizard";
const EXPIRY_MS = 24 * 60 * 60 * 1000;

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const { state: saved, savedAt } = JSON.parse(raw);
      if (Date.now() - savedAt < EXPIRY_MS && saved.step !== "generating") {
        dispatch({ type: "LOAD_STATE", state: saved });
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch { /* ignore */ }
  }, []);

  // Persist to localStorage on every state change (except generating step)
  useEffect(() => {
    if (state.step === "generating") return;
    try {
      /* Deleted rather than written once the campaign exists. Clearing the key
         anywhere else would not hold: this effect runs on EVERY state change,
         so the next dispatch after a removeItem would put the finished brief
         straight back. */
      if (state.launched) {
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, savedAt: Date.now() }));
    } catch { /* ignore */ }
  }, [state]);

  return <WizardCtx.Provider value={{ state, dispatch }}>{children}</WizardCtx.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardCtx);
  if (!ctx) throw new Error("useWizard must be used inside WizardProvider");
  return ctx;
}

export function useResolvedScript(script: RadioScript, editedScripts: Record<string, Partial<RadioScript>>): RadioScript {
  const edits = editedScripts[script.id] ?? {};
  return { ...script, ...edits };
}
