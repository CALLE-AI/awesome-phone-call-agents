"use client";

import { useEffect, useState } from "react";
import { TOPICS, type DailyBriefing, type SeniorProfile } from "@/lib/briefings/model";

const empty: SeniorProfile = {
  id: "", name: "", country: "", countryCode: "", region: "", locality: "", timezone: "",
  interests: [], topics: ["news", "activities", "interests", "benefits", "retirement"],
  prepareAt: "06:00", autoPrepare: false, consentToPersonalization: false,
  officialDomains: [], healthReminders: false, lastHealthCheck: "", agreedHealthFollowUp: "",
};
async function api(body: object) {
  const response = await fetch("/api/briefings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Briefing request failed");
  return result;
}
export function BriefingWorkspace() {
  const [profile, setProfile] = useState<SeniorProfile>(empty);
  const [profiles, setProfiles] = useState<SeniorProfile[]>([]);
  const [briefings, setBriefings] = useState<DailyBriefing[]>([]);
  const [interests, setInterests] = useState("");
  const [domains, setDomains] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [destination, setDestination] = useState("");
  const [review, setReview] = useState<{ task: string; briefingId: string; destination: string; key: string }>();
  const load = async () => { const result = await api({ action: "list" }); setProfiles(result.profiles); setBriefings(result.briefings); };
  useEffect(() => { let active = true; void api({ action: "list" }).then((result) => { if (active) { setProfiles(result.profiles); setBriefings(result.briefings); } }).catch((error) => { if (active) setMessage(error.message); }); return () => { active = false; }; }, []);
  const update = <K extends keyof SeniorProfile>(key: K, value: SeniorProfile[K]) => { setProfile((old) => ({ ...old, [key]: value })); setReview(undefined); };
  const select = (selected: SeniorProfile) => { setProfile(selected); setInterests(selected.interests.join(", ")); setDomains(selected.officialDomains.join(", ")); setReview(undefined); };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); } finally { setBusy(false); }
  };
  const latest = briefings.find((briefing) => briefing.profileId === profile.id);
  const dirty = JSON.stringify(profiles.find((item) => item.id === profile.id)) !== JSON.stringify({ ...profile, interests: interests.split(",").map((item) => item.trim()).filter(Boolean), officialDomains: domains.split(",").map((item) => item.trim()).filter(Boolean) });
  const field = (key: "id" | "name" | "country" | "countryCode" | "region" | "locality" | "timezone" | "prepareAt" | "lastHealthCheck" | "agreedHealthFollowUp", label: string, type = "text") => <label style={{ display: "grid", gap: 6 }}>{label}<input type={type} value={profile[key]} onChange={(event) => update(key, event.target.value)} required={["id", "name", "country", "countryCode", "locality", "timezone", "prepareAt"].includes(key)} /></label>;
  return <div style={{ display: "grid", gap: 24, paddingBlock: 24 }}>
    <p role="status">{message}</p>
    <label>Senior profile <select value={profiles.some((item) => item.id === profile.id) ? profile.id : ""} onChange={(event) => select(profiles.find((item) => item.id === event.target.value) || empty)}><option value="">New profile</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.locality}</option>)}</select></label>
    <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
      const saved = { ...profile, interests: interests.split(",").map((item) => item.trim()).filter(Boolean), officialDomains: domains.split(",").map((item) => item.trim()).filter(Boolean) };
      await api({ action: "save", profile: saved }); select(saved); await load(); setMessage("Profile saved. Saving does not place or schedule a call.");
    }); }}>
      <fieldset disabled={busy} style={{ display: "grid", gap: 16 }}><legend>What matters to this senior</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          {field("id", "Profile ID (for example, senior-1)")}{field("name", "Preferred name")}
          {field("country", "Country")}{field("countryCode", "Country code (AU, GB, etc.)")}
          {field("region", "State / region")}{field("locality", "City / suburb")}
          {field("timezone", "Timezone (for example, Australia/Sydney)")}{field("prepareAt", "Prepare from this local time", "time")}
        </div>
        <label>Interests, separated by commas<input value={interests} onChange={(event) => { setInterests(event.target.value); setReview(undefined); }} placeholder="gardening, cricket, history, walking" /></label>
        <div>{TOPICS.map((topic) => <label key={topic} style={{ marginRight: 16 }}><input type="checkbox" checked={profile.topics.includes(topic)} onChange={(event) => update("topics", event.target.checked ? [...profile.topics, topic] : profile.topics.filter((item) => item !== topic))} /> {topic}</label>)}</div>
        <label>Official benefit / retirement source domains<input value={domains} onChange={(event) => { setDomains(event.target.value); setReview(undefined); }} placeholder="Official government or regulator hostnames, comma separated" /></label>
        <p>Australian profiles include Services Australia, ATO and Moneysmart sources. For other countries, add verified local government or regulator domains. Australian rules will not be used for another country.</p>
        <label><input type="checkbox" checked={profile.healthReminders} onChange={(event) => update("healthReminders", event.target.checked)} /> Include gentle health follow-up prompts</label>
        {profile.healthReminders && <><p>Only enter dates provided by the senior or an authorized carer. A missing date does not mean a check is overdue. No diagnosis, bookings or medical-record access.</p>{field("lastHealthCheck", "Last known health check (optional)", "date")}{field("agreedHealthFollowUp", "Agreed clinician follow-up date (optional)", "date")}</>}
        <label><input type="checkbox" checked={profile.consentToPersonalization} onChange={(event) => update("consentToPersonalization", event.target.checked)} /> The senior or authorized carer agrees to store these details for personalized briefings</label>
        <label><input type="checkbox" checked={profile.autoPrepare} onChange={(event) => update("autoPrepare", event.target.checked)} /> Prepare daily at the local time above (internet searches only; may incur API usage)</label>
        <p>Automatic preparation runs while this local Next.js server is running. No calls are made automatically. Turn off daily preparation or delete the profile to stop future preparation.</p>
        <button type="submit">Save profile</button>
      </fieldset>
    </form>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
      <button disabled={busy || dirty || !profiles.some((item) => item.id === profile.id)} onClick={() => { setReview(undefined); void run(async () => { await api({ action: "prepare", id: profile.id, refresh: true }); await load(); setMessage("Briefing prepared. Review the sources and any unavailable topics below."); }); }}>Prepare fresh briefing</button>
      <button disabled={busy} onClick={() => { void run(load); }}>Refresh list</button>
      <button disabled={busy || !profile.id} onClick={() => { void run(async () => { await api({ action: "delete", id: profile.id }); select(empty); await load(); setMessage("Profile and its stored briefings deleted."); }); }}>Delete profile and briefings</button>
    </div>
    {latest && <section><h2>Morning briefing — {latest.localDate}</h2><p>{latest.status} · {latest.timezone} · Prepared {latest.preparedAt}</p>
      {latest.sections.map((section) => <article key={section.topic} style={{ paddingBlock: 12 }}><h3>{section.topic} — {section.status}</h3><p style={{ whiteSpace: "pre-wrap" }}>{section.answer}</p><ul>{section.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a></li>)}</ul></article>)}
      {latest.healthPrompt && <article><h3>Optional health conversation prompt</h3><p>{latest.healthPrompt}</p></article>}
      <p>This is prepared information. The telephone agent cannot search new topics during the call.</p>
      <label>Authorized destination (E.164)<input value={destination} onChange={(event) => { setDestination(event.target.value); setReview(undefined); }} placeholder="+61…" /></label>
      <button disabled={busy || dirty || latest.status === "unavailable"} onClick={() => { void run(async () => {
        const phone = destination.trim(); if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new Error("Enter the authorized destination in E.164 format");
        const result = await api({ action: "review", id: latest.id }); setReview({ task: result.task, briefingId: latest.id, destination: phone, key: crypto.randomUUID() });
      }); }}>Review briefing call</button>
    </section>}
    {review && <section className="notice"><h2>Confirm one briefing call</h2><p>Call phone ending {review.destination.slice(-4)} using the briefing reviewed below. Confirm only if this recipient has agreed to this call.</p>
      <details><summary>Exact call instructions</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.task}</pre></details>
      <button disabled={busy} onClick={() => { void run(async () => {
        const response = await fetch("/api/calls/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destinationE164: review.destination, purpose: "Discuss the prepared morning briefing.", idempotencyKey: review.key, briefingId: review.briefingId, confirmed: true }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || "Call request failed");
        setReview(undefined); setDestination(""); setMessage("CALL-E accepted the briefing call. Open the call monitor to follow its status.");
      }); }}>Confirm and place one call</button>
      <button disabled={busy} onClick={() => setReview(undefined)}>Cancel review</button>
    </section>}
  </div>;
}
