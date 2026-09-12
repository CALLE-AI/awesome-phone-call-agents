/* The two boards, as scenes you can turn.
 *
 * This module is an upgrade and never a requirement. Both boards are already in the markup
 * as flat drawings, correct and labelled, before this file is fetched. Three separate
 * things have to go right for a scene to replace one: the module has to arrive from the
 * CDN, the driver has to give up a WebGL context, and the reader must not have asked for
 * reduced motion in a way that makes a turning object unwelcome. When any of them does not
 * hold, the drawing stays and the page loses nothing it was making an argument with. The
 * `cdn loss` gate aborts these requests on purpose and then checks the page still renders,
 * so this path is exercised rather than assumed.
 *
 * There is no orbit-controls dependency and nothing here is imported from a second host.
 * jsDelivr at r0.169.0 is the only third-party origin in the shipped Content-Security-
 * Policy; anything from anywhere else is refused by the browser in production, which is a
 * blank board on a page whose whole argument is that it shows its working. Rotation about
 * the vertical axis is the only movement worth having and it is four lines of pointer
 * arithmetic, so the extras directory is not worth the round trip either.
 *
 * Note for anyone verifying this on the build machine: headless Chromium here cannot
 * composite WebGL, so a screenshot of either canvas comes back blank even when the scene
 * is correct. Check `renderer.info.render.calls` and a `gl.readPixels` sample taken inside
 * the same render tick instead. Both scenes report both on `window.__morning` and
 * `window.__cutoff` for exactly that reason.
 */

const CDN = 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch (e) {
    return false;
  }
}

/* ---- reading the page's own inks -------------------------------------------------------
 *
 * The palette is read off the document rather than repeated here. A palette copied into a
 * script is a second source of truth for a colour and it drifts the first time the
 * stylesheet is edited.
 *
 * Two things make that harder than it looks, and both of them were silently wrong before
 * 2026-09-10.
 *
 * One: `THREE.Color` cannot parse `oklch()`, and this page's palette is written entirely
 * in it. Handed the raw string, `Color` fails quietly and leaves the material white, which
 * on a near-white ground is a board that renders perfectly and cannot be seen.
 *
 * Two: the obvious fix, setting the colour on a throwaway element and reading
 * `getComputedStyle().color` back, stopped working. Chrome now serialises `color` in the
 * colour space the author wrote it in, so the probe returns `oklch(0.235 0.008 80)` and a
 * guard of `/^rgb/.test(resolved)` takes the `else` branch every single time. Measured on
 * this build: every call fell through to its hardcoded hex, and the boards were painted in
 * `#1a1815` and `#e8c34a`, neither of which is a value in `page.css`. The helper looked
 * like it was reading the stylesheet and was reading its own arguments.
 *
 * So the resolved string, whatever notation the browser hands back, is rasterised: one
 * pixel on a 1x1 canvas, one `getImageData`. That is the browser's own conversion to the
 * sRGB bytes it would put on the screen, which is the number that has to match the rest of
 * the page, and it works for `oklch`, `color()`, `lab`, a hex or a keyword without this
 * file having to know which one it was given.
 */

/* A colour nothing on this page uses, inherited by the probe on purpose. See `ink`. */
const SENTINEL = 'rgb(1, 2, 3)';
const INKS = new Map();

function toSRGB(css) {
  if (!css) return null;
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return /^rgb/.test(css) ? css : null;
  // An unparseable value leaves `fillStyle` at whatever it was, so it is seeded with a
  // colour that is not a plausible answer and the read-back is checked against it.
  ctx.fillStyle = '#ff00ff';
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const px = ctx.getImageData(0, 0, 1, 1).data;
  if (px[3] === 0) return null;
  return `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
}

function ink(name, fallback) {
  if (INKS.has(name)) return INKS.get(name);
  let out = fallback;
  try {
    /* The probe stands inside a host painted in a colour nothing else uses, and that is
     * the whole point of the host.
     *
     * A custom property the stylesheet never defined does not fall back. `color:
     * var(--nope)` is invalid at computed-value time, and `color` is an inherited
     * property, so the declaration is dropped and the probe reports the colour of
     * whatever text it was standing in. It returns a real colour, so nothing downstream
     * can tell it was never asked for.
     *
     * That is not hypothetical. Both boards asked for `--brand`, which this site does not
     * define -- the only brand name in `page.css` is `--brand-field` -- and both read it
     * back as `--ink`. In the flat SVG, where there is no fallback argument to save it,
     * the same missing name painted the one gold object on each board pure black.
     *
     * Standing the probe in a sentinel turns that silent wrong answer into a detectable
     * one: if the read-back is the sentinel, the name is not in the stylesheet and the
     * caller's fallback is the honest answer. */
    const host = document.createElement('span');
    host.style.cssText = `position:absolute;visibility:hidden;color:${SENTINEL}`;
    const probe = document.createElement('span');
    probe.style.cssText = `color:var(${name})`;
    host.appendChild(probe);
    document.body.appendChild(host);
    const resolved = toSRGB(getComputedStyle(probe).color);
    host.remove();
    if (resolved && resolved !== SENTINEL) out = resolved;
  } catch (e) {
    /* Keep the fallback. */
  }
  INKS.set(name, out);
  return out;
}

/* ---- two things every scene here needs -------------------------------------------------
 *
 * A soft disc, and a room to reflect. Both are drawn into a small canvas rather than
 * fetched, because a texture is an asset and an asset is a request, and the only origin
 * this page may talk to is the one serving three.js.
 */

/** A radially fading disc, white with an alpha ramp, for contact shadows and glows. */
function discTexture(THREE, ramp) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  for (const [at, a] of ramp) grad.addColorStop(at, `rgba(255, 255, 255, ${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* A studio, out of lights rather than out of an environment map, and that is a decision
 * with a measurement behind it.
 *
 * The first version of this prefiltered a 64x32 procedural room through `PMREMGenerator`
 * and hung it on `scene.environment`. It looked better. It also cost between 17.9ms and
 * 74.5ms in one synchronous call, measured over three loads of index.html with
 * `performance.measure` around the generator, and the slow one produced a 79ms task after
 * load. A browser gate fails on any post-load task over 50ms, and the ceiling is there
 * because a task that long is a frame a reader loses on a page that is meant to feel like
 * paper. Deferring it to a later frame does not help: it is one call, it cannot be split,
 * and moving it behind the first interaction only relocates the stall to the moment
 * somebody touches the board.
 *
 * There is no cheaper prefilter available either. PMREM renders a fixed 256 cube mip chain
 * whatever size the source is, and handing a plain equirectangular texture to
 * `scene.environment` does not avoid it -- a physical material only reads CubeUV, so
 * three would prefilter the same texture itself at first render, at the same price and at
 * a worse moment.
 *
 * So the reflections are approximated with four directional sources instead. For what
 * these two boards are -- flat-faced boxes with a clearcoat -- most of what an environment
 * was contributing is a specular lobe per surface, and a light produces one of those
 * directly. Measured cost of the whole material set at first render, in the same
 * instrumented run: 2.1ms.
 *
 * The rig, and what each one is for:
 *   hemisphere  ambient, warm from below so the underside of a tile is not dead grey
 *   key         the form, high and to the right, where the page's own drop shadows fall
 *   fill        opposite the key at a fifth of it, so shaded faces keep their edges
 *   rim         from behind, low, to put a line on the silhouette of the tall object
 *   sheen       almost overhead and weak, which is the highlight a clearcoat catches
 */
function lightStudio(THREE, scene, strength) {
  const rig = [
    ['hemi', 0, 0, 0, 1.5],
    ['dir', 6, 14, 8, 1.3],
    ['dir', -8, 5, 6, 0.28],
    ['dir', -4, 7, -10, 0.5],
    ['dir', 1, 16, -1, 0.34],
  ];
  for (const [kind, x, y, z, power] of rig) {
    if (kind === 'hemi') {
      scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8378, power * strength));
      continue;
    }
    const light = new THREE.DirectionalLight(0xffffff, power * strength);
    light.position.set(x, y, z);
    scene.add(light);
  }
}

/* Bringing a scene up over several frames instead of all in one.
 *
 * Three compiles a material's program the first time it renders something using it, so a
 * scene that introduces three different programs in its first frame pays for all three in
 * one task. Measured on this build, in the configuration the browser gate runs (headless,
 * `--disable-gpu`, so a software rasteriser): the finished morning board's first render
 * was 36 to 40ms and the whole mount 55 to 60ms, which put a task of 56 to 65ms after load
 * on five loads out of five. The ceiling that gate enforces is 50ms. The board it replaced
 * had one program and rendered in 22ms.
 *
 * Nothing about that is fixed by making the materials simpler. Swapping every
 * `MeshPhysicalMaterial` for a `MeshStandardMaterial`, which drops the clearcoat entirely,
 * measured 36.2 and 40.3ms: the same. The cost is the number of programs, not the size of
 * any one of them.
 *
 * So each wave is hidden at build time and revealed one frame apart, after that frame has
 * rendered. Every program is then compiled in a task of its own. The last wave lands about
 * 50ms after the first, which is three frames, on an object nobody has scrolled to yet.
 */
function inWaves(...waves) {
  for (const wave of waves) for (const o of wave) o.visible = false;
  return waves.map((wave) => () => { for (const o of wave) o.visible = true; });
}

/** Renders and then reads, in one tick, and that ordering is the whole point.
 *
 * A WebGL drawing buffer is cleared when the frame is presented, so a `readPixels` called
 * from anywhere outside the draw returns a buffer of zeroes and reports a blank canvas for
 * a scene that is rendering perfectly well. That reading is indistinguishable from the
 * real failure it would be used to look for. */
function litPixels(renderer, scene, camera) {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const w = gl.drawingBufferWidth;
  const h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  /* Coverage and shading, because coverage on its own cannot tell a lit scene from a
   * silhouette. A board that renders as one flat colour has the same lit count as a board
   * with form on it, and on a machine that cannot composite WebGL into a screenshot the
   * spread of luminance across the lit pixels is the only evidence that the lights are
   * doing anything. Reported as a standard deviation over the pixels that were drawn. */
  let lit = 0;
  let sum = 0;
  let sumsq = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] <= 8) continue;
    const y = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    lit += 1;
    sum += y;
    sumsq += y * y;
  }
  const mean = lit ? sum / lit : 0;
  const sd = lit ? Math.sqrt(Math.max(0, sumsq / lit - mean * mean)) : 0;
  return {
    width: w, height: h, lit,
    pct: +((100 * lit) / (w * h)).toFixed(1),
    luma: +mean.toFixed(1),
    spread: +sd.toFixed(1),
  };
}

/* ---- the hover read-out ----------------------------------------------------------------
 *
 * Built here rather than in the markup, and not built at all until somebody points at
 * something. An empty tooltip sitting in the served HTML is an element with no ground
 * behind it for the contrast census to resolve and a promise of interactivity for the
 * `no javascript` gate to object to; neither is worth carrying for a box that is invisible
 * until a pointer arrives.
 *
 * It goes inside the stage, which is `position: relative`, and nowhere else. The clamp
 * below is what keeps it there. The CSS caps it at `calc(100% - 16px)` with a nowrap line
 * and a clipped overflow, so the box can never be wider than the stage minus its inset
 * whatever text lands in it; the script then only has to keep `left` inside the same
 * bounds. Both halves are needed. Width alone lets it be positioned off the edge, and
 * clamping alone cannot help if the content is wider than the room.
 */
function readout(stage) {
  let el = null;
  let time = null;
  let what = null;

  const build = () => {
    if (el) return el;
    el = document.createElement('div');
    el.className = 'mrn-tip';
    el.setAttribute('data-mrn-tip', '');
    time = document.createElement('b');
    what = document.createElement('i');
    el.append(time, what);
    stage.appendChild(el);
    return el;
  };

  return {
    show(x, y, stamp, status, flag) {
      const box = build();
      time.textContent = stamp;
      what.textContent = status;
      if (flag) box.setAttribute('data-flag', '');
      else box.removeAttribute('data-flag');
      box.setAttribute('data-open', '');
      // Measured after the text is in, because the width depends on it.
      const w = box.offsetWidth;
      const h = box.offsetHeight;
      const room = stage.clientWidth;
      const right = Math.max(6, room - w - 6);
      box.style.left = `${Math.round(Math.min(Math.max(x - w / 2, 6), right))}px`;
      box.style.top = `${Math.round(Math.max(4, y - h - 16))}px`;
    },
    hide() {
      if (el) el.removeAttribute('data-open');
    },
  };
}

/** Pointer position inside an element, in the element's own pixels. */
function local(el, e) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
}

/* Where the picture actually is inside the canvas element, which is not the same as where
 * the canvas element is.
 *
 * `renderer.setSize(w, h, false)` sets the drawing buffer and deliberately does not write
 * a CSS size, so the element is sized by the stylesheet. On `the-morning.html` that is
 * `width:100%; height:auto` and the two agree. On `index.html` the compact board is
 * `width:100%; height:100%; object-fit:contain` inside a stage with a fixed height -- 380
 * in the playground above 72rem -- and the buffer at that width is 510x300. The browser
 * letterboxes the bitmap: 510 by 300 of picture centred in 510 by 380 of element, with 40
 * pixels of nothing above and below it.
 *
 * A raycast that builds its normalised coordinates from the element's box is therefore
 * wrong by 40 pixels on the page the board is most likely to be pointed at, and wrong in a
 * way that still returns hits, just the neighbouring row's. So the ray is built off the
 * content box the browser worked out, not the border box it was given. */
function fitted(canvas) {
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height || !canvas.height) return null;
  const aspect = canvas.width / canvas.height;
  let w = r.width;
  let h = r.width / aspect;
  if (h > r.height) { h = r.height; w = r.height * aspect; }
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h };
}

/* Drag to turn, and that is the whole navigation. Pointer events rather than mouse events
 * so a touch drag works, and the pointer is captured so leaving the canvas mid-drag does
 * not strand the board halfway round. Returns a live view of the drag state, because the
 * hover code needs to know not to raycast while the board is moving under the finger.
 *
 * Two axes, not one. Left and right spins the board; up and down tilts it, which is the
 * gesture anybody who has used a 3D viewer tries second and which did nothing here. Yaw
 * is unbounded because a board that turns all the way round has no wrong side. Pitch is
 * clamped, because it does: past about 37 degrees down the tiles present as a line and
 * past about 31 up the reader is under the board looking at its underside, and neither
 * is a view of a morning. The clamp is asymmetric for the same reason the camera sits
 * above the board to begin with.
 *
 * The framing multiplier in each scene's `fit` pays for this. A box framed on yaw alone
 * is framed on `hypot(x, z)`, which does not move when the group tilts, so the extra
 * vertical extent a pitch produces has to be headroom that was already there. */
const PITCH_MIN = -0.55;
const PITCH_MAX = 0.65;

function dragToTurn(stage, group, onFirstDrag, onPitch) {
  const state = { dragging: false };
  let lastX = 0;
  let lastY = 0;
  stage.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    onFirstDrag();
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    const was = group.rotation.x;
    group.rotation.y += dx * 0.008;
    group.rotation.x = Math.max(PITCH_MIN,
                                Math.min(PITCH_MAX, group.rotation.x + dy * 0.006));
    lastX = e.clientX;
    lastY = e.clientY;
    // Re-frame only when the tilt actually moved, and never for the turn. The framing is
    // already solved against every yaw, so spinning it costs nothing; tilting changes
    // which pose is the worst one and has to be paid for.
    if (onPitch && group.rotation.x !== was) onPitch();
  });
  const release = (e) => {
    state.dragging = false;
    if (e.pointerId !== undefined && stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId);
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  return state;
}

/* Put the board in a named pose, so a headless run can sweep every rotation the drag
 * allows and photograph each one.
 *
 * The question it exists to answer is whether a reader can push the board out of its own
 * frame, and that has to be answered on drawn pixels. The obvious cheap answer, projecting
 * the framed bounding box, is wrong here and wrong in a way that reads as a failure: the
 * box is a cuboid spanning a flat grid from the ground to the top of the tower, so four of
 * its corners sit in empty air above the far corners of the board and project outside the
 * frame while every drawn tile is comfortably inside it. */
/* Is this board worth drawing this frame?
 *
 * Both scenes ran their loop for the whole life of the page, on every device, whether or
 * not the reader was anywhere near them. Two WebGL renders a frame is the page's largest
 * idle cost: on a 4x-throttled CPU the idle frame was 19.0ms with nothing happening on
 * screen at all, and on a phone that is battery spent on a board nine acts above the
 * reader's thumb. The observer carries a 200px margin so the board is already turning
 * before it scrolls in, and a hidden tab stops both of them outright.
 *
 * The loop keeps running; only the work inside it is skipped. Stopping the loop would mean
 * restarting it from an event handler, and a scene that has to be woken is a scene that can
 * fail to wake. */
function whileOnScreen(stage) {
  if (!('IntersectionObserver' in window)) return () => true;
  let near = false;
  new IntersectionObserver((entries) => { near = entries[entries.length - 1].isIntersecting; },
    { rootMargin: '200px 0px' }).observe(stage);
  return () => near && document.visibilityState !== 'hidden';
}

function poseSetter(group, onPose) {
  return (turn, pitch) => {
    if (turn !== undefined && turn !== null) group.rotation.y = turn;
    if (pitch !== undefined && pitch !== null) group.rotation.x = pitch;
    group.updateMatrixWorld(true);
    if (onPose) onPose();
  };
}

/* ---- framing ---------------------------------------------------------------------------
 *
 * How much of the frame the board is allowed to reach, and how many yaws the framing is
 * solved against. 0.94 leaves a 3% margin on each side, which is what the hover lift and
 * the ring expansion need: those move geometry after the framing was solved and the solve
 * is not re-run for them.
 */
const FRAME_FILL = 0.94;
const FRAME_YAWS = 24;
/* And then closer than the solve says.
 *
 * The solve above answers one question: how far back does the camera have to sit so that no
 * rotation the drag allows takes the board out of the frame. The answer is set by the
 * quarter turn, where the long axis of the grid lies up the short side of a landscape
 * canvas, and every other pose pays for it. At rest the board was filling 60% of the frame's
 * width and 40% of its height, which is the shrunken look: the empty space is headroom
 * reserved for a pose the reader has to drag to.
 *
 * So the camera comes in by a sixth. At rest the board is a sixth larger in every dimension;
 * at the worst pose the corners reach past the frame, and a reader who turns it that far
 * sees a board cropped rather than a board floating in a margin. That is the better of the
 * two, and it is a choice rather than an oversight. */
const FRAME_PULL = 0.84;

/* The points the framing has to keep inside the frame, in the group's own space.
 *
 * Per instance and per mesh, never their union. A union box over a flat grid and a tall
 * column is a cuboid whose top corners sit in empty air above the far corners of the
 * board: framing to those pulls the camera back for a volume nothing is ever drawn in,
 * and reading them back reports a board as clipping while every tile is comfortably
 * inside the canvas. This was measured both ways; the box answer was wrong by a third.
 *
 * Group-local, so a point does not carry the rotation the solve is about to vary. */
function hullPoints(THREE, group, framed) {
  const points = [];
  const local = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  group.updateMatrixWorld(true);
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
  for (const object of framed) {
    if (!object.geometry) continue;
    if (object.geometry.boundingBox === null) object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    const many = object.isInstancedMesh ? object.count : 1;
    for (let k = 0; k < many; k += 1) {
      local.copy(object.matrixWorld);
      if (object.isInstancedMesh) {
        object.getMatrixAt(k, instance);
        local.multiply(instance);
      }
      local.premultiply(toLocal);
      for (let i = 0; i < 8; i += 1) {
        points.push(new THREE.Vector3(
          i & 1 ? box.max.x : box.min.x,
          i & 2 ? box.max.y : box.min.y,
          i & 4 ? box.max.z : box.min.z).applyMatrix4(local));
      }
    }
  }
  return points;
}

/* A camera placement that keeps the board inside its canvas at the pitch it is at now, and
 * at every yaw, including the yaws the idle spin is about to take it through.
 *
 * A constant multiplier cannot do this job, and it is worth saying why rather than leaving
 * the next person to re-derive it. The board is eight tiles by six. Seen square on at rest
 * its long axis lies across a canvas that is wider than it is tall, and a modest margin is
 * enough. Turned a quarter and tilted to the top of its clamp, the same long axis lies up
 * the short side of the canvas and needs roughly twice the distance. One number for both
 * either crops the second or makes the first a postage stamp. Measured: at 1.28 the board
 * clipped in 20 of 80 sampled poses; the worst put 1,107 pixels of tile on the top edge.
 *
 * Solved for yaw rather than tracking it, so the size is steady while the board spins and
 * changes only when the reader tilts it, which is the one moment a view adjusting is what
 * they asked for. The loop converges because the projected extent of a rigid body is very
 * nearly inversely proportional to camera distance over this range: two passes is the
 * usual cost and five is the ceiling. */
function framer(THREE, camera, group, framed, lens) {
  let hull = null;
  const pose = new THREE.Matrix4();
  const euler = new THREE.Euler();
  const point = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const aim = new THREE.Vector3();

  return () => {
    if (!hull) hull = hullPoints(THREE, group, framed);
    if (!hull.length) return;

    mid.set(0, 0, 0);
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of hull) { lo.min(p); hi.max(p); }
    mid.copy(lo).add(hi).multiplyScalar(0.5);
    const size = hi.clone().sub(lo);

    const vFov = (camera.fov * Math.PI) / 180;
    const spread = Math.hypot(size.x, size.z);
    let dist = Math.max(size.y / 2 / Math.tan(vFov / 2),
                        spread / 2 / Math.tan(vFov / 2) / camera.aspect) * 1.28;

    const place = () => {
      aim.copy(mid).applyMatrix4(group.matrixWorld);
      camera.position.set(aim.x + lens.x * dist, aim.y + lens.y * dist, aim.z + lens.z * dist);
      camera.lookAt(aim);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
    };

    const reach = () => {
      let worst = 0;
      for (let i = 0; i < FRAME_YAWS; i += 1) {
        euler.set(group.rotation.x, (i * 2 * Math.PI) / FRAME_YAWS, 0);
        pose.makeRotationFromEuler(euler);
        pose.setPosition(group.position);
        for (const p of hull) {
          point.copy(p).applyMatrix4(pose).project(camera);
          worst = Math.max(worst, Math.abs(point.x), Math.abs(point.y));
        }
      }
      return worst;
    };

    place();
    for (let pass = 0; pass < 5; pass += 1) {
      const worst = reach();
      if (worst <= FRAME_FILL) break;
      dist *= worst / FRAME_FILL;
      place();
    }
    dist *= FRAME_PULL;
    place();
  };
}

/* ---- the morning board ---------------------------------------------------------------- */

async function mount(THREE) {
  const stage = document.querySelector('[data-mrn-stage]');
  const board = document.querySelector('.morning');
  if (!stage || !board) return;

  const count = Number(board.dataset.mrnCount || 0);
  const cols = Number(board.dataset.mrnCols || 8);
  const openAt = Number(board.dataset.mrnOpen || 0);
  if (!count || !cols) return;
  const rows = Math.ceil(count / cols);

  /* When each call goes out. Two numbers off the markup, spaced here, so the times the
   * tiles report cannot drift from the premise `morning.py` printed under the drawing.
   * Nothing about a call's ending is derived: forty of them closed and one did not, which
   * is the only split this board has ever claimed and the only one it reports. */
  const startAt = (() => {
    const [h, m] = (board.dataset.mrnStart || '08:30').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  })();
  const span = Number(board.dataset.mrnSpan || 50);
  const clockAt = (i) => {
    const t = startAt + Math.round((i * span) / Math.max(1, count - 1));
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(Math.floor(t / 60) % 24)}:${pad(t % 60)}`;
  };

  /* The buffer is sized from the stage's width and a ratio, never from the stage's own
   * height, even on the first screen where the box states one and the canvas is laid into
   * it with `object-fit: contain`. Matching the buffer to that box removes the letterbox
   * bands and looks like the obvious win; it is not. A canvas carries an intrinsic size,
   * an in-flow canvas hands that ratio to whatever is sizing its container, and this one
   * sits in act 00's grid: sizing the buffer from the box made the two size each other,
   * and mounting the board narrowed the reading column from 1112px to 1088px. One layout
   * shift of 0.01424 against a ceiling of 0.001, for a board 12% taller. Taking the canvas
   * out of flow to break the loop measured 0.18188, which is worse again. The bands stay. */
  const stageHeight = () => {
    const w = stage.clientWidth || 720;
    return [w, Math.round(Math.min(620, Math.max(300, w * 0.86)))];
  };
  const [W, H] = stageHeight();

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);

  // An object on a table under a window, which is what this is.
  lightStudio(THREE, scene, 1);

  const paper = new THREE.Color(ink('--ink', '#201e1a'));
  const mark = new THREE.Color(ink('--live-mark', '#b77800'));
  const lift = new THREE.Color(ink('--brand-field', '#ffe56f'));

  const group = new THREE.Group();
  scene.add(group);

  const PITCH = 1.55;
  const TILE = 0.18;
  const FLOOR = -TILE / 2 - 0.012;
  const HOVER_LIFT = 0.42;

  /* Every closed case is the same tile. That sameness is the argument the page is making
   * and it is also why one instanced mesh is the right primitive: there is genuinely only
   * one object here, drawn `count - 1` times. Forty-one separate meshes would be forty-one
   * draw calls and a matrix upload apiece to lift one of them. */
  const inst = count - 1;
  const tile = new THREE.BoxGeometry(1.25, TILE, 1.25);
  /* Glossy, but a filed document is not a mirror. Clearcoat rather than metalness is what
   * gives a lacquered card its behaviour: a diffuse body under one thin specular layer, so
   * the highlight is a sharp band on the top edge and the face stays readable. The 0.55
   * translucency is kept from the flat version, where it was chosen because the field has
   * to be legible as forty separate things before the one that is different can mean
   * anything, and 0.22 read as almost nothing. */
  const flat = new THREE.MeshPhysicalMaterial({
    color: paper,
    roughness: 0.42,
    metalness: 0.0,
    clearcoat: 0.85,
    clearcoatRoughness: 0.24,
    transparent: true,
    opacity: 0.58,
  });
  const tiles = new THREE.InstancedMesh(tile, flat, inst);
  const px = new Float32Array(inst);
  const pz = new Float32Array(inst);
  const raised = new Float32Array(inst);
  const source = new Int32Array(inst);          // instance -> which absence it stands for
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === openAt) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    px[n] = (c - (cols - 1) / 2) * PITCH;
    pz[n] = (r - (rows - 1) / 2) * PITCH;
    source[n] = i;
    m.makeTranslation(px[n], 0, pz[n]);
    tiles.setMatrixAt(n, m);
    n += 1;
  }
  tiles.instanceMatrix.needsUpdate = true;
  group.add(tiles);

  const oc = openAt % cols;
  const or = Math.floor(openAt / cols);
  const towerX = (oc - (cols - 1) / 2) * PITCH;
  const towerZ = (or - (rows - 1) / 2) * PITCH;
  /* The one that never closed. Opaque where everything around it is translucent, and the
   * only object in the scene carrying an emissive channel, because a safeguarding
   * escalation is not a darker shade of the same thing. */
  const towerMat = new THREE.MeshPhysicalMaterial({
    color: mark,
    roughness: 0.28,
    metalness: 0.08,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    emissive: lift,
    emissiveIntensity: REDUCED ? 0.12 : 0.16,
  });
  const tower = new THREE.Mesh(new THREE.BoxGeometry(1.25, 3.4, 1.25), towerMat);
  tower.position.set(towerX, 1.7, towerZ);
  group.add(tower);

  /* ---- the ground the board sits on ----
   *
   * A baked contact shadow, not a shadow map. Two soft discs cost two draw calls and no
   * shader compile; a real depth pass for a board of forty-one boxes costs a second render
   * of the whole scene every frame and buys a hard edge nobody wants on a drawing that is
   * meant to read as paper on a desk. They are offset away from the key light, which is
   * the direction a shadow actually falls. */
  const disc = discTexture(THREE, [[0, 0.85], [0.42, 0.5], [0.78, 0.1], [1, 0]]);
  const boardW = cols * PITCH;
  const boardD = rows * PITCH;
  const groundMat = new THREE.MeshBasicMaterial({
    map: disc, color: paper, transparent: true, opacity: 0.3, depthWrite: false,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-0.35, FLOOR - 0.004, 0.45);
  ground.scale.set(boardW * 1.5, boardD * 1.6, 1);
  ground.renderOrder = -2;
  group.add(ground);

  const towerShade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: disc, color: paper, transparent: true, opacity: 0.42, depthWrite: false,
  }));
  towerShade.rotation.x = -Math.PI / 2;
  towerShade.position.set(towerX - 0.5, FLOOR - 0.002, towerZ + 0.62);
  towerShade.scale.set(3.4, 3.4, 1);
  towerShade.renderOrder = -1;
  group.add(towerShade);

  /* ---- the escalation, as something happening rather than something coloured ----
   *
   * Two rings on the floor under the tower, half a period apart, each expanding out and
   * fading. It is the one object on the board that is still in progress, and a static
   * board cannot say that: a gold column reads as a category, and a category is exactly
   * what this is not. Under reduced motion they are never created, so there is no hidden
   * geometry and no per-frame arithmetic behind a flag.
   */
  const rings = [];
  if (!REDUCED) {
    const ringGeo = new THREE.RingGeometry(0.62, 0.8, 44);
    for (let i = 0; i < 2; i += 1) {
      /* `forceSinglePass`, because a transparent double-sided material is drawn twice.
       * Three renders back faces and then front faces for that combination unless it is
       * told not to, which is right for a box you can see into and pointless for a flat
       * ring lying on the floor with its depth writes off. Measured: the two rings were
       * four draw calls and 352 triangles of the morning board's 848. */
      const r = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: mark, transparent: true, opacity: 0.4, forceSinglePass: true,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      r.rotation.x = -Math.PI / 2;
      r.position.set(towerX, FLOOR + 0.006 + i * 0.002, towerZ);
      r.renderOrder = 1;
      group.add(r);
      rings.push({ mesh: r, phase: i * 0.5 });
    }
  }

  stage.replaceChildren(renderer.domElement);
  const hint = document.querySelector('[data-mrn-hint]');
  if (hint) hint.hidden = false;

  /* Mounting changed the page's height, so anything that measured it is now wrong.
   *
   * On the board's own page nothing did. On the evidence page the hero is sticky above
   * 60rem and app.js writes its resting offset from the hero's height at boot, and this
   * function runs after boot: the canvas replaces the still, the hint stops being hidden
   * and the hero grows by the height of one line. Measured 2026-09-10: the hero rested
   * at -1291px where -1320px was needed, and its last line was unreachable because
   * nothing scrolls or resizes on a first screen nobody has touched yet.
   *
   * A resize is what actually happened to the layout, so it is what gets announced. */
  dispatchEvent(new Event('resize'));

  let autoSpin = REDUCED ? 0 : 0.0016;
  const drag = dragToTurn(stage, group, () => { autoSpin = 0; }, () => fit());

  /* ---- pointing at a tile ----
   *
   * One raycast a pointermove against the instanced mesh and the tower, and nothing at
   * all while a drag is in progress or when the pointer is a finger: `touch-action: pan-y`
   * means a horizontal drag on this stage is a turn, and a read-out that follows a finger
   * around while the board is moving under it is a tooltip fighting the gesture that
   * dismissed it.
   *
   * The idle spin stops while a tile is hovered. It has to: at 0.0016 radians a frame the
   * board walks out from under the cursor, and a tooltip that names the tile the pointer
   * was over two frames ago is worse than no tooltip.
   */
  const tip = readout(stage);
  const caster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let hovered = -1;                 // instance index, or -1
  let onTower = false;

  const clear = () => {
    if (hovered === -1 && !onTower) return;
    hovered = -1;
    onTower = false;
    tip.hide();
  };

  stage.addEventListener('pointermove', (e) => {
    if (drag.dragging || e.pointerType === 'touch') { clear(); return; }
    const at = local(stage, e);
    const pic = fitted(renderer.domElement);
    if (!pic) return;
    // Normalised against the picture, positioned against the stage: the ray has to agree
    // with what was drawn and the read-out has to agree with where the pointer is.
    ndc.set(((e.clientX - pic.left) / pic.w) * 2 - 1,
            -((e.clientY - pic.top) / pic.h) * 2 + 1);
    if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) { clear(); return; }
    caster.setFromCamera(ndc, camera);

    const onColumn = caster.intersectObject(tower, false);
    const onTile = onColumn.length ? [] : caster.intersectObject(tiles, false);
    const hitTower = onColumn.length > 0;
    const id = onTile.length ? onTile[0].instanceId : -1;

    if (!hitTower && id === -1) { clear(); return; }
    hovered = hitTower ? -1 : id;
    onTower = hitTower;
    const which = hitTower ? openAt : source[id];
    tip.show(at.x, at.y, clockAt(which),
             hitTower ? 'undetermined' : 'closed', hitTower);
  });
  stage.addEventListener('pointerleave', clear);
  stage.addEventListener('pointercancel', clear);

  /* Framed off the group's own bounding sphere rather than off three numbers that looked
   * right once at one width. A board of forty-one tiles has a height as well as a width
   * and the column is taller than either, so a camera placed by eye either crops the
   * column or leaves the board a postage stamp in the middle of the frame. Fitting both
   * axes and taking the larger distance is the only version that holds when the grid
   * changes shape, and the grid is derived from a cited absence rate, so it will.
   *
   * Measured on the tiles and the tower, never on the group: the contact shadows are half
   * again as wide as the board on purpose and the rings expand to nearly three times their
   * own radius, and framing to those would pull the camera back far enough to shrink the
   * thing they exist to sit under. */
  const framed = [tiles, tower];
  // The camera's direction from what it is looking at, as a unit-ish offset the solver
  // scales. The numbers are the ones this board was composed with: above it and in front
  // of it, so the tiles read as a surface rather than as a row of edges.
  const fit = framer(THREE, camera, group, framed, { x: 0, y: 0.82, z: 0.72 });

  const resize = () => {
    const [w, h] = stageHeight();
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fit();
  };
  addEventListener('resize', resize);
  resize();

  group.rotation.y = -0.5;
  const clock = new THREE.Clock();
  let elapsed = 0;
  // Tiles and tower first, because they are the board; then the ground it sits on, then
  // the escalation. See `inWaves`.
  const waves = inWaves([ground, towerShade], rings.map((r) => r.mesh));

  const drawable = whileOnScreen(stage);
  const draw = () => {
    if (!drawable()) { requestAnimationFrame(draw); clock.getDelta(); return; }
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    if (!(hovered !== -1 || onTower)) group.rotation.y += autoSpin;

    /* The lift is lerped, and only the instances that actually moved get rewritten. A
     * whole-array rewrite a frame is forty matrix builds and a buffer upload to move one
     * tile, every frame, for the entire time the page is open. */
    let moved = false;
    for (let k = 0; k < inst; k += 1) {
      const want = k === hovered ? HOVER_LIFT : 0;
      if (raised[k] === want) continue;
      // Instant under reduced motion. A lift that is there and does not travel is a
      // pointer affordance; a lift that eases is an animation, and one of those was asked
      // for and the other was not.
      const next = REDUCED ? want : raised[k] + (want - raised[k]) * Math.min(1, dt * 12);
      raised[k] = Math.abs(next - want) < 0.002 ? want : next;
      m.makeTranslation(px[k], raised[k], pz[k]);
      tiles.setMatrixAt(k, m);
      moved = true;
    }
    if (moved) tiles.instanceMatrix.needsUpdate = true;

    if (!REDUCED) {
      // A slow breath rather than a blink. 0.42Hz is under the three-flashes-a-second
      // ceiling by an order of magnitude and reads as something running, not something
      // alarming.
      towerMat.emissiveIntensity = 0.16 + 0.2 * (0.5 + 0.5 * Math.sin(elapsed * 2.6));
      for (const r of rings) {
        const p = ((elapsed / 2.9) + r.phase) % 1;
        r.mesh.scale.setScalar(0.85 + p * 2.6);
        r.mesh.material.opacity = 0.42 * (1 - p) ** 1.6;
      }
    }

    renderer.render(scene, camera);
    if (waves.length) waves.shift()();
    requestAnimationFrame(draw);
  };
  // Scheduled, never called here. A synchronous first render would put the whole first
  // frame back inside the mount task and undo the staging above it.
  requestAnimationFrame(draw);

  /* Published for verification, because a screenshot cannot check this on the machine it
   * was built on. `calls` is non-zero only if something was actually rasterised. */
  window.__morning = {
    tiles: inst,
    reduced: REDUCED,
    // Nothing pulses and nothing expands under reduced motion, and the way to show that
    // is a count of zero rather than a flag saying it was handled. The rings are not
    // created, so there is no hidden geometry and no per-frame arithmetic behind a test.
    rings: rings.length,
    // The one number that proves the idle spin is off. A gate cannot see the board turn.
    turn: () => +group.rotation.y.toFixed(4),
    calls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
    /* What the pointer is on, so a headless run can check the raycast resolved to a tile
     * without being able to see one. */
    hover: () => ({ instance: hovered, tower: onTower,
                    absence: onTower ? openAt : (hovered === -1 ? -1 : source[hovered]),
                    lifted: hovered === -1 ? 0 : +raised[hovered].toFixed(3) }),
    clock: clockAt,
    pitch: () => +group.rotation.x.toFixed(4),
    pitchRange: [PITCH_MIN, PITCH_MAX],
    // Renders on the spot. The loop above skips frames while the board is off
    // screen, and every tool that poses this board photographs it immediately
    // afterwards, so a pose that only set the rotation would be photographed one
    // frame too early or not at all.
    pose: (() => {
      const set = poseSetter(group, fit);
      return (turn, pitch) => { set(turn, pitch); renderer.render(scene, camera); };
    })(),
    probe: () => litPixels(renderer, scene, camera),
  };
}

/* ---- the cutoff board ------------------------------------------------------------------
 *
 * The second board: minutes to finish at each concurrency setting, against the cutoff.
 *
 * Every number is read off the markup, which the build wrote by calling
 * `tools/throughput.py`. Nothing is computed here, so the scene cannot say something the
 * tool does not. Even which bar is the recommended one arrives as an attribute rather than
 * being re-derived from the row list, because two places deciding that is two places that
 * can disagree with the sentence above the drawing.
 *
 * The plane is the point of drawing it at all. A bar that goes through a surface reads as a
 * morning that did not finish, where the same bar past a dashed line reads as a slightly
 * larger number. So it is built as a thing rather than as a threshold: a sheet of glass
 * with thickness, a lit rim, and bars whose shafts change material at the exact height it
 * sits at, so the part that is late is visibly a different object from the part that is
 * not.
 */
async function mountCutoff(THREE) {
  const stage = document.querySelector('[data-cut-stage]');
  const board = document.querySelector('.cutoff');
  if (!stage || !board) return;

  const rows = (board.dataset.cutRows || '').split(',').filter(Boolean).map((p) => {
    const [c, mins] = p.split(':');
    return { c: Number(c), m: Number(mins) };
  });
  const cutoff = Number(board.dataset.cutLine || 0);
  const fitsAt = Number(board.dataset.cutFits || 0);
  if (!rows.length || !cutoff) return;

  const W = stage.clientWidth || 720;
  const H = Math.round(Math.min(620, Math.max(300, W * 0.86)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 400);
  // A shade under the morning board's, because this scene has an emissive sheet in it and
  // the sheet has to be the brightest thing in the frame.
  lightStudio(THREE, scene, 0.94);

  const inkC = new THREE.Color(ink('--ink', '#201e1a'));
  const markC = new THREE.Color(ink('--live-mark', '#b77800'));
  const liftC = new THREE.Color(ink('--brand-field', '#ffe56f'));
  const paperC = new THREE.Color(ink('--paper', '#f8f7f4'));

  const group = new THREE.Group();
  scene.add(group);

  /* Scaled so the tallest bar is a fixed height in the scene. The tallest bar is the
   * default setting and it is the one the page is about, so it must not be the one that
   * leaves the frame. */
  const tallest = Math.max(...rows.map((r) => r.m));
  const UNIT = 8 / tallest;
  const PITCH = 1.5;
  const mid = ((rows.length - 1) * PITCH) / 2;
  const planeY = cutoff * UNIT;

  /* Three materials, shared across every bar that wants one, because nine bars with nine
   * material instances is nine shader programs to compile at mount. */
  const madeIt = new THREE.MeshPhysicalMaterial({
    color: inkC, roughness: 0.4, metalness: 0.0,
    clearcoat: 0.7, clearcoatRoughness: 0.3,
    transparent: true, opacity: 0.38,
  });
  const chosen = new THREE.MeshPhysicalMaterial({
    color: inkC, roughness: 0.3, metalness: 0.02,
    clearcoat: 0.9, clearcoatRoughness: 0.14,
    transparent: true, opacity: 0.66,
  });
  const late = new THREE.MeshPhysicalMaterial({
    color: markC, roughness: 0.26, metalness: 0.08,
    clearcoat: 1, clearcoatRoughness: 0.08,
    emissive: liftC, emissiveIntensity: 0.14,
  });
  // Two marks, and they must not behave alike. `flag` is the warning and it breathes;
  // `answer` is the recommendation and it sits still. One material animating both would
  // have the setting the page is recommending flashing at the same rate as the two it is
  // warning about, which is the opposite of what either mark is for.
  const flag = new THREE.MeshStandardMaterial({
    color: markC, roughness: 0.3, metalness: 0.1,
    emissive: liftC, emissiveIntensity: 0.35,
  });
  const answer = new THREE.MeshStandardMaterial({
    color: markC, roughness: 0.34, metalness: 0.06,
    emissive: liftC, emissiveIntensity: 0.18,
  });

  const collarGeo = new THREE.TorusGeometry(0.66, 0.045, 8, 30);
  const markerGeo = new THREE.OctahedronGeometry(0.2);
  const warnings = [];
  let overCount = 0;
  // Grouped by which program they will compile, not by what they mean. See `inWaves`.
  const marks = [];
  const shafts = [];

  rows.forEach((r, i) => {
    const h = r.m * UNIT;
    const x = i * PITCH - mid;
    const over = r.m > cutoff;
    const isChosen = fitsAt && r.c === fitsAt;
    // Where the plane cuts this bar. For a bar that fits, that is its own top.
    const cut = Math.min(h, planeY);

    /* The shaft below the plane, in the same translucent ink as every bar that finishes,
     * because up to the cutoff a late morning and an on-time one are the same morning. */
    const under = new THREE.Mesh(
      new THREE.BoxGeometry(0.82, over ? cut : h, 0.82),
      isChosen ? chosen : madeIt,
    );
    under.position.set(x, (over ? cut : h) / 2, 0);
    group.add(under);

    if (over) {
      overCount += 1;
      /* The overshoot: a separate object, slightly wider than the shaft it grows out of,
       * opaque where the shaft is translucent, and the only part of this board with an
       * emissive channel. Wider on purpose. A bar that changes colour at a line is a bar
       * with two colours; a bar that changes gauge at a surface has gone through it. */
      const above = new THREE.Mesh(new THREE.BoxGeometry(0.88, h - cut, 0.88), late);
      above.position.set(x, cut + (h - cut) / 2, 0);
      group.add(above);
      shafts.push(above);

      // A collar at the intersection, so the crossing is marked at the surface itself.
      const collar = new THREE.Mesh(collarGeo, flag);
      collar.rotation.x = -Math.PI / 2;
      collar.position.set(x, planeY, 0);
      group.add(collar);
      marks.push(collar);

      // And the warning above the bar, which is the part a reader sees before they have
      // worked out what the plane is.
      const marker = new THREE.Mesh(markerGeo, flag);
      marker.position.set(x, h + 0.62, 0);
      group.add(marker);
      marks.push(marker);
      warnings.push({ mesh: marker, base: h + 0.62, phase: i * 0.7 });
    }

    if (isChosen) {
      /* The answer, marked on the floor and capped on top. It sits below the plane and it
       * needs to be findable as the one being recommended without a reader having to
       * compare nine heights against a sheet of glass. */
      const pad = new THREE.Mesh(
        new THREE.RingGeometry(0.62, 0.78, 34),
        // Single pass for the same reason the morning board's rings are. The sheet above
        // it keeps both passes: a slab with thickness is exactly the case the two-pass
        // default exists for.
        new THREE.MeshBasicMaterial({
          color: markC, transparent: true, opacity: 0.75, forceSinglePass: true,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(x, 0.006, 0);
      group.add(pad);
      marks.push(pad);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.07, 0.94), answer);
      cap.position.set(x, h + 0.035, 0);
      group.add(cap);
      marks.push(cap);
    }
  });

  /* ---- the cutoff, as a sheet of glass ----
   *
   * A slab with thickness rather than a plane, because the bars have to be seen entering
   * one face and leaving the other. `depthWrite: false` is what makes that work: a
   * transparent surface that writes depth clips everything drawn behind it, which would
   * hide the two shafts this whole figure exists to show inside it.
   *
   * Double-sided and lightly transparent, because the two bars that matter are the ones
   * seen through it. A plane you cannot see past hides the whole argument.
   */
  const spanX = rows.length * PITCH + 1.4;
  const spanZ = 3.2;
  const slabGeo = new THREE.BoxGeometry(spanX, 0.07, spanZ);
  const glass = new THREE.Mesh(slabGeo, new THREE.MeshPhysicalMaterial({
    color: paperC, roughness: 0.04, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02,
    emissive: liftC, emissiveIntensity: 0.06,
    transparent: true, opacity: 0.17, depthWrite: false,
    side: THREE.DoubleSide,
  }));
  glass.position.y = planeY;
  glass.renderOrder = 2;
  group.add(glass);

  // Every edge of the slab in one draw call, so the sheet has a thickness you can see
  // head-on and an outline that survives being looked at edge-on.
  const rimLines = new THREE.LineSegments(
    new THREE.EdgesGeometry(slabGeo),
    new THREE.LineBasicMaterial({ color: markC, transparent: true, opacity: 0.65 }),
  );
  rimLines.position.y = planeY;
  rimLines.renderOrder = 3;
  group.add(rimLines);

  // The light the sheet gives off, as a soft disc under it. Normal blending, not additive:
  // on a near-white page an additive glow is a wash, and this needs to read as a tint.
  const disc = discTexture(THREE, [[0, 0.55], [0.5, 0.24], [1, 0]]);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: disc, color: markC, transparent: true, opacity: 0.3, depthWrite: false,
  }));
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, planeY - 0.06, 0);
  glow.scale.set(spanX * 0.95, spanZ * 1.5, 1);
  glow.renderOrder = 1;
  group.add(glow);

  // And the floor the bars stand on, so the space reads as a room rather than as nine
  // rectangles hanging in nothing.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: disc, color: inkC, transparent: true, opacity: 0.26, depthWrite: false,
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-0.3, -0.004, 0.4);
  floor.scale.set(spanX * 1.25, spanZ * 2.1, 1);
  floor.renderOrder = -1;
  group.add(floor);

  stage.replaceChildren(renderer.domElement);

  let autoSpin = REDUCED ? 0 : 0.0012;
  dragToTurn(stage, group, () => { autoSpin = 0; }, () => fit());

  /* Framed on the bars and the sheet, not on the floor disc, which is more than twice the
   * depth of the thing it sits under. */
  const framed = [glass, ...group.children.filter((o) => o.geometry
    && o.geometry.type === 'BoxGeometry' && o !== glass)];
  const fit = framer(THREE, camera, group, framed, { x: 0, y: 0.68, z: 0.78 });
  const resize = () => {
    const w = stage.clientWidth || W;
    const h = Math.round(Math.min(620, Math.max(300, w * 0.86)));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fit();
  };
  addEventListener('resize', resize);
  resize();

  group.rotation.y = -0.34;
  const clock = new THREE.Clock();
  let elapsed = 0;
  // The shafts that fit are already up. Then what goes through the plane, then the marks
  // on it, then the sheet and its rim, then the ground and the light it throws.
  const waves = inWaves(shafts, marks, [glass, rimLines], [glow, floor]);
  const drawable = whileOnScreen(stage);
  const draw = () => {
    if (!drawable()) { requestAnimationFrame(draw); clock.getDelta(); return; }
    elapsed += Math.min(clock.getDelta(), 0.1);
    if (!REDUCED) {
      group.rotation.y += autoSpin;
      // The markers hang and turn. Under reduced motion they are placed once and left,
      // which loses nothing: they are marks, and a mark does not have to move to be one.
      for (const w of warnings) {
        w.mesh.position.y = w.base + Math.sin(elapsed * 1.6 + w.phase) * 0.09;
        w.mesh.rotation.y = elapsed * 0.6 + w.phase;
      }
      flag.emissiveIntensity = 0.3 + 0.16 * (0.5 + 0.5 * Math.sin(elapsed * 2.4));
    }
    renderer.render(scene, camera);
    if (waves.length) waves.shift()();
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);

  window.__cutoff = {
    bars: rows.length,
    over: overCount,
    fits: fitsAt || null,
    reduced: REDUCED,
    // How many marks are pinned to the plane, and where the plane sits in scene units, so
    // a headless run can check the bars that cross it were split at the right height.
    marks: marks.length,
    planeY: +planeY.toFixed(3),
    turn: () => +group.rotation.y.toFixed(4),
    pitch: () => +group.rotation.x.toFixed(4),
    pitchRange: [PITCH_MIN, PITCH_MAX],
    // Renders on the spot. The loop above skips frames while the board is off
    // screen, and every tool that poses this board photographs it immediately
    // afterwards, so a pose that only set the rotation would be photographed one
    // frame too early or not at all.
    pose: (() => {
      const set = poseSetter(group, fit);
      return (turn, pitch) => { set(turn, pitch); renderer.render(scene, camera); };
    })(),
    calls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
    probe: () => litPixels(renderer, scene, camera),
  };
}

async function boot() {
  if (!hasWebGL()) return;
  let THREE;
  try {
    THREE = await import(/* @vite-ignore */ CDN);
  } catch (e) {
    return;                      // both drawings are already correct in the markup
  }
  await mount(THREE);
  /* A whole task between the two mounts, and it has to be a task.
   *
   * `mount` is declared async and contains no await, so it runs straight through and
   * `await mount(...)` settles inside the same task. Both scenes were therefore built,
   * wired and framed in one go, which on `the-morning.html` -- the only page carrying both
   * -- left a task sitting on the 50ms ceiling a browser gate enforces. A page one slow
   * machine away from failing, with nothing in the code saying why.
   *
   * Three versions, eight loads of that page each, worst task per load, on this machine:
   *
   *   no yield at all           231, 51, 0, 0, 50, 0, 0, 0     2 loads over
   *   yield to requestAnimationFrame  168, 53, 55, 50, 50, 53, 57, 50   5 loads over
   *   yield to setTimeout       151, 0, 0, 0, 0, 0, 0, 0       1 load over
   *
   * The frame yield is the worst of the three, and that is the part worth knowing. A
   * callback scheduled with `requestAnimationFrame` runs in the same callback batch as
   * every other one due that frame, and the frame this lands in is the one where the first
   * board renders and compiles its shaders. Yielding to it does not separate the two costs,
   * it staples the second mount to the most expensive frame the first scene has.
   *
   * A timeout is a genuinely separate task, and the remaining outlier on every variant is
   * the first load of a cold browser, which the untouched page shows too. */
  await new Promise((go) => setTimeout(go, 0));
  await mountCutoff(THREE);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
