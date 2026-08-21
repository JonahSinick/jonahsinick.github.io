/**
 * The red arcs that answer "who, exactly?" about a danger tile.
 *
 * Shading tells the player a square is threatened; it cannot tell them by whom,
 * and "threatened by the archer I am about to walk behind" and "threatened by
 * three of them at once" are completely different moves. Hovering a threatened
 * square in Move mode draws one arc per threatening enemy, from that enemy to
 * the square (reference: FF_tactics_images/combat_turn-order.jpg).
 *
 * Curves rather than straight lines, and drawn OVER everything: a line at
 * ground level between two figures on a terraced ravine spends most of its
 * length inside a cliff, and a threat indicator the terrain can swallow is
 * worse than none. Depth testing is off for the same reason the active-unit
 * caret's is.
 *
 * The meshes pool but their geometries do NOT: a TubeGeometry bakes its curve
 * at construction, so a moved arc is a new geometry and the old one has to be
 * given back. Every path out of this module goes through `clear()`.
 */
export function createThreatArcs({
  THREE, world, uiChrome, uiCol,
  // (x, z) -> the world point an arc should touch down on, tile top included
  tileAnchor,
  // how high the arc bows above the straight line between its ends
  lift = 0.55,
}) {
  for (const [name, value] of Object.entries({
    THREE, world, uiChrome, uiCol, tileAnchor,
  })) {
    if (value === undefined || value === null)
      throw new Error(`threat-arcs: missing context "${name}"`);
  }

  // Jonah, playtest 2026-08-02: the arcs read too solid. They are a warning
  // laid over the board, not an object on it, so they want to be light red
  // streaks (the Triangle Strategy reference) rather than red pipes.
  //
  // 0.42 alpha with NORMAL blending, not additive. Additive was the obvious
  // reach for "airy" and it is wrong here for a reason worth writing down:
  // Battle 1 is a snowfield, and additive blending over near-white terrain
  // washes toward white — the arcs would fade out over exactly the bright
  // ground they most need to cross, and only look right in the dark mine.
  // Normal blending keeps them red on both maps.
  const ARC_COLOR = 0xff3b30;
  const ARC_OPACITY = 0.42;
  const material = new THREE.MeshBasicMaterial({
    color: uiCol(ARC_COLOR),
    transparent: true,
    opacity: ARC_OPACITY,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  // one shared cone geometry: the head only ever changes position and rotation
  const headGeo = new THREE.ConeGeometry(0.11, 0.26, 8);
  const pool = [];
  const active = [];
  let hovered = null;                      // the tile the current arcs point at

  function take() {
    let arc = pool.find(a => !a.group.visible);
    if (!arc) {
      const group = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.BufferGeometry(), material);
      const head = new THREE.Mesh(headGeo, material);
      tube.renderOrder = head.renderOrder = 948;
      tube.raycast = head.raycast = () => {};   // display only, never intercepts picking
      group.add(tube, head);
      uiChrome(group);
      world.add(group);
      arc = { group, tube, head };
      pool.push(arc);
    }
    arc.group.visible = true;
    active.push(arc);
    return arc;
  }

  /**
   * Draw arcs from each threatening unit to the tile under the cursor.
   * Re-hovering the same tile is a no-op, so this is safe to call from a
   * pointermove handler that fires every frame the mouse drifts.
   */
  function show(threats, tile) {
    if (hovered && tile && hovered.x === tile.x && hovered.z === tile.z) return active.length;
    clear();
    if (!tile || !threats || !threats.length) return 0;
    hovered = { x: tile.x, z: tile.z };
    const to = tileAnchor(tile.x, tile.z).add(new THREE.Vector3(0, 0.22, 0));
    for (const unit of threats) {
      if (!unit || !unit.group) continue;
      const from = unit.group.position.clone().add(new THREE.Vector3(0, unit.topY * 0.55, 0));
      const mid = from.clone().lerp(to, 0.5);
      mid.y += lift + from.distanceTo(to) * 0.16;
      const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
      const arc = take();
      arc.tube.geometry.dispose();
      arc.tube.geometry = new THREE.TubeGeometry(curve, 24, 0.042, 6, false);
      // the head sits just short of the tile, pointing the way the curve is
      // travelling when it lands, so the arc reads as aimed rather than drawn
      const tip = curve.getPointAt(0.93);
      arc.head.position.copy(tip);
      arc.head.lookAt(to);
      arc.head.rotateX(Math.PI / 2);
    }
    return active.length;
  }

  /** Put every arc away and give its baked geometry back. */
  function clear() {
    for (const arc of active) {
      arc.group.visible = false;
      arc.tube.geometry.dispose();
      arc.tube.geometry = new THREE.BufferGeometry();
    }
    active.length = 0;
    hovered = null;
  }

  return {
    show, clear,
    /** for __BATTLE.threatArcs(): what is on screen, not what was asked for */
    state: () => ({
      tile: hovered ? { ...hovered } : null,
      count: active.length,
      color: material.color.getHexString(),
    }),
    material,          // read by __BATTLE.uiMaterials()
  };
}
