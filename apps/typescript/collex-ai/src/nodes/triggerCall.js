const { businessStore, callHistoryLog } = require("../fixtures/demoStore");

const CALLE_DRY_RUN = process.env.CALLE_DRY_RUN !== "false"; // default true
const CALLE_INTERNAL_COST = Number(process.env.CALLE_INTERNAL_COST) || 5;

const CALL_RESULT_SCHEMA = {
  type: "object",
  required: ["interested", "lead_score"],
  properties: {
    interested: {
      type: "string",
      enum: ["yes", "no", "maybe"],
      description: "Did the lead show genuine interest in what was offered?",
    },
    lead_score: {
      type: "string",
      enum: ["hot", "warm", "cold"],
      description:
        "hot = clearly interested AND has budget/timeline AND ready to move forward soon. " +
        "warm = interested but unclear on budget/timeline, or needs more time/info. " +
        "cold = not interested, or no realistic budget/intent.",
    },
    requirement_summary: {
      type: "string",
      description:
        "One short sentence on what the lead is looking for, in their own context (works for any industry — property type, service needed, product interest, etc).",
    },
    budget_mentioned: {
      type: "string",
      description:
        "Any budget, price range, or spending capacity the lead mentioned. Use 'not discussed' if not brought up.",
    },
    timeline: {
      type: "string",
      enum: [
        "immediate",
        "within_month",
        "within_quarter",
        "not_sure",
        "no_timeline",
      ],
      description: "How soon the lead wants to move forward.",
    },
    preferred_followup: {
      type: "string",
      description:
        "Day/time the lead prefers for a follow-up call or visit, if mentioned.",
    },
    objection_reason: {
      type: "string",
      description:
        "If not interested, the main reason given. Empty if interested.",
    },
  },
};

// Returned in dry-run mode, shaped exactly like a real CALL-E structuredResult
const MOCK_CALL_RESULT = {
  interested: "maybe",
  lead_score: "warm",
  requirement_summary:
    "Looking for a bigger place, still comparing a couple of options.",
  budget_mentioned: "not discussed",
  timeline: "within_month",
  preferred_followup: "next Monday afternoon",
  objection_reason: "",
};

const E164_REGEX = /^\+[1-9]\d{7,14}$/;

function assertValidRecipient(phone) {
  if (!phone || typeof phone !== "string" || !E164_REGEX.test(phone)) {
    throw new Error(`Invalid or missing recipient phone number (strict E.164 required): ${phone}`);
  }
  return phone;
}

const RETRYABLE_ERROR_CODES = new Set(["no_answer", "busy"]);

function mapCallStatus(call) {
  if (call.status === "completed") return "completed";
  const code = call.error?.code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) return code;
  return "ambiguous";
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return "xxxxxx";
  return phone.slice(0, 3) + "xxxxxx" + phone.slice(-2);
}

function maskTaskText(text, phone) {
  if (!text || !phone) return text;
  return text.split(phone).join(maskPhone(phone));
}

const PHONE_LIKE_REGEX = /\+?\d[\d\-\s]{7,}\d/g;

function maskPhoneLikeStrings(text) {
  if (typeof text !== "string") return text;
  return text.replace(PHONE_LIKE_REGEX, (m) => maskPhone(m.replace(/[\s-]/g, "")));
}

function maskDeep(value) {
  if (typeof value === "string") return maskPhoneLikeStrings(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

const triggerCall = async (state) => {
  console.log("triggerCall node comes");

  const recipient = assertValidRecipient(state.leadData.phone);
  const idempotencyKey = `${state.leadId}:${state.requestId}:${state.attemptNumber}`;

  if (CALLE_DRY_RUN) {
    console.log("[dry-run] Would call CALL-E with task:", state.taskText);
    console.log("[dry-run] idempotencyKey:", idempotencyKey);
    console.log(
      "[dry-run] resultSchema:",
      JSON.stringify(CALL_RESULT_SCHEMA.required),
    );

    callHistoryLog.push({
      lead: state.leadId,
      business: state.leadData.business,
      task_text: maskTaskText(state.taskText, recipient),
      call_status: "completed",
      call_result: MOCK_CALL_RESULT,
      internal_cost: 0,
      was_charged: false,
      attempt_number: state.attemptNumber,
      request_id: state.requestId,
      dry_run: true,
    });

    return { callResult: MOCK_CALL_RESULT, callStatus: "completed" };
  }

  // Real call path — only reached when CALLE_DRY_RUN=false
  const { CalleClient } = await import("@call-e/calle");
  const client = new CalleClient({ apiKey: process.env.CALLE_API_KEY });

  let call;
  try {
    call = await client.calls.createAndWait(
      {
        recipients: [{ phones: [recipient] }],
        task: state.taskText,
        resultSchema: CALL_RESULT_SCHEMA,
      },
      { idempotencyKey },
    );
  } catch (error) {
    console.log("triggerCall Error => ", error.message);
    return { callResult: null, callStatus: "rejected" };
  }

  console.log("triggerCall => status:", call.status);
  // console.log("triggerCall =>", call.structuredResult);

  const callStatus = mapCallStatus(call);
  const wasCharged = callStatus === "completed";

  if (wasCharged) {
    const business = businessStore.get(state.leadData.business);
    if (business) business.call_balance -= 1;
  }

  const maskedResult = maskDeep(call.structuredResult);

  callHistoryLog.push({
    lead: state.leadId,
    business: state.leadData.business,
    task_text: maskTaskText(state.taskText, recipient),
    call_status: callStatus,
    call_result: maskedResult,
    internal_cost: wasCharged ? CALLE_INTERNAL_COST : 0,
    was_charged: wasCharged,
    attempt_number: state.attemptNumber,
    request_id: state.requestId,
  });

  return { callResult: maskedResult, callStatus };
};

module.exports = { triggerCall };
