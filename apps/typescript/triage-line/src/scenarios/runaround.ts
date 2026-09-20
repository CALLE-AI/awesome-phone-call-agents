/**
 * Scene 2 — Referral Runaround (chain).
 *
 * A single starting call whose result reveals the next prerequisite and the
 * next number to dial. The graph grows as calls complete, via expand().
 *
 * clinic -> gp -> insurer -> book. Each node's structuredResult carries
 * next_step plus the phone number for the following call, so the chain is
 * derived autonomously from what each call learns.
 */

import { makeNode, type CallGraph, type CallNode, type ResultSchema } from "../graph/types.js";
import { maskPhone } from "../util/phone.js";

const STEP_SCHEMA: ResultSchema = {
  type: "object",
  properties: {
    next_step: { type: "string" },
    note: { type: "string" },
    referral_phone: { type: "string" },
    insurer_phone: { type: "string" },
    preauth_code: { type: "string" },
    confirmation_number: { type: "string" },
    fee_mentioned: { type: "boolean" },
  },
  required: ["next_step"],
};

function chainNode(
  id: string,
  phone: string,
  goal: string,
  extra: Partial<CallNode> = {}
): CallNode {
  return makeNode({
    id,
    phone,
    region: "US",
    locale: "en-US",
    goal,
    resultSchema: STEP_SCHEMA,
    dependsOn: [],
    ...extra,
  });
}

export function buildRunaroundGraph(): CallGraph {
  // The clinic number is an explicit, authorized recipient supplied via config.
  // There is no built-in fixture fallback: if unset the value is empty and the
  // E.164 guard refuses to dial it (fail closed).
  const clinicPhone = (process.env.CLINIC_PHONE ?? "").trim();

  const start = chainNode(
    "runaround-clinic",
    clinicPhone,
    "Book an appointment with the specialist clinic for the patient. If a " +
      "referral or pre-authorization is required, find out exactly what is " +
      "needed and the phone number to arrange it."
  );

  return {
    id: "runaround",
    mode: "chain",
    nodes: [start],
    expand(node) {
      // A chain only advances from a cleanly completed step. If a step could
      // not be trusted (needs_review) or was halted by policy (needs_user,
      // e.g. a fee was mentioned), the chain stops here for a human to handle.
      if (node.status !== "done") return [];

      const r = node.result ?? {};
      const next = String(r["next_step"] ?? "");

      if (node.id === "runaround-clinic" && next === "gp_referral") {
        const discovered = String(r["referral_phone"] ?? "");
        return [
          chainNode(
            "runaround-gp",
            discovered,
            "Request a referral to the specialist for the patient. If the " +
              "insurer must pre-authorize first, get the insurer's phone number.",
            {
              dependsOn: [node.id],
              // The number was discovered from a prior call, not pre-authorized.
              // A human must approve before we dial it, and the E.164 guard
              // validates it at dial time.
              requiresApproval: true,
              proposedReason:
                `Prior call reported a GP referral line (${maskPhone(discovered)}); ` +
                `propose calling it.`,
            }
          ),
        ];
      }

      if (node.id === "runaround-gp" && next === "insurer_preauth") {
        const discovered = String(r["insurer_phone"] ?? "");
        return [
          chainNode(
            "runaround-insurer",
            discovered,
            "Obtain pre-authorization for the specialist visit and get the " +
              "pre-authorization code.",
            {
              dependsOn: [node.id],
              // Consent boundary: never agree to a fee on the patient's behalf.
              policy: { noFees: true },
              // Discovered number -> human approval required before dialing.
              requiresApproval: true,
              proposedReason:
                `Prior call reported an insurer line (${maskPhone(discovered)}); ` +
                `propose calling it.`,
            }
          ),
        ];
      }

      if (node.id === "runaround-insurer" && next === "book_clinic") {
        const hasPreauth = typeof r["preauth_code"] === "string" && r["preauth_code"] !== "";
        return [
          chainNode(
            "runaround-book",
            // Same authorized clinic recipient from config; no fixture fallback.
            clinicPhone,
            "Call the specialist clinic back with the pre-authorization code " +
              `${String(r["preauth_code"] ?? "")} and referral to book the ` +
              "appointment. Get a confirmation number.",
            {
              dependsOn: [node.id],
              resultSchema: {
                ...STEP_SCHEMA,
                required: ["next_step", "confirmation_number"],
              },
              // Booking is a consequential commitment. The mere presence of a
              // preauth code / result field does NOT authorize it — a human
              // must approve before this booking call is placed.
              requiresApproval: true,
              proposedReason: hasPreauth
                ? `Insurer returned a pre-authorization code; propose the final ` +
                  `booking call to the clinic (${maskPhone(clinicPhone)}).`
                : `Propose the final booking call to the clinic ` +
                  `(${maskPhone(clinicPhone)}).`,
            }
          ),
        ];
      }

      return [];
    },
  };
}
