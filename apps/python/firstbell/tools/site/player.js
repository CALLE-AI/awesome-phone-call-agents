/* The call player.
 *
 * Everything it draws comes out of `transcripts.json`: the peaks are measured off the
 * recording, the turn text is what CALL-E transcribed, and `offset_seconds` is CALL-E's own
 * timing rather than a value this repository chose. The player never invents a moment.
 *
 * When a call has no audio file, which is what anyone cloning the repository gets because
 * the contribution checklist asks us not to commit call recordings, it still draws the
 * waveform, the turns and the result, and says why there is nothing to press.
 */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const AMP = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => AMP[c]);
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/* The longest silence the scene sits through before it starts moving across it.
 *
 * The hero call is 59.54 seconds and 39 of them are nobody speaking: eleven seconds after
 * the agent asks whether the parent is aware, eight after it asks the reason, twelve after
 * it asks when the child is coming back. Those pauses are the most human thing in the
 * recording and they are also unwatchable at full length on a page a reader gives thirty
 * seconds to.
 *
 * So the playhead runs at the recording's own speed while somebody is talking, and sweeps
 * the rest. It is a sweep and not a cut on purpose: the reader watches the playhead race
 * across a flat stretch of a real waveform, which shows what was skipped and how much of it
 * there was. A cut would have hidden the same thing.
 *
 * 1.5 seconds because a pause longer than about that stops reading as a pause in a
 * conversation and starts reading as a line that has gone dead. Holding it exactly that
 * long keeps the beat and spends nothing on the dead air past it. At this value the hero
 * call runs 20.5 seconds against its real 59.54, and every number the scene puts on the
 * screen is still the recording's own.
 */
const GAP_MAX = 1.5;

export class CallPlayer {
  constructor(root, data, opts) {
    opts = opts || {};
    this.root = root;
    this.data = data;                          // every call, keyed by row id
    this.ids = opts.ids || Object.keys(data);  // the ones this player switches between
    this.id = opts.start || this.ids[0];
    this.cueAt = opts.cueAt || 0;              // where the needle rests before first play
    this.audioBase = opts.audioBase || null;   // null when the page was built without audio
    this.canvas = root.querySelector('[data-waveform]');
    this.ctx = this.canvas.getContext('2d');
    this.turnsEl = root.querySelector('[data-turns]');
    this.resultEl = root.querySelector('[data-result]');
    this.audio = null;
    this.playing = false;
    this.t = this.cueAt;
    this.activeTurn = -1;
    this.raf = 0;
    this.onTurn = opts.onTurn || null;

    // Scene mode. Present only where the markup asked for it, so the act 3 player is
    // untouched: it is an audio player and it stays one.
    this.commits = opts.commits || [];        // one turn index per field, in field order
    this.clockEl = root.querySelector('[data-clock]');
    this.cells = this.resultEl
      ? [...this.resultEl.querySelectorAll('[data-field]')]
      : [];
    this.scene = null;                        // the schedule, built on first run
    this.sceneRaf = 0;
    this.sceneRunning = false;

    this.bind();
    this.upgrade();
    this.select(this.id, true);
  }

  /* ---- the scene ----------------------------------------------------------------------
   *
   * A second clock over the same timeline. Nothing here invents a moment: it decides how
   * fast to travel between two of CALL-E's own offsets, and never what those offsets are.
   */

  /* The light is on the register row. The scene root is flagged with it too, so the rule
   * joining the call to that row can be drawn without a :has() selector: a browser without
   * :has() would have dropped the one graphic tying a waveform to a row three lines above
   * it, and lost it silently, which is the worst way to lose anything. */
  lit() { return this.resultEl || this.root; }

  setLive(state) {
    this.lit().dataset.live = state;
    this.root.dataset.live = state;
  }

  /** Scene seconds against call seconds, as a run of straight segments between turns. */
  buildSchedule() {
    const marks = this.call.turns.map((t) => t.offset_seconds);
    marks.push(this.call.seconds);
    const callAt = [];
    const sceneAt = [];
    for (const m of marks) {
      // Two turns can share an offset. A zero-length segment would divide by zero on the
      // way back out, so it is not a segment.
      if (callAt.length && m <= callAt[callAt.length - 1]) continue;
      sceneAt.push(callAt.length
        ? sceneAt[sceneAt.length - 1] + Math.min(m - callAt[callAt.length - 1], GAP_MAX)
        : 0);
      callAt.push(m);
    }
    return { callAt, sceneAt, length: sceneAt[sceneAt.length - 1] || 0 };
  }

  /** Where the playhead is, in the recording, at a given moment of the scene. */
  callTimeAt(sceneT) {
    const { callAt, sceneAt } = this.scene;
    if (sceneT <= 0) return callAt[0];
    for (let k = 0; k < sceneAt.length - 1; k++) {
      if (sceneT > sceneAt[k + 1]) continue;
      const span = sceneAt[k + 1] - sceneAt[k];
      const frac = span > 0 ? (sceneT - sceneAt[k]) / span : 1;
      return callAt[k] + frac * (callAt[k + 1] - callAt[k]);
    }
    return callAt[callAt.length - 1];
  }

  /** Every field back to waiting, which is where the row was before the call was placed. */
  sceneReset() {
    for (const cell of this.cells) {
      cell.dataset.at = 'pending';
      cell.textContent = '·';
    }
  }

  /** Every field at the value CALL-E returned. The end of the scene, and the served page. */
  sceneSettle() {
    const s = this.call.structured || {};
    for (const cell of this.cells) {
      const v = s[cell.dataset.field];
      cell.dataset.at = 'committed';
      cell.textContent = (v === undefined || v === null) ? '·' : v;
    }
  }

  /* Which fields have been answered by now.
   *
   * A field is written the moment the playhead passes the turn the parent answers it in.
   * It is never unwritten by the playhead moving on, because the answer was given: only a
   * restart takes it back to waiting. */
  markFields() {
    const s = this.call.structured || {};
    this.cells.forEach((cell, i) => {
      const at = this.commits[i];
      if (at === undefined || cell.dataset.at === 'committed') return;
      if (this.activeTurn < at) return;
      const v = s[cell.dataset.field];
      cell.textContent = (v === undefined || v === null) ? '·' : v;
      cell.dataset.at = 'committed';
    });
  }

  showClock() {
    if (!this.clockEl) return;
    this.clockEl.textContent = `${fmt(this.t)} / ${fmt(this.call.seconds)}`;
  }

  /* Silent, and it does not touch the audio element. The recording is what the play button
   * is for; this is the shape of the call, drawn at the speed it happened. */
  runScene() {
    // Now there is something to play again, so now the control that offers it appears. It
    // used to appear at boot, which put the word on screen before the scene had run: the
    // hero starts itself a frame after boot and never noticed, but the duet waits until its
    // act is 40% on screen, and on a short viewport its bar can be read before that.
    const again = this.root.querySelector('[data-replay]');
    if (again) again.removeAttribute('hidden');
    if (REDUCED) { this.sceneSettle(); return; }
    this.stopScene();
    this.scene = this.buildSchedule();
    if (!this.scene.length) { this.sceneSettle(); return; }
    this.sceneReset();
    this.t = 0;
    this.activeTurn = -1;
    this.sceneRunning = true;
    // The light belongs to the row that is running, not to the register around it.
    this.setLive('on');
    const began = performance.now();
    const step = (now) => {
      if (!this.sceneRunning) return;
      const elapsed = (now - began) / 1000;
      this.t = this.callTimeAt(elapsed);
      this.sync();
      this.markFields();
      this.showClock();
      this.draw();
      if (elapsed >= this.scene.length) { this.endScene(); return; }
      this.sceneRaf = requestAnimationFrame(step);
    };
    this.sceneRaf = requestAnimationFrame(step);
  }

  /** The light goes out and the record it produced stays on the paper. */
  endScene() {
    this.sceneRunning = false;
    cancelAnimationFrame(this.sceneRaf);
    this.t = this.call.seconds;
    this.sync();
    this.sceneSettle();
    this.showClock();
    this.draw();
    this.setLive('off');
  }

  /* Interrupted rather than finished: a reader who scrolls away or reaches for the
   * playhead gets the settled row, which is the state the scene was going to leave them
   * in anyway. Nothing is left half written. */
  stopScene() {
    if (!this.sceneRunning) return;
    this.sceneRunning = false;
    cancelAnimationFrame(this.sceneRaf);
    this.sceneSettle();
    this.setLive('off');
  }

  get call() { return this.data[this.id]; }

  /* Say it is a slider only where it is one.
   *
   * The markup serves this as a blank canvas, hidden from assistive technology and out of
   * the tab order, because with the script off nothing draws it and nothing moves it: a
   * role=slider that ignores every arrow key is a promise the page cannot keep. Here the
   * keys are already bound, so the promise is good. select() sets the value straight
   * after, which is why there is no announce() call in this method.
   */
  upgrade() {
    this.canvas.removeAttribute('aria-hidden');
    this.canvas.setAttribute('role', 'slider');
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('aria-valuemin', '0');
    this.canvas.setAttribute('aria-label',
      'Playhead. Click it, or use the arrow keys, to move through the call.');
  }

  bind() {
    new ResizeObserver(() => this.resize()).observe(this.canvas);

    const switches = this.root.querySelectorAll('[data-switch]');
    switches.forEach((b) => b.addEventListener('click', () => this.select(b.dataset.switch)));

    const play = this.root.querySelector('[data-play]');
    if (play) play.addEventListener('click', () => this.toggle());

    // Watching it again is the one thing a reader is most likely to want from a twenty
    // second scene they arrived in the middle of, so it is a real button with a real name
    // and not an icon.
    const again = this.root.querySelector('[data-replay]');
    if (again) again.addEventListener('click', () => this.runScene());

    // Clicking the waveform seeks, and clicking a turn seeks to that turn. To a reader those
    // are the same gesture aimed at two representations of one timeline, so both must work.
    this.canvas.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      let to = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') to = this.t + step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') to = this.t - step;
      else if (e.key === 'Home') to = 0;
      else if (e.key === 'End') to = this.call.seconds;
      if (to === null) return;
      e.preventDefault();           // or the page scrolls under the reader as they seek
      this.seek(to);
    });
    this.canvas.addEventListener('click', (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.seek(((e.clientX - r.left) / r.width) * this.call.seconds);
    });
    this.turnsEl.addEventListener('click', (e) => {
      const li = e.target.closest('[data-at]');
      if (li) this.seek(Number(li.dataset.at));
    });
  }

  select(id, silent) {
    if (!this.data[id]) return;
    const wasPlaying = this.playing;
    this.pause();
    this.id = id;
    this.t = (id === this.ids[0]) ? this.cueAt : 0;
    this.activeTurn = -1;
    this.root.dataset.locale = this.call.locale;
    this.root.querySelectorAll('[data-switch]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.switch === id));
    });
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.renderTurns();
    this.renderResult();
    this.resize();
    this.announce();
    // Switching language mid-listen keeps listening, because that IS the demonstration: the
    // words change completely and the result underneath them does not move.
    if (wasPlaying && !silent) this.play();
  }

  ensureAudio() {
    if (this.audio || !this.audioBase) return this.audio;
    const a = new Audio(this.audioBase + '/' + this.id + '.m4a');
    a.preload = 'none';
    a.addEventListener('timeupdate', () => { this.t = a.currentTime; });
    a.addEventListener('ended', () => { this.playing = false; this.reveal(); this.sync(); });
    this.audio = a;
    return a;
  }

  toggle() { if (this.playing) { this.pause(); } else { this.play(); } }

  play() {
    const a = this.ensureAudio();
    if (!a) return;                          // no-audio build: the control is not rendered
    // The recording and the scene are two clocks over one timeline and only one of them
    // may hold it. Pressing play hands it to the recording, which is the truthful one.
    this.stopScene();
    a.currentTime = this.t;
    a.play().then(() => { this.playing = true; this.loop(); }).catch(() => { this.playing = false; });
    this.root.dataset.playing = 'true';
    this.announce(true);
  }

  pause() {
    this.playing = false;
    if (this.audio) this.audio.pause();
    this.root.dataset.playing = 'false';
    cancelAnimationFrame(this.raf);
    this.announce(false);
  }

  // The icon swaps in CSS off root.dataset.playing, so a sighted reader always knew which
  // state the control was in and a screen reader never did: the button shipped
  // aria-label="Play this call" and kept it while the call was playing. The switches at
  // select() already did this correctly, so this is the same treatment, not a new idea.
  announce(playing) {
    const b = this.root.querySelector('[data-play]');
    if (!b) return;
    b.setAttribute('aria-label', playing ? 'Pause this call' : 'Play this call');
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
  }

  seek(sec) {
    // A reader reaching for the playhead has taken the timeline over, so the scene stops
    // driving it. Fighting a scrub with an animation is the fastest way to make a control
    // feel broken.
    this.stopScene();
    this.t = Math.max(0, Math.min(sec, this.call.seconds));
    if (this.audio) this.audio.currentTime = this.t;
    this.sync();
    this.draw();
    this.announce();
    this.showClock();
  }

  /* Where the playhead is, in the words a screen reader will say. The range belongs to
   * whichever call is selected, and the two languages are different lengths, so the
   * maximum moves when the reader switches. */
  announce() {
    // Round once, then read every number off the rounded value. Rounding the seconds for
    // valuemax and flooring them for the spoken text put "0:59 of 0:59" next to a maximum
    // of 60 on a call of 59.6 seconds.
    const total = Math.round(this.call.seconds);
    const at = Math.max(0, Math.min(total, Math.round(this.t)));
    const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.canvas.setAttribute('aria-valuemax', String(total));
    this.canvas.setAttribute('aria-valuenow', String(at));
    this.canvas.setAttribute('aria-valuetext', `${clock(at)} of ${clock(total)}`);
  }

  loop() {
    if (!this.playing) return;
    this.sync();
    this.draw();
    this.raf = requestAnimationFrame(() => this.loop());
  }

  /* Which turn is being spoken right now, decided by CALL-E's offsets and nothing else. */
  sync() {
    const turns = this.call.turns;
    let i = -1;
    for (let k = 0; k < turns.length; k++) {
      if (turns[k].offset_seconds <= this.t) i = k;
    }
    if (i === this.activeTurn) return;
    this.activeTurn = i;
    const nodes = this.turnsEl.children;
    for (let k = 0; k < nodes.length; k++) {
      const rel = k === i ? 'now' : (k < i ? 'past' : 'ahead');
      if (nodes[k].dataset.rel !== rel) nodes[k].dataset.rel = rel;
    }
    // Scroll the transcript, not the page. scrollIntoView walks every scrollable
    // ancestor, the document included, and block:'nearest' limits how far each one moves
    // rather than which ones move at all: following the playhead pulled the reader 142px
    // down the page, once per turn. This moves the one box that should move.
    const li = nodes[i];
    if (li) {
      const box = this.turnsEl;
      const lr = li.getBoundingClientRect();
      const br = box.getBoundingClientRect();
      const delta = lr.top < br.top ? lr.top - br.top
        : (lr.bottom > br.bottom ? lr.bottom - br.bottom : 0);
      if (delta) {
        box.scrollTo({ top: box.scrollTop + delta, behavior: REDUCED ? 'auto' : 'smooth' });
      }
    }
    if (this.onTurn) this.onTurn(this);
    if (i === turns.length - 1) this.reveal();
  }

  reveal() { this.resultEl.dataset.state = 'in'; }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  /* Who is speaking at a given second, from the committed turn offsets. Used to put the
   * agent above the centreline and the family below it. The two voices measure 2.79 against
   * each other, under the 3:1 that WCAG asks of a meaningful graphic, so they are separated
   * by position rather than by colour. It also means the shape of the waveform shows the
   * shape of the conversation. */
  speakerAt(sec) {
    const turns = this.call.turns;
    let who = 'bot';
    for (let k = 0; k < turns.length; k++) {
      if (turns[k].offset_seconds <= sec) who = turns[k].speaker; else break;
    }
    return who;
  }

  /* One pass over the measured peaks. No gradient and no shadow: this is a measurement, and
   * dressing it up would make it look like an illustration of a waveform instead of one. */
  draw() {
    const peaks = this.call.peaks || [];
    const r = this.canvas.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (!w || !peaks.length) return;
    const mid = h / 2;
    const played = (this.t / this.call.seconds) * w;
    const cs = getComputedStyle(this.root);
    const done = cs.getPropertyValue('--wave-played').trim() || '#e8e4de';
    const todo = cs.getPropertyValue('--wave-ahead').trim() || '#5a5550';
    const bar = 2, step = 3;
    const n = Math.floor(w / step);
    this.ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const x = i * step;
      const frac = i / n;
      const p = peaks[Math.floor(frac * peaks.length)] || 0;
      const a = Math.max(1, p * mid * 0.94);
      const agent = this.speakerAt(frac * this.call.seconds) === 'bot';
      this.ctx.fillStyle = x <= played ? done : todo;
      this.ctx.fillRect(x, agent ? mid - a : mid, bar, a);
    }
    // The centreline is the only rule on the canvas: it is what makes above and below read
    // as two speakers rather than as one symmetrical decoration.
    this.ctx.fillStyle = todo;
    this.ctx.fillRect(0, mid, w, 1);
    this.ctx.fillStyle = done;
    this.ctx.fillRect(Math.min(played, w - 1), 0, 1, h);
  }

  renderTurns() {
    const f = document.createDocumentFragment();
    for (const t of this.call.turns) {
      const li = document.createElement('li');
      li.dataset.at = t.offset_seconds;
      li.dataset.who = t.speaker;
      li.dataset.rel = 'ahead';
      const who = t.speaker === 'bot' ? 'agent' : 'parent';
      // Every value on the next three lines goes through esc, including the locale. The
      // locale was the one that did not, and it lands inside an attribute rather than in
      // text, so a locale carrying a double quote would have closed lang= and opened
      // whatever followed it. judge_page.py escapes the same field when it renders the
      // same markup; this renderer did not, which is the shape of the bug: two writers of
      // one string, one of them careful.
      let html = '<span class="turn-at">' + fmt(t.offset_seconds) + '</span>' +
                 '<span class="turn-who">' + who + '</span>' +
                 '<span class="turn-text" lang="' + esc(this.call.locale) + '">' +
                 esc(t.text) + '</span>';
      // The gloss exists only on non-English turns. It is a translation written by the author,
      // labelled as one in the markup, because CALL-E did not return it.
      if (t.gloss) html += '<span class="turn-gloss" lang="en">' + esc(t.gloss) + '</span>';
      li.innerHTML = html;
      f.append(li);
    }
    this.turnsEl.replaceChildren(f);
  }

  renderResult() {
    const s = this.call.structured || {};
    const note = this.resultEl.querySelector('[data-note]');
    // CALL-E writes free_text_note in English even for a Tamil call. It is the vendor's own
    // one-sentence account of the conversation, committed, and it is what lets a reader who
    // has no Tamil follow the Tamil track.
    if (note) note.textContent = this.call.note || '';
    const conf = this.resultEl.querySelector('[data-conf]');
    if (conf && this.call.confidence != null) conf.textContent = this.call.confidence;
    // Dimmed only while there is a recording that could end. The panel is a curtain
    // over a result that arrives when the call finishes, and with no audio nothing
    // ever finishes, so it would stay at 0.35 for good: 1.7 against its own ground,
    // on the one artifact that shows what CALL-E returned. The server sends this
    // markup as 'in', so leaving it 'out' also meant a reader with JavaScript off
    // could read it and a reader with JavaScript on could not.
    this.resultEl.dataset.state = this.audioBase ? 'out' : 'in';
    this.resultEl.querySelectorAll('[data-field]').forEach((el) => {
      const v = s[el.dataset.field];
      el.textContent = (v === undefined || v === null) ? '·' : v;
    });
  }
}
