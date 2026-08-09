import { z } from "zod";

export const storedPreviewSchema = z.object({
  previewId: z.string().uuid(),
  companyId: z.string().uuid(),
  companyVersion: z.number().int().nonnegative(),
  companyName: z.string().min(1).max(80),
  memberId: z.string().uuid(),
  mode: z.enum(["deposit", "catchup", "ask"]),
  provider: z.enum(["demo", "calle"]),
  requestedBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  task: z.string().min(20).max(30_000),
  contextVersion: z.number().int().nonnegative(),
  recipient: z.object({
    displayName: z.string().min(1).max(180),
    region: z.string().min(2).max(2),
    locale: z.string().min(2).max(35),
    timezone: z.string().min(1).max(120),
    quietHoursStart: z.string().nullable(),
    quietHoursEnd: z.string().nullable(),
    phoneLastFour: z.string().length(4),
  }),
  metadata: z.object({
    workflow: z.literal("asyncfounders"),
    company_id: z.string().uuid(),
    session_id: z.string().uuid(),
    schema_version: z.literal("async-memory-v3"),
  }),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  maskedPhone: z.string(),
  purpose: z.string(),
  questions: z.array(z.string()),
  duration: z.string(),
});

export type StoredPreview = z.infer<typeof storedPreviewSchema>;
export type PreviewCore = Omit<StoredPreview, "fingerprint" | "maskedPhone" | "purpose" | "questions" | "duration">;

export function fingerprintInput(preview: PreviewCore, phone: string) {
  return {
    schemaVersion: "async-call-preview-v3",
    previewId: preview.previewId,
    requestedBy: preview.requestedBy,
    createdAt: preview.createdAt,
    expiresAt: preview.expiresAt,
    company: { id: preview.companyId, name: preview.companyName, version: preview.companyVersion },
    mode: preview.mode,
    provider: preview.provider,
    task: preview.task,
    resultSchemaVersion: "async-memory-v3",
    recipient: { memberId: preview.memberId, ...preview.recipient, phone },
    metadata: preview.metadata,
  };
}

function minutes(value: string) {
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const result = Number(match[1]) * 60 + Number(match[2]);
  return result >= 0 && result < 1440 ? result : null;
}

export function recipientQuietHours(input: { timezone: string; start: string | null; end: string | null }, now = new Date()) {
  if (!input.start || !input.end) return { quiet: false, localTime: null };
  const start = minutes(input.start);
  const end = minutes(input.end);
  if (start === null || end === null) return { quiet: true, localTime: null };
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: input.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return { quiet: true, localTime: null };
    const current = hour * 60 + minute;
    const quiet = start === end || (start < end ? current >= start && current < end : current >= start || current < end);
    return { quiet, localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  } catch {
    return { quiet: true, localTime: null };
  }
}

type MemoryContext = { version: number; kind: string; title: string; body: string; status: string; confidence: number; source_excerpt: string | null };

function formatMemory(item: MemoryContext) {
  const evidence = item.source_excerpt ? ` Evidence: ${item.source_excerpt}` : "";
  return `[v${item.version} · ${item.kind} · ${item.status} · confidence ${Number(item.confidence).toFixed(2)}] ${item.title}: ${item.body}${evidence}`;
}

export function approvedCallContext(mode: "deposit" | "catchup" | "ask", memories: MemoryContext[], lastBriefedVersion: number) {
  if (mode === "catchup") {
    const unseen = memories.filter((item) => item.version > lastBriefedVersion).sort((left, right) => left.version - right.version);
    if (!unseen.length) return { briefing: null, reason: "There are no unseen company updates to brief yet.", contextVersion: lastBriefedVersion };
    const heading = "Approved unseen company memory:\n";
    const included: MemoryContext[] = [];
    let briefing = heading;
    for (const item of unseen.slice(0, 30)) {
      const line = `${included.length ? "\n" : ""}${formatMemory(item)}`;
      if (briefing.length + line.length > 14_000) break;
      briefing += line;
      included.push(item);
    }
    if (!included.length) return { briefing: null, reason: "The next unseen update is too large for a safe call briefing.", contextVersion: lastBriefedVersion };
    return { briefing, reason: null, contextVersion: Math.max(...included.map((item) => item.version)) };
  }
  if (mode === "ask") {
    const question = memories.find((item) => item.kind === "question" && !["answered", "resolved", "dismissed", "superseded"].includes(item.status));
    if (!question) return { briefing: null, reason: "There is no unresolved company question to ask yet.", contextVersion: lastBriefedVersion };
    return { briefing: `Approved unresolved company question:\n${formatMemory(question)}`, reason: null, contextVersion: question.version };
  }
  const recent = memories.slice(0, 8);
  return { briefing: recent.length ? `Recent company memory for clarification only:\n${recent.map(formatMemory).join("\n")}`.slice(0, 8_000) : undefined, reason: null, contextVersion: memories[0]?.version ?? lastBriefedVersion };
}

function normalizedEvidence(value: string) {
  return value.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, " ").replace(/\s+/g, " ").trim();
}

function hasContradictionSignal(value: string) {
  return /\b(?:no|not|never|neither|nor|without|cannot|can't|won't|didn't|doesn't|isn't|wasn't|shouldn't|deny|denied|decline|declined|reject|rejected|refuse|refused|oppose|opposed|disagree|disagreed|cancel|cancelled|canceled|pending|undecided|unapproved|uncertain|maybe|might|could|considering|proposed)\b/i.test(value);
}

export function excerptIsCorroborated(excerpt: string, evidence: string[], claim = excerpt) {
  const cleanExcerpt = normalizedEvidence(excerpt);
  if (cleanExcerpt.length < 8 || hasContradictionSignal(cleanExcerpt) !== hasContradictionSignal(normalizedEvidence(claim))) return false;
  return evidence.some((turn) => normalizedEvidence(turn).includes(cleanExcerpt));
}

export function admittedMemoryItems(result: {
  outcome: "complete" | "partial" | "no_usable_evidence" | "unknown";
  memory_items: Array<{ type: string; title: string; body: string; status: string; confidence: "high" | "medium" | "low" | "unknown"; source_excerpt: string; audience: string[] }>;
}, evidence: string[]) {
  if (result.outcome !== "complete" || !evidence.some((item) => item.trim().length >= 8)) return [];
  return result.memory_items
    .filter((item) => ["high", "medium"].includes(item.confidence) && excerptIsCorroborated(item.source_excerpt, evidence, `${item.title} ${item.body}`))
    .map((item) => ({ ...item, confidence: item.confidence === "high" ? 0.9 : 0.7 }));
}
