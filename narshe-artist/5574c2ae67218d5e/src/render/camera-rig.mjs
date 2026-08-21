/**
 * The camera rig: one orbiting perspective lens and every way the game moves it.
 *
 * The lens orbits a look-at point (`center`) at a fixed elevation and distance,
 * so the only free parameters are the azimuth, the zoom, and where the centre
 * sits. Four things drive them and they must not fight:
 *
 * - the player, through the wheel, a drag, the rotate buttons and Q/E;
 * - the game, through `centerOn` when a turn begins;
 * - cutscenes, through `rotateTo`/`zoomTo`/`setAzimuth` off the 90-degree
 *   lattice the player's steps are bound to;
 * - the per-frame `step`, which advances whichever of those is in flight.
 *
 * The rule that keeps them honest is that a player input cancels the automated
 * moves rather than blending with them — `cancelMoves()` is that idiom, named,
 * because four places outside this module need it too.
 *
 * `camera` and `center` are handed out as objects rather than accessors: both
 * are stable references that half the render layer reads every frame, and
 * wrapping them would put a call in the billboard loop for nothing. The azimuth
 * IS an accessor, because it is a number that changes under its readers.
 */
export function createCameraRig({
  THREE,
  canvas,
  // the world extent the pan clamp starts with; `setBounds` follows the scene
  bounds,
  // rotate buttons; the rig owns its own controls the way battle-input owns its
  rotateCwButton, rotateCcwButton,
  viewport,
  // a pointer that never moved is a tap, and belongs to whoever is listening:
  // the dialogue card if the drag started on it, the battle otherwise. Both
  // resolve at call time — the input layer is built far below the camera.
  onTap, onDialogueTap,
  // The scene's AbortSignal. Every listener this module hangs on the WINDOW or
  // the CANVAS takes it, because both outlive the battle that added them: the
  // canvas belongs to the session and the window to the tab. Listeners on
  // chrome ELEMENTS need no signal — the session replaces that markup between
  // battles, and a listener dies with the node it was attached to.
  signal,
}) {
  for (const [name, value] of Object.entries({
    THREE, canvas, bounds, rotateCwButton, rotateCcwButton, viewport, onTap, onDialogueTap,
  })) {
    if (value === undefined || value === null)
      throw new Error(`camera-rig: missing context "${name}"`);
  }

  const ELEV = THREE.MathUtils.degToRad(37);
  const DIST = 54;
  const ROT_TIME = 0.55;
  const GLIDE_TIME = 0.45;
  /** one E turn from the original southeast view */
  const START_AZIMUTH = -Math.PI / 4;

  const center = new THREE.Vector3(bounds.width / 2, 1.8, bounds.depth / 2);
  const camera = new THREE.PerspectiveCamera(18, viewport().width / viewport().height, 1, 260);
  let azimuth = Math.PI / 4;
  let azTarget = azimuth;
  let azFrom = azimuth, azT = 1;
  // pan limits follow whichever diorama is on screen (the cliffs scene is smaller)
  let clampW = bounds.width, clampD = bounds.depth;
  let glide = null;
  let zoomAnim = null;
  let panDrag = null;                 // {sx, sy, cx, cz, moved} — set on left-button down

  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function layout() {
    const { width, height } = viewport();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  function place() {
    camera.position.set(
      center.x + DIST * Math.cos(ELEV) * Math.sin(azimuth),
      center.y + DIST * Math.sin(ELEV),
      center.z + DIST * Math.cos(ELEV) * Math.cos(azimuth));
    camera.lookAt(center.x, center.y + 0.6, center.z);
  }
  function clampCenter() {
    center.x = THREE.MathUtils.clamp(center.x, 1.5, clampW - 1.5);
    center.z = THREE.MathUtils.clamp(center.z, 2, clampD - 2);
  }
  function setBounds(width, depth) { clampW = width; clampD = depth; }

  // smooth glide of the look-at point (turn changes, C key). The opening move reuses
  // it with a much longer duration; everything else keeps the snappy default.
  function centerOn(x, z, dur = GLIDE_TIME) {
    glide = { fx: center.x, fz: center.z, tx: x + 0.5, tz: z + 0.5, t: 0, dur };
  }
  // matching tween for the zoom, which the glide never touched
  function zoomTo(to, dur) { zoomAnim = { from: camera.zoom, to, t: 0, dur }; }
  /** the player has taken the camera back: drop both automated moves */
  function cancelMoves() { glide = null; zoomAnim = null; }
  /** a click-to-path destination cancels the glide only, and keeps the zoom */
  function cancelGlide() { glide = null; }
  /** is either automated move in flight? */
  function isMoving() { return !!(glide || zoomAnim); }

  // Settles the orbit angle without a glide.
  function setAzimuth(angle) { azimuth = azTarget = azFrom = angle; azT = 1; }
  function rotate(dir) {
    azFrom = azTarget;
    azTarget += dir * Math.PI / 2;
    azT = 0;
  }
  // the same eased swing to an arbitrary angle — cutscenes are not bound to the
  // tactical 90° lattice and can put the lens where the shot wants it
  function rotateTo(az) { azFrom = azimuth; azTarget = az; azT = 0; }

  // --------------------------------------------------------------- per frame
  function step(dt) {
    if (azT < 1) {
      azT = Math.min(1, azT + dt / ROT_TIME);
      azimuth = azFrom + (azTarget - azFrom) * easeInOut(azT);
      place();
    }
    if (zoomAnim) {
      zoomAnim.t = Math.min(1, zoomAnim.t + dt / zoomAnim.dur);
      camera.zoom = zoomAnim.from + (zoomAnim.to - zoomAnim.from) * easeInOut(zoomAnim.t);
      camera.updateProjectionMatrix();
      if (zoomAnim.t >= 1) zoomAnim = null;
    }
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / glide.dur);
      const p = easeInOut(glide.t);
      center.x = glide.fx + (glide.tx - glide.fx) * p;
      center.z = glide.fz + (glide.tz - glide.fz) * p;
      clampCenter(); place();
      if (glide.t >= 1) glide = null;
    }
  }

  // ----------------------------------------------------------------- controls
  addEventListener('wheel', e => {
    zoomAnim = null;                    // the wheel takes the camera off autopilot
    camera.zoom = THREE.MathUtils.clamp(camera.zoom - e.deltaY * 0.0012, 0.7, 2.4);
    camera.updateProjectionMatrix();
  }, { passive: true, signal });

  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    panDrag = { sx: ev.clientX, sy: ev.clientY, cx: center.x, cz: center.z, moved: false, ev };
  }, { signal });
  /**
   * The dialogue card covers the screen, so it hands the camera back: a drag
   * pans the diorama, and only a click that never moved counts as "next".
   */
  function beginDialogueDrag(ev) {
    panDrag = { sx: ev.clientX, sy: ev.clientY, cx: center.x, cz: center.z, moved: false, ev, dlg: true };
  }
  /** is a drag currently panning? the hover forecast suppresses itself during one */
  function dragging() { return !!(panDrag && panDrag.moved); }

  addEventListener('pointermove', ev => {
    if (!panDrag || !(ev.buttons & 1)) return;
    const dx = ev.clientX - panDrag.sx, dy = ev.clientY - panDrag.sy;
    if (!panDrag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
    panDrag.moved = true;
    cancelMoves();                      // dragging is the player taking the camera back
    const wpp = (2 * DIST * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / camera.zoom) / viewport().height;
    const rx = Math.cos(azimuth), rz = -Math.sin(azimuth);          // screen-right on the ground
    const fx = -Math.sin(azimuth), fz = -Math.cos(azimuth);         // screen-up on the ground (away from camera)
    const gy = wpp / Math.sin(ELEV);                                // vertical drags foreshorten
    center.x = panDrag.cx - (dx * wpp * rx) + (dy * gy * fx);
    center.z = panDrag.cz - (dx * wpp * rz) + (dy * gy * fz);
    clampCenter();
    place();
  }, { signal });
  addEventListener('pointerup', ev => {
    if (!panDrag) return;
    const wasTap = !panDrag.moved && ev.button === 0;
    const downEv = panDrag.ev, fromDlg = panDrag.dlg;
    panDrag = null;
    if (!wasTap) return;                 // clicks act only when the pointer never dragged
    if (fromDlg) onDialogueTap(); else onTap(downEv);
  }, { signal });

  rotateCwButton.addEventListener('click', () => rotate(-1));
  rotateCcwButton.addEventListener('click', () => rotate(1));
  addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.key === 'q' || e.key === 'Q') rotate(1);
    if (e.key === 'e' || e.key === 'E') rotate(-1);
  }, { signal });

  layout(); place();

  return {
    camera, center, ELEV, DIST, START_AZIMUTH,
    azimuth: () => azimuth,
    /** where an in-flight orbit is heading; the debug rotate hooks report it */
    azimuthTarget: () => azTarget,
    layout, place, clampCenter, setBounds,
    centerOn, zoomTo, cancelMoves, cancelGlide, isMoving,
    setAzimuth, rotate, rotateTo,
    step, easeInOut,
    beginDialogueDrag, dragging,
  };
}
