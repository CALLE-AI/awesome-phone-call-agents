"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type RefObject } from "react";
import { FileText, Globe, Pause, Play, Plus, Send, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { goalFromSentence } from "@/lib/brain/goals";
import { newEntityId } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { HACKATHON_RETRY_LOCKED } from "@/lib/calle/retry-lock";
import type { BrainConfig, BrainGoal, BrainSuggestion } from "@/lib/types";

const ACCEPTED_FILES = ".txt,.md,.markdown,.html,.htm,.csv,.json";
const MAX_INGEST_FILE_BYTES = 400_000;
const brainHeadingClass = "text-lg font-semibold tracking-tight text-foreground";
const MIN_RETRY_DELAY_HOURS = 0.25;
const MAX_RETRY_DELAY_HOURS = 48;

const RETRY_PRESETS = [
  { value: "skip", hours: null as number | null, label: "Don't retry" },
  { value: "0.25", hours: 0.25, label: "15 minutes" },
  { value: "1", hours: 1, label: "1 hour" },
  { value: "4", hours: 4, label: "4 hours" },
  { value: "24", hours: 24, label: "24 hours" }
];

function retrySelectValue(hours: number | null | undefined): string {
  if (hours == null) return "skip";
  const match = RETRY_PRESETS.find((preset) => preset.hours === hours);
  return match ? match.value : "custom";
}

function sourceWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function focusOnMount(node: HTMLInputElement | HTMLTextAreaElement | null) {
  node?.focus();
}

type ChatItem = { id: string; role: "user" | "assistant"; text: string };

export function BrainPanel({
  initial,
  geminiConfigured
}: {
  initial: BrainConfig;
  geminiConfigured: boolean;
}) {
  const [config, setConfig] = useState<BrainConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [intentDraft, setIntentDraft] = useState("");
  const [copilotDraft, setCopilotDraft] = useState("");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [chat, setChat] = useState<ChatItem[]>([
    {
      id: "intro",
      role: "assistant",
      text: geminiConfigured
        ? "I drafted this brief from company sources. Edit any section, or tell me what to change."
        : "I drafted this brief from company sources. Edit any section, or tell me what to change — try “retry in 2 hours” or “add a goal for budget”."
    }
  ]);
  const fileRef = useRef<HTMLInputElement>(null);

  const persist = async (next: BrainConfig) => {
    setConfig(next);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sundials/console/brain", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: next })
      });
      if (!res.ok) throw new Error("Could not save Brain settings");
      const body = (await res.json()) as { config?: BrainConfig };
      if (body.config) setConfig(body.config);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save Brain settings");
    } finally {
      setSaving(false);
    }
  };

  const ingest = async (payload: { kind: "url"; url: string } | { kind: "file"; fileName: string; text: string }) => {
    setIngesting(true);
    setError(null);
    try {
      const res = await fetch("/api/sundials/console/brain/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = (await res.json()) as { success?: boolean; message?: string; config?: BrainConfig };
      if (!res.ok || !body.config) throw new Error(body.message || "Could not draft from that source");
      setConfig(body.config);
      setChat((items) => [
        ...items,
        {
          id: newEntityId(),
          role: "assistant",
          text: `Updated the qualification report from ${payload.kind === "url" ? payload.url : payload.fileName}.`
        }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft from that source");
    } finally {
      setIngesting(false);
    }
  };

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (file.size > MAX_INGEST_FILE_BYTES) {
      setError("File is too large (400 KB max).");
      return;
    }
    const text = await file.text();
    await ingest({ kind: "file", fileName: file.name, text });
  };

  const sendCopilot = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = copilotDraft.trim();
    if (!message || copilotBusy) return;
    setCopilotDraft("");
    setCopilotBusy(true);
    setError(null);
    const userItem: ChatItem = { id: newEntityId(), role: "user", text: message };
    setChat((items) => [...items, userItem]);
    try {
      const res = await fetch("/api/sundials/console/brain/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, config })
      });
      const body = (await res.json()) as { success?: boolean; message?: string; reply?: string; config?: BrainConfig };
      if (!res.ok) throw new Error(body.message || "Copilot could not apply that");
      if (body.config) setConfig(body.config);
      setChat((items) => [
        ...items,
        { id: newEntityId(), role: "assistant", text: body.reply || "Updated the brief." }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Copilot could not apply that");
    } finally {
      setCopilotBusy(false);
    }
  };

  const applySuggestion = async (suggestion: BrainSuggestion): Promise<boolean> => {
    setCopilotBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sundials/console/brain/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suggestionId: suggestion.id, config })
      });
      const body = (await res.json()) as { success?: boolean; message?: string; reply?: string; config?: BrainConfig };
      if (!res.ok) throw new Error(body.message || "Could not apply that proposal");
      if (body.config) setConfig(body.config);
      setChat((items) => [...items, { id: newEntityId(), role: "assistant", text: body.reply || `Applied “${suggestion.title}”.` }]);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply that proposal");
      return false;
    } finally {
      setCopilotBusy(false);
    }
  };

  const dismissSuggestion = (id: string) => {
    void persist({ ...config, suggestions: config.suggestions.filter((item) => item.id !== id) });
  };

  const addIntent = () => {
    const goal = goalFromSentence(intentDraft);
    if (!goal) return;
    if (config.goals.some((item) => item.targetField.toLowerCase() === goal.targetField.toLowerCase())) {
      setError(`“${goal.label}” is already a listening intent.`);
      return;
    }
    setIntentDraft("");
    void persist({ ...config, goals: [...config.goals, goal] });
  };

  const busy = saving || ingesting || copilotBusy;
  const reportUpdating = ingesting || copilotBusy;

  return (
    <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <div className="relative space-y-6" aria-busy={reportUpdating}>
        <h1 className="sr-only">Brain</h1>
        <p className="sr-only" aria-live="polite">
          {reportUpdating ? "Updating report…" : saving ? "Saving…" : ""}
        </p>

        <div className={cn("space-y-6", reportUpdating && "pointer-events-none select-none")}>
          <SourcesCard
            config={config}
            url={url}
            dragging={dragging}
            busy={busy}
            ingesting={ingesting}
            fileRef={fileRef}
            setUrl={setUrl}
            setDragging={setDragging}
            onIngestUrl={() => {
              if (!url.trim()) return;
              void ingest({ kind: "url", url: url.trim() });
            }}
            onFiles={onFiles}
            onRemoveSource={(id) => void persist({ ...config, sources: config.sources.filter((source) => source.id !== id) })}
          />

          <ReportCard
            config={config}
            busy={busy}
            intentDraft={intentDraft}
            setIntentDraft={setIntentDraft}
            onSave={(patch) => void persist({ ...config, ...patch })}
            onToggleGoal={(goal) =>
              void persist({
                ...config,
                goals: config.goals.map((item) => (item.id === goal.id ? { ...item, enabled: !item.enabled } : item))
              })
            }
            onRemoveGoal={(id) => void persist({ ...config, goals: config.goals.filter((goal) => goal.id !== id) })}
            onAddIntent={addIntent}
          />

          <CallPolicyCard
            config={config}
            busy={busy}
            onRetry={(hours) => void persist({ ...config, retryDelayHours: hours })}
            onOpeningChange={(openingScript) => setConfig({ ...config, openingScript })}
            onOpeningCommit={(openingScript) => void persist({ ...config, openingScript })}
            onClosingChange={(closingScript) => setConfig({ ...config, closingScript })}
            onClosingCommit={(closingScript) => void persist({ ...config, closingScript })}
          />
        </div>

        {reportUpdating ? <ReportUpdatingOverlay /> : null}

        {error ? (
          <p className="relative z-30 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <aside className="min-h-[28rem] xl:sticky xl:top-8 xl:h-[calc(100svh-4rem)] xl:min-h-0">
        <CopilotCard
          geminiConfigured={geminiConfigured}
          suggestions={config.suggestions}
          chat={chat}
          draft={copilotDraft}
          busy={busy}
          copilotBusy={copilotBusy}
          setDraft={setCopilotDraft}
          onSubmit={sendCopilot}
          onApply={(suggestion) => applySuggestion(suggestion)}
          onDismiss={dismissSuggestion}
        />
      </aside>
    </div>
  );
}

function SourcesCard({
  config,
  url,
  dragging,
  busy,
  ingesting,
  fileRef,
  setUrl,
  setDragging,
  onIngestUrl,
  onFiles,
  onRemoveSource
}: {
  config: BrainConfig;
  url: string;
  dragging: boolean;
  busy: boolean;
  ingesting: boolean;
  fileRef: RefObject<HTMLInputElement | null>;
  setUrl: (value: string) => void;
  setDragging: (value: boolean) => void;
  onIngestUrl: () => void;
  onFiles: (files: FileList | null) => void;
  onRemoveSource: (id: string) => void;
}) {
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    void onFiles(event.dataTransfer.files);
  };

  return (
    <Card className="[--card-spacing:1.5rem]">
      <CardHeader className="gap-2">
        <CardTitle className={brainHeadingClass}>Sources</CardTitle>
        <CardDescription>
          Paste a site or drop a file. Brain scrapes company copy and redrafts the qualification report.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="grid gap-2">
            <Label htmlFor="brain-url">Website</Label>
            <Input
              id="brain-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https:// or /demo"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onIngestUrl();
                }
              }}
            />
          </div>
          <Button type="button" disabled={busy || !url.trim()} onClick={onIngestUrl}>
            <Globe />
            Draft from site
          </Button>
        </div>

        <label
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "flex min-h-[7.5rem] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
            dragging ? "border-primary bg-accent" : "border-input hover:border-primary/60 hover:bg-muted/40"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            className="sr-only"
            accept={ACCEPTED_FILES}
            disabled={busy}
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <Upload className="size-5 text-muted-foreground" aria-hidden />
          <span className="text-sm font-medium">Drop a company file, or browse</span>
          <span className="text-xs text-muted-foreground">TXT, MD, HTML, CSV, or JSON · 400 KB max</span>
        </label>

        {config.sources.length ? (
          <ul className="divide-y rounded-xl border">
            {config.sources.map((source) => (
              <li key={source.id} className="flex items-start gap-3 px-3 py-3">
                {source.kind === "url" ? (
                  <Globe className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <p className="text-sm font-medium">{source.label}</p>
                    <p className="text-xs text-muted-foreground">{sourceWhen(source.ingestedAt)}</p>
                  </div>
                  {source.excerpt ? <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{source.excerpt}</p> : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove ${source.label}`}
                  onClick={() => onRemoveSource(source.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {ingesting ? "Reading source…" : "No sources yet — add a site or file to draft the report."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportCard({
  config,
  busy,
  intentDraft,
  setIntentDraft,
  onSave,
  onToggleGoal,
  onRemoveGoal,
  onAddIntent
}: {
  config: BrainConfig;
  busy: boolean;
  intentDraft: string;
  setIntentDraft: (value: string) => void;
  onSave: (patch: Partial<Pick<BrainConfig, "productName" | "companyAbout" | "qualificationReport">>) => void;
  onToggleGoal: (goal: BrainGoal) => void;
  onRemoveGoal: (id: string) => void;
  onAddIntent: () => void;
}) {
  return (
    <article className="rounded-xl bg-card px-6 py-8 ring-1 ring-foreground/10 sm:px-10 sm:py-10">
      <p className={cn(brainHeadingClass, "mb-6")}>Qualification report</p>
      <ReportField
        id="productName"
        label="Product name"
        value={config.productName}
        disabled={busy}
        displayClassName="font-[family-name:var(--font-harbor-serif)] text-4xl leading-tight tracking-tight md:text-4xl"
        onSave={(productName) => onSave({ productName })}
      />
      <div className="mt-8 space-y-3">
        <p className={brainHeadingClass}>About</p>
        <ReportField
          id="companyAbout"
          label="Company summary"
          value={config.companyAbout}
          disabled={busy}
          multiline
          displayClassName="text-base leading-relaxed text-foreground/90 md:text-base"
          onSave={(companyAbout) => onSave({ companyAbout })}
        />
      </div>
      <div className="mt-10 space-y-3">
        <p className={brainHeadingClass}>Directive</p>
        <ReportField
          id="qualificationReport"
          label="Qualification directive"
          value={config.qualificationReport}
          disabled={busy}
          multiline
          displayClassName="text-base leading-relaxed text-foreground/90 md:text-base"
          onSave={(qualificationReport) => onSave({ qualificationReport })}
        />
      </div>

      <div className="mt-10 space-y-4">
        <div>
          <p className={brainHeadingClass}>Listening for</p>
          <p className="mt-1 text-sm text-muted-foreground">Intents CALL-E picks up when they come up — not a scripted checklist.</p>
        </div>
        <ul className="space-y-2">
          {config.goals.map((goal) => (
            <li
              key={goal.id}
              className={cn(
                "flex items-start gap-3 rounded-xl border px-3 py-3",
                goal.enabled ? "bg-background" : "opacity-60"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{goal.label}</p>
                {goal.guidance ? <p className="mt-1 text-sm text-muted-foreground">{goal.guidance}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => onToggleGoal(goal)}
                >
                  {goal.enabled ? <Pause /> : <Play />}
                  {goal.enabled ? "Pause" : "Resume"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove ${goal.label}`}
                  onClick={() => onRemoveGoal(goal.id)}
                >
                  <X />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="grid min-w-0 flex-1 gap-2">
            <Label htmlFor="new-intent" className="sr-only">
              New listening intent
            </Label>
            <Input
              id="new-intent"
              placeholder="e.g. Budget range, data migration, security review"
              value={intentDraft}
              disabled={busy}
              onChange={(event) => setIntentDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddIntent();
                }
              }}
            />
          </div>
          <Button type="button" variant="outline" disabled={busy || !intentDraft.trim()} onClick={onAddIntent}>
            <Plus />
            Add intent
          </Button>
        </div>
      </div>

      {(config.painCategories || []).length ? (
        <div className="mt-10 space-y-3">
          <p className={brainHeadingClass}>Pain categories from calls</p>
          <div className="flex flex-wrap gap-2">
            {(config.painCategories || []).map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function ReportField({
  id,
  label,
  value,
  disabled,
  multiline,
  displayClassName,
  onSave
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  multiline?: boolean;
  displayClassName: string;
  onSave: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== value.trim()) onSave(draft);
  };

  if (editing) {
    return (
      <div className="grid gap-2">
        <Label htmlFor={id} className="sr-only">
          {label}
        </Label>
        {multiline ? (
          <Textarea
            id={id}
            rows={6}
            disabled={disabled}
            value={draft}
            ref={focusOnMount}
            className={cn("min-h-32 md:text-base", displayClassName)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        ) : (
          <Input
            id={id}
            disabled={disabled}
            value={draft}
            ref={focusOnMount}
            className={cn("h-auto py-1", displayClassName)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              }
              if (event.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className="block w-full rounded-lg text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={`Edit ${label}`}
    >
      {value.trim() ? (
        <p className={cn("whitespace-pre-wrap", displayClassName)}>{value}</p>
      ) : (
        <p className="text-sm text-muted-foreground">Add {label.toLowerCase()}</p>
      )}
    </button>
  );
}

function CallPolicyCard({
  config,
  busy,
  onRetry,
  onOpeningChange,
  onOpeningCommit,
  onClosingChange,
  onClosingCommit
}: {
  config: BrainConfig;
  busy: boolean;
  onRetry: (hours: number | null) => void;
  onOpeningChange: (script: string) => void;
  onOpeningCommit: (script: string) => void;
  onClosingChange: (script: string) => void;
  onClosingCommit: (script: string) => void;
}) {
  const selected = retrySelectValue(config.retryDelayHours);
  const retryLocked = HACKATHON_RETRY_LOCKED;
  const [retryError, setRetryError] = useState<string | null>(null);
  const [customHours, setCustomHours] = useState(
    selected === "custom" && typeof config.retryDelayHours === "number" ? String(config.retryDelayHours) : "2"
  );

  return (
    <Card className="[--card-spacing:1.5rem]">
      <CardHeader className="gap-2">
        <CardTitle className={brainHeadingClass}>Call policy</CardTitle>
        <CardDescription>Operational knobs for the next ring.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-2">
          <Label htmlFor="retry-delay">Failed-call retry</Label>
          <Select
            value={selected}
            disabled={busy}
            onValueChange={(value) => {
              if (retryLocked) return;
              setRetryError(null);
              if (value === "custom") {
                const hours = Number(customHours);
                const next =
                  Number.isFinite(hours) && hours >= MIN_RETRY_DELAY_HOURS && hours <= MAX_RETRY_DELAY_HOURS
                    ? hours
                    : 2;
                setCustomHours(String(next));
                onRetry(next);
                return;
              }
              const preset = RETRY_PRESETS.find((item) => item.value === value);
              onRetry(preset ? preset.hours : null);
            }}
          >
            <SelectTrigger id="retry-delay" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETRY_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value} disabled={retryLocked || busy}>
                  {preset.label}
                </SelectItem>
              ))}
              <SelectItem value="custom" disabled={retryLocked || busy}>
                Custom hours
              </SelectItem>
            </SelectContent>
          </Select>
          {selected === "custom" && !retryLocked ? (
            <div className="grid gap-2">
              <Label htmlFor="retry-custom">Hours until one follow-up ring</Label>
              <Input
                id="retry-custom"
                type="number"
                min={MIN_RETRY_DELAY_HOURS}
                max={MAX_RETRY_DELAY_HOURS}
                step={0.25}
                value={customHours || (typeof config.retryDelayHours === "number" ? String(config.retryDelayHours) : "")}
                disabled={busy}
                onChange={(event) => {
                  setCustomHours(event.target.value);
                  const hours = Number(event.target.value);
                  if (Number.isFinite(hours) && hours >= MIN_RETRY_DELAY_HOURS && hours <= MAX_RETRY_DELAY_HOURS) {
                    setRetryError(null);
                  }
                }}
                onBlur={() => {
                  const hours = Number(customHours);
                  if (!Number.isFinite(hours) || hours < MIN_RETRY_DELAY_HOURS || hours > MAX_RETRY_DELAY_HOURS) {
                    setRetryError(`Use ${MIN_RETRY_DELAY_HOURS}–${MAX_RETRY_DELAY_HOURS} hours, or choose Don’t retry.`);
                    return;
                  }
                  setRetryError(null);
                  onRetry(hours);
                }}
              />
            </div>
          ) : null}
          {retryError ? (
            <p className="text-sm text-destructive" role="alert">
              {retryError}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Locked for this hackathon demo. Failed and no-speech outcomes stay in the inbox for
              reconciliation — Sundials will not schedule another call.
            </p>
          )}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="opening-script">Opening script</Label>
          <Textarea
            id="opening-script"
            rows={5}
            disabled={busy}
            value={config.openingScript}
            className="text-base leading-relaxed md:text-base"
            onChange={(event) => onOpeningChange(event.target.value)}
            onBlur={() => onOpeningCommit(config.openingScript)}
          />
          <p className="text-xs text-muted-foreground">
            First spoken lines. Disclose that this is an automated assistant and that the call may be recorded.
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="closing-script">Closing script</Label>
          <Textarea
            id="closing-script"
            rows={4}
            disabled={busy}
            value={config.closingScript}
            className="text-base leading-relaxed md:text-base"
            onChange={(event) => onClosingChange(event.target.value)}
            onBlur={() => onClosingCommit(config.closingScript)}
          />
          <p className="text-xs text-muted-foreground">
            Last one or two sentences. Thank them and leave a warm impression. Do not promise a person will call back.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function ReportUpdatingOverlay() {
  return (
    <div className="absolute inset-0 z-20 rounded-xl bg-background/70 backdrop-blur-[2px]">
      <div className="sticky top-[28vh] flex justify-center px-4 py-6">
        <div
          className="flex min-w-[16rem] flex-col items-center gap-3 rounded-xl bg-card px-5 py-4 ring-1 ring-foreground/10"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm font-medium">Updating report…</p>
          <div className="h-1 w-36 overflow-hidden rounded-full bg-primary/20">
            <div className="sd-indeterminate-bar h-full w-1/3 rounded-full bg-primary" />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProposalDeck({
  suggestions,
  busy,
  onApply,
  onDismiss
}: {
  suggestions: BrainSuggestion[];
  busy: boolean;
  onApply: (suggestion: BrainSuggestion) => Promise<boolean>;
  onDismiss: (id: string) => void;
}) {
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<BrainSuggestion | null>(null);
  const cycled = useRef(false);
  const exitTimer = useRef<number>(0);

  useEffect(() => {
    if (outgoingId && !suggestions.some((item) => item.id === outgoingId)) {
      setOutgoingId(null);
    }
  }, [suggestions, outgoingId]);

  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const rest = suggestions.filter((item) => item.id !== outgoingId && item.id !== leaving?.id);
  const front = leaving ?? rest[0];
  const stacked = leaving ? rest.slice(0, 2) : rest.slice(1, 3);
  const queueCount = rest.length + (leaving ? 1 : 0);

  if (!front) return null;

  const advance = (kind: "apply" | "dismiss") => {
    if (leaving || busy) return;
    const card = front;
    let cancelled = false;
    setLeaving(card);
    if (kind === "apply") {
      void onApply(card).then((ok) => {
        if (ok) return;
        cancelled = true;
        window.clearTimeout(exitTimer.current);
        setLeaving(null);
        setOutgoingId(null);
      });
    }
    exitTimer.current = window.setTimeout(() => {
      if (cancelled) return;
      cycled.current = true;
      setOutgoingId(card.id);
      setLeaving(null);
      if (kind === "dismiss") onDismiss(card.id);
    }, 220);
  };

  return (
    <div className="shrink-0 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={brainHeadingClass}>Proposals</p>
        {queueCount > 1 ? <p className="text-xs text-accent-foreground/80">{queueCount} in queue</p> : null}
      </div>
      <div className={cn("relative", stacked.length ? "pb-10" : undefined)}>
        <div className="relative">
          {stacked.map((item, index) => (
            <div
              key={item.id}
              aria-hidden
              className="absolute rounded-[10px] border border-primary/30 bg-card shadow-[0_8px_18px_rgba(196,78,22,0.1)]"
              style={{
                top: 0,
                bottom: -16 * (index + 1),
                left: 10 * (index + 1),
                right: 10 * (index + 1),
                zIndex: stacked.length - index
              }}
            />
          ))}
          <article
            key={front.id}
            className={cn(
              "relative z-10 space-y-3 rounded-[10px] border border-primary/40 border-l-[3px] border-l-primary bg-card p-4 shadow-[0_12px_28px_rgba(196,78,22,0.16)] transition duration-200 ease-out",
              cycled.current && !leaving && "animate-in fade-in slide-in-from-bottom-3 duration-200",
              leaving?.id === front.id && "translate-y-3 scale-[0.98] opacity-0"
            )}
          >
            <div>
              <p className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Proposal</p>
              <p className="mt-1 text-sm font-medium">{front.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{front.reason}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" disabled={busy || Boolean(leaving)} onClick={() => advance("apply")}>
                Apply proposal
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || Boolean(leaving)}
                onClick={() => advance("dismiss")}
              >
                Dismiss
              </Button>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}

function CopilotCard({
  geminiConfigured,
  suggestions,
  chat,
  draft,
  busy,
  copilotBusy,
  setDraft,
  onSubmit,
  onApply,
  onDismiss
}: {
  geminiConfigured: boolean;
  suggestions: BrainSuggestion[];
  chat: ChatItem[];
  draft: string;
  busy: boolean;
  copilotBusy: boolean;
  setDraft: (value: string) => void;
  onSubmit: (event?: FormEvent) => void;
  onApply: (suggestion: BrainSuggestion) => Promise<boolean>;
  onDismiss: (id: string) => void;
}) {
  return (
    <Card className="h-full min-h-0 bg-primary/10 ring-1 ring-primary/30 [--card-spacing:1.25rem] dark:bg-accent">
      <CardHeader className="shrink-0 gap-2">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Image
            src="/sundials-mark.png"
            alt=""
            width={30}
            height={30}
            unoptimized
            className="size-7 object-contain"
          />
          Sundials Copilot
        </CardTitle>
        <CardDescription className="text-accent-foreground/80">
          {geminiConfigured
            ? "Rewrites the report and call policy from your notes."
            : "Works from short commands without Gemini. Add GEMINI_API_KEY for fuller drafts."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        {suggestions.length ? (
          <ProposalDeck suggestions={suggestions} busy={busy} onApply={onApply} onDismiss={onDismiss} />
        ) : null}

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {chat.map((item) => (
            <div key={item.id} className={cn("flex", item.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-[6px] px-3 py-2 text-sm leading-relaxed",
                  item.role === "user" ? "w-fit bg-primary text-primary-foreground" : "bg-card ring-1 ring-foreground/10"
                )}
              >
                {item.text}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={onSubmit} className="grid shrink-0 gap-2">
          <Textarea
            id="copilot-message"
            rows={3}
            disabled={busy}
            value={draft}
            className="bg-card md:text-base"
            placeholder="retry in 2 hours, add a goal for security review…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          <Button type="submit" disabled={busy || !draft.trim()}>
            <Send />
            {copilotBusy ? "Sending…" : "Send to Copilot"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
