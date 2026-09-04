/* Page behaviour.
 *
 * The page borrows a phone call's time axis. Three structural things do nearly all of the
 * work and only one of them is an animation: the artifact in each act is sticky while the
 * prose scrolls past it, the hero call stays present in the rail after the reader has left
 * it, and scroll has consequences exactly twice, at the hero exit and in the rail.
 *
 * Six primitives may animate and nothing else: playhead-track, field-commit, act-enter,
 * curtain, rail-progress, theatre-open. A seventh requires deleting one of these.
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

/* ---- the theatre --------------------------------------------------------------------- */
/* The page is paper except where a call is playing. A class flip rather than an animated
 * colour, so it cannot tear, and an observer rather than a scroll handler, so it costs
 * nothing per frame. A call that scrolls out of view stops: a reader who scrolls
 * away mid-sentence should not hear a ghost. */
function wireTheatre() {
  const bands = document.querySelectorAll('.theatre');
  if (!bands.length) return;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      e.target.classList.toggle('lit', e.intersectionRatio > 0.4);
      if (e.intersectionRatio < 0.4) {
        players.filter((p) => e.target.contains(p.root)).forEach((p) => p.pause());
      }
    }
    document.documentElement.classList.toggle(
      'dark', [...bands].some((b) => b.classList.contains('lit')));
  }, { threshold: [0, 0.4, 0.75] });
  bands.forEach((b) => io.observe(b));
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
    players.push(new CallPlayer(root, DATA.calls, {
      ids, start: ids[0], cueAt: Number(root.dataset.cue || 0), audioBase: AUDIO,
      onTurn: paintRail,
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
function wireScrubbed() {
  if (REDUCED || !DESKTOP) return;
  const inner = document.querySelector('.act-00 .inner');
  const next = document.querySelector('.act-01');
  const fill = document.querySelector('[data-rail]');
  const curtain = inner && next;
  if (!curtain && !fill) return;

  // Tells the stylesheet the curtain is wired, so a reader with JavaScript off gets the
  // hero they had before rather than a sticky one that never fades.
  if (curtain) document.documentElement.dataset.curtain = 'on';

  let queued = false;
  let lastCurtain = -1;
  let lastRail = -1;

  const frame = () => {
    queued = false;
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
        inner.style.opacity = (1 - 0.6 * p).toFixed(3);
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
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
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
  wireTheatre();
  wireCopy();
  wirePlayers();
  wireRail();
  startScroll();
  wireScrubbed();
  wireReveal();
  document.documentElement.dataset.ready = 'true';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
