// The three-endings figure, upgraded from a still to the animation it was authored as.
//
// The page ships the still first and always. The SVG is in the markup, it needs no script,
// it survives the no-JavaScript pass, and it is what a reader sees if anything below fails.
// The animation replaces it only when all four of these are true:
//
//   the player loaded            a network can drop one file
//   motion is not reduced        prefers-reduced-motion is a instruction, not a hint
//   the figure is on screen      nothing is fetched or decoded for a figure nobody reached
//   the JSON parsed              a truncated asset leaves the still in place
//
// Held to the same rule as everything else on this page: the enhancement may never be worse
// than the thing it replaces.
(function () {
  const fig = document.querySelector('[data-lottie]');
  if (!fig || !window.lottie) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  let started = false;
  let anim = null;

  const start = () => {
    if (started) return;
    started = true;
    const mount = document.createElement('div');
    mount.className = 'fig-anim';
    // The still keeps the box. Swapping it for an empty div first would collapse the figure
    // and shift every word under it, on a page whose shift budget is 0.001.
    const stage = fig.querySelector('.fig-stage');
    const still = stage && stage.querySelector('svg');
    if (!stage || !still) return;
    mount.style.aspectRatio = (still.getAttribute('width') || 900) + ' / '
                            + (still.getAttribute('height') || 300);
    try {
      anim = window.lottie.loadAnimation({
        container: mount,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        path: fig.dataset.lottie,
      });
    } catch (e) {
      return;                       // the still stays exactly where it is
    }
    anim.addEventListener('data_failed', () => {
      mount.remove();
      still.hidden = false;
    });
    anim.addEventListener('DOMLoaded', () => { still.hidden = true; });
    // Into the stage, never into the figure. A new child of the figure would
    // renumber its siblings, and the contrast census identifies a text run by
    // its position among them.
    stage.appendChild(mount);
  };

  // A reader who turns motion off after the animation has started is asking for it to stop
  // now, not on the next page load.
  reduced.addEventListener('change', (e) => {
    if (!e.matches || !anim) return;
    anim.stop();
    const mount = fig.querySelector('.fig-anim');
    const stage = fig.querySelector('.fig-stage');
    const still = stage && stage.querySelector('svg');
    if (!stage || !still) return;
    if (mount) mount.remove();
    if (still) still.hidden = false;
  });

  if (!('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.disconnect();
      start();
    }
  }, { rootMargin: '200px' });
  io.observe(fig);
})();
