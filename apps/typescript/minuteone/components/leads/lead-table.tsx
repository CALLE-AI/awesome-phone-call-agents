import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CancelButton } from "./cancel-button";
import { statusVariant, outcomeVariant } from "./badge-variants";
import type { LeadRow } from "@/lib/db/schema";

interface LeadTableProps {
  rows: LeadRow[];
  /** Detail links are rendered as `${detailBasePath}/${lead.id}` — e.g. "/review" or "/dashboard/leads". */
  detailBasePath: string;
}

export function LeadTable({ rows, detailBasePath }: LeadTableProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No leads yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Next action</TableHead>
            <TableHead>Submitted</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell className="font-medium">
                <Link href={`${detailBasePath}/${lead.id}`} className="underline-offset-2 hover:underline">
                  {lead.name}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-sm">{lead.phone}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(lead.status)}>{lead.status}</Badge>
              </TableCell>
              <TableCell>
                {lead.outcome ? (
                  <Badge variant={outcomeVariant(lead.outcome)}>{lead.outcome}</Badge>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>{lead.score ?? "—"}</TableCell>
              <TableCell>{lead.nextAction ?? "—"}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{lead.createdAt.toLocaleString()}</TableCell>
              <TableCell className="text-right">
                {lead.status === "pending" && <CancelButton leadId={lead.id} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
