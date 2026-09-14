import { NextResponse } from "next/server";
import { z } from "zod";
import { issueCallAccessToken } from "@/lib/call-access";
import { createLiveCall, describeError, submissionRejected } from "@/lib/calle";
import {
  bloodInquiryBrief,
  bloodNeed,
  bloodReserveBrief,
  holdBrief,
  inquiryBrief,
  prescriberBrief,
  renderTask,
  RESULT_SCHEMAS,
  transferBrief,
} from "@/lib/calltasks";
import { dailyCap, liveEnabled, operatorCodeValid, releaseLiveCall, reserveLiveCall, resolveDialTarget, webhookUrl } from "@/lib/config";
import { verifyFacility } from "@/lib/discovery-signing";
import { recordCreated, recordUnknownSubmission } from "@/lib/ledger";
import { redactDeep, toE164 } from "@/lib/phone";
import { bloodItem, medicationItem } from "@/lib/pulse-item";
import { parseBloodInquiryResult, parseHoldResult, parseInquiryResult } from "@/lib/result-validation";
import { createSimulatedCall } from "@/lib/simulator";
import type { BriefSpec } from "@/lib/types";

const urgency = z.enum(["today", "48h", "week"]);

const facilitySchema = z.object({
  id: z.string().max(120),
  kind: z.enum(["pharmacy", "blood_bank"]),
  name: z.string().min(1).max(120),
  brand: z.string().max(80).nullable(),
  address: z.string().max(200),
  lat: z.number(),
  lon: z.number(),
  distanceKm: z.number(),
  bearingDeg: z.number(),
  phone: z.string().max(20).nullable(),
  phoneMasked: z.string().max(40).nullable(),
  openingHours: z.string().max(300).nullable(),
  source: z.enum(["openstreetmap", "google", "synthetic"]),
  mapsUrl: z.string().max(500).nullable(),
  rating: z.number().nullable(),
  openNow: z.boolean().nullable(),
  signature: z.string().max(200).nullable(),
});

const medicationSchema = z.object({
  rxcui: z.string().max(20).nullable(),
  name: z.string().min(2).max(160),
  ingredient: z.string().max(200).nullable(),
  brandNames: z.array(z.string().max(60)).max(5),
  quantity: z.string().min(1).max(60),
  alternatives: z.array(z.string().max(160)).max(6),
  controlled: z.boolean(),
  deaSchedule: z.string().max(10).nullable(),
  urgency,
});

const bloodSchema = z.object({
  group: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]),
  component: z.enum(["whole_blood", "packed_red_cells", "platelets", "fresh_frozen_plasma", "cryoprecipitate"]),
  units: z.number().int().min(1).max(20),
  hospital: z.string().trim().min(2).max(120),
  urgency,
});

// Name and date of birth are shared only with the office or pharmacy that holds the prescription.
const consentedPatient = {
  patientFullName: z.string().trim().min(2).max(80),
  patientDob: z.string().trim().min(4).max(20),
  consent: z.literal(true),
};

const bodySchema = z.object({
  kind: z.enum(["inquiry", "hold", "prescriber", "transfer", "blood_inquiry", "blood_reserve"]),
  missionId: z.string().regex(/^[a-z0-9-]{6,40}$/i),
  attempt: z.number().int().min(1).max(5).default(1),
  routing: z.enum(["simulation", "test_line", "direct"]),
  testLineIndex: z.number().int().min(0).max(50).default(0),
  seed: z.number().int().min(0).max(1000).default(0),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).optional(),
  operatorCode: z.string().max(100).optional(),
  directConsent: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  facility: facilitySchema,
  medication: medicationSchema.optional(),
  blood: bloodSchema.optional(),
  inquiry: z.record(z.unknown()).nullable().optional(),
  hold: z.record(z.unknown()).nullable().optional(),
  holdContact: z
    .object({
      firstName: z.string().trim().min(1).max(40),
      lastInitial: z.string().trim().min(1).max(2),
      holdUntil: z.string().max(60),
    })
    .optional(),
  prescriber: z
    .object({
      practice: z.string().trim().min(2).max(120),
      prescriberName: z.string().trim().min(2).max(80),
      phone: z.string().max(30),
      ...consentedPatient,
    })
    .optional(),
  transfer: z
    .object({
      fromPharmacy: z.string().trim().min(2).max(120),
      phone: z.string().max(30),
      ...consentedPatient,
    })
    .optional(),
});

type Body = z.infer<typeof bodySchema>;
type Planned = { brief: BriefSpec; needSummary: string; staffName: string } | { error: string };

/** Builds the structured brief for this call kind, refusing inputs that don't justify the call. */
function plan(body: Body): Planned {
  const { kind, facility } = body;
  if (kind === "blood_inquiry" || kind === "blood_reserve") {
    if (!body.blood) return { error: "A blood bank call needs a blood request." };
    if (facility.kind !== "blood_bank") return { error: "This call needs a blood bank." };
    const needSummary = bloodNeed(body.blood);
    if (kind === "blood_inquiry") return { brief: bloodInquiryBrief(body.blood, facility), needSummary, staffName: "" };
    const inquiry = parseBloodInquiryResult(body.inquiry);
    if (!body.holdContact || !inquiry || inquiry.stock_status !== "in_stock") {
      return { error: "A reservation needs a valid inquiry confirming the full requested units, plus a first name and last initial." };
    }
    return { brief: bloodReserveBrief(body.blood, facility, inquiry, body.holdContact), needSummary, staffName: inquiry.staff_name };
  }

  if (!body.medication) return { error: "A pharmacy call needs a medication." };
  if (facility.kind !== "pharmacy") return { error: "This call needs a pharmacy." };
  const med = body.medication;
  const needSummary = `${med.name} · ${med.quantity}`;
  if (kind === "inquiry") return { brief: inquiryBrief(med, facility), needSummary, staffName: "" };
  if (kind === "hold") {
    const inquiry = parseInquiryResult(body.inquiry);
    if (!body.holdContact || !inquiry || inquiry.stock_status !== "in_stock") {
      return { error: "A hold needs a valid inquiry confirming the full requested quantity, plus a first name and last initial." };
    }
    return { brief: holdBrief(med, facility, inquiry, body.holdContact), needSummary, staffName: inquiry.staff_name };
  }
  const hold = parseHoldResult(body.hold);
  if (body.hold != null && !hold) return { error: "The hold result is not valid." };
  if (kind === "transfer") {
    if (!body.transfer) return { error: "The transfer step needs the current pharmacy and the patient's consent." };
    return { brief: transferBrief(med, facility, hold, body.transfer), needSummary, staffName: "" };
  }
  if (!body.prescriber) return { error: "The prescriber step needs office details and patient consent." };
  return { brief: prescriberBrief(med, facility, hold, body.prescriber), needSummary, staffName: "" };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_request", message: parsed.error.issues[0]?.message } }, { status: 400 });
  }
  const body = parsed.data;
  const { kind, facility } = body;
  const planned = plan(body);
  if ("error" in planned) return NextResponse.json({ error: { code: "invalid_request", message: planned.error } }, { status: 400 });

  const { brief, needSummary } = planned;
  const task = renderTask(brief);
  const resultSchema = RESULT_SCHEMAS[kind];
  // The agent gets the full task; everything shown or stored has phone numbers masked.
  const shownPlan = redactDeep({ task, resultSchema, brief });
  if (body.dryRun) return NextResponse.json({ plan: shownPlan, mode: "dry_run" });

  // Prescriber and transfer calls dial an office or pharmacy the operator names, not the discovered facility.
  const calledName = kind === "prescriber" ? body.prescriber?.practice : kind === "transfer" ? body.transfer?.fromPharmacy : undefined;
  const ledgerBase = {
    missionId: body.missionId,
    kind,
    needKind: facility.kind,
    needSummary,
    facility: calledName
      ? { id: `${facility.id}:${kind}`, name: calledName, address: "", phoneMasked: null }
      : { id: facility.id, name: facility.name, address: facility.address, phoneMasked: facility.phoneMasked, lat: facility.lat, lon: facility.lon, source: facility.source },
    item: body.blood ? bloodItem(body.blood) : body.medication ? medicationItem(body.medication) : undefined,
    routing: body.routing,
    brief,
    task,
  };

  if (body.routing === "simulation") {
    const holdName = body.holdContact ? `${body.holdContact.firstName} ${body.holdContact.lastInitial}.` : "the patient";
    const call = createSimulatedCall({
      kind,
      seed: body.seed,
      controlled: body.medication?.controlled ?? false,
      name: calledName ?? facility.name,
      medication: body.blood ? bloodNeed(body.blood) : (body.medication?.name ?? ""),
      quantity: body.blood ? `${body.blood.units} unit${body.blood.units === 1 ? "" : "s"}` : (body.medication?.quantity ?? ""),
      alternative: body.blood ? body.blood.hospital : kind === "transfer" ? facility.name : (body.medication?.alternatives[0] ?? "a different strength or a generic"),
      holdName,
      staffName: planned.staffName || (body.blood ? "Ravi" : "Dana"),
    });
    const recordKey = await recordCreated({ ...ledgerBase, call, mode: "simulation", dialTarget: "no call placed" });
    return NextResponse.json(
      { call: redactDeep(call), plan: shownPlan, mode: "simulation", dialTarget: "no call placed", accessToken: issueCallAccessToken(call.id), recordKey },
      { status: 201 },
    );
  }

  // Live path: fail closed at every step.
  if (!liveEnabled()) {
    return NextResponse.json(
      { error: { code: "live_disabled", message: "Live calls are disabled on this server (see PHARMABRIDGE_LIVE_CALLS in .env.local)." } },
      { status: 403 },
    );
  }
  if (!operatorCodeValid(body.operatorCode)) {
    return NextResponse.json({ error: { code: "operator_code", message: "A valid operator code is required for live calls." } }, { status: 401 });
  }
  if (facility.source === "synthetic" && body.routing === "direct" && !calledName) {
    return NextResponse.json(
      { error: { code: "dial_refused", message: "Built-in directory entries use 555-01xx numbers and are never dialed. Use test lines instead." } },
      { status: 403 },
    );
  }

  const typedPhone = kind === "prescriber" ? toE164(body.prescriber?.phone) : kind === "transfer" ? toE164(body.transfer?.phone) : null;
  const target = resolveDialTarget({
    routing: body.routing,
    listedPhone: calledName ? typedPhone : facility.phone,
    // The operator types their own prescriber's or pharmacy's number; facility numbers must carry a discovery signature.
    listedVerified: calledName ? Boolean(typedPhone) : verifyFacility(facility, facility.signature),
    directConsent: body.directConsent,
    testLineIndex: body.testLineIndex,
  });
  if (!target.ok) return NextResponse.json({ error: { code: "dial_refused", message: target.reason } }, { status: 403 });
  if (!reserveLiveCall()) {
    return NextResponse.json(
      { error: { code: "daily_cap", message: `Daily live-call cap reached (${dailyCap()}). Raise PHARMABRIDGE_MAX_LIVE_CALLS_PER_DAY to continue.` } },
      { status: 429 },
    );
  }

  const idempotencyKey = `pharmabridge:${body.missionId}:${kind}:${facility.id}:a${body.attempt}`;
  try {
    const call = await createLiveCall({
      task,
      phone: target.phone,
      locale: body.locale,
      resultSchema,
      metadata: {
        app: "pharmabridge",
        mission_id: body.missionId,
        kind,
        facility_kind: facility.kind,
        facility_id: facility.id,
        facility_name: calledName ?? facility.name,
        routing: body.routing,
      },
      idempotencyKey,
      webhookUrl: webhookUrl(),
    });
    const recordKey = await recordCreated({ ...ledgerBase, call, mode: "live", dialTarget: target.masked });
    return NextResponse.json(
      { call: redactDeep(call), plan: shownPlan, mode: "live", dialTarget: target.masked, accessToken: issueCallAccessToken(call.id), recordKey },
      { status: 201 },
    );
  } catch (error) {
    const detail = describeError(error);
    if (submissionRejected(error)) {
      releaseLiveCall();
      return NextResponse.json({ error: detail }, { status: detail.status });
    }
    // CALL-E didn't confirm either way, so the call may exist and may dial. Keep the daily-cap
    // reservation, record the unknown outcome, and never report it as "not placed".
    const recordKey = await recordUnknownSubmission({ ...ledgerBase, mode: "live", dialTarget: target.masked, idempotencyKey, error: detail.message });
    return NextResponse.json(
      {
        error: {
          code: "submission_unknown",
          message: `CALL-E did not confirm this call (${detail.message}). It may still dial. Check Call records or the CALL-E dashboard; resubmitting reuses the same idempotency key.`,
        },
        recordKey,
      },
      { status: 502 },
    );
  }
}
