"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";

import { DEMO_CALL_PROMPT, DEMO_JOB_ROLE, DEMO_NAME, DEMO_RESUME_TEXT } from "@/lib/demo-candidate";
import { formatUploadedAt, shortBatchId } from "@/lib/status";
import type { Batch } from "@/lib/types";
import { ApiError, clearOperatorToken, getOperatorToken, hirecallApi, setOperatorToken } from "@/services/hirecall-api";

export function Dashboard() {
  const router = useRouter();
  const [batches, setBatches] = useState<Batch[]>([]);
  const [inactiveBatches, setInactiveBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [liveCallsEnabled, setLiveCallsEnabled] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [tokenInput, setTokenInput] = useState("");

  const load = useCallback(async () => {
    const data = await hirecallApi.listRoster();
    setBatches(data.batches);
    setInactiveBatches(data.inactiveBatches);
    setLiveCallsEnabled(data.liveCallsEnabled);
  }, []);

  useEffect(() => {
    setUnlocked(Boolean(getOperatorToken()));
  }, []);

  useEffect(() => {
    if (!unlocked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    load()
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) {
          clearOperatorToken();
          setUnlocked(false);
          setError("That operator token is wrong. Check HIRECALL_OPERATOR_TOKEN in .env.");
          return;
        }
        setError("Could not load the roster.");
      })
      .finally(() => setLoading(false));
  }, [unlocked, load]);

  const stats = useMemo(() => {
    return {
      files: batches.length,
      total: batches.reduce((sum, row) => sum + row.candidateCount, 0),
      consented: batches.reduce((sum, row) => sum + row.consentedCount, 0),
      ready: batches.reduce((sum, row) => sum + row.readyCount, 0),
    };
  }, [batches]);

  async function uploadFile(file: File) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await hirecallApi.uploadWorkbook(file);
      setBatches(data.batches);
      setInactiveBatches(data.inactiveBatches);
      const extra = data.skipped ? ` ${data.skipped} row(s) skipped.` : "";
      setNotice(
        `${data.imported} candidate(s) saved as a new Excel batch. Open that row to call them.${extra}`,
      );
    } catch (err) {
      if (rejectIfUnauthorized(err)) return;
      setError(err instanceof ApiError ? err.message : "Upload failed. Try again.");
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
    if (!confirm("Deactivate every Excel batch? They move to Inactive and can be restored. HireCall will not start the next call. A call that is already ringing may keep ringing.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const data = await hirecallApi.deactivateAll();
      setBatches(data.batches);
      setInactiveBatches(data.inactiveBatches);
      setNotice("Active batches moved to Inactive.");
    } catch (err) {
      if (rejectIfUnauthorized(err)) return;
      setError(err instanceof ApiError ? err.message : "Could not clear the roster.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreBatch(id: string) {
    setBusy(true);
    setError("");
    try {
      await hirecallApi.setBatchActive(id, true);
      await load();
      setNotice("Excel restored to the active roster.");
    } catch (err) {
      if (rejectIfUnauthorized(err)) return;
      setError(err instanceof ApiError ? err.message : "Could not restore that Excel.");
    } finally {
      setBusy(false);
    }
  }

  function unlockDesk() {
    const token = tokenInput.trim();
    if (!token) {
      setError("Enter the operator token from HIRECALL_OPERATOR_TOKEN in .env.");
      return;
    }
    setError("");
    setOperatorToken(token);
    setUnlocked(true);
  }

  function lockDesk() {
    clearOperatorToken();
    setUnlocked(false);
    setBatches([]);
    setInactiveBatches([]);
    setLiveCallsEnabled(null);
    setNotice("");
  }

  function rejectIfUnauthorized(err: unknown) {
    if (err instanceof ApiError && err.status === 401) {
      lockDesk();
      setError("That operator token is wrong. Check HIRECALL_OPERATOR_TOKEN in .env.");
      return true;
    }
    return false;
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
              Each uploaded Excel becomes its own batch. Open a batch to edit a
              candidate or re-upload a corrected file into that same batch.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {unlocked ? (
              <button
                type="button"
                onClick={lockDesk}
                className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-medium text-ink"
              >
                Sign out
              </button>
            ) : null}
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-accent text-paper shadow-[var(--shadow)] md:h-20 md:w-20">
              <span className="font-display text-3xl md:text-4xl">H</span>
            </div>
          </div>
        </header>

        {!unlocked ? (
          <section className="max-w-lg rounded-[28px] border border-line bg-paper p-6 shadow-[var(--shadow)]">
            <h2 className="font-display text-2xl text-ink">Enter operator token</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              Paste the same value as <span className="font-medium text-ink">HIRECALL_OPERATOR_TOKEN</span>{" "}
              in <span className="font-medium text-ink">.env</span>. The desk stores it in this
              browser tab only. Without it, the APIs will not list candidates or place calls.
            </p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                unlockDesk();
              }}
            >
              <input
                type="password"
                autoComplete="off"
                value={tokenInput}
                onChange={(event) => setTokenInput(event.target.value)}
                placeholder="Operator token"
                className="rounded-2xl border border-line bg-wash px-4 py-3 text-sm text-ink"
              />
              <button
                type="submit"
                className="rounded-full bg-ink px-5 py-3 text-sm font-medium text-paper"
              >
                Unlock desk
              </button>
            </form>
            {error ? <p className="mt-3 text-sm text-rose-800">{error}</p> : null}
          </section>
        ) : null}

        {unlocked ? (
          <>
        {liveCallsEnabled === false ? (
          <p className="rounded-2xl border border-line bg-paper px-4 py-3 text-sm text-muted">
            Live calls are off. Clicking Call completes a local dry-run and does not
            ring anyone. Set <span className="font-medium text-ink">HIRECALL_LIVE_CALLS=true</span>{" "}
            and <span className="font-medium text-ink">CALLE_API_KEY</span> in{" "}
            <span className="font-medium text-ink">.env</span>, then restart{" "}
            <span className="font-medium text-ink">npm run dev</span>, to place a real CALL-E call.
          </p>
        ) : null}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Excel batches" value={stats.files} />
          <Stat label="Candidates" value={stats.total} />
          <Stat label="Consented" value={stats.consented} />
          <Stat label="Ready to call" value={stats.ready} />
        </section>

        <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
          <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-2xl">Inbox</h2>
              <p className="mt-1 text-sm text-muted">
                Download the Excel template, fill in candidate details, then upload it
                here to create a new batch. Fix names or resume links on the batch
                page, not by uploading another roster row. Phones need a country
                code. Samples use reserved fictional numbers such as +14155550123.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a
                className="inline-flex items-center rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper hover:bg-accent/90"
                download="HireCall-candidates-template.xlsx"
                href="/samples/candidates.sample.xlsx"
              >
                Download Excel template
              </a>
              <a
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                href="/samples/candidates.sample.csv"
              >
                CSV instead
              </a>
            </div>
          </div>

          <div className="mb-5 overflow-x-auto rounded-2xl border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-canvas text-xs tracking-wide text-muted uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Column</th>
                  <th className="px-4 py-3 font-medium">Required</th>
                  <th className="px-4 py-3 font-medium">What to enter</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">name</td>
                  <td className="px-4 py-3">Yes</td>
                  <td className="px-4 py-3 text-muted">Full name, e.g. Priya Sharma</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">phone</td>
                  <td className="px-4 py-3">Yes</td>
                  <td className="px-4 py-3 text-muted">
                    International E.164 number with country code. Samples use
                    reserved fictional numbers such as +14155550123.
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">job_role</td>
                  <td className="px-4 py-3">Yes</td>
                  <td className="px-4 py-3 text-muted">
                    Opening for this Excel, e.g. Software intern. Same role on every row is
                    fine.
                  </td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">consent</td>
                  <td className="px-4 py-3">No</td>
                  <td className="px-4 py-3 text-muted">yes or no</td>
                </tr>
                <tr className="border-t border-line">
                  <td className="px-4 py-3 font-medium text-ink">resume_link</td>
                  <td className="px-4 py-3">No</td>
                  <td className="px-4 py-3 text-muted">Public HTTPS Google Drive or file URL</td>
                </tr>
              </tbody>
            </table>
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
            <span className="font-display text-2xl text-ink">Drop the filled Excel here</span>
            <span className="mt-2 text-sm text-muted">
              {busy ? "Saving rows…" : "or click to choose .xlsx, .xls, or .csv. Max 5 MB."}
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

        <JudgeTestForm
          busy={busy}
          onBusy={setBusy}
          onError={setError}
          onNotice={setNotice}
          onUnauthorized={() => {
            lockDesk();
            setError("That operator token is wrong. Check HIRECALL_OPERATOR_TOKEN in .env.");
          }}
          onCreated={(batchId) => router.push(`/batches/${batchId}`)}
        />

        <section className="overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow)]">
          <div className="flex items-center justify-between border-b border-line px-5 py-4 md:px-8">
            <h2 className="font-display text-2xl">Roster</h2>
            {batches.length > 0 ? (
              <button
                className="text-sm font-medium text-danger hover:underline"
                disabled={busy}
                onClick={() => void clearRoster()}
                type="button"
              >
                Deactivate all
              </button>
            ) : null}
          </div>

          {loading ? (
            <p className="px-5 py-12 text-center text-muted md:px-8">Loading roster…</p>
          ) : batches.length === 0 ? (
            <div className="px-5 py-16 text-center md:px-8">
              <p className="font-display text-2xl">No active Excel batches</p>
              <p className="mx-auto mt-2 max-w-md text-sm text-muted">
                Upload a spreadsheet to create a batch
                {inactiveBatches.length > 0 ? ", or restore one from Inactive below." : ". Click that batch to see its candidates and call them from there."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas/80 text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-medium md:px-8">Excel</th>
                    <th className="px-3 py-3 font-medium">Job role</th>
                    <th className="px-3 py-3 font-medium">Batch ID</th>
                    <th className="px-3 py-3 font-medium">Uploaded</th>
                    <th className="px-3 py-3 font-medium">Candidates</th>
                    <th className="px-3 py-3 font-medium">Ready</th>
                    <th className="px-5 py-3 font-medium md:px-8">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((row) => (
                    <tr className="border-t border-line" key={row.id}>
                      <td className="px-5 py-4 md:px-8">
                        <Link
                          className="font-medium text-ink hover:text-accent hover:underline"
                          href={`/batches/${row.id}`}
                        >
                          {row.filename}
                        </Link>
                      </td>
                      <td className="px-3 py-4">{row.jobRole || "—"}</td>
                      <td className="px-3 py-4 font-mono text-xs text-muted">
                        {shortBatchId(row.id)}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-muted">
                        {formatUploadedAt(row.createdAt)}
                      </td>
                      <td className="px-3 py-4">{row.candidateCount}</td>
                      <td className="px-3 py-4">{row.readyCount}</td>
                      <td className="px-5 py-4 md:px-8">
                        <Link
                          className="text-sm font-medium text-accent hover:underline"
                          href={`/batches/${row.id}`}
                        >
                          View candidates
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {inactiveBatches.length > 0 ? (
          <section className="overflow-hidden rounded-[28px] border border-line bg-paper shadow-[var(--shadow)]">
            <div className="border-b border-line px-5 py-4 md:px-8">
              <h2 className="font-display text-2xl">Inactive</h2>
              <p className="mt-1 text-sm text-muted">
                Soft-deleted Excels. Restore to put them back on the roster.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-canvas/80 text-xs tracking-wide text-muted uppercase">
                  <tr>
                    <th className="px-5 py-3 font-medium md:px-8">Excel</th>
                    <th className="px-3 py-3 font-medium">Batch ID</th>
                    <th className="px-3 py-3 font-medium">Uploaded</th>
                    <th className="px-3 py-3 font-medium">Candidates</th>
                    <th className="px-5 py-3 font-medium md:px-8">Restore</th>
                  </tr>
                </thead>
                <tbody>
                  {inactiveBatches.map((row) => (
                    <tr className="border-t border-line" key={row.id}>
                      <td className="px-5 py-4 md:px-8 font-medium text-muted">{row.filename}</td>
                      <td className="px-3 py-4 font-mono text-xs text-muted">
                        {shortBatchId(row.id)}
                      </td>
                      <td className="px-3 py-4 whitespace-nowrap text-muted">
                        {formatUploadedAt(row.createdAt)}
                      </td>
                      <td className="px-3 py-4">{row.candidateCount}</td>
                      <td className="px-5 py-4 md:px-8">
                        <button
                          className="text-sm font-medium text-accent hover:underline disabled:text-muted"
                          disabled={busy}
                          onClick={() => void restoreBatch(row.id)}
                          type="button"
                        >
                          Restore
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function JudgeTestForm({
  busy,
  onBusy,
  onError,
  onNotice,
  onUnauthorized,
  onCreated,
}: {
  busy: boolean;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
  onNotice: (value: string) => void;
  onUnauthorized: () => void;
  onCreated: (batchId: string) => void;
}) {
  const [name, setName] = useState(DEMO_NAME);
  const [jobRole, setJobRole] = useState(DEMO_JOB_ROLE);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(true);

  async function submit() {
    if (!consent) {
      onError("Consent is required to place the judge test call.");
      return;
    }
    onBusy(true);
    onError("");
    onNotice("");
    try {
      const data = await hirecallApi.createJudgeTest({ phone, name, jobRole });
      onNotice("Judge test batch ready. Call that row — resume and script are already filled.");
      onCreated(data.batch.id);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onUnauthorized();
        return;
      }
      onError(err instanceof ApiError ? err.message : "Could not create the judge test.");
    } finally {
      onBusy(false);
    }
  }

  const fieldClass =
    "mt-1 w-full rounded-xl border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-accent";

  return (
    <section className="rounded-[28px] border border-line bg-paper p-5 shadow-[var(--shadow)] md:p-8">
      <h2 className="font-display text-2xl">Judge test</h2>
      <p className="mt-1 mb-5 text-sm text-muted">
        Same columns as the Excel. Fake resume and CALL-E script are already
        written. Enter your number with a country code, then Call on the next page.
        After hangup, <span className="font-medium text-ink">GEMINI_API_KEY</span> is
        required so Gemini can write the score and summary. Live ringing also needs
        <span className="font-medium text-ink">HIRECALL_LIVE_CALLS=true</span> and
        <span className="font-medium text-ink">CALLE_API_KEY</span>. Without live
        calls, Call runs a local dry-run and does not dial.
      </p>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="text-sm font-medium text-ink">
          name
          <input
            className={fieldClass}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="text-sm font-medium text-ink">
          job_role
          <input
            className={fieldClass}
            disabled={busy}
            onChange={(event) => setJobRole(event.target.value)}
            required
            value={jobRole}
          />
        </label>
        <label className="text-sm font-medium text-ink">
          phone
          <input
            className={fieldClass}
            disabled={busy}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+14155550123"
            required
            value={phone}
          />
          <span className="mt-1 block text-xs font-normal text-muted">
            Any country. Include the + code. This is the number CALL-E will dial.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            checked={consent}
            disabled={busy}
            onChange={(event) => setConsent(event.target.checked)}
            type="checkbox"
          />
          consent
        </label>
        <div className="md:col-span-2">
          <p className="text-sm font-medium text-ink">Fake resume</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-3 text-xs leading-relaxed text-muted">
            {DEMO_RESUME_TEXT}
          </pre>
        </div>
        <div className="md:col-span-2">
          <p className="text-sm font-medium text-ink">Fake call prompt</p>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-line bg-canvas p-3 text-xs leading-relaxed text-muted">
            {DEMO_CALL_PROMPT}
          </pre>
        </div>
        <div className="md:col-span-2">
          <button
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            Create judge test
          </button>
        </div>
      </form>
    </section>
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
