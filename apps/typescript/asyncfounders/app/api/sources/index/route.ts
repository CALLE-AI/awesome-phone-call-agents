import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { z } from "zod";
import { authenticatedUser, adminSupabase } from "../../../../lib/supabase";
import {
  chunksOf,
  MAX_EXTRACTED_CHARACTERS,
  MAX_PDF_PAGES,
  MAX_SOURCE_BYTES,
  normalizeSourceText,
} from "../../../../lib/source-indexing";

export const maxDuration = 60;

const uploadedSourceSchema = z.object({
  companyId: z.string().uuid(),
  storagePath: z.string().min(3).max(800),
  label: z.string().trim().min(1).max(240),
  mimeType: z.literal("application/pdf"),
});
const queuedSourceSchema = z.object({
  companyId: z.string().uuid(),
  sourceId: z.string().uuid(),
});
const requestSchema = z.union([uploadedSourceSchema, queuedSourceSchema]);

class IndexingError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function withTimeout<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IndexingError("PDF extraction took too long. Try a smaller PDF.", 504)), milliseconds);
  });

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  let cleanupPath: string | null = null;

  try {
    const user = await authenticatedUser(request);
    if (!user) return NextResponse.json({ message: "Sign in again before indexing a source." }, { status: 401 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ message: "The PDF indexing request is invalid." }, { status: 400 });

    const { companyId } = parsed.data;

    const supabase = adminSupabase();
    const { data: membership } = await supabase
      .from("company_members")
      .select("id")
      .eq("company_id", companyId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!membership) return NextResponse.json({ message: "You are not an active member of this company." }, { status: 403 });

    let sourceId: string | null = null;
    let storagePath: string;
    let label: string;
    let mimeType: "application/pdf";

    if ("sourceId" in parsed.data) {
      const { data: queued } = await supabase
        .from("sources")
        .select("id,storage_path,label,mime_type,index_status")
        .eq("id", parsed.data.sourceId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (!queued) return NextResponse.json({ message: "That source was not found in this company." }, { status: 404 });
      if (!queued.storage_path || queued.mime_type !== "application/pdf") {
        return NextResponse.json({ message: "Only stored PDF sources can be re-indexed here." }, { status: 422 });
      }
      if (queued.index_status === "indexed") return NextResponse.json({ message: "This PDF is already indexed." }, { status: 409 });
      sourceId = queued.id;
      storagePath = queued.storage_path;
      label = queued.label;
      mimeType = "application/pdf";
    } else {
      ({ storagePath, label, mimeType } = parsed.data);
      if (!storagePath.startsWith(`${companyId}/`) || storagePath.includes("..")) {
        return NextResponse.json({ message: "That file does not belong to this company workspace." }, { status: 403 });
      }
      const { data: existing } = await supabase.from("sources").select("id").eq("storage_path", storagePath).maybeSingle();
      if (existing) return NextResponse.json({ message: "This file is already registered." }, { status: 409 });
      cleanupPath = storagePath;
    }

    const { data: file, error: downloadError } = await supabase.storage.from("company-sources").download(storagePath);
    if (downloadError || !file) throw new IndexingError("The uploaded PDF could not be opened.", 422);
    if (file.size > MAX_SOURCE_BYTES) throw new IndexingError("Keep each file under 10 MB.", 413);

    let pdf;
    try {
      pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()), { maxImageSize: 16_777_216 });
    } catch {
      throw new IndexingError("This PDF could not be read. Make sure it is valid and not password-protected.", 422);
    }

    const pageCount = pdf.numPages;
    let text: string;
    try {
      if (pdf.numPages > MAX_PDF_PAGES) {
        throw new IndexingError(`PDFs can contain at most ${MAX_PDF_PAGES} pages.`, 413);
      }
      const extracted = await withTimeout(extractText(pdf, { mergePages: true }), 25_000);
      text = normalizeSourceText(String(extracted.text));
    } finally {
      const destroy = (pdf as typeof pdf & { destroy?: () => Promise<void> }).destroy;
      if (destroy) await destroy.call(pdf).catch(() => undefined);
    }

    if (text.length < 40) {
      throw new IndexingError("No selectable text was found. This may be a scanned PDF; run OCR first, then upload it again.", 422);
    }
    if (text.length > MAX_EXTRACTED_CHARACTERS) {
      throw new IndexingError("This PDF contains too much text to index safely. Split it into smaller files and try again.", 413);
    }

    const chunks = chunksOf(text);
    const createdSource = !sourceId;
    if (!sourceId) {
      const { data: source, error: sourceError } = await supabase
        .from("sources")
        .insert({
          company_id: companyId,
          kind: "file",
          label,
          storage_path: storagePath,
          mime_type: mimeType,
          byte_size: file.size,
          index_status: "queued",
          chunk_count: 0,
          added_by: user.id,
        })
        .select("id")
        .single();
      if (sourceError || !source) throw new IndexingError("The extracted PDF could not be saved.", 500);
      sourceId = source.id;
    }

    try {
      await supabase.from("source_chunks").delete().eq("source_id", sourceId);
      for (let start = 0; start < chunks.length; start += 100) {
        const batch = chunks.slice(start, start + 100).map((content, offset) => ({
          source_id: sourceId,
          company_id: companyId,
          ordinal: start + offset,
          content,
        }));
        const { error } = await supabase.from("source_chunks").insert(batch);
        if (error) throw error;
      }
      const { error: updateError } = await supabase
        .from("sources")
        .update({ index_status: "indexed", chunk_count: chunks.length, byte_size: file.size })
        .eq("id", sourceId);
      if (updateError) throw updateError;
    } catch {
      await supabase.from("source_chunks").delete().eq("source_id", sourceId);
      if (createdSource) await supabase.from("sources").delete().eq("id", sourceId);
      else await supabase.from("sources").update({ index_status: "failed", chunk_count: 0 }).eq("id", sourceId);
      throw new IndexingError("The PDF was extracted, but its search index could not be saved.", 500);
    }

    cleanupPath = null;
    return NextResponse.json({ sourceId, chunkCount: chunks.length, pageCount }, { status: createdSource ? 201 : 200 });
  } catch (error) {
    if (cleanupPath) {
      const supabase = adminSupabase();
      await supabase.storage.from("company-sources").remove([cleanupPath]).catch(() => undefined);
    }
    const status = error instanceof IndexingError ? error.status : 500;
    const message = error instanceof IndexingError ? error.message : "The PDF could not be indexed.";
    return NextResponse.json({ message }, { status });
  }
}
