"use client";

import {
  ArrowRight, BookOpen, Building2, Check, ChevronDown, CircleAlert,
  Database, FileText, Link2, LoaderCircle, LogOut, Menu, Mic2, PhoneCall,
  Plus, Radio, Search, Settings2, ShieldCheck, Sparkles, UploadCloud, UserPlus,
  Users, X,
} from "lucide-react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { browserSupabase } from "../lib/supabase";
import { chunksOf } from "../lib/source-indexing";

type Company = { id: string; name: string; description: string; timezone: string; current_version: number; role: string };
type Member = { id: string; user_id: string | null; email: string; display_name: string; role: string; role_label: string; status: string; region: string; locale: string; timezone: string; phone_last_four: string | null; call_consent: boolean; last_briefed_version: number };
type Invite = { id: string; email: string; display_name: string; role: string; role_label: string; region: string; token: string; expires_at: string; accepted_at: string | null };
type Source = { id: string; kind: string; label: string; index_status: string; chunk_count: number; byte_size: number; mime_type: string | null; storage_path: string | null; created_at: string };
type Memory = { id: string; version: number; kind: string; title: string; body: string; status: string; confidence: number; created_at: string; author_member_id: string | null };
type CallSession = { id: string; mode: string; provider: string; status: string; provider_call_id: string | null; requested_at: string; member_id: string };
type CompanyJoin = { role: string; companies: Omit<Company, "role"> | Array<Omit<Company, "role">> | null };
type View = "overview" | "sources" | "memory" | "people" | "calls";
type Modal = null | "company" | "invite" | "source" | "profile" | "call";
type CallMode = "deposit" | "catchup" | "ask";

const regionOptions = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"],
  ["SG", "Singapore"], ["MY", "Malaysia"], ["AU", "Australia"], ["CA", "Canada"], ["DE", "Germany"],
  ["FR", "France"], ["JP", "Japan"], ["MX", "Mexico"], ["BR", "Brazil"], ["ID", "Indonesia"],
  ["PH", "Philippines"], ["KE", "Kenya"], ["ZA", "South Africa"], ["OTHER", "Other"],
];
const supportedRegions = new Set(["US","SG","MY","IN","AE","AU","CA","GB","VN","DE","JP","FR","MX","BR","ID","PH","KE"]);
const modeCopy: Record<CallMode, { label: string; description: string; icon: typeof Mic2 }> = {
  deposit: { label: "Deposit an update", description: "Interview this founder and turn what changed into evidence-linked company memory.", icon: Mic2 },
  catchup: { label: "Catch them up", description: "Brief only the decisions, blockers and facts they have not acknowledged.", icon: Radio },
  ask: { label: "Ask a team question", description: "Carry an unresolved question to the teammate who can answer it.", icon: Users },
};

function initials(name: string) { return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); }
function timeAgo(value: string) {
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
async function apiFetch(session: Session, path: string, body?: object) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${session.access_token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "That request could not be completed.");
  return result;
}

export function AsyncFoundersConsole() {
  const supabase = useMemo(() => browserSupabase(), []);
  const [session, setSession] = useState<Session | null | undefined>(() => supabase ? undefined : null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase) return <ConfigurationScreen />;
  if (session === undefined) return <LoadingScreen />;
  if (!session) return <AuthScreen supabase={supabase} />;
  return <WorkspaceApp supabase={supabase} session={session} />;
}

function LoadingScreen() {
  return <main className="center-screen"><span className="signal-mark"><i /><i /><i /></span><LoaderCircle className="spin" /><p>Opening your company memory…</p></main>;
}

function ConfigurationScreen() {
  return <main className="setup-screen"><div className="setup-card"><span className="eyebrow">DEPLOYMENT READY · CONNECTION PENDING</span><h1>Your company brain is ready to connect.</h1><p>Add the Supabase URL, public key and server key to activate accounts, isolated companies and persistent uploads. Add the CALL-E key to activate real callbacks.</p><div className="setup-list"><span><Check /> Multi-tenant product built</span><span><Check /> Row-level isolation prepared</span><span><Check /> CALL-E adapter installed</span></div></div></main>;
}

function AuthScreen({ supabase }: { supabase: SupabaseClient }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { display_name: form.name } } });
        if (error) throw error;
        if (!data.session) setMessage("Check your email to confirm the account, then sign in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password });
        if (error) throw error;
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Authentication failed."); }
    finally { setBusy(false); }
  }

  return <main className="auth-shell">
    <section className="auth-story"><a className="wordmark" href="#"><span className="signal-mark"><i /><i /><i /></span><strong>asyncfounders</strong><b>.</b></a><div><span className="eyebrow">THE ASYNC COMPANY MIDDLEMAN</span><h1>Talk once.<br />The company <em>remembers.</em></h1><p>Create a private company brain. Add your founders. Let each person speak when they are free—and keep the team on one inspectable version of reality.</p></div><div className="auth-proof"><span><ShieldCheck /> Isolated company workspaces</span><span><Database /> Source-backed memory</span><span><PhoneCall /> Real AI callbacks with consent</span></div></section>
    <section className="auth-panel"><div className="auth-card"><span className="eyebrow">{mode === "signup" ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span><h2>{mode === "signup" ? "Start a company brain" : "Return to your teams"}</h2><p>{mode === "signup" ? "No demo team. Your workspace starts clean." : "Sign in to continue where your team left off."}</p><form onSubmit={submit}>{mode === "signup" && <label>Your name<input required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ada Lovelace" /></label>}<label>Work email<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="you@company.com" /></label><label>Password<input required type="password" minLength={8} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="At least 8 characters" /></label>{message && <div className="form-message"><CircleAlert size={15} />{message}</div>}<button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : mode === "signup" ? "Create account" : "Sign in"}<ArrowRight /></button></form><button className="text-button" onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setMessage(""); }}>{mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}</button></div></section>
  </main>;
}

function WorkspaceApp({ supabase, session }: { supabase: SupabaseClient; session: Session }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [calls, setCalls] = useState<CallSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<Modal>(null);
  const [view, setView] = useState<View>("overview");
  const [companyMenu, setCompanyMenu] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [toast, setToast] = useState("");
  const company = companies.find((item) => item.id === companyId) ?? companies[0];

  const flash = useCallback((text: string) => { setToast(text); window.setTimeout(() => setToast(""), 3200); }, []);
  const loadCompanies = useCallback(async () => {
    const { data, error } = await supabase.from("company_members").select("role, companies(id,name,description,timezone,current_version)").eq("user_id", session.user.id).eq("status", "active");
    if (error) throw error;
    const rows = (data ?? []) as unknown as CompanyJoin[];
    const next = rows.flatMap((row) => {
      const records = Array.isArray(row.companies) ? row.companies : row.companies ? [row.companies] : [];
      return records.map((item) => ({ ...item, role: row.role }));
    });
    setCompanies(next);
    setCompanyId((current) => next.some((item) => item.id === current) ? current : next[0]?.id ?? "");
    return next;
  }, [session.user.id, supabase]);

  const loadWorkspace = useCallback(async (id: string) => {
    if (!id) { setMembers([]); setInvites([]); setSources([]); setMemories([]); setCalls([]); return; }
    const [memberRes, inviteRes, sourceRes, memoryRes, callRes] = await Promise.all([
      supabase.from("company_members").select("id,user_id,email,display_name,role,role_label,status,region,locale,timezone,phone_last_four,call_consent,last_briefed_version").eq("company_id", id).order("created_at"),
      supabase.from("company_invites").select("id,email,display_name,role,role_label,region,token,expires_at,accepted_at").eq("company_id", id).is("accepted_at", null).order("created_at", { ascending: false }),
      supabase.from("sources").select("id,kind,label,index_status,chunk_count,byte_size,mime_type,storage_path,created_at").eq("company_id", id).order("created_at", { ascending: false }),
      supabase.from("memory_items").select("id,version,kind,title,body,status,confidence,created_at,author_member_id").eq("company_id", id).order("version", { ascending: false }).limit(80),
      supabase.from("call_sessions").select("id,mode,provider,status,provider_call_id,requested_at,member_id").eq("company_id", id).order("requested_at", { ascending: false }).limit(40),
    ]);
    const issue = [memberRes, inviteRes, sourceRes, memoryRes, callRes].find((item) => item.error)?.error;
    if (issue) throw issue;
    setMembers((memberRes.data ?? []) as Member[]); setInvites((inviteRes.data ?? []) as Invite[]); setSources((sourceRes.data ?? []) as Source[]); setMemories((memoryRes.data ?? []) as Memory[]); setCalls((callRes.data ?? []) as CallSession[]);
  }, [supabase]);

  useEffect(() => { void Promise.resolve().then(() => loadCompanies()).catch((error) => flash(error.message)).finally(() => setLoading(false)); }, [flash, loadCompanies]);
  useEffect(() => { if (companyId) void Promise.resolve().then(() => loadWorkspace(companyId)).catch((error) => flash(error.message)); }, [companyId, flash, loadWorkspace]);
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("invite");
    if (!token) return;
    supabase.rpc("accept_invite", { invite_token: token }).then(({ error }) => {
      if (error) flash(error.message); else { flash("Invite accepted. Welcome to the company."); loadCompanies(); }
      history.replaceState({}, "", window.location.pathname);
    });
  }, [flash, loadCompanies, supabase]);

  if (loading) return <LoadingScreen />;
  if (!companies.length) return <EmptyOnboarding supabase={supabase} session={session} onCreated={async () => { await loadCompanies(); }} />;

  const currentMember = members.find((member) => member.user_id === session.user.id);
  const unseen = Math.max(0, (company?.current_version ?? 0) - (currentMember?.last_briefed_version ?? 0));
  const openDecisions = memories.filter((memory) => ["decision", "conflict", "question"].includes(memory.kind) && !["resolved", "answered", "dismissed"].includes(memory.status));

  return <div className="product-shell">
    <header className="app-header"><button className="wordmark button-reset" onClick={() => setView("overview")}><span className="signal-mark"><i /><i /><i /></span><strong>asyncfounders</strong><b>.</b></button><div className="company-picker"><button onClick={() => setCompanyMenu(!companyMenu)}><span className="company-glyph">{company.name[0]}</span><span><small>COMPANY</small><strong>{company.name}</strong></span><ChevronDown /></button>{companyMenu && <div className="company-dropdown">{companies.map((item) => <button key={item.id} className={item.id === company.id ? "active" : ""} onClick={() => { setCompanyId(item.id); setCompanyMenu(false); setView("overview"); }}><span>{item.name[0]}</span><div><strong>{item.name}</strong><small>{item.role} · v{item.current_version}</small></div>{item.id === company.id && <Check />}</button>)}<button className="add-company" onClick={() => { setModal("company"); setCompanyMenu(false); }}><Plus /> New company</button></div>}</div><nav className={mobileMenu ? "open" : ""}>{(["overview","sources","memory","people","calls"] as View[]).map((item) => <button key={item} className={view === item ? "active" : ""} onClick={() => { setView(item); setMobileMenu(false); }}>{item}</button>)}</nav><div className="header-right"><button className="call-button" onClick={() => setModal("call")}><PhoneCall /> Call a founder</button><button className="icon-button" onClick={() => setModal("profile")} aria-label="My callback settings"><Settings2 /></button><button className="icon-button mobile-only" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Menu">{mobileMenu ? <X /> : <Menu />}</button></div></header>

    <main>
      {view === "overview" && <Overview company={company} members={members} sources={sources} memories={memories} unseen={unseen} openDecisions={openDecisions} onAction={setModal} onView={setView} />}
      {view === "sources" && <SourcesView sources={sources} onAdd={() => setModal("source")} onIndex={async (source) => { try { await apiFetch(session,"/api/sources/index",{companyId:company.id,sourceId:source.id});await loadWorkspace(company.id);flash(`${source.label} is now searchable.`); } catch(issue) { flash(issue instanceof Error?issue.message:"The PDF could not be indexed."); } }} />}
      {view === "memory" && <MemoryView memories={memories} members={members} />}
      {view === "people" && <PeopleView members={members} invites={invites} onInvite={() => setModal("invite")} />}
      {view === "calls" && <CallsView calls={calls} members={members} onCall={() => setModal("call")} />}
    </main>
    <footer><span>AsyncFounders</span><p>Evidence-backed team memory—not a transcript archive.</p><button onClick={() => supabase.auth.signOut()}><LogOut /> Sign out</button></footer>
    {toast && <div className="toast"><Check />{toast}</div>}
    {modal === "company" && <CompanyModal supabase={supabase} onClose={() => setModal(null)} onDone={async (id) => { await loadCompanies(); setCompanyId(id); setModal(null); flash("Company created. Its memory is isolated and ready."); }} />}
    {modal === "invite" && <InviteModal supabase={supabase} session={session} company={company} onClose={() => setModal(null)} onDone={async () => { await loadWorkspace(company.id); setModal(null); flash("Founder invited. Share the secure invite link."); }} />}
    {modal === "source" && <SourceModal supabase={supabase} session={session} company={company} onClose={() => setModal(null)} onDone={async () => { await loadWorkspace(company.id); setModal(null); flash("Source added to this company brain."); }} />}
    {modal === "profile" && currentMember && <ProfileModal supabase={supabase} member={currentMember} onClose={() => setModal(null)} onDone={async () => { await loadWorkspace(company.id); setModal(null); flash("Callback settings updated."); }} />}
    {modal === "call" && <CallModal session={session} company={company} members={members} onClose={() => setModal(null)} onDone={async () => { await loadWorkspace(company.id); flash("Call state updated."); }} />}
  </div>;
}

function EmptyOnboarding({ supabase, onCreated }: { supabase: SupabaseClient; session: Session; onCreated: () => Promise<void> }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); const { error: issue } = await supabase.rpc("create_company", { company_name: name, company_description: description, company_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }); if (issue) setError(issue.message); else await onCreated(); setBusy(false); }
  return <main className="onboarding"><a className="wordmark" href="#"><span className="signal-mark"><i /><i /><i /></span><strong>asyncfounders</strong><b>.</b></a><div className="onboarding-grid"><section><span className="eyebrow">YOUR FIRST COMPANY</span><h1>Give the team<br />one shared <em>memory.</em></h1><p>Create a clean workspace. Then add founders, sources and callback consent—without mixing this company with any other team you belong to.</p><div className="flow-line"><span>01<br /><b>Create</b></span><ArrowRight /><span>02<br /><b>Invite</b></span><ArrowRight /><span>03<br /><b>Call</b></span></div></section><form onSubmit={submit}><label>Company name<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Labs" autoFocus /></label><label>What are you building?<textarea required minLength={12} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="A short, factual description of the company." /></label>{error && <div className="form-message"><CircleAlert />{error}</div>}<button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Building2 />}Create company</button></form></div></main>;
}

function Overview({ company, members, sources, memories, unseen, openDecisions, onAction, onView }: { company: Company; members: Member[]; sources: Source[]; memories: Memory[]; unseen: number; openDecisions: Memory[]; onAction: (modal: Modal) => void; onView: (view: View) => void }) {
  return <><section className="hero"><div className="dot-field" /><div className="hero-copy"><span className="eyebrow"><Sparkles /> LIVE COMPANY STATE · VERSION {company.current_version}</span><h1>Everything {company.name}<br />knows—ready for <em>whoever needs it.</em></h1><p>{company.description}</p><div className="hero-actions"><button className="primary" onClick={() => onAction("call")}><PhoneCall /> Call a founder</button><button className="secondary" onClick={() => onAction("source")}><UploadCloud /> Add knowledge</button></div></div><div className="brain-visual"><div className="brain-core"><Database /><b>{sources.reduce((sum, item) => sum + item.chunk_count, 0)}</b><span>INDEXED CHUNKS</span></div>{members.slice(0,4).map((member,index) => <div className={`brain-person p${index+1}`} key={member.id}><span>{initials(member.display_name)}</span><small>{member.display_name}</small></div>)}</div></section>
    <section className="pulse-grid"><button onClick={() => onView("memory")}><small>YOUR KNOWLEDGE GAP</small><strong>{unseen}</strong><span>company updates not yet acknowledged <ArrowRight /></span></button><button onClick={() => onView("memory")}><small>OPEN DECISIONS</small><strong>{openDecisions.length}</strong><span>questions or conflicts need closure <ArrowRight /></span></button><button onClick={() => onView("sources")}><small>SOURCE COVERAGE</small><strong>{sources.length}</strong><span>files, notes and links in this brain <ArrowRight /></span></button><button onClick={() => onView("people")}><small>TEAM</small><strong>{members.filter((item) => item.status === "active").length}</strong><span>active people, one company state <ArrowRight /></span></button></section>
    <section className="middleman"><div><span className="eyebrow">THE MIDDLEMAN</span><h2>People speak at different times.<br />The company stays synchronized.</h2></div><ol><li><b>01</b><span><UploadCloud /> Sources enter</span><p>Notes, files and links remain attached to the company that owns them.</p></li><li><b>02</b><span><Database /> Memory compounds</span><p>Facts, proposals, decisions and conflicts stay typed and inspectable.</p></li><li><b>03</b><span><PhoneCall /> Founders receive</span><p>Web or phone delivers only the relevant knowledge delta.</p></li></ol></section>
    <section className="latest-section"><div className="section-heading"><div><span className="eyebrow">LATEST COMPANY MEMORY</span><h2>What changed, with receipts.</h2></div><button className="secondary" onClick={() => onView("memory")}>View full ledger <ArrowRight /></button></div><div className="memory-list">{memories.slice(0,5).map((item) => <MemoryRow key={item.id} item={item} members={members} />)}{!memories.length && <EmptyState icon={BookOpen} title="No company memory yet" copy="Add a source or complete the first founder callback." />}</div></section></>;
}

function SourcesView({ sources, onAdd, onIndex }: { sources: Source[]; onAdd: () => void; onIndex: (source: Source) => Promise<void> }) { const [indexing,setIndexing]=useState("");return <Page title="Company sources" eyebrow="PRIVATE KNOWLEDGE BASE" action={<button className="primary" onClick={onAdd}><Plus /> Add source</button>}><div className="source-grid">{sources.map((source) => {const recoverable=source.mime_type==="application/pdf"&&Boolean(source.storage_path)&&source.index_status!=="indexed";return <article key={source.id}><div className="source-icon">{source.kind === "link" ? <Link2 /> : <FileText />}</div><div><small>{source.kind.toUpperCase()} · {timeAgo(source.created_at)}</small><h3>{source.label}</h3><p>{source.chunk_count} indexed chunks · {source.byte_size ? `${Math.ceil(source.byte_size / 1024)} KB` : "reference"}</p>{recoverable&&<button className="copy-link" disabled={Boolean(indexing)} onClick={async()=>{setIndexing(source.id);await onIndex(source);setIndexing("");}}>{indexing===source.id?"Indexing PDF…":"Index now"}</button>}</div><span className={`status ${source.index_status}`}>{source.index_status}</span></article>;})}{!sources.length && <EmptyState icon={UploadCloud} title="This brain has no sources" copy="Upload a text, markdown, CSV, JSON or PDF file; paste notes; or attach a reference link." action={onAdd} />}</div></Page>; }
function MemoryView({ memories, members }: { memories: Memory[]; members: Member[] }) { const [query,setQuery]=useState(""); const filtered=memories.filter((item)=>`${item.title} ${item.body}`.toLowerCase().includes(query.toLowerCase())); return <Page title="Memory ledger" eyebrow="VERSIONED · EVIDENCE-LINKED" action={<label className="search"><Search /><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search memory" /></label>}><div className="memory-list">{filtered.map((item)=><MemoryRow key={item.id} item={item} members={members} />)}{!filtered.length&&<EmptyState icon={BookOpen} title="No matching memory" copy="Typed call results and source-backed updates will appear here." />}</div></Page>; }
function PeopleView({ members, invites, onInvite }: { members: Member[]; invites: Invite[]; onInvite: () => void }) { return <Page title="Founders & teammates" eyebrow="MEMBERSHIP IS NOT A PHONE REGION" action={<button className="primary" onClick={onInvite}><UserPlus /> Invite founder</button>}><div className="people-grid">{members.map((member)=><article key={member.id}><span className="avatar">{initials(member.display_name)}</span><div><small>{member.role.toUpperCase()}</small><h3>{member.display_name}</h3><p>{member.role_label} · {member.timezone}</p><span className={member.call_consent?"voice-ready":"voice-off"}>{member.call_consent?<><PhoneCall /> Callback ready · •••• {member.phone_last_four}</>:<><ShieldCheck /> Web access · voice not enabled</>}</span></div></article>)}{invites.map((invite)=><article className="pending" key={invite.id}><span className="avatar">{initials(invite.display_name)}</span><div><small>PENDING INVITE</small><h3>{invite.display_name}</h3><p>{invite.email} · expires {new Date(invite.expires_at).toLocaleDateString()}</p><button className="copy-link" onClick={()=>navigator.clipboard.writeText(`${location.origin}/?invite=${invite.token}`)}>Copy invite link</button></div></article>)}</div></Page>; }
function CallsView({ calls, members, onCall }: { calls: CallSession[]; members: Member[]; onCall: () => void }) { return <Page title="Callback sessions" eyebrow="PREVIEWED · CONSENTED · IDEMPOTENT" action={<button className="primary" onClick={onCall}><PhoneCall /> New callback</button>}><div className="call-list">{calls.map((call)=>{const member=members.find((item)=>item.id===call.member_id);return <article key={call.id}><span className={`call-dot ${call.status}`} /><div><small>{call.mode.toUpperCase()} · {call.provider}</small><h3>{member?.display_name??"Team member"}</h3><p>{timeAgo(call.requested_at)} · {call.status.replaceAll("_"," ")}</p></div><span className="status">{call.status}</span></article>;})}{!calls.length&&<EmptyState icon={PhoneCall} title="No callbacks yet" copy="Preview a purpose and recipient, then explicitly confirm the call." action={onCall} />}</div></Page>; }
function Page({ title, eyebrow, action, children }: { title: string; eyebrow: string; action: React.ReactNode; children: React.ReactNode }) { return <section className="page-view"><div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{action}</div>{children}</section>; }
function MemoryRow({ item, members }: { item: Memory; members: Member[] }) { const author=members.find((member)=>member.id===item.author_member_id); return <article className="memory-row"><span className={`memory-kind ${item.kind}`}>{item.kind}</span><div><small>VERSION {item.version} · {author?.display_name??"Company source"} · {timeAgo(item.created_at)}</small><h3>{item.title}</h3><p>{item.body}</p></div><span className="memory-state">{item.status}</span></article>; }
function EmptyState({ icon: Icon, title, copy, action }: { icon: typeof BookOpen; title: string; copy: string; action?: () => void }) { return <div className="empty-state"><Icon /><h3>{title}</h3><p>{copy}</p>{action&&<button className="secondary" onClick={action}><Plus /> Add the first one</button>}</div>; }

function ModalShell({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) { return <div className="modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="modal-card" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Close"><X /></button><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{children}</section></div>; }
function CompanyModal({ supabase, onClose, onDone }: { supabase: SupabaseClient; onClose: () => void; onDone: (id: string) => Promise<void> }) { const [form,setForm]=useState({name:"",description:""});const [busy,setBusy]=useState(false);const [error,setError]=useState("");async function submit(event:FormEvent){event.preventDefault();setBusy(true);const {data,error:issue}=await supabase.rpc("create_company",{company_name:form.name,company_description:form.description,company_timezone:Intl.DateTimeFormat().resolvedOptions().timeZone});if(issue)setError(issue.message);else await onDone(String(data));setBusy(false);}return <ModalShell title="Create another company" eyebrow="ISOLATED WORKSPACE" onClose={onClose}><p className="modal-intro">Membership, sources, memory and calls never cross company boundaries.</p><form onSubmit={submit}><label>Company name<input required minLength={2} value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})} /></label><label>Description<textarea required minLength={12} value={form.description} onChange={(event)=>setForm({...form,description:event.target.value})} /></label>{error&&<div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Building2/>}Create company</button></form></ModalShell>; }
function InviteModal({ supabase, session, company, onClose, onDone }: { supabase: SupabaseClient; session: Session; company: Company; onClose: () => void; onDone: () => Promise<void> }) { const [form,setForm]=useState({display_name:"",email:"",role:"founder",role_label:"Co-founder",region:"IN",locale:"en-IN"});const [busy,setBusy]=useState(false);const [error,setError]=useState("");async function submit(event:FormEvent){event.preventDefault();setBusy(true);const {error:issue}=await supabase.from("company_invites").insert({company_id:company.id,...form,email:form.email.toLowerCase(),invited_by:session.user.id});if(issue)setError(issue.message);else await onDone();setBusy(false);}const voice=supportedRegions.has(form.region);return <ModalShell title="Invite a founder" eyebrow="COMPANY ACCESS FIRST" onClose={onClose}><p className="modal-intro">They receive full workspace access after accepting. Phone availability is a separate channel.</p><form onSubmit={submit}><div className="form-grid"><label>Name<input required value={form.display_name} onChange={(event)=>setForm({...form,display_name:event.target.value})}/></label><label>Email<input required type="email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})}/></label><label>Company role<select value={form.role} onChange={(event)=>setForm({...form,role:event.target.value})}><option value="founder">Founder</option><option value="admin">Admin</option><option value="member">Member</option></select></label><label>Role title<input required value={form.role_label} onChange={(event)=>setForm({...form,role_label:event.target.value})}/></label><label>Country<select value={form.region} onChange={(event)=>setForm({...form,region:event.target.value})}>{regionOptions.map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label>Language locale<input value={form.locale} onChange={(event)=>setForm({...form,locale:event.target.value})}/></label></div><div className={voice?"eligibility yes":"eligibility no"}>{voice?<><PhoneCall/>CALL-E supports this region; the member can opt in after joining.</>:<><ShieldCheck/>Workspace access works here; CALL-E voice is currently unavailable.</>}</div>{error&&<div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<UserPlus/>}Create secure invite</button></form></ModalShell>; }
function SourceModal({ supabase, session, company, onClose, onDone }: { supabase: SupabaseClient; session: Session; company: Company; onClose: () => void; onDone: () => Promise<void> }) { const [kind,setKind]=useState<"file"|"text"|"link">("file");const [label,setLabel]=useState("");const [content,setContent]=useState("");const [url,setUrl]=useState("");const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const isPdf=Boolean(file&&(file.type==="application/pdf"||/\.pdf$/i.test(file.name)));async function chooseFile(event:ChangeEvent<HTMLInputElement>){const selected=event.target.files?.[0]??null;if(!selected)return;setError("");if(selected.size>10*1024*1024){setFile(null);setContent("");setError("Keep each file under 10 MB.");return;}setFile(selected);setLabel(selected.name);if(selected.type.startsWith("text/")||/\.(md|txt|csv|json)$/i.test(selected.name))setContent(await selected.text());else setContent("");}async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError("");try{let storage_path:string|null=null;if(file){storage_path=`${company.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,"-")}`;const {error:uploadError}=await supabase.storage.from("company-sources").upload(storage_path,file,{contentType:isPdf?"application/pdf":file.type||"application/octet-stream",upsert:false});if(uploadError)throw uploadError;if(isPdf){await apiFetch(session,"/api/sources/index",{companyId:company.id,storagePath:storage_path,label,mimeType:"application/pdf"});await onDone();setBusy(false);return;}}const chunks=chunksOf(content);const {data:source,error:sourceError}=await supabase.from("sources").insert({company_id:company.id,kind,label,url:kind==="link"?url:null,storage_path,mime_type:file?.type??(kind==="text"?"text/plain":null),byte_size:file?.size??new Blob([content]).size,index_status:chunks.length?"indexed":"queued",chunk_count:chunks.length,added_by:session.user.id}).select("id").single();if(sourceError)throw sourceError;if(chunks.length){const {error:chunkError}=await supabase.from("source_chunks").insert(chunks.map((text,ordinal)=>({source_id:source.id,company_id:company.id,ordinal,content:text})));if(chunkError)throw chunkError;}await onDone();}catch(issue){setError(issue instanceof Error?issue.message:"Upload failed.");}setBusy(false);}return <ModalShell title="Add company knowledge" eyebrow="SOURCE-BACKED MEMORY" onClose={onClose}><div className="segmented">{(["file","text","link"] as const).map((item)=><button key={item} className={kind===item?"active":""} onClick={()=>setKind(item)}>{item}</button>)}</div><form onSubmit={submit}>{kind==="file"&&<label className="dropzone"><UploadCloud/><b>{file?.name??"Choose a file"}</b><span>TXT, MD, CSV, JSON or PDF · max 10 MB</span><input required type="file" accept=".txt,.md,.csv,.json,.pdf,text/*,application/pdf" onChange={chooseFile}/></label>}<label>Source title<input required value={label} onChange={(event)=>setLabel(event.target.value)} placeholder="Product brief — August"/></label>{kind==="text"&&<label>Paste knowledge<textarea required minLength={10} rows={8} value={content} onChange={(event)=>setContent(event.target.value)} placeholder="Decisions, research, operating context…"/></label>}{kind==="link"&&<label>Reference URL<input required type="url" value={url} onChange={(event)=>setUrl(event.target.value)} placeholder="https://…"/></label>}{kind==="file"&&isPdf&&<div className="eligibility yes">{busy?<LoaderCircle className="spin"/>:<Database/>}{busy?"Extracting and indexing this PDF…":"Selectable PDF text will be extracted and indexed when you add it."}</div>}{error&&<div className="form-message"><CircleAlert/>{error}</div>}<button className="primary full" disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Database/>}{busy&&isPdf?"Indexing PDF…":"Add to company brain"}</button></form></ModalShell>; }
function ProfileModal({ supabase, member, onClose, onDone }: { supabase: SupabaseClient; member: Member; onClose: () => void; onDone: () => Promise<void> }) {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(member.call_consent);
  const [timezone, setTimezone] = useState(member.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasStoredPhone = Boolean(member.phone_last_four);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const phoneRegex = /^\+[1-9]\d{7,14}$/;
    if (phone && !phoneRegex.test(phone)) {
      setError("Enter your phone in E.164 format, for example +919876543210.");
      setBusy(false);
      return;
    }
    if (consent && !hasStoredPhone && !phoneRegex.test(phone)) {
      setError("Enter your phone in E.164 format, for example +919876543210.");
      setBusy(false);
      return;
    }

    const updates: Record<string, unknown> = { call_consent: consent, timezone };
    if (!consent) {
      updates.phone_e164 = null;
      updates.phone_last_four = null;
    } else if (phone) {
      updates.phone_e164 = phone;
      updates.phone_last_four = phone.slice(-4);
    }
    const { error: issue } = await supabase.from("company_members").update(updates).eq("id", member.id);
    if (issue) setError(issue.message);
    else await onDone();
    setBusy(false);
  }

  return <ModalShell title="My callback settings" eyebrow="PRIVATE · CONSENTED" onClose={onClose}><p className="modal-intro">Your full number never appears in the team interface. Disable consent anytime.</p><form onSubmit={submit}><label>Timezone<input required value={timezone} onChange={(event) => setTimezone(event.target.value)} /></label><label className="toggle-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span><b>Allow AI callbacks to me</b><small>Every call still requires an exact preview and explicit confirmation.</small></span></label>{consent && <label>Phone number<input required={!hasStoredPhone} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder={member.phone_last_four ? `Current number ends •••• ${member.phone_last_four}` : "+919876543210"} /><small>{hasStoredPhone ? "Leave blank to keep the current number." : "Use E.164 format with country code."}</small></label>}{error && <div className="form-message">{error}</div>}<button className="primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <ShieldCheck />}Save callback settings</button></form></ModalShell>;
}
function CallModal({ session, company, members, onClose, onDone }: { session: Session; company: Company; members: Member[]; onClose: () => void; onDone: () => Promise<void> }) { const callable=members.filter((member)=>member.status==="active");const [memberId,setMemberId]=useState(callable[0]?.id??"");const [mode,setMode]=useState<CallMode>("deposit");const [stage,setStage]=useState<"compose"|"preview"|"calling"|"done">("compose");const [preview,setPreview]=useState<Record<string,unknown>|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");const member=members.find((item)=>item.id===memberId);async function prepare(){setBusy(true);setError("");try{const result=await apiFetch(session,"/api/callbacks/preview",{companyId:company.id,memberId,mode});setPreview(result);setStage("preview");}catch(issue){setError(issue instanceof Error?issue.message:"Could not prepare the call.");}setBusy(false);}async function confirm(){if(!preview)return;setBusy(true);setError("");try{const result=await apiFetch(session,"/api/callbacks/confirm",{previewId:preview.previewId});setPreview({...preview,...result});setStage(result.status==="completed"?"done":"calling");await onDone();}catch(issue){setError(issue instanceof Error?issue.message:"The call did not start.");}setBusy(false);}async function refresh(){if(!preview)return;setBusy(true);try{const result=await apiFetch(session,`/api/callbacks/status?id=${preview.previewId}`);setPreview({...preview,...result});if(["completed","failed","cancelled","no_answer","busy","declined","expired"].includes(String(result.status)))setStage("done");await onDone();}catch(issue){setError(issue instanceof Error?issue.message:"Could not refresh status.");}setBusy(false);}return <ModalShell title="Call a founder" eyebrow="CALL-E CALLBACK" onClose={onClose}>{stage==="compose"&&<><p className="modal-intro">Choose a member and one bounded job. Nothing is dialled until you approve the exact plan.</p><label>Founder<select value={memberId} onChange={(event)=>setMemberId(event.target.value)}>{callable.map((item)=><option key={item.id} value={item.id}>{item.display_name} · {item.region}</option>)}</select></label><div className="mode-list">{(Object.keys(modeCopy) as CallMode[]).map((item)=>{const Icon=modeCopy[item].icon;return <button key={item} className={mode===item?"active":""} onClick={()=>setMode(item)}><Icon/><span><b>{modeCopy[item].label}</b><small>{modeCopy[item].description}</small></span>{mode===item&&<Check/>}</button>;})}</div>{member&&!member.call_consent&&<div className="eligibility no"><ShieldCheck/>{member.display_name} has not enabled callbacks yet.</div>}{member&&!supportedRegions.has(member.region)&&<div className="eligibility no"><CircleAlert/>CALL-E does not currently list {member.region}. Web membership still works.</div>}{error&&<div className="form-message">{error}</div>}<button className="primary full" onClick={prepare} disabled={busy||!member?.call_consent||!supportedRegions.has(member?.region??"")}>{busy?<LoaderCircle className="spin"/>:<ArrowRight/>}Review exact call</button></>}{stage==="preview"&&preview&&<><div className="call-preview"><span><small>RECIPIENT</small><b>{String(preview.recipient)}</b><p>{String(preview.maskedPhone)}</p></span><span><small>PURPOSE</small><b>{modeCopy[mode].label}</b><p>{String(preview.duration)}</p></span><div><small>APPROVED QUESTIONS</small>{Array.isArray(preview.questions)&&<ol>{preview.questions.map((question)=><li key={String(question)}>{String(question)}</li>)}</ol>}</div></div><div className="eligibility yes"><ShieldCheck/>{String(preview.warning)}</div>{error&&<div className="form-message">{error}</div>}<div className="modal-actions"><button className="secondary" onClick={()=>setStage("compose")}>Back</button><button className="primary" onClick={confirm} disabled={busy}>{busy?<LoaderCircle className="spin"/>:<PhoneCall/>}Confirm and call</button></div></>}{stage==="calling"&&<div className="call-progress"><div className="pulse-ring"><PhoneCall/></div><h3>CALL-E is working</h3><p>The session is running outside this browser. Refresh safely—duplicate calls are blocked.</p><button className="primary" onClick={refresh} disabled={busy}>{busy?<LoaderCircle className="spin"/>:<Radio/>}Refresh call status</button></div>}{stage==="done"&&<div className="call-progress"><div className="done-ring"><Check/></div><h3>Session {String(preview?.status??"complete")}</h3><p>{String(preview?.summary??"The provider state has been saved. Validated memory appears only after a successful, confident result.")}</p><button className="primary" onClick={onClose}>Return to company</button></div>}</ModalShell>; }
