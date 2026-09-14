"use client";

import { useState, type FormEvent } from "react";

interface DemoUser {
  id: string;
  name: string;
  phoneNumber: string;
}

interface DigestEmailResult {
  id: string;
  sender: string;
  subject: string;
  decision: string | null;
  decisionDetail: string | null;
}

interface DigestCallResponse {
  call: {
    id: string | null;
    status: string;
    taskCompleted: boolean | null;
    evidence: string[];
  };
  emails: DigestEmailResult[];
}

interface ReminderItem {
  id: string;
  remindAt: string;
  email: {
    id: string;
    subject: string;
    summary: string | null;
    sender: string;
  };
}

const DECISION_LABEL: Record<string, string> = {
  none: "No action needed",
  remind: "Reminder set",
  followup: "Follow-up requested",
};

async function postJson<T>(url: string, body: unknown): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

async function fetchReminders(userId: string): Promise<ReminderItem[]> {
  const res = await fetch(`/api/users/${userId}/reminders`);
  if (!res.ok) return [];
  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

export default function Home() {
  // Step 1: create demo user.
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [user, setUser] = useState<DemoUser | null>(null);

  // Step 2a: call me now.
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const [callResult, setCallResult] = useState<DigestCallResponse | null>(null);

  // Step 2b: schedule daily call.
  const [callTime, setCallTime] = useState("13:00");
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<string | null>(null);

  // Upcoming reminders, refreshed after signup and after every call.
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [remindersLoading, setRemindersLoading] = useState(false);

  async function refreshReminders(userId: string) {
    setRemindersLoading(true);
    const items = await fetchReminders(userId);
    setReminders(items);
    setRemindersLoading(false);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);

    const { ok, data } = await postJson<DemoUser>("/api/users/create", {
      name,
      phoneNumber,
    });

    if (!ok) {
      setCreateError(data.error ?? "Something went wrong. Please try again.");
    } else {
      setUser(data);
      void refreshReminders(data.id);
    }

    setCreating(false);
  }

  async function handleCallNow() {
    if (!user) return;
    setCalling(true);
    setCallError(null);
    setCallResult(null);

    const { ok, data } = await postJson<DigestCallResponse>(
      "/api/calle/digest",
      { userId: user.id }
    );

    if (!ok) {
      setCallError(data.error ?? "Something went wrong. Please try again.");
    } else {
      setCallResult(data);
      void refreshReminders(user.id);
    }

    setCalling(false);
  }

  async function handleSetSchedule() {
    if (!user) return;
    setScheduling(true);
    setScheduleError(null);
    setScheduleMessage(null);

    const { ok, data } = await postJson(`/api/users/${user.id}/schedule`, {
      callTime,
    });

    if (!ok) {
      setScheduleError(data.error ?? "Something went wrong. Please try again.");
    } else {
      setScheduleMessage(
        `You're all set. Gimme Updates will call you at ${callTime} daily.`
      );
    }

    setScheduling(false);
  }

  const isDryRunCall = callResult?.call.id?.startsWith("dry-run-") ?? false;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Gimme Updates
          </h1>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This demo uses sample emails (a bill, a loan reminder, a
            government notice, and more) to show how Gimme Updates works.
            Imagine these pulled from your real inbox.
          </p>
          <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            This is a working demo built on CALL-E. It currently runs on
            sample emails to show how the flow works end to end. The plan
            is to connect it to a real inbox next.
          </p>
        </div>

        {!user ? (
          <form
            onSubmit={handleCreate}
            className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="space-y-1">
              <label
                htmlFor="name"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="phoneNumber"
                className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                Phone number
              </label>
              <input
                id="phoneNumber"
                type="tel"
                required
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+91XXXXXXXXXX"
                className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </div>

            {createError && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {createError}
              </p>
            )}

            <button
              type="submit"
              disabled={creating}
              className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
            >
              {creating ? "Creating…" : "Create My Demo"}
            </button>
          </form>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-700 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              Hi <span className="font-medium text-black dark:text-zinc-50">{user.name}</span>
              , your demo inbox is ready with 5 sample emails.
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                Call me now
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Trigger a digest call right away to hear how it works.
              </p>

              <button
                type="button"
                onClick={handleCallNow}
                disabled={calling}
                className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                {calling
                  ? "Calling you now, please answer your phone"
                  : "Call Me Now"}
              </button>

              {callError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {callError}
                </p>
              )}

              {callResult && (
                <div className="space-y-2 rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-950">
                  {isDryRunCall && (
                    <p className="font-medium text-amber-600 dark:text-amber-400">
                      This is a simulated call. CALLE_DRY_RUN is on, so no
                      real phone call was placed.
                    </p>
                  )}
                  <p className="text-zinc-600 dark:text-zinc-400">
                    Call status:{" "}
                    <span className="font-medium text-black dark:text-zinc-50">
                      {callResult.call.status}
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {callResult.emails.map((email) => (
                      <li
                        key={email.id}
                        className="text-zinc-700 dark:text-zinc-300"
                      >
                        <span className="font-medium">{email.subject}</span>
                        {": "}
                        {DECISION_LABEL[email.decision ?? ""] ??
                          "No action needed"}
                        {email.decisionDetail
                          ? ` (${email.decisionDetail})`
                          : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                Upcoming reminders
              </h2>

              {remindersLoading ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Loading…
                </p>
              ) : reminders.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  No reminders scheduled yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {reminders.map((reminder) => (
                    <li key={reminder.id} className="text-sm">
                      <div className="font-medium text-black dark:text-zinc-50">
                        {reminder.email.subject}
                      </div>
                      {reminder.email.summary && (
                        <div className="text-zinc-600 dark:text-zinc-400">
                          {reminder.email.summary}
                        </div>
                      )}
                      <div className="text-xs text-zinc-500 dark:text-zinc-500">
                        {new Date(reminder.remindAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                Schedule a daily call
              </h2>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Pick a time and Gimme Updates will call you every day at
                that time.
              </p>

              <div className="flex gap-2">
                <input
                  type="time"
                  value={callTime}
                  onChange={(e) => setCallTime(e.target.value)}
                  className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm text-black outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
                />
                <button
                  type="button"
                  onClick={handleSetSchedule}
                  disabled={scheduling}
                  className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  {scheduling ? "Saving…" : "Set Schedule"}
                </button>
              </div>

              {scheduleError && (
                <p className="text-sm text-red-600 dark:text-red-400">
                  {scheduleError}
                </p>
              )}

              {scheduleMessage && (
                <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                  {scheduleMessage}
                </p>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
