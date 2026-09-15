import { useState, useEffect, useRef } from 'react';
import { Clock } from './components';

/* The hero plays the thing the product actually does: a 6:30am phone call
   where a machine decides whether a human is awake. */
const SCRIPT = [
  { who: 'bot',  text: 'Good morning, Alex. Say this code back to me in reverse.' },
  { who: 'bot',  text: 'Your code is 5... 8... 7.' },
  { who: 'user', text: 'mmm... seven, eight... five?' },
  { who: 'bot',  text: "That's it. You are up. Have a good one." },
];

function CallSim() {
  const [shown, setShown] = useState([]);
  const [typing, setTyping] = useState('');
  const [done, setDone] = useState(false);
  const timers = useRef([]);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setShown(SCRIPT); setDone(true); return; }

    const handles = timers.current;
    let delay = 400;
    SCRIPT.forEach((turn, i) => {
      handles.push(setTimeout(() => {
        let n = 0;
        const type = setInterval(() => {
          n++;
          setTyping(turn.text.slice(0, n));
          if (n >= turn.text.length) {
            clearInterval(type);
            setTyping('');
            setShown((s) => [...s, turn]);
            if (i === SCRIPT.length - 1) setDone(true);
          }
        }, 26);
        handles.push(type);
      }, delay));
      delay += turn.text.length * 26 + 620;
    });

    return () => handles.forEach((t) => { clearTimeout(t); clearInterval(t); });
  }, []);

  const pending = SCRIPT[shown.length];

  return (
    <div className="callsim">
      <div className="callsim-top">
        <span className="live-dot" aria-hidden="true" />
        <span className="who">CALL-E</span>
        <span className="when">06:30</span>
      </div>

      <div className="turns" aria-live="polite">
        {shown.map((t, i) => (
          <div className={`turn ${t.who}`} key={i}>
            <span className="avatar" aria-hidden="true">{t.who === 'bot' ? '☎' : '😴'}</span>
            <span className="bubble">{t.text}</span>
          </div>
        ))}
        {typing && pending && (
          <div className={`turn ${pending.who}`}>
            <span className="avatar" aria-hidden="true">{pending.who === 'bot' ? '☎' : '😴'}</span>
            <span className="bubble">{typing}<span className="caret" /></span>
          </div>
        )}
      </div>

      <div className="callsim-verdict">
        {done ? (
          <>
            <span className="verdict-chip">awake</span>
            <span style={{ color: 'rgba(255,248,231,.6)' }}>
              answer_correct: yes · sounded_awake: groggy
            </span>
          </>
        ) : (
          <span style={{ color: 'rgba(255,248,231,.45)' }}>listening…</span>
        )}
      </div>
    </div>
  );
}

function Faq({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="faq-item">
      <button className="faq-q" aria-expanded={open} onClick={() => setOpen(!open)}>
        {q} <span className="mark" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && <p className="faq-a">{a}</p>}
    </div>
  );
}

export default function Landing({ onStart }) {
  return (
    <main className="landing">
      <section className="wrap hero">
        <div>
          <h1>Your alarm can be silenced.<br />A phone call cannot.</h1>
          <p className="lede">
            At wake-up time SnoozeTax rings your phone for real. Answer one simple
            question and your day starts. Stay silent and the person you nominated
            gets a call about it.
          </p>
          <div className="hero-cta">
            <button className="btn lg" onClick={onStart}>Get your wake-up call</button>
            <a className="btn lg paper" href="#how">How it works</a>
          </div>
          <p className="hero-note">
            Verified by phone. No card, no app to install.
          </p>
        </div>
        <CallSim />
      </section>

      <section className="section" id="how">
        <div className="wrap">
          <div className="section-head">
            <h2>Three minutes, once.<br />Then it runs every morning.</h2>
            <p>Set the time, name a witness, and go to sleep.</p>
          </div>
          <div className="steps">
            <article className="card step">
              <span className="num">1</span>
              <h3>The phone rings</h3>
              <p>
                At the minute you chose, CALL-E dials your number and starts talking.
                No notification to swipe away, no volume slider to have muted last night.
              </p>
            </article>
            <article className="card step">
              <span className="num">2</span>
              <h3>You prove you are awake</h3>
              <p>
                CALL-E reads out three digits and you say them back in reverse.
                Repeating a code proves you can hear; reversing one needs you to
                actually think. The code is new every morning, so there is nothing
                to prepare the night before.
              </p>
            </article>
            <article className="card step">
              <span className="num">3</span>
              <h3>Or somebody hears about it</h3>
              <p>
                After the last call, ten minutes start counting on the website. Let
                those run out and CALL-E phones your accountability contact, who agreed
                to that beforehand on a call of their own.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* The flow, drawn rather than described. The branch is the point: answering
          and getting it wrong is treated differently from never picking up, and a
          paragraph makes that sound like a footnote instead of the design decision
          it is.

          Laid out as three sequential stages rather than one three-way fan, because
          the second call is itself a decision point: an earlier version drew it as a
          single lane and so implied the retry could only ever fail, which is wrong.
          Every stage shows its own way out to "You are up", so no box is a dead end.

          Pure CSS, no chart library: it has to stay legible when printed,
          screenshotted for the demo video, or read on a phone. */}
      <section className="section flow-section" id="flow">
        <div className="wrap">
          <div className="section-head">
            <h2>What happens when the phone rings.</h2>
            <p>
              Every path is on this page, including all four ways the morning ends
              well. The one thing it will never do is give up on you after a single
              missed call.
            </p>
          </div>

          <div className="flow">
            {/* Stage 1: the call itself. */}
            <div className="flow-stage">
              <span className="flow-stage-n">1</span>
              <div className="flow-node ring">
                <span className="flow-time">7:00</span>
                <strong>CALL-E calls you</strong>
                <span className="flow-sub">Reads out three digits. Say them back in reverse.</span>
              </div>
            </div>

            <div className="flow-split">
              <div className="flow-branch pass">
                <span className="flow-cond green">Right answer</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node done sm">
                  <strong>You are up</strong>
                  <span className="flow-sub">Nobody else hears anything about it.</span>
                </div>
              </div>

              <div className="flow-branch">
                <span className="flow-cond">Wrong answer</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node sm">
                  <strong>Straight to stage 3</strong>
                  <span className="flow-sub">
                    You picked up, so you are already awake. No second call is placed.
                  </span>
                </div>
              </div>

              <div className="flow-branch">
                <span className="flow-cond">No answer</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node sm">
                  <strong>On to stage 2</strong>
                  <span className="flow-sub">
                    Nobody has proved anything yet, and the phone may never have been heard.
                  </span>
                </div>
              </div>
            </div>

            {/* Stage 2: the retry, which is itself a decision, not a dead end. */}
            <div className="flow-stage">
              <span className="flow-stage-n">2</span>
              <div className="flow-node ring">
                <span className="flow-time">+1 min</span>
                <strong>It rings once more</strong>
                <span className="flow-sub">
                  A face-down phone looks exactly like oversleeping, so a missed call
                  gets a second chance to be heard. This only happens if you never picked up.
                </span>
              </div>
            </div>

            <div className="flow-split two">
              <div className="flow-branch pass">
                <span className="flow-cond green">Right answer</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node done sm">
                  <strong>You are up</strong>
                  <span className="flow-sub">Same as before. That is the end of it.</span>
                </div>
              </div>

              <div className="flow-branch">
                <span className="flow-cond">Wrong answer, or still no answer</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node sm">
                  <strong>On to stage 3</strong>
                  <span className="flow-sub">Both calls are spent. Nothing else will ring.</span>
                </div>
              </div>
            </div>

            {/* Stage 3: the web window, reachable from either of the two stages above. */}
            <div className="flow-stage">
              <span className="flow-stage-n">3</span>
              <div className="flow-node wide">
                <span className="flow-time">10 min</span>
                <strong>Ten minutes on the website</strong>
                <span className="flow-sub">
                  Now the code is shown on the page, because a phone that was face-down
                  never heard one. You still do the reversing.
                </span>
              </div>
            </div>

            <div className="flow-split two">
              <div className="flow-branch pass">
                <span className="flow-cond green">You type it in time</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node done sm">
                  <strong>You are up</strong>
                  <span className="flow-sub">
                    The morning counts as passed, exactly like answering the call.
                  </span>
                </div>
              </div>

              <div className="flow-branch">
                <span className="flow-cond pink">The ten minutes run out</span>
                <div className="flow-arrow" aria-hidden="true" />
                <div className="flow-node alarm sm">
                  <strong>Someone else finds out</strong>
                  <span className="flow-sub">
                    CALL-E phones the person you nominated, who agreed to it beforehand
                    on a call of their own. No card, no fee. The stake is a human being.
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="why">
        <div className="wrap">
          <div className="section-head">
            <h2>A snooze button has never once known whether you woke up.</h2>
            <p>
              It measures a tap. Tapping is something people do in their sleep, with
              their eyes closed, and forget by breakfast. A conversation is different:
              you cannot hold one without being conscious.
            </p>
          </div>

          <div className="feature-grid">
            <article className="card feature">
              <h3>It grades the answer, not the tap</h3>
              <p>
                The call is scored after it ends. CALL-E returns whether your answer was
                right, plus whether you actually sounded alert or were slurring your way
                through it.
              </p>
            </article>
            <article className="card feature">
              <h3>Missing the call is not failing</h3>
              <p>
                Do Not Disturb, no signal and a flat battery all look identical to
                oversleeping. So the phone rings a second time, and then a ten-minute
                window opens on the web, instead of punishing you for your carrier.
              </p>
            </article>
            <article className="card feature">
              <h3>The stake is a person</h3>
              <p>
                No card on file and no fees. The cost of staying in bed is that someone
                who knows you finds out, which works better than two euros ever did.
              </p>
            </article>
            <article className="card feature">
              <h3>Every morning is on the record</h3>
              <p>
                Each call is kept with its transcript and verdict, so you can see how
                many mornings you won, and how many you talked your way out of.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="wrap" style={{ maxWidth: 800 }}>
          <div className="section-head">
            <h2>Questions people ask before trusting this with 6am</h2>
          </div>

          <Faq
            q="What if my phone is on Do Not Disturb?"
            a="You would miss the call, which is exactly why missing it is not treated as failure. The ten-minute web window opens either way. For the call itself to come through, add the number to your allow list, the same way you would for a family member: on iPhone that is Emergency Bypass on the contact, and on Android it is a starred or priority contact."
          />
          <Faq
            q="Does the call always come from the same number?"
            a="Not yet, and we would rather say so. CALL-E places Spanish calls over a shared international pool at the moment, so the caller ID can vary between mornings. A dedicated number is on the roadmap, and it is the reason the web fallback exists at all."
          />
          <Faq
            q="What is the challenge? Can I fail it by accident?"
            a="The same one every morning: CALL-E reads out three digits and you say them back in reverse, so 587 becomes 785. It is deliberately one rule, because nobody should have to learn anything new at 7am. The grading only looks at the digits and their order, so 'seven eight five' and 'it's 785' both count. Getting it wrong does not end your morning either: the code is waiting on the website, where you have ten minutes to type it in backwards. And if you sleep through the call entirely, the phone rings once more a minute later before it falls back to the website."
          />
          <Faq
            q="Who is the accountability contact and what do they hear?"
            a="Somebody you name, who never signed up for SnoozeTax themselves. So before they can ever be called about you, CALL-E phones them once to explain and ask permission, and they are only added if they say yes. After that, if you never wake up, they get a short, good-humoured call saying you are still in bed. If they say no they are never called again, and you can read the exact script for both calls in Settings before you nominate anyone."
          />
          <Faq
            q="Do I need to install anything?"
            a="No. It is a website plus your ordinary phone. You sign in once by taking a verification call, and it keeps you signed in after that, so there is nothing to open at 6am except the link if you miss the call."
          />
          <Faq
            q="Can I have more than one alarm?"
            a="One for now. The scheduler and database already handle many, so it is a limit in the interface rather than the engine, and it is the next thing being turned on."
          />
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <div className="cta-band">
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <Clock size={96} mood="panic" />
            </div>
            <h2>Tomorrow morning, decided tonight.</h2>
            <p>
              Set one alarm, take the verification call, and find out whether you are
              the kind of person who answers.
            </p>
            <button className="btn lg ink" onClick={onStart}>Get your wake-up call</button>
          </div>
        </div>
      </section>
    </main>
  );
}
