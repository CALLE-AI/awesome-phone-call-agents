/**
 * T2.2 briefing assembly.
 *
 * `assemble_briefing` is the only source of counts and ages. It runs in
 * Postgres and returns completed strings. This module only validates, stores,
 * and substitutes those strings into the reviewed CALL-E task. Every
 * substitution is produced by the RPC, `last_call_summary` included, so no
 * sentence CALL-E's own model wrote reaches the task.
 */

export type Briefing = {
  user_name: string;
  /** SQL count retained on call_runs.briefing for traceability, never templated. */
  open_count: number;
  lead_line: string;
  open_items: string;
  last_call_summary: string;
  slot_local_time: string;
};

export type BriefingDeps = {
  apiUrl: string;
  serviceRoleKey: string;
  fetch: typeof fetch;
};

export type AssembleBriefingInput = {
  userId: string;
  slotLocalTime: string;
  /** Injected only by tests. Production lets PostgreSQL use `now()`. */
  now?: string;
};

const REQUIRED_STRING_KEYS: Array<Exclude<keyof Briefing, "open_count">> = [
  "user_name",
  "lead_line",
  "open_items",
  "last_call_summary",
  "slot_local_time",
];

/** The reviewed template from docs/calle-call.md, with variables intact. */
export const CALL_TASK_TEMPLATE = `You are Orma, calling {{user_name}} for their daily two-minute check-in.
Both of you know you are a machine. Do not pretend otherwise, and do not apologise for it.

Speak in short sentences. Leave no silence longer than two seconds. Phone audio is worse than you think, so say fewer words and say them plainly.

Work through these seven steps in order. Do not skip any of them.

1. Say exactly: "Hello. This is Orma."
   Then STOP and wait for them to answer.

   Expect this to be missed. The other person is still working out who is speaking. That is fine, because the sentence carries nothing they need to keep.

2. Say exactly: "Can you hear me?"
   Then STOP and wait for a yes.

   Do not go on until you get one. If they say no, or sound unsure, or say nothing, repeat step 1 and step 2 once more, plainly and more slowly. Nothing that matters is said until someone has confirmed they can hear you.

   Do not ask whether now is a good time. You are not asking permission.

3. Lead with what they do not know:
   {{lead_line}}

   If they did not clearly hear it, say it once more before moving on. This line is the reason for the call, so it is the one thing worth repeating.

4. Walk what is open, briefly. Name each item once. Do not read the list twice.
   {{open_items}}
   {{last_call_summary}}

5. Ask what is new and needs capturing. Never ask this before step 4.
   Only treat something as a new item if they confirm it in their next reply. If their answer is unclear, ask once, and drop it if it is still unclear. Capturing something they did not mean is worse than capturing nothing.

6. Offer the exit, in these words or close to them: "Anything on the list you want to drop?" If they want to drop something, agree cleanly. Do not argue, do not ask them to reconsider, do not make them justify it.

7. Confirm tomorrow at {{slot_local_time}} and hang up.

Target two minutes. Do not state any number that was not given to you above.`;

function restHeaders(serviceRoleKey: string, prefer?: string): HeadersInit {
  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    "content-type": "application/json",
  };
  if (prefer) headers.prefer = prefer;
  return headers;
}

function apiBase(apiUrl: string): string {
  const base = apiUrl.replace(/\/+$/, "");
  if (base.includes("supabase.co")) throw new Error("must use ORMA_API_URL, not project host");
  return base;
}

export function asBriefing(value: unknown): Briefing {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("assemble_briefing must return an object");
  }
  const record = value as Record<string, unknown>;
  for (const key of REQUIRED_STRING_KEYS) {
    if (typeof record[key] !== "string") throw new Error(`assemble_briefing missing ${key}`);
  }
  if (typeof record.open_count !== "number" || !Number.isInteger(record.open_count)) {
    throw new Error("assemble_briefing missing open_count");
  }
  return record as Briefing;
}

export async function assembleBriefing(
  input: AssembleBriefingInput,
  deps: BriefingDeps,
): Promise<Briefing> {
  const body: Record<string, string> = {
    p_user_id: input.userId,
    p_slot_local_time: input.slotLocalTime,
  };
  if (input.now) body.p_now = input.now;
  const response = await deps.fetch(`${apiBase(deps.apiUrl)}/rest/v1/rpc/assemble_briefing`, {
    method: "POST",
    headers: restHeaders(deps.serviceRoleKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("assemble_briefing failed");
  return asBriefing(await response.json());
}

/** Stores the exact SQL-produced substitutions before dispatch. */
export async function storeBriefing(
  callRunId: string,
  briefing: Briefing,
  deps: BriefingDeps,
): Promise<void> {
  const response = await deps.fetch(
    `${apiBase(deps.apiUrl)}/rest/v1/call_runs?id=eq.${encodeURIComponent(callRunId)}`,
    {
      method: "PATCH",
      headers: restHeaders(deps.serviceRoleKey, "return=minimal"),
      body: JSON.stringify({ briefing }),
    },
  );
  if (!response.ok) throw new Error("call_runs briefing update failed");
}

export function renderCallTask(briefing: Briefing): string {
  return CALL_TASK_TEMPLATE.replace(
    /{{(user_name|lead_line|open_items|last_call_summary|slot_local_time)}}/g,
    (placeholder, key: Exclude<keyof Briefing, "open_count">) => briefing[key] ?? placeholder,
  );
}

const testFn = (Deno as { test?: (name: string, fn: () => void | Promise<void>) => void }).test;
if (typeof testFn === "function") {
  const fixture: Briefing = {
    user_name: "Narayan",
    open_count: 1,
    lead_line: "You've mentioned the dentist four times. It's been 34 days.",
    open_items: "- dentist (id: item-1)",
    last_call_summary: "Last call we wrote down 1 new item. You promised 1 thing.",
    slot_local_time: "08:00",
  };

  // This is the reviewed task in docs/calle-call.md with every SQL-produced
  // value substituted. Keep it independent from CALL_TASK_TEMPLATE so edits
  // to the dispatch instruction must deliberately update the reviewed output.
  const expectedRenderedCallTask = `You are Orma, calling Narayan for their daily two-minute check-in.
Both of you know you are a machine. Do not pretend otherwise, and do not apologise for it.

Speak in short sentences. Leave no silence longer than two seconds. Phone audio is worse than you think, so say fewer words and say them plainly.

Work through these seven steps in order. Do not skip any of them.

1. Say exactly: "Hello. This is Orma."
   Then STOP and wait for them to answer.

   Expect this to be missed. The other person is still working out who is speaking. That is fine, because the sentence carries nothing they need to keep.

2. Say exactly: "Can you hear me?"
   Then STOP and wait for a yes.

   Do not go on until you get one. If they say no, or sound unsure, or say nothing, repeat step 1 and step 2 once more, plainly and more slowly. Nothing that matters is said until someone has confirmed they can hear you.

   Do not ask whether now is a good time. You are not asking permission.

3. Lead with what they do not know:
   You've mentioned the dentist four times. It's been 34 days.

   If they did not clearly hear it, say it once more before moving on. This line is the reason for the call, so it is the one thing worth repeating.

4. Walk what is open, briefly. Name each item once. Do not read the list twice.
   - dentist (id: item-1)
   Last call we wrote down 1 new item. You promised 1 thing.

5. Ask what is new and needs capturing. Never ask this before step 4.
   Only treat something as a new item if they confirm it in their next reply. If their answer is unclear, ask once, and drop it if it is still unclear. Capturing something they did not mean is worse than capturing nothing.

6. Offer the exit, in these words or close to them: "Anything on the list you want to drop?" If they want to drop something, agree cleanly. Do not argue, do not ask them to reconsider, do not make them justify it.

7. Confirm tomorrow at 08:00 and hang up.

Target two minutes. Do not state any number that was not given to you above.`;

  testFn("briefing RPC receives only source inputs and returns SQL scalars", async () => {
    let request: Request | undefined;
    const briefing = await assembleBriefing(
      { userId: "user-1", slotLocalTime: "08:00", now: "2026-09-12T00:00:00Z" },
      {
        apiUrl: "https://orma-api.nryn.dev",
        serviceRoleKey: "service-key",
        fetch: async (input, init) => {
          request = new Request(input, init);
          return Response.json(fixture);
        },
      },
    );
    if (briefing.lead_line !== fixture.lead_line) throw new Error("lead line changed outside SQL");
    if (!request?.url.endsWith("/rest/v1/rpc/assemble_briefing")) throw new Error("must call briefing RPC");
    const body = await request.json() as Record<string, string>;
    if (body.p_user_id !== "user-1" || body.p_slot_local_time !== "08:00" || !body.p_now) {
      throw new Error("RPC inputs are incomplete");
    }
  });

  testFn("golden briefing renders the reviewed CALL-E task byte for byte", () => {
    const rendered = renderCallTask(fixture);
    if (rendered !== expectedRenderedCallTask) {
      throw new Error("rendered CALL-E task differs from the reviewed task");
    }
  });

  testFn("briefing storage writes the exact assembled object", async () => {
    let body = "";
    await storeBriefing("run-1", fixture, {
      apiUrl: "https://orma-api.nryn.dev",
      serviceRoleKey: "service-key",
      fetch: async (_input, init) => {
        body = String(init?.body);
        return new Response(null, { status: 204 });
      },
    });
    if (body !== JSON.stringify({ briefing: fixture })) throw new Error("briefing storage changed the object");
  });
}
