"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

async function mutate(body: Record<string, unknown>) {
  const response = await fetch("/api/family/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "The change could not be saved");
}

export function ProfileControls({ senior }: { senior: { id: string; displayName: string; timezone: string; approximateLocation?: string } }) {
  const router = useRouter(); const [message, setMessage] = useState<string>();
  return <form onSubmit={async (event) => { event.preventDefault(); setMessage("Saving…"); const data = new FormData(event.currentTarget); try { await mutate({ action: "update_profile", seniorId: senior.id, displayName: data.get("displayName"), timezone: data.get("timezone"), approximateLocation: data.get("location") }); setMessage("Profile saved."); router.refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The change could not be saved"); } }}><h2>Manage profile</h2><p><label>Display name<br /><input name="displayName" defaultValue={senior.displayName} maxLength={100} required /></label></p><p><label>IANA timezone<br /><input name="timezone" defaultValue={senior.timezone} maxLength={100} required /></label></p><p><label>Approximate location<br /><input name="location" defaultValue={senior.approximateLocation} maxLength={160} /></label></p><button type="submit">Save approved profile</button>{message ? <p role="status">{message}</p> : null}</form>;
}

export function PreferenceControls({ seniorId, preference }: { seniorId: string; preference?: { storeSummaries: boolean; storeTranscripts: boolean; retentionDays: number } }) {
  const router = useRouter(); const [message, setMessage] = useState<string>();
  return <form onSubmit={async (event) => { event.preventDefault(); setMessage("Saving…"); const data = new FormData(event.currentTarget); try { await mutate({ action: "update_preferences", seniorId, storeSummaries: data.get("summaries") === "on", storeTranscripts: data.get("transcripts") === "on", retentionDays: Number(data.get("retention")) }); setMessage("Preferences saved."); router.refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The change could not be saved"); } }}><p><label><input name="summaries" type="checkbox" defaultChecked={preference?.storeSummaries} /> Retain call summaries with consent</label></p><p><label><input name="transcripts" type="checkbox" defaultChecked={preference?.storeTranscripts} /> Retain transcripts with consent</label></p><p><label>Retention days<br /><input name="retention" type="number" min={1} max={365} defaultValue={preference?.retentionDays ?? 30} required /></label></p><button type="submit">Save approved preferences</button>{message ? <p role="status">{message}</p> : null}</form>;
}

export function CancelReminderButton({ reminderId, seniorId }: { reminderId: string; seniorId: string }) {
  const router = useRouter(); const [message, setMessage] = useState<string>();
  return <><button type="button" onClick={async () => { setMessage("Canceling…"); try { await mutate({ action: "cancel_reminder", reminderId, seniorId }); setMessage("Reminder canceled."); router.refresh(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The reminder could not be canceled"); } }}>Cancel</button>{message ? <span role="status"> {message}</span> : null}</>;
}
