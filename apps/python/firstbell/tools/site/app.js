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
// Which calls have a published recording. Audio presence used to be one flag for the
// whole page, which is wrong now that four transcripts ship without their audio: a
// single flag renders a play button for a clip the build deliberately did not copy.
// The build writes the list, so the page can never disagree with the directory.
const CLIPS = new Set(DATA.clips || []);
const clipBase = (id) => (AUDIO && (CLIPS.size === 0 || CLIPS.has(id)) ? AUDIO : null);

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
  // Every in-page link, not just the rail's. The rail was wired because it is the obvious
  // navigation, but an anchor in body prose jumped natively while Lenis was still running
  // its own scroll, which reads as the page fighting itself. Same handler, wider net.
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      // A held modifier means the reader asked the browser for something, usually a new
      // tab. Swallowing it to run a smooth scroll takes that away with no way to get it
      // back, and the rail is the one place on this page somebody would try it.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
      const href = a.getAttribute('href');
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      // The top of the document is a position, not an element offset. `#act-00` begins at
      // zero and the topbar clearance below is a clearance from something above it, so
      // subtracting 76px there scrolls to -76 and the browser clamps it to 0 after the
      // tween has already spent its duration going nowhere. Scrolling to the number
      // directly is the one case where the offset is wrong rather than merely unneeded.
      const toTop = href === '#act-00' || target.offsetTop === 0;
      // Where the target sits in the document, with the stickiness taken off it first.
      //
      // Act 00 is `position: sticky`, and a block inside it reports a rect pinned to
      // wherever the reader already is. `scrollTo(element)` reads exactly that rect, so
      // "the simulator" resolved to 88px clicked from the top of the page and to 3,977px
      // clicked from the foot of it: one link, two destinations, decided by nothing the
      // reader did. An offsetTop chain does not help, because Chrome reports the stuck
      // offset there too -- `#act-00` measures 74 at rest and 4,003 once it is stuck.
      //
      // Setting the sticky ancestors static for the length of one statement is the only
      // reading that is exact, and it is a reading, not a change: the property is put back
      // in the same task, before any style or paint the reader could see.
      const docTop = (() => {
        const stuck = [];
        for (let node = target; node; node = node.parentElement) {
          if (getComputedStyle(node).position === 'sticky') {
            stuck.push([node, node.style.position]);
            node.style.position = 'static';
          }
        }
        const y = target.getBoundingClientRect().top + window.scrollY;
        for (const [node, was] of stuck) node.style.position = was;
        return y;
      })();
      // A duration and an easing, not the instance lerp. `scrollTo` with neither falls
      // back to `lerp: 0.1`, which is an asymptotic approach: it covers most of the
      // distance quickly and then crawls at the target without ever quite arriving. The
      // exponential that replaced it was the same shape with a floor: 1.001 - 2^-10t
      // still spends its last fifth of the duration inside a pixel of the target, which
      // over jumps nine acts apart reads as the page dragging rather than navigating.
      //
      // A cubic ease-out reaches the target exactly at t = 1 and its derivative goes to
      // zero there, so it lands rather than stopping, and 0.38s is short enough that a
      // reader who clicked the rail is already reading before they would think to wait.
      lenis.scrollTo(toTop ? 0 : Math.max(0, docTop - 76), {
        offset: 0,
        duration: 0.38,
        easing: (t) => 1 - Math.pow(1 - t, 3),
      });
      // The hash never moved, so the address bar could not be copied or shared and the
      // back button had nothing to go back to.
      if (history.pushState) history.pushState(null, '', href);
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

/* ---- holding a scene still --------------------------------------------------------------
 *
 * Three scenes start themselves and between them they move for about twenty seconds beside
 * prose a reader is trying to read. Reduced motion is honoured and always was, but that only
 * answers the reader who has set an OS preference, and the guideline asks for a control as
 * well as a query. This is the control.
 *
 * It is a pause and not a stop. Stopping settles the row to its finished state, which is the
 * right answer for a reader who has scrolled away or grabbed the playhead and the wrong one
 * for a reader who wants to look at the frame it is on.
 *
 * The words come off the button, so the visible label and the accessible name are set from
 * one string and cannot disagree. That is the same treatment announceControl gives the play
 * button, for the same reason: a voice user asks for the words they can see.
 */
function pauseControlFor(name) {
  for (const b of document.querySelectorAll('[data-scene-pause]')) {
    if (b.dataset.scenePause === name) return b;
  }
  return null;
}

function syncPauseControl(b, members) {
  const running = members.some((p) => p.sceneRunning);
  const moving = members.some((p) => p.sceneMoving());
  // A finished scene has nothing to hold, so the control says so rather than lying about it.
  // Disabled rather than hidden: hiding it here would move the row every time a scene ended.
  b.disabled = !running;
  const words = (running && !moving)
    ? (b.dataset.wordsResume || 'Play the scene')
    : (b.dataset.wordsPause || 'Pause the scene');
  if (b.textContent !== words) b.textContent = words;
  b.setAttribute('aria-label', words);
  b.setAttribute('aria-pressed', running && !moving ? 'true' : 'false');
}

/** A player changed running state, so the control for its group is restated. */
function onSceneState(player) {
  const name = groupOf(player);
  const b = pauseControlFor(name);
  if (!b) return;
  syncPauseControl(b, sceneGroups().get(name) || [player]);
}

function wireScene() {
  const groups = sceneGroups();
  if (!groups.size) return;

  if (REDUCED) {
    for (const members of groups.values()) members.forEach((p) => p.sceneSettle());
    // The pause controls stay hidden and stay disabled. With reduced motion asked for, every
    // scene settles instead of running and there is nothing in motion to hold still.
    return;
  }

  /* Running a group also reveals the one button that replays it, for the reason written
   * over `runScene`: a control offering a replay of something that has not happened is the
   * page claiming a state the reader has not reached. The control that holds it still is
   * revealed in the same breath and on the same argument: before the scene runs there is
   * nothing to pause, so the button is served hidden and disabled and a reader with no
   * script never sees it at all. */
  const run = (members) => {
    members.forEach((p) => p.runScene());
    const name = groupOf(members[0]);
    const pause = pauseControlFor(name);
    if (pause) {
      pause.removeAttribute('hidden');
      syncPauseControl(pause, members);
    }
    if (name === 'hero') return;
    // Compared rather than interpolated: building the selector out of the group name puts
    // a value inside a quoted attribute, and the escaping gate is right to refuse that.
    for (const b of document.querySelectorAll('[data-replay-group]')) {
      if (b.dataset.replayGroup === name) b.removeAttribute('hidden');
    }
  };

  /* One press holds the whole group, for the reason the replay is one button per group:
   * pausing one lane of a duet and letting the other run would demonstrate the opposite of
   * the point the duet exists to make. */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scene-pause]');
    if (!b) return;
    const members = sceneGroups().get(b.dataset.scenePause);
    if (!members || !members.length) return;
    const moving = members.some((p) => p.sceneMoving());
    members.forEach((p) => (moving ? p.pauseScene() : p.resumeScene()));
    syncPauseControl(b, members);
  });

  /* The hero starts on the same terms as the other two, and it did not used to.
   *
   * It was run off the first frame after boot, on the argument that a reader who has not
   * scrolled is already looking at it. That argument stopped being true. wireOffscreen
   * stops any player less than 40% visible, and it runs its first callback in the same
   * frame this one schedules, so whichever landed second decided the outcome. Measured at
   * 1440x900: the register's top is 869px down a 900px viewport and it is 472px tall, so
   * 6.7% of it is on screen at load. It was 21% before the first screen grew a stat band,
   * which is still under the threshold. The scene was started and immediately stopped, and
   * `groups.delete('hero')` then took it out of the set the observer below watches, so it
   * could never start again: scrolling the register to the middle of the screen and waiting
   * twelve seconds left it settled. The one call this page is built around had never played
   * for anybody, on any viewport, and the light, the breath and the whole field-versus-ink
   * system the stylesheet is built on were arguments a reader was never shown.
   *
   * Falling through to the observer fixes it with a deletion rather than an addition, and
   * it is also what the comment above this function already claims happens: a scene that
   * finished before the reader arrived would be worse than no scene. That is as true of the
   * hero as of the other two now that the first screen is taller than the fold. */
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
      //
      // Which text, though. On the id buttons the button IS the text, so selecting the
      // button is right. On the quickstart rows the button reads "copy" and the command
      // sits beside it, so selecting the button would hand the reader the word "copy".
      // The row says which element shows the thing.
      const shown = b.closest('li, p, div')?.querySelector('[data-copy-shown]');
      const r = document.createRange();
      r.selectNodeContents(shown || b);
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
      ids, start: ids[0], cueAt: Number(root.dataset.cue || 0), audioBase: clipBase(ids[0]),
      onTurn: paintRail, commits, onScene: onSceneState,
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
/* The miniature's box and its two inks, resolved when they can have changed rather than on
 * every turn. paintRail used to call getBoundingClientRect and getComputedStyle on the way
 * in, which is a forced layout and a full style resolve on the document element, and it runs
 * off the player's onTurn: on the hero scene that is once per spoken turn while the register
 * beside it is being written to. The width answers to the rail's own box, which is what the
 * observer below watches, and both inks are declared once at :root. */
let railBox = null;
let railInk = null;

function measureRail() {
  if (!railCanvas) return;
  const { width: w, height: h } = railCanvas.getBoundingClientRect();
  railBox = { w, h };
  const cs = getComputedStyle(document.documentElement);
  railInk = {
    done: cs.getPropertyValue('--ink').trim(),
    todo: cs.getPropertyValue('--ink-4').trim(),
  };
  const dpr = Math.min(devicePixelRatio || 1, 2);
  if (w && railCanvas.width !== Math.round(w * dpr)) {
    railCanvas.width = Math.round(w * dpr);
    railCanvas.height = Math.round(h * dpr);
    railCanvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}

function paintRail(player) {
  if (!railCanvas || !railBox || !railInk) return;
  const peaks = player.call.peaks || [];
  const { w, h } = railBox;
  if (!w || !peaks.length) return;
  const ctx = railCanvas.getContext('2d');
  const done = railInk.done, todo = railInk.todo;
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
  // The rail is desktop-only, so at a narrow width this box is zero and stays zero until the
  // window is widened. Watching it is what keeps the cache honest across that crossing.
  if (railCanvas) {
    measureRail();
    new ResizeObserver(() => {
      measureRail();
      if (players[0]) paintRail(players[0]);
    }).observe(railCanvas);
  }
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
  /* Where act 0 sits when nothing is holding it up.
   *
   * Read once, here, before any scrolling has happened, because `position: sticky` has not
   * engaged yet at the top of the document and the box is in its own place. After that the
   * number never changes: act 0 is the first thing in the page and nothing above it moves. */
  const curtain = acts[0];
  const curtainFlow = curtain ? curtain.getBoundingClientRect().top + scrollY : 0;
  const curtainEnd = curtain ? curtainFlow + curtain.offsetHeight : 0;

  const mark = () => {
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const here = hit && hit.closest('section[id^="act-"]');
    const i = here ? acts.indexOf(here) : -1;
    if (i < 0) return;   // between acts, or over something that is not one: keep the last
    /* Act 0 is sticky under the curtain, and a sticky box is a positioned box, so it answers
     * a hit test at the middle of the viewport at every scroll position on the page. That
     * includes the footer, where it is the only act under the middle at all. Reading it
     * there marked the rail "00 The call" while the reader was at the bottom, and because
     * the observer below only fires on a crossing, that wrong answer then survived the
     * whole way back up.
     *
     * A hit on act 0 counts only where act 0 actually is, which is the top of the document.
     * Everywhere else the hit is the curtain showing through and the last real answer is
     * the better one. */
    if (here === curtain && scrollY + innerHeight / 2 > curtainEnd) return;
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
  /* And once more when the real faces land.
   *
   * `rest()` reads the hero's height, and the hero is set in fallback metrics until the
   * kit arrives, which it does out of the render path on purpose. One paragraph on the
   * first screen reflowed from three lines to four when the swap happened, the hero grew
   * 29px after its resting offset had already been written, and its last line sat 29px
   * below the window with nothing able to reach it. Nothing scrolls, nothing resizes, so
   * neither handler above ever fired: the page was simply wrong from the swap onwards.
   *
   * Fonts that never load leave this unresolved, and the offset written at boot stands,
   * which is the same answer as before. */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(onResize).catch(() => {});
  }

  /* And every time a disclosure opens or shuts.
   *
   * Nine act bodies and the money card's derivation are behind `<details>` now, and each
   * one changes the document's height by hundreds of pixels when a reader clicks it.
   * Three things are computed from that height and none of them recompute on their own:
   * the hero's resting offset under the curtain, the rail's fill, and which act the rail
   * calls current. Neither `scroll` nor `resize` fires on a click, so before this the
   * page kept whatever it worked out at boot and the rail pointed at the wrong act for
   * the rest of the session.
   *
   * Both a `toggle` listener and a ResizeObserver, because they catch different things.
   * `toggle` fires the instant the state flips, which is when the height changes for a
   * plain disclosure. The observer catches everything after that: a fold whose contents
   * reflow, a table that rewraps inside an open one, an image that arrives late. The
   * observer's first callback fires on observe, so the flag below drops it rather than
   * writing a layout offset ten times during boot. */
  const folds = [...document.querySelectorAll('details')];
  folds.forEach((d) => d.addEventListener('toggle', onResize));
  if (typeof ResizeObserver === 'function' && folds.length) {
    let settled = false;
    const ro = new ResizeObserver(() => { if (settled) onResize(); });
    folds.forEach((d) => ro.observe(d));
    requestAnimationFrame(() => { settled = true; });
  }
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
  wireFirstScreen();
  wireStagger();
  document.documentElement.dataset.ready = 'true';
  wireCounts();
  wireScene();
  wireEndings();
  wireCallscope();
}


/* ---- the first screen's recordings ----------------------------------------------------
 *
 * The instrument on the first screen draws two real calls on one axis of seconds and marks
 * the moment each structured field was answered. Until now a reader could see that S-4105
 * ran longer and came back emptier, and could not hear it. The recordings were on the page
 * the whole time, nine screens down.
 *
 * Pressing a lane's button stops the ambient sweep, settles every mark to its final frame
 * and drives the read-head from `audio.currentTime` instead, so the head crosses the axis
 * at the recording's own speed against the same ticks. The lane you are not listening to
 * dims. Nothing here is required for the figure to make its argument: with the script
 * dead, with `AUDIO` null because the build had no clips, or with reduced motion asked
 * for, the frame is the settled one and every verdict is already on it.
 *
 * One element for the whole figure, not one per lane. Two recordings playing over each
 * other on a single time axis is not a comparison, it is noise. */
function wireCallscope() {
  const fig = document.querySelector('.callscope');
  if (!fig || !AUDIO) return;
  const buttons = [...fig.querySelectorAll('[data-csc-play]')];
  if (!buttons.length) return;

  /* Resolved once, by reading each card's own attribute, rather than by interpolating
   * the button's value into an attribute selector. These ids come from the evidence file
   * so the interpolated form read harmlessly, but it is the shape the escaping test
   * exists to refuse: a value carrying a quote closes the selector early and the match
   * silently becomes something else. A map cannot be injected into.
   *
   * The first attempt at this comment quoted the rejected form in full and failed the
   * same test, because that test reads the file as text and a comment is text. Describe
   * the shape, never spell it. */
  const cardOf = new Map([...fig.querySelectorAll('[data-csc-lane]')]
    .map((g) => [g.getAttribute('data-csc-lane'), g]));

  const audio = new Audio();
  audio.preload = 'none';
  let current = null;
  let frame = 0;

  /* Progress is a ratio on the card, not a pixel anywhere. The played rule is sized in
   * CSS from that one custom property, so the sync holds at every width without this
   * function reading a single laid-out value. */
  const place = (card, t, len) => {
    if (!card || !len) return;
    card.style.setProperty('--csc-p', Math.max(0, Math.min(1, t / len)).toFixed(4));
  };

  const stop = (settle) => {
    cancelAnimationFrame(frame);
    audio.pause();
    fig.querySelectorAll('[data-csc-lane]').forEach((g) => {
      g.removeAttribute('data-csc-on');
      g.style.removeProperty('--csc-p');
    });
    buttons.forEach((b) => {
      b.setAttribute('aria-pressed', 'false');
      const label = b.querySelector('[data-play-label]');
      if (label) label.textContent = b.dataset.wordsPlay;
      b.setAttribute('aria-label', b.dataset.wordsPlay);
    });
    current = settle ? null : current;
  };

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.cscPlay;
      if (current === id && !audio.paused) { stop(true); return; }
      stop(true);
      current = id;
      const card = cardOf.get(id);
      const len = Number(btn.dataset.cscSeconds || 0);
      if (card) card.setAttribute('data-csc-on', '');
      btn.setAttribute('aria-pressed', 'true');
      const label = btn.querySelector('[data-play-label]');
      if (label) label.textContent = btn.dataset.wordsPause;
      btn.setAttribute('aria-label', btn.dataset.wordsPause);
      const base = clipBase(id);
      if (!base) return;
      audio.src = `${base}/${id}.m4a`;
      place(card, 0, len);
      const tick = () => {
        place(card, audio.currentTime, len);
        if (!audio.paused) frame = requestAnimationFrame(tick);
      };
      /* A blocked or missing recording must not leave a card marked live with its rule
       * parked at zero, which reads as a call that produced nothing. */
      audio.play().then(() => { frame = requestAnimationFrame(tick); })
           .catch(() => stop(true));
    });
  });

  audio.addEventListener('ended', () => stop(true));
}


/* ---- the first screen, and the groups below it ----------------------------------------
 *
 * wireReveal above gives one entrance to each act, fired on scroll. Two things it cannot
 * do, and both of them are on the screen a judge actually sees:
 *
 *   the first screen never scrolls, so it never entered. The masthead, the sentence and
 *   the four measured numbers were painted finished. They are the argument, and they
 *   arrived looking like they had always been there.
 *
 *   a group entered as one block. Four stat cells, three path steps and a register of
 *   rows each faded as a single rectangle, which reads as a slide rather than as a set of
 *   things. 55ms between members is the difference.
 *
 * Both respect the same rules as the entrance they extend: transform and opacity only, one
 * class, never re-fired, and both are skipped whole when the reader has asked for less. */

const STAGGER_GROUPS = ['.topline li', '.path-steps > *', '.stat-grid > *'];
const STAGGER_CAP = 6;   /* see --stagger in page.css: a long group must not queue */

function stage(el, i) {
  el.style.setProperty('--reveal-i', String(Math.min(i, STAGGER_CAP)));
  el.setAttribute('data-reveal', '');
}

/* The first screen enters on load rather than on scroll, because it is already on screen
 * and an IntersectionObserver would fire for all of it in the same frame, which is the
 * block entrance this is replacing. Two frames of delay so the class lands after the
 * browser has painted the starting state; one frame is not reliably enough for that. */
function wireFirstScreen() {
  const head = document.querySelector('.masthead');
  if (!head) return;
  const members = [
    head.querySelector('.wordmark'),
    head.querySelector('.standfirst'),
    ...head.querySelectorAll('.topline li'),
  ].filter(Boolean);
  if (!members.length) return;
  if (REDUCED) { members.forEach((el) => el.classList.add('shown')); return; }
  members.forEach(stage);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    members.forEach((el) => el.classList.add('shown'));
  }));
}

function wireStagger() {
  const groups = document.querySelectorAll(STAGGER_GROUPS.join(','));
  if (!groups.length) return;
  /* Members inside the masthead are owned by wireFirstScreen and are skipped here, or the
   * four numbers would be staged twice and the second pass would reset the index. */
  const targets = [...groups].filter((el) => !el.closest('.masthead'));
  if (!targets.length) return;
  if (REDUCED || !DESKTOP) { targets.forEach((el) => el.classList.add('shown')); return; }

  const seen = new Map();
  for (const el of targets) {
    const key = el.parentElement;
    const i = seen.get(key) || 0;
    seen.set(key, i + 1);
    stage(el, i);
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add('shown');
      io.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px' });
  targets.forEach((el) => io.observe(el));
}

/* ---- the numbers ----------------------------------------------------------------------
 *
 * Four measured numbers sit on the first screen and they are the reason the page exists.
 * A number that counts up is read; a number that is printed is scanned past.
 *
 * It costs nothing in layout, and the reason is worth stating because the obvious
 * implementation does: counting 0, 1, ... 12 renders one character and then two, the box
 * grows by a digit, and every line under it moves. This page has a 0.001 shift budget.
 * So each frame is zero-padded to the character count of the final string and .topline b
 * already sets tabular-nums, which makes every intermediate frame exactly as wide as the
 * last one. The width is never measured and never locked, so a webfont landing mid-count
 * cannot strand a pixel value either.
 *
 * Only the digits move. A currency mark, a decimal point and any trailing text are held
 * from the final string, so $0.05 counts through $0.01 and never through a bare 5. */
const COUNT_MS = 900;   /* one read of a four-number line, and it is over before a scroll */

function countUp(el) {
  const final = el.textContent.trim();
  const m = final.match(/^(\D*)(\d[\d,]*)(?:([.,])(\d+))?(\D*)$/);
  if (!m) return;
  const [, pre, intRaw, sep, frac, post] = m;
  const intDigits = intRaw.replace(/,/g, '');
  const grouped = intRaw.includes(',');
  const target = Number(intDigits + (frac || ''));
  if (!Number.isFinite(target) || target <= 0) return;
  const width = intDigits.length;

  const render = (v) => {
    let s = String(v).padStart(width + (frac ? frac.length : 0), '0');
    let head = frac ? s.slice(0, s.length - frac.length) : s;
    const tail = frac ? s.slice(s.length - frac.length) : '';
    head = head.padStart(width, '0');
    if (grouped) head = head.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return pre + head + (frac ? sep + tail : '') + post;
  };

  const t0 = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - t0) / COUNT_MS);
    /* easeOutCubic, the same curve --ease-reveal names, so the count lands with the
     * entrance it is riding in on rather than against it. */
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = render(Math.max(1, Math.round(target * eased)));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = final;
  };
  requestAnimationFrame(step);
}

function wireCounts() {
  const nums = document.querySelectorAll('.topline b');
  if (!nums.length || REDUCED) return;
  /* Held until the entrance has started, so the first frame a reader sees is the real
   * number fading in rather than a zero that was never true. */
  setTimeout(() => nums.forEach(countUp), 220);
}

/* Dispatched from the very bottom of this file, and it has to be.
 *
 * boot() reaches the const bindings the sections below it declare. A const is hoisted into
 * scope but not initialised until its own line runs, so with this block in the middle the
 * first call threw `Cannot access 'STAGGER_CAP' before initialization` and every wiring
 * after it, the whole page's behaviour, silently did not happen. The page still rendered,
 * which is what made it worth a comment: nothing about the paint said the script had died. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
