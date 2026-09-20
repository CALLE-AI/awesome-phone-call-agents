import { asc, eq } from "drizzle-orm";

import { assertResultsOperatorUser } from "@/lib/auth/live-access";
import { LiveAccessError } from "@/lib/auth/live-policy";
import { csvCell } from "@/lib/campaigns/csv";
import { callResults, campaigns, contacts } from "@/lib/db/schema";
import { withRLS } from "@/lib/db/with-rls";
import { requireUser } from "@/lib/supabase/auth";
import {
  maskPhoneForDisplay,
  sanitizeDisplayError,
  sanitizeFailureCode,
  sanitizeResultData,
  sanitizeSummary,
  sanitizeTranscript,
} from "@/lib/privacy/redaction";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    await assertResultsOperatorUser(auth.user.id);
  } catch (error) {
    if (error instanceof LiveAccessError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const { id } = await context.params;

  const loaded = await withRLS(auth.user.id, async (tx) => {
    const [campaign] = await tx
      .select({ name: campaigns.name, locale: campaigns.locale })
      .from(campaigns)
      .where(eq(campaigns.id, id))
      .limit(1);
    if (!campaign) return null;

    const rows = await tx
      .select({
        contactName: contacts.name,
        phoneNumber: contacts.phoneNumber,
        status: callResults.status,
        qualified: callResults.qualified,
        capturedData: callResults.capturedData,
        summary: callResults.summary,
        transcript: callResults.transcript,
        failureCode: callResults.failureCode,
        failureMessage: callResults.failureMessage,
        calleCallId: callResults.calleCallId,
        createdAt: callResults.createdAt,
        completedAt: callResults.completedAt,
      })
      .from(callResults)
      .innerJoin(contacts, eq(contacts.id, callResults.contactId))
      .where(eq(callResults.campaignId, id))
      .orderBy(asc(callResults.createdAt), asc(callResults.id));
    return { campaign, rows };
  });

  if (!loaded) return Response.json({ error: "Campaign not found" }, { status: 404 });

  const sanitizedRows = loaded.rows.map((row) => ({
    ...row,
    phoneNumber: maskPhoneForDisplay(row.phoneNumber),
    capturedData: sanitizeResultData(row.capturedData),
    summary: sanitizeSummary(row.summary),
    transcript: sanitizeTranscript(row.transcript),
    failureMessage: sanitizeDisplayError(row.failureMessage),
    failureCode: sanitizeFailureCode(row.failureCode),
  }));
  const resultKeys = Array.from(
    new Set(
      sanitizedRows.flatMap((row) =>
        row.capturedData && typeof row.capturedData === "object" && !Array.isArray(row.capturedData)
          ? Object.keys(row.capturedData)
          : [],
      ),
    ),
  ).sort();
  const headers = [
    "contact_name",
    "phone_number",
    "locale",
    "status",
    "qualified",
    ...resultKeys.map((key) => `result.${key}`),
    "summary",
    "transcript",
    "failure_code",
    "failure_message",
    "calle_call_id",
    "created_at",
    "completed_at",
  ];
  const lines = [
    headers.map(csvCell).join(","),
    ...sanitizedRows.map((row) => {
      const captured =
        row.capturedData && typeof row.capturedData === "object" && !Array.isArray(row.capturedData)
          ? (row.capturedData as Record<string, unknown>)
          : {};
      return [
        row.contactName,
        row.phoneNumber,
        loaded.campaign.locale,
        row.status,
        row.qualified,
        ...resultKeys.map((key) => captured[key]),
        row.summary,
        row.transcript,
        row.failureCode,
        row.failureMessage,
        row.calleCallId,
        row.createdAt?.toISOString(),
        row.completedAt?.toISOString(),
      ]
        .map(csvCell)
        .join(",");
    }),
  ];
  const filename = `${loaded.campaign.name.replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 60) || "campaign"}-results.csv`;

  return new Response(`\uFEFF${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
