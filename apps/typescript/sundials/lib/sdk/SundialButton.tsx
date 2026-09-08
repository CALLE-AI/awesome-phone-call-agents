"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSundial } from "./useSundial";
import { sundials } from "./concierge";
import type { LeadContext, SundialCallRecord } from "@/lib/types";
import { CaptureForm } from "./CaptureForm";
import "./widget.css";

export interface SundialButtonProps {
  label?: string;
  contactName?: string;
  leadContext?: LeadContext;
  className?: string;
  accountId?: string;
  apiKey?: string;
  apiEndpoint?: string;
  onSuccess?: (call: SundialCallRecord) => void;
}

export function SundialButton({
  label = "Book consult",
  contactName = "",
  leadContext,
  className = "",
  accountId,
  apiKey,
  apiEndpoint,
  onSuccess
}: SundialButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    sundials.init({ accountId, apiKey, apiEndpoint });
  }, [accountId, apiKey, apiEndpoint]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { error, scheduleCall, reset } = useSundial({
    apiEndpoint,
    onCallCompleted: (call) => {
      if (onSuccess) onSuccess(call);
    }
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <div className="sdw-root sdw-inline">
      <button
        type="button"
        className={`sdw-btn sdw-btn-primary ${className}`.trim()}
        onClick={() => {
          reset();
          setSubmitted(false);
          setSending(false);
          setOpen(true);
        }}
      >
        {label}
      </button>
      {mounted
        ? createPortal(
            <dialog ref={dialogRef} className="sdw-root sdw-dialog" onClose={() => setOpen(false)} aria-labelledby="sdw-button-dialog-title">
              <div className="sdw-dialog-panel">
                <button type="button" className="sdw-dialog-close" aria-label="Close" onClick={() => setOpen(false)}>
                  ×
                </button>
                <h2 id="sdw-button-dialog-title">Speak with a lead engineer</h2>
                <p className="sdw-lead">Confirm the number an automated assistant should call now. The call may be recorded.</p>
                <CaptureForm
                  key={String(open)}
                  brandName="Harbor"
                  formCta="talk_to_sales"
                  variant="compact"
                  sending={sending}
                  error={error}
                  submitted={submitted}
                  onSubmit={async (payload) => {
                    setSending(true);
                    sundials.identify({
                      email: payload.email,
                      phone: payload.phone,
                      name: payload.name || contactName || undefined
                    });
                    const ok = await scheduleCall({
                      phoneNumber: payload.phone,
                      contactEmail: payload.email,
                      contactName: payload.name || contactName || undefined,
                      leadContext,
                      callConsent: payload.callConsent
                    });
                    setSending(false);
                    if (ok) {
                      setSubmitted(true);
                    }
                  }}
                  onStopFollowUp={async (phone) => {
                    const result = await sundials.stopFollowUp(phone);
                    if (!result.ok) throw new Error(result.message || "Could not stop the follow-up.");
                  }}
                />
              </div>
            </dialog>,
            document.body
          )
        : null}
    </div>
  );
}
