"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useWizard } from "./WizardContext";
import type { StationRec, InfluencerMatch } from "./WizardContext";

/**
 * Search the catalogue and add a line the model did not pick.
 *
 * The Select step showed only the generation's own output. That is fine while
 * the generation returns something, and a dead end when it does not: an empty
 * array rendered an empty div, and Continue stays disabled until a line in
 * every requested channel is ticked. The buyer could see no reason and had no
 * way out.
 *
 * The deeper point is not the empty case. Arc's job is to propose, and the
 * decision stays with the person spending the money - so this is present
 * whether or not the model returned anything, not bolted on as an error path.
 *
 * A row added here carries the catalogue's facts and NO match score. It was
 * not scored by anything; see ScoreBar in StepSelect for what that renders as.
 */

interface StationFacts {
  stationId: string; stationName: string; city: string | null; frequency: string | null;
  audienceProfile: string | null; estimatedDailyListeners: number | null;
  estimatedCostPKR: number | null;
}
interface CreatorFacts {
  id: string; username: string; displayName: string; platform: string;
  niche: string | null; city: string | null; estimatedFollowers: number | null;
  audienceBasis: string | null; estimatedCostPKR: number | null;
}

export default function AddFromDirectory({ kind }: { kind: "station" | "creator" }) {
  const { state, dispatch } = useWizard();
  const [q, setQ] = useState("");
  const [stations, setStations] = useState<StationFacts[]>([]);
  const [creators, setCreators] = useState<CreatorFacts[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    /* Debounced, and the response is dropped unless it is the newest request -
       otherwise a slow early keystroke lands after a fast later one and the
       list contradicts the box the user is looking at. */
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/catalogue?q=${encodeURIComponent(q)}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (mine !== seq.current) return;
        setStations(Array.isArray(data.stations) ? data.stations : []);
        setCreators(Array.isArray(data.creators) ? data.creators : []);
      } catch {
        if (mine === seq.current) setFailed(true);
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  const alreadyStations = state.generated?.stationRecommendations ?? [];
  const alreadyCreators = state.generated?.influencerMatches ?? [];

  /* Anything already on the screen is not offered again. Adding it is a no-op
     in the reducer, but showing a button that does nothing is its own bug. */
  const shownStations = useMemo(
    () => stations.filter(s => !alreadyStations.some(r => r.stationId === s.stationId)),
    [stations, alreadyStations]
  );
  const shownCreators = useMemo(
    () => creators.filter(c => !alreadyCreators.some(r => r.id === c.id)),
    [creators, alreadyCreators]
  );

  function addStation(s: StationFacts) {
    const row: StationRec = { ...s, recommendedSlots: [], audienceMatchScore: null, rationale: null };
    dispatch({ type: "ADD_STATION", station: row });
  }
  function addCreator(c: CreatorFacts) {
    const row: InfluencerMatch = { ...c, matchScore: null, matchRationale: null };
    dispatch({ type: "ADD_INFLUENCER", influencer: row });
  }

  const rows = kind === "station" ? shownStations.length : shownCreators.length;

  return (
    <div className="flex flex-col gap-4 rounded-card border border-dashed border-border p-5">
      <div className="flex flex-col gap-1">
        <span className="font-medium text-text">
          {kind === "station" ? "Add a station yourself" : "Add a creator yourself"}
        </span>
        <span className="text-small text-text-muted">
          Arc suggests; you decide. Search everything Arc can call, whether or not it was matched.
        </span>
      </div>

      <label className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2">
        <Search aria-hidden strokeWidth={1.75} className="size-4 shrink-0 text-text-muted" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={kind === "station" ? "Name, city or frequency" : "Name, handle, city or niche"}
          className="w-full bg-transparent text-small text-text outline-none placeholder:text-text-muted"
        />
        {loading && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-text-muted" />}
      </label>

      {failed && (
        <p className="text-small text-danger">
          The directory did not load. Check your connection and try the search again.
        </p>
      )}

      {!failed && !loading && rows === 0 && (
        <p className="text-small text-text-muted">
          {q
            ? `Nothing in the directory matches “${q}”.`
            : "Everything in the directory is already on this screen."}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {kind === "station" && shownStations.map(s => (
          <button
            key={s.stationId}
            type="button"
            onClick={() => addStation(s)}
            className="flex items-center justify-between gap-4 rounded-control bg-surface px-4 py-3 text-left shadow-card transition-colors hover:bg-bg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-text">{s.stationName}</span>
              <span className="type-data text-text-muted">
                {[s.frequency, s.city].filter(Boolean).join(" · ") || "No city on file"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {s.estimatedCostPKR == null
                ? <Badge variant="outline">No rate on file</Badge>
                : <span className="type-data text-text-muted">PKR {s.estimatedCostPKR.toLocaleString()}</span>}
              <Plus aria-hidden strokeWidth={1.75} className="size-4 text-text" />
            </span>
          </button>
        ))}

        {kind === "creator" && shownCreators.map(c => (
          <button
            key={c.id}
            type="button"
            onClick={() => addCreator(c)}
            className="flex items-center justify-between gap-4 rounded-control bg-surface px-4 py-3 text-left shadow-card transition-colors hover:bg-bg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring motion-reduce:transition-none"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-text">{c.displayName}</span>
              <span className="type-data text-text-muted">
                @{c.username}{c.city ? ` · ${c.city}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-3">
              {c.estimatedCostPKR == null
                ? <Badge variant="outline">No rate on file</Badge>
                : <span className="type-data text-text-muted">PKR {c.estimatedCostPKR.toLocaleString()}</span>}
              <Plus aria-hidden strokeWidth={1.75} className="size-4 text-text" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
