import { fetchPublicHttps } from "@/lib/public-https";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_CHARS = 100_000;
const FETCH_MS = 20_000;

export type ResumeReadResult = {
  text: string;
};

function driveFileId(url: string): string {
  const fileMatch = url.match(/\/(?:file|document|presentation|spreadsheets)\/d\/([a-zA-Z0-9_-]+)/i);
  if (fileMatch?.[1]) return fileMatch[1];
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  return idMatch?.[1] ?? "";
}

export function readableResumeUrl(raw: string): string {
  const url = raw.trim();
  if (!url) throw new Error("This candidate has no resume link.");

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Resume link is not a valid URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Resume link must be public https.");
  }

  const host = parsed.hostname.toLowerCase();
  const id = driveFileId(url);
  if (id && (host.endsWith("drive.google.com") || host.endsWith("docs.google.com"))) {
    if (host.endsWith("docs.google.com") && url.includes("/document/")) {
      return `https://docs.google.com/document/d/${id}/export?format=txt`;
    }
    return `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;
  }
  return url;
}

function looksLikePdf(buffer: Buffer, contentType: string): boolean {
  if (contentType.includes("pdf")) return true;
  return buffer.subarray(0, 5).toString("utf8") === "%PDF-";
}

function looksLikeHtml(buffer: Buffer, contentType: string): boolean {
  if (contentType.includes("html")) return true;
  const head = buffer.subarray(0, 200).toString("utf8").toLowerCase();
  return head.includes("<!doctype html") || head.includes("<html");
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function assertPublicDrive(html: string) {
  const lower = html.toLowerCase();
  if (
    lower.includes("sign in") ||
    lower.includes("accounts.google.com") ||
    lower.includes("you need access") ||
    lower.includes("request access")
  ) {
    throw new Error(
      "Drive file is not public. Share it with anyone who has the link, then prepare again.",
    );
  }
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const parsed = await parser.getText();
    return String(parsed.text ?? "").trim();
  } finally {
    await parser.destroy();
  }
}

function clip(text: string): string {
  if (text.length <= MAX_CHARS) return text;
  return text.slice(0, MAX_CHARS);
}

export async function readResumeTextFromUrl(resumeUrl: string): Promise<ResumeReadResult> {
  const target = readableResumeUrl(resumeUrl);
  const response = await fetchPublicHttps(target, {
    signal: AbortSignal.timeout(FETCH_MS),
    headers: { Accept: "application/pdf,text/plain,text/html,*/*" },
  });
  if (!response.ok) {
    throw new Error(`Could not read the resume link (${response.status}).`);
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("The resume link returned an empty file.");
  }
  if (bytes.length > MAX_BYTES) {
    throw new Error("Resume file is larger than 5 MB.");
  }

  if (looksLikePdf(bytes, contentType)) {
    const text = clip(await extractPdfText(bytes));
    if (!text) throw new Error("No text could be read from that PDF.");
    return { text };
  }

  const raw = bytes.toString("utf8");
  if (looksLikeHtml(bytes, contentType)) {
    assertPublicDrive(raw);
    const text = clip(stripHtml(raw));
    if (!text) throw new Error("The resume link returned a page with no usable text.");
    return { text };
  }

  const text = clip(raw.replace(/\u0000/g, "").trim());
  if (!text) throw new Error("No text could be read from that resume link.");
  return { text };
}
