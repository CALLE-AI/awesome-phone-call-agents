'use client';

import { useRef, useState } from 'react';
import type { ImportBusinessContactsResponse } from '@dial/schemas';
import { proxied, ApiError } from '@/lib/api';

/**
 * Bringing a business's customer list in from a spreadsheet.
 *
 * Two steps on purpose. Picking a file reads it and reports what it found
 * without writing anything; a second, deliberate press saves it. Importing a
 * customer list is how a business ends up telephoning several hundred people,
 * and "I picked the wrong file" should be recoverable by doing nothing.
 *
 * The file is read in the browser only far enough to base64 it. Every decision
 * about what the columns mean, and every phone number, is worked out on the
 * server -- local numbers can only be read against the business's own country,
 * which the browser has no business knowing.
 */
export function ImportContacts({
  businessId,
  onImported,
}: {
  businessId: string;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportBusinessContactsResponse | null>(null);
  const [done, setDone] = useState<ImportBusinessContactsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setPreview(null);
    setDone(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function read(chosen: File) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const contentBase64 = await toBase64(chosen);
      const result = await proxied.importBusinessContacts(businessId, {
        filename: chosen.name,
        contentBase64,
        // Nothing is written yet. This only reports what the file holds.
        dryRun: true,
      });
      setFile(chosen);
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Dial could not read that file.');
      setFile(null);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const contentBase64 = await toBase64(file);
      const result = await proxied.importBusinessContacts(businessId, {
        filename: file.name,
        contentBase64,
      });
      setDone(result);
      setPreview(null);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      onImported();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Dial could not import that file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <div className="card-label">Import a customer list</div>
      <p className="field-hint" style={{ marginTop: 0 }}>
        An Excel file (.xlsx) or a CSV. Give the first row headings — Dial looks for a name column
        and a phone column. These are added to this business only, never to your own contacts.
      </p>

      {error ? (
        <div className="notice" data-tone="danger" role="alert">
          {error}
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="import-file">Choose a file</label>
        <input
          id="import-file"
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(event) => {
            const chosen = event.target.files?.[0];
            if (chosen) void read(chosen);
          }}
        />
      </div>

      {busy && !preview ? <p className="field-hint">Reading {file?.name ?? 'the file'}…</p> : null}

      {/*
        What the file holds, before anything is saved. The counts and the
        column names together are what catch a wrong file: a list of suppliers
        looks exactly like a list of customers until you read two of them.
      */}
      {preview ? (
        <div className="import-preview">
          <div className="import-stat-row">
            <ImportStat value={preview.totalRows} label="rows in the file" />
            <ImportStat
              value={preview.sample.length > 0 ? preview.totalRows - preview.skipped.length - preview.duplicates : 0}
              label="will be added"
              tone="good"
            />
            {preview.duplicates > 0 ? (
              <ImportStat value={preview.duplicates} label="already on the list" />
            ) : null}
            {preview.skipped.length > 0 ? (
              <ImportStat value={preview.skipped.length} label="cannot be used" tone="warn" />
            ) : null}
          </div>

          <p className="field-hint">
            Reading names from <strong>{preview.columns.name}</strong> and numbers from{' '}
            <strong>{preview.columns.phone}</strong>
            {preview.columns.email ? (
              <>
                , email from <strong>{preview.columns.email}</strong>
              </>
            ) : null}
            .
          </p>

          {preview.sample.length > 0 ? (
            <ul className="import-sample">
              {preview.sample.map((contact) => (
                <li key={contact.phoneE164}>
                  <span>{contact.name}</span>
                  <span className="import-sample-phone">{contact.phoneE164}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {preview.skipped.length > 0 ? (
            <details>
              <summary style={{ cursor: 'pointer' }}>
                {preview.skipped.length} row{preview.skipped.length === 1 ? '' : 's'} Dial cannot use
              </summary>
              <ul className="import-skipped">
                {preview.skipped.map((issue) => (
                  <li key={`${issue.row}-${issue.reason}`}>
                    <span className="import-skipped-row">Row {issue.row}</span>
                    <span>{issue.name ?? issue.phone ?? '(empty)'}</span>
                    <span className="import-skipped-reason">{issue.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="button-row">
            <button className="button" data-variant="primary" disabled={busy} onClick={() => void confirm()}>
              {busy ? 'Importing…' : 'Add these contacts'}
            </button>
            <button className="button" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {done ? (
        <div className="notice" data-tone="success" role="status">
          Added {done.imported} contact{done.imported === 1 ? '' : 's'}
          {done.duplicates > 0 ? `, ${done.duplicates} already on the list` : ''}
          {done.skipped.length > 0 ? `, ${done.skipped.length} skipped` : ''}.
        </div>
      ) : null}
    </section>
  );
}

function ImportStat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone?: 'good' | 'warn';
}) {
  return (
    <div className="import-stat" data-tone={tone}>
      <span className="import-stat-number">{value}</span>
      <span className="import-stat-label">{label}</span>
    </div>
  );
}

/**
 * The file as base64, without the data-URL prefix FileReader adds.
 *
 * The browser does no parsing: it hands the bytes over and the server decides
 * what they mean, so both clients get identical results from the same file.
 */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
