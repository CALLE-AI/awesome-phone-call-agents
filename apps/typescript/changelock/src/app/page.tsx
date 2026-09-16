import Link from "next/link";
import { getDb } from "./server/get-db";
import { listInbox } from "./server/queries";

export const dynamic = "force-dynamic";

const STATE_LABEL: Record<string, string> = {
  needs_review: "Needs review",
  preview_ready: "Preview ready",
  dispatch_reserved: "Dispatch reserved",
  submission_unknown: "Submission unknown",
  call_active: "Call active",
  terminal_unverified: "Terminal · unverified",
  verification_confirmed: "Verified initiated",
  verification_denied: "Verified not initiated",
  needs_human: "Needs human",
};

export default async function InboxPage() {
  const rows = await listInbox(await getDb());
  return (
    <main>
      <div className="inbox-head">
        <h1>Held payment-change requests</h1>
        <span className="muted">
          {rows.length} case{rows.length === 1 ? "" : "s"} · every request stays held until evidence
          resolves
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="empty-note">No change requests imported yet.</p>
      ) : (
        <div className="table-scroll">
        <table className="case-table">
          <thead>
            <tr>
              <th>Case</th>
              <th>Vendor</th>
              <th>Requested change</th>
              <th>Received</th>
              <th>Verification state</th>
              <th>Payment change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.caseId}>
                <td>
                  <Link href={`/cases/${r.caseId}`} className="mono">
                    {r.safeCaseCode}
                  </Link>
                </td>
                <td>
                  <Link href={`/cases/${r.caseId}`}>{r.vendorName}</Link>
                  <div className="muted mono">{r.vendorCode}</div>
                </td>
                <td className="muted">{r.newDestinationLabel}</td>
                <td className="muted mono">
                  {new Date(r.requestedAt).toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td>
                  <span className={`state-badge ${r.state}`}>{STATE_LABEL[r.state] ?? r.state}</span>
                </td>
                <td>
                  <span className="held-marker">Held</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </main>
  );
}
