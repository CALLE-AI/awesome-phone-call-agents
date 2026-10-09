"use client";
import { useState } from "react";
import AppShell from "@/components/app-shell";

export default function Profile() {
  const [name, setName] = useState("");
  const [email] = useState("you@example.com"); // dummy until auth is real
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <AppShell>
      <h1 className="font-display text-2xl text-ink mb-6">Profile</h1>

      <form onSubmit={handleSave} className="border border-line bg-white/40 rounded-md p-6 max-w-sm flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-ink/70">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="border border-line rounded-md px-3 py-2 bg-white/70 outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-ink/70">Email</span>
          <input
            value={email}
            disabled
            className="border border-line rounded-md px-3 py-2 bg-paper-dim text-ink/50"
          />
        </label>
        <button
          type="submit"
          className="bg-teal text-paper rounded-md py-2.5 text-sm font-medium hover:bg-teal-dark mt-2"
        >
          Save changes
        </button>
        {saved && <p className="text-xs text-teal">Saved.</p>}
      </form>
    </AppShell>
  );
}