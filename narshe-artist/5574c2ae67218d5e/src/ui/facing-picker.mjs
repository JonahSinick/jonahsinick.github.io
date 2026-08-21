/**
 * FFT's last beat of a turn: four gold chevrons on the tiles around a unit,
 * one click (or arrow key) to choose which way it ends up facing.
 *
 * Only the pointer/keyboard paths raise the picker — anything driven through
 * `__BATTLE` keeps its facing and ends the turn immediately, so the balance
 * bots never stall on it. Gold is deliberate: cyan already means "you may
 * move here" and red "you may hit this", so the facing beat needs a colour
 * of its own to pull the eye.
 *
 * The four-method surface (`active`/`close`/`pickArrow`/`keyDir`) is what
 * `src/ui/battle-input.mjs` takes as its `facing` context; `showFacingPicker`
 * and `hideFacingArrows` are handed to `src/flow/turn-machine.mjs` by name,
 * unchanged from how the page passed them before this module existed.
 */
export function createFacingPicker({
  THREE, world, tileTop, W, D, camera, canvas, flow,
  raycaster, ndc, viewport,
  makeTex, uiCss,
  azimuth, battleStartAzimuth,
  refreshButtons,
}) {
  for (const [name, value] of Object.entries({
    THREE, world, tileTop, W, D, camera, canvas, flow,
    raycaster, ndc, viewport, makeTex, uiCss,
    azimuth, battleStartAzimuth, refreshButtons,
  })) {
    if (value === undefined || value === null)
      throw new Error(`facing-picker: missing context "${name}"`);
  }

  const FACE_DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const FACE_REST = 0xd9a648, FACE_HOT = 0xffffff;   // tint over the gold chevron: rest vs hovered
  const faceArrows = [];
  {
    const tex = makeTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.lineJoin = 'round';
      ctx.beginPath();                              // chevron pointing to texture-up
      ctx.moveTo(s * 0.14, s * 0.72); ctx.lineTo(s * 0.50, s * 0.20); ctx.lineTo(s * 0.86, s * 0.72);
      ctx.lineTo(s * 0.50, s * 0.53); ctx.closePath();
      // dark keyline under a bright one, so the arrow reads on snow as well as cobble
      ctx.strokeStyle = uiCss(0x1e1404, 0.9); ctx.lineWidth = s * 0.14; ctx.stroke();
      const g = ctx.createLinearGradient(0, s * 0.18, 0, s * 0.74);
      g.addColorStop(0, uiCss(0xfff2ca, 0.97)); g.addColorStop(1, uiCss(0xffbe4a, 0.9));
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = uiCss(0xfff6d6); ctx.lineWidth = s * 0.05; ctx.stroke();
    }, 64);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    const geo = new THREE.PlaneGeometry(1.02, 1.02).rotateX(-Math.PI / 2);   // texture-up faces -z
    for (let i = 0; i < 4; i++) {
      // one material per arrow, so the hovered one can brighten on its own
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: tex, color: FACE_REST, transparent: true, opacity: 0.92,
        depthWrite: false, fog: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide,
      }));
      m.renderOrder = 7; m.visible = false;
      world.add(m); faceArrows.push(m);
    }
  }
  let facingPick = null;              // { unit, done } while the picker is up
  let faceHover = null;               // the chevron under the cursor, or null

  function showFacingPicker(u, done) {
    facingPick = { unit: u, done };
    faceHover = null;
    flow.phase = 'facing';
    refreshButtons();
    FACE_DIRS.forEach(([dx, dz], i) => {
      const m = faceArrows[i];
      const tx = u.x + dx, tz = u.z + dz;
      const inMap = tx >= 0 && tx < W && tz >= 0 && tz < D;
      // sit on the neighbouring tile's own surface where there is one, otherwise
      // hang the chevron off the unit's tile so an edge unit still gets four choices
      m.position.set(u.x + 0.5 + dx * (inMap ? 1 : 0.85),
                     (inMap ? tileTop[tz][tx] : tileTop[u.z][u.x]) + 0.035,
                     u.z + 0.5 + dz * (inMap ? 1 : 0.85));
      m.rotation.y = Math.atan2(-dx, -dz);
      m.userData.faceDir = [dx, dz];
      m.scale.setScalar(1);
      m.material.color.setHex(FACE_REST);
      m.visible = true;
    });
  }
  function hideFacingArrows() {
    facingPick = null; faceHover = null;
    canvas.style.cursor = '';
    for (const m of faceArrows) m.visible = false;
  }
  function closeFacingPicker(dir) {
    if (!facingPick) return;
    const { unit, done } = facingPick;
    hideFacingArrows();
    if (dir) unit.group.rotation.y = Math.atan2(dir[0], dir[1]);
    done();
  }
  function arrowUnder(ev) {
    const { width, height } = viewport();
    ndc.x = (ev.clientX / width) * 2 - 1;
    ndc.y = -(ev.clientY / height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.intersectObjects(faceArrows.filter(m => m.visible), false)[0] || null;
  }
  function pickFacingArrow(ev) {
    const hit = arrowUnder(ev);
    return hit ? hit.object.userData.faceDir : null;
  }
  // Screen-relative grid keys. The default -45° view maps the screen diamond as
  // Up=N, Right=E, Down=S, Left=W; each 90° camera turn rotates that mapping once.
  // Measuring from the canonical view avoids ambiguous rounding at a 45° azimuth.
  const FACE_KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    w: 'up', s: 'down', a: 'left', d: 'right',
  };
  const KEY_TURN = { up: 0, right: 1, down: 2, left: 3 };   // quarter-turns clockwise on screen
  function facingKeyDir(key) {
    const which = FACE_KEYS[key] || FACE_KEYS[String(key).toLowerCase()];
    if (!which) return null;
    const turn = Math.PI / 2;
    const q = Math.round((azimuth() - battleStartAzimuth) / turn);
    return FACE_DIRS[((KEY_TURN[which] - q) % 4 + 4) % 4];  // FACE_DIRS runs N, E, S, W
  }

  // ---- hover, called from the page's shared pointermove listener while the
  // picker is up (the same handler also drives the combat forecast hover,
  // which the page keeps) ----
  function hoverAt(ev) {
    const hit = arrowUnder(ev);
    faceHover = hit ? hit.object : null;
    canvas.style.cursor = faceHover ? 'pointer' : '';
    return !!faceHover;
  }
  // ---- per-frame breathing/hover pulse, called from the page's updateGame ----
  function pulse(t) {
    if (!facingPick) return;
    const breathe = 1 + 0.07 * Math.sin(t * 3.6);
    const wob = 0.5 + 0.5 * Math.sin(t * 3.2);
    for (const m of faceArrows) {
      const hot = m === faceHover;
      m.scale.setScalar(breathe * (hot ? 1.24 : 1));
      m.material.color.setHex(hot ? FACE_HOT : FACE_REST);
      m.material.opacity = hot ? 1 : 0.86 + 0.12 * wob;
    }
  }

  function isActive() { return !!facingPick; }
  // for __BATTLE.arrowStates()
  function arrowStates() {
    return faceArrows.filter(m => m.visible).map(m => ({
      dir: m.userData.faceDir, hot: m === faceHover,
      scale: +m.scale.x.toFixed(3), opacity: +m.material.opacity.toFixed(3),
      color: m.material.color.getHexString(),
    }));
  }
  // for __BATTLE.facingPicker()
  function state() {
    if (!facingPick) return null;
    const { width, height } = viewport();
    return {
      unit: facingPick.unit.name,
      arrows: faceArrows.filter(m => m.visible).map(m => ({
        dir: m.userData.faceDir,
        screen: (p => ({ x: (p.x + 1) / 2 * width, y: (1 - p.y) / 2 * height }))(
          m.position.clone().project(camera)),
      })),
    };
  }

  return {
    showFacingPicker, hideFacingArrows, closeFacingPicker, pickFacingArrow, facingKeyDir,
    isActive, hoverAt, pulse, arrowStates, state,
    faceArrows,   // raw mesh array, read by __BATTLE.uiMaterials()
    FACE_KEYS,    // the screen-relative key map, shared with src/modes/exploration.mjs
  };
}
