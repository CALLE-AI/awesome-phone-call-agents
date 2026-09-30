'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { canConfirm, isActive, slotDate, slotTime, type Call, type Candidate, type Mode, type Scenario, type Slot, type View } from '../lib/model';
import { PUBLIC_DEMO } from '../lib/public-demo';
import { loadBrowserDemo, updateBrowserDemo } from '../lib/browser-demo';

function Icon({name, size = 20, ...props}: {name: string; size?: number} & React.SVGProps<SVGSVGElement>) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    phone: <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a14 14 0 0 1-7-7l2-2-2-5Z"/>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    external: <><path d="M14 3h7v7m0-7L10 14M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name] || paths.info}</svg>;
}
const scenarios: Record<Scenario, string> = {accepted: 'Accepts the time', declined: 'Declines the time', unclear: 'Gives an unclear answer', unanswered: 'Does not answer'};
const phaseNames: Record<string,string> = {queued: 'Preparing call', calling: 'Call in progress', review: 'Needs your review', booked: 'Booking confirmed', closed: 'Review completed', error: 'Call failed', uncertain: 'Check CALL-E dashboard'};

export default function Home() {
  const [data, setData] = useState<View | null>(null);
  const [tab, setTab] = useState('board');
  const [selectedSlot, setSelectedSlot] = useState('slot-1');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<Candidate | null>(null);
  const [mode, setMode] = useState<Mode>('demo');
  const [scenario, setScenario] = useState<Scenario>('accepted');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [help, setHelp] = useState(false);
  const [reset, setReset] = useState(false);
  const requestRef = useRef('');
  const resultRef = useRef<HTMLElement>(null);
  const workflowRef = useRef<HTMLElement>(null);
  const initialSelection = useRef(false);
  const modalRef = useRef<HTMLDialogElement>(null);
  const slot = data?.slots.find(s => s.id === selectedSlot);
  const active = data?.calls.filter(isActive) ?? [];
  const selectedCall = data?.calls.find(c => c.slotId === selectedSlot);
  const pendingReviews = data?.calls.filter(c => c.phase === 'review').length ?? 0;

  const load = useCallback(async () => {
    if (PUBLIC_DEMO) {
      try { setData(loadBrowserDemo(window.localStorage)); }
      catch { setError('Allow browser storage for this site to use the demo, then try again.'); }
      return;
    }
    try { const res = await fetch('/api/workspace', {cache: 'no-store'}); const payload = await res.json(); if (!res.ok) throw new Error(payload.error); setData(payload); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the workspace.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (data && !initialSelection.current) {
      initialSelection.current = true;
      setSelectedSlot(data.slots.find(s => s.status === 'open')?.id ?? 'slot-1');
    }
  }, [data]);
  useEffect(() => {
    if (!active.length) return;
    const timer = setTimeout(async () => {
      const live = active.find(c => c.mode === 'live' && c.providerId);
      if (live) {
        try { const res = await fetch('/api/workspace', {method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({action:'poll',callId:live.id})}); const value = await res.json(); if(res.ok) setData(value); else {setError(value.error); await load();} }
        catch { setError('Status temporarily unavailable. Your call is saved; it will not be redialed.'); await load(); }
      } else await load();
    }, active.some(c=>c.mode==='live') ? 7500 : 1000);
    return () => clearTimeout(timer);
  }, [data, active.length, load]);
  useEffect(() => {
    if (preview || help || reset) modalRef.current?.showModal(); else modalRef.current?.close();
  }, [preview, help, reset]);
  async function send(body: object) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (PUBLIC_DEMO) { setData(updateBrowserDemo(window.localStorage, body)); return true; }
      const res = await fetch('/api/workspace', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      const payload = await res.json(); if (!res.ok) throw new Error(payload.error);
      setData(payload as View); return true;
    } catch (err) {setError(err instanceof Error ? err.message : 'Request failed. Reload to check saved progress before trying again.'); return false;}
    finally {setBusy(false);}
  }
  function openPreview(person: Candidate) {requestRef.current = crypto.randomUUID(); setConsent(false); setScenario('accepted'); setMode('demo'); setPreview(person);}
  async function startCall() {
    if (!preview || !slot) return;
    if (await send({action:'create', requestId:requestRef.current, slotId:slot.id,candidateId:preview.id,mode,scenario,consent,approved:consent})) {
      setPreview(null); setTab('board'); setTimeout(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),100);
    }
  }
  async function decideCall(call: Call, decision: 'confirm' | 'close') {
    if (await send({action:'decide',callId:call.id,decision})) setNotice(decision==='confirm'?'Booking confirmed by you. The appointment board has been updated.':'Review saved. The appointment stays open.');
  }
  function closeModal() { if(!busy) {setPreview(null);setHelp(false);setReset(false);} }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Clinic Slot Assistant home"><span className="brand-mark"><span/><span/><span/></span><span>clinic slot<span className="brand-sub">ASSISTANT</span></span></a>
      <div className="workspace-tag"><span className="clinic-icon"><Icon name="calendar" size={17}/></span><span>Clearview Clinic<small>Demo workspace</small></span><span className="workspace-dot"/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{[
        ['board','grid','Overview'],['waitlist','users','Waitlist'],['activity','clock','Call activity'],['setup','settings',PUBLIC_DEMO?'About this demo':'CALL-E connection'],
      ].map(([key,icon,label])=><button key={key} aria-label={label} aria-pressed={tab===key} className={`nav-item ${tab===key?'active':''}`} onClick={()=>setTab(key)}><Icon name={icon}/><span>{label}</span>{key==='waitlist'&&data?<span className="nav-count">{data.candidates.length}</span>:null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="powered"><Icon name="spark" size={16}/><span>Made for the CALL-E hackathon</span></div><div className="profile"><span className="profile-avatar">MG</span><span>Madhuri Gade<small>Project creator</small></span><span className="online-dot"/></div></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumb">Workspace <Icon name="chevron" size={13}/><strong>{{board:'Overview',waitlist:'Waitlist',activity:'Call activity',setup:PUBLIC_DEMO?'About this demo':'CALL-E connection'}[tab]}</strong></div><div className="top-actions"><span className="badge demo"><span/>Demo data</span><button aria-label="How it works" className="text-button" onClick={()=>setHelp(true)}><Icon name="info" size={17}/><span>How it works</span></button></div></header>
      <div className="page-wrap">
        {error&&<div className="alert error" role="alert"><Icon name="info"/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><Icon name="close" size={17}/></button></div>}
        {notice&&<div className="alert success" role="status"><Icon name="check"/><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><Icon name="close" size={17}/></button></div>}
        {!data ? <div className="loading"><span className="spinner"/>Getting your workspace ready…{error&&<button className="primary" onClick={()=>void load()}>Try again</button>}</div> : <>
          {tab==='board'&&<>
            <section className="recovery-hero">
              <div className="recovery-intro"><div className="eyebrow"><span/>THE APPOINTMENT RECOVERY DESK</div><h1>An open slot.<br/><em>A new possibility.</em></h1><p>Offer an earlier appointment through a focused conversation. Keep the final decision yours.</p><div className="hero-actions"><button className="primary" onClick={()=>workflowRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}>Choose an opening <Icon name="arrow" size={17}/></button>{pendingReviews>0&&<button className="hero-review" onClick={()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'})}>{pendingReviews} to review <Icon name="chevron" size={15}/></button>}</div></div>
              {slot&&<div className="opening-ticket"><div className="ticket-top"><span><Icon name="calendar" size={15}/> SELECTED APPOINTMENT</span><span className="ticket-status">{slot.status==='booked'?'Booked':'Open slot'}</span></div><div className="ticket-time">{slotTime(slot)}<span>{slot.duration} min</span></div><p className="ticket-date">{slotDate(slot)} · India time</p><div className="ticket-bottom"><span><strong>{slot.clinician}</strong><small>{slot.kind}</small></span><span className="ticket-orb"><Icon name={slot.status==='booked'?'check':'phone'} size={23}/></span></div><div className="ticket-note"><Icon name="shield" size={13}/> Fictional appointment · staff confirmation required</div></div>}
            </section>
            <div className="demo-note"><Icon name="info" size={16}/><span>{PUBLIC_DEMO ? "Public simulation · No login, no real calls. Fictional appointments, saved only in your browser." : "Local test workspace · Fictional appointments. Each result is labelled as simulated or a real CALL-E test."}</span><button onClick={()=>setTab('setup')}>{PUBLIC_DEMO ? "About this demo" : "Connection details"} <Icon name="arrow" size={15}/></button></div>
            <section className="stats" aria-label="Workspace statistics">
              {[['calendar',data.slots.filter(s=>s.status==='open').length,'Open appointments','Available in this workspace'],['users',data.candidates.filter(p=>p.consent&&!data.slots.some(s=>s.bookedFor===p.id)).length,'Ready to contact','Contact consent recorded'],['phone',pendingReviews,'Awaiting review','A human decision comes next'],['check',data.slots.filter(s=>s.status==='booked').reduce((n,s)=>n+s.duration,0),'Fictional minutes booked','Prototype bookings, not clinic impact']].map(([icon,value,label,sub])=><article className="stat" key={String(label)}><div className="stat-top"><span>{label}</span><span className={`stat-icon ${icon==='check'?'green':''}`}><Icon name={String(icon)} size={18}/></span></div><strong>{value}<small>{icon==='check'?'min':''}</small></strong><p>{sub}</p></article>)}
            </section>
            <div className="section-title"><div><h2>Your next opening</h2><p>Choose a slot, then invite someone from the waitlist.</p></div><span className="quiet-chip"><Icon name="clock" size={14}/> All times in IST</span></div>
            <section className="workflow" ref={workflowRef} aria-label="Appointment recovery workflow"><RecoveryJourney slot={slot} call={selectedCall}/><div className="recovery-grid">
              <div className="panel slots-panel"><div className="panel-heading"><span className="step-number">1</span><h3>Select an appointment</h3></div><div className="slot-list">{data.slots.map(s=><button key={s.id} onClick={()=>setSelectedSlot(s.id)} className={`slot-card ${selectedSlot===s.id?'selected':''} ${s.status==='booked'?'filled':''}`} aria-pressed={selectedSlot===s.id}><div className="slot-top"><span className="slot-date">{slotDate(s)}</span><span className={`badge ${s.status==='booked'?'mint-badge':'amber'}`}>{s.status==='booked'?'Booked':'Open'}</span></div><div className="slot-time">{slotTime(s)} <span>{s.duration} min</span></div><div className="slot-kind">{s.kind}</div><div className="slot-bottom"><span className="doctor-dot"/>{s.clinician}<span className="radio-dot">{selectedSlot===s.id&&<span/>}</span></div></button>)}</div></div>
              <div className="panel waitlist-panel"><div className="panel-heading"><span className="step-number">2</span><h3>Find someone’s sooner</h3><span className="panel-count">{data.candidates.length} people</span></div><div className="list-toolbar"><p>Ordered by time on the waitlist</p><div className="search"><Icon name="search" size={16}/><input aria-label="Search waitlist" placeholder="Find a person" value={query} onChange={e=>setQuery(e.target.value)}/></div></div><div className="people-list">{data.candidates.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())).map(person=>{
                const booked=data.slots.some(s=>s.bookedFor===person.id);const pending=data.calls.some(c=>(c.candidateId===person.id||c.slotId===selectedSlot)&&(isActive(c)||c.phase==='review'));
                return <div className={`person-row ${!person.consent?'muted-row':''}`} key={person.id}><span className={`avatar ${person.color}`}>{person.initials}</span><div className="person-info"><strong>{person.name}</strong><span>{person.preference} <i/> {person.waitingDays} days waiting</span><small className={person.consent?'consent-ok':'consent-pending'}><Icon name={person.consent?'shield':'clock'} size={12}/>{booked?'Appointment confirmed':person.consent?'Contact consent recorded':'Contact consent needed'}</small></div><button className="outline-button call-button" disabled={!person.consent||booked||slot?.status!=='open'||pending||busy} onClick={()=>openPreview(person)}><Icon name="phone" size={15}/><span>{booked?'Booked':'Preview call'}</span></button></div>;
              })}{!data.candidates.some(p=>p.name.toLowerCase().includes(query.toLowerCase()))&&<div className="empty-search">No people match “{query}”.</div>}</div><div className="waitlist-footer"><Icon name="shield" size={15}/><span>You review every result. You confirm every booking.</span></div></div>
            </div></section>
            <section className="review-section" ref={resultRef}><div className="section-title"><div><h2>Conversations & decisions</h2><p>From the first hello to your final confirmation.</p></div>{data.calls.length>1&&<button className="text-button" onClick={()=>setTab('activity')}>View all activity <Icon name="arrow" size={16}/></button>}</div>{data.calls.length===0?<div className="empty-state panel"><span className="empty-icon"><Icon name="phone" size={25}/></span><div><h3>A good conversation starts here.</h3><p>Preview a call above. Its progress, response and review actions will appear here.</p></div><span className="empty-detail">CALL-E + a human touch</span></div>:data.calls.slice(0,3).map(call=><CallCard key={call.id} call={call} data={data} busy={busy} onDecision={decideCall}/>)}</section>
          </>}
          {tab==='waitlist'&&<><PageHeading eyebrow="THE PEOPLE BEHIND THE OPENINGS" title="A shorter wait starts here." description="Fictional waitlist records for this prototype. Contact permission is checked before each call."/><div className="panel directory">{data.candidates.map(p=><div className="person-row" key={p.id}><span className={`avatar ${p.color}`}>{p.initials}</span><div className="person-info"><strong>{p.name}</strong><span>{p.preference} · {p.language} · {p.waitingDays} days waiting</span><small>{data.slots.some(s=>s.bookedFor===p.id)?'Demo appointment confirmed':p.consent?'Contact consent recorded':'Contact consent needed'}</small></div><button className="outline-button" onClick={()=>{setTab('board');setQuery(p.name);}}>View on board <Icon name="arrow" size={15}/></button></div>)}</div></>}
          {tab==='activity'&&<><PageHeading eyebrow="EVERY CALL, EVERY DECISION" title="A clear trail of care." description="Review your call outcomes and the staff actions that followed."/>{data.calls.length===0?<div className="panel empty-state"><Icon name="clock" size={30}/><p>No calls yet. Start with a preview on the overview page.</p><button className="primary" onClick={()=>setTab('board')}>Open overview</button></div>:data.calls.map(call=><CallCard key={call.id} call={call} data={data} busy={busy} onDecision={decideCall}/>)}<div className="panel audit"><h3>Activity log</h3>{data.audit.length===0?<p>Your actions will appear here.</p>:data.audit.map(item=><div className="audit-row" key={item.id}><span className="audit-dot"/><span>{item.text}<small>{item.mode==='demo'?'SIMULATED':'LIVE TEST'}</small></span><time>{new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(item.at))}</time></div>)}</div></>}
          {tab==='setup'&&PUBLIC_DEMO&&<PublicDemoInfo/>}
          {tab==='setup'&&!PUBLIC_DEMO&&<><PageHeading eyebrow="THE VOICE BEHIND THE WORKFLOW" title="Connect the conversation." description="Explore the demo now, then connect CALL-E for an authorized test with a willing volunteer."/><div className="setup-grid"><section className="panel setup-card"><span className="large-icon"><Icon name="phone" size={30}/></span><h2>CALL-E connection</h2><span className={`badge ${data.settings.liveReady?'mint-badge':'amber'}`}>{data.settings.liveReady?'Ready for an approved test':'Demo mode is ready'}</span><div className="connection-checks">{[[data.settings.hasApiKey,'Server API key'],[data.settings.hasTestPhone,'One India test number'],[data.settings.liveEnabled,'Live test switch']].map(([ready,label])=><div key={String(label)}><span className={ready?'check-circle':'empty-circle'}>{ready&&<Icon name="check" size={13}/>}</span>{label}<small>{ready?'Configured':'Not configured'}</small></div>)}</div><p className="small-copy">{data.settings.testPhoneHint?`Approved test destination: ${data.settings.testPhoneHint}`:'The fictional waitlist has no dialable phone numbers.'}</p><a className="primary" href="https://dashboard.heycall-e.com/" target="_blank" rel="noreferrer">Open CALL-E dashboard <Icon name="external" size={16}/></a><button className="text-button refresh" onClick={()=>void load()}><Icon name="reset" size={16}/> Refresh connection</button></section><section className="panel setup-guide"><h3>From demo to a real test</h3><ol><li><strong>Create your CALL-E account</strong><p>Get an API key from the CALL-E dashboard. Keep it private.</p></li><li><strong>Configure this local app</strong><p>Copy <code>.env.example</code> to <code>.env.local</code>. Add your key and the number of a consenting India test volunteer. Set <code>CALLE_LIVE_ENABLED=true</code>, then restart the server.</p></li><li><strong>Preview, approve, then call</strong><p>Select Live test in the call preview. Verify the destination and approve that specific call. It uses fictional appointment details.</p></li></ol><div className="info-box"><Icon name="info" size={18}/><p>Live calls may use CALL-E credits. This local prototype does not update any real clinic calendar. {data.calls.some(c=>c.mode === "live" && c.taskCompleted && c.canAttend === "yes") ? "This workspace has a verified live test with an accepted response." : "A successful live test is still needed to verify this workspace connection."}</p></div></section></div></>}
          <footer className="page-footer"><span><Icon name="spark" size={14}/> Clinic Slot Assistant · Built by Madhuri Gade</span><button className="text-button" onClick={()=>setReset(true)} disabled={data.calls.some(c=>c.mode==='live')}><Icon name="reset" size={14}/> Reset demo</button></footer>
        </>}
      </div>
    </main>
    <dialog ref={modalRef} className="modal" onCancel={e=>{e.preventDefault();closeModal();}} onClick={e=>{if(e.target===modalRef.current)closeModal();}}>
      <div className="modal-inner"><button className="modal-close" onClick={closeModal} disabled={busy} aria-label="Close dialog"><Icon name="close"/></button>
      {preview&&slot&&data&&<><div className="eyebrow">A MOMENT BEFORE THE HELLO</div><h2>Preview the conversation</h2><p className="modal-intro">Check the details. You decide when the call starts.</p><div className="mode-switch"><button className={mode==='demo'?'selected':''} onClick={()=>{setMode('demo');setConsent(false);}} disabled={busy}>Simulated demo</button>{!PUBLIC_DEMO&&<button className={mode==='live'?'selected':''} onClick={()=>{setMode('live');setConsent(false);}} disabled={!data.settings.liveReady||busy}>Live test {!data.settings.liveReady&&'· not connected'}</button>}</div><div className="preview-summary"><div><span>{mode==='demo'?'Fictional waitlist person':'Consenting test volunteer'}</span><strong>{mode==='demo'?preview.name:data.settings.testPhoneHint}</strong></div><div><span>{slotDate(slot)} · India time</span><strong>{slotTime(slot)} <small>· {slot.duration} min</small></strong></div></div><div className="call-script"><span><Icon name="spark" size={15}/> THE CONVERSATION PLAN</span><p>{mode==='demo'?`Introduce the AI assistant, ask whether ${preview.name.split(' ')[0]} is available for this earlier appointment, and capture a clear yes, no, or unknown.`:'Identify this as an AI-led hackathon test, offer the fictional appointment time to your volunteer, and capture yes, no, or unknown.'}</p><p className="script-detail">No medical questions. No automatic booking. Staff review comes next.</p></div>{mode==='demo'&&<label className="field-label">Demo response<select value={scenario} onChange={e=>setScenario(e.target.value as Scenario)} disabled={busy}>{Object.entries(scenarios).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select><small>A scripted outcome lets you test each review path.</small></label>}<label className="consent-box"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} disabled={busy}/><span>{mode==='demo'?'I approve this simulated call using fictional data.':'The test volunteer agreed to this AI call, and I approve calling the displayed number now.'}</span></label>{error&&<div className="alert error" role="alert">{error}</div>}<div className="modal-footer"><span><Icon name="shield" size={15}/>{mode==='demo'?'No real phone call will be placed':'Places one real test call using CALL-E'}</span><button className="primary" disabled={!consent||busy} onClick={()=>void startCall()}>{busy?<span className="spinner"/>:<Icon name="phone" size={16}/>} {busy?'Starting…':mode==='demo'?'Start demo call':'Place real test call'}</button></div></>}
      {help&&<><div className="eyebrow">THOUGHTFUL AUTOMATION</div><h2>Three steps to someone’s sooner.</h2><ol className="help-steps"><li><strong>Choose an open appointment</strong><p>Start with a cancelled slot and a person who has consented to contact.</p></li><li><strong>Preview and approve a call</strong><p>CALL-E asks about that specific time. In demo mode, the response and transcript are explicitly simulated.</p></li><li><strong>Review, then confirm</strong><p>Read the response and its evidence. Confirm a clear acceptance, or leave the slot open for a refusal, no answer or uncertainty.</p></li></ol><button className="primary" onClick={()=>setHelp(false)}>Let’s try it <Icon name="arrow" size={16}/></button></>}
      {reset&&<><h2>Start a fresh demo?</h2><p className="modal-intro">This clears the simulated calls and bookings in this workspace and creates new example appointment dates.</p><div className="modal-footer"><button className="outline-button" onClick={()=>setReset(false)} disabled={busy}>Keep my demo</button><button className="primary" disabled={busy} onClick={async()=>{if(await send({action:'reset'})){setReset(false);setSelectedSlot('slot-1');setQuery('');setTab('board');}}}>Reset demo</button></div></>}
      </div>
    </dialog>
  </div>;
}

function RecoveryJourney({slot,call}: {slot?:Slot;call?:Call}) {
  const complete = [Boolean(slot),Boolean(call),Boolean(call&&['booked','closed'].includes(call.phase)),call?.phase==='booked'];
  const current = !call ? 1 : isActive(call) ? 1 : call.phase==='booked' ? 3 : 2;
  const steps = [
    ['calendar','Choose a slot',slot?`${slotTime(slot)} · ${slot.duration} min`:'Select an appointment'],
    ['phone','Approve a call',call?(call.mode==='live'?'Actual CALL-E test':'Labelled simulation'):'Consent comes first'],
    ['search','Review the response',call?.phase==='review'?'Ready for your review':'Read the evidence'],
    ['check','Confirm the booking',call?.phase==='booked'?'Confirmed by staff':'Your decision'],
  ];
  return <ol className="journey" aria-label="Progress for selected appointment">{steps.map(([icon,title,detail],i)=><li key={title} className={`${complete[i]?'done':''} ${current===i?'current':''}`} aria-current={current===i?'step':undefined}><span className="journey-icon"><Icon name={complete[i]?'check':icon} size={17}/></span><span><strong>{title}</strong><small>{detail}</small></span><span className="journey-index">0{i+1}</span></li>)}</ol>;
}
function PageHeading({eyebrow,title,description}: {eyebrow:string;title:string;description:string}) {return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>;}
function CallCard({call,data,busy,onDecision}: {call:Call;data:View;busy:boolean;onDecision:(call:Call,decision:'confirm'|'close')=>Promise<void>}) {
  const slot = data.slots.find(s=>s.id===call.slotId)!;
  const person = data.candidates.find(p=>p.id===call.candidateId)!;
  const turns = call.transcript.reduce<{speaker:string;text:string}[]>((all,turn)=>{
    const previous=all.at(-1);
    if(previous?.speaker===turn.speaker) previous.text += ` ${turn.text}`;
    else all.push({...turn});
    return all;
  },[]);
  const checks = [[call.taskCompleted,'Conversation processed'],[call.canAttend==='yes','Clear acceptance'],[call.phase==='booked','Staff confirmation']] as const;
  return <article className={`panel call-card ${call.phase==='booked'?'booked-card':''} ${call.mode==='live'?'live-card':''}`}>
    <div className="call-card-header"><span className={`avatar ${person.color}`}>{call.mode==='demo'?person.initials:<Icon name="phone"/>}</span><div><h3>{call.mode==='demo'?person.name:'Test volunteer'}</h3><p>{slotDate(slot)} · {slotTime(slot)} · {slot.duration} min</p></div><span className={`badge ${call.phase==='booked'?'mint-badge':isActive(call)?'blue-badge':'amber'}`}>{phaseNames[call.phase]}</span></div>
    <div className="provenance"><span className={call.mode==='demo'?'tiny-dot':'live-dot'}/>{call.mode==='demo'?'SIMULATED CALL · SCRIPTED RESPONSE':'LIVE CALL-E TEST · FICTIONAL APPOINTMENT'}{call.providerId&&<span className="call-reference">{call.providerId}</span>}</div>
    {['queued','calling'].includes(call.phase)?<div className="call-progress" role="status"><span className="call-pulse"><Icon name="phone" size={24}/></span><div><strong>{call.phase==='queued'?'Preparing the conversation…':'Listening for a clear answer…'}</strong><p>{call.mode==='demo'?'Running the selected demo scenario. No phone is being dialed.':'The saved CALL-E call is being checked for a result. You can return to this page.'}</p></div><span className="sound-wave"><i/><i/><i/><i/><i/></span></div>:<>
      <div className="result-grid"><div className="result-story"><div className="call-result"><span className={`result-icon ${call.canAttend==='yes'?'yes':''}`}><Icon name={call.canAttend==='yes'?'check':call.canAttend==='no'?'close':'info'}/></span><div><h4>{call.phase==='booked'?'An earlier appointment, confirmed.':call.canAttend==='yes'?'The offered time works.':call.canAttend==='no'?'This time doesn’t work.':'A clear answer is still needed.'}</h4><p>{call.phase==='booked'?call.decision:call.summary}</p></div></div>{call.evidence.length>0&&<div className="evidence"><span className="evidence-label"><Icon name="search" size={13}/>{call.mode==='demo'?'SCRIPTED EVIDENCE':'RETURNED CALL-E EVIDENCE'}</span>{call.evidence.slice(0,3).map((item,i)=><blockquote key={i}>{item}</blockquote>)}</div>}</div>
      <aside className="decision-panel" aria-label="Booking decision checks"><div className="decision-panel-title"><Icon name="shield" size={16}/><strong>The booking decision</strong></div>{checks.map(([passed,label])=><div key={label} className={`decision-check ${passed?'passed':''}`}><span>{passed?<Icon name="check" size={12}/>:<span/>}</span>{label}</div>)}<p>{call.phase==='booked'?'Confirmed by staff in this fictional workspace.':canConfirm(call)?'The response is ready. Review the evidence, then decide.':call.phase==='closed'?'Review is closed. This call made no booking.':'Keep this appointment open until availability is clear.'}</p></aside></div>
      {turns.length>0&&<details className="transcript"><summary><span className="transcript-symbol"><Icon name="phone" size={15}/></span>Read {call.mode==='demo'?'simulated ':''}transcript <span className="transcript-count">{turns.length} turns</span><Icon name="chevron" size={14}/></summary><div>{turns.map((t,i)=><p key={i} className={t.speaker==='Volunteer'?'volunteer-turn':'assistant-turn'}><strong>{t.speaker==='Assistant'?(call.mode==='demo'?'Demo assistant':'CALL-E assistant'):t.speaker}</strong><span>{t.text}</span></p>)}</div></details>}
      {call.phase==='review'&&<div className="review-actions"><span><Icon name="shield" size={16}/>{canConfirm(call)?'Ready for your final confirmation':'Keep the slot open until availability is clear'}</span><div><button className="outline-button" disabled={busy} onClick={()=>void onDecision(call,'close')}>{call.canAttend==='unknown'?'Close for manual follow-up':'Keep slot open'}</button>{canConfirm(call)&&<button className="primary" disabled={busy} onClick={()=>void onDecision(call,'confirm')}><Icon name="check" size={16}/>{call.mode==='demo'?'Confirm demo booking':'Confirm test booking'}</button>}</div></div>}
      {call.decision&&<div className="decision"><Icon name={call.phase==='booked'?'check':'info'} size={16}/>{call.decision}<span>{call.phase==='booked'?`${slot.duration} fictional minutes booked`:'Appointment kept open'}</span></div>}
      {call.phase==='uncertain'&&<a className="text-button" href="https://dashboard.heycall-e.com/" target="_blank" rel="noreferrer">Check CALL-E dashboard <Icon name="external" size={15}/></a>}
    </>}
  </article>;
}

function PublicDemoInfo() {
  return <><PageHeading eyebrow="THE VOICE BEHIND THE WORKFLOW" title="A thoughtful call. A human decision." description="Try the appointment workflow with fictional people and clearly labelled, scripted responses."/>
    <div className="setup-grid"><section className="panel setup-card"><span className="large-icon"><Icon name="phone" size={30}/></span><h2>Your own demo workspace</h2><span className="badge mint-badge">Ready to explore</span><p className="small-copy">Choose an appointment, preview a conversation and review the answer. A clear yes still needs your confirmation before the fictional slot is booked.</p><p className="small-copy">Progress is saved in this browser. Reset demo clears it and creates fresh appointment dates. This site cannot place real calls.</p><a className="primary" href="https://github.com/Madhuri-4596/clinic-slot-assistant" target="_blank" rel="noreferrer">Explore the source <Icon name="external" size={16}/></a></section>
    <section className="panel setup-guide"><h3>Where CALL-E fits</h3><ol><li><strong>A focused conversation</strong><p>The local application uses CALL-E to ask a consenting test volunteer about one fictional appointment time.</p></li><li><strong>A response with evidence</strong><p>The integration returns availability, completion status and conversation evidence for review. Here, four scripted scenarios let you explore each outcome.</p></li><li><strong>Staff have the final say</strong><p>Acceptance enables confirmation. Refusal, uncertainty and no answer keep the appointment open for follow-up.</p></li></ol><div className="info-box"><Icon name="info" size={18}/><p>The creator verified the local CALL-E integration with an authorized volunteer test. This public site demonstrates the workflow through simulation and does not connect to a real clinic calendar.</p></div><a className="text-button" href="https://github.com/CALLE-AI/awesome-phone-call-agents/pull/505" target="_blank" rel="noreferrer">View the organizer contribution <Icon name="external" size={16}/></a></section></div></>;
}
