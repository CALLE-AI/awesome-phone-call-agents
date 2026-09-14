/**
 * Line ownership verification.
 *
 * `greeting_code`: the operator puts a short code into the line's own
 * greeting or IVR announcement, and one verification call listens for it.
 * Only someone who controls the line can place the code, so a match proves
 * control — the cleanest consent story available to a monitoring tool.
 *
 * `attestation`: no call; the operator records a written statement of
 * authority (e.g. an MSA covering a client's line). The statement is stored
 * verbatim so an audit can see who claimed what, when.
 */

import type { BaselineStore } from "./baseline.js";
import type { CallePort } from "./calle.js";
import type { LineConfig } from "./config.js";
import { DISCLOSURE_PREAMBLE, idempotencyKeyFor } from "./runner.js";

function normalizeCode(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export async function verifyLine(
  line: LineConfig,
  port: CallePort | null,
  store: BaselineStore,
  now: () => Date = () => new Date(),
): Promise<{ ok: boolean; detail: string }> {
  if (line.ownership.method === "attestation") {
    store.recordVerification({
      lineId: line.id,
      phone: line.phone,
      method: "attestation",
      verifiedAt: now().toISOString(),
      callId: null,
    });
    return { ok: true, detail: `Recorded attestation for ${line.id}: ${line.ownership.statement}` };
  }

  if (port === null) {
    throw new Error("greeting_code verification places a call and needs a CALL-E port.");
  }
  const expected = line.ownership.code;
  // The task deliberately never mentions codes: asking an agent to "report a
  // verification code" trips provider anti-fraud guardrails (they cannot know
  // the code is ours, planted in our own greeting). A verbatim transcription
  // of the greeting carries the token anyway, and matching happens locally.
  const task =
    DISCLOSURE_PREAMBLE +
    "This is a routine line check. Listen to the complete greeting and any menu announcements from the start of the call. " +
    "Transcribe everything you hear as accurately and completely as possible, word for word. " +
    "Do not press any keys and do not ask questions. End the call once the announcements finish.";
  const created = await port.createCall(
    {
      task,
      recipients: [{ phones: [line.phone], region: line.region, locale: line.locale }],
      resultSchema: {
        type: "object",
        properties: {
          greeting_transcript: {
            type: "string",
            description: "Verbatim transcription of the greeting and announcements heard on the line.",
          },
        },
        required: ["greeting_transcript"],
        additionalProperties: false,
      },
      metadata: { linecanary_verify: line.id },
    },
    idempotencyKeyFor(`verify-${line.id}`, line.phone, now()),
  );
  const terminal = await port.waitForResult(created.id, { timeoutMs: 300_000, intervalMs: 5_000 });

  if (terminal.status !== "completed" || terminal.structuredResult === null) {
    return {
      ok: false,
      detail: `Verification call did not complete: ${terminal.failureCode ?? terminal.status}. Nothing was recorded.`,
    };
  }
  // Match against the structured transcription plus the raw transcript turns,
  // both normalized: spoken codes arrive as "L C 7 3 9 1", "LC-7391" or
  // "lc 73 91" depending on the ASR's mood.
  const turnText = (terminal.recipients[0]?.attempts[0]?.transcriptTurns ?? [])
    .filter((turn) => turn.speaker === "user")
    .map((turn) => turn.text)
    .join(" ");
  const heard = `${String(terminal.structuredResult.greeting_transcript ?? "")} ${turnText}`;
  if (normalizeCode(expected).length === 0 || !normalizeCode(heard).includes(normalizeCode(expected))) {
    return {
      ok: false,
      detail: `The greeting heard on ${line.id} does not contain the configured ownership token. Transcript: "${String(
        terminal.structuredResult.greeting_transcript ?? "",
      ).slice(0, 200)}". Nothing was recorded.`,
    };
  }
  store.recordVerification({
    lineId: line.id,
    phone: line.phone,
    method: "greeting_code",
    verifiedAt: now().toISOString(),
    callId: terminal.id,
  });
  return { ok: true, detail: `Line ${line.id} verified via greeting code (call ${terminal.id}).` };
}
