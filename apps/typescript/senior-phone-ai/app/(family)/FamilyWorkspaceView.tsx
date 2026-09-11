import Link from "next/link";

import { loadCurrentFamilyWorkspace } from "@/lib/dashboard/load";
import { lastCompletedCall } from "@/lib/dashboard/workspace";

import { CancelReminderButton, PreferenceControls, ProfileControls } from "./FamilyControls";
import styles from "./family.module.css";

type Section = "dashboard" | "seniors" | "senior" | "reminders" | "settings";

function when(value?: string) {
  return value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not recorded";
}

export async function FamilyWorkspaceView({ section, seniorId }: { section: Section; seniorId?: string }) {
  let workspace;
  try {
    workspace = await loadCurrentFamilyWorkspace();
  } catch {
    return (
      <main className={`${styles.card} ${styles.error}`}>
        <p className={styles.eyebrow}>Private family workspace</p>
        <h1>Sign in required</h1>
        <p>No family data is shown without a verified Supabase session. Check the Supabase configuration and sign in before opening this page.</p>
      </main>
    );
  }

  if (!workspace.seniors.length) return <main className={styles.card}><h1>No shared profiles</h1><p className={styles.empty}>Your account has no active senior membership.</p></main>;
  const selected = seniorId ? workspace.seniors.find((senior) => senior.id === seniorId) : undefined;
  if (section === "senior" && !selected) return <main className={`${styles.card} ${styles.error}`}><h1>Profile unavailable</h1><p>This profile is outside your authorized memberships or does not exist.</p></main>;

  if (section === "seniors") return (
    <main className={styles.stack}>
      <header className={styles.hero}><p className={styles.eyebrow}>Authorized profiles</p><h1>Seniors</h1><p>Only active memberships returned through row-level security appear here.</p></header>
      <div className={styles.grid}>{workspace.seniors.map((senior) => (
        <article className={styles.card} key={senior.id}><h2>{senior.displayName}</h2><p>{senior.approximateLocation ?? "Location not shared"} · {senior.timezone}</p><div className={styles.actions}><Link href={`/seniors/${senior.id}`}>View profile</Link></div></article>
      ))}</div>
    </main>
  );

  if (section === "senior" && selected) {
    const membership = workspace.memberships.find((item) => item.seniorId === selected.id);
    const contacts = workspace.contacts.filter((item) => item.seniorId === selected.id);
    const completed = lastCompletedCall(workspace.calls, selected.id);
    return (
      <main className={styles.stack}>
        <header className={styles.hero}><p className={styles.eyebrow}>Shared profile</p><h1>{selected.displayName}</h1><p>{selected.approximateLocation ?? "Location not shared"} · {selected.timezone}</p></header>
        <div className={styles.grid}>
          <section className={styles.card}><h2>Access</h2><p><span className={styles.pill}>{membership?.role}</span></p><p className={styles.muted}>Call content: {membership?.canViewCallContent ? "approved" : "not approved"}<br />Reminder management: {membership?.canManageReminders ? "approved" : "not approved"}</p></section>
          <section className={styles.card}><h2>Last completed call</h2><p>{when(completed?.endedAt)}</p><p className={styles.muted}>This timestamp comes from a completed call record. It is not a wellness assessment.</p></section>
          <section className={styles.card}><h2>Interests</h2>{selected.interests.length ? <ul className={styles.list}>{selected.interests.map((interest) => <li key={interest}>{interest}</li>)}</ul> : <p className={styles.empty}>No interests shared.</p>}</section>
          <section className={styles.card}><h2>Trusted contacts</h2>{contacts.length ? <ul className={styles.list}>{contacts.map((contact) => <li key={contact.id}>{contact.displayName} ({contact.relationship ?? "relationship not set"}) · {contact.destination}</li>)}</ul> : <p className={styles.empty}>No trusted contacts.</p>}</section>
          {membership?.role === "owner" ? <section className={styles.card}><ProfileControls senior={selected} /></section> : null}
        </div>
      </main>
    );
  }

  if (section === "reminders") return (
    <main className={styles.stack}><header className={styles.hero}><p className={styles.eyebrow}>Confirmed actions</p><h1>Reminders</h1><p>Scheduled times use each reminder&apos;s recorded timezone.</p></header><section className={styles.card}>
      {workspace.reminders.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>When</th><th>Message</th><th>Destination</th><th>Channel</th><th>Status</th><th>Action</th></tr></thead><tbody>{workspace.reminders.map((reminder) => { const membership = workspace.memberships.find((item) => item.seniorId === reminder.seniorId); return <tr key={reminder.id}><td>{when(reminder.scheduledFor)}<br /><span className={styles.muted}>{reminder.timezone}</span></td><td>{reminder.message}</td><td>{reminder.destination}</td><td>{reminder.channel}</td><td><span className={styles.pill}>{reminder.status}</span></td><td>{reminder.status === "pending" && membership?.canManageReminders ? <CancelReminderButton reminderId={reminder.id} seniorId={reminder.seniorId} /> : "—"}</td></tr>; })}</tbody></table></div> : <p className={styles.empty}>No reminders are available.</p>}
    </section></main>
  );

  if (section === "settings") return (
    <main className={styles.stack}><header className={styles.hero}><p className={styles.eyebrow}>Consent and retention</p><h1>Settings</h1><p>These values reflect each senior&apos;s approved storage policy.</p></header><div className={styles.grid}>{workspace.seniors.map((senior) => { const preference = workspace.preferences.find((item) => item.seniorId === senior.id); const membership = workspace.memberships.find((item) => item.seniorId === senior.id); return <section className={styles.card} key={senior.id}><h2>{senior.displayName}</h2>{membership?.role === "owner" ? <PreferenceControls seniorId={senior.id} preference={preference} /> : <><p>Store summaries: <strong>{preference?.storeSummaries ? "Yes" : "No"}</strong></p><p>Store transcripts: <strong>{preference?.storeTranscripts ? "Yes" : "No"}</strong></p><p>Retention: <strong>{preference?.retentionDays ?? "Not configured"} days</strong></p><p className={styles.muted}>Only an owner can change these consent settings.</p></>}</section>; })}</div></main>
  );

  return (
    <main className={styles.stack}>
      <header className={styles.hero}><p className={styles.eyebrow}>Family and carer dashboard</p><h1>Shared call activity</h1><p>Private records are filtered by your verified membership and displayed with phone numbers masked.</p></header>
      <div className={styles.grid}>{workspace.seniors.map((senior) => { const completed = lastCompletedCall(workspace.calls, senior.id); return <article className={styles.card} key={senior.id}><h2>{senior.displayName}</h2><p><strong>Last completed call:</strong> {when(completed?.endedAt)}</p><p>{completed?.summary ?? "No retained summary is available."}</p><p className={styles.muted}>This is a recorded call event, not a health or loneliness score.</p><div className={styles.actions}><Link href={`/seniors/${senior.id}`}>Open profile</Link></div></article>; })}</div>
      <section className={styles.card}><h2>Recent calls</h2>{workspace.calls.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Started</th><th>Status</th><th>Retained summary</th></tr></thead><tbody>{workspace.calls.map((call) => <tr key={call.id}><td>{when(call.startedAt)}</td><td><span className={styles.pill}>{call.status}</span></td><td>{call.summary ?? "No retained summary"}</td></tr>)}</tbody></table></div> : <p className={styles.empty}>No call records are available.</p>}</section>
      <section className={styles.card}><h2>Recent confirmed actions</h2>{workspace.actions.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Action</th><th>Purpose</th><th>Destination</th><th>State</th></tr></thead><tbody>{workspace.actions.map((action) => <tr key={action.id}><td>{action.action}</td><td>{action.purpose}</td><td>{action.destination}</td><td><span className={styles.pill}>{action.state}</span></td></tr>)}</tbody></table></div> : <p className={styles.empty}>No confirmed actions are available.</p>}</section>
      <section className={styles.card}><h2>SMS delivery</h2>{workspace.sms.length ? <ul className={styles.list}>{workspace.sms.map((message) => <li key={message.id}>{message.purpose}: <span className={styles.pill}>{message.status}</span></li>)}</ul> : <p className={styles.empty}>No SMS delivery records.</p>}</section>
    </main>
  );
}
