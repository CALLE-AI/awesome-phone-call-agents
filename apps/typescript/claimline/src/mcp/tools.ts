import { z, type ZodRawShape } from "zod";
import { maskClaim, maskContact, maskIntent, type ClaimLineApp } from "../app.js";
import type { CallType } from "../domain/types.js";

/**
 * A ClaimLine capability exposed over MCP. Handlers return plain data (masked
 * where relevant) so they are unit-testable without the MCP transport; the
 * server wraps the return value into MCP tool content.
 */
export interface ClaimlineTool {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
}

function mapCallType(value: unknown): CallType {
  const v = String(value ?? "fnol").toLowerCase();
  if (v === "status" || v === "status_chase") return "status_chase";
  return "fnol_intake";
}

const callTypeSchema = z
  .enum(["fnol", "status", "fnol_intake", "status_chase"])
  .describe("Which call to run: fnol (intake) or status (status chase).");

export function buildTools(app: ClaimLineApp): ClaimlineTool[] {
  return [
    {
      name: "list_claims",
      description:
        "List all claims with their calls, results, and decisions. Phone numbers are masked.",
      inputSchema: {},
      handler: () => ({ claims: app.listPublicClaimViews() }),
    },
    {
      name: "get_claim",
      description:
        "Get one claim (by id or reference like CLM-1001) with its calls and results. Phone numbers are masked.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference, e.g. CLM-1001."),
      },
      handler: (args) => {
        const view = app.getPublicClaimView(
          app.resolveClaimId(String(args.claim)),
        );
        if (!view) throw new Error("claim not found");
        return view;
      },
    },
    {
      name: "create_claim",
      description:
        "Create a claim. Phone numbers must be E.164 (e.g. +12025550142) and are stored access-controlled; only masked forms are returned.",
      inputSchema: {
        reference: z.string().describe("Human reference, e.g. CLM-2001."),
        policyholderName: z.string(),
        claimantPhone: z.string().describe("Claimant phone in E.164 format."),
        incidentType: z
          .string()
          .describe("e.g. auto_collision, property_water."),
        region: z.string().optional().describe("Defaults to US."),
        locale: z.string().optional().describe("Defaults to en-US."),
        providerName: z.string().optional(),
        providerPhone: z
          .string()
          .optional()
          .describe("Provider phone in E.164 (for status-chase calls)."),
        notes: z.string().optional(),
      },
      handler: (args) =>
        maskClaim(
          app.createClaim({
            reference: String(args.reference),
            policyholderName: String(args.policyholderName),
            claimantPhone: String(args.claimantPhone),
            incidentType: String(args.incidentType),
            region: args.region ? String(args.region) : undefined,
            locale: args.locale ? String(args.locale) : undefined,
            providerName: args.providerName ? String(args.providerName) : null,
            providerPhone: args.providerPhone
              ? String(args.providerPhone)
              : null,
            notes: args.notes ? String(args.notes) : null,
          }),
        ),
    },
    {
      name: "preview_call",
      description:
        "Preview the spoken goal, masked destination, and result schema for a call. Places NO call.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference."),
        callType: callTypeSchema,
      },
      handler: (args) =>
        app.dispatcher.preview(
          app.resolveClaimId(String(args.claim)),
          mapCallType(args.callType),
        ),
    },
    {
      name: "dispatch_call",
      description:
        "Dispatch a call. Without confirm=true it only reserves + previews and places NO call. In fixture mode calls are simulated. Returns the intent (masked) and status.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference."),
        callType: callTypeSchema,
        confirm: z
          .boolean()
          .optional()
          .describe("Must be true to actually place (or simulate) the call."),
        fixtureScenario: z
          .string()
          .optional()
          .describe(
            "Fixture mode only: fnol_ok, status_ok, voicemail, refusal, low_confidence, failed.",
          ),
      },
      handler: async (args) => {
        const outcome = await app.dispatcher.dispatch(
          app.resolveClaimId(String(args.claim)),
          mapCallType(args.callType),
          {
            confirm: args.confirm === true,
            ...(args.fixtureScenario
              ? { fixtureScenario: String(args.fixtureScenario) }
              : {}),
          },
        );
        return { ...outcome, intent: maskIntent(outcome.intent) };
      },
    },
    {
      name: "reconcile",
      description:
        "Run one reconciliation pass: fetch authoritative call state, verify, classify, and transition intents.",
      inputSchema: {},
      handler: () => app.reconciler.pollOnce(),
    },
    {
      name: "cancel_intent",
      description: "Cancel a reserved intent before it is dialed.",
      inputSchema: { intentId: z.string() },
      handler: (args) => maskIntent(app.dispatcher.cancel(String(args.intentId))),
    },
    {
      name: "get_case",
      description:
        "Get the aggregated case for a claim: all associated parties (claimant, doctor, billing, ...), their call results, the computed total billed, and any sanction decision. Phone numbers are masked.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference, e.g. CLM-2101."),
      },
      handler: (args) => {
        const view = app.getCaseView(app.resolveClaimId(String(args.claim)));
        if (!view) throw new Error("claim not found");
        return view;
      },
    },
    {
      name: "add_contact",
      description:
        "Add an associated party to a claim (treating_doctor, hospital_billing, repair_shop, witness, other). Phone must be E.164.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference."),
        role: z.enum([
          "treating_doctor",
          "hospital_billing",
          "repair_shop",
          "witness",
          "other",
        ]),
        name: z.string(),
        phone: z.string().describe("E.164 phone, e.g. +12025550109."),
        note: z.string().optional(),
      },
      handler: (args) =>
        maskContact(
          app.addContact(app.resolveClaimId(String(args.claim)), {
            role: args.role as
              | "treating_doctor"
              | "hospital_billing"
              | "repair_shop"
              | "witness"
              | "other",
            name: String(args.name),
            phone: String(args.phone),
            note: args.note ? String(args.note) : null,
          }),
        ),
    },
    {
      name: "call_contact",
      description:
        "Dispatch a role-appropriate call to a specific contact. Without confirm=true it only previews and places NO call. Returns the intent (masked).",
      inputSchema: {
        contactId: z.string(),
        confirm: z.boolean().optional(),
        fixtureScenario: z
          .string()
          .optional()
          .describe(
            "Fixture mode only: medical_ok, bill_ok, fnol_ok, status_ok, voicemail, refusal, low_confidence, failed.",
          ),
      },
      handler: async (args) => {
        const contact = app.store.getContact(String(args.contactId));
        if (!contact) throw new Error("contact not found");
        const outcome = await app.dispatcher.dispatchToContact(
          contact.claimId,
          contact.id,
          {
            confirm: args.confirm === true,
            ...(args.fixtureScenario
              ? { fixtureScenario: String(args.fixtureScenario) }
              : {}),
          },
        );
        return { ...outcome, intent: maskIntent(outcome.intent) };
      },
    },
    {
      name: "sanction_claim",
      description:
        "Record the human-owned claim outcome (approved/rejected/hold) with an optional sanctioned amount. ClaimLine only gathers facts; this decision is a person's.",
      inputSchema: {
        claim: z.string().describe("Claim id or reference."),
        decidedBy: z.string(),
        decision: z.enum(["approved", "rejected", "hold"]),
        sanctionedAmount: z.number().optional(),
        currency: z.string().optional(),
        note: z.string().optional(),
      },
      handler: (args) =>
        app.sanctionClaim(app.resolveClaimId(String(args.claim)), {
          decidedBy: String(args.decidedBy),
          decision: args.decision as "approved" | "rejected" | "hold",
          sanctionedAmount:
            typeof args.sanctionedAmount === "number"
              ? args.sanctionedAmount
              : null,
          currency: args.currency ? String(args.currency) : null,
          note: args.note ? String(args.note) : null,
        }),
    },
  ];
}
