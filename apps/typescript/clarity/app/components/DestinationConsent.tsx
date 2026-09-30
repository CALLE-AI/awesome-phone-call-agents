"use client";

import { useState } from "react";

type Props = {
  busy: boolean;
  authorized: string | null;
  onAuthorize: (phone: string) => Promise<void>;
};

export function DestinationConsent({ busy, authorized, onAuthorize }: Props) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [show, setShow] = useState(false);
  if (authorized) return <p className="text-sm text-accent">Authorized destination: {authorized} · English call</p>;
  return (
    <div className="space-y-3 rounded-xl border border-line p-4">
      <label className="block text-sm text-chalk" htmlFor="destination">Candidate destination</label>
      <p className="text-xs text-fog">Enter the agreed number with + and country code. Calls are in English. Numbers in the application are never selected automatically.</p>
      <div className="flex gap-2">
        <input id="destination" type={show ? "tel" : "password"} autoComplete="off" value={phone}
          placeholder="+ and country code" disabled={busy}
          onChange={(event) => { setPhone(event.target.value); setConsent(false); }}
          className="min-w-0 flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm text-chalk" />
        <button type="button" onClick={() => setShow(!show)} className="text-xs text-fog">{show ? "Hide" : "Show"}</button>
      </div>
      <label className="flex items-start gap-2 text-xs leading-relaxed text-fog">
        <input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} className="mt-1" />
        I verified this exact number and have the recipient’s consent and authority to place this AI application follow-up call in English.
      </label>
      <button type="button" disabled={busy || !consent || !phone} onClick={async () => { await onAuthorize(phone); setPhone(""); setConsent(false); }}
        className="rounded-lg border border-accent px-3 py-2 text-sm text-accent disabled:opacity-35">Confirm destination consent</button>
    </div>
  );
}
