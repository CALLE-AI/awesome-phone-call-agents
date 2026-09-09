"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { CallConsent, CallStatus, DispatchCallResponse, LeadContext, SundialCallRecord } from "@/lib/types";
import { sundials } from "./concierge";
import { SUNDIALS_API_KEY_HEADER } from "./public-key";

export interface UseSundialOptions {
  apiEndpoint?: string;
  onCallCompleted?: (call: SundialCallRecord) => void;
}

export interface DispatchCallParams {
  phoneNumber: string;
  contactEmail: string;
  contactName?: string;
  company?: string;
  companySize?: string;
  useCase?: string;
  visitorId?: string;
  sessionId?: string;
  accountId?: string;
  declaredCta?: "talk_to_sales" | "get_demo";
  leadContext?: LeadContext;
  callConsent?: CallConsent;
}

export function useSundial(options: UseSundialOptions = {}) {
  const { apiEndpoint = "/api/sundials", onCallCompleted } = options;
  const [status, setStatus] = useState<CallStatus | "idle">("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [speedToDialSec, setSpeedToDialSec] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [callRecord, setCallRecord] = useState<SundialCallRecord | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => clearPolling();
  }, [clearPolling]);

  const pollStatus = useCallback(
    (id: string) => {
      clearPolling();
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${apiEndpoint}/status?taskId=${id}`);
          if (!res.ok) return;
          const data: { call: SundialCallRecord } = await res.json();
          if (data && data.call) {
            setStatus(data.call.status);
            if (data.call.speedToDialSec) {
              setSpeedToDialSec(data.call.speedToDialSec);
            }
            if (
              data.call.status === "completed" ||
              data.call.status === "failed" ||
              data.call.status === "no_answer"
            ) {
              setCallRecord(data.call);
              clearPolling();
              if (data.call.status === "completed" && onCallCompleted) {
                onCallCompleted(data.call);
              }
            }
          }
        } catch {
          // ignore
        }
      }, 1500);
    },
    [apiEndpoint, clearPolling, onCallCompleted]
  );

  const dispatchCall = useCallback(
    async (params: DispatchCallParams) => {
      setError(null);
      setStatus("queued");

      try {
        if (params.leadContext) {
          sundials.track("lead_context", { ...params.leadContext });
        }
        const sessionContext = sundials.getSessionContext();
        if (params.leadContext) {
          sessionContext.leadContext = { ...sessionContext.leadContext, ...params.leadContext };
        }

        sundials.rememberDispatchPhone(params.phoneNumber);
        const res = await fetch(`${apiEndpoint}/dispatch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [SUNDIALS_API_KEY_HEADER]: sundials.getApiKey()
          },
          body: JSON.stringify({
            phoneNumber: params.phoneNumber,
            contactEmail: params.contactEmail,
            contactName: params.contactName,
            company: params.company,
            companySize: params.companySize,
            useCase: params.useCase,
            visitorId: params.visitorId || sundials.visitorId(),
            sessionId: params.sessionId || sundials.sessionId(),
            accountId: params.accountId || sessionContext.accountId,
            declaredCta: params.declaredCta || "talk_to_sales",
            sessionContext,
            callConsent: params.callConsent
          })
        });

        const data: DispatchCallResponse = await res.json();
        if (!res.ok || !data.success) {
          setError(data.message || "Could not send your details.");
          setStatus("failed");
          return false;
        }

        setTaskId(data.taskId);
        setStatus(data.status);
        pollStatus(data.taskId);
        return true;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Network error sending details";
        setError(message);
        setStatus("failed");
        return false;
      }
    },
    [apiEndpoint, pollStatus]
  );

  const scheduleCall = dispatchCall;

  const reset = useCallback(() => {
    clearPolling();
    setStatus("idle");
    setTaskId(null);
    setSpeedToDialSec(null);
    setError(null);
    setCallRecord(null);
  }, [clearPolling]);

  return {
    status,
    taskId,
    speedToDialSec,
    error,
    callRecord,
    dispatchCall,
    scheduleCall,
    reset,
    isCalling: status === "queued" || status === "dialing" || status === "in_progress"
  };
}
