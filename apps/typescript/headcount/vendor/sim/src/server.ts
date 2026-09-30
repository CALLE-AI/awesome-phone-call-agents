import { Hono } from "hono";
import { loadFixture, pickPersona } from "./fixtures";
import type { PersonaId, StoredCall } from "./types";

const calls = new Map<string, StoredCall>();

function toCallPayload(stored: StoredCall, now = Date.now()) {
  const elapsed = now - stored.createdAt;
  const fixture = stored.fixture;
  const inProgress = elapsed < 1_500;
  const status = inProgress ? "in_progress" : fixture.status;
  const ready = !inProgress;

  return {
    id: stored.id,
    status,
    task_completed: ready ? fixture.task_completed : null,
    completion_confidence: ready ? fixture.completion_confidence : null,
    evidence: ready ? fixture.evidence : [],
    structured_result: ready ? fixture.structured_result : null,
    result: ready ? fixture.structured_result : null,
    error: null,
    recipients: [
      {
        structured_result: ready ? fixture.recipient_structured_result : null,
        disposition: ready ? fixture.disposition : null,
        attempts: [
          {
            transcript_turns: ready ? fixture.transcript_turns : [],
          },
        ],
      },
    ],
  };
}

export function createSimApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "calle-sim" }));

  app.post("/v1/calls", async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const persona = pickPersona(body);
    const fixture = loadFixture(persona);
    const id = `sim_${persona}_${Date.now().toString(36)}`;
    const stored: StoredCall = {
      id,
      createdAt: Date.now(),
      persona,
      request: body,
      fixture,
    };
    calls.set(id, stored);
    return c.json(toCallPayload(stored), 201);
  });

  app.get("/v1/calls/:id", (c) => {
    const stored = calls.get(c.req.param("id"));
    if (!stored) return c.json({ error: "not_found" }, 404);
    return c.json(toCallPayload(stored));
  });

  return app;
}

export function resetSim() {
  calls.clear();
}

export type { PersonaId };
