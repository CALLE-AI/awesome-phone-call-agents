import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, HeartHandshake, PhoneCall, Plus, ShieldCheck, Sparkles, Users, X } from 'lucide-react'
import type { CheckInResult } from '../server/contract.js'
import type { PostCallPlan } from '../server/decision.js'
import { applyCompletedRun, completeFollowUp, demoPlan, demoResult, eventOptions, initialState, toCheckInRequest, type ConnectedState, type Participant } from './workflow'

const STORAGE_KEY = 'connected-operator-state-v1'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function loadState(): ConnectedState {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value ? JSON.parse(value) as ConnectedState : initialState
  } catch { return initialState }
}

function maskPhone(phone: string) {
  return phone ? `${phone.slice(0, 3)}••••${phone.slice(-3)}` : 'Not added'
}

export default function App() {
  const [state, setState] = useState<ConnectedState>(loadState)
  const [selected, setSelected] = useState(0)
  const [operatorOpen, setOperatorOpen] = useState(false)
  const [enrolOpen, setEnrolOpen] = useState(false)
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [phase, setPhase] = useState('Ready to meet the companion')
  const [running, setRunning] = useState(false)
  const [oneCallApproved, setOneCallApproved] = useState(false)
  const [operatorToken, setOperatorToken] = useState('')
  const [liveReady, setLiveReady] = useState(false)
  const [error, setError] = useState('')
  const [newProfile, setNewProfile] = useState({ name: '', phone: '', window: 'Tuesday afternoon', locale: 'en-GB', region: 'GB' })
  const person = state.participants[Math.min(selected, state.participants.length - 1)]

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) }, [state])
  useEffect(() => { fetch('/api/connected').then((response) => response.json()).then((data: { liveReady?: boolean }) => setLiveReady(Boolean(data.liveReady))).catch(() => setLiveReady(false)) }, [])

  const timeline = state.timeline.filter((item) => item.participantId === person.id).slice(-5)
  const openFollowUps = state.followUps.filter((item) => item.status === 'open')
  const completedRuns = state.runs.filter((run) => run.status === 'completed')
  const enjoyedRate = completedRuns.length ? Math.round(completedRuns.filter((run) => run.enjoyed).length / completedRuns.length * 100) : 0
  const metrics = useMemo(() => ({ conversations: completedRuns.length, enjoyedRate, memories: state.participants.reduce((sum, item) => sum + item.memories.length, 0), followUps: openFollowUps.length }), [completedRuns.length, enjoyedRate, openFollowUps.length, state.participants])

  function updateParticipant(update: Partial<Participant>) {
    setState((current) => ({ ...current, participants: current.participants.map((item) => item.id === person.id ? { ...item, ...update } : item) }))
  }

  function enrolParticipant(event: React.FormEvent) {
    event.preventDefault()
    const id = `participant-${Date.now()}`
    const initials = newProfile.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'NP'
    const participant: Participant = { id, initials, name: newProfile.name.trim(), phone: newProfile.phone.trim(), locale: newProfile.locale, region: newProfile.region, scheduledWindow: newProfile.window, next: newProfile.window, memories: [], nextTopic: 'Begin with what they would enjoy talking about today.', tone: 'New', action: 'Consent recorded', consentRecorded: true, aiDisclosureApproved: true, active: true }
    setState((current) => ({ ...current, participants: [...current.participants, participant] }))
    setSelected(state.participants.length)
    setNewProfile({ name: '', phone: '', window: 'Tuesday afternoon', locale: 'en-GB', region: 'GB' })
    setEnrolOpen(false)
  }

  async function runDemo() {
    setRunning(true); setError(''); setPhase('Calling Margaret…')
    await wait(650); setPhase('A genuine conversation is unfolding…')
    await wait(900); setPhase('Checking consent and confirmed memories…')
    await wait(700)
    setState((current) => applyCompletedRun(current, person.id, demoResult, demoPlan, `demo-${Date.now()}`, 'demo'))
    setPhase('Complete — the next call was agreed and scheduled'); setRunning(false)
  }

  async function runLive() {
    if (!oneCallApproved) { setError('Approve exactly one live call for this window first.'); return }
    if (!person.phone) { setError('Add an explicit E.164 phone number to this participant record.'); return }
    if (!operatorToken) { setError('Enter the deployment’s private program access code.'); return }
    setRunning(true); setError(''); setPhase('Submitting one approved CALL-E call…')
    try {
      const started = await fetch('/api/connected', { method: 'POST', headers: { 'content-type': 'application/json', 'x-connected-access-token': operatorToken }, body: JSON.stringify({ request: toCheckInRequest(person) }) })
      const startBody = await started.json() as { id?: string; error?: string }
      if (!started.ok || !startBody.id) throw new Error(startBody.error || 'CALL-E did not accept the call.')
      for (let attempt = 0; attempt < 75; attempt += 1) {
        setPhase(attempt < 2 ? 'CALL-E accepted the call…' : 'Conversation in progress…')
        await wait(4000)
        const response = await fetch(`/api/connected?callId=${encodeURIComponent(startBody.id)}`, { headers: { 'x-connected-access-token': operatorToken } })
        const body = await response.json() as { terminal?: boolean; result?: CheckInResult; plan?: PostCallPlan; status?: string; error?: string }
        if (!response.ok) throw new Error(body.error || 'Unable to read CALL-E status.')
        if (body.terminal) {
          if (body.result && body.plan) setState((current) => applyCompletedRun(current, person.id, body.result!, body.plan!, startBody.id!, 'calle'))
          setPhase(body.result ? 'Complete — memory saved and the next call scheduled' : `Call ended: ${body.status || 'unknown'}`)
          setRunning(false); return
        }
      }
      throw new Error('The call is still running. Its id is preserved; retry status later.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Live workflow failed safely.'); setPhase('Stopped safely'); setRunning(false)
    }
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Connected home"><span className="brand-mark"><PhoneCall size={17} /></span>Connected</a>
        <nav aria-label="Primary"><a href="#how">How it works</a><a href="#impact">Impact</a><a href="#safety">Safety</a></nav>
        <button className="quiet-button" onClick={() => { setOperatorOpen(true); setEnrolOpen(true) }}>Book my first call</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" />Designed to turn isolation into connection</div>
          <h1>Every call picks up<br/><em>where the last one left off.</em></h1>
          <p className="lede">Connected is an AI phone companion for older adults. It listens, remembers with permission, and keeps a genuine conversation going—from family updates and gardens to what’s happening nearby.</p>
          <div className="hero-actions">
            <button className="primary" data-testid="preview-check-in" onClick={() => { setOperatorOpen(true); setEnrolOpen(true) }}>Book my first conversation <ArrowRight size={17} /></button>
            <a className="text-link" href="#how">See what makes it feel familiar <ChevronRight size={16} /></a>
          </div>
          <div className="trust-row"><span><ShieldCheck size={17}/>Consent at every call</span><span><HeartHandshake size={17}/>A familiar conversation, every time</span></div>
        </div>
        <div className="call-card" aria-label="Example Connected call">
          <div className="call-card-top"><span className="live-label"><span className="live-dot"/>Companion call in progress</span><span>08:42</span></div>
          <div className="portrait"><img src="/margaret-phone-companion.png" alt="Margaret smiling during her companion call"/><div className="ring ring-one"/><div className="ring ring-two"/></div>
          <h2>Margaret</h2><p>Friday afternoon companion call</p>
          <div className="wave" aria-hidden="true">{[12,22,9,29,18,34,14,25,10,30,17,23,8,19,12].map((height, index) => <i key={index} style={{height}} />)}</div>
          <blockquote>“Last Friday you said the first tomato was nearly red. Did it beat the birds?”</blockquote>
          <div className="remembered"><Sparkles size={16}/><span><b>Remembered with permission</b>Balcony garden · Grandson Leo</span></div>
        </div>
      </section>

      <section className="proof-strip" id="impact">
        <div><strong>1 in 4</strong><span>older people affected by social isolation or loneliness¹</span></div>
        <div><strong>29%</strong><span>higher heart-disease risk associated with isolation²</span></div>
        <div><strong>32%</strong><span>higher stroke risk associated with isolation²</span></div>
        <p>¹ WHO, 2025. ² CDC evidence summary. Association is not causation, and Connected makes no clinical claim.</p>
      </section>

      <section className="impact-evidence">
        <div className="section-heading"><span>MEASURABLE, NOT MAGICAL</span><h2>Telephone connection can help.<br/>Connected will prove how much.</h2><p>A 2024 randomized trial found a telephone narrative intervention reduced loneliness versus active-control calls with a medium-to-large effect (<b>Cohen’s d = 0.60</b>). That is external evidence, not a Connected result.</p></div>
        <div className="impact-cards">
          <article><b>Published signal</b><strong>d = 0.60</strong><p>Four-week telephone narrative intervention compared with regular calls.</p><a href="https://pubmed.ncbi.nlm.nih.gov/39138085/" target="_blank" rel="noreferrer">Read the randomized trial</a></article>
          <article className="target"><b>Connected pilot target</b><strong>≥15%</strong><p>Average improvement in a validated loneliness score after eight weeks. A target—not a claimed result.</p></article>
          <article><b>Closed-loop proof</b><strong>4 signals</strong><p>Enjoyed calls, connection pulse, completed introductions, and repeat participation—each with honest denominators.</p></article>
        </div>
      </section>

      <section className="workflow" id="how">
        <div className="section-heading"><span>THE DIFFERENCE</span><h2>Not a check-box call.<br/>A conversation with continuity.</h2><p>Connected is designed to feel less like outreach and more like someone genuinely remembered what you said.</p></div>
        <div className="steps">
          <article><span>01</span><PhoneCall/><h3>Book the first call</h3><p>The older adult chooses when to receive their first conversation. No app skills or coordinator needed.</p></article>
          <article><span>02</span><Sparkles/><h3>Talk, don’t transact</h3><p>CALL-E follows the conversation naturally, with room for stories, humour, pauses, and changing the subject.</p></article>
          <article><span>03</span><CalendarDays/><h3>Choose the next time together</h3><p>Before goodbye, the companion agrees the next call with them and automatically adds it to their cadence.</p></article>
          <article><span>04</span><HeartHandshake/><h3>Grow familiar</h3><p>Each call returns to details they approved, so companionship deepens without pretending the AI is human.</p></article>
        </div>
      </section>

      <section className="console-section">
        <div className="section-heading compact"><span>COMPANION CONTINUITY</span><h2>The next lovely conversation already has a beginning.</h2></div>
        <div className="metric-row"><div><strong>{metrics.conversations}</strong><span>conversations completed</span></div><div><strong>{metrics.enjoyedRate}%</strong><span>said the call was enjoyable</span></div><div><strong>{metrics.memories}</strong><span>confirmed conversation threads</span></div><div><strong>{metrics.followUps}</strong><span>connections requested</span></div></div>
        <div className="console personal">
          <aside className="companion-portrait-panel">
            <img src="/margaret-phone-companion.png" alt="Margaret smiling while talking with her AI phone companion"/>
            <div><span>THE FEELING</span><blockquote>“It remembered my tomatoes—and asked when I’d like to talk again.”</blockquote><small>Illustrative companion story</small></div>
          </aside>
          <div className="detail">
            <div className="detail-head"><div><span className="status"><Check size={13}/>{person.action}</span><h3>{person.name}’s companion</h3><p>{person.nextTopic}</p></div><button className="primary small" onClick={() => setOperatorOpen(true)}>Experience the next call</button></div>
            <div className="signal-grid"><div><span>How the latest call felt</span><b>{person.tone}</b><small>Shared by {person.name}</small></div><div><span>Next call agreed together</span><b>{person.next}</b><small>Automatically added · always cancellable</small></div><div><span>Companion reaches</span><b>{maskPhone(person.phone)}</b><small>No smartphone needed after booking</small></div></div>
            <div className="timeline"><h4>Moments worth carrying into next time</h4>{timeline.length ? timeline.map((item) => <div className="timeline-item" key={item.id}><time>{item.time}</time><span/><div><b>{item.title}</b><p>{item.text}</p></div></div>) : <p className="empty">No conversation history yet. The first call starts gently, without pretending to know them.</p>}</div>
          </div>
        </div>
        <div className="follow-up-board"><div><span>REQUESTED CONNECTIONS</span><h3>A conversation can open a real door.</h3></div>{openFollowUps.length ? openFollowUps.map((item) => <article key={item.id}><div><b>{item.title}</b><small>{state.participants.find((participant) => participant.id === item.participantId)?.name} · requested {item.createdAt}</small></div><button onClick={() => setState((current) => completeFollowUp(current, item.id))}>Mark connected <Check size={14}/></button></article>) : <p>Nothing waiting. Every requested connection has been made.</p>}</div>
      </section>

      <section className="safety" id="safety"><div><span className="eyebrow">QUIETLY PROTECTED</span><h2>Warm enough to trust.<br/>Clear enough to control.</h2></div><ul><li><Check/>Always says the companion is AI</li><li><Check/>Remembers only with permission</li><li><Check/>No community introduction without opt-in</li><li><Check/>Every future call is visible and cancellable</li><li><Check/>Remembered details can be deleted</li><li><Check/>Advice and emergency response stay out of scope</li></ul></section>

      <footer><div className="brand"><span className="brand-mark"><PhoneCall size={17}/></span>Connected</div><p>There’s always more to talk about.</p><span>Powered by CALL-E</span></footer>

      {operatorOpen && <div className="modal-backdrop" role="presentation"><section className="modal workspace-modal" data-testid="operator-workspace" role="dialog" aria-modal="true" aria-labelledby="workspace-title"><button className="close" onClick={() => { setOperatorOpen(false); setEnrolOpen(false) }} aria-label="Close"><X/></button>
        <div className="workspace-head"><div><span className="eyebrow">AI COMPANION DEMO</span><h2 id="workspace-title">See how the next call remembers.</h2><p>{person.name} · {person.scheduledWindow}</p></div><span className={liveReady ? 'readiness ready' : 'readiness'}>{liveReady ? 'Live companion ready' : 'Interactive demo ready'}</span></div>
        {enrolOpen ? <form className="enrol-form" onSubmit={enrolParticipant}><h3>Book your first companion call</h3><p>Choose a comfortable time. After that, you and Connected agree each next call together.</p><div className="form-grid"><label>Your name<input required value={newProfile.name} onChange={(event) => setNewProfile({...newProfile, name: event.target.value})}/></label><label>Your phone number<input required placeholder="+353…" value={newProfile.phone} onChange={(event) => setNewProfile({...newProfile, phone: event.target.value})}/></label><label>When should we call?<input required value={newProfile.window} onChange={(event) => setNewProfile({...newProfile, window: event.target.value})}/></label><label>Conversation language<input required value={newProfile.locale} onChange={(event) => setNewProfile({...newProfile, locale: event.target.value})}/></label></div><div className="consent-note"><ShieldCheck/>I agree to this first call. Connected will always say it is AI and ask before remembering anything.</div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setEnrolOpen(false)}>See demo first</button><button className="primary">Book my call</button></div></form> : <>
          <div className="mode-tabs"><button className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>Hear the story unfold</button><button className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>Live CALL-E companion</button></div>
          <div className="workspace-grid"><div className="call-contract"><h3>Conversation contract</h3><dl><div><dt>Approved openings</dt><dd>{person.memories.length ? person.memories.join(' · ') : 'None yet—start fresh'}</dd></div><div><dt>Next topic</dt><dd>{person.nextTopic}</dd></div><div><dt>Verified events</dt><dd>{eventOptions.map((event) => event.title).join(' · ')}</dd></div><div><dt>Boundaries</dt><dd>No advice, booking, diagnosis, or invented personal detail</dd></div></dl><label>Participant phone<input placeholder="+353…" value={person.phone} onChange={(event) => updateParticipant({phone: event.target.value})}/></label></div>
            <div className="run-panel"><h3>{mode === 'demo' ? 'One conversation, end to end' : 'One protected live companion call'}</h3><div className="phase"><span className={running ? 'phase-dot running' : 'phase-dot'}/><b>{phase}</b></div>{mode === 'live' && <><label>Program access code<input type="password" value={operatorToken} onChange={(event) => setOperatorToken(event.target.value)} autoComplete="off"/></label><label className="confirm"><input type="checkbox" checked={oneCallApproved} onChange={(event) => setOneCallApproved(event.target.checked)}/> I approve exactly one CALL-E companion call to {maskPhone(person.phone)} in this window.</label></>} {error && <p className="error">{error}</p>}<button className="primary full" disabled={running} onClick={mode === 'demo' ? runDemo : runLive}>{running ? 'Companion call unfolding…' : mode === 'demo' ? 'Experience the companion call' : 'Start one companion call'} <ArrowRight size={16}/></button><small>{mode === 'demo' ? 'A labelled simulation shows the conversation’s impact on memory, metrics, and requested connections.' : 'Requires protected CALL-E credentials on Vercel.'}</small></div></div>
          <button className="enrol-link" onClick={() => setEnrolOpen(true)}><Plus size={15}/> Book my own first call</button>
        </>}
      </section></div>}
    </main>
  )
}
