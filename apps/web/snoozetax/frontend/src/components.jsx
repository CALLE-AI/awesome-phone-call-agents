import { useState } from 'react';

/** Clocky, the mascot: an alarm clock that is also a face. */
export function Clock({ size = 120, mood = 'sleepy' }) {
  const ink = '#16140E', yellow = '#FFD23F';

  const eyes = {
    panic: <>
      <circle cx="62" cy="78" r="9" fill="#fff" stroke={ink} strokeWidth="3" />
      <circle cx="62" cy="78" r="3" fill={ink} />
      <circle cx="98" cy="78" r="9" fill="#fff" stroke={ink} strokeWidth="3" />
      <circle cx="98" cy="78" r="3" fill={ink} />
    </>,
    happy: <>
      <path d="M55 79 Q62 70 69 79" stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M91 79 Q98 70 105 79" stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round" />
    </>,
    dead: <>
      <path d="M55 80 L69 72 M55 72 L69 80" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M91 80 L105 72 M91 72 L105 80" stroke={ink} strokeWidth="4.5" strokeLinecap="round" />
    </>,
    sleepy: <>
      <path d="M55 80 Q62 74 69 80" stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <path d="M91 80 Q98 74 105 80" stroke={ink} strokeWidth="4.5" fill="none" strokeLinecap="round" />
    </>,
  }[mood];

  const mouth = {
    panic:  <ellipse cx="80" cy="101" rx="8.5" ry="10.5" fill={ink} />,
    happy:  <path d="M68 99 Q80 112 92 99" stroke={ink} strokeWidth="4" fill="none" strokeLinecap="round" />,
    dead:   <path d="M68 106 Q80 95 92 106" stroke={ink} strokeWidth="4" fill="none" strokeLinecap="round" />,
    sleepy: <path d="M70 101 Q80 108 90 101" stroke={ink} strokeWidth="4" fill="none" strokeLinecap="round" />,
  }[mood];

  return (
    <svg width={size} height={size} viewBox="0 0 160 160" role="img"
         aria-label={`Clocky the alarm clock looking ${mood}`} style={{ display: 'block' }}>
      <ellipse cx="80" cy="149" rx="42" ry="5" fill={ink} opacity=".16" />
      <rect x="55" y="132" width="14" height="14" rx="3" fill={ink} />
      <rect x="91" y="132" width="14" height="14" rx="3" fill={ink} />
      <circle cx="34" cy="32" r="13" fill={yellow} stroke={ink} strokeWidth="4" />
      <circle cx="126" cy="32" r="13" fill={yellow} stroke={ink} strokeWidth="4" />
      <rect x="78" y="20" width="4" height="14" rx="1.5" fill={ink} />
      <circle cx="80" cy="18" r="4" fill={ink} />
      <circle cx="80" cy="84" r="52" fill={yellow} stroke={ink} strokeWidth="5" />
      {eyes}
      {mouth}
      {mood === 'sleepy' && (
        <text x="118" y="52" fontFamily="Archivo Black" fontSize="17" fill={ink} opacity=".75">z</text>
      )}
    </svg>
  );
}

/**
 * Clocky at logo size. `awake` opens the eyes: the mark tells you at a glance
 * whether an alarm is armed, which is the one piece of state that matters on
 * every screen. Asleep he keeps his eyes shut and his z.
 *
 * Drawn at this size rather than scaling <Clock/> down: the big mascot's
 * 3px strokes and pupils turn to mud under 32px.
 */
export function Logo({ size = 22, awake = false, ink = '#16140E' }) {
  const yellow = '#FFD23F';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img"
         aria-label={`Clocky, ${awake ? 'awake' : 'asleep'}`} style={{ display: 'block' }}>
      <circle cx="6.5" cy="8" r="3.6" fill={yellow} stroke={ink} strokeWidth="2.2" />
      <circle cx="25.5" cy="8" r="3.6" fill={yellow} stroke={ink} strokeWidth="2.2" />
      <circle cx="16" cy="18.5" r="11.5" fill={yellow} stroke={ink} strokeWidth="2.4" />
      {awake ? (
        <>
          <circle cx="11.8" cy="16.6" r="2.5" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <circle cx="11.8" cy="16.6" r="1" fill={ink} />
          <circle cx="20.2" cy="16.6" r="2.5" fill="#fff" stroke={ink} strokeWidth="1.5" />
          <circle cx="20.2" cy="16.6" r="1" fill={ink} />
          <ellipse cx="16" cy="23" rx="2.2" ry="2.7" fill={ink} />
        </>
      ) : (
        <>
          <path d="M9.4 17.4 Q11.8 15.2 14.2 17.4" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M17.8 17.4 Q20.2 15.2 22.6 17.4" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M13 23 Q16 25.4 19 23" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function Header({ onNav, user, onLogout, awake = false }) {
  const [open, setOpen] = useState(false);
  const go = (v) => { setOpen(false); onNav(v); };

  return (
    <header className="site-head">
      <div className="wrap inner">
        <a className="logo" href="#" onClick={(e) => { e.preventDefault(); go(user ? 'app' : 'landing'); }}>
          <Logo size={26} awake={awake} /> SnoozeTax
        </a>

        <button className="nav-toggle" aria-expanded={open} aria-label="Menu"
                onClick={() => setOpen(!open)}>
          <svg width="20" height="14" viewBox="0 0 20 14" aria-hidden="true">
            <rect y="0" width="20" height="2.6" rx="1.3" fill="#16140E" />
            <rect y="5.7" width="20" height="2.6" rx="1.3" fill="#16140E" />
            <rect y="11.4" width="20" height="2.6" rx="1.3" fill="#16140E" />
          </svg>
        </button>

        <nav className={`site-nav ${open ? 'open' : ''}`}>
          {user ? (
            <>
              <a href="#" onClick={(e) => { e.preventDefault(); go('app'); }}>Alarm</a>
              <a href="#" onClick={(e) => { e.preventDefault(); go('history'); }}>History</a>
              <a href="#" onClick={(e) => { e.preventDefault(); go('settings'); }}>Settings</a>
              <button className="btn sm paper" onClick={() => { setOpen(false); onLogout(); }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <a href="#how" onClick={() => setOpen(false)}>How it works</a>
              <a href="#flow" onClick={() => setOpen(false)}>The flow</a>
              <a href="#why" onClick={() => setOpen(false)}>Why calls</a>
              <a href="#faq" onClick={() => setOpen(false)}>FAQ</a>
              <button className="btn sm" onClick={() => go('signup')}>Get the call</button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ awake = false }) {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <div className="foot-grid">
          <div>
            <div className="row" style={{ gap: 10, marginBottom: 12 }}>
              <Logo size={26} awake={awake} ink="#FFF8E7" />
              <span style={{ fontFamily: 'var(--display)', fontSize: 19, color: 'var(--cream)' }}>
                SnoozeTax
              </span>
            </div>
            <p style={{ fontSize: 14, color: 'rgba(255,248,231,.66)', maxWidth: '34ch' }}>
              An alarm clock that phones you and makes you think, because a snooze
              button cannot tell whether you are awake.
            </p>
          </div>

          <div>
            <h4>Product</h4>
            <ul>
              <li><a href="#how">How it works</a></li>
              <li><a href="#why">Why a phone call</a></li>
              <li><a href="#faq">FAQ</a></li>
            </ul>
          </div>

          <div>
            <h4>Built with</h4>
            <ul>
              <li><a href="https://www.heycall-e.com/" target="_blank" rel="noreferrer">CALL-E</a></li>
              <li><a href="https://docs.heycall-e.com/" target="_blank" rel="noreferrer">CALL-E docs</a></li>
              <li><a href="https://github.com/CALLE-AI/awesome-phone-call-agents" target="_blank" rel="noreferrer">Source</a></li>
            </ul>
          </div>

          <div>
            <h4>Coming</h4>
            <ul>
              <li>Multiple alarms</li>
              <li>Shared wake-up teams</li>
              <li>Sleep-debt reports</li>
            </ul>
          </div>
        </div>

        <div className="foot-bottom">
          <span>Built for the CALL-E hackathon, 2026.</span>
          <span>Calls cost money. Oversleeping costs more.</span>
        </div>
      </div>
    </footer>
  );
}
