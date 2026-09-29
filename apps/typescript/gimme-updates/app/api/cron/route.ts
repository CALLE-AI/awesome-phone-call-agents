import { randomUUID } from "crypto";

import { and, eq, isNotNull, lte } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import { callLogs, db, emails, reminders, users } from "@/db";
import { isCalleResultResolved, runReminderCall } from "@/lib/calle";
import { runDigestForUser } from "@/lib/digest";
import {
  evaluateRealCallGate,
  isOperatorAuthorized,
} from "@/lib/operatorAuth";
import {
  maskPhoneNumber,
  redactContextText,
  redactProviderError,
} from "@/lib/privacy";

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
      const gate = evaluateRealCallGate(user.phoneNumber, true);
      if (gate.action === "reject") {
        console.log("[cron] skipping digest; recipient is not allowlisted", {
          userId: user.id,
          phoneNumber: maskPhoneNumber(user.phoneNumber),
        });
        return {
          userId: user.id,
          called: false,
          reason: "recipient_not_allowed",
        };
      }

      const result = await runDigestForUser(user, {
        operatorAuthorized: gate.action === "allow",
      });

      if ("skipped" in result) {
        return {
          userId: user.id,
          name: user.name,
          called: false,
          reason: result.reason,
        };
      }

      if (result.unresolved) {
        return {
          userId: user.id,
          name: user.name,
          called: false,
          reason: "unresolved",
          callStatus: result.call.status,
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

async function markReminderUnresolved(reminderId: string) {
  await db
    .update(reminders)
    .set({ fired: true, status: "unresolved" })
    .where(eq(reminders.id, reminderId));
}

/**
 * Runs a short, single-email reminder call for every reminder whose
 * remindAt has passed and hasn't fired yet. Distinct from the digest call
 * above — one reminder, one short call, not the full inbox walkthrough.
 *
 * Simulated reminders (created while fake/dry-run mode was active) are
 * skipped and never promoted to a real call, even if ALLOW_REAL_CALLS is
 * later enabled. Failed or ambiguous CALL-E results are marked
 * "unresolved" so the next tick does not silently retry them.
 */
async function runDueReminderCalls() {
  const now = new Date();

  const dueReminders = await db.query.reminders.findMany({
    where: and(
      eq(reminders.fired, false),
      eq(reminders.status, "pending"),
      lte(reminders.remindAt, now)
    ),
  });

  const summary = await Promise.all(
    dueReminders.map(async (reminder) => {
      if (reminder.isSimulated) {
        console.log(
          "[cron] skipping simulated reminder; will never place a real call",
          { reminderId: reminder.id, userId: reminder.userId }
        );

        return {
          reminderId: reminder.id,
          called: false,
          reason: "simulated",
        };
      }

      const [email, user] = await Promise.all([
        db.query.emails.findFirst({ where: eq(emails.id, reminder.emailId) }),
        db.query.users.findFirst({ where: eq(users.id, reminder.userId) }),
      ]);

      if (!email || !user) {
        // Data integrity issue (deleted email/user) — mark unresolved so
        // it isn't retried forever with nothing to call about.
        await markReminderUnresolved(reminder.id);

        return {
          reminderId: reminder.id,
          called: false,
          reason: "unresolved",
        };
      }

      const gate = evaluateRealCallGate(user.phoneNumber, true);
      if (gate.action === "reject") {
        console.log("[cron] skipping reminder; recipient is not allowlisted", {
          reminderId: reminder.id,
          phoneNumber: maskPhoneNumber(user.phoneNumber),
          subject: redactContextText(email.subject),
        });
        return {
          reminderId: reminder.id,
          called: false,
          reason: "recipient_not_allowed",
        };
      }

      try {
        console.log("[cron] placing reminder call", {
          reminderId: reminder.id,
          phoneNumber: maskPhoneNumber(user.phoneNumber),
          subject: redactContextText(email.subject),
        });

        const call = await runReminderCall(
          user.phoneNumber,
          {
            sender: email.sender,
            subject: email.subject,
            summary: email.summary ?? email.subject,
          },
          { operatorAuthorized: true }
        );

        const unresolved = !isCalleResultResolved(call);

        await db.insert(callLogs).values({
          id: randomUUID(),
          userId: user.id,
          callType: "reminder",
          calleCallId: call.id,
          status: unresolved ? "unresolved" : call.status,
          structuredResult: JSON.stringify({
            acknowledged: unresolved ? null : call.acknowledged,
            unresolved,
          }),
        });

        if (unresolved) {
          console.log(
            "[cron] reminder call unresolved; will not auto-retry",
            {
              reminderId: reminder.id,
              callStatus: call.status,
              taskCompleted: call.taskCompleted,
            }
          );
          await markReminderUnresolved(reminder.id);

          return {
            reminderId: reminder.id,
            userId: user.id,
            name: user.name,
            called: false,
            reason: "unresolved",
            callStatus: call.status,
          };
        }

        await db
          .update(reminders)
          .set({ fired: true, status: "fired" })
          .where(eq(reminders.id, reminder.id));

        return {
          reminderId: reminder.id,
          userId: user.id,
          name: user.name,
          called: true,
          callStatus: call.status,
        };
      } catch (error) {
        console.error(
          "[cron] runReminderCall failed:",
          redactProviderError(error, {
            phones: [user.phoneNumber],
            sensitivePhrases: [
              email.subject,
              email.summary ?? "",
              email.decisionDetail ?? "",
            ].filter((value) => value.length > 0),
          })
        );

        await db.insert(callLogs).values({
          id: randomUUID(),
          userId: user.id,
          callType: "reminder",
          calleCallId: null,
          status: "unresolved",
          structuredResult: JSON.stringify({ unresolved: true }),
        });

        await markReminderUnresolved(reminder.id);

        return {
          reminderId: reminder.id,
          userId: user.id,
          name: user.name,
          called: false,
          reason: "unresolved",
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
 *    is still pending, each getting its own short reminder call —
 *    except simulated reminders, which are logged and skipped.
 */
export async function GET(request: NextRequest) {
  if (!isOperatorAuthorized(request)) {
    return NextResponse.json(
      { error: "Operator authorization is required." },
      { status: 401 }
    );
  }

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
