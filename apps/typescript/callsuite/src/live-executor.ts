import { CalleClient, type Call, type CreateCallInput, type EventList, type JsonObject } from "@call-e/calle";

import { assertAuthorizedTarget } from "./authorized-targets.js";
import { normalizeResult, type NormalizedResult, type Verdict } from "./result.js";

const CALL_E_API_ORIGIN = "https://api.heycall-e.com";

export interface LiveCallClient {
  calls: {
    createAndWait(input: CreateCallInput): Promise<Call>;
    listEvents(callId: string): Promise<EventList>;
  };
}

export interface LiveExecutionInput {
  apiKey: string;
  target: string;
  authorizedTargets: ReadonlySet<string>;
  region: string;
  locale: string;
  task: string;
  resultSchema: JsonObject;
  toVerdict(structuredResult: unknown): Verdict;
}

export interface LiveExecution {
  call: Call;
  events: EventList;
  result: NormalizedResult;
}

export function createPinnedFetch(
  performFetch: (request: Request) => Promise<Response> = (request) => fetch(request),
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.origin !== CALL_E_API_ORIGIN) {
      throw new Error("Refusing to send CALL-E credentials outside the approved HTTPS API origin.");
    }

    return performFetch(new Request(request, { redirect: "error" }));
  };
}

export function createPinnedCalleClient(apiKey: string): LiveCallClient {
  return new CalleClient({
    apiKey,
    baseUrl: CALL_E_API_ORIGIN,
    fetch: createPinnedFetch(),
  });
}

export async function executeAuthorizedCall(
  input: LiveExecutionInput,
  createClient: (apiKey: string) => LiveCallClient,
): Promise<LiveExecution> {
  // This must remain before createClient: an unauthorized target cannot even
  // construct a provider client, let alone submit a network request.
  assertAuthorizedTarget(input.target, input.authorizedTargets);

  const client = createClient(input.apiKey);
  const call = await client.calls.createAndWait({
    task: input.task,
    recipient: {
      phone: input.target,
      region: input.region,
      locale: input.locale,
    },
    resultSchema: input.resultSchema,
  });
  const events = await client.calls.listEvents(call.id);
  const result = normalizeResult({
    callStatus: call.status,
    structuredResult: { verdict: input.toVerdict(call.structuredResult) },
    confidence: call.completionConfidence?.score ?? null,
  });

  return { call, events, result };
}
