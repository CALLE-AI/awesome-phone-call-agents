export const POLICY_GATES: { id: string; label: string }[] = [
  { id: "binding_call_id", label: "Result bound to the reserved call id" },
  { id: "binding_intent", label: "Result bound to this intent" },
  { id: "binding_request_hash", label: "Request hash matches the reserved intent" },
  { id: "binding_task_version", label: "Task version matches" },
  { id: "binding_schema_version", label: "Result schema version matches" },
  { id: "binding_destination", label: "Dialed destination matches the trusted contact" },
  { id: "provider_status_terminal", label: "Provider reached a terminal status" },
  { id: "provider_completed", label: "Provider status is completed (not failed/canceled)" },
  { id: "task_completed", label: "CALL-E judged the task complete" },
  { id: "recipient_completed", label: "Recipient leg completed (not refused/unreached)" },
  { id: "schema_valid", label: "Structured result parses under the closed schema" },
  { id: "identity_confirmed", label: "Recipient confirmed the vendor organization identity" },
  { id: "case_code_confirmed", label: "Recipient confirmed the safe case code" },
  { id: "no_sensitive_data", label: "No bank details, credentials, or OTPs disclosed" },
  { id: "no_opt_out", label: "Recipient did not opt out" },
  { id: "change_status_answered", label: "Change request answered initiated / not_initiated" },
  { id: "confidence_threshold", label: "Confidence ≥ 0.70" },
  { id: "evidence_present", label: "Provider returned evidence items" },
];

export interface GateRow {
  id: string;
  label: string;
  status: "pass" | "fail" | "pending";
}

export function gateRows(failed: Set<string> | null): GateRow[] {
  if (failed === null) {
    return POLICY_GATES.map((g) => ({ ...g, status: "pending" }));
  }
  const known = new Set(POLICY_GATES.map((g) => g.id));
  const rows: GateRow[] = POLICY_GATES.map((g) => {
    const failedDirect = failed.has(g.id);
    const failedByBindingGroup =
      g.id.startsWith("binding_") &&
      [...failed].some((f) => f.startsWith("binding_"));
    return { ...g, status: failedDirect || failedByBindingGroup ? "fail" : "pass" };
  });
  for (const id of failed) {
    if (!known.has(id)) {
      rows.push({ id, label: `Unknown gate failed: ${id}`, status: "fail" });
    }
  }
  return rows;
}
