import { after, NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  validatePhoneNumber,
  checkRateLimit,
  maskPhoneNumber,
  validateEmail,
  maskEmail,
  compactE164,
  validateCallConsent
} from "@/lib/calle/security";
import { dispatchLiveCalleCall } from "@/lib/calle/live-binding";
import { brainCallDirectives, getBrainConfigForAccount } from "@/lib/brain/config";
import { authenticateSdkRequest } from "@/lib/sdk/auth";
import { newEntityId } from "@/lib/ids";
import type { ConciergeCta, DispatchCallRequest, DispatchCallResponse, SundialCallRecord } from "@/lib/types";

export const runtime = "nodejs";

function isLiveCalle(): boolean {
  return Boolean(process.env.CALLE_API_KEY) && process.env.CALLE_LIVE === "true";
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { success: false, message: "Rate limit exceeded. Please try again in 1 minute." },
        { status: 429 }
      );
    }

    const body: DispatchCallRequest = await req.json();
    const auth = authenticateSdkRequest(req.headers, body.accountId || body.sessionContext?.accountId);
    if (!auth.ok) {
      return NextResponse.json({ success: false, message: auth.message }, { status: auth.status });
    }
    const {
      phoneNumber,
      contactName,
      contactEmail,
      sessionContext,
      company,
      companySize,
      useCase,
      visitorId,
      sessionId,
      declaredCta
    } = body;

    const emailValidation = validateEmail(contactEmail);
    if (!emailValidation.valid) {
      return NextResponse.json(
        { success: false, message: emailValidation.error || "Invalid email." },
        { status: 400 }
      );
    }

    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
      return NextResponse.json(
        { success: false, message: phoneValidation.error || "Invalid phone number." },
        { status: 400 }
      );
    }

    const compactPhone = compactE164(phoneNumber);
    const consent = validateCallConsent(compactPhone, body.callConsent);
    if (!consent.ok) {
      return NextResponse.json({ success: false, message: consent.error }, { status: 400 });
    }

    if (declaredCta === "learn_more") {
      return NextResponse.json(
        { success: false, message: "Learn more does not start a call." },
        { status: 400 }
      );
    }

    const resolvedAccount = auth.accountId;
    const resolvedVisitor = visitorId || sessionContext.visitorId || sessionContext.id;
    const resolvedSession = sessionId || sessionContext.id;
    const cta: ConciergeCta = declaredCta === "get_demo" ? "get_demo" : "talk_to_sales";
    const brain = getBrainConfigForAccount(resolvedAccount);

    sessionContext.visitorId = resolvedVisitor;
    sessionContext.accountId = resolvedAccount;
    db.saveSession(sessionContext);

    db.touchVisitor({
      visitorId: resolvedVisitor,
      accountId: resolvedAccount,
      email: contactEmail.trim(),
      phone: compactPhone,
      company,
      name: contactName,
      companySize,
      useCase
    });

    db.ingestEventBatch({
      accountId: resolvedAccount,
      visitorId: resolvedVisitor,
      sessionId: resolvedSession,
      events: [
        {
          event: "cta_clicked",
          properties: { name: cta },
          timestamp: new Date().toISOString()
        },
        {
          event: cta === "get_demo" ? "demo_requested" : "identify",
          properties: {
            email: contactEmail.trim(),
            phone: compactPhone,
            company,
            name: contactName,
            companySize,
            useCase
          }
        },
        {
          event: "phone_provided",
          properties: { phone: compactPhone }
        }
      ]
    });

    const snapshot = db.snapshotForVisitor(resolvedVisitor, resolvedSession);
    const callId = newEntityId();
    const live = isLiveCalle();

    const initialCall: SundialCallRecord = {
      id: callId,
      sessionId: resolvedSession,
      visitorId: resolvedVisitor,
      phoneNumber: maskPhoneNumber(compactPhone),
      rawPhoneNumber: compactPhone,
      contactEmail: maskEmail(contactEmail),
      rawContactEmail: contactEmail.trim(),
      contactName: contactName || "Web Prospect",
      company,
      companySize,
      useCase,
      declaredCta: cta,
      declaredInterest: snapshot.declaredInterest,
      dryRun: !live,
      status: "queued",
      dispatchMode: "ai_qualify",
      agentId: process.env.CALLE_AGENT_ID || "sundial_default",
      requestedAt: new Date().toISOString(),
      durationSec: 0,
      intentSnapshot: snapshot.intent,
      behaviorSnapshot: snapshot.behavior,
      session: sessionContext,
      callConsentE164: consent.e164,
      callConsentAt: consent.acceptedAt,
      callConsentAllowOneRetry: consent.allowOneRetry
    };

    db.saveCall(initialCall);

    if (live) {
      const liveCtx = {
        company,
        useCase,
        companySize,
        declaredCta: cta,
        declaredInterest: snapshot.declaredInterest,
        intent: snapshot.intent,
        ...brainCallDirectives(brain)
      };
      const email = contactEmail.trim();
      after(async () => {
        try {
          const liveRes = await dispatchLiveCalleCall(
            compactPhone,
            sessionContext,
            contactName,
            email,
            `sundials_${callId}`,
            liveCtx
          );
          const current = db.getCall(callId);
          if (!current) return;
          if (liveRes.success) {
            current.status = "dialing";
            current.calleCallId = liveRes.calleId;
            current.dialedAt = new Date().toISOString();
          } else {
            current.status = "failed";
            current.errorReason = liveRes.error;
          }
          db.saveCall(current);
        } catch (err: unknown) {
          const current = db.getCall(callId);
          if (!current) return;
          current.status = "failed";
          current.errorReason = err instanceof Error ? err.message : "CALL-E enqueue failed.";
          db.saveCall(current);
        }
      });
    }

    const response: DispatchCallResponse = {
      success: true,
      taskId: callId,
      status: "queued",
      estimatedSecondsToRing: 25,
      statusUrl: `/api/sundials/status?taskId=${callId}`,
      speedToDialSec: 21.4,
      intent: snapshot.intent
    };

    return NextResponse.json(response, { status: 202 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
