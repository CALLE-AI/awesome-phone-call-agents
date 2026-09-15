import rawCases from "../../data/cases.json";
import type { FraudOpsCase, Intent } from "./types";
import { assertValidCase } from "./validate";

export const MOCK_CASES: FraudOpsCase[] = rawCases.map((item) =>
  assertValidCase(item)
);

export function getCase(caseId: string): FraudOpsCase | undefined {
  return MOCK_CASES.find((item) => item.case_id === caseId);
}

export type QueueRow = {
  key: string;
  intent: Intent;
  cases: FraudOpsCase[];
  title: string;
  summary: string;
};

function partyRank(fraudCase: FraudOpsCase): number {
  if (fraudCase.contact.role === "complainant") return 0;
  if (fraudCase.contact.role === "respondent") return 1;
  return 2;
}

export function queueRows(cases: FraudOpsCase[] = MOCK_CASES): QueueRow[] {
  const seen = new Set<string>();
  const rows: QueueRow[] = [];

  for (const item of cases) {
    if (item.intent === "evidence_collection" && item.counterpart_case_id) {
      const pair = [item.case_id, item.counterpart_case_id].sort();
      const key = `inv:${pair.join("+")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = cases.find((c) => c.case_id === item.counterpart_case_id);
      const parties = other ? [item, other] : [item];
      parties.sort((a, b) => partyRank(a) - partyRank(b));
      rows.push({
        key,
        intent: item.intent,
        cases: parties,
        title: "Evidence · both parties",
        summary: item.incident_summary_plain ?? item.reason_plain,
      });
      continue;
    }

    rows.push({
      key: item.case_id,
      intent: item.intent,
      cases: [item],
      title: item.case_id,
      summary: item.reason_plain,
    });
  }

  return rows;
}
