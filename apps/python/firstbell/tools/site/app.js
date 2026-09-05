/* Page behaviour.
 *
 * The page borrows a phone call's time axis. Three structural things do nearly all of the
 * work and only one of them is an animation: the artifact in each act is sticky while the
 * prose scrolls past it, the hero call stays present in the rail after the reader has left
 * it, and scroll has consequences exactly twice, at the hero exit and in the rail.
 *
 * Seven primitives may animate and nothing else: playhead-track, field-commit, act-enter,
 * curtain, rail-progress, light-on, strike-through. An eighth requires deleting one of
 * these. strike-through was added for act 3 and nothing was deleted to pay for it, which
 * is a debt against this rule rather than an exception to it: see wireEndings for why the
 * act could not make its argument without it.
 *
 * light-on replaced theatre-open, which took the whole document to near-black for the
 * section a call was in. The light is a property of the one row that is running now, so it
 * is one background on one element instead of a restyle of the page.
 *
 * Lenis is loaded from a CDN and is optional. If it fails to arrive the page still scrolls,
 * plays and reads, which is the same state a reader gets with JavaScript off or with
 * reduced motion asked for. Nothing else on this page comes from anywhere else.
 */
import { CallPlayer } from './player.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DESKTOP = matchMedia('(min-width: 60rem)').matches;
const DATA = JSON.parse(document.getElementById('call-data').textContent);
const AUDIO = document.documentElement.dataset.audio === 'present' ? 'audio' : null;

const players = [];

/* ---- smooth scroll ------------------------------------------------------------------- */
/* Lenis drives the native window scroll, so the sticky hero and the one scroll listener
 * below work unchanged. It is not constructed on touch: phones have their own physics and
 * fighting them is the fastest way to make a page feel broken. */
function startScroll() {
  if (REDUCED || !DESKTOP || !window.Lenis) return null;
  const lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
  const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  document.querySelectorAll('.rail a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const target = document.querySelector(a.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target, { offset: -64 });
    });
  });
  return lenis;
}

/* ---- off screen -------------------------------------------------------------------- */
/* A call that scrolls out of view stops. A reader who scrolls away mid-sentence should not
 * hear a ghost, and should not come back to a scene half way through a story they did not
 * watch: stopScene leaves the register settled, which is the state the scene was going to
 * end in and the state the page serves.
 *
 * This used to also flip the whole document to a dark mode for the section a call was in.
 * The light is a property of the one element that is running now, so there is no band to
 * invert and no class on the root. An observer rather than a scroll handler either way, so
 * it costs nothing per frame. */
function wireOffscreen() {
  if (!players.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.intersectionRatio > 0.4) continue;
      const p = players.find((q) => q.root === e.target);
      if (!p) continue;
      p.pause();
      p.stopScene();
    }
  }, { threshold: [0, 0.4] });
  players.forEach((p) => io.observe(p.root));
}

/* ---- the scenes ------------------------------------------------------------------------
 *
 * Three scenes now, and they start on different terms.
 *
 * The hero starts on load, because it is the first screen and a reader who has not scrolled
 * yet is already looking at it. The other two start the first time they are actually on
 * screen. A scene that had already finished by the time the reader arrived would be worse
 * than no scene: the page would have shown its argument to nobody and then claimed it had.
 *
 * Silently, all of them. An autoplaying call that made a sound would be the page breaking
 * its own rule, and browsers would refuse it anyway.
 *
 * With reduced motion asked for, every scene settles instead of running, which is the same
 * complete record the server sent. Nothing is behind the animation.
 */

/** Which scene a player belongs to. Ungrouped players are the hero's. */
function groupOf(player) {
  const holder = player.root.closest('[data-group]');
  return holder ? holder.dataset.group : 'hero';
}

function sceneGroups() {
  const groups = new Map();
  for (const p of players) {
    if (!p.commits.length || !p.cells.length) continue;
    const g = groupOf(p);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(p);
  }
  return groups;
}

function wireScene() {
  const groups = sceneGroups();
  if (!groups.size) return;

  if (REDUCED) {
    for (const members of groups.values()) members.forEach((p) => p.sceneSettle());
    return;
  }

  const run = (members) => members.forEach((p) => p.runScene());

  const hero = groups.get('hero');
  // Off the first frame after boot rather than from boot itself, so a scene cannot lengthen
  // the task that boots the page. The long-task ceiling here is 50ms.
  if (hero) requestAnimationFrame(() => run(hero));
  groups.delete('hero');
  if (!groups.size) return;

  /* Once each. A scene that replayed every time it came back into view would be an
   * animation the reader cannot get away from, and the replay button already covers
   * wanting to see it again. */
  const pending = new Map();
  for (const [name, members] of groups) pending.set(members[0].root, { name, members });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.intersectionRatio < 0.4) continue;
      const hit = pending.get(e.target);
      if (!hit) continue;
      pending.delete(e.target);
      io.unobserve(e.target);
      run(hit.members);
    }
  }, { threshold: [0, 0.4] });
  for (const root of pending.keys()) io.observe(root);

  /* One button per group, because two calls that started together have to restart
   * together: pressing play on one lane of a duet and watching it race a lane that is
   * already finished would demonstrate the opposite of the point. */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-replay-group]');
    if (!b) return;
    const members = sceneGroups().get(b.dataset.replayGroup);
    if (members) run(members);
  });
  for (const b of document.querySelectorAll('[data-replay-group]')) {
    b.removeAttribute('hidden');
  }
}

/* ---- three endings ---------------------------------------------------------------------
 *
 * The seventh primitive on this page, and the first one added since the six were written
 * down. It is a strike drawn across a word, and it is here because act 3 has to say that
 * two of three readings of the same call are wrong, which is an event and not a state: a
 * reader who arrives to find them already crossed out has been told the answer rather than
 * shown how it was reached. Nothing was deleted to pay for it, and this note is the honest
 * version of that rather than a redefinition of one of the six to make the count come out.
 *
 * It draws with a transform on a pseudo-element, so no text changes opacity at any point
 * and every run in this act measures the same ratio while the scene is running as it does
 * when it has finished.
 *
 * The served page has the strikes drawn and no marker anywhere, which is the state this
 * leaves behind. Rewinding is the script's job, exactly as it is for the register.
 */
const FILING_STEP = 700;   // one reading at a time, at about the pace they are read

function wireEndings() {
  const box = document.querySelector('[data-endings]');
  if (!box || REDUCED) return;
  const list = box.querySelector('.filings');
  const items = [...box.querySelectorAll('.filings li')];
  if (!list || !items.length) return;

  // Rewound at boot rather than on arrival. Act 3 is below the fold on every viewport this
  // page supports, so the strikes are taken off screen where nobody is looking at them.
  list.dataset.strike = 'off';

  let timers = [];
  const play = () => {
    timers.forEach(clearTimeout);
    timers = [];
    items.forEach((li) => delete li.dataset.at);
    list.dataset.strike = 'off';
    items.forEach((li, i) => {
      timers.push(setTimeout(() => {
        items.forEach((other) => delete other.dataset.at);
        li.dataset.at = 'now';
      }, i * FILING_STEP));
    });
    timers.push(setTimeout(() => {
      // The marker goes out with the last reading. The live colour on this page means
      // something is happening now, and by here nothing is.
      items.forEach((li) => delete li.dataset.at);
      delete list.dataset.strike;
    }, items.length * FILING_STEP));
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.intersectionRatio < 0.4) continue;
      io.unobserve(e.target);
      play();
    }
  }, { threshold: [0, 0.4] });
  io.observe(box);
}

/* ---- copy an id ---------------------------------------------------------------------- */
/* A reader is expected to paste a 32 character provider id into a vendor dashboard. Selecting
 * that by hand off a table is the small friction that stops someone verifying a claim, and an
 * unverified claim is worth nothing here. */
function wireCopy() {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.dataset.copy);
      b.dataset.copied = 'true';
      setTimeout(() => { delete b.dataset.copied; }, 1400);
    } catch {
      // Refused on an insecure origin and in some embedded viewers. Select the text so the
      // reader can still copy it rather than failing silently.
      const r = document.createRange();
      r.selectNodeContents(b);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    }
  });
}

/* ---- players ------------------------------------------------------------------------- */
function wirePlayers() {
  for (const root of document.querySelectorAll('[data-player]')) {
    const ids = root.dataset.player.split(',');
    // One turn index per structured field, in field order, worked out from the transcript
    // by tools/judge_page.py so the served page and the scene agree about which line each
    // field came from.
    const commits = (root.dataset.commits || '')
      .split(',').filter(Boolean).map(Number);
    players.push(new CallPlayer(root, DATA.calls, {
      ids, start: ids[0], cueAt: Number(root.dataset.cue || 0), audioBase: AUDIO,
      onTurn: paintRail, commits,
    }));
  }
  // Only one call may be audible at a time. Two players talking over each other turn the
  // strongest artifact on the page into noise.
  for (const p of players) {
    p.root.addEventListener('click', (e) => {
      if (!e.target.closest('[data-play]')) return;
      for (const q of players) if (q !== p) q.pause();
    });
  }
}

/* ---- the rail ------------------------------------------------------------------------ */
/* The through-line. The hero call is the only object present in more than one act: it is
 * large in Act 0 and then rides in the rail as a 48px miniature, so the reader never loses
 * it. The miniature is redrawn when the spoken turn changes, not every frame. */
let railCanvas = null;

function paintRail(player) {
  if (!railCanvas) return;
  const ctx = railCanvas.getContext('2d');
  const peaks = player.call.peaks || [];
  const { width: w, height: h } = railCanvas.getBoundingClientRect();
  if (!w || !peaks.length) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (railCanvas.width !== Math.round(w * dpr)) {
    railCanvas.width = Math.round(w * dpr);
    railCanvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const cs = getComputedStyle(document.documentElement);
  const done = cs.getPropertyValue('--ink').trim();
  const todo = cs.getPropertyValue('--ink-4').trim();
  const n = 24, step = w / n, played = (player.t / player.call.seconds) * w;
  ctx.clearRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const x = i * step;
    const a = Math.max(1, (peaks[Math.floor((i / n) * peaks.length)] || 0) * h);
    ctx.fillStyle = x <= played ? done : todo;
    ctx.fillRect(x, (h - a) / 2, Math.max(1, step - 1), a);
  }
}

function wireRail() {
  railCanvas = document.querySelector('[data-rail-wave]');
  const links = [...document.querySelectorAll('.rail a')];
  const acts = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if (!acts.length) return;
  /* Which act is the reader in? The one painted at the middle of the viewport.
   *
   * This used to mark whichever act had just entered a band across the middle, and
   * ignored the ones leaving. Act 0 is sticky on desktop, so it covers that band at every
   * scroll position: it never leaves, so it never enters a second time, and scrolling to
   * the bottom and back to the top left the rail still pointing at act 2. Reading what is
   * actually painted answers in both directions, and it is the same rule the reader's eye
   * uses, since the act on top is the act you are looking at. */
  const mark = () => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const here = hit && hit.closest('section[id^="act-"]');
    const i = here ? acts.indexOf(here) : -1;
    if (i < 0) return;   // between acts, or over something that is not one: keep the last
    links.forEach((a, k) => a.setAttribute('aria-current', k === i ? 'true' : 'false'));
  };
  // The observer is only the trigger now, so it fires on leaving as well as entering, and
  // costs one hit test per crossing rather than one per frame.
  const io = new IntersectionObserver(mark, { rootMargin: '-45% 0px -45% 0px' });
  acts.forEach((a) => io.observe(a));
  mark();
  if (players[0]) paintRail(players[0]);
}

/* ---- scrubbed motion ----------------------------------------------------------------- */
/* The two places scroll has consequences, and both are one number between 0 and 1 written
 * to a transform.
 *
 * This was GSAP and ScrollTrigger. They cost 131ms of main thread on load, measured on the
 * built page: 96ms for gsap.min.js and 35ms for ScrollTrigger.min.js, in a single task,
 * because both are deferred and run back to back before DOMContentLoaded. Deleting every
 * trigger the page created left that number unchanged, so it was the price of the
 * libraries arriving rather than of anything asked of them. The code below costs nothing
 * measurable and the curtain pin is CSS position:sticky, which is what pinSpacing:false
 * was emulating in the first place.
 *
 * The listener is passive and coalesced into one frame, and neither element is written
 * unless its value moved: a transform write on a promoted layer costs a raster whether or
 * not the new value differs from the old one. */
/* The one condition under which the curtain exists, written exactly as the stylesheet
 * writes it. Both halves have to be asked live: DESKTOP was read once at parse time, so
 * a window dragged across 960px left the script and the sheet disagreeing until reload.
 * Widened, the rail appeared with an empty progress bar that never filled; narrowed, the
 * sticky rule stopped applying while the scrub kept running, leaving the hero faded to
 * 0.400 for a pin that was no longer holding it. */
const CURTAIN_Q = matchMedia('(min-width: 60rem) and (prefers-reduced-motion: no-preference)');

function wireScrubbed() {
  const hero = document.querySelector('.act-00');
  const inner = hero && hero.querySelector('.inner');
  const next = document.querySelector('.act-01');
  const fill = document.querySelector('[data-rail]');
  const curtain = inner && next;
  if (!curtain && !fill) return;

  /* Where the hero comes to rest.
   *
   * A sticky element taller than the window never scrolls its own overflow into view:
   * its top is held at 0 from the first pixel and everything past the fold stays past
   * the fold for good. This hero is 1232px on a 1440x900 screen and 1190 on a 1366x768
   * one, so 28 to 47 runs of the transcript were unreachable, on the act that is the
   * whole demonstration. Sticking to the bottom instead lets it scroll until its last
   * line is on screen and holds it there, and the curtain is unchanged: Act 1 arrives
   * at the same scroll position either way. */
  const rest = () => {
    if (curtain) hero.style.top = Math.min(0, window.innerHeight - hero.offsetHeight) + 'px';
  };

  let queued = false;
  let on = false;
  let lastCurtain = -1;
  let lastRail = -1;

  // Everything this function writes, taken back off. The stylesheet holds the resting
  // values for all of them, so removing the property is the whole undo.
  const clear = () => {
    if (curtain) {
      delete document.documentElement.dataset.curtain;
      hero.style.removeProperty('top');
      inner.style.removeProperty('transform');
      inner.style.removeProperty('will-change');
    }
    if (fill) fill.style.removeProperty('transform');
    lastCurtain = -1;
    lastRail = -1;
  };

  const frame = () => {
    queued = false;
    if (!CURTAIN_Q.matches) {
      if (on) { on = false; clear(); }
      return;
    }
    if (!on) {
      on = true;
      // Tells the stylesheet the curtain is wired, so a reader with JavaScript off gets
      // the hero they had before rather than a sticky one that never fades.
      if (curtain) document.documentElement.dataset.curtain = 'on';
      rest();
    }
    const y = window.scrollY;

    if (curtain) {
      // The same window ScrollTrigger used: Act 1's top crossing the viewport bottom, to
      // Act 1's top reaching the viewport top.
      const start = next.offsetTop - window.innerHeight;
      const span = window.innerHeight;
      const p = Math.min(1, Math.max(0, (y - start) / span));
      if (Math.abs(p - lastCurtain) > 0.0015) {
        lastCurtain = p;
        inner.style.transform = `translate3d(0, ${(-40 * p).toFixed(2)}px, 0)`;
        /* This used to write an opacity as well, down to 0.4 across the same window, and
         * that had to go.
         *
         * The contrast gate walks the page a half viewport at a time and reads every text
         * run against its ground and against the opacity of every ancestor. Once the hero
         * is a fifth of the way through the curtain it is still on screen, still on top of
         * the paper, and every word in it is being painted at four tenths of its colour:
         * eleven transcript timestamps and the scene clock came back between 1.73 and 1.93
         * against a floor of 4.5. They were failing before this change too. They passed
         * only because the same runs were also caught at full opacity higher up the page,
         * and the gate keeps the best reading per run, so a real failure was being hidden
         * by an accident of where the samples landed.
         *
         * Nothing is lost by dropping it. Act 1 is opaque and sits at z-index 2, so it
         * covers the hero on its own; the fade was dimming an element that was about to be
         * hidden anyway. The 40px drift is the whole cue and it stays. It is also one
         * fewer property written per frame on a layer a full screen tall. */
        // Give the layer back once the curtain has closed, which is what the old
        // onComplete did. A promoted layer rasterises its whole box for as long as it
        // is promoted, and this one is a full screen tall.
        if (p >= 1) inner.style.willChange = 'auto';
        else inner.style.removeProperty('will-change');
      }
    }

    if (fill) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      if (Math.abs(p - lastRail) > 0.0015) {
        lastRail = p;
        fill.style.transform = `scaleY(${p.toFixed(4)})`;
      }
    }
  };

  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(frame);
  };
  // Resize changes the geometry both of these are computed from, so the resting position
  // is recomputed and the cached progress thrown away. Without the reset, a resize that
  // leaves the progress where it was skips the write and the page keeps the old numbers.
  // rest() reads a layout height, which is why it is here and not in frame().
  const onResize = () => {
    if (CURTAIN_Q.matches) rest();
    lastCurtain = -1;
    lastRail = -1;
    onScroll();
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onResize, { passive: true });
  // A width change fires resize as well, so this is here for the other half of the query:
  // turning reduced motion on mid-session does not resize anything.
  CURTAIN_Q.addEventListener('change', onResize);
  frame();
}

/* ---- act-enter ----------------------------------------------------------------------- */
/* One target per act, 240ms, never re-fired. Elements are in the DOM at final size with
 * opacity 0, so nothing here can move layout and the CLS budget stays at zero. */
function wireReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (REDUCED || !DESKTOP) {
    targets.forEach((el) => el.classList.add('shown'));
    return;
  }
  // -12% on the bottom edge is ScrollTrigger's start:'top 88%': the element counts as
  // entered once its top has come 12% of a viewport up from the bottom. The class is
  // added once and the element is dropped, which is what once:true bought.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('shown');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  targets.forEach((el) => io.observe(el));
}

/* ---- boot ---------------------------------------------------------------------------- */
function boot() {
  wireCopy();
  wirePlayers();
  wireOffscreen();
  wireRail();
  startScroll();
  wireScrubbed();
  wireReveal();
  document.documentElement.dataset.ready = 'true';
  wireScene();
  wireEndings();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
