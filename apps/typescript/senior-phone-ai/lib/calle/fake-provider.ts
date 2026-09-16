import { assertCalleCallId } from "./status";

export interface FakeCalleScenario {
  readonly callId: string;
  readonly snapshots: readonly Readonly<Record<string, unknown>>[];
}

export interface FakeCalleProvider {
  readonly fetch: typeof fetch;
  readonly requestCount: () => number;
}

/** Offline CALL-E HTTP boundary for deterministic tests and demos. It never reads credentials or opens a socket. */
export function createFakeCalleProvider(scenario: FakeCalleScenario): FakeCalleProvider {
  const callId = assertCalleCallId(scenario.callId);
  if (!scenario.snapshots.length) throw new Error("fake CALL-E scenario requires at least one snapshot");
  let requests = 0;
  let reads = 0;

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    requests += 1;
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.heycall-e.com") return Response.json({ error: "unexpected origin" }, { status: 400 });

    if (request.method === "POST" && url.pathname === "/v1/calls") {
      return Response.json({ ...scenario.snapshots[0], id: callId }, { status: 201 });
    }
    if (request.method === "GET" && url.pathname === `/v1/calls/${callId}`) {
      const snapshot = scenario.snapshots[Math.min(reads, scenario.snapshots.length - 1)];
      reads += 1;
      return Response.json({ ...snapshot, id: callId });
    }
    return Response.json({ error: "not found" }, { status: 404 });
  };

  return { fetch: fakeFetch as typeof fetch, requestCount: () => requests };
}
