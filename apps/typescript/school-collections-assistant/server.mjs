import "dotenv/config";
import express from "express";
import { CalleClient } from "@call-e/calle";
import {
  bearerToken,
  buildReminderTask,
  EXAMPLE_E164,
  fakeReminderResult,
  isAmbiguousProviderError,
  isE164,
  maskPhone,
  reminderIntentKey,
  RESULT_SCHEMA,
  safeEqual,
  sanitizeError,
  sanitizeEvidence,
  sanitizeSensitiveData,
} from "./safety.mjs";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb", strict: true }));
app.use(express.static("public"));

function config() {
  return {
    liveEnabled: process.env.CALLE_LIVE_ENABLED === "true",
    apiToken: String(process.env.SCHOOL_COLLECTIONS_API_TOKEN || "").trim(),
    calleApiKey: String(process.env.CALLE_API_KEY || "").trim(),
    authorizedDestination: String(
      process.env.CALLE_AUTHORIZED_DESTINATION || ""
    ).trim(),
  };
}

function requireApiAuth(req, res, next) {
  const { apiToken } = config();
  if (!apiToken) {
    return res.status(503).json({
      success: false,
      error:
        "Authentication is not configured. Set SCHOOL_COLLECTIONS_API_TOKEN on the server.",
    });
  }

  const provided = bearerToken(req.get("authorization"));
  if (!safeEqual(provided, apiToken)) {
    res.set("WWW-Authenticate", "Bearer");
    return res.status(401).json({
      success: false,
      error: "Authentication required.",
    });
  }

  return next();
}

function validateReminderBody(body) {
  const fields = {
    parentName: String(body?.parentName || "").trim(),
    studentName: String(body?.studentName || "").trim(),
    phoneNumber: String(body?.phoneNumber || "").trim(),
    amount: String(body?.amount || "").trim(),
    dueDate: String(body?.dueDate || "").trim(),
    schoolName: String(body?.schoolName || "").trim(),
    intentId: String(body?.intentId || "").trim(),
    confirmLiveCall: body?.confirmLiveCall === true,
  };

  if (
    !fields.parentName ||
    !fields.studentName ||
    !fields.phoneNumber ||
    !fields.amount ||
    !fields.dueDate
  ) {
    return { error: "Please provide all required fields.", status: 400 };
  }

  if (!isE164(fields.phoneNumber)) {
    return {
      error: `Phone number must be strict ASCII E.164 (for example ${EXAMPLE_E164}).`,
      status: 400,
    };
  }

  return { fields };
}

async function placeAuthorizedCall(fields, intentKey, calleApiKey) {
  const client = new CalleClient({ apiKey: calleApiKey });
  const input = {
    task: buildReminderTask(fields),
    recipient: { phone: fields.phoneNumber },
    resultSchema: RESULT_SCHEMA,
    metadata: {
      intent_key: intentKey,
      workflow: "school-collections-reminder",
    },
  };
  const options = { idempotencyKey: intentKey };

  try {
    return await client.calls.createAndWait(input, options);
  } catch (error) {
    if (!isAmbiguousProviderError(error)) throw error;

    // Ambiguous create may mean the call already exists. Do not call create
    // again. Halt for read-only reconciliation under the same intent key.
    const err = new Error(
      `Call create outcome is ambiguous for ${maskPhone(fields.phoneNumber)}. Halted for read-only reconciliation under intent key ${intentKey}. Do not create or dial again with a new key.`
    );
    err.status = 409;
    err.code = "needs_human_reconciliation";
    err.intentKey = intentKey;
    err.cause = error;
    throw err;
  }
}

function publicCallPayload(call, fields, intentKey, mode) {
  return {
    success: true,
    mode,
    realCallPlaced: mode === "live",
    intentKey,
    phoneMasked: maskPhone(fields.phoneNumber),
    status: call.status,
    taskCompleted: call.taskCompleted,
    completionConfidence: sanitizeSensitiveData(call.completionConfidence),
    structuredResult: sanitizeSensitiveData(call.structuredResult || {}),
    evidence: sanitizeEvidence(call.evidence),
  };
}

app.get("/api/health", (_req, res) => {
  const cfg = config();
  res.json({
    ok: true,
    service: "school-collections-assistant",
    mode: cfg.liveEnabled ? "live" : "fake",
    liveEnabled: cfg.liveEnabled,
    authConfigured: Boolean(cfg.apiToken),
  });
});

app.post("/api/reminder", requireApiAuth, async (req, res) => {
  try {
    const checked = validateReminderBody(req.body);
    if (checked.error) {
      return res.status(checked.status).json({
        success: false,
        error: checked.error,
      });
    }

    const { fields } = checked;
    const intentKey = reminderIntentKey(fields);
    const cfg = config();

    // Default path: fake / no-call. Live requires explicit env gates + exact destination auth.
    if (!cfg.liveEnabled) {
      console.info(
        JSON.stringify({
          event: "reminder_fake",
          intentKey,
          phoneMasked: maskPhone(fields.phoneNumber),
        })
      );
      return res.json(fakeReminderResult(fields, intentKey));
    }

    if (!cfg.calleApiKey) {
      return res.status(503).json({
        success: false,
        error: "CALLE_API_KEY is required when CALLE_LIVE_ENABLED=true.",
      });
    }

    if (!isE164(cfg.authorizedDestination)) {
      return res.status(503).json({
        success: false,
        error:
          "Set CALLE_AUTHORIZED_DESTINATION to the exact ASCII E.164 destination authorized for this live run.",
      });
    }

    if (fields.phoneNumber !== cfg.authorizedDestination) {
      return res.status(403).json({
        success: false,
        error:
          "Destination is not authorized for this live run. The phone number must exactly match CALLE_AUTHORIZED_DESTINATION.",
        phoneMasked: maskPhone(fields.phoneNumber),
        intentKey,
      });
    }

    if (!fields.confirmLiveCall) {
      return res.status(400).json({
        success: false,
        error:
          "Live calls require confirmLiveCall: true so the operator explicitly authorizes this exact run.",
        intentKey,
      });
    }

    console.info(
      JSON.stringify({
        event: "reminder_live_start",
        intentKey,
        phoneMasked: maskPhone(fields.phoneNumber),
      })
    );

    const call = await placeAuthorizedCall(fields, intentKey, cfg.calleApiKey);
    return res.json(publicCallPayload(call, fields, intentKey, "live"));
  } catch (error) {
    const safeMessage = sanitizeError(error);
    console.error(
      JSON.stringify({
        event: "reminder_error",
        code: error.code || "error",
        message: safeMessage,
        intentKey: error.intentKey,
      })
    );

    return res.status(error.status || 500).json({
      success: false,
      error: safeMessage || "Something went wrong.",
      code: error.code,
      intentKey: error.intentKey,
    });
  }
});

export { app, config };

if (process.env.NODE_ENV !== "test") {
  const cfg = config();
  if (!cfg.apiToken) {
    console.warn(
      "SCHOOL_COLLECTIONS_API_TOKEN is not set. /api/reminder will return 503 until it is configured."
    );
  }
  app.listen(PORT, () => {
    console.log(
      `School Collections Assistant running at http://localhost:${PORT} (mode=${cfg.liveEnabled ? "live" : "fake"})`
    );
  });
}
