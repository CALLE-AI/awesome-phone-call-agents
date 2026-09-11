/** @jsxImportSource react */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { renderInvoicePdf } from "./_render";
import type { InvoiceData } from "@/lib/invoices/InvoiceTemplate";
import { getOrCreateBrand } from "@/lib/brand";
import { isDemoWorkspace } from "@/lib/demo-workspace";

/* ─── Sample invoice store ───────────────────────────────────────────────────
   There is no Invoice table. These exist so a demo workspace has something to
   show, and they are served ONLY to a demo workspace - see lib/demo-workspace.
   A real workspace gets a 404, which is accurate: it has no invoices.

   Every one of them is stamped SAMPLE in the rendered PDF as well as on the
   page, because a downloaded file outlives the screen it came from. An invoice
   that looks paid, names a real company and lands in someone's downloads
   folder is the worst version of invented data.
   ──────────────────────────────────────────────────────────────────────────*/
const SAMPLE_INVOICES: Record<string, InvoiceData> = {
  "ARC-2026-047": {
    invoiceNumber:    "ARC-2026-047",
    date:             "April 1, 2026",
    dueDate:          "April 1, 2026",
    brandName:        "Shan Foods Ltd.",
    brandAddress:     "Shahrah-e-Faisal, Karachi, Pakistan",
    items: [
      { description: "Growth Plan — April 2026", quantity: 1, unitPrice: 40000, total: 40000 },
    ],
    subtotal:         40000,
    total:            40000,
    paymentReference: "ARC-shan-foods",
    status:           "paid",
    paidDate:         "April 1, 2026",
  },
  "ARC-2026-031": {
    invoiceNumber:    "ARC-2026-031",
    date:             "March 1, 2026",
    dueDate:          "March 1, 2026",
    brandName:        "Shan Foods Ltd.",
    brandAddress:     "Shahrah-e-Faisal, Karachi, Pakistan",
    items: [
      { description: "Growth Plan — March 2026", quantity: 1, unitPrice: 40000, total: 40000 },
    ],
    subtotal:         40000,
    total:            40000,
    paymentReference: "ARC-shan-foods",
    status:           "paid",
    paidDate:         "March 1, 2026",
  },
  "ARC-2026-018": {
    invoiceNumber:    "ARC-2026-018",
    date:             "February 1, 2026",
    dueDate:          "February 1, 2026",
    brandName:        "Shan Foods Ltd.",
    brandAddress:     "Shahrah-e-Faisal, Karachi, Pakistan",
    items: [
      { description: "Growth Plan — February 2026",           quantity: 1,  unitPrice: 40000, total: 40000 },
      { description: "Radio booking — City FM 89 (12 spots)", quantity: 12, unitPrice: 4500,  total: 54000 },
    ],
    subtotal:         94000,
    total:            94000,
    paymentReference: "ARC-shan-foods",
    status:           "paid",
    paidDate:         "February 1, 2026",
  },
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  /* Not a demo workspace, no sample invoices. Same answer as for an id that
     does not exist, because for this workspace it does not. */
  const brand = await getOrCreateBrand(userId);
  if (!isDemoWorkspace(brand.clerkOrgId)) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  const base = SAMPLE_INVOICES[id];
  if (!base) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

  /* Stamped in the document itself. The page can say "sample" all it likes;
     the PDF is what gets forwarded. */
  const invoice: InvoiceData = {
    ...base,
    invoiceNumber: `SAMPLE — ${base.invoiceNumber}`,
    brandName: `${base.brandName} (sample data — not a real invoice)`,
  };

  try {
    const stream = await renderInvoicePdf(invoice);

    const nodeStream = stream as unknown as {
      on: (event: string, cb: (...args: unknown[]) => void) => void;
    };

    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on("data",  (chunk) => controller.enqueue(chunk as Uint8Array));
        nodeStream.on("end",   ()      => controller.close());
        nodeStream.on("error", (err)   => controller.error(err));
      },
    });

    return new Response(webStream, {
      headers: {
        "Content-Type":        "application/pdf",
        /* The filename travels further than the file's contents get read. */
        "Content-Disposition": `attachment; filename="SAMPLE-${id}.pdf"`,
        "Cache-Control":       "private, no-cache",
      },
    });
  } catch (err) {
    console.error("PDF generation error:", err);
    return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
  }
}
