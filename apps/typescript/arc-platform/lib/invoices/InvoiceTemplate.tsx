import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface InvoiceItem {
  description: string;
  quantity:    number;
  unitPrice:   number;
  total:       number;
}

export interface InvoiceData {
  invoiceNumber:    string;  // e.g. "ARC-2026-047"
  date:             string;  // "April 1, 2026"
  dueDate:          string;
  brandName:        string;
  brandAddress:     string;
  ntn?:             string;  // National Tax Number (Pakistan)
  items:            InvoiceItem[];
  subtotal:         number;
  tax?:             number;  // 16% GST where applicable
  total:            number;
  paymentReference: string;
  status:           "paid" | "due" | "overdue";
  paidDate?:        string;
}

const C = {
  indigo:   "#4F46E5",
  dark:     "#1E1B4B",
  muted:    "#6B7280",
  border:   "#E5E7EB",
  bgLight:  "#F9FAFB",
  bgIndigo: "#EEF2FF",
};

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#FFFFFF",
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
    paddingBottom: 24,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  logo: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
    color: C.indigo,
    letterSpacing: 4,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 9,
    color: C.muted,
    marginBottom: 2,
  },
  invoiceTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: C.dark,
    marginBottom: 6,
  },
  invoiceNumber: {
    fontSize: 12,
    color: C.indigo,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  metaText: {
    fontSize: 9,
    color: C.muted,
    marginBottom: 2,
  },
  sectionLabel: {
    fontSize: 8,
    color: C.muted,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  billTo: {
    marginBottom: 28,
  },
  billName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 3,
  },
  table: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 4,
    marginBottom: 16,
  },
  tableHeader: {
    backgroundColor: C.bgLight,
    flexDirection: "row",
    padding: "8 10",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRow: {
    flexDirection: "row",
    padding: "9 10",
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRowLast: {
    flexDirection: "row",
    padding: "9 10",
  },
  tableTh: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  tableTd: {
    fontSize: 10,
    color: "#111827",
  },
  subtotalRow: {
    flexDirection: "row",
    padding: "8 10",
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.bgLight,
  },
  totalRow: {
    flexDirection: "row",
    padding: "10 10",
    backgroundColor: C.bgIndigo,
    borderRadius: 4,
  },
  totalLabel: {
    flex: 5,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: C.dark,
    textAlign: "right",
  },
  totalAmount: {
    flex: 1.5,
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: C.indigo,
    textAlign: "right",
  },
  statusBadge: {
    backgroundColor: "#D1FAE5",
    borderRadius: 4,
    padding: "2 8",
    alignSelf: "flex-start",
  },
  statusText: {
    color: "#065F46",
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  footer: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 16,
  },
  footerText: {
    fontSize: 8,
    color: C.muted,
    textAlign: "center",
    marginBottom: 3,
  },
  payRef: {
    fontSize: 8,
    color: C.muted,
    textAlign: "center",
  },
});

export function InvoiceTemplate({ invoice }: { invoice: InvoiceData }) {
  return (
    <Document
      title={`Invoice ${invoice.invoiceNumber}`}
      author="Arc Platform"
    >
      <Page size="A4" style={styles.page}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>ARC</Text>
            <Text style={styles.tagline}>arcplatform.com</Text>
            <Text style={styles.tagline}>Karachi, Pakistan</Text>
            <Text style={styles.tagline}>hello@arcplatform.com</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.invoiceTitle}>TAX INVOICE</Text>
            <Text style={styles.invoiceNumber}>#{invoice.invoiceNumber}</Text>
            <Text style={styles.metaText}>Issue Date: {invoice.date}</Text>
            <Text style={styles.metaText}>Due Date: {invoice.dueDate}</Text>
            {invoice.status === "paid" && invoice.paidDate && (
              <View style={[styles.statusBadge, { marginTop: 6 }]}>
                <Text style={styles.statusText}>✓ Paid {invoice.paidDate}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Bill To */}
        <View style={styles.billTo}>
          <Text style={styles.sectionLabel}>Bill To</Text>
          <Text style={styles.billName}>{invoice.brandName}</Text>
          <Text style={styles.metaText}>{invoice.brandAddress}</Text>
          {invoice.ntn && <Text style={styles.metaText}>NTN: {invoice.ntn}</Text>}
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableTh, { flex: 3 }]}>Description</Text>
            <Text style={[styles.tableTh, { flex: 1, textAlign: "center" }]}>Qty</Text>
            <Text style={[styles.tableTh, { flex: 1.5, textAlign: "right" }]}>Rate (PKR)</Text>
            <Text style={[styles.tableTh, { flex: 1.5, textAlign: "right" }]}>Amount (PKR)</Text>
          </View>

          {invoice.items.map((item, i) => (
            <View
              key={i}
              style={i < invoice.items.length - 1 ? styles.tableRow : styles.tableRowLast}
            >
              <Text style={[styles.tableTd, { flex: 3 }]}>{item.description}</Text>
              <Text style={[styles.tableTd, { flex: 1, textAlign: "center" }]}>{item.quantity}</Text>
              <Text style={[styles.tableTd, { flex: 1.5, textAlign: "right" }]}>
                {item.unitPrice.toLocaleString()}
              </Text>
              <Text style={[styles.tableTd, { flex: 1.5, textAlign: "right" }]}>
                {item.total.toLocaleString()}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={{ alignSelf: "flex-end", width: 280 }}>
          <View style={[styles.subtotalRow, { borderTopWidth: 0, marginBottom: 4 }]}>
            <Text style={[styles.tableTd, { flex: 1, color: C.muted }]}>Subtotal</Text>
            <Text style={[styles.tableTd, { textAlign: "right", minWidth: 100 }]}>
              PKR {invoice.subtotal.toLocaleString()}
            </Text>
          </View>
          {invoice.tax !== undefined && invoice.tax > 0 && (
            <View style={[styles.subtotalRow, { borderTopWidth: 0, marginBottom: 4 }]}>
              <Text style={[styles.tableTd, { flex: 1, color: C.muted }]}>GST (16%)</Text>
              <Text style={[styles.tableTd, { textAlign: "right", minWidth: 100 }]}>
                PKR {invoice.tax.toLocaleString()}
              </Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total Due</Text>
            <Text style={styles.totalAmount}>PKR {invoice.total.toLocaleString()}</Text>
          </View>
        </View>

        {/* Bank details (if not paid) */}
        {invoice.status !== "paid" && (
          <View style={{ marginTop: 28, padding: "12 14", backgroundColor: C.bgLight, borderRadius: 4, borderWidth: 1, borderColor: C.border }}>
            <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>Payment Instructions</Text>
            <Text style={styles.metaText}>Bank: Meezan Bank (Islamic)  |  Account: Arc Platform (Pvt.) Ltd.</Text>
            <Text style={styles.metaText}>IBAN: PK36MEZN0001230123456789</Text>
            <Text style={[styles.metaText, { color: C.indigo }]}>Reference: {invoice.paymentReference}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Arc Platform (Pvt.) Ltd. · Karachi, Pakistan · hello@arcplatform.com · arcplatform.com
          </Text>
          <Text style={styles.payRef}>
            Payment Reference: {invoice.paymentReference} · All amounts in Pakistani Rupee (PKR)
          </Text>
          <Text style={[styles.payRef, { marginTop: 4 }]}>
            This is a computer-generated invoice and does not require a physical signature.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
