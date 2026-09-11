import { renderToStream } from "@react-pdf/renderer";
import { InvoiceTemplate } from "@/lib/invoices/InvoiceTemplate";
import type { InvoiceData } from "@/lib/invoices/InvoiceTemplate";

/** Renders an InvoiceData object to a Node.js ReadableStream of PDF bytes. */
export async function renderInvoicePdf(invoice: InvoiceData): Promise<NodeJS.ReadableStream> {
  return renderToStream(<InvoiceTemplate invoice={invoice} />) as unknown as NodeJS.ReadableStream;
}
