/**
 * Tile-highlight and cursor chrome: the bordered move/attack/cast/heal tint
 * quads, the keyboard move-destination ring, and the attack-target ring.
 *
 * `hlActive` (which tiles are currently lit) is owned here now. Four other
 * modules used to read it through `highlights: () => hlActive` — turn-machine,
 * unit-actions, the page's win/lose glue, and battle-input — because
 * `clearHighlights` REPLACES the array rather than emptying it in place; they
 * now get that accessor from `tileChrome.hlActive` (still an accessor, for
 * the same reason).
 *
 * `hlGeo`/`hlMaterial` are also exported: the page's tactical-grid toggle
 * (a plain checkerboard dressing, not "chrome" in the sense this module
 * owns) reuses the same quad geometry and bordered-material factory rather
 * than duplicating them.
 */
export function createTileChrome({
  THREE, world, tileTop, uiCss, uiCol, makeTex, uiChrome,
  // clearHighlights() also resets two pieces of page-owned hover state: the
  // combat forecast panel (constructed well below this module) and the raw
  // hover-tile tracker the pointermove handler keeps. Forward references,
  // same shape as `ability: key => abilities.get(key)` elsewhere on the page.
  hideForecast, resetHover,
}) {
  for (const [name, value] of Object.entries({
    THREE, world, tileTop, uiCss, uiCol, makeTex, uiChrome, hideForecast, resetHover,
  })) {
    if (value === undefined || value === null)
      throw new Error(`tile-chrome: missing context "${name}"`);
  }

  // bordered quads: a plain tint disappears against snow and the frozen pond
  const hlGeo = new THREE.PlaneGeometry(0.98, 0.98).rotateX(-Math.PI / 2);
  function hlMaterial(fill, edge) {
    const tex = makeTex((ctx, s) => {
      ctx.clearRect(0, 0, s, s);
      ctx.fillStyle = fill; ctx.fillRect(0, 0, s, s);
      ctx.strokeStyle = edge; ctx.lineWidth = s * 0.09;
      ctx.strokeRect(s * 0.045, s * 0.045, s * 0.91, s * 0.91);
    }, 64);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false,
      fog: false, toneMapped: false,
      polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
  }
  const hlMat = {
    // Saturated blue with a dark keyline: pale cyan disappeared into snow.
    move: hlMaterial(uiCss(0x167bd8, 0.58), uiCss(0x073f91, 1.0)),
    // A reachable square some enemy could also hit (rules.dangerTiles). Built
    // like `move` rather than like `cast` — same saturation, same near-black
    // keyline — because these two are read AGAINST EACH OTHER across one
    // highlight set, and the player has to sort them at a glance while the
    // camera is at any angle over snow. `cast`'s pale lavender is a different
    // job (it marks what an ability may be pointed at) and the two never share
    // a screen: casting highlights belong to ability mode, danger to Move.
    danger: hlMaterial(uiCss(0x8a2be2, 0.58), uiCss(0x3a0a72, 1.0)),
    // ACTION TARGETING IS ORANGE, SELECTION IS RED (Jonah, 2026-08-09,
    // superseding the 2026-08-05 yellow-green/orange scheme). The eligible
    // field takes the deepened amber that used to mark selection —
    // #cc8041/#b87040, held from the earlier swatch work — and the pointed-at
    // square escalates to a frank red, well outside the amber family so it
    // pops from any size of orange field. Red here never shares a job with the
    // enemy identity tint: bars are chrome above the figure, this is ground.
    //
    // One palette for every action — attack, a pointed ability, a heal — because
    // the old blue/orange/lavender/green set asked the player to learn four
    // colours for one question ("can I aim here?"). The answer is now always the
    // same colour, and which ACTION is being aimed is what the action bar and
    // the forecast already say.
    attack: hlMaterial(uiCss(0xcc8041, 0.30), uiCss(0xb87040, 0.98)),
    cast: hlMaterial(uiCss(0xcc8041, 0.30), uiCss(0xb87040, 0.98)),
    heal: hlMaterial(uiCss(0xcc8041, 0.30), uiCss(0xb87040, 0.98)),
    // the square the command is actually pointed at
    selected: hlMaterial(uiCss(0xd0342c, 0.62), uiCss(0x8f1a12, 1.0)),
  };
  const hlPool = [];
  let hlActive = [];
  // The IDLE REACH PREVIEW (Jonah, 2026-08-17, revised same day): at turn
  // start, before any command is picked, the acting unit's reachable squares
  // show THE FULL MOVE GRID — the same filled blue, and the same danger
  // purple where rules.dangerTiles marks a threatened square. Triangle
  // Strategy's convention, at Jonah's direction: the range is a fact of the
  // turn, not a reward for pressing Move (a first version drew outline-only
  // and he corrected it — the fill IS the language of motion). Sharing
  // `hlMat` means it also shares the breathing wobble, which is right now
  // that idle and Move mode are one visual voice. Its own pool and its own
  // show/clear, NOT part of `hlActive`: mode highlights are cleared and
  // rebuilt by every mode change, while this layer belongs to the frame loop
  // (battle-scene's pulse block), which redraws it whenever the board or the
  // turn actually changed.
  const idlePool = [];
  let idleActive = [];
  // The ORIGIN RING (Jonah, 2026-08-17): after a move commits but before it
  // is confirmed by an action — the window where Undo can still take it
  // back — the grid stays up and the square the unit CAME FROM wears the
  // gold boundary ring. Same geometry and colour as the keyboard
  // destination cursor, because it is the same sentence with the tense
  // flipped: that cursor says "you would stand here", this ring says "you
  // stood here, and Undo returns you". A separate mesh rather than a reuse
  // of moveCursorMesh: that one belongs to Move mode's cursor machinery and
  // is set/cleared by it, while this one belongs to the frame-loop layer.
  const idleOriginMesh = new THREE.Mesh(
    new THREE.RingGeometry(0.6223, 0.7071, 4),
    new THREE.MeshBasicMaterial({
      color: uiCol(0xffe08a), transparent: true, opacity: 0.98,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  idleOriginMesh.rotation.x = -Math.PI / 2;
  idleOriginMesh.rotation.z = Math.PI / 4;
  idleOriginMesh.renderOrder = 944;        // just under the mode cursors
  idleOriginMesh.visible = false;
  idleOriginMesh.raycast = () => {};
  world.add(idleOriginMesh);
  uiChrome(idleOriginMesh);
  let idleOriginTile = null;
  function clearIdleReach() {
    for (const m of idleActive) m.visible = false;
    idleActive = [];
    idleOriginTile = null;
    idleOriginMesh.visible = false;
  }
  function showIdleReach(tiles, origin = null) {
    clearIdleReach();
    for (const t of tiles) {
      let m = idlePool.find(q => !q.visible);
      if (!m) {
        m = new THREE.Mesh(hlGeo, hlMat.move);
        m.renderOrder = 4;                 // under the mode highlights' 5
        m.raycast = () => {};              // chrome is never a click target
        world.add(m);
        idlePool.push(m);
      }
      m.material = hlMat[t.kind || 'move'] || hlMat.move;
      // 0.012: under the mode highlights' 0.015, so the brief overlap during
      // a same-frame handoff cannot z-fight.
      m.position.set(t.x + 0.5, tileTop[t.z][t.x] + 0.012, t.z + 0.5);
      m.visible = true;
      idleActive.push(m);
    }
    if (origin) {
      idleOriginTile = { x: origin.x, z: origin.z };
      idleOriginMesh.position.set(
        origin.x + 0.5, tileTop[origin.z][origin.x] + 0.045, origin.z + 0.5);
      idleOriginMesh.visible = true;
    }
  }
  // Keyboard destination cursor for the tile-based combat Move command. It is
  // separate from the active-unit marker so origin and destination remain legible.
  // GROUND CHROME IS DEPTH-TESTED, both cursors included (Jonah, 2026-08-05:
  // "highlighted squares render above characters at some camera angles"). A
  // mark on the floor belongs to the floor: the figure standing on that square
  // has to occlude the half of it that lies behind them, at every azimuth the
  // Q/E steps reach. `depthTest: false` is what broke that — it was harmless
  // while these were thin outlines and became loud the moment the selected
  // square became a FILL (2f4a8fe), which then painted over the target's legs
  // at every angle. depthWrite stays off: chrome must not occlude anything
  // itself, it must only be occluded.
  const moveCursorMesh = new THREE.Mesh(
    // A 4-segment ring rotated 45deg is an axis-aligned square whose RADIUS
    // runs to the CORNERS — so the tile's own boundary (half-width 0.5) sits
    // at radius 0.5*sqrt(2) ~= 0.7071. The old 0.31..0.47 drew the outline at
    // two-thirds scale, floating inside the square (Jonah, 2026-08-06: "it
    // should literally be the boundary"). Outer edge = the tile edge; the band
    // reads ~0.06 world units thick, inward.
    new THREE.RingGeometry(0.6223, 0.7071, 4),
    new THREE.MeshBasicMaterial({
      color: uiCol(0xffe08a), transparent: true, opacity: 0.98,
      depthWrite: false, side: THREE.DoubleSide,
    }),
  );
  moveCursorMesh.rotation.x = -Math.PI / 2;
  moveCursorMesh.rotation.z = Math.PI / 4;
  moveCursorMesh.renderOrder = 945;
  moveCursorMesh.visible = false;
  moveCursorMesh.raycast = () => {};
  world.add(moveCursorMesh);
  uiChrome(moveCursorMesh);
  let moveTarget = null;
  function clearMoveCursor() { moveTarget = null; moveCursorMesh.visible = false; }
  function setMoveCursor(x, z, visible = true) {
    moveTarget = { x, z };
    moveCursorMesh.position.set(x + 0.5, tileTop[z][x] + 0.045, z + 0.5);
    moveCursorMesh.visible = visible;
  }
  // The selected-target cursor: a FILLED orange square on the target's own tile,
  // the way the reference shot marks the square under the monk. It used to be a
  // yellow outline ring, which is the clash Jonah first spotted — and an
  // outline could not say "this square" as plainly as a fill does against the
  // yellow-green eligible set it sits inside.
  const attackCursorMesh = new THREE.Mesh(
    hlGeo,
    new THREE.MeshBasicMaterial({
      map: hlMat.selected.map, transparent: true, opacity: 1,
      depthWrite: false, side: THREE.DoubleSide,          // depth-tested: see moveCursorMesh
    }),
  );
  // hlGeo is already laid flat in the tile plane, so no rotation of its own
  attackCursorMesh.renderOrder = 946;
  attackCursorMesh.visible = false;
  attackCursorMesh.raycast = () => {};
  world.add(attackCursorMesh);
  uiChrome(attackCursorMesh);
  let attackCursorUnit = null;
  function clearAttackCursor() {
    attackCursorUnit = null;
    attackCursorMesh.visible = false;
  }
  function setAttackCursor(unit) {
    attackCursorUnit = unit;
    attackCursorMesh.position.set(
      unit.group.position.x, unit.group.position.y + 0.055, unit.group.position.z);
    attackCursorMesh.visible = true;
  }
  function clearHighlights() {
    for (const m of hlActive) m.visible = false;
    hlActive = [];
    clearMoveCursor();
    clearAttackCursor();
    hideForecast();
    resetHover();
  }
  /**
   * Light a set of tiles. `kind` is the default; a tile may carry its own
   * `kind` to override it, which is what lets one Move highlight paint safe
   * squares blue and threatened ones purple in a single pass rather than as two
   * overlapping sets that would z-fight.
   */
  function showHighlights(tiles, kind) {
    clearHighlights();
    for (const t of tiles) {
      let m = hlPool.find(q => !q.visible);
      if (!m) { m = new THREE.Mesh(hlGeo, hlMat.move); m.renderOrder = 5; world.add(m); hlPool.push(m); }
      m.material = hlMat[t.kind || kind] || hlMat[kind];
      m.position.set(t.x + 0.5, tileTop[t.z][t.x] + 0.015, t.z + 0.5);
      m.userData.tile = { x: t.x, z: t.z };
      m.visible = true;
      hlActive.push(m);
    }
  }

  return {
    showHighlights, clearHighlights,
    showIdleReach, clearIdleReach,
    idleActive: () => idleActive,         // same accessor contract as hlActive
    idleOrigin: () => idleOriginTile,     // ring tile during the undo window
    setMoveCursor, clearMoveCursor, setAttackCursor, clearAttackCursor,
    hlActive: () => hlActive,             // clearHighlights REPLACES the array
    moveTarget: () => moveTarget,
    attackCursorUnit: () => attackCursorUnit,
    hlMat,                                // raw material dict: per-frame wobble + uiMaterials() hook
    hlGeo, hlMaterial,                    // shared with the page's tactical-grid toggle
    // the two cursor meshes themselves, so `uiMaterials()` can report their
    // depth state and a gate can hold the "figures occlude ground chrome" rule
    cursorMeshes: [moveCursorMesh, attackCursorMesh],
  };
}
