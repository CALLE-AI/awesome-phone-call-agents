import type { NvcState } from "./nvc";
import type { Disposition, FraudOpsCase, Intent, ToolId } from "./types";
import { assertNvcSafe, buildCalleTaskPrompt, formatNvcOpening } from "./nvc";

/**
 * CALL-E client boundary.
 *
 * TODO: swap `placeCall` for the official CALL-E SDK / HTTP client.
 * Keep DialRequest / DialResult stable so the desk and outcome writer
 * do not change when live dial lands.
 *
 * Env (leave empty for this MVP — do not put real secrets in the repo):
 *   CALLE_API_KEY
 *   CALLE_BASE_URL
 */
export interface DialRequest {
  to: string;
  caseId: string;
  intent: Intent;
  locale: string;
  fromLabel?: string;
  webhookUrl: string;
  casePayload: FraudOpsCase;
  /** NVC-structured CALL-E agent task */
  taskPrompt: string;
}

export interface DialResult {
  callId: string;
  recordingId: string;
  provider: "calle-stub" | "calle";
  durationMs: number;
  disposition: Disposition;
  quotes: string[];
  nextAction: string;
  ptpDate?: string;
  missingDocs?: string[];
  callbackAt?: string;
  handoffReason?: string;
  transcriptSnippet: string;
  endedAt: string;
  toolInvoked?: ToolId;
  hostilityStrikes?: 0 | 1 | 2;
  deescalationOverride?: boolean;
  unsafeFlag?: boolean;
  nvcState?: NvcState;
}

export type PlaceCallOptions = {
  /** Override demo delay. Production SDK ignores this. */
  delayMs?: number;
  now?: Date;
};

const DEMO_RECORDING_ID = "rec_pending_calle_swap";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function demoDelayMs(): number {
  return 5000 + Math.floor(Math.random() * 3001);
}

function isoDate(now: Date, plusDays: number): string {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + plusDays);
  return next.toISOString().slice(0, 10);
}

function simulateDial(req: DialRequest, now: Date): DialResult {
  const callId = `call_demo_${req.caseId}_${now.getTime()}`;
  const endedAt = now.toISOString();
  const happyPathStamps = {
    hostilityStrikes: 0 as const,
    deescalationOverride: false,
    nvcState: "resolution_close" as NvcState,
  };

  const base = {
    callId,
    recordingId: DEMO_RECORDING_ID,
    provider: "calle-stub" as const,
    endedAt,
    ...happyPathStamps,
  };

  if (req.intent === "kyc_chase") {
    return {
      ...base,
      toolInvoked: "none",
      durationMs: 6400,
      disposition: "uploading_now",
      quotes: [
        "Yes, I can upload the new ID tonight.",
        "I still have the utility bill — I'll add that too.",
      ],
      nextAction: "Watch the KYC portal for government_id and proof_of_address.",
      missingDocs: ["government_id", "proof_of_address"],
      transcriptSnippet:
        "Agent: This is a verification call about your account documents. We will not ask for card numbers or your full ID number. Please use the secure upload link we can send you.\nAlex: My old ID expired. I can upload the new one and a utility bill tonight.",
    };
  }

  if (req.intent === "collections") {
    return {
      ...base,
      toolInvoked: "generate_hardship_plan",
      durationMs: 7100,
      disposition: "ptp",
      quotes: [
        "I can pay Friday — just send the same pay link.",
        "Please don't add any extra fee, I already have the amount.",
      ],
      nextAction: "Log PTP and send the existing pay link. Do not invent fees.",
      ptpDate: isoDate(now, 3),
      transcriptSnippet:
        "Agent: " +
        formatNvcOpening(req.casePayload) +
        "\nMorgan: Friday works. Send the link, I'll pay then.",
    };
  }

  if (req.intent === "merchant_outreach") {
    return {
      ...base,
      toolInvoked: "none",
      durationMs: 5800,
      disposition: "docs_promised",
      quotes: [
        "We can send the last 90 days of statements tomorrow.",
        "This is a review, not an accusation — understood.",
      ],
      nextAction: "Wait for bank_statements_90d on the merchant upload link.",
      missingDocs: ["bank_statements_90d"],
      transcriptSnippet:
        "Agent: Calling about a review on Harbour Tea Co. Dispute volume rose; we need bank statements to continue. This is not an allegation of wrongdoing.\nQuinn: I'll upload 90 days of statements tomorrow morning.",
    };
  }

  if (req.intent === "evidence_collection") {
    if (req.casePayload.contact.role === "complainant") {
      return {
        ...base,
        toolInvoked: "none",
        durationMs: 7200,
        disposition: "statement_taken",
        quotes: [
          "After the pickup they kept messaging. I still have the chat.",
          "Yes — send my own share link. I will not put card numbers in there.",
        ],
        nextAction:
          "File complainant statement. Send only their evidence_share link. Do not disclose the respondent call.",
        missingDocs: ["chat_screenshots"],
        transcriptSnippet:
          "Agent: This is a fact-finding call about the Central pickup. I will not tell you what anyone else said, and I will not coach your answer. If you are in danger now I will stop and escalate.\nCasey: After the pickup they kept messaging. I still have the chat. Send my own share link — I won't upload passwords or card numbers.",
      };
    }
    return {
      ...base,
      toolInvoked: "none",
      durationMs: 6900,
      disposition: "will_upload",
      quotes: [
        "I can upload the pickup photos on my link.",
        "Don't tell me what they said. I'll share my side.",
      ],
      nextAction:
        "Send respondent-only evidence_share link. Keep statements isolated.",
      missingDocs: ["meetup_photos"],
      transcriptSnippet:
        "Agent: Calling about the same marketplace pickup. I only want your account. I will not share another party's statement, and I will not suggest what to say. Evidence is voluntary via your own link — no passwords or card numbers.\nRiley: I can upload the pickup photos on my link. Don't tell me what they said.",
    };
  }

  throw new Error(`Unsupported intent for stub dial: ${req.intent}`);
}

export function isCalleConfigured(): boolean {
  const key = process.env.CALLE_API_KEY?.trim();
  const base = process.env.CALLE_BASE_URL?.trim();
  return Boolean(key && base);
}

export async function placeCall(
  req: DialRequest,
  options: PlaceCallOptions = {}
): Promise<DialResult> {
  if (!req.to.startsWith("+")) {
    throw new Error("DialRequest.to must be E.164");
  }
  if (req.casePayload.case_id !== req.caseId) {
    throw new Error("DialRequest.caseId does not match case payload");
  }

  // TODO: if isCalleConfigured(), POST DialRequest to CALL-E and map the SDK
  // response onto DialResult. Until then the desk always uses the stub so a
  // missing key cannot silently skip the demo.
  if (isCalleConfigured()) {
    console.warn(
      "[calle] CALLE_API_KEY/CALLE_BASE_URL are set but live dial is not wired. Using stub."
    );
  }

  const delayMs = options.delayMs ?? demoDelayMs();
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const now = options.now ?? new Date();
  return simulateDial(req, now);
}

export function toDialRequest(fraudCase: FraudOpsCase): DialRequest {
  const taskPrompt = buildCalleTaskPrompt(fraudCase);
  assertNvcSafe(taskPrompt);
  return {
    to: fraudCase.contact.phone_e164,
    caseId: fraudCase.case_id,
    intent: fraudCase.intent,
    locale: fraudCase.contact.locale,
    fromLabel: "Fraud Ops Caller",
    webhookUrl: fraudCase.callback_url,
    casePayload: fraudCase,
    taskPrompt,
  };
}
