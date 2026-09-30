import { randomUUID } from "crypto";

import { and, eq } from "drizzle-orm";

import { db, emails, type Email } from "@/db";
import { fetchRecentEmails } from "@/lib/emailSource";
import { classifyEmail } from "@/lib/openrouter";

/**
 * Fetches the (mock) inbox for a user, inserts any emails that aren't in the
 * `emails` table yet, and (re)classifies anything that hasn't been
 * successfully classified yet. Shared by app/api/emails/fetch/route.ts and
 * app/api/users/create/route.ts (which seeds the mock inbox for a brand new
 * user).
 */
export async function ingestEmailsForUser(userId: string): Promise<Email[]> {
  const recentEmails = await fetchRecentEmails(userId);

  // The `emails` table doesn't persist the raw body, so keep a lookup back
  // to the source (lib/emailSource.ts / lib/mockInbox.ts) keyed by
  // gmailMessageId, since classification needs the body text.
  const bodyByMessageId = new Map(
    recentEmails.map((email) => [email.gmailMessageId, email.bodySnippet])
  );

  const records = await Promise.all(
    recentEmails.map(async (recentEmail) => {
      const existing = await db.query.emails.findFirst({
        where: and(
          eq(emails.userId, userId),
          eq(emails.gmailMessageId, recentEmail.gmailMessageId)
        ),
      });

      const email: Email =
        existing ??
        (
          await db
            .insert(emails)
            .values({
              id: randomUUID(),
              userId,
              gmailMessageId: recentEmail.gmailMessageId,
              sender: recentEmail.sender,
              subject: recentEmail.subject,
              // Filled in below by the OpenRouter classification step.
              summary: null,
              category: null,
              urgency: null,
            })
            .returning()
        )[0];

      // Already classified (and that classification didn't fail) — nothing
      // more to do. Emails with category === null (never classified) or
      // classificationFailed === true (previously fell back to defaults
      // after an error) get (re)classified below.
      if (email.category !== null && !email.classificationFailed) {
        return email;
      }

      const body = bodyByMessageId.get(email.gmailMessageId) ?? "";
      const classification = await classifyEmail(email.subject, body);

      const [updated] = await db
        .update(emails)
        .set({
          category: classification.category,
          urgency: classification.urgency,
          summary: classification.summary,
          classificationFailed: classification.classificationFailed,
          dueDate: classification.dueDate
            ? new Date(classification.dueDate)
            : null,
        })
        .where(eq(emails.id, email.id))
        .returning();

      return updated;
    })
  );

  return records;
}
