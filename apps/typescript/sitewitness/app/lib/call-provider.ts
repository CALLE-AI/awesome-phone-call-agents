import { publicProviderError } from "./output-privacy.ts";
import { demoFixture } from "./demo-fixtures.ts";
import { CALL_EVIDENCE_SCHEMA, normalizeEvidenceResult } from "./evidence.ts";
export type ProviderMode = "fake" | "calle_goal" | "calle_calls";
export type Scalar = string | number | boolean;

export type GoalRunLaunchRequest = { goalId: string; interviewId: string; authorizationVersion: number; phone: string; variables: Record<string, Scalar>; task?: string; resultSchema?: Record<string, unknown> };
export type PublishedGoal = { id: string; title: string; status: string; runSpecId: string; runSpecVersion: number; inputSchema: Record<string, unknown>; resultSchema: Record<string, unknown> };
export type GoalRun = { goalRunId: string; telephoneRunId: string | null; status: string; runSpecId: string | null; runSpecVersion: number | null; result: Record<string, unknown> | null; error: { code: string; message: string } | null; terminal: boolean; raw: unknown };
export interface GoalRunProvider { readonly mode: ProviderMode; getGoal(goalId: string): Promise<PublishedGoal>; create(request: GoalRunLaunchRequest): Promise<GoalRun>; get(goalId: string, goalRunId: string): Promise<GoalRun> }

const APPROVED_PROVIDER_ORIGINS = new Set(["https://api.heycall-e.com"]);
export function approvedProviderBase(base: string): string {
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("CALL-E requires an approved HTTPS API origin."); }
  if (!APPROVED_PROVIDER_ORIGINS.has(url.origin) || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("CALL-E requires an approved HTTPS API origin.");
  return url.origin;
}

function providerStatus(value: unknown): string {
  const status = String(value || "").toUpperCase();
  return ["QUEUED", "PENDING", "CREATED", "IN_PROGRESS", "DIALING", "RINGING", "COMPLETED", "FAILED", "CANCELED", "CANCELLED"].includes(status) ? status : "UNKNOWN";
}

function credentialedFetch(request: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    if (!APPROVED_PROVIDER_ORIGINS.has(url.origin) || url.protocol !== "https:" || url.username || url.password)
      throw new Error("CALL-E request destination is not approved.");
    let response: Response;
    try { response = await request(input, { ...init, redirect: "error" }); }
    catch { throw new Error("CALL-E request could not be completed. Check the private provider workspace."); }
    // Fail closed even for transports that do not honor redirect: error.
    if (response.redirected || (response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
      throw new Error("CALL-E redirects are not permitted.");
    return response;
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CALL-E returned an invalid object.");
  return value as Record<string, unknown>;
}

function normalizeGoal(payload: unknown): PublishedGoal {
  const root = object(payload);
  const spec = object(root.published_run_spec);
  if (typeof root.id !== "string" || typeof spec.id !== "string" || typeof spec.version !== "number") throw new Error("CALL-E returned an incomplete published Goal interface.");
  return { id: root.id, title: String(root.title || root.id), status: String(root.status || "unknown"), runSpecId: spec.id, runSpecVersion: spec.version, inputSchema: object(spec.input_schema), resultSchema: object(spec.result_schema) };
}

function normalizeRun(payload: unknown): GoalRun {
  const root = object(payload);
  if (typeof root.id !== "string") throw new Error("CALL-E did not return a Goal Run identifier.");
  const spec = root.run_spec && typeof root.run_spec === "object" ? root.run_spec as Record<string, unknown> : {};
  const apiError = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : null;
  const result = root.result && typeof root.result === "object" && !Array.isArray(root.result) ? root.result as Record<string, unknown> : null;
  return { goalRunId: root.id, telephoneRunId: typeof root.run_id === "string" ? root.run_id : null, status: providerStatus(root.status), runSpecId: typeof spec.id === "string" ? spec.id : null, runSpecVersion: typeof spec.version === "number" ? spec.version : null, result, error: publicProviderError(apiError), terminal: result !== null || apiError !== null, raw: payload };
}

export class CalleApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(operation: string, status: number, code: string, message: string) {
    super(`${operation} failed (HTTP ${status}). Check the private CALL-E workspace.`);
    this.name = "CalleApiError";
    this.status = status;
    this.code = `HTTP_${status}`;
  }
}

async function jsonOrError(response: Response, operation: string): Promise<unknown> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CalleApiError(operation, response.status, "", "");
  }
  return payload;
}

export class CalleGoalRunProvider implements GoalRunProvider {
  readonly mode = "calle_goal" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  constructor(apiKey: string, baseUrl = "https://api.heycall-e.com", request: typeof fetch = fetch) { this.apiKey = apiKey; this.baseUrl = approvedProviderBase(baseUrl); this.request = credentialedFetch(request); }
  private headers(extra: Record<string, string> = {}) { return { authorization: `Bearer ${this.apiKey}`, ...extra }; }
  async getGoal(goalId: string): Promise<PublishedGoal> {
    const response = await this.request(`${this.baseUrl}/v1/goals/${encodeURIComponent(goalId)}`, { headers: this.headers() });
    return normalizeGoal(await jsonOrError(response, "CALL-E Goal lookup"));
  }
  async create(input: GoalRunLaunchRequest): Promise<GoalRun> {
    const response = await this.request(`${this.baseUrl}/v1/goals/${encodeURIComponent(input.goalId)}/runs`, { method: "POST", headers: this.headers({ "content-type": "application/json", "idempotency-key": `sitewitness:${input.interviewId}:${input.authorizationVersion}` }), body: JSON.stringify({ phone: input.phone, variables: input.variables }) });
    return normalizeRun(await jsonOrError(response, "CALL-E Goal Run creation"));
  }
  async get(goalId: string, goalRunId: string): Promise<GoalRun> {
    const response = await this.request(`${this.baseUrl}/v1/goals/${encodeURIComponent(goalId)}/runs/${encodeURIComponent(goalRunId)}`, { headers: this.headers() });
    return normalizeRun(await jsonOrError(response, "CALL-E Goal Run status"));
  }
}

function normalizeCall(payload: unknown, events: Record<string, unknown>[] = []): GoalRun {
  const root = object(payload);
  if (typeof root.id !== "string") throw new Error("CALL-E did not return a Call identifier.");
  const taskStatus = providerStatus(root.status);
  let status = taskStatus;
  const result = root.structured_result && typeof root.structured_result === "object" && !Array.isArray(root.structured_result)
    ? root.structured_result as Record<string, unknown>
    : null;
  const terminal = ["COMPLETED", "FAILED", "CANCELED", "CANCELLED"].includes(taskStatus);
  if (!terminal) {
    const recipients = Array.isArray(root.recipients) ? root.recipients as Record<string, unknown>[] : [];
    const attempts = recipients.flatMap((r) => Array.isArray(r.attempts) ? r.attempts as Record<string, unknown>[] : []);
    const states = [...recipients, ...attempts].map((item) => String(item.status || "").toUpperCase());
    const latestEvent = events.at(-1);
    const eventStatus = String(latestEvent?.status || "").toUpperCase();
    // Telephone completion precedes post-call extraction. Keep polling for the result.
    const recipientsEnded = recipients.length > 0 && recipients.every((r) => {
      const lastAttempt = Array.isArray(r.attempts) ? r.attempts.at(-1) as Record<string, unknown> | undefined : undefined;
      return ["COMPLETED", "FAILED", "CANCELED", "CANCELLED"].includes(providerStatus(r.status)) || providerStatus(lastAttempt?.status) === "COMPLETED";
    });
    if (recipientsEnded || ["COMPLETED", "FAILED", "CANCELED", "CANCELLED"].includes(eventStatus)) status = "PROCESSING_EVIDENCE";
    else if (states.includes("IN_PROGRESS") || eventStatus === "IN_PROGRESS") status = "IN_PROGRESS";
    else if (states.includes("RINGING") || states.includes("DIALING")) status = "DIALING";
  }
  const failure = typeof root.failure_message === "string" && root.failure_message
    ? publicProviderError({ code: root.failure_code })
    : terminal && !result
      ? { code: "result_failed", message: "CALL-E completed the call but did not return a schema-valid structured result." }
      : null;
  return { goalRunId: root.id, telephoneRunId: root.id, status, runSpecId: "calls_api_v1", runSpecVersion: 1, result, error: failure, terminal, raw: payload };
}

export class CalleCallsProvider implements GoalRunProvider {
  readonly mode = "calle_calls" as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly request: typeof fetch;
  constructor(apiKey: string, baseUrl = "https://api.heycall-e.com", request: typeof fetch = fetch) { this.apiKey = apiKey; this.baseUrl = approvedProviderBase(baseUrl); this.request = credentialedFetch(request); }
  private headers(extra: Record<string, string> = {}) { return { authorization: `Bearer ${this.apiKey}`, ...extra }; }
  async getGoal(): Promise<PublishedGoal> {
    return { ...FAKE_PUBLISHED_GOAL, id: "calls_api_v1", title: "CALL-E Calls API evidence interview", runSpecId: "calls_api_v1" };
  }
  async create(input: GoalRunLaunchRequest): Promise<GoalRun> {
    if (!input.task?.trim()) throw new Error("An approved stored interview brief is required.");
    const task = input.task;
    const response = await this.request(`${this.baseUrl}/v1/calls`, {
      method: "POST",
      headers: this.headers({ "content-type": "application/json", "idempotency-key": `sitewitness:${input.interviewId}:${input.authorizationVersion}` }),
      body: JSON.stringify({
        task,
        recipients: [{ phones: [input.phone] }],
        result_schema: input.resultSchema || CALL_EVIDENCE_SCHEMA,
        metadata: { interview_id: input.interviewId, authorization_version: input.authorizationVersion },
      }),
    });
    return normalizeCall(await jsonOrError(response, "CALL-E Call creation"));
  }
  async get(_goalId: string, callId: string): Promise<GoalRun> {
    const url = `${this.baseUrl}/v1/calls/${encodeURIComponent(callId)}`;
    const response = await this.request(url, { headers: this.headers(), cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const payload = await jsonOrError(response, "CALL-E Call status");
    const run = normalizeCall(payload);
    if (run.terminal) return run;
    // Events can advance before the task snapshot. An unavailable event feed must
    // not discard a successfully retrieved snapshot or stop polling.
    try {
      const events: Record<string, unknown>[] = [];
      let cursor: string | null = null;
      const deadline = AbortSignal.timeout(5_000);
      do {
        const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
        const response = await this.request(`${url}/events?limit=100${query}`, { headers: this.headers(), cache: "no-store", signal: deadline });
        const page = object(await jsonOrError(response, "CALL-E Call events"));
        if (Array.isArray(page.data)) events.push(...page.data as Record<string, unknown>[]);
        const next = typeof page.next_cursor === "string" ? page.next_cursor : null;
        if (next === cursor) break;
        cursor = next;
      } while (cursor);
      return normalizeCall(payload, events);
    } catch { return run; }
  }
}

export const REQUIRED_GOAL_INPUTS = ["property", "domain_type", "evidence_gap", "known_records", "relevant_years", "respondent_role"] as const;
export const REQUIRED_GOAL_RESULTS = ["factual_statements", "source_type", "supporting_quotes", "uncertainty_notes"] as const;

export function verifyGoalContract(goal: PublishedGoal) {
  const input = object(goal.inputSchema.properties);
  const output = object(goal.resultSchema.properties);
  const missingInputs = REQUIRED_GOAL_INPUTS.filter((key) => !(key in input));
  const missingResults = REQUIRED_GOAL_RESULTS.filter((key) => !(key in output));
  return { valid: goal.status === "active" && missingInputs.length === 0 && missingResults.length === 0, missingInputs, missingResults };
}

export function normalizeGoalResult(result: Record<string, unknown>) {
  return normalizeEvidenceResult(result);
}

export const SITEWITNESS_GOAL_RESULT_SCHEMA = {
  type: "object", additionalProperties: false, required: [...REQUIRED_GOAL_RESULTS],
  properties: {
    factual_statements: { type: "string", description: "One concise respondent-attributed factual statement supported by the call; use unknown if none is available." },
    source_type: { type: "string", enum: ["direct observation", "hearsay", "record", "assumption", "unknown"], description: "The basis for the factual statement." },
    supporting_quotes: { type: "string", description: "An exact short quote spoken by the respondent that supports the factual statement; use unknown if unavailable." },
    uncertainty_notes: { type: "string", description: "Any uncertainty, access limit, knowledge-period limit, or unresolved point; use none if explicitly absent." },
  },
} as const;

const fakeInputProperties = Object.fromEntries(REQUIRED_GOAL_INPUTS.map((key) => [key, { type: "string" }]));
export const FAKE_PUBLISHED_GOAL: PublishedGoal = { id: "goal_phase1_evidence_gap_v1", title: "Phase I evidence gap interview", status: "active", runSpecId: "rspec_phase1_v1", runSpecVersion: 1, inputSchema: { type: "object", additionalProperties: false, required: [...REQUIRED_GOAL_INPUTS], properties: fakeInputProperties }, resultSchema: SITEWITNESS_GOAL_RESULT_SCHEMA };
export const FAKE_GOAL_RESULT = {
  outcome: "bounded", knowledge_period: "1991-1996", direct_observation_summary: "Drop-off and pickup were personally observed from 1991 through 1994.", hearsay_summary: "No hearsay was relied upon.", limitations: "The respondent rarely entered the rear storage room and had no personal knowledge before 1991.", unknowns: "Operations from 1987 through 1990 and activity inside the rear storage room remain unknown.", new_leads: "The prior manager and archived tenant file may provide additional evidence.", evidence_summary: "The respondent confirmed the knowledge period, observed activity, and access limits.", human_review_required: "yes",
  statements: [
    { fact: "The respondent personally knew the property from 1991 through 1996.", source_type: "first_hand", certainty: "confirmed", evidence_quote: "I managed the building from 1991 through 1996." },
    { fact: "The respondent personally observed garment drop-off and pickup from 1991 through 1994.", source_type: "first_hand", certainty: "confirmed", evidence_quote: "Customers dropped clothes off and picked them up." },
    { fact: "The respondent did not observe cleaning machines in routinely accessed areas.", source_type: "first_hand", certainty: "confirmed", evidence_quote: "I never saw cleaning happen or saw a dry-cleaning machine in the areas I used." },
    { fact: "The respondent rarely accessed the rear storage room.", source_type: "knowledge_limitation", certainty: "confirmed", evidence_quote: "I rarely went into the rear storage room, so I can't say what was kept there." },
    { fact: "The respondent has no first-hand knowledge before 1991.", source_type: "first_hand", certainty: "confirmed", evidence_quote: "No, that was before my time." },
  ],
};

export class FakeGoalRunProvider implements GoalRunProvider {
  readonly mode = "fake" as const;
  async getGoal() { return FAKE_PUBLISHED_GOAL; }
  async create(input: GoalRunLaunchRequest): Promise<GoalRun> {
    const scenario = ["direct", "declined"].includes(String(input.variables.demo_scenario)) ? String(input.variables.demo_scenario) : "bounded";
    return { goalRunId: `fake-call-${scenario}-${input.interviewId}-${input.authorizationVersion}`, telephoneRunId: "synthetic-phone-run", status: "IN_PROGRESS", runSpecId: "synthetic-fixture", runSpecVersion: 2, result: null, error: null, terminal: false, raw: { synthetic: true, status: "in_progress" } };
  }
  async get(_goalId: string, goalRunId: string): Promise<GoalRun> {
    const scenario = goalRunId.startsWith("fake-call-direct-") ? "direct" : goalRunId.startsWith("fake-call-declined-") ? "declined" : "bounded";
    const fixture = demoFixture(scenario);
    return { goalRunId, telephoneRunId: "synthetic-phone-run", status: "COMPLETED", runSpecId: "synthetic-fixture", runSpecVersion: 2, result: fixture.result, error: null, terminal: true, raw: { ...fixture.raw, id: goalRunId, status: "completed", structured_result: fixture.result } };
  }
}
