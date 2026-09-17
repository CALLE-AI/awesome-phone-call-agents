/**
 * Today's reads, in the browser, under row-level security.
 * It returns rows only. model.ts turns them into what the page shows.
 */
import type { BrowserSupabase } from "$lib/supabase"
import {
  pickLastCall,
  pickLiveRun,
  type CommitmentRow,
  type ConsentRow,
  type ItemRow,
  type MentionRow,
  type RunMentionRow,
  type RunRow,
  type SlotRow,
} from "./model"

export type TodayRows = {
  profile: {
    display_name: string
    timezone: string
    phone_e164: string | null
    phone_confirmed_at: string | null
  } | null
  consents: ConsentRow[]
  runs: RunRow[]
  slots: SlotRow[]
  items: ItemRow[]
  openMentions: MentionRow[]
  lastCall: RunRow | null
  lastMentions: RunMentionRow[]
  lastCommitments: CommitmentRow[]
  lastTranscriptRaw: unknown
  lastResultStructured: unknown
  liveBriefing: unknown
  loadedAt: string
}

const RUN_COLUMNS =
  "id,state,disposition,mood,scheduled_for,claimed_at,dispatched_at,completed_at,poll_after,slot_id"

function must<T>(result: { data: T; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`Could not read ${what}: ${result.error.message}`)
  return result.data
}

export async function loadTodayRows(supabase: BrowserSupabase, userId: string): Promise<TodayRows> {
  const [profileRes, consentsRes, runsRes, slotsRes, itemsRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name,timezone,phone_e164,phone_confirmed_at")
      .eq("id", userId)
      .maybeSingle(),
    // The dispatcher refuses a run without a live outbound_calls consent. Today reads the same rows.
    supabase.from("consents").select("kind,revoked_at").eq("user_id", userId).eq("kind", "outbound_calls"),
    supabase
      .from("call_runs")
      .select(RUN_COLUMNS)
      .eq("user_id", userId)
      .order("scheduled_for", { ascending: false })
      .limit(200),
    supabase.from("slots").select("id,local_time,weekdays,active").eq("user_id", userId),
    supabase
      .from("items")
      .select("id,text,status,since_date,created_at,source")
      .eq("user_id", userId)
      .eq("status", "open")
      .order("created_at", { ascending: true }),
  ])

  const profile = must(profileRes, "your profile")
  const consents = must(consentsRes, "your consents") as ConsentRow[]
  const runs = must(runsRes, "your calls") as RunRow[]
  const slots = must(slotsRes, "your call times") as SlotRow[]
  const items = must(itemsRes, "your items") as ItemRow[]

  const ids = items.map((item) => item.id)
  const lastCall = pickLastCall(runs)
  const liveRun = pickLiveRun(runs)

  const [mentionsRes, lastMentionsRes, lastCommitmentsRes, transcriptRes, resultRes, briefingRes] = await Promise.all([
    ids.length > 0
      ? supabase.from("item_mentions").select("item_id,call_run_id,offset_seconds").in("item_id", ids)
      : Promise.resolve({ data: [] as MentionRow[], error: null }),
    lastCall
      ? supabase
          .from("item_mentions")
          .select("item_id,call_run_id,offset_seconds,items(text,status,source,created_at,retired_at)")
          .eq("call_run_id", lastCall.id)
      : Promise.resolve({ data: [], error: null }),
    lastCall
      ? supabase
          .from("commitments")
          .select("item_id,call_run_id,due,evidence_offset_seconds,items(text)")
          .eq("call_run_id", lastCall.id)
      : Promise.resolve({ data: [], error: null }),
    lastCall
      ? supabase.from("transcripts").select("raw").eq("call_run_id", lastCall.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // A retirement belongs to a call only when that call's own result names it.
    lastCall
      ? supabase.from("results").select("structured").eq("call_run_id", lastCall.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    liveRun
      ? supabase.from("call_runs").select("briefing").eq("id", liveRun.id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  return {
    profile,
    consents,
    runs,
    slots,
    items,
    openMentions: must(mentionsRes, "item mentions") as MentionRow[],
    lastCall,
    lastMentions: must(lastMentionsRes, "the last call's mentions") as unknown as RunMentionRow[],
    lastCommitments: must(lastCommitmentsRes, "the last call's commitments") as unknown as CommitmentRow[],
    lastTranscriptRaw: (must(transcriptRes, "the last call's transcript") as { raw: unknown } | null)?.raw ?? null,
    lastResultStructured: (must(resultRes, "the last call's result") as { structured: unknown } | null)?.structured ?? null,
    liveBriefing: (must(briefingRes, "today's briefing") as { briefing: unknown } | null)?.briefing ?? null,
    loadedAt: new Date().toISOString(),
  }
}
