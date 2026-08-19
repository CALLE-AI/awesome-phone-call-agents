"use client";

import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { rosterStatus } from "@/lib/parse-workbook";

type Candidate = {
  id: string;
  name: string;
  phone: string;
  consent: boolean;
  resumeUrl: string;
  sourceFilename: string;
  createdAt: string;
};

type UploadResponse = {
  error?: string;
  imported?: number;
  skipped?: number;
  issues?: { row: number; message: string }[];
  candidates?: Candidate[];
};

const STATUS_COPY = {
  ready: { label: "Ready", className: "bg-[rgba(47,107,79,0.12)] text-forest" },
  missing_resume: { label: "No resume link", className: "bg-[rgba(161,92,18,0.12)] text-warn" },
  needs_consent: { label: "Needs consent", className: "bg-[rgba(154,59,47,0.12)] text-danger" },
} as const;

export function Dashboard() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/candidates");
    const data = (await response.json()) as { candidates?: Candidate[] };
    setCandidates(data.candidates ?? []);
  }, []);

  useEffect(() => {
    load()
      .catch(() => setError("Could not load the roster."))
      .finally(() => setLoading(false));
  }, [load]);

  const stats = useMemo(() => {
    const consented = candidates.filter((row) => row.consent).length;
    const ready = candidates.filter((row) => rosterStatus(row) === "ready").length;
    const missing = candidates.filter((row) => rosterStatus(row) === "missing_resume").length;
    return {
      total: candidates.length,
      consented,
      ready,
      missing,
    };
  }, [candidates]);

  async function uploadFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/candidates", { method: "POST", body });
      const data = (await response.json()) as UploadResponse;
      if (!response.ok) {
        setError(data.error ?? "Upload failed.");
        return;
      }
      setCandidates(data.candidates ?? []);
      const extra = data.skipped ? ` ${data.skipped} row(s) skipped.` : "";
      setNotice(`${data.imported} candidate(s) saved. The spreadsheet itself was not kept.${extra}`);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await uploadFile(file);
  }

  async function clearRoster() {
    if (!confirm("Remove every candidate from the roster? Call results are not stored yet.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/candidates", { method: "DELETE" });
      const data = (await response.json()) as UploadResponse;
      setCandidates(data.candidates ?? []);
      setNotice("Roster cleared.");
    } catch {
      setError("Could not clear the roster.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="desk-grid min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-8 md:px-8 md:py-12">
        <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium tracking-[0.18em] text-muted uppercase">
              Screening desk
            </p>
            <h1 className="font-display text-4xl leading-[1.05] font-medium tracking-tight text-ink md:text-6xl">
              HireCall
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted md:text-lg">
              Upload a candidate spreadsheet. We keep the rows — name, phone, consent,
              resume link — so you can screen later. The file itself is discarded.
            </p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-paper shadow-[var(--shadow)] md:h-20 md:w-20">
            <span className="font-display text-3xl md:text-4xl">H</span>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="In roster" value={stats.total} />
          <Stat label="Consented" value={stats.consented} />
          <Stat label="Ready to screen" value={stats.ready} />
          <Stat label="Missing resume" value={stats.missing} />
        </section>

        <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
          <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-2xl">Inbox</h2>
              <p className="mt-1 text-sm text-muted">
                Columns: <span className="text-ink">name, phone, consent, resume_link</span>
              </p>
            </div>
            <a
              className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              href="/samples/candidates.sample.csv"
            >
              Download sample CSV
            </a>
          </div>

          <label
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
              dragOver
                ? "border-accent bg-[rgba(196,92,38,0.08)]"
                : "border-line bg-canvas/60 hover:border-accent/60"
            }`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              const file = event.dataTransfer.files[0];
              if (file) void uploadFile(file);
            }}
          >
            <input
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              disabled={busy}
              onChange={onFileChange}
              type="file"
            />
            <span className="font-display text-2xl text-ink">Drop Excel or CSV here</span>
            <span className="mt-2 text-sm text-muted">
              {busy ? "Saving rows…" : "or click to choose a file. Max 5 MB."}
            </span>
          </label>

          {error ? (
            <p className="mt-4 rounded-xl bg-[rgba(154,59,47,0.1)] px-4 py-3 text-sm text-danger">
              {error}
            </p>
          ) : null}
          {notice ? (
            <p className="mt-4 rounded-xl bg-[rgba(47,107,79,0.1)] px-4 py-3 text-sm text-forest">
              {notice}
            </p>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow)]">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 md:px-8">
            <h2 className="font-display text-2xl">Roster</h2>
            {candidates.length > 0 ? (
              <button
                className="text-sm font-medium text-danger hover:underline"
                disabled={busy}
                onClick={() => void clearRoster()}
                type="button"
              >
                Clear roster
              </button>
            ) : null}
          </div>

          {loading ? (
            <p className="px-5 py-12 text-center text-muted md:px-8">Loading roster…</p>
          ) : candidates.length === 0 ? (
            <div className="px-5 py-16 text-center md:px-8">
              <p className="font-display text-2xl">No candidates yet</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Upload a spreadsheet to pin names and numbers to the desk. Calling and
                scoring come in the next step.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas/80 text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-medium md:px-8">Candidate</th>
                    <th className="px-3 py-3 font-medium">Phone</th>
                    <th className="px-3 py-3 font-medium">Resume</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium md:px-8">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((row) => {
                    const status = rosterStatus(row);
                    const copy = STATUS_COPY[status];
                    return (
                      <tr className="border-t border-line align-top" key={row.id}>
                        <td className="px-5 py-4 md:px-8">
                          <div className="font-medium text-ink">{row.name}</div>
                          <div className="text-xs text-muted">
                            {row.consent ? "Consent on file" : "No consent"}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">{row.phone}</td>
                        <td className="max-w-[220px] px-3 py-4">
                          {row.resumeUrl ? (
                            <a
                              className="break-all text-accent hover:underline"
                              href={row.resumeUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Open link
                            </a>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td className="px-3 py-4">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${copy.className}`}
                          >
                            {copy.label}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs text-muted md:px-8">
                          {row.sourceFilename || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-line bg-paper px-4 py-4 shadow-[var(--shadow)]">
      <p className="text-xs tracking-[0.16em] text-muted uppercase">{label}</p>
      <p className="font-display mt-2 text-3xl">{value}</p>
    </div>
  );
}
