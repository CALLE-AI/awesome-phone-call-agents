"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HarborBand } from "../HarborBand";
import { sundials } from "@/lib/sdk";
import { useSundial } from "@/lib/sdk/useSundial";

const TRUST = [
  "30-minute working session on a live deal, not a slide walkthrough",
  "Security pack (SOC 2, subprocessors, residency) sent with the calendar hold",
  "Named architect on Enterprise trials"
];

function ContactForm() {
  const searchParams = useSearchParams();
  const plan = searchParams.get("plan")?.trim().toLowerCase().replace(/\s+/g, "_") || "";
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [name, setName] = useState("");
  const [done, setDone] = useState(false);
  const [sending, setSending] = useState(false);
  const { error, dispatchCall } = useSundial();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    sundials.track("cta_clicked", {
      name: "talk_to_sales",
      source: "contact_page",
      ...(plan ? { plan } : {})
    });
    sundials.identify({ email, phone, company, name: name || undefined });
    const ok = await dispatchCall({
      phoneNumber: phone.trim(),
      contactEmail: email.trim(),
      contactName: name.trim() || undefined,
      company: company.trim(),
      visitorId: sundials.visitorId(),
      sessionId: sundials.sessionId(),
      accountId: "harbor",
      declaredCta: "talk_to_sales"
    });
    setSending(false);
    if (ok) setDone(true);
  };

  return (
    <div>
      <HarborBand>
        <div className="mx-auto max-w-6xl space-y-4 px-6 py-16">
            <p className="text-xs font-semibold tracking-[0.2em] text-teal-200 uppercase">Contact</p>
          <h1 className="max-w-3xl text-5xl text-white">Talk to Harbor sales.</h1>
          <p className="max-w-2xl text-white/70">
            Work email and a direct phone number are required. You agree Harbor may follow up at both — including by an
            automated assistant on behalf of Harbor sales.
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
        {done ? (
          <Card>
            <CardHeader>
              <CardTitle className="font-heading text-3xl">Thank you.</CardTitle>
              <CardDescription>Harbor has your details. A teammate or automated assistant may follow up by phone.</CardDescription>
            </CardHeader>
          </Card>
        ) : (
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
              <form onSubmit={onSubmit} className="space-y-3" aria-busy={sending}>
                <fieldset disabled={sending} className="space-y-3 border-0 p-0">
                <div className="space-y-1.5">
                  <Label htmlFor="harbor-email">Work email</Label>
                  <Input
                    id="harbor-email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="harbor-phone">Phone (E.164, e.g. +15550192831)</Label>
                  <Input
                    id="harbor-phone"
                    type="tel"
                    required
                    autoComplete="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="harbor-company">Company</Label>
                  <Input
                    id="harbor-company"
                    required
                    autoComplete="organization"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="harbor-name">
                    Name <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Input
                    id="harbor-name"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button type="submit" data-sc-cta="talk_to_sales" disabled={sending}>
                  {sending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                      Sending details…
                    </>
                  ) : (
                    "Talk to sales"
                  )}
                </Button>
                </fieldset>
              </form>
            </CardContent>
          </Card>
        )}
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
