import { newEntityId } from "../ids.ts";
import type { BrainConfig, BrainSource } from "../types.ts";
import { generateGeminiJson, geminiConfigured } from "./gemini.ts";
import { HARBOR_COMPANY_ABOUT, HARBOR_DEMO_URL, HARBOR_QUALIFICATION_REPORT, harborCompanyCorpus } from "./harbor-corpus.ts";

export const MAX_INGEST_CHARS = 80_000;
export const MAX_INGEST_FILE_BYTES = 400_000;
export const ALLOWED_INGEST_EXTENSIONS = [".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".json"];

const PRIVATE_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i;

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function excerptFromText(text: string, max = 220): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).trim()}…`;
}

export function isAllowedIngestFileName(fileName: string): boolean {
  const lower = fileName.trim().toLowerCase();
  return ALLOWED_INGEST_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isHarborDemoUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (/^(demo|harbor|\/demo)$/i.test(trimmed)) return true;
  try {
    const url = new URL(trimmed, "http://localhost:3000");
    return url.pathname === "/demo" || url.pathname.startsWith("/demo/");
  } catch {
    return trimmed.startsWith("/demo");
  }
}

export function normalizeIngestUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Enter a website URL.");
  if (isHarborDemoUrl(trimmed)) return HARBOR_DEMO_URL;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid http(s) URL, or /demo for the Harbor fixture.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be ingested.");
  }
  if (url.username || url.password) {
    throw new Error("Remove credentials from the URL.");
  }
  if (PRIVATE_HOST.test(url.hostname)) {
    throw new Error("Local URLs are not fetched. Use /demo for the Harbor fixture, or a public https URL.");
  }
  return url.toString();
}

export async function fetchPublicPageText(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { accept: "text/html,text/plain;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(8_000)
  });
  if (!res.ok) throw new Error(`Could not fetch that page (${res.status}).`);
  const type = res.headers.get("content-type") || "";
  if (/\bpdf\b/i.test(type)) throw new Error("PDF pages are not supported. Upload a text file instead.");
  const body = await res.text();
  const text = /html/i.test(type) || /<\/?[a-z][\s\S]*>/i.test(body.slice(0, 2000)) ? htmlToText(body) : body;
  const clipped = text.slice(0, MAX_INGEST_CHARS).trim();
  if (!clipped) throw new Error("That page did not contain readable text.");
  return clipped;
}

export async function resolveIngestText(kind: "url" | "file", input: { url?: string; fileName?: string; text?: string }): Promise<{
  source: BrainSource;
  text: string;
}> {
  if (kind === "file") {
    const fileName = (input.fileName || "upload.txt").trim() || "upload.txt";
    if (!isAllowedIngestFileName(fileName)) {
      throw new Error("Use a text, Markdown, HTML, CSV, or JSON file.");
    }
    const raw = input.text || "";
    if (raw.length > MAX_INGEST_CHARS) throw new Error("File is too large to ingest.");
    const lower = fileName.toLowerCase();
    const text =
      lower.endsWith(".html") || lower.endsWith(".htm")
        ? htmlToText(raw)
        : raw.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    if (!text) throw new Error("That file did not contain readable text.");
    return {
      text,
      source: {
        id: `src_${newEntityId().slice(0, 8)}`,
        kind: "file",
        label: fileName,
        fileName,
        ingestedAt: new Date().toISOString(),
        excerpt: excerptFromText(text)
      }
    };
  }

  const url = normalizeIngestUrl(input.url || "");
  const text = isHarborDemoUrl(url) ? harborCompanyCorpus() : await fetchPublicPageText(url);
  return {
    text,
    source: {
      id: `src_${newEntityId().slice(0, 8)}`,
      kind: "url",
      label: isHarborDemoUrl(url) ? "Harbor demo site" : hostLabel(url),
      url,
      ingestedAt: new Date().toISOString(),
      excerpt: excerptFromText(text)
    }
  };
}

function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function mergeSource(config: BrainConfig, source: BrainSource): BrainSource[] {
  const key = source.url || source.fileName || source.id;
  const without = config.sources.filter((item) => (item.url || item.fileName || item.id) !== key);
  return [source, ...without].slice(0, 12);
}

function firstProductGuess(text: string, fallback: string): string {
  const heading =
    text
      .split(/\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find(Boolean) || "";
  const left = heading.split(/[—\-|:]/)[0]?.trim() || heading;
  const named = left.match(/^([A-Z][\w]+(?:\s+[A-Z][\w]+){0,2})\b/);
  if (named && named[1].length >= 3 && named[1].length <= 48) return named[1];
  if (/\bharbor\b/i.test(text)) return "Harbor CRM";
  return fallback;
}

export function draftFromText(config: BrainConfig, text: string): Pick<BrainConfig, "productName" | "companyAbout" | "qualificationReport"> {
  const harbor = /\bharbor\b/i.test(text);
  const productName = harbor ? "Harbor CRM" : firstProductGuess(text, config.productName);
  const about = harbor
    ? HARBOR_COMPANY_ABOUT
    : excerptFromText(text, 720);
  const qualificationReport = harbor
    ? HARBOR_QUALIFICATION_REPORT
    : [
        `Qualify inbound callers for ${productName}. Learn why they reached out now, what they use today, how many people would use the product, and whether this is a fit — without turning the call into a screening.`,
        "Do not book a calendar slot. Do not recite clickstream. Pass a human follow-up only if they ask."
      ].join("\n\n");
  return { productName, companyAbout: about, qualificationReport };
}

interface GeminiIngestJson {
  productName?: unknown;
  companyAbout?: unknown;
  qualificationReport?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function enrichDraftWithGemini(
  config: BrainConfig,
  text: string,
  heuristic: Pick<BrainConfig, "productName" | "companyAbout" | "qualificationReport">
): Promise<Pick<BrainConfig, "productName" | "companyAbout" | "qualificationReport">> {
  if (!geminiConfigured()) return heuristic;
  const parsed = await generateGeminiJson<GeminiIngestJson>(
    `Draft a sales qualification brief from company source text. Do not describe voice, tone, persona, or manner. Do not invent a spoken script.

Current product: ${config.productName}
Current listening intents (keep these in mind for the directive, do not list them as a form): ${config.goals.map((goal) => goal.label).join(", ")}

Source text:
${text.slice(0, 12_000)}

Return JSON: {
  "productName": string,
  "companyAbout": string (2-4 sentences, factual),
  "qualificationReport": string (what good-fit looks like, what to learn on the call, what not to do)
}`,
    45_000
  );
  if (!parsed) return heuristic;
  return {
    productName: asString(parsed.productName) || heuristic.productName,
    companyAbout: asString(parsed.companyAbout) || heuristic.companyAbout,
    qualificationReport: asString(parsed.qualificationReport) || heuristic.qualificationReport
  };
}

export function applyIngestDraft(
  config: BrainConfig,
  source: BrainSource,
  draft: Pick<BrainConfig, "productName" | "companyAbout" | "qualificationReport">
): BrainConfig {
  return {
    ...config,
    productName: draft.productName,
    companyAbout: draft.companyAbout,
    qualificationReport: draft.qualificationReport,
    sources: mergeSource(config, source)
  };
}
