import { randomUUID } from "crypto";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { NextResponse } from "next/server";

import { callLogs, db, emails, reminders, users } from "@/db";
import { runReminderCall } from "@/lib/calle";
import { runDigestForUser } from "@/lib/digest";

/**
 * Returns the current time as "HH:mm", using the server's local timezone.
 *
 * Simplification for the hackathon demo: we don't collect a per-user
 * timezone, so this compares against whatever timezone the server process
 * is running in. Good enough for a single-region demo deployment.
 */
function getCurrentHHmm(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Runs the daily multi-email digest call for every user whose callTime
 * matches the current time and who has pending emails.
 */
async function runDueDigestCalls(currentTime: string) {
  const scheduledUsers = await db.query.users.findMany({
    where: isNotNull(users.callTime),
  });

  const dueUsers = scheduledUsers.filter(
    (user) => user.callTime === currentTime
  );

  const summary = await Promise.all(
    dueUsers.map(async (user) => {
      const result = await runDigestForUser(user);

      if ("skipped" in result) {
        return {
          userId: user.id,
          name: user.name,
          called: false,
          reason: result.reason,
        };
      }

      return {
        userId: user.id,
        name: user.name,
        called: true,
        callStatus: result.call.status,
      };
    })
  );

  return { checked: dueUsers.length, summary };
}

/**
 * Runs a short, single-email reminder call for every reminder whose
 * remindAt has passed and hasn't fired yet. Distinct from the digest call
 * above — one reminder, one short call, not the full inbox walkthrough.
 */
async function runDueReminderCalls() {
  const now = new Date();

  const dueReminders = await db.query.reminders.findMany({
    where: and(eq(reminders.fired, false), lte(reminders.remindAt, now)),
  });

  const summary = await Promise.all(
    dueReminders.map(async (reminder) => {
      const [email, user] = await Promise.all([
        db.query.emails.findFirst({ where: eq(emails.id, reminder.emailId) }),
        db.query.users.findFirst({ where: eq(users.id, reminder.userId) }),
      ]);

      if (!email || !user) {
        // Data integrity issue (deleted email/user) — mark it fired so it
        // doesn't get retried forever with nothing to call about.
        await db
          .update(reminders)
          .set({ fired: true })
          .where(eq(reminders.id, reminder.id));

        return {
          reminderId: reminder.id,
          called: false,
          reason: "missing email or user",
        };
      }

      try {
        const call = await runReminderCall(user.phoneNumber, {
          sender: email.sender,
          subject: email.subject,
          summary: email.summary ?? email.subject,
        });

        await db.insert(callLogs).values({
          id: randomUUID(),
          userId: user.id,
          callType: "reminder",
          calleCallId: call.id,
          status: call.status,
          structuredResult: JSON.stringify({
            acknowledged: call.acknowledged,
          }),
        });

        await db
          .update(reminders)
          .set({ fired: true })
          .where(eq(reminders.id, reminder.id));

        return {
          reminderId: reminder.id,
          userId: user.id,
          name: user.name,
          called: true,
          callStatus: call.status,
        };
      } catch (error) {
        console.error("[cron] runReminderCall failed:", error);

        await db.insert(callLogs).values({
          id: randomUUID(),
          userId: user.id,
          callType: "reminder",
          calleCallId: null,
          status: "failed",
          structuredResult: null,
        });

        // Leave fired=false so a transient failure gets retried on the
        // next cron tick, instead of silently dropping the reminder.
        return {
          reminderId: reminder.id,
          userId: user.id,
          name: user.name,
          called: false,
          reason: "call failed",
        };
      }
    })
  );

  return { checked: dueReminders.length, summary };
}

/**
 * Hit periodically (e.g. every minute) by Vercel Cron. Handles two
 * independent things on each tick:
 * 1. The daily digest: every user whose scheduled callTime matches the
 *    current time and who has pending emails.
 * 2. Due reminders: every reminders row whose remindAt has passed and
 *    hasn't fired yet, each getting its own short reminder call.
 */
export async function GET() {
  const currentTime = getCurrentHHmm();

  const [digest, reminderRun] = await Promise.all([
    runDueDigestCalls(currentTime),
    runDueReminderCalls(),
  ]);

  return NextResponse.json({
    currentTime,
    digest: {
      usersScheduledAtThisTime: digest.checked,
      usersCalled: digest.summary.filter((entry) => entry.called).length,
      summary: digest.summary,
    },
    reminders: {
      remindersChecked: reminderRun.checked,
      remindersCalled: reminderRun.summary.filter((entry) => entry.called)
        .length,
      summary: reminderRun.summary,
    },
  });
}
