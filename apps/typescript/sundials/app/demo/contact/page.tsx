"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HarborBand } from "../HarborBand";
import { sundials } from "@/lib/sdk";
import { useSundial } from "@/lib/sdk/useSundial";
import { CaptureForm } from "@/lib/sdk/CaptureForm";
import "@/lib/sdk/widget.css";

const TRUST = [
  "30-minute working session on a live deal, not a slide walkthrough",
  "Security pack (SOC 2, subprocessors, residency) sent with the calendar hold",
  "Named architect on Enterprise trials"
];

function ContactForm() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan")?.trim().toLowerCase().replace(/\s+/g, "_") || "";
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const { error, dispatchCall } = useSundial();

  return (
    <div>
      <HarborBand>
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-16">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Contact</p>
          <h1 className="max-w-3xl text-5xl text-white">Talk to Harbor sales.</h1>
          <p className="max-w-2xl text-white/70">
            Work email and a direct phone number are required. Confirm the automated call on the form — including the
            number that will ring and the one disclosed follow-up if nobody answers.
          </p>
        </div>
      </HarborBand>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-6">
          <h2 className="text-3xl">What happens next</h2>
          <ul className="space-y-3 text-sm text-muted-foreground">
            {TRUST.map((item) => (
              <li key={item} className="rounded-xl border border-border bg-card px-4 py-3 text-foreground">
                {item}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">Typical response: same business day in US and EU time zones.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request a workspace walkthrough</CardTitle>
            <CardDescription>
              {plan
                ? `You chose the ${plan.replace(/_/g, " ")} plan. We use this form to route the right architect, not to add you to a newsletter.`
                : "We use this to route the right architect, not to add you to a newsletter."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="sdw-root">
              <CaptureForm
                brandName="Harbor"
                formCta="talk_to_sales"
                sending={sending}
                error={error}
                submitted={done}
                onSubmit={async (payload) => {
                  setSending(true);
                  sundials.track("cta_clicked", {
                    name: "talk_to_sales",
                    source: "contact_page",
                    ...(plan ? { plan } : {})
                  });
                  sundials.identify({
                    email: payload.email,
                    phone: payload.phone,
                    company: payload.company,
                    name: payload.name || undefined
                  });
                  const ok = await dispatchCall({
                    phoneNumber: payload.phone,
                    contactEmail: payload.email,
                    contactName: payload.name,
                    company: payload.company,
                    visitorId: sundials.visitorId(),
                    sessionId: sundials.sessionId(),
                    accountId: "harbor",
                    declaredCta: "talk_to_sales",
                    callConsent: payload.callConsent
                  });
                  setSending(false);
                  if (ok) setDone(true);
                }}
                onStopFollowUp={async (phone) => {
                  const result = await sundials.stopFollowUp(phone);
                  if (!result.ok) throw new Error(result.message || "Could not stop the follow-up.");
                }}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export default function ContactPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-16 text-sm text-muted-foreground">Loading contact…</div>
      }
    >
      <ContactForm />
    </Suspense>
  );
}
