import { CalleClient } from "@call-e/calle";
import { broadcastEvent } from "./server.js";
import { isValidE164, maskPhone, isAllowedOrigin, OFFICIAL_CALLE_API_URL, assertTrustedBaseUrl } from "./security.js";
import { idempotencyManager } from "./idempotency.js";

export interface Order {
    id: string;
    customerPhone: string;
    address: string;
    riderPhone?: string;
    scenario?: string;
    liveConfirmed?: boolean;
}

export interface RiderInfo {
    name: string;
    bike: string;
    phone: string;
}

// RFC 2606 / NANPA Reserved Documentation & Test Numbers
const RESERVED_DEFAULT_RIDER_PHONE = "+15555550101";

const getDefaultRiderPhone = () => process.env.RIDER_TEST_PHONE || RESERVED_DEFAULT_RIDER_PHONE;

export const RIDERS: RiderInfo[] = [
    { name: "Rider Tunde Bakare", bike: "Honda Ace 125 (LA-492-X)", phone: "+15555550101" },
    { name: "Rider Emmanuel Chukwu", bike: "TVS Neo 110 (LA-881-Y)", phone: "+15555550102" },
    { name: "Rider Segun Adebayo", bike: "Yamaha Crux 110 (LA-302-Z)", phone: "+15555550103" }
];

function getClient(): CalleClient | null {
    const apiKey = process.env.CALLE_API_KEY;
    if (!apiKey || apiKey === "YOUR_TEST_API_KEY" || apiKey.trim() === "") {
        return null;
    }
    const rawBaseUrl = process.env.CALLE_BASE_URL || OFFICIAL_CALLE_API_URL;
    const trustedBaseUrl = assertTrustedBaseUrl(rawBaseUrl);
    return new CalleClient({
        apiKey: apiKey.trim(),
        baseUrl: trustedBaseUrl
    });
}

function parseActivityToTranscript(activity: any[], calleeLabel: string = "Customer") {
    const turns: Array<{ speaker: string; text: string }> = [];
    if (!Array.isArray(activity)) return turns;

    for (const item of activity) {
        if (!item) continue;

        let speaker = "";
        let text = "";

        if (typeof item === "object") {
            const rawMsg = item.message || item.text || item.content || item.transcript || "";

            if (typeof rawMsg === "string" && rawMsg.trim()) {
                if (rawMsg.startsWith("Callee said: ")) {
                    speaker = calleeLabel;
                    text = rawMsg.replace("Callee said: ", "").trim();
                } else if (rawMsg.startsWith("Bot is speaking: ")) {
                    speaker = "AI Assistant";
                    text = rawMsg.replace("Bot is speaking: ", "").trim();
                } else if (rawMsg.startsWith("Callee: ") || rawMsg.startsWith("User: ") || rawMsg.startsWith("Customer: ") || rawMsg.startsWith("Rider: ")) {
                    speaker = calleeLabel;
                    text = rawMsg.replace(/^(Callee|User|Customer|Rider):\s*/, "").trim();
                } else if (rawMsg.startsWith("Bot: ") || rawMsg.startsWith("AI: ") || rawMsg.startsWith("Assistant: ")) {
                    speaker = "AI Assistant";
                    text = rawMsg.replace(/^(Bot|AI|Assistant):\s*/, "").trim();
                }
            }

            if (!speaker) {
                const role = (item.role || item.speaker || item.kind || "").toLowerCase();
                if (role.includes("user") || role.includes("callee") || role.includes("customer") || role.includes("rider")) {
                    speaker = calleeLabel;
                } else if (role.includes("bot") || role.includes("ai") || role.includes("assistant")) {
                    speaker = "AI Assistant";
                }
            }
        }

        if (text && (speaker === calleeLabel || speaker === "AI Assistant")) {
            turns.push({ speaker, text });
        }
    }
    return turns;
}

async function runDryRunSimulation(order: Order, assignedRider: RiderInfo) {
    console.log(`[Dry Run / Simulation] Simulating 2-stage verification for Order #${order.id}...`);

    const maskedCustomerPhone = maskPhone(order.customerPhone);
    const maskedRiderPhone = maskPhone(assignedRider.phone);

    // Stage 1: Customer Call Simulation
    broadcastEvent({
        orderId: order.id,
        stage: "customer_call",
        status: "🟡 Stage 1: Dialing Customer (Dry Run)...",
        details: `Simulating outbound call to ${maskedCustomerPhone} (Dry Run Mode)...`,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString(),
        customerTranscript: [],
        riderTranscript: []
    });

    await new Promise(r => setTimeout(r, 800));

    const simTurns1 = [
        { speaker: "AI Assistant", text: `Hello, calling from DispatchPulse regarding your delivery to ${order.address}. Are you available to receive the package?` },
        { speaker: "Customer", text: `Yes, I am home! For estate access, please use visitor gate pass code 8842.` }
    ];

    broadcastEvent({
        orderId: order.id,
        stage: "customer_call",
        status: `🔵 Stage 1: Customer Confirmed (Dry Run)`,
        details: `Customer confirmed availability and provided gate pass code.`,
        summary: `Customer verified delivery at ${order.address}. Gate code 8842.`,
        customerTranscript: simTurns1,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    await new Promise(r => setTimeout(r, 800));

    const customerRes = {
        order_id: order.id,
        call_status: "completed",
        recipient_available: true,
        gate_pass_code: "8842",
        delivery_notes: "Customer confirmed at address. Gate pass provided.",
        reschedule_requested: false
    };

    // Stage 2: Rider Briefing Simulation
    broadcastEvent({
        orderId: order.id,
        stage: "rider_call",
        status: `🟡 Stage 2: Calling Rider (${assignedRider.name})...`,
        details: `Briefing rider on customer confirmation & gate code 8842...`,
        summary: `Customer verified delivery at ${order.address}. Gate code 8842.`,
        customerSummary: `Customer verified delivery at ${order.address}. Gate code 8842.`,
        customerTranscript: simTurns1,
        customerResult: customerRes,
        riderTranscript: [],
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    await new Promise(r => setTimeout(r, 800));

    const simTurns2 = [
        { speaker: "AI Assistant", text: `DispatchPulse alert for ${assignedRider.name}: Delivery for Order #${order.id} to ${order.address} is verified. Gate pass code is 8842. Please acknowledge.` },
        { speaker: "Rider", text: `Acknowledged! Moving out to Plot 15 now.` }
    ];

    const riderRes = {
        rider_name: assignedRider.name,
        briefing_status: "acknowledged",
        rider_acknowledged: true,
        rider_notes: "Rider en route"
    };

    broadcastEvent({
        orderId: order.id,
        stage: "rider_call",
        status: `🟢 Rider Briefed & Dispatched`,
        details: `Confirmed (Gate Code: 8842). Rider ${assignedRider.name} dispatched with gate code.`,
        summary: `Customer verified delivery at ${order.address}. Gate code 8842.`,
        customerSummary: `Customer verified delivery at ${order.address}. Gate code 8842.`,
        customerTranscript: simTurns1,
        customerResult: customerRes,
        riderSummary: `Rider ${assignedRider.name} briefed on gate pass code 8842.`,
        riderTranscript: simTurns2,
        riderResult: riderRes,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    idempotencyManager.releaseLock(order.id, 'completed', undefined, {
        customerResult: customerRes,
        riderResult: riderRes
    });
}

export async function triggerPreDeliveryCall(order: Order, settings: any = {}) {
    const isDryRun = process.env.DRY_RUN === 'true' || (!order.liveConfirmed && process.env.DRY_RUN !== 'false');

    // Deterministically assign rider based on order ID
    const riderIndex = Math.abs(order.id.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)) % RIDERS.length;
    const baseRider = RIDERS[riderIndex] || RIDERS[0]!;
    const assignedRider: RiderInfo = {
        ...baseRider,
        phone: order.riderPhone || settings.riderPhone || getDefaultRiderPhone()
    };

    const maskedCustomerPhone = maskPhone(order.customerPhone);
    const maskedRiderPhone = maskPhone(assignedRider.phone);

    // 1. Safe-by-Default Dry-Run Mode
    if (isDryRun) {
        return await runDryRunSimulation(order, assignedRider);
    }

    // 2. Strict Live Calling Recipient Consent Gate
    if (!order.liveConfirmed) {
        const errMsg = "Live calling requires explicit live confirmation with authorized recipient consent. Dispatch aborted.";
        console.warn(`[Dispatch Workflow] ${errMsg}`);
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: "🔴 Live Confirmation Required",
            details: errMsg,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg);
        return;
    }

    // 3. E.164 Validation for both customer and rider (mask invalid phone values in logs and events)
    if (!isValidE164(order.customerPhone)) {
        const errMsg = `Invalid customer phone '${maskedCustomerPhone}'. Must be valid E.164 format (e.g. +15555550100).`;
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: "🔴 Invalid Phone Format",
            details: errMsg,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg);
        return;
    }

    if (!isValidE164(assignedRider.phone)) {
        const errMsg = `Invalid rider phone '${maskedRiderPhone}'. Must be valid E.164 format.`;
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: "🔴 Invalid Rider Phone",
            details: errMsg,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg);
        return;
    }

    // 4. Live Calling Execution Requirements Check
    const client = getClient();
    if (!client) {
        const errMsg = "Live calling requires CALLE_API_KEY configured in server environment. Set CALLE_API_KEY or use Dry Run mode.";
        console.error(`[Dispatch Workflow] ${errMsg}`);
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: "🔴 Live Dispatch Blocked",
            details: errMsg,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg);
        throw new Error(errMsg);
    }

    console.log(`[Dispatch Workflow] Starting 2-Stage live CALL-E voice dispatch for Order #${order.id}...`);

    // ==========================================
    // STAGE 1: REAL CALL TO CUSTOMER
    // ==========================================
    const customerTaskDescription = `Confirm delivery address ${order.address} for Order #${order.id}. Speak in a polite tone. Ask if recipient is available or if gate pass code is needed.`;

    // Stable deterministic Stage 1 provider idempotency key
    const customerProviderKey = `dispatch-pulse:order:${order.id.trim()}:customer`;
    const customerMetadata = {
        app: "dispatch-pulse",
        orderId: order.id,
        stage: "customer_verification",
        customerPhone: order.customerPhone
    };

    broadcastEvent({
        orderId: order.id,
        stage: "customer_call",
        status: "🟡 Stage 1: Dialing Customer...",
        details: `Placing live outbound call to customer at ${maskedCustomerPhone} via CALL-E...`,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString(),
        customerTranscript: [],
        riderTranscript: []
    });

    let customerResultData: any = null;
    let rawCall: any = null;

    try {
        console.log(`[SDK] Creating live customer call via CalleClient SDK with idempotency key ${customerProviderKey}...`);
        const call = await client.calls.createAndWait({
            task: customerTaskDescription,
            recipient: { phone: order.customerPhone },
            resultSchema: {
                type: "object",
                required: ["order_id", "call_status", "recipient_available", "reschedule_requested"],
                properties: {
                    order_id: { type: "string", description: "The order ID being verified" },
                    call_status: { type: "string", enum: ["completed", "failed", "voicemail", "no_answer"], description: "The call outcome" },
                    recipient_available: { type: "boolean", description: "Whether the customer confirmed availability" },
                    alternative_recipient_name: { type: "string", description: "Alternative recipient name or empty string" },
                    gate_pass_code: { type: "string", description: "Estate gate pass code or empty string" },
                    delivery_notes: { type: "string", description: "Special delivery instructions or empty string" },
                    reschedule_requested: { type: "boolean", description: "Whether customer requested to reschedule" }
                },
                additionalProperties: false
            },
            metadata: customerMetadata
        }, {
            idempotencyKey: customerProviderKey
        });

        rawCall = call;
        if (call) {
            const recipient = call.recipients?.[0];
            const attempt = recipient?.attempts?.[0];
            const res = call.structuredResult || recipient?.structuredResult || (attempt as any)?.structuredResult || null;
            customerResultData = {
                taskCompleted: call.taskCompleted === true, // STRICT explicit taskCompleted from provider (preserves false)
                task: call.task,
                metadata: call.metadata,
                recipients: call.recipients,
                structuredResult: res,
                summary: recipient?.summary || call.summary || attempt?.summary || `Customer call completed.`,
                transcript: parseActivityToTranscript(attempt?.transcriptTurns || (call as any).turns || [], "Customer")
            };
        }
    } catch (sdkError: any) {
        console.error(`[Dispatch Workflow] SDK Customer call error / ambiguous timeout:`, sdkError.message);
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: "🔴 Stage 1: Customer Call Unresolved",
            details: `Customer call encountered an error/timeout: ${sdkError.message}. State locked to prevent re-dial.`,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        // Preserve lock in unresolved state so ambiguous retries cannot redial
        idempotencyManager.markUnresolved(order.id, sdkError.message);
        throw sdkError;
    }

    // STRICT AUTHORITATIVE STAGE 1 GATE:
    // Requires exact task, order, metadata, and recipient binding with explicit taskCompleted === true
    const customerResult = customerResultData?.structuredResult as any;
    const recipientPhoneMatches = Boolean(
        customerResultData?.recipients?.some((r: any) =>
            r?.phone === order.customerPhone ||
            (Array.isArray(r?.phones) && r.phones.includes(order.customerPhone))
        ) ||
        rawCall?.recipients?.some((r: any) =>
            r?.phone === order.customerPhone ||
            (Array.isArray(r?.phones) && r.phones.includes(order.customerPhone))
        )
    );
    const taskMatches = Boolean(
        customerResultData?.task === customerTaskDescription ||
        rawCall?.task === customerTaskDescription
    );
    const metadataMatches = Boolean(
        customerResultData?.metadata?.orderId === order.id ||
        rawCall?.metadata?.orderId === order.id
    );
    const isOrderIdBound = Boolean(
        customerResult &&
        typeof customerResult.order_id === "string" &&
        customerResult.order_id.trim().toLowerCase() === order.id.trim().toLowerCase()
    );
    const isCustomerConfirmed = Boolean(
        customerResult &&
        typeof customerResult === "object" &&
        isOrderIdBound &&
        customerResult.call_status === "completed" &&
        customerResult.recipient_available === true &&
        customerResult.reschedule_requested !== true
    );
    const isAuthoritativeConfirmation = Boolean(
        customerResultData?.taskCompleted === true &&
        recipientPhoneMatches &&
        taskMatches &&
        metadataMatches &&
        isCustomerConfirmed
    );

    if (!isAuthoritativeConfirmation) {
        const isRescheduled = customerResult?.reschedule_requested === true;
        const errMsg = isRescheduled
            ? `Customer requested reschedule for Order #${order.id}. Delivery held; rider dispatch aborted.`
            : `Customer verification call ended without authoritative bound confirmation for Order #${order.id}. Rider dispatch aborted.`;

        console.warn(`[Dispatch Workflow] ${errMsg}`);
        broadcastEvent({
            orderId: order.id,
            stage: "customer_call",
            status: isRescheduled ? "🔴 Reschedule Requested" : "🔴 Stage 1: Customer Call Incomplete",
            details: errMsg,
            summary: customerResultData?.summary || errMsg,
            customerSummary: customerResultData?.summary || errMsg,
            customerTranscript: customerResultData?.transcript || [],
            customerResult: customerResult || null,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg, { customerResult });
        return;
    }

    // Customer Confirmed Successfully
    const customerSummary = customerResultData?.summary || `Customer confirmed delivery at ${order.address}.`;
    const customerTranscript = customerResultData?.transcript || [];

    broadcastEvent({
        orderId: order.id,
        stage: "customer_call",
        status: `🔵 Stage 1: Customer Confirmed`,
        details: `Customer confirmed delivery. Gate code: ${customerResult.gate_pass_code || "None"}. Proceeding to Stage 2 Rider Briefing...`,
        summary: customerSummary,
        customerSummary,
        customerTranscript,
        customerResult,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    // ==========================================
    // STAGE 2: REAL CALL TO RIDER
    // ==========================================
    let riderInstructionSummary = `Deliver to ${order.address}.`;
    if (customerResult.gate_pass_code) {
        riderInstructionSummary += ` Visitor Gate Pass Code is ${customerResult.gate_pass_code}.`;
    }
    if (customerResult.alternative_recipient_name) {
        riderInstructionSummary += ` Hand over to ${customerResult.alternative_recipient_name}.`;
    }
    if (customerResult.delivery_notes) {
        riderInstructionSummary += ` Note: ${customerResult.delivery_notes}.`;
    }

    const riderCallDetailText = customerResult.gate_pass_code
        ? `Briefing ${assignedRider.name} on customer confirmation & gate pass code (${customerResult.gate_pass_code})...`
        : `Briefing ${assignedRider.name} on customer delivery confirmation...`;

    broadcastEvent({
        orderId: order.id,
        stage: "rider_call",
        status: `🟡 Stage 2: Calling Rider (${assignedRider.name})...`,
        details: riderCallDetailText,
        summary: customerSummary,
        customerSummary,
        customerTranscript,
        customerResult,
        riderTranscript: [],
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    const riderTaskDescription = `Call delivery rider ${assignedRider.name} for Order #${order.id}. Deliver customer instruction: "${riderInstructionSummary}". Ask rider to explicitly acknowledge and confirm receipt.`;

    // Stable deterministic Stage 2 provider idempotency key
    const riderProviderIdempotencyKey = `dispatch-pulse:order:${order.id.trim()}:rider`;
    const riderMetadata = {
        app: "dispatch-pulse",
        orderId: order.id,
        stage: "rider_briefing",
        riderName: assignedRider.name,
        riderPhone: assignedRider.phone
    };

    let riderResultData: any = null;
    let rawRiderCall: any = null;

    try {
        console.log(`[SDK] Creating live rider call via CalleClient SDK with idempotency key ${riderProviderIdempotencyKey}...`);
        const riderCall = await client.calls.createAndWait({
            task: riderTaskDescription,
            recipient: { phone: assignedRider.phone },
            resultSchema: {
                type: "object",
                required: ["rider_name", "briefing_status", "rider_acknowledged"],
                properties: {
                    rider_name: { type: "string", description: "Name of assigned rider" },
                    briefing_status: { type: "string", enum: ["acknowledged", "failed", "unreachable"], description: "Acknowledgement status" },
                    rider_acknowledged: { type: "boolean", description: "Strictly true if rider confirmed verbal acknowledgement" },
                    rider_notes: { type: "string", description: "Rider delivery notes or empty string" }
                },
                additionalProperties: false
            },
            metadata: riderMetadata
        }, {
            idempotencyKey: riderProviderIdempotencyKey
        });

        rawRiderCall = riderCall;
        if (riderCall) {
            const recipient = riderCall.recipients?.[0];
            const attempt = recipient?.attempts?.[0];
            const res = riderCall.structuredResult || recipient?.structuredResult || (attempt as any)?.structuredResult || null;
            riderResultData = {
                taskCompleted: riderCall.taskCompleted === true, // STRICT explicit taskCompleted from provider (preserves false)
                task: riderCall.task,
                metadata: riderCall.metadata,
                recipients: riderCall.recipients,
                structuredResult: res,
                summary: recipient?.summary || riderCall.summary || attempt?.summary || `Rider ${assignedRider.name} briefed via call.`,
                transcript: parseActivityToTranscript(attempt?.transcriptTurns || (riderCall as any).turns || [], "Rider")
            };
        }
    } catch (sdkRiderErr: any) {
        console.error(`[Dispatch Workflow] SDK Rider call error:`, sdkRiderErr.message);
        broadcastEvent({
            orderId: order.id,
            stage: "rider_call",
            status: "🔴 Stage 2: Rider Call Unresolved",
            details: `Rider briefing call encountered error/timeout: ${sdkRiderErr.message}`,
            summary: customerSummary,
            customerSummary,
            customerTranscript,
            customerResult,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.markUnresolved(order.id, sdkRiderErr.message);
        return;
    }

    // STRICT AUTHORITATIVE STAGE 2 GATE:
    // Require exact task, order, metadata, and recipient binding with explicit taskCompleted === true
    const riderResult = riderResultData?.structuredResult as any;
    const riderRecipientPhoneMatches = Boolean(
        riderResultData?.recipients?.some((r: any) =>
            r?.phone === assignedRider.phone ||
            (Array.isArray(r?.phones) && r.phones.includes(assignedRider.phone))
        ) ||
        rawRiderCall?.recipients?.some((r: any) =>
            r?.phone === assignedRider.phone ||
            (Array.isArray(r?.phones) && r.phones.includes(assignedRider.phone))
        )
    );
    const riderTaskMatches = Boolean(
        riderResultData?.task === riderTaskDescription ||
        rawRiderCall?.task === riderTaskDescription
    );
    const riderMetadataMatches = Boolean(
        riderResultData?.metadata?.orderId === order.id ||
        rawRiderCall?.metadata?.orderId === order.id
    );
    const isRiderNameMatched = Boolean(
        riderResult &&
        typeof riderResult.rider_name === "string" &&
        (
            riderResult.rider_name.trim().toLowerCase() === assignedRider.name.trim().toLowerCase() ||
            riderResult.rider_name.trim().toLowerCase().includes(assignedRider.name.replace(/^Rider\s+/i, '').trim().toLowerCase())
        )
    );
    const isAuthoritativeRiderConfirmation = Boolean(
        riderResultData?.taskCompleted === true &&
        riderRecipientPhoneMatches &&
        riderTaskMatches &&
        riderMetadataMatches &&
        riderResult &&
        typeof riderResult === "object" &&
        isRiderNameMatched &&
        riderResult.rider_acknowledged === true &&
        riderResult.briefing_status === "acknowledged"
    );

    if (!isAuthoritativeRiderConfirmation) {
        const errMsg = `Rider briefing call completed without authoritative acknowledgement from ${assignedRider.name}. Dispatch held for manual dispatcher review.`;
        console.warn(`[Dispatch Workflow] ${errMsg}`);
        broadcastEvent({
            orderId: order.id,
            stage: "rider_call",
            status: "🔴 Stage 2: Rider Briefing Incomplete",
            details: errMsg,
            summary: customerSummary,
            customerSummary,
            customerTranscript,
            customerResult,
            riderSummary: riderResultData?.summary || errMsg,
            riderTranscript: riderResultData?.transcript || [],
            riderResult: riderResult || null,
            address: order.address,
            phone: maskedCustomerPhone,
            rider: { ...assignedRider, phone: maskedRiderPhone },
            timestamp: new Date().toLocaleTimeString()
        });
        idempotencyManager.releaseLock(order.id, 'failed', errMsg, { customerResult, riderResult });
        return;
    }

    const riderSummary = riderResultData?.summary || `Rider ${assignedRider.name} briefed on instructions.`;
    const riderTranscript = riderResultData?.transcript || [];

    let finalDetails = `Confirmed. Rider ${assignedRider.name} briefed via phone call.`;
    if (customerResult?.gate_pass_code) {
        finalDetails = `Confirmed (Gate Code: ${customerResult.gate_pass_code}). Rider ${assignedRider.name} dispatched with gate code.`;
    }

    console.log(`[Dispatch Workflow] 2-Stage Voice Dispatch for Order #${order.id} complete!`);

    broadcastEvent({
        orderId: order.id,
        stage: "rider_call",
        status: "🟢 Rider Briefed & Dispatched",
        details: finalDetails,
        summary: customerSummary,
        customerSummary,
        customerTranscript,
        customerResult,
        riderSummary,
        riderTranscript,
        riderResult,
        address: order.address,
        phone: maskedCustomerPhone,
        rider: { ...assignedRider, phone: maskedRiderPhone },
        timestamp: new Date().toLocaleTimeString()
    });

    // Release in-flight lock upon verified terminal completion
    idempotencyManager.releaseLock(order.id, 'completed', undefined, {
        customerResult,
        riderResult
    });
}
