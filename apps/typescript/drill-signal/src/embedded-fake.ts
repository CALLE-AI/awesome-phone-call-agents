/**
 * Embedded loopback fake CALL-E server for fake-server mode demos.
 * Started by the HTTP server when CALLE_BASE_URL is not configured.
 */

import { startFakeCalle, type FakeCalle } from "./fake/calle-server.js";

let embedded: FakeCalle | null = null;
let startPromise: Promise<string> | null = null;

export async function ensureEmbeddedFakeBaseUrl(): Promise<string> {
  if (embedded) {
    return embedded.baseUrl;
  }
  if (!startPromise) {
    startPromise = (async () => {
      embedded = await startFakeCalle([
        {
          phone: "+15550100001",
          structuredResult: {
            reached_live_person: true,
            acknowledged_scenario: true,
            can_take_ownership: true,
            first_action: "Open the incident bridge.",
            escalation_target: null,
            needs_help: false,
            follow_up_required: false,
            opt_out: false,
          },
          botLines: ["This is a scheduled outage drill call."],
          userLines: ["Acknowledged. I can take ownership."],
        },
        {
          phone: "+15550100002",
          status: "failed",
          failureCode: "no_answer",
          structuredResult: null,
        },
        {
          phone: "+15550100003",
          structuredResult: {
            reached_live_person: true,
            acknowledged_scenario: true,
            can_take_ownership: true,
            first_action: "Assume primary duties.",
            escalation_target: null,
            needs_help: false,
            follow_up_required: false,
            opt_out: false,
          },
        },
      ]);
      return embedded.baseUrl;
    })();
  }
  return startPromise;
}

export async function closeEmbeddedFake(): Promise<void> {
  if (embedded) {
    await embedded.close();
    embedded = null;
    startPromise = null;
  }
}
