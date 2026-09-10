/* The morning board, as a scene you can turn.
 *
 * This module is an upgrade and never a requirement. The board is already in the markup
 * as a flat isometric drawing, correct and labelled, before this file is fetched. Three
 * separate things have to go right for the scene to replace it: the module has to arrive
 * from the CDN, the driver has to give up a WebGL context, and the reader must not have
 * asked for reduced motion in a way that makes a turning object unwelcome. When any of
 * them does not hold, the drawing stays and the page loses nothing it was making an
 * argument with. The `cdn loss` gate aborts these requests on purpose and then checks the
 * page still renders, so this path is exercised rather than assumed.
 *
 * There is no orbit-controls dependency. Rotation about the vertical axis is the only
 * movement worth having here and it is four lines of pointer arithmetic; pulling a second
 * module across a network for it would trade the whole fallback story for a convenience.
 *
 * Note for anyone verifying this on the build machine: headless Chromium here cannot
 * composite WebGL, so a screenshot of the canvas comes back blank even when the scene is
 * correct. Check `renderer.info.render.calls` and a `gl.readPixels` sample instead. The
 * scene reports both on `window.__morning` for exactly that reason.
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

/* The two inks the rest of the page is drawn in, read off the document rather than
 * repeated here. A palette copied into a script is a second source of truth for a colour
 * and it drifts the first time the stylesheet is edited. */
function ink(name, fallback) {
  /* Resolved through the browser rather than read straight off the custom property.
   * This page's palette is written in `oklch()`, and `THREE.Color` does not parse that
   * colour space: handed the raw string it fails silently and leaves the material white.
   * Both materials went white, which on a near-white ground is a board that renders
   * perfectly and cannot be seen. Setting the colour on a throwaway element and reading
   * `getComputedStyle().color` back gets an `rgb()` triple out of the browser's own
   * conversion, which is the one that matches what the rest of the page is painted in. */
  const probe = document.createElement('span');
  probe.style.cssText = `position:absolute;visibility:hidden;color:var(${name})`;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return /^rgb/.test(resolved) ? resolved : fallback;
}

async function mount(THREE) {
  const stage = document.querySelector('[data-mrn-stage]');
  const board = document.querySelector('.morning');
  if (!stage || !board) return;

  const count = Number(board.dataset.mrnCount || 0);
  const cols = Number(board.dataset.mrnCols || 8);
  const openAt = Number(board.dataset.mrnOpen || 0);
  if (!count || !cols) return;
  const rows = Math.ceil(count / cols);

  const W = stage.clientWidth || 720;
  const H = Math.round(Math.min(460, Math.max(300, W * 0.52)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, W / H, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8378, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(6, 14, 8);
  scene.add(key);

  const paper = new THREE.Color(ink('--ink', '#1a1815'));
  const brand = new THREE.Color(ink('--brand', '#e8c34a'));

  const group = new THREE.Group();
  scene.add(group);

  /* Every closed case is the same tile. That sameness is the argument the page is making
   * and it is also why one instanced mesh is the right primitive: there is genuinely only
   * one object here, drawn `count - 1` times. */
  const PITCH = 1.55;
  const tile = new THREE.BoxGeometry(1.25, 0.18, 1.25);
  /* 0.22 read as almost nothing: the field has to be legible as forty separate things
   * before the one that is different can mean anything. */
  const flat = new THREE.MeshStandardMaterial({
    color: paper, roughness: 0.85, metalness: 0.0, transparent: true, opacity: 0.55,
  });
  const tiles = new THREE.InstancedMesh(tile, flat, count - 1);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === openAt) continue;
    const c = i % cols;
    const r = Math.floor(i / cols);
    m.makeTranslation((c - (cols - 1) / 2) * PITCH, 0, (r - (rows - 1) / 2) * PITCH);
    tiles.setMatrixAt(n, m);
    n += 1;
  }
  tiles.instanceMatrix.needsUpdate = true;
  group.add(tiles);

  const oc = openAt % cols;
  const or = Math.floor(openAt / cols);
  const column = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 3.4, 1.25),
    new THREE.MeshStandardMaterial({ color: brand, roughness: 0.42, metalness: 0.05 }),
  );
  column.position.set((oc - (cols - 1) / 2) * PITCH, 1.7, (or - (rows - 1) / 2) * PITCH);
  group.add(column);

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

  /* Drag to turn, and that is the whole interaction. Pointer events rather than mouse
   * events so a touch drag works, and the pointer is captured so leaving the canvas
   * mid-drag does not strand the board halfway round. */
  let dragging = false;
  let lastX = 0;
  let spin = REDUCED ? 0 : 0.0016;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; spin = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    group.rotation.y += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  const release = (e) => {
    dragging = false;
    if (e.pointerId !== undefined && stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId);
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  /* Framed off the group's own bounding sphere rather than off three numbers that looked
   * right once at one width. A board of forty-one tiles has a height as well as a width
   * and the column is taller than either, so a camera placed by eye either crops the
   * column or leaves the board a postage stamp in the middle of the frame. Fitting both
   * axes and taking the larger distance is the only version that holds when the grid
   * changes shape, and the grid is derived from a cited absence rate, so it will. */
  const fit = () => {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    const vFov = (camera.fov * Math.PI) / 180;
    // The board turns, so the horizontal extent it can present is the diagonal of its
    // footprint, not its width. Framing the width alone crops it a quarter-turn later.
    const spread = Math.hypot(size.x, size.z);
    const forHeight = size.y / 2 / Math.tan(vFov / 2);
    const forWidth = spread / 2 / Math.tan(vFov / 2) / camera.aspect;
    const dist = Math.max(forHeight, forWidth) * 1.06;
    camera.position.set(mid.x, mid.y + dist * 0.62, mid.z + dist * 0.86);
    camera.lookAt(mid.x, mid.y, mid.z);
    camera.updateProjectionMatrix();
  };

  const resize = () => {
    const w = stage.clientWidth || W;
    const h = Math.round(Math.min(460, Math.max(300, w * 0.52)));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fit();
  };
  addEventListener('resize', resize);
  resize();

  group.rotation.y = -0.5;
  const draw = () => {
    group.rotation.y += spin;
    renderer.render(scene, camera);
    requestAnimationFrame(draw);
  };
  draw();

  /* Published for verification, because a screenshot cannot check this on the machine it
   * was built on. `calls` is non-zero only if something was actually rasterised. */
  window.__morning = {
    calls: () => renderer.info.render.calls,
    triangles: () => renderer.info.render.triangles,
    /* Renders and then reads, in one tick, and that ordering is the whole point of the
     * function. A WebGL drawing buffer is cleared when the frame is presented, so a
     * `readPixels` called from anywhere outside the draw returns a buffer of zeroes and
     * reports a blank canvas for a scene that is rendering perfectly well. That reading
     * is indistinguishable from the real failure it would be used to look for. */
    probe: () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit += 1;
      return { width: w, height: h, lit, pct: +((100 * lit) / (w * h)).toFixed(1) };
    },
  };
}

/* The second board: minutes to finish at each concurrency setting, against the cutoff.
 *
 * Every number is read off the markup, which the build wrote by calling
 * `tools/throughput.py`. Nothing is computed here, so the scene cannot say something the
 * tool does not. The plane is the point of drawing it at all: a bar that goes through a
 * surface reads as a morning that did not finish, where the same bar past a dashed line
 * reads as a slightly larger number.
 */
async function mountCutoff(THREE) {
  const stage = document.querySelector('[data-cut-stage]');
  const board = document.querySelector('.cutoff');
  if (!stage || !board) return;

  const rows = (board.dataset.cutRows || '').split(',').filter(Boolean).map((p) => {
    const [c, m] = p.split(':');
    return { c: Number(c), m: Number(m) };
  });
  const cutoff = Number(board.dataset.cutLine || 0);
  if (!rows.length || !cutoff) return;

  const W = stage.clientWidth || 720;
  const H = Math.round(Math.min(420, Math.max(280, W * 0.5)));

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, W / H, 0.1, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8378, 2.0));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(8, 18, 10);
  scene.add(key);

  const inkC = new THREE.Color(ink('--ink', '#1a1815'));
  const brandC = new THREE.Color(ink('--brand', '#e8c34a'));

  const group = new THREE.Group();
  scene.add(group);

  /* Scaled so the tallest bar is a fixed height in the scene. The tallest bar is the
   * default setting and it is the one the page is about, so it must not be the one that
   * leaves the frame. */
  const tallest = Math.max(...rows.map((r) => r.m));
  const UNIT = 8 / tallest;
  const PITCH = 1.5;
  const mid = ((rows.length - 1) * PITCH) / 2;

  rows.forEach((r, i) => {
    const h = r.m * UNIT;
    const over = r.m > cutoff;
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, h, 0.85),
      new THREE.MeshStandardMaterial({
        color: over ? brandC : inkC,
        roughness: over ? 0.42 : 0.85,
        transparent: !over,
        opacity: over ? 1 : 0.42,
      }),
    );
    bar.position.set(i * PITCH - mid, h / 2, 0);
    group.add(bar);
  });

  /* Double-sided and lightly transparent, because the two bars that matter are the ones
   * seen through it. A plane you cannot see past hides the whole argument. */
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(rows.length * PITCH + 1.4, 3.2),
    new THREE.MeshBasicMaterial({
      color: inkC, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
    }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = cutoff * UNIT;
  group.add(plane);

  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(rows.length * PITCH + 1.4, 0.035, 0.035),
    new THREE.MeshBasicMaterial({ color: inkC, transparent: true, opacity: 0.55 }),
  );
  edge.position.set(0, cutoff * UNIT, -1.6);
  group.add(edge);

  stage.replaceChildren(renderer.domElement);

  let dragging = false;
  let lastX = 0;
  let spin = REDUCED ? 0 : 0.0012;
  stage.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; spin = 0;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    group.rotation.y += (e.clientX - lastX) * 0.008;
    lastX = e.clientX;
  });
  const release = (e) => {
    dragging = false;
    if (e.pointerId !== undefined && stage.hasPointerCapture(e.pointerId)) {
      stage.releasePointerCapture(e.pointerId);
    }
  };
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  const fit = () => {
    const box = new THREE.Box3().setFromObject(group);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const vFov = (camera.fov * Math.PI) / 180;
    const spread = Math.hypot(size.x, size.z);
    const dist = Math.max(size.y / 2 / Math.tan(vFov / 2),
                          spread / 2 / Math.tan(vFov / 2) / camera.aspect) * 1.12;
    camera.position.set(c.x, c.y + dist * 0.42, c.z + dist * 0.92);
    camera.lookAt(c.x, c.y, c.z);
    camera.updateProjectionMatrix();
  };
  const resize = () => {
    const w = stage.clientWidth || W;
    const h = Math.round(Math.min(420, Math.max(280, w * 0.5)));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    fit();
  };
  addEventListener('resize', resize);
  resize();

  group.rotation.y = -0.34;
  const draw = () => {
    group.rotation.y += spin;
    renderer.render(scene, camera);
    requestAnimationFrame(draw);
  };
  draw();

  window.__cutoff = {
    bars: rows.length,
    calls: () => renderer.info.render.calls,
    probe: () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 8) lit += 1;
      return { lit, pct: +((100 * lit) / (w * h)).toFixed(1) };
    },
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
  await mountCutoff(THREE);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
