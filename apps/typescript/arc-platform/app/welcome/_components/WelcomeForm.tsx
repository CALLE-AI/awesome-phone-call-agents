"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBrandName } from "@/lib/actions/brand";

/**
 * One field, because there is exactly one thing Arc cannot work without and
 * cannot infer. The old onboarding asked thirteen questions and read twelve of
 * the answers nowhere.
 *
 * No logo upload here. `logoUploader` exists in app/api/uploadthing/core.ts and
 * has never had a caller, and UPLOADTHING_TOKEN is set in no environment - a
 * button wired to it would fail on click. Initials from the confirmed name are
 * honest and work everywhere; the upload can come when the token does.
 */
export default function WelcomeForm({ suggested }: { suggested: string }) {
  const router = useRouter();
  /* The Clerk-derived guess is NOT pre-filled. It is shown underneath as
     something to reject, because a filled box is a box people accept: pre-
     filling "Coac Tal" is how it would reach a phone call. */
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    const res = await updateBrandName(name);
    if (!res.success) {
      setSaving(false);
      setError(res.error ?? "Couldn't save that. Try again.");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  const ready = name.trim().length >= 2;

  return (
    <section className="flex flex-col gap-6 rounded-card bg-surface p-6 shadow-card sm:p-8">
      <div className="flex flex-col gap-2">
        <label htmlFor="company" className="type-label text-text-muted">Company name</label>
        <Input
          id="company"
          value={name}
          autoFocus
          onChange={e => { setName(e.target.value); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter" && ready && !saving) save(); }}
          aria-invalid={!!error}
          placeholder="e.g. Shan Foods Pakistan"
        />
        {error ? <p className="text-small text-danger">{error}</p> : null}
        {suggested ? (
          <p className="text-small text-text-muted">
            We had guessed <span className="text-text">{suggested}</span> from your profile. That is
            your name, not your company&apos;s.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <span className="text-small text-text-muted">You can change this later in Settings.</span>
        <Button onClick={save} disabled={!ready || saving} loading={saving}>
          Continue
        </Button>
      </div>
    </section>
  );
}
