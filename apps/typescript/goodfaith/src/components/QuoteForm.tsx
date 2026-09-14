// File: src/components/QuoteForm.tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Clinic {
  name: string;
  phone: string;
}

const PROCEDURES = [
  { code: "72148", label: "MRI lumbar spine without contrast (72148)" },
  { code: "70551", label: "MRI brain without contrast (70551)" },
  { code: "73721", label: "MRI knee without contrast (73721)" },
  { code: "74176", label: "CT abdomen & pelvis without contrast (74176)" },
];

const SAMPLE: Clinic[] = [
  { name: "Lone Star Open MRI", phone: "+15125550142" },
  { name: "Capitol Imaging Partners", phone: "+15125550188" },
  { name: "Riverside Diagnostic Center", phone: "+15125550170" },
  { name: "Hill Country MRI", phone: "+15125550199" },
];

export function QuoteForm({ mode = "mock" }: { mode?: "mock" | "live" }) {
  const router = useRouter();
  const [code, setCode] = useState("72148");
  const [zip, setZip] = useState("78701");
  const [clinics, setClinics] = useState<Clinic[]>([{ name: "", phone: "" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sampleLoaded, setSampleLoaded] = useState(false);

  function label() {
    return PROCEDURES.find((p) => p.code === code)?.label ?? "procedure";
  }

  function loadSample() {
    setError(null);
    setClinics(SAMPLE);
    setSampleLoaded(true);
  }

  async function loadClinics() {
    setError(null);
    const res = await fetch(`/api/clinics?zip=${encodeURIComponent(zip)}`);
    const json = await res.json();
    if (json.data?.clinics?.length) {
      setClinics(json.data.clinics.map((c: Clinic) => ({ name: c.name, phone: c.phone })));
      setSampleLoaded(false);
    }
  }

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ procedure: label(), code, zip, clinics: clinics.filter((c) => c.name) }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      router.push(`/rfq/${json.data.rfq_id}`);
    } finally {
      setLoading(false);
    }
  }

  const filled = clinics.filter((c) => c.name.trim()).length;

  return (
    <section aria-labelledby="quote-heading" className="card animate-fade-in p-6 md:p-7">
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <h2 id="quote-heading" className="font-serif text-xl">
          Get a cash price
        </h2>
        <button
          onClick={loadSample}
          className="text-xs font-medium text-accent transition-colors hover:text-accent-soft"
        >
          Load sample MRI clinics
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="procedure" className="mb-1.5 block text-sm text-paper-400">
            Procedure
          </label>
          <select id="procedure" value={code} onChange={(e) => setCode(e.target.value)} className="field">
            {PROCEDURES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="zip" className="mb-1.5 block text-sm text-paper-400">
              ZIP code
            </label>
            <input id="zip" value={zip} inputMode="numeric" onChange={(e) => setZip(e.target.value)} className="field" />
          </div>
          <button onClick={loadClinics} className="btn-ghost whitespace-nowrap">
            Find clinics near me
          </button>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-paper-400">
              Clinics to call
              {filled > 0 && <span className="ml-1.5 text-paper-500">· {filled} selected</span>}
            </span>
            {sampleLoaded && (
              <span className="badge border border-ink-600 bg-ink-800 text-paper-400">sample loaded</span>
            )}
          </div>

          {clinics.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input
                aria-label={`Clinic ${i + 1} name`}
                placeholder="Clinic name"
                value={c.name}
                onChange={(e) => setClinics(clinics.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                className="field flex-1"
              />
              <input
                aria-label={`Clinic ${i + 1} phone`}
                placeholder="+1 512…"
                value={c.phone}
                onChange={(e) => setClinics(clinics.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))}
                className="field w-36 tnum"
              />
            </div>
          ))}

          <button
            onClick={() => setClinics([...clinics, { name: "", phone: "" }])}
            className="text-xs text-paper-400 transition-colors hover:text-paper-100"
          >
            + add another clinic
          </button>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad-soft">
            {error}
          </p>
        )}

        <button onClick={submit} disabled={loading || filled === 0} className="btn-primary w-full">
          {loading ? (
            <>
              <span className="h-2 w-2 animate-pulse-dot rounded-full bg-ink-950" aria-hidden />
              Dialing clinics…
            </>
          ) : (
            "Get a cash price"
          )}
        </button>

        <p className="text-xs leading-relaxed text-paper-500">
          {mode === "mock" ? (
            <>
              <span className="text-paper-300">Mock mode.</span> No phone is dialed. Results come from a recorded,
              clearly badged sample call. Live calling is implemented and reaches the CALL-E API; a full live run
              needs a recipient in a supported region (en-US verified).
            </>
          ) : (
            <>
              <span className="text-accent">Live mode.</span> A real outbound call will be placed to each clinic you
              selected.
            </>
          )}
        </p>
      </div>
    </section>
  );
}
