import { useState } from 'react'
import { ArrowRight, CalendarDays, Check, ChevronRight, HeartHandshake, PhoneCall, ShieldCheck, Sparkles, Users } from 'lucide-react'

type Person = { initials: string; name: string; next: string; note: string; tone: string; action: string }

const people: Person[] = [
  { initials: 'MH', name: 'Margaret H.', next: 'Today · 2:30 PM', note: 'Ask about the balcony tomatoes and Leo’s school play.', tone: 'Steady', action: 'Check-in ready' },
  { initials: 'AP', name: 'Arthur P.', next: 'Tomorrow · 10:00 AM', note: 'Interested in local history and chess.', tone: 'Brighter', action: 'Event reminder' },
  { initials: 'RS', name: 'Ruth S.', next: 'Friday · 4:00 PM', note: 'Requested a call from community coordinator Maya.', tone: 'Follow-up', action: 'Human review' },
]

const timeline = [
  { time: '2:31', title: 'Consent confirmed', text: 'Margaret chose to continue after the AI disclosure.' },
  { time: '2:39', title: 'A new thread, in her words', text: '“The first tomato finally turned red.” Read back and confirmed.' },
  { time: '2:42', title: 'A real-world next step', text: 'Interested in Tuesday’s local history tea; reminder requested.' },
]

export default function App() {
  const [selected, setSelected] = useState(0)
  const [preview, setPreview] = useState(false)
  const person = people[selected]
  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Connected home"><span className="brand-mark"><PhoneCall size={17} /></span>Connected</a>
        <nav aria-label="Primary"><a href="#how">How it works</a><a href="#impact">Impact</a><a href="#safety">Safety</a></nav>
        <button className="quiet-button">Operator sign in</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" />Built for community care teams</div>
          <h1>Every call picks up<br/><em>where the last one left off.</em></h1>
          <p className="lede">Connected is an AI phone companion for older adults. It listens, remembers with permission, and keeps a genuine conversation going—from family updates and gardens to what’s happening nearby.</p>
          <div className="hero-actions">
            <button className="primary" data-testid="preview-check-in" onClick={() => setPreview(true)}>Preview a check-in <ArrowRight size={17} /></button>
            <a className="text-link" href="#how">See what makes it feel familiar <ChevronRight size={16} /></a>
          </div>
          <div className="trust-row"><span><ShieldCheck size={17}/>Consent at every call</span><span><HeartHandshake size={17}/>Human decisions stay human</span></div>
        </div>
        <div className="call-card" aria-label="Example Connected call">
          <div className="call-card-top"><span className="live-label"><span className="live-dot"/>Check-in in progress</span><span>08:42</span></div>
          <div className="portrait"><img src="/margaret-phone-companion.png" alt="Margaret smiling during her companion call"/><div className="ring ring-one"/><div className="ring ring-two"/></div>
          <h2>Margaret</h2><p>Friday afternoon check-in</p>
          <div className="wave" aria-hidden="true">{[12,22,9,29,18,34,14,25,10,30,17,23,8,19,12].map((height, i) => <i key={i} style={{height}} />)}</div>
          <blockquote>“Last Friday you said the first tomato was nearly red. Did it beat the birds?”</blockquote>
          <div className="remembered"><Sparkles size={16}/><span><b>Remembered with permission</b>Balcony garden · Grandson Leo</span></div>
        </div>
      </section>

      <section className="proof-strip" id="impact">
        <div><strong>20m</strong><span>room for an unhurried chat</span></div>
        <div><strong>1</strong><span>familiar thread to reopen</span></div>
        <div><strong>0</strong><span>forms for the participant</span></div>
        <p>Made for ordinary conversation first. Reminders and community introductions appear only when the person wants them.</p>
      </section>

      <section className="workflow" id="how">
        <div className="section-heading"><span>THE DIFFERENCE</span><h2>Not a check-box call.<br/>A conversation with continuity.</h2><p>Connected is designed to feel less like outreach and more like someone genuinely remembered what you said.</p></div>
        <div className="steps">
          <article><span>01</span><Sparkles/><h3>Remember the person</h3><p>Only approved details return: the roses, a favourite song, or the grandchild starting school.</p></article>
          <article><span>02</span><PhoneCall/><h3>Talk, don’t transact</h3><p>CALL-E follows the conversation naturally, with room for stories, humour, pauses, and changing the subject.</p></article>
          <article><span>03</span><CalendarDays/><h3>Share something to anticipate</h3><p>If it fits the conversation, Connected can mention a verified local event and offer a gentle reminder.</p></article>
          <article><span>04</span><Users/><h3>Make introductions easy</h3><p>When the person wants more, an operator can connect them with a real community group or service.</p></article>
        </div>
      </section>

      <section className="console-section">
        <div className="section-heading compact"><span>COMPANION CONTINUITY</span><h2>The next lovely conversation already has a beginning.</h2></div>
        <div className="console">
          <aside>
            <div className="aside-head"><b>Today’s circle</b><span>3 people</span></div>
            {people.map((item, index) => <button key={item.name} onClick={() => setSelected(index)} className={selected === index ? 'person active' : 'person'}>
              <span className="avatar">{item.initials}</span><span><b>{item.name}</b><small>{item.next}</small></span><ChevronRight size={16}/>
            </button>)}
          </aside>
          <div className="detail">
            <div className="detail-head"><div><span className="status"><Check size={13}/>{person.action}</span><h3>{person.name}</h3><p>{person.note}</p></div><button className="primary small" onClick={() => setPreview(true)}>Review call</button></div>
            <div className="signal-grid"><div><span>How the call felt</span><b>{person.tone}</b><small>Shared by the participant</small></div><div><span>Next conversation</span><b>{person.next.split(' · ')[0]}</b><small>Visible and cancellable</small></div><div><span>Optional next step</span><b>{selected === 2 ? 'Community introduction' : selected === 1 ? 'Event reminder' : 'Just another chat'}</b><small>Always chosen, never assumed</small></div></div>
          <div className="timeline"><h4>Moments worth carrying into next time</h4>{timeline.map(item => <div className="timeline-item" key={item.time}><time>{item.time}</time><span/><div><b>{item.title}</b><p>{item.text}</p></div></div>)}</div>
          </div>
        </div>
      </section>

      <section className="safety" id="safety"><div><span className="eyebrow">QUIETLY PROTECTED</span><h2>Warm enough to trust.<br/>Clear enough to control.</h2></div><ul><li><Check/>Always says the companion is AI</li><li><Check/>Remembers only with permission</li><li><Check/>No community introduction without opt-in</li><li><Check/>Every future call is visible and cancellable</li><li><Check/>Remembered details can be deleted</li><li><Check/>Advice and emergency response stay out of scope</li></ul></section>

      <footer><div className="brand"><span className="brand-mark"><PhoneCall size={17}/></span>Connected</div><p>There’s always more to talk about.</p><span>Powered by CALL-E</span></footer>

      {preview && <div className="modal-backdrop" role="presentation" onMouseDown={() => setPreview(false)}><section className="modal" data-testid="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title" onMouseDown={e => e.stopPropagation()}><button className="close" onClick={() => setPreview(false)} aria-label="Close">×</button><span className="eyebrow">NO-CALL PREVIEW</span><h2 id="preview-title">Margaret’s Friday check-in</h2><p className="modal-lede">The operator sees the full plan before any phone side effect.</p><dl><div><dt>Purpose</dt><dd>Warm conversation and optional event connection</dd></div><div><dt>Approved memories</dt><dd>Balcony tomatoes; grandson Leo’s school play</dd></div><div><dt>Event offered</dt><dd>Tea &amp; local history · Tuesday, 2 PM</dd></div><div><dt>Boundaries</dt><dd>No advice, booking, or service commitment</dd></div></dl><label className="confirm"><input type="checkbox" defaultChecked readOnly/> One call was explicitly approved for this window</label><button className="primary full" onClick={() => setPreview(false)}>Preview complete—no call placed <Check size={17}/></button></section></div>}
    </main>
  )
}
