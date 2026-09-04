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
 * Lenis and GSAP are loaded from a CDN and both are optional. If either fails to arrive the
 * page still scrolls, plays and reads, which is the same state a reader gets with JavaScript
 * off or with reduced motion asked for.
 */
import { CallPlayer } from './player.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DESKTOP = matchMedia('(min-width: 60rem)').matches;
const DATA = JSON.parse(document.getElementById('call-data').textContent);
const AUDIO = document.documentElement.dataset.audio === 'present' ? 'audio' : null;

const players = [];

/* ---- smooth scroll ------------------------------------------------------------------- */
/* Lenis drives the native window scroll, so sticky and ScrollTrigger pins work unchanged.
 * It is not constructed on touch: phones have their own physics and fighting them is the
 * fastest way to make a page feel broken. */
function startScroll() {
  if (REDUCED || !DESKTOP || !window.Lenis) return null;
  const lenis = new window.Lenis({ lerp: 0.1, smoothWheel: true });
  if (window.gsap && window.ScrollTrigger) {
    lenis.on('scroll', window.ScrollTrigger.update);
    window.gsap.ticker.add((t) => lenis.raf(t * 1000));
    window.gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
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
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = acts.indexOf(e.target);
      links.forEach((a, k) => a.setAttribute('aria-current', k === i ? 'true' : 'false'));
    }
  }, { rootMargin: '-45% 0px -45% 0px' });
  acts.forEach((a) => io.observe(a));
  if (players[0]) paintRail(players[0]);
}

/* ---- scrubbed motion ----------------------------------------------------------------- */
/* The two places scroll has consequences. Declared through gsap.matchMedia so the desktop
 * and reduced-motion branches live in one place and clean themselves up. */
function wireScrubbed() {
  if (!window.gsap || !window.ScrollTrigger) return;
  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);

  gsap.matchMedia().add(
    { desktop: '(min-width: 60rem) and (prefers-reduced-motion: no-preference)' },
    (ctx) => {
      if (!ctx.conditions.desktop) return;

      // curtain: Act 0 holds while Act 1 slides over it.
      const hero = document.querySelector('.act-00');
      const next = document.querySelector('.act-01');
      if (hero && next) {
        ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom top',
                               pin: true, pinSpacing: false });
        gsap.to(hero.querySelector('.inner'), {
          y: -40, opacity: 0.4, ease: 'none',
          scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true },
          onComplete: () => hero.querySelector('.inner').style.removeProperty('will-change'),
        });
      }

      // rail-progress: one transform per scroll frame.
      const fill = document.querySelector('[data-rail]');
      if (fill) {
        gsap.fromTo(fill, { scaleY: 0 }, {
          scaleY: 1, ease: 'none', transformOrigin: 'top',
          scrollTrigger: { trigger: 'main', start: 'top top', end: 'bottom bottom', scrub: true },
        });
      }
    });
}

/* ---- act-enter ----------------------------------------------------------------------- */
/* One target per act, 240ms, never re-fired. Elements are in the DOM at final size with
 * opacity 0, so nothing here can move layout and the CLS budget stays at zero. */
function wireReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (REDUCED || !window.gsap || !window.ScrollTrigger || !DESKTOP) {
    targets.forEach((el) => el.classList.add('shown'));
    return;
  }
  window.gsap.utils.toArray('[data-reveal]').forEach((el) => {
    window.gsap.fromTo(el, { opacity: 0, y: 10 }, {
      opacity: 1, y: 0, duration: 0.24, ease: 'power3.out',
      scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      onStart: () => el.classList.add('shown'),
    });
  });
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
