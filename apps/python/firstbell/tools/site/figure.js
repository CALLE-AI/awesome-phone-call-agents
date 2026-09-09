// The three-endings figure, upgraded from a still to the animation it was authored as.
//
// The page ships the still first and always. The SVG is in the markup, it needs no script,
// it survives the no-JavaScript pass, and it is what a reader sees if anything below fails.
// The animation replaces it only when all four of these are true:
//
//   the player loaded            a script can fail to arrive
//   the data arrived             it is assigned by figure-data.js, from this origin
//   motion is not reduced        prefers-reduced-motion is a instruction, not a hint
//   the figure is on screen      nothing is decoded for a figure nobody reached
//
// The data is handed over as an object rather than a URL. It was a URL, and the policy this
// page derives sets `connect-src 'none'` because the page places no network call, so the
// browser refused the one request the player made and the animation never played for
// anybody. The still is the fallback and the still is correct, which is why nothing looked
// broken for a week.
//
// Held to the same rule as everything else on this page: the enhancement may never be worse
// than the thing it replaces.
(function () {
  const fig = document.querySelector('[data-lottie]');
  if (!fig || !window.__firstbellFigure) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;

  let started = false;
  let anim = null;

  // The player is fetched here rather than by a script tag in the head, and it is the
  // largest thing this page loads: 45.6 KB gzipped, against a page that is 80 KB with it
  // left out. It draws one figure nine screens down. Every reader who opened the page paid
  // for it, including the ones who read two screens and left and the ones who asked for
  // reduced motion, who are turned away four lines above this and never needed it at all.
  //
  // Requested from this origin, so the derived policy covers it under `script-src 'self'`
  // and no third party is in the path. A failure to arrive is not handled as an error
  // because it is not one: the still is in the markup, it is correct, and it stays.
  const player = () => {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (!player.pending) {
      player.pending = new Promise((resolve) => {
        const tag = document.createElement('script');
        tag.src = 'lottie_light.min.js';
        tag.addEventListener('load', () => resolve(window.lottie || null));
        tag.addEventListener('error', () => resolve(null));
        document.head.appendChild(tag);
      });
    }
    return player.pending;
  };

  const start = async () => {
    if (started) return;
    started = true;
    // Asked for after the reader reached the figure, and asked for once. A reader who
    // turned motion off between the observer firing and the player arriving is checked
    // again below, because the fetch takes long enough for that to happen.
    if (!(await player()) || reduced.matches) return;
    const mount = document.createElement('div');
    mount.className = 'fig-anim';
    // The still keeps the box. Swapping it for an empty div first would collapse the figure
    // and shift every word under it, on a page whose shift budget is 0.001.
    const stage = fig.querySelector('.fig-stage');
    const still = stage && stage.querySelector('svg');
    if (!stage || !still) return;
    // Size the mount from the box the still is actually occupying, not from its width and
    // height attributes. With `width: 100%; height: auto` a browser lays an inline SVG out
    // from its viewBox, so the attributes are the authored size and the rect is the drawn
    // one. They differ here by ten pixels, and ten pixels of the page moving is ten pixels
    // nobody asked for.
    const box = still.getBoundingClientRect();
    if (!box.width || !box.height) return;
    mount.style.aspectRatio = box.width + ' / ' + box.height;
    // Into the stage, never into the figure. A new child of the figure would renumber its
    // siblings, and the contrast census identifies a text run by its position among them.
    stage.appendChild(mount);
    try {
      anim = window.lottie.loadAnimation({
        container: mount,
        renderer: 'svg',
        loop: false,
        autoplay: true,
        animationData: window.__firstbellFigure,
      });
    } catch (e) {
      mount.remove();               // the still stays exactly where it is
      return;
    }
    // Look at what was built, not at an event saying it was.
    //
    // With a `path:` the player loads over the network, so a `DOMLoaded` listener attached
    // on the next line is attached in time. With `animationData:` the whole thing is built
    // inside the call above, synchronously, so both `DOMLoaded` and `data_failed` have
    // already fired and no listener will ever hear them. The still stayed visible, the
    // stage held both, and 187px of page moved down. Nothing said so: the CLS gate scores
    // 0.00000 because the mount happens 200px before the figure enters view and CLS counts
    // only shifts a reader can see.
    //
    // So ask the DOM. A player that drew something leaves an svg with shapes in it, and
    // that is true whichever way the data arrived.
    const drew = mount.querySelector('svg');
    if (!drew || !drew.querySelector('g, path')) {
      mount.remove();
      still.removeAttribute('hidden');
      return;
    }
    // `still.hidden = true` does nothing here, and that is the whole reason this was
    // broken. `hidden` is an IDL property of HTMLElement; the still is an SVGElement, so
    // the assignment quietly creates a JavaScript property on the object and sets no
    // attribute at all. The CSS rule that collapses it matches the attribute, so the still
    // kept its 197px, the stage held both, and every word below moved down.
    still.setAttribute('hidden', '');
    anim.addEventListener('data_failed', () => {
      mount.remove();
      still.removeAttribute('hidden');
    });
    // Already appended above, before the player ran, because a container outside the
    // document cannot be measured and the check above measures it.
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
    if (still) still.removeAttribute('hidden');
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
