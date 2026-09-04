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
    this.bind();
    this.select(this.id, true);
  }

  get call() { return this.data[this.id]; }

  bind() {
    new ResizeObserver(() => this.resize()).observe(this.canvas);

    const switches = this.root.querySelectorAll('[data-switch]');
    switches.forEach((b) => b.addEventListener('click', () => this.select(b.dataset.switch)));

    const play = this.root.querySelector('[data-play]');
    if (play) play.addEventListener('click', () => this.toggle());

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
    a.currentTime = this.t;
    a.play().then(() => { this.playing = true; this.loop(); }).catch(() => { this.playing = false; });
    this.root.dataset.playing = 'true';
  }

  pause() {
    this.playing = false;
    if (this.audio) this.audio.pause();
    this.root.dataset.playing = 'false';
    cancelAnimationFrame(this.raf);
  }

  seek(sec) {
    this.t = Math.max(0, Math.min(sec, this.call.seconds));
    if (this.audio) this.audio.currentTime = this.t;
    this.sync();
    this.draw();
    this.announce();
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
      let html = '<span class="turn-at">' + fmt(t.offset_seconds) + '</span>' +
                 '<span class="turn-who">' + who + '</span>' +
                 '<span class="turn-text" lang="' + this.call.locale + '">' + esc(t.text) + '</span>';
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
