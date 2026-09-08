"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSundial } from "./useSundial";
import { sundials, type SundialsConfig } from "./concierge";
import type { ConciergeCta } from "@/lib/types";
import { CaptureForm } from "./CaptureForm";
import "./widget.css";

const DEFAULT_ACTIONS: ConciergeCta[] = ["talk_to_sales", "get_demo", "learn_more"];

const ACTION_LABEL: Record<ConciergeCta, string> = {
  talk_to_sales: "Talk to sales",
  get_demo: "Get Demo",
  learn_more: "Learn more"
};

export function Sundials(props: SundialsConfig) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [formCta, setFormCta] = useState<ConciergeCta>("talk_to_sales");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [consent, setConsent] = useState<"unknown" | "granted" | "denied">(() => sundials.consentStatus());

  const config = useMemo(
    () => ({
      accountId: props.accountId,
      apiEndpoint: props.apiEndpoint || "/api/sundials",
      position: props.position || "bottom-right",
      title: props.title || "Need help choosing a plan?",
      description: props.description || "Talk to our sales team about your requirements.",
      apiKey: props.apiKey,
      brandName: props.brandName || "Harbor",
      primaryAction: props.primaryAction || "talk_to_sales",
      actions: props.actions?.length ? props.actions : DEFAULT_ACTIONS,
      learnMoreHref: props.learnMoreHref || "/demo/pricing",
      requireConsent: props.requireConsent !== false,
      showLauncher: props.showLauncher !== false,
      onLearnMore: props.onLearnMore
    }),
    [
      props.accountId,
      props.apiEndpoint,
      props.position,
      props.title,
      props.description,
      props.apiKey,
      props.brandName,
      props.primaryAction,
      props.actions,
      props.learnMoreHref,
      props.requireConsent,
      props.showLauncher,
      props.onLearnMore
    ]
  );

  const { error, scheduleCall, reset } = useSundial({
    apiEndpoint: config.apiEndpoint
  });

  const openForm = (cta: ConciergeCta) => {
    sundials.track("cta_clicked", { name: cta, source: "widget" });
    if (cta === "learn_more") {
      if (config.onLearnMore) config.onLearnMore();
      else if (typeof window !== "undefined" && config.learnMoreHref) window.location.assign(config.learnMoreHref);
      setOpen(false);
      return;
    }
    setFormCta(cta);
    setSubmitted(false);
    reset();
    setOpen(true);
  };

  const openFormRef = useRef(openForm);
  openFormRef.current = openForm;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    sundials.init(config);
    const stopConsent = sundials.subscribeConsent(() => setConsent(sundials.consentStatus()));
    const stopOpen = sundials.subscribeOpen((cta) => openFormRef.current(cta));
    return () => {
      stopConsent();
      stopOpen();
    };
  }, [config]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleSubmit = async (payload: {
    email: string;
    phone: string;
    name?: string;
    company?: string;
    companySize?: string;
    useCase?: string;
    callConsent: { e164: string; acceptedAt: string; allowOneRetry: boolean };
  }) => {
    setSending(true);
    sundials.identify({
      email: payload.email,
      phone: payload.phone,
      company: payload.company,
      name: payload.name,
      companySize: payload.companySize,
      useCase: payload.useCase
    });
    const ok = await scheduleCall({
      phoneNumber: payload.phone,
      contactEmail: payload.email,
      contactName: payload.name,
      company: payload.company,
      companySize: payload.companySize,
      useCase: payload.useCase,
      visitorId: sundials.visitorId(),
      sessionId: sundials.sessionId(),
      accountId: config.accountId,
      declaredCta: formCta === "get_demo" ? "get_demo" : "talk_to_sales",
      callConsent: payload.callConsent
    });
    setSending(false);
    if (ok) {
      setSubmitted(true);
    }
  };

  const ui = (
    <div className="sdw-root">
      {consent === "unknown" ? (
        <div className="sdw-consent">
          <div className="sdw-consent-inner">
            <p className="sdw-consent-copy">
              <strong>Sales intent tracking. </strong>
              If you allow it, we record pages you open, sales CTAs you click, and how long the pointer stays on each
              page. We do not record every click. You can still talk to sales if you decline.
            </p>
            <div className="sdw-consent-actions">
              <button className="sdw-btn sdw-btn-primary" type="button" onClick={() => sundials.grantConsent()}>
                Allow
              </button>
              <button className="sdw-btn sdw-btn-ghost" type="button" onClick={() => sundials.denyConsent()}>
                Decline
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {config.showLauncher ? (
        <div className={`sdw-launcher ${config.position === "bottom-left" ? "sdw-left" : "sdw-right"}`}>
          <div className="sdw-card">
            <h2>{config.title}</h2>
            <p>{config.description}</p>
            <div className="sdw-actions">
              {config.actions.map((action) => (
                <button
                  key={action}
                  type="button"
                  data-sc-cta={action}
                  className={action === config.primaryAction ? "sdw-btn sdw-btn-primary" : "sdw-btn sdw-btn-ghost"}
                  onClick={() => openForm(action)}
                >
                  {ACTION_LABEL[action]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <dialog
        ref={dialogRef}
        className="sdw-dialog"
        onClose={() => setOpen(false)}
        aria-labelledby="sdw-dialog-title"
      >
        <div className="sdw-dialog-panel">
          <button type="button" className="sdw-dialog-close" aria-label="Close" onClick={() => setOpen(false)}>
            ×
          </button>
          <h2 id="sdw-dialog-title">
            {formCta === "get_demo" ? `Get a ${config.brandName} demo` : `Talk to ${config.brandName} sales`}
          </h2>
          <p className="sdw-lead">
            Confirm the number an automated assistant should call now. The call may be recorded.
          </p>
          <CaptureForm
            key={`${formCta}-${open}`}
            brandName={config.brandName}
            formCta={formCta}
            sending={sending}
            error={error}
            submitted={submitted}
            onSubmit={handleSubmit}
            onStopFollowUp={async (phone) => {
              const result = await sundials.stopFollowUp(phone);
              if (!result.ok) throw new Error(result.message || "Could not stop the follow-up.");
            }}
          />
        </div>
      </dialog>
    </div>
  );

  if (!mounted) return null;
  return createPortal(ui, document.body);
}
