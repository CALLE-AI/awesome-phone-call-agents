/**
 * Which workspaces may see sample data.
 *
 * There is no Invoice table: nobody has real invoices, and the billing page
 * was rendering three hardcoded ones - ARC-2026-047 and friends, billed to
 * "Shan Foods Ltd., Shahrah-e-Faisal, Karachi" - with working PDF downloads.
 * They looked exactly like real invoices because nothing distinguished them
 * from real invoices.
 *
 * Set ARC_DEMO_ORG_IDS to the Clerk org ids that are demo workspaces. Anything
 * not listed is a real workspace and sees the empty state, which is the truth:
 * no invoices exist. A demo workspace still sees them, marked as samples on
 * the screen and on the PDF.
 *
 * Deliberately opt-IN. The version of this that defaults to "demo" is the
 * version that eventually shows invented invoices to a paying customer.
 */
export function isDemoWorkspace(clerkOrgId: string | null | undefined): boolean {
  if (!clerkOrgId) return false;
  const ids = (process.env.ARC_DEMO_ORG_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.includes(clerkOrgId);
}
