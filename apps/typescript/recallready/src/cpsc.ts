import type { CpscRecall } from "./types.js";

const API_BASE = "https://www.saferproducts.gov/RestWebServices/Recall";

interface RawRecall {
  RecallID?: number;
  RecallNumber?: string;
  RecallDate?: string;
  Description?: string;
  URL?: string;
  Title?: string;
  ConsumerContact?: string;
  Products?: Array<{ Name?: string; NumberOfUnits?: string }>;
  Hazards?: Array<{ Name?: string }>;
  Remedies?: Array<{ Name?: string }>;
  RemedyOptions?: Array<{ Option?: string }>;
}

type FetchLike = typeof fetch;

function mapRecall(raw: RawRecall): CpscRecall {
  if (!Number.isInteger(raw.RecallID) || !raw.Title || !raw.URL) {
    throw new Error("Official recall response is missing required fields.");
  }
  return {
    id: raw.RecallID!,
    number: raw.RecallNumber ?? "",
    date: raw.RecallDate ?? "",
    title: raw.Title,
    description: raw.Description ?? "",
    officialUrl: raw.URL,
    consumerContact: raw.ConsumerContact ?? "",
    products: (raw.Products ?? []).map((p) => ({
      name: p.Name ?? "Product",
      units: p.NumberOfUnits ?? "Not published",
    })),
    hazards: (raw.Hazards ?? []).map((h) => h.Name ?? "").filter(Boolean),
    remedies: (raw.Remedies ?? []).map((r) => r.Name ?? "").filter(Boolean),
    remedyOptions: (raw.RemedyOptions ?? []).map((r) => r.Option ?? "").filter(Boolean),
  };
}

async function fetchJson(url: URL, fetchImpl: FetchLike): Promise<RawRecall[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Official recall service returned ${response.status}.`);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new Error("Official recall service returned an unexpected payload.");
    return payload as RawRecall[];
  } finally {
    clearTimeout(timer);
  }
}

export async function searchRecalls(query: string, fetchImpl: FetchLike = fetch): Promise<CpscRecall[]> {
  const clean = query.trim().slice(0, 80);
  if (clean.length < 2) throw new Error("Enter at least two characters.");
  const url = new URL(API_BASE);
  url.searchParams.set("ProductName", clean);
  url.searchParams.set("format", "json");
  return (await fetchJson(url, fetchImpl)).slice(0, 12).map(mapRecall);
}

export async function getRecallById(id: number, fetchImpl: FetchLike = fetch): Promise<CpscRecall> {
  if (!Number.isInteger(id) || id <= 0) throw new Error("Recall ID must be a positive integer.");
  const url = new URL(API_BASE);
  url.searchParams.set("RecallID", String(id));
  url.searchParams.set("format", "json");
  const records = await fetchJson(url, fetchImpl);
  const exact = records.find((record) => record.RecallID === id);
  if (!exact) throw new Error("Recall was not found in the official service.");
  return mapRecall(exact);
}
