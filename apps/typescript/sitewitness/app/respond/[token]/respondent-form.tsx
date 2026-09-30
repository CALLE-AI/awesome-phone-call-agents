"use client";

import { useEffect, useState } from "react";

const sourceOptions = ["Direct observation", "Personal action", "Document reference", "Hearsay", "Assumption", "Unknown"];
const confidenceOptions = ["Confirmed", "Probable", "Uncertain", "Not known"];

export default function RespondentForm({ token }: { token: string }) {
  const [request, setRequest] = useState<{ summary: string; due_at?: string } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "submitted" | "error">("loading");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({
    name: "Morgan Lee", role: "Former property manager", knowledge_start: "1991", knowledge_end: "1996",
    operations_answer: "", operations_source: "Direct observation", operations_confidence: "Confirmed",
    storage_answer: "", storage_source: "Direct observation", storage_confidence: "Uncertain",
    limitations: "", acknowledged: false,
  });
  useEffect(() => {
    fetch(`/api/respondent?token=${encodeURIComponent(token)}`)
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || "This request is unavailable.");
        setRequest(data.request);
        setState(data.submitted ? "submitted" : "ready");
        if (data.submitted) setMessage(`Response submitted ${new Date(data.submitted_at).toLocaleString()}.`);
      })
      .catch((error) => { setMessage(error.message); setState("error"); });
  }, [token]);
  const update = (key: string, value: string | boolean) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    setMessage("");
    const response = await fetch("/api/respondent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, ...form }) });
    const data = (await response.json()) as { error?: string; submitted_at?: string };
    if (!response.ok) { setMessage(data.error || "The response could not be submitted."); return; }
    setState("submitted");
    setMessage(`Response submitted ${new Date(data.submitted_at!).toLocaleString()}.`);
  };
  if (state === "loading") return <main className="respondentPage"><p>Opening secure request…</p></main>;
  if (state === "error") return <main className="respondentPage"><section className="respondentCard"><h1>Request unavailable</h1><p>{message}</p></section></main>;
  if (state === "submitted") return <main className="respondentPage"><section className="respondentCard submittedCard"><span className="submissionCheck">✓</span><p className="eyebrow">RESPONSE RECEIVED</p><h1>Thank you, Morgan.</h1><p>{message}</p><p>Your original answers have been preserved and sent to the Environmental Professional review queue. They remain pending until a reviewer acts.</p></section></main>;
  return (
    <main className="respondentPage">
      <header className="respondentHeader"><span className="brandMark">SW</span><div><strong>SiteWitness</strong><small>Secure factual response</small></div></header>
      <section className="respondentCard">
        <p className="eyebrow">MERIDIAN ENVIRONMENTAL · 47 BAKER STREET</p>
        <h1>Share what you personally know</h1>
        <p className="respondentIntro">You are being contacted to clarify historical property records. SiteWitness collects factual information; it does not determine liability, property condition, or whether investigation is required.</p>
        <div className="requestScope"><strong>Why you were contacted</strong><p>{request?.summary}</p>{request?.due_at && <small>Requested by {new Date(request.due_at).toLocaleDateString()}</small>}</div>
        <fieldset><legend>About your knowledge</legend><div className="formPair"><label>Your name<input value={form.name} onChange={(e) => update("name", e.target.value)} /></label><label>Your role at the property<input value={form.role} onChange={(e) => update("role", e.target.value)} /></label></div><div className="formPair"><label>Knowledge began<input type="number" value={form.knowledge_start} onChange={(e) => update("knowledge_start", e.target.value)} /></label><label>Knowledge ended<input type="number" value={form.knowledge_end} onChange={(e) => update("knowledge_end", e.target.value)} /></label></div></fieldset>
        <Question number="01" title="Operations before 1991" prompt="What, if anything, do you personally know about garment-cleaning operations at 47 Baker Street before 1991?" answer={form.operations_answer} source={form.operations_source} confidence={form.operations_confidence} onAnswer={(v) => update("operations_answer", v)} onSource={(v) => update("operations_source", v)} onConfidence={(v) => update("operations_confidence", v)} />
        <Question number="02" title="Rear storage room" prompt="What, if anything, did you personally observe about the use or contents of the rear storage room?" answer={form.storage_answer} source={form.storage_source} confidence={form.storage_confidence} onAnswer={(v) => update("storage_answer", v)} onSource={(v) => update("storage_source", v)} onConfidence={(v) => update("storage_confidence", v)} />
        <label className="wideLabel">Limitations or additional context<textarea value={form.limitations} onChange={(e) => update("limitations", e.target.value)} placeholder="Describe areas you could not access, dates you cannot confirm, or information learned from someone else." /></label>
        <label className="respondentAck"><input aria-label="Confirm response accuracy" type="checkbox" checked={form.acknowledged} onChange={(e) => update("acknowledged", e.target.checked)} /><span><strong>I confirm this response accurately reflects my knowledge.</strong><small>I have identified the basis and limits of my answers and understand they will be reviewed by an Environmental Professional.</small></span></label>
        {message && <div className="formError" role="alert">{message}</div>}
        <button className="primary respondentSubmit" disabled={!form.acknowledged} onClick={submit}>Submit secure response <span>→</span></button>
      </section>
    </main>
  );
}

function Question(p: { number: string; title: string; prompt: string; answer: string; source: string; confidence: string; onAnswer: (v: string) => void; onSource: (v: string) => void; onConfidence: (v: string) => void }) {
  return <fieldset className="responseQuestion"><legend><span>{p.number}</span>{p.title}</legend><p>{p.prompt}</p><label>Your answer<textarea value={p.answer} onChange={(e) => p.onAnswer(e.target.value)} /></label><div className="formPair"><label>Basis of answer<select value={p.source} onChange={(e) => p.onSource(e.target.value)}>{sourceOptions.map((x) => <option key={x}>{x}</option>)}</select></label><label>How certain are you?<select value={p.confidence} onChange={(e) => p.onConfidence(e.target.value)}>{confidenceOptions.map((x) => <option key={x}>{x}</option>)}</select></label></div></fieldset>;
}
