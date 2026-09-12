"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateBrandName } from "@/lib/actions/brand";

export default function BrandSettings({ initialName }: { initialName: string }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true); setError(""); setSaved(false);
    const res = await updateBrandName(name);
    setSaving(false);
    if (!res.success) { setError(res.error ?? "Couldn't save that. Try again."); return; }
    setSaved(true);
  }

  const dirty = name.trim() !== initialName.trim();

  return (
    <section className="flex flex-col gap-6 rounded-card bg-surface p-6 shadow-card sm:p-8">
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-h3 text-text">Brand</h2>
        <p className="text-small text-text-muted">
          This is the name shown across your dashboard and on campaign briefs.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="brand-name" className="type-label text-text-muted">Brand name</label>
        <Input
          id="brand-name"
          value={name}
          onChange={e => { setName(e.target.value); setSaved(false); setError(""); }}
          aria-invalid={!!error}
          placeholder="e.g. Shan Foods Pakistan"
        />
        {error ? <p className="text-small text-danger">{error}</p> : null}
        {saved && !error ? <p className="text-small text-success">Saved</p> : null}
      </div>

      <div className="flex justify-end border-t border-border pt-6">
        <Button onClick={handleSave} disabled={!dirty || saving} loading={saving}>
          Save changes
        </Button>
      </div>
    </section>
  );
}
