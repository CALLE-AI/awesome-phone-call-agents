import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8787);
const CALL_E_API_KEY = process.env.CALL_E_API_KEY;
const CALL_E_BASE_URL = process.env.CALL_E_BASE_URL ?? "https://api.heycall-e.com";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "http://localhost:5173";
const ALLOWED_RECIPIENTS = new Set(
  (process.env.CALL_E_ALLOWED_RECIPIENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  return JSON.parse(raw);
}

function sanitizePhone(phone) {
  return String(phone ?? "").replace(/[^+\d]/g, "");
}

function validateRecipient(phone) {
  if (!phone.startsWith("+") || phone.length < 8) {
    return "Recipient phone must be supplied in E.164 format.";
  }
  if (ALLOWED_RECIPIENTS.size && !ALLOWED_RECIPIENTS.has(phone)) {
    return "Recipient is not allowlisted for this demo.";
  }
  return null;
}

function buildTask(request) {
  const customerName = request.customer?.fullName ?? "the customer";
  const vehicle = `${request.vehicle?.year ?? ""} ${request.vehicle?.make ?? ""} ${request.vehicle?.model ?? ""}`.trim();
  const pickupAddress = request.pickup?.address ?? "not provided";
  const pickupWindow = request.pickup?.preferredWindow ?? "not provided";
  const deliveryAddress = request.delivery?.address ?? "not provided";
  const deliveryWindow = request.delivery?.preferredWindow ?? "not provided";
  const specialInstructions = request.specialInstructions?.trim() || "none provided";

  return [
    `You are Tomorrow Is Calling, a concise AI-assisted vehicle-transport coordination agent.`,
    `Call ${customerName} about transport request ${request.reference ?? "unknown"}.`,
    `First ask whether you are speaking with ${customerName}. Do not disclose transport details until the recipient confirms they are ${customerName}.`,
    `If the recipient is not ${customerName}, do not disclose vehicle, pickup, delivery, or scheduling details. Ask whether ${customerName} is available. If they are unavailable, politely end the call and mark the request for human follow-up.`,
    `After identity is confirmed, identify yourself as Tomorrow Is Calling and explain that this is an AI-assisted service call regarding their vehicle transport request.`,
    `Vehicle: ${vehicle || "not provided"}.`,
    `Pickup: ${pickupAddress}, preferred transport window ${pickupWindow}.`,
    `Delivery: ${deliveryAddress}, preferred delivery window ${deliveryWindow}.`,
    `Special instructions already on the request: ${specialInstructions}.`,
    `Summarize the transport details conversationally. Describe pickup and delivery timing only as the scheduled or preferred windows supplied in the request; never invent or guarantee a date, time, route, driver, or ETA.`,
    `Explain that the driver or transport team will contact the customer again as the driver gets closer to the pickup location.`,
    `Ask whether the customer has any questions, special instructions, access details, alternate-contact information, or anything the driver should know before pickup.`,
    `Respond conversationally using only the information in this request and the customer's statements during the call. Do not invent pricing, insurance terms, cancellation policies, driver identity, ETA, or other business facts that were not supplied.`,
    `If the customer asks something you cannot answer from the supplied request, explain that you will flag it for a human transport coordinator.`,
    `Before ending, briefly confirm any new instructions or unresolved questions you heard.`,
    `Keep the call concise and professional.`,
    `Do not request payment-card information or other sensitive financial data.`,
  ].join(" ");
}

function buildTestTask(name) {
  const recipientName = String(name ?? "Vanessa").trim() || "Vanessa";
  return [
    `This is a short connection test for Tomorrow Is Calling.`,
    `When the recipient answers, say exactly: "Good evening, ${recipientName}. Tomorrow is calling."`,
    `Then say: "This is a test call to confirm the connection is working."`,
    `Do not ask for personal information, payment information, or any transport details.`,
    `After the recipient acknowledges the test, politely end the call.`,
  ].join(" ");
}

async function createUpstreamCall(body) {
  const upstream = await fetch(`${CALL_E_BASE_URL}/v1/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CALL_E_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const payload = await upstream.json();
  return { upstream, payload };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    return res.end();
  }

  if (req.url === "/health" && req.method === "GET") {
    return json(res, 200, { status: "ok", service: "tomorrow-is-calling-backend" });
  }

  if (!CALL_E_API_KEY) {
    return json(res, 503, { error: "CALL_E_API_KEY is not configured on the server." });
  }

  if (req.url === "/api/test-call" && req.method === "POST") {
    try {
      const { phone: rawPhone, name, consent } = await readJson(req);
      const phone = sanitizePhone(rawPhone);
      const recipientError = validateRecipient(phone);
      if (recipientError) return json(res, recipientError.includes("allowlisted") ? 403 : 400, { error: recipientError });
      if (!consent) {
        return json(res, 400, { error: "Contact consent is required before placing a test call." });
      }

      const { upstream, payload } = await createUpstreamCall({
        task: buildTestTask(name),
        recipients: [{ phones: [phone] }],
        metadata: { purpose: "temporary_connection_test" },
      });

      return json(res, upstream.status, payload);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "Unable to create test call." });
    }
  }

  if (req.url === "/api/calls" && req.method === "POST") {
    try {
      const { request } = await readJson(req);
      const phone = sanitizePhone(request?.customer?.phone);
      const recipientError = validateRecipient(phone);
      if (recipientError) return json(res, recipientError.includes("allowlisted") ? 403 : 400, { error: recipientError });
      if (!request?.consentToContact) {
        return json(res, 400, { error: "Contact consent is required before placing a call." });
      }

      const { upstream, payload } = await createUpstreamCall({
        task: buildTask(request),
        recipients: [{ phones: [phone] }],
        recipient_result_schema: {
          type: "object",
          additionalProperties: false,
          required: ["reached", "identity_confirmed", "transport_details_confirmed", "human_help_needed", "summary"],
          properties: {
            reached: { type: "boolean" },
            identity_confirmed: { type: "boolean" },
            transport_details_confirmed: { type: "boolean" },
            completion_timing: { type: "string" },
            human_help_needed: { type: "boolean" },
            customer_questions: { type: "array", items: { type: "string" } },
            special_instructions: { type: "array", items: { type: "string" } },
            blockers: { type: "array", items: { type: "string" } },
            summary: { type: "string" },
          },
        },
        metadata: { request_reference: request.reference ?? "unknown" },
      });

      return json(res, upstream.status, payload);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "Unable to create call." });
    }
  }

  const callMatch = req.url?.match(/^\/api\/calls\/(call_[A-Za-z0-9_-]+)$/);
  if (callMatch && req.method === "GET") {
    try {
      const upstream = await fetch(`${CALL_E_BASE_URL}/v1/calls/${callMatch[1]}`, {
        headers: { Authorization: `Bearer ${CALL_E_API_KEY}` },
      });
      const payload = await upstream.json();
      return json(res, upstream.status, payload);
    } catch (error) {
      return json(res, 500, { error: error instanceof Error ? error.message : "Unable to fetch call." });
    }
  }

  return json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Tomorrow Is Calling backend listening on port ${PORT}`);
});
