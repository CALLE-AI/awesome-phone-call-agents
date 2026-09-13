'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  ContactCsvError,
  MAX_CONTACT_CSV_BYTES,
  parseContactCsv,
} from '@/lib/campaigns/contact-csv';
import type {
  CampaignLocale,
  CampaignLaunchPreview,
  CampaignStatus,
  Contact,
} from '@/types/campaign';

type Entry = 'rows' | 'csv';
type PendingAction = 'preview' | 'launch' | null;

const KICKER = 'text-[10.5px] uppercase tracking-[.14em] text-bone/50';
const TAB =
  'flex-none cursor-pointer whitespace-nowrap border-0 px-[15px] py-2 text-[12.5px] font-extrabold';
const RULE = 'border-t-2 border-bone/[.26]';

let nextId = 0;
const newContact = (name = '', phoneNumber = ''): Contact => ({
  id: `draft-${nextId++}`,
  name,
  phoneNumber,
});

function errorMessage(value: unknown): string {
  if (typeof value !== 'object' || value === null) return 'The request failed.';
  const body = value as { error?: unknown; detail?: unknown; issues?: unknown };
  const summary =
    typeof body.error === 'string' ? body.error : 'The request failed.';
  const issues = Array.isArray(body.issues)
    ? body.issues.filter((item): item is string => typeof item === 'string')
    : [];
  if (!issues.length && typeof body.detail === 'string')
    issues.push(body.detail);
  return issues.length ? `${summary}: ${issues.join('; ')}` : summary;
}

function localDateTimeValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

interface CampaignBuilderProps {
  campaignId: string;
  workflowId: string;
  initialName: string;
  initialLocale: CampaignLocale;
  initialScheduledAt: string | null;
  initialContacts: Contact[];
  initialCsv: string;
  stepCount: number;
  initialStatus: CampaignStatus;
  schedulingEnabled: boolean;
  initialFailureMessage: string | null;
}

export default function CampaignBuilder({
  campaignId,
  workflowId,
  initialName,
  initialLocale,
  initialScheduledAt,
  initialContacts,
  initialCsv,
  stepCount,
  initialStatus,
  schedulingEnabled,
  initialFailureMessage,
}: CampaignBuilderProps) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [locale, setLocale] = useState<CampaignLocale>(initialLocale);
  const [scheduleLocal, setScheduleLocal] = useState(
    localDateTimeValue(initialScheduledAt),
  );
  const [contacts, setContacts] = useState(initialContacts);
  const [entry, setEntry] = useState<Entry>('rows');
  const [csv, setCsv] = useState(initialCsv);
  const [csvDragging, setCsvDragging] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvFeedback, setCsvFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [preview, setPreview] = useState<CampaignLaunchPreview | null>(null);
  const [previewApproved, setPreviewApproved] = useState(false);
  const [recipientAuthorized, setRecipientAuthorized] = useState(false);
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const campaignStatus = initialStatus;

  const locked = campaignStatus !== 'compiled';

  const resetApproval = () => {
    setPreview(null);
    setPreviewApproved(false);
    setRecipientAuthorized(false);
    setError(null);
  };

  const editContact = (id: string, patch: Partial<Contact>) => {
    resetApproval();
    setContacts((previous) =>
      previous.map((contact) =>
        contact.id === id ? { ...contact, ...patch } : contact,
      ),
    );
  };

  const extractCsvText = (text: string, source: string) => {
    setCsv(text);
    try {
      const imported = parseContactCsv(text);
      setContacts(
        imported.map((contact) =>
          newContact(contact.name, contact.phoneNumber),
        ),
      );
      setCsvFeedback({
        kind: 'success',
        message: `${imported.length} contact${imported.length === 1 ? '' : 's'} extracted from ${source}.`,
      });
      setEntry('rows');
    } catch (caught) {
      setCsvFeedback({
        kind: 'error',
        message:
          caught instanceof ContactCsvError
            ? caught.issues.join('; ')
            : 'The CSV could not be read.',
      });
      setEntry('csv');
    }
  };

  const waitForImportPaint = () =>
    new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

  const importCsvText = async (text: string, source: string) => {
    if (csvImporting) return;
    resetApproval();
    setCsvImporting(true);
    try {
      await waitForImportPaint();
      extractCsvText(text, source);
    } finally {
      setCsvImporting(false);
    }
  };

  const importCsvFile = async (file: File) => {
    if (csvImporting) return;
    resetApproval();
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvFeedback({ kind: 'error', message: 'Choose a file with a .csv extension.' });
      return;
    }
    if (file.size > MAX_CONTACT_CSV_BYTES) {
      setCsvFeedback({ kind: 'error', message: 'CSV files must be 256 KB or smaller.' });
      return;
    }

    setCsvImporting(true);
    try {
      await waitForImportPaint();
      extractCsvText(await file.text(), file.name);
    } catch {
      setCsvFeedback({ kind: 'error', message: 'The selected CSV file could not be read.' });
    } finally {
      setCsvImporting(false);
    }
  };

  const requestPreview = async () => {
    setPending('preview');
    setError(null);
    setPreviewApproved(false);
    setRecipientAuthorized(false);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          contacts,
          locale,
          scheduledAt: scheduleLocal
            ? new Date(scheduleLocal).toISOString()
            : null,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      const loaded = body as {
        contacts?: Contact[];
        preview?: CampaignLaunchPreview;
      };
      if (!Array.isArray(loaded.contacts) || !loaded.preview) {
        throw new Error('The campaign preview response was incomplete.');
      }
      setContacts(loaded.contacts);
      setCsv(
        loaded.contacts
          .map((contact) => `${contact.name}, ${contact.phoneNumber}`)
          .join('\n'),
      );
      setPreview(loaded.preview);
    } catch (caught) {
      setPreview(null);
      setError(
        caught instanceof Error ? caught.message : 'The preview failed.',
      );
    } finally {
      setPending(null);
    }
  };

  const launchCampaign = async () => {
    if (!preview || !previewApproved) return;
    setPending('launch');
    setError(null);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          approvalDigest: preview.approvalDigest,
          previewApproved: true,
          recipientAuthorizationConfirmed: recipientAuthorized,
          callCount: preview.callCount,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      router.push(`/results/${campaignId}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Campaign launch failed.',
      );
    } finally {
      setPending(null);
    }
  };

  const canLaunch =
    previewApproved &&
    (!preview?.recipientAuthorizationRequired || recipientAuthorized) &&
    pending === null;

  const rerunCampaign = async () => {
    setRerunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/rerun`, { method: 'POST' });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(errorMessage(body));
      const rerun = body as { campaignId?: unknown };
      if (typeof rerun.campaignId !== 'string') {
        throw new Error('The response did not include a campaign id.');
      }
      router.push(`/campaigns/${rerun.campaignId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Campaign could not be re-run.');
      setRerunning(false);
    }
  };

  return (
    <main className="flex-1 px-6 pb-[72px] pt-[52px] md:px-12">
      <div className="mx-auto max-w-[940px] animate-vfade">
        <div className="mb-6 inline-flex items-center gap-[9px] border border-flame/60 px-[11px] py-1.5 text-[11px] uppercase tracking-[.1em] text-blush">
          <span className="size-1.5 bg-flame" />
          {campaignStatus} · {stepCount} workflow steps · campaign{' '}
          {campaignId.slice(0, 8)}
        </div>
        <a
          href={`/workflow/${workflowId}`}
          className="mb-5 block w-fit text-xs text-bone/45 underline decoration-bone/25 underline-offset-4 hover:text-bone"
        >
          Back to workflow
        </a>

        <h1 className="mb-[34px] text-4xl font-extrabold leading-[1.08] tracking-[-.02em]">
          Launch and follow the campaign.
        </h1>

        <div className={`mb-[34px] pt-[22px] ${RULE}`}>
          <div className={`${KICKER} mb-3`}>01 · Campaign setup</div>
          <input
            value={name}
            onChange={(event) => {
              resetApproval();
              setName(event.target.value);
            }}
            disabled={locked}
            maxLength={120}
            className="w-full max-w-[520px] border border-bone/[.26] bg-panel px-3.5 py-3 text-base font-extrabold text-bone outline-none disabled:opacity-50"
          />
          <div className="mt-5 grid max-w-[700px] gap-5 md:grid-cols-2">
            <label className="text-xs text-bone/55">
              <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
                Voice &amp; language
              </span>
              <select
                value={locale}
                onChange={(event) => {
                  resetApproval();
                  setLocale(event.target.value as CampaignLocale);
                }}
                disabled={locked}
                className="w-full border border-bone/[.26] bg-panel px-3.5 py-3 text-sm text-bone outline-none disabled:opacity-50"
              >
                <option value="en-IN">Indian English (en-IN)</option>
                <option value="en-US">US English (en-US)</option>
                <option value="hi-IN">Hinglish (hi-IN)</option>
              </select>
              <span className="mt-2 block leading-5 text-bone/40">
                {locale === "hi-IN"
                  ? 'Conducts the call in Hinglish (Hindi + English, Roman script) instead of English.'
                  : 'Sent to CALL-E as the conversation locale. Indian English is the default.'}
              </span>
            </label>
            <label className="text-xs text-bone/55">
              <span className="mb-2 block font-extrabold uppercase tracking-[.1em] text-bone/65">
                Start time
              </span>
              <input
                type="datetime-local"
                value={scheduleLocal}
                onChange={(event) => {
                  resetApproval();
                  setScheduleLocal(event.target.value);
                }}
                disabled={locked || !schedulingEnabled}
                className="w-full border border-bone/[.26] bg-panel px-3.5 py-3 text-sm text-bone outline-none disabled:opacity-50"
              />
              <span className="mt-2 block leading-5 text-bone/40">
                {schedulingEnabled
                  ? 'Leave empty to launch immediately, or choose a time within seven days.'
                  : 'Immediate launch only on this deployment; scheduling is disabled.'}
              </span>
            </label>
          </div>
        </div>

        <div className={`pt-[22px] ${RULE}`}>
          <div className="mb-3.5 flex items-center justify-between gap-4">
            <div className={`${KICKER} whitespace-nowrap`}>
              02 · Contacts{' '}
              <span className="text-bone/35">({contacts.length}/10)</span>
            </div>
            {!locked ? (
              <div className="flex border border-bone/[.26]">
                {(['rows', 'csv'] as const).map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setEntry(value)}
                    className={`${TAB} ${index === 0 ? 'border-r border-bone/[.26]' : ''} ${
                      entry === value
                        ? 'bg-flame text-ink'
                        : 'bg-transparent text-bone'
                    }`}
                  >
                    {value === 'rows' ? 'Add rows' : 'Import CSV'}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {csvFeedback ? (
            <div
              role={csvFeedback.kind === 'error' ? 'alert' : 'status'}
              className={`mb-4 border p-3 text-xs leading-5 ${
                csvFeedback.kind === 'error'
                  ? 'border-red-400/50 bg-red-950/30 text-red-200'
                  : 'border-emerald-300/35 bg-emerald-950/20 text-emerald-200'
              }`}
            >
              {csvFeedback.message}
            </div>
          ) : null}

          {entry === 'rows' || locked ? (
            <div>
              <div className="grid grid-cols-[1fr_1fr_40px] gap-x-3.5 border-b border-bone/[.18] pb-2 text-[10.5px] uppercase tracking-[.12em] text-bone/40">
                <span>Name</span>
                <span>Phone number (strict E.164)</span>
                <span />
              </div>
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="grid grid-cols-[1fr_1fr_40px] items-center gap-x-3.5 border-b border-bone/[.12]"
                >
                  <input
                    value={contact.name}
                    onChange={(event) =>
                      editContact(contact.id, { name: event.target.value })
                    }
                    disabled={locked}
                    maxLength={120}
                    placeholder="Name"
                    className="border-0 bg-transparent py-3 text-sm text-bone outline-none placeholder:text-bone/25 disabled:opacity-60"
                  />
                  <input
                    value={contact.phoneNumber}
                    onChange={(event) =>
                      editContact(contact.id, {
                        phoneNumber: event.target.value,
                      })
                    }
                    disabled={locked}
                    placeholder="+14155550100"
                    className="border-0 bg-transparent py-3 font-mono text-sm text-bone/80 outline-none placeholder:text-bone/25 disabled:opacity-60"
                  />
                  {!locked ? (
                    <button
                      type="button"
                      onClick={() => {
                        resetApproval();
                        setContacts((previous) =>
                          previous.filter((item) => item.id !== contact.id),
                        );
                      }}
                      aria-label={`Remove ${contact.name || 'contact'}`}
                      className="cursor-pointer justify-self-end border-0 bg-transparent p-1 text-[15px] text-bone/35"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {!locked ? (
                <button
                  type="button"
                  onClick={() => {
                    resetApproval();
                    setContacts((previous) => [...previous, newContact()]);
                  }}
                  disabled={contacts.length >= 10}
                  className="mt-3.5 cursor-pointer border border-bone/[.26] bg-transparent px-3.5 py-[9px] text-[13px] text-bone hover:bg-bone/[.07] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  + Add row
                </button>
              ) : null}
            </div>
          ) : (
            <div>
              <div
                onDragEnter={(event) => {
                  event.preventDefault();
                  setCsvDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'copy';
                  setCsvDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setCsvDragging(false);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setCsvDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file && !csvImporting) void importCsvFile(file);
                }}
                className={`mb-3 border border-dashed px-5 py-7 text-center transition-colors ${
                  csvDragging
                    ? 'border-flame bg-flame/[.08]'
                    : 'border-bone/[.3] bg-panel'
                }`}
              >
                <div className="flex items-center justify-center gap-2 text-sm font-extrabold text-bone">
                  {csvImporting ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-bone/25 border-t-flame" />
                  ) : null}
                  {csvImporting ? 'Extracting contacts…' : 'Drop a contact CSV here'}
                </div>
                <div className="mt-1 text-xs leading-5 text-bone/45">
                  Finds Name and Phone columns and ignores the rest · maximum 10 contacts
                </div>
                <label className={`mt-4 inline-flex border border-bone/[.26] px-3.5 py-[9px] text-[13px] text-bone ${
                  csvImporting ? 'cursor-wait opacity-50' : 'cursor-pointer hover:bg-bone/[.07]'
                }`}>
                  Choose CSV file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={csvImporting}
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      if (file) void importCsvFile(file);
                    }}
                  />
                </label>
              </div>
              <textarea
                value={csv}
                disabled={csvImporting}
                onChange={(event) => {
                  resetApproval();
                  setCsv(event.target.value);
                  setCsvFeedback(null);
                }}
                placeholder={"Name,Phone\nMarta Reyes,+14155550100"}
                className="min-h-[170px] w-full resize-y border border-bone/[.26] bg-panel p-3.5 font-mono text-[13px] leading-[1.7] text-bone outline-none placeholder:text-bone/25"
              />
              <div className="mt-3 flex items-center gap-3.5">
                <button
                  type="button"
                  onClick={() => void importCsvText(csv, 'pasted CSV')}
                  disabled={!csv.trim() || csvImporting}
                  className="inline-flex cursor-pointer items-center gap-2 border border-bone/[.26] bg-transparent px-3.5 py-[9px] text-[13px] text-bone hover:bg-bone/[.07] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {csvImporting ? (
                    <span className="size-3.5 animate-spin rounded-full border-2 border-bone/25 border-t-flame" />
                  ) : null}
                  {csvImporting ? 'Extracting…' : 'Extract contacts'}
                </button>
                <span className="text-xs text-bone/40">
                  Phone numbers must use strict E.164 format
                </span>
              </div>
            </div>
          )}
        </div>

        {!locked ? (
          <div className={`mt-10 pt-6 ${RULE}`}>
            <div className={`${KICKER} mb-3`}>03 · Exact campaign preview</div>
            <p className="mb-4 max-w-[700px] text-[13px] leading-6 text-bone/55">
              Every contact is saved and independently compiled. The final
              approval covers every masked recipient, personalized task, result
              schema, and the exact call count. Editing anything invalidates it.
            </p>
            <button
              type="button"
              onClick={requestPreview}
              disabled={!contacts.length || pending !== null}
              className="inline-flex cursor-pointer items-center gap-2.5 border-0 bg-flame px-5 py-[13px] text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pending === 'preview'
                ? 'Compiling every call…'
                : 'Compile and preview campaign'}
            </button>

            {preview ? (
              <section className="mt-6 border border-bone/[.26] bg-panel p-5">
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <span className="bg-blush px-2 py-1 text-[11px] font-extrabold uppercase tracking-[.1em] text-ink">
                    {preview.mode} mode
                  </span>
                  <span className="text-sm text-bone/75">
                    exactly {preview.callCount} call
                    {preview.callCount === 1 ? '' : 's'}
                  </span>
                  <span className="text-sm text-bone/75">
                    {preview.localeLabel} ({preview.locale})
                  </span>
                  <span className="text-sm text-bone/75">
                    {preview.scheduledAt
                      ? `scheduled ${new Date(preview.scheduledAt).toLocaleString()}`
                      : 'launch immediately'}
                  </span>
                </div>

                <div className="space-y-3">
                  {preview.recipients.map((recipient, index) => (
                    <details
                      key={recipient.contactId}
                      className="border border-bone/[.16] bg-ink p-3"
                    >
                      <summary className="cursor-pointer text-sm font-extrabold text-bone/80">
                        {index + 1}. {recipient.name} ·{' '}
                        <span className="font-mono font-normal">
                          {recipient.maskedPhone}
                        </span>
                      </summary>
                      <div className={`${KICKER} mb-2 mt-4`}>Exact task</div>
                      <pre className="max-h-52 overflow-auto whitespace-pre-wrap text-xs leading-5 text-bone/65">
                        {recipient.task}
                      </pre>
                      <div className={`${KICKER} mb-2 mt-4`}>
                        Exact result schema
                      </div>
                      <pre className="max-h-52 overflow-auto text-xs leading-5 text-bone/65">
                        {JSON.stringify(recipient.resultSchema, null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>

                <div className={`${KICKER} mb-2 mt-5`}>Side effects</div>
                <ul className="space-y-1 text-sm text-bone/65">
                  {preview.sideEffects.map((effect) => (
                    <li key={effect}>— {effect}</li>
                  ))}
                </ul>

                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm text-bone/75">
                  <input
                    type="checkbox"
                    checked={previewApproved}
                    onChange={(event) =>
                      setPreviewApproved(event.target.checked)
                    }
                    className="mt-0.5 size-4 accent-[#ff6a3d]"
                  />
                  I reviewed every recipient, task, schema, side effect, and the
                  exact {preview.callCount}-call count.
                </label>

                {preview.recipientAuthorizationRequired ? (
                  <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-bone/75">
                    <input
                      type="checkbox"
                      checked={recipientAuthorized}
                      onChange={(event) =>
                        setRecipientAuthorized(event.target.checked)
                      }
                      className="mt-0.5 size-4 accent-[#ff6a3d]"
                    />
                    Every displayed recipient explicitly authorized the exact
                    live test call to their number.
                  </label>
                ) : null}

                <button
                  type="button"
                  onClick={launchCampaign}
                  disabled={!canLaunch}
                  className="mt-5 cursor-pointer border border-flame bg-transparent px-5 py-3 text-sm font-extrabold text-blush disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pending === 'launch'
                    ? 'Submitting each call once…'
                    : preview.mode === 'fake'
                      ? `Run ${preview.callCount} fake call${preview.callCount === 1 ? '' : 's'}`
                      : preview.scheduledAt
                        ? `Approve and schedule ${preview.callCount} live call${preview.callCount === 1 ? '' : 's'}`
                        : `Place ${preview.callCount} live call${preview.callCount === 1 ? '' : 's'}`}
                </button>
              </section>
            ) : null}
          </div>
        ) : (
          <div className={`mt-10 pt-6 ${RULE}`}>
            <div className={`${KICKER} mb-3`}>03 · This campaign is locked</div>
            <p className="mb-4 max-w-[700px] text-[13px] leading-6 text-bone/55">
              {campaignStatus === 'reconciliation_required'
                ? 'Calling is paused because a submission may have reached CALL-E. Do not re-run this campaign until the provider outcome has been reconciled.'
                : campaignStatus === 'failed'
                ? "This campaign didn't complete. Re-run it to try the same workflow and contacts again."
                : 'This campaign has already been submitted and can no longer be edited or launched again. Re-run it to start a fresh copy with the same workflow and contacts.'}
            </p>
            <div className="flex flex-wrap items-center gap-3.5">
              {campaignStatus !== 'reconciliation_required' ? (
                <button
                  type="button"
                  onClick={rerunCampaign}
                  disabled={rerunning}
                  className="inline-flex cursor-pointer items-center gap-2.5 border-0 bg-flame px-5 py-[13px] text-sm font-extrabold text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {rerunning ? 'Setting up a new campaign…' : 'Re-run campaign'}
                </button>
              ) : null}
              <a
                href={`/results/${campaignId}`}
                className="text-[12px] font-extrabold text-bone/70 underline decoration-bone/25 underline-offset-4"
              >
                View results
              </a>
            </div>
          </div>
        )}

        {error ? (
          <div
            role="alert"
            className="mt-5 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200"
          >
            {error}
          </div>
        ) : null}

        {initialFailureMessage &&
        (campaignStatus === 'failed' || campaignStatus === 'reconciliation_required') ? (
          <div
            role="alert"
            className="mt-5 border border-red-400/50 bg-red-950/30 p-3 text-sm text-red-200"
          >
            {initialFailureMessage}
          </div>
        ) : null}
      </div>
    </main>
  );
}
