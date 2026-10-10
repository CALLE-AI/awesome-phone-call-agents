"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SubmitState = "idle" | "submitting" | "success" | "error";

export function LeadForm() {
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formElement = event.currentTarget;
    const formData = new FormData(formElement);
    const payload = {
      name: String(formData.get("name") ?? ""),
      phone: String(formData.get("phone") ?? ""),
      email: String(formData.get("email") ?? "") || undefined,
      notes: String(formData.get("notes") ?? "") || undefined,
      consent,
    };

    setState("submitting");
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setState("success");
      formElement.reset();
      setConsent(false);
      return;
    }

    const body = await res.json().catch(() => null);
    setError(body?.error ? JSON.stringify(body.error) : "Something went wrong. Please try again.");
    setState("error");
  }

  if (state === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Thanks — we&apos;ll call you back shortly</CardTitle>
          <CardDescription>
            A qualification call will be placed as soon as it&apos;s within business hours. You
            can watch it show up in the{" "}
            <Link href="/review" className="text-primary underline underline-offset-2">
              review console
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setState("idle")}>
            Submit another lead
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Request a callback</CardTitle>
        <CardDescription>
          Tell us a bit about what you need — we&apos;ll call you back to confirm the details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required maxLength={200} placeholder="Jordan Lee" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone (E.164)</Label>
            <Input id="phone" name="phone" required placeholder="+15551234567" pattern="^\+[1-9]\d{7,14}$" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">Email (optional)</Label>
            <Input id="email" name="email" type="email" placeholder="jordan@example.com" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notes">Anything we should know? (optional)</Label>
            <Textarea id="notes" name="notes" maxLength={2000} placeholder="Looking for a quote on..." />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="consent"
              checked={consent}
              onCheckedChange={(checked) => setConsent(checked === true)}
            />
            <Label htmlFor="consent" className="font-normal leading-snug">
              I agree to be called back at the number above about this request.
            </Label>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={!consent || state === "submitting"}>
            {state === "submitting" ? "Submitting…" : "Request callback"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
