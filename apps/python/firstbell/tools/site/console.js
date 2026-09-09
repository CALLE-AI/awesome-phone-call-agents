/* The offline run, played rather than pasted.
 *
 * There was a static block of text here: the verbatim output of
 * `python -m firstbell --work-file examples/absences.csv`, produced by running exactly
 * that when the page was built. It is the most checkable thing on the page and the least
 * looked at, because sixty lines of console output in one lump is a wall a reader skips.
 *
 * So it plays. One line at a time, at a pace somebody can read, with the outcome tag on
 * each row picked out. Nothing here is a different version of the run: the source is the
 * same string the block always held, and this file only decides when each line appears.
 * That is the whole design constraint. A console that held its own copy of the rows could
 * drift from the program, and a page whose interactive demonstration disagrees with its
 * own evidence is worse than a page with no interactive demonstration.
 *
 * `tools/gates/run.mjs` asserts that the finished text is byte-identical to the source and
 * that every row the program printed reached the screen.
 */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

const AMP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => AMP[c]);

/* The five tags the run puts in front of a row, and what each one means to a reader who
 * has not read the README. The text is here rather than in the markup because it labels a
 * line the program wrote, and the program's own vocabulary is the thing being explained. */
const TAGS = {
  '[ok   ]': ['ok', 'closed. A schema-valid reason is on the record and nobody has to look at it'],
  '[HUMAN]': ['human', 'open. Nobody was reached, or nothing usable came back, so a person has it'],
  '[SAFEG]': ['safeg', 'held. An answer arrived and the safeguarding rule will not close it'],
  '[skip ]': ['skip', 'never dialled. A gate stopped it before the telephone'],
  '[fail ]': ['fail', 'the call itself failed'],
};

/* Per-line dwell. A row is the thing a reader is here for, so a row gets time; a blank
 * line and a citation do not. Totals get a beat because they are the payoff. */
function dwell(line) {
  if (!line.trim()) return 90;
  for (const tag of Object.keys(TAGS)) if (line.includes(tag)) return 340;
  if (/^\s{22}/.test(line)) return 40;          // a wrapped citation under a figure
  if (/^\s{2}\S/.test(line)) return 150;        // a heading inside the summary
  return 90;
}

function markup(line) {
  for (const [tag, [cls]] of Object.entries(TAGS)) {
    if (line.includes(tag)) {
      const [before, ...rest] = line.split(tag);
      return esc(before) + '<b class="tag tag-' + cls + '">' + esc(tag) + '</b>'
        + esc(rest.join(tag));
    }
  }
  return esc(line);
}

export class RunConsole {
  constructor(root) {
    this.root = root;
    this.out = root.querySelector('[data-run-out]');
    /* The source is the block's own text, not a copy of it.
     *
     * An attribute or a JSON island would be a second place the run's output lives, and
     * two copies of one string is the shape of every stale number this project has found.
     * It also means a reader with JavaScript switched off has already read the whole run:
     * the markup ships complete and this file only decides when each line appears. */
    this.source = this.out ? this.out.textContent : '';
    this.lines = this.source.split('\n');
    this.timer = null;
    this.at = 0;
    /* Whether a reader has asked to watch it play. Only the control label depends on it:
     * "Again" is the wrong word for a button nobody has pressed. */
    this.played = false;

    this.play = root.querySelector('[data-run-play]');
    this.skip = root.querySelector('[data-run-skip]');
    this.legend = root.querySelector('[data-run-legend]');
    /* No controls, or nothing to play: leave the block exactly as it shipped. A console
     * that half-mounts and blanks the text would remove the evidence to add an
     * animation. */
    if (!this.out || !this.play || !this.source.trim()) return;

    this.legendMarkup();
    this.play.addEventListener('click', () => (this.timer ? this.pause() : this.start()));
    if (this.skip) this.skip.addEventListener('click', () => this.finish());

    /* Everybody gets the whole thing at once, and the button replays it.
     *
     * This used to render zero lines and wait to be asked, which left the only route a
     * non-programmer has to the program's output as an empty rectangle: on the page, in
     * every screenshot, in print, and in the film. The animation is worth having and it is
     * worth nothing as a precondition for the evidence. Reduced motion made no difference
     * to this branch and now makes none to any of them, which is the tell that the
     * animation was never carrying the content. */
    this.finish();
  }

  legendMarkup() {
    if (!this.legend) return;
    const used = Object.entries(TAGS).filter(([tag]) => this.source.includes(tag));
    this.legend.innerHTML = used.map(([tag, [cls, what]]) =>
      '<div><b class="tag tag-' + cls + '">' + esc(tag) + '</b> ' + esc(what) + '</div>'
    ).join('');
  }

  render(upto) {
    this.at = Math.min(upto, this.lines.length);
    this.out.innerHTML = this.lines.slice(0, this.at).map(markup).join('\n');
    /* Keeps the newest line in view without moving the page under the reader. */
    this.out.scrollTop = this.out.scrollHeight;
    const done = this.at >= this.lines.length;
    this.play.textContent = done
      ? (this.played ? 'Again' : 'Watch it run')
      : this.timer ? 'Pause' : this.at ? 'Resume' : 'Run it';
    this.play.setAttribute('aria-label', done
      ? (this.played
        ? 'Play the offline run again from the start'
        : 'Play the offline run one line at a time. The whole run is already below')
      : 'Play the offline run, one line at a time');
    if (this.skip) this.skip.hidden = done;
    this.root.dataset.runState = done ? 'done' : this.timer ? 'playing' : 'idle';
  }

  step() {
    if (this.at >= this.lines.length) return this.stop();
    const wait = dwell(this.lines[this.at] ?? '');
    this.render(this.at + 1);
    if (this.at >= this.lines.length) return this.stop();
    this.timer = setTimeout(() => this.step(), wait);
  }

  start() {
    this.played = true;
    if (this.at >= this.lines.length) this.at = 0;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.step(), 0);
    this.render(this.at);
  }

  pause() {
    clearTimeout(this.timer);
    this.timer = null;
    this.render(this.at);
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.render(this.lines.length);
  }

  finish() {
    this.at = this.lines.length;
    this.stop();
  }
}

export function mountConsoles(scope = document) {
  return [...scope.querySelectorAll('[data-run]')].map((el) => new RunConsole(el));
}

/* Mounted here rather than from app.js or an inline script.
 *
 * app.js owns the player, the rail and the figure, and a throw in any of those should not
 * take the run block down with it. An inline module would need its own hash in the
 * derived Content-Security-Policy, and a policy that grows a hash for every three-line
 * script is a policy somebody eventually widens to unsafe-inline.
 *
 * A module executes after the document is parsed, so the elements are there. */
mountConsoles();

/* Mark every code block that is actually cut off, so the stylesheet can show the cut.
 *
 * `pre { overflow-x: auto }` was the whole of the overflow handling, and on a 390px screen
 * act 08 sliced roughly ninety console lines mid-word with nothing to say so: `OFFLINE. No
 * telephone call will be plac`. It is not only a phone problem. At 1440px two of the cited
 * Bureau of Labor Statistics URLs were cut in the same silent way.
 *
 * The attribute is set rather than the fade being unconditional, because a block that fits
 * must not be faded: a gradient over the last two characters of a line that ends where it
 * meant to reads as a rendering fault. With no JavaScript nothing is marked and nothing
 * fades, which is the same content, still scrollable by touch, without a hint it does not
 * need to be wrong about.
 *
 * Re-run on resize because the answer changes with the viewport, and a page rotated from
 * landscape to portrait is exactly when the cut appears. */
function markOverflowingBlocks() {
  for (const block of document.querySelectorAll('pre')) {
    const cut = block.scrollWidth > block.clientWidth + 1;
    if (cut) block.setAttribute('data-overflowing', '');
    else block.removeAttribute('data-overflowing');
  }
}

markOverflowingBlocks();

let overflowPass;
addEventListener('resize', () => {
  clearTimeout(overflowPass);
  overflowPass = setTimeout(markOverflowingBlocks, 150);
}, { passive: true });

/* The transcript scrollers, marked the same way and for the same reason.
 *
 * `.turns` has a fixed `max-height` and rows of variable height, so the cut lands wherever
 * a row happens to fall. Both columns of the duet were ending on the top third of a line
 * of type. `data-scrollable` says the list is taller than its box; `data-at-end` says the
 * reader has reached the bottom, and takes the fade off so the final turn is never dimmed.
 *
 * This lives here rather than in `player.js` because it is about the box, not the playback:
 * a transcript nobody has pressed play on scrolls too. */
function markScroller(list) {
  const scrollable = list.scrollHeight > list.clientHeight + 1;
  list.toggleAttribute('data-scrollable', scrollable);
  const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
  list.toggleAttribute('data-at-end', atEnd);
}

for (const list of document.querySelectorAll('.turns')) {
  markScroller(list);
  list.addEventListener('scroll', () => markScroller(list), { passive: true });
}

addEventListener('resize', () => {
  clearTimeout(overflowPass);
  overflowPass = setTimeout(() => {
    markOverflowingBlocks();
    document.querySelectorAll('.turns').forEach(markScroller);
  }, 150);
}, { passive: true });
