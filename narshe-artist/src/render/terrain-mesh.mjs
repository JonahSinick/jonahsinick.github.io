/**
 * Builds Battle 1's walkable terrain from the inline `H`/`T`/`S` grids (height,
 * tile type, stair rise/run) plus the display plinth and the faint tactical
 * grid line overlay drawn over every walkable tile. Returns `tileTop` (the
 * world-space Y of each tile's walkable surface — read pervasively downstream
 * for camera placement, unit footing, and pathing) and `tileMeshes` (the
 * pickable tile-top meshes, each tagged with `userData.tile`).
 *
 * `box` arrives as injected context rather than being redefined here: it is
 * the same page-owned primitive already handed to `battle1-scenery.mjs`,
 * `cliffs-opening.mjs`, `mine-finale.mjs`, and `terrain-kit.mjs`, so a change
 * to how a box mesh is built (shadow defaults, the `group` override) only
 * has one definition to find.
 *
 * This is Battle 1's own terrain (the `H`/`T`/`S` grids); the warning-bell
 * gallery uses the separate, content-driven `src/render/terrain-kit.mjs`
 * boundary instead — the two do not share a renderer.
 *
 * `topThick` (the walkable top slab's thickness) arrives as injected context
 * rather than being declared here: several other page modules (the mine
 * finale, the terrain-kit boundary, `layoutOverhead`) read the same constant,
 * so the page keeps owning it.
 *
 * THE PALETTE EXTENSION (`extraTops`, `columnMat`, `rockCapMat`, `rockJitter`)
 * is how a third battle gets its own ground without a second copy of this loop.
 * The tile-type enum is the page's, so a battle may declare types beyond the
 * five built in here and hand over the material each one wears; `columnMat`
 * re-skins the rock column every tile stands on, `rockCapMat` replaces the
 * snow-dusting that makes an unwalkable ROCK tile read as a Narshe crag, and
 * `rockJitter` is how much an unwalkable tile's top wanders — 0.22 of a unit is
 * what makes a crag ragged, and exactly what makes a CASTLE WALL look like it
 * was built by someone who could not find a level. A masonry battle passes 0.
 * All four default to main's values, so the two shipped battles pass none of
 * them and build byte-identical geometry.
 */
export function createTerrainMesh({
  THREE, world, box, mat, HU, TILE, W, D, T, S, H,
  ROCK, SNOW, PATH, ICE, WOOD, STAIR, hash, topThick,
  extraTops = null, columnMat = null, rockCapMat = null, rockJitter = 0.22,
}) {
  for (const [name, value] of Object.entries({
    THREE, world, box, mat, HU, TILE, W, D, T, S, H,
    ROCK, SNOW, PATH, ICE, WOOD, STAIR, hash, topThick,
  })) {
    if (value === undefined || value === null)
      throw new Error(`terrain-mesh: missing context "${name}"`);
  }

  // ---------------------------------------------------------------- terrain
  const column = columnMat || mat.rock;  // what every tile stands on
  const tileMeshes = [];                 // walkable tile tops, tagged with grid coords for picking
  const tileTop = [];                    // world-space y of each tile's walkable surface
  for (let z = 0; z < D; z++) tileTop.push(new Array(W).fill(0));
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
    const t = T[z][x];
    const cx = x + 0.5, cz = z + 0.5;
    if (t === STAIR) {
      const s = S[z][x];
      const yLo = s.lo * HU, yHi = s.hi * HU;
      box(TILE, yLo, TILE, column, cx, yLo / 2, cz);
      const steps = Math.max(3, (s.hi - s.lo) * 2), rise = (yHi - yLo) / steps;
      let last = null;
      for (let i = 0; i < steps; i++) {
        const frac = (i + 1) / steps;
        const w = s.dir[0] !== 0 ? TILE * frac : TILE;
        const d = s.dir[1] !== 0 ? TILE * frac : TILE;
        const ox = s.dir[0] !== 0 ? s.dir[0] * (TILE - w) / 2 : 0;
        const oz = s.dir[1] !== 0 ? s.dir[1] * (TILE - d) / 2 : 0;
        // A stair's treads take the extension's STAIR entry when there is one,
        // so a castle's steps are not paved with Narshe's road.
        last = box(w, rise, d, (extraTops && extraTops[STAIR]) || mat.path,
          cx + ox, yLo + rise * (i + 0.5), cz + oz);
      }
      tileTop[z][x] = yHi;
      last.userData.tile = { x, z };     // top step doubles as the pick target
      tileMeshes.push(last);
      continue;
    }
    const h = Math.max(H[z][x], 1) * HU;
    if (t === ROCK) {
      const jitter = hash(x, z + 200) * rockJitter;
      box(TILE, h + jitter, TILE, column, cx, (h + jitter) / 2, cz);
      const dusted = hash(x, z + 300) > 0.06;
      box(TILE * 0.98, topThick, TILE * 0.98, rockCapMat || (dusted ? mat.snow : mat.rock), cx, h + jitter + topThick / 2 - 0.001, cz);
      tileTop[z][x] = h + jitter + topThick;
    } else {
      box(TILE, h, TILE, column, cx, h / 2, cz);
      let topM;
      if (t === SNOW) topM = mat.snow;
      else if (t === PATH) topM = mat.path;
      else if (t === ICE) topM = mat.ice;
      else if (extraTops && extraTops[t]) topM = extraTops[t];
      else topM = mat.wood;
      const top = box(TILE * 0.997, topThick, TILE * 0.997, topM, cx, h + topThick / 2 - 0.001, cz);
      tileTop[z][x] = h + topThick;
      top.userData.tile = { x, z };
      tileMeshes.push(top);
    }
  }

  // display plinth
  box(W + 1.6, 0.5, D + 1.6, mat.plinth, W / 2, -0.27, D / 2);
  box(W + 2.4, 0.22, D + 2.4, mat.plinth, W / 2, -0.62, D / 2);

  // ---------------------------------------------------------------- tactical grid overlay
  {
    const verts = [];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const t = T[z][x];
      if (t === ROCK || t === STAIR) continue;
      const y = H[z][x] * HU + topThick + 0.004;
      const p = 0.03;
      const x0 = x + p, x1 = x + 1 - p, z0 = z + p, z1 = z + 1 - p;
      verts.push(x0, y, z0, x1, y, z0, x1, y, z0, x1, y, z1, x1, y, z1, x0, y, z1, x0, y, z1, x0, y, z0);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    world.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2c3450, transparent: true, opacity: 0.45 })));
  }

  return { tileTop, tileMeshes };
}
