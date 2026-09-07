/**
 * Battle 3 map data — the Figaro Castle gate, seen from the desert.
 *
 * The layout is a defense of the gate itself: the keep and gatehouse close the
 * north edge, a three-tile gate passage runs through the gatehouse onto a raised
 * plateau (two elevated courtyards flanking the ramp's high landing), and the
 * ramp steps down — two, one, zero — into open desert. The southern rows are the
 * attackers' ground: they enter off the south edge, cross the sand past the
 * wrecked automaton line, and have exactly three ways up: the ramp throat
 * (three tiles wide, walled, watched from both courtyards) or one of the two
 * wall ladders onto the courtyard terraces. Everything that decides where a
 * unit may stand is here; nothing here draws anything.
 *
 * TWO HALVES, AND THE SPLIT IS DELIBERATE.
 *
 *  - `createFigaroCourtyardMap` fills the `H`/`T`/`S` grids the shared
 *    pathing/height code reads. Walls are ROCK, which is already the type
 *    nothing may stand on (`battle-grid.mjs` walkable()), so the keep, the
 *    gatehouse, the ramp cheeks, the parapets and the towers need no occupancy
 *    of their own.
 *  - `figaroSolidPropTiles` derives the tiles the freestanding cover stands
 *    on — the wrecked automatons of the stage-one line, which sit on ORDINARY
 *    SAND and would otherwise be walked through. It is pure (map data in, tile
 *    list out, no three.js) and the PAGE writes them into `BLOCKED`, exactly as
 *    the gallery does. AGENT_BRIEF trap 6: a view module that writes a rules
 *    input while building the scene is how the node sim and the browser came to
 *    disagree about one tile, so the scenery draws these wrecks and never marks
 *    them.
 *
 * Constructible from Node with no page globals: the tile-type enum arrives as
 * plain values rather than being imported, matching the other map modules.
 */

/** North (z = 0) is the keep; south (z = 22) is the open desert. */
export const figaroCourtyardMap = {
  schemaVersion: 2,
  id: 'figaro-courtyard',
  grid: { width: 17, depth: 23 },
  /**
   * The bands, north to south. `h` is in height units (the engine's HU). The
   * plateau's 2 is the one that matters to the rules: a 2-unit rise is exactly
   * what `stepOK` refuses without a STAIR, so the desert reaches the plateau
   * only through the ramp's one-unit steps or the two ladder stairs.
   */
  bands: {
    keepWall: { z: 0, h: 9 },
    gatehouse: { z0: 1, z1: 2, h: 7 },
    courtyards: { z0: 3, z1: 9, h: 2 },
    parapet: { z: 10, h: 4 },
    apron: { z0: 10, z1: 12, h: 0 },
    desert: { z0: 13, z1: 22, h: 0 },
  },
  /**
   * The ramp: the castle's axis, three tiles wide. Its landings step
   * 2 -> 1 -> 0, each a one-unit step the rules allow without a stair, so the
   * throat is a road — the walls either side are what make it a killing ground.
   */
  ramp: {
    x: [7, 8, 9],
    high: { z0: 3, z1: 5, h: 2 },
    mid: { z0: 6, z1: 8, h: 1 },
    low: { z0: 9, z1: 12, h: 0 },
    cheekX: [6, 10],
    cheekH: 4,
  },
  /** The gate passage through the gatehouse, continuous with the high landing. */
  gate: { x: [7, 8, 9], z0: 1, z1: 2 },
  /** Curtain walls close the plateau's east and west edges. */
  curtainWall: { x: [0, 16], z1: 10, h: 6 },
  /** Tower footprints: gate towers flank the ramp exit, corner towers the board edge. */
  towers: {
    front: [{ x: 6, z: 10 }, { x: 10, z: 10 }],
    corner: [{ x: 0, z: 11 }, { x: 16, z: 11 }],
    h: 5,
  },
  /**
   * The two wall ladders: STAIR tiles in the parapet row bridging the full
   * 2-unit rise from the sand onto the courtyard terraces. With the ramp, these
   * are the ONLY ways up — the flanks exist so holding the throat is not the
   * whole battle.
   */
  ladders: [{ x: 3, z: 10 }, { x: 13, z: 10 }],
  /** The crimson runner: the keep door's axis, drawn as its own tile type. */
  carpetX: 8,
  /**
   * Freestanding cover, and the only thing on this map that needs `BLOCKED`:
   * Edgar's automaton line, wrecked where it stood when the assault began. The
   * sentries fell in their rank mid-desert; the two cannonets keeled over on
   * the flanks. Attackers thread the wreck line; defenders sallying out get the
   * same cover.
   */
  props: [
    { kind: 'wreck-sentry', x: 4, z: 16 },
    { kind: 'wreck-sentry', x: 6, z: 16 },
    { kind: 'wreck-sentry', x: 8, z: 16 },
    { kind: 'wreck-sentry', x: 10, z: 16 },
    { kind: 'wreck-sentry', x: 12, z: 16 },
    { kind: 'wreck-cannonet', x: 2, z: 15 },
    { kind: 'wreck-cannonet', x: 14, z: 15 },
  ],
  /**
   * Where the scenery pass hangs its set pieces, in TILE coordinates. Declared
   * here rather than in the renderer so the art and the rules cannot drift: the
   * ladder anchors are the tiles the flankers actually climb, and the gate
   * anchor is the tile the fallen portcullis lies across.
   */
  anchors: {
    keepDoor: { x: 8, z: 0 },
    gate: { x: 8, z: 1 },
    backTowers: [{ x: 4, z: 1 }, { x: 12, z: 1 }],
  },
};

/**
 * Build the walkable grids for the gate approach.
 *
 * Returns `H` (height per tile), `T` (tile type) and `S` (stair records) and
 * nothing else: occupancy is the page's to write, from `figaroSolidPropTiles`.
 */
export function createFigaroCourtyardMap({
  W, D, ROCK, STAIR, SAND, COBBLE, CARPET, map = figaroCourtyardMap,
}) {
  if (W !== map.grid.width || D !== map.grid.depth) {
    throw new Error(
      `figaro courtyard: battle grid ${W}x${D} does not match the map's `
      + `${map.grid.width}x${map.grid.depth}`);
  }
  const { bands, ramp, gate, curtainWall, towers, ladders, carpetX } = map;
  const H = [], T = [], S = [];
  for (let z = 0; z < D; z++) {
    H.push(new Array(W).fill(bands.desert.h));
    T.push(new Array(W).fill(SAND));
    S.push(new Array(W).fill(null));
  }
  const set = (x, z, h, t) => { H[z][x] = h; T[z][x] = t; };
  const rampX = new Set(ramp.x);

  // --- the keep face closes the north edge outright.
  for (let x = 0; x < W; x++) set(x, bands.keepWall.z, bands.keepWall.h, ROCK);

  // --- the gatehouse, with the gate passage through it at plateau height.
  for (let z = bands.gatehouse.z0; z <= bands.gatehouse.z1; z++)
    for (let x = 0; x < W; x++)
      if (rampX.has(x)) set(x, z, ramp.high.h, x === carpetX ? CARPET : COBBLE);
      else set(x, z, bands.gatehouse.h, ROCK);

  // --- the plateau: two courtyard terraces flanking the ramp's high landing.
  for (let z = bands.courtyards.z0; z <= bands.courtyards.z1; z++) {
    for (let x = 1; x < W - 1; x++) {
      if (rampX.has(x)) continue;                       // the ramp column is below
      if (ramp.cheekX.includes(x)) {
        // The cheek columns join the plateau beside the high landing, then
        // become the walls that funnel the throat.
        if (z <= ramp.high.z1) set(x, z, ramp.high.h, COBBLE);
        else set(x, z, ramp.cheekH, ROCK);
      } else {
        set(x, z, bands.courtyards.h, COBBLE);
      }
    }
  }

  // --- the ramp: high landing (with the runner), then the two lower landings.
  for (const x of ramp.x) {
    for (let z = ramp.high.z0; z <= ramp.high.z1; z++)
      set(x, z, ramp.high.h, x === carpetX ? CARPET : COBBLE);
    for (let z = ramp.mid.z0; z <= ramp.mid.z1; z++)
      set(x, z, ramp.mid.h, COBBLE);
    for (let z = ramp.low.z0; z <= ramp.low.z1; z++)
      set(x, z, ramp.low.h, COBBLE);
  }

  // --- the parapet row closes the terraces' south edge, pierced only by the
  // two ladders: STAIR tiles at plateau height bridging the full 2-unit rise.
  const ladderX = new Set(ladders.map(l => l.x));
  for (let x = 1; x < W - 1; x++) {
    if (rampX.has(x) || ramp.cheekX.includes(x)) continue;
    if (ladderX.has(x)) {
      H[bands.parapet.z][x] = bands.courtyards.h;
      T[bands.parapet.z][x] = STAIR;
      // dir [0,-1]: the climb tops out northward, onto the terrace.
      S[bands.parapet.z][x] = { lo: bands.desert.h, hi: bands.courtyards.h, dir: [0, -1] };
    } else {
      set(x, bands.parapet.z, bands.parapet.h, ROCK);
    }
  }

  // --- the curtain walls close the plateau's east and west edges...
  for (let z = 1; z <= curtainWall.z1; z++)
    for (const x of curtainWall.x) set(x, z, curtainWall.h, ROCK);
  // ...and the towers stamp their footprints over whatever row they stand in.
  for (const t of towers.front.concat(towers.corner)) set(t.x, t.z, towers.h, ROCK);

  return { H, T, S };
}

/**
 * Which battle tiles the wrecked automatons stand on.
 *
 * Pure: map data in, tile list out. The page marks these blocked
 * (src/battle-scene.mjs) and any headless harness must do the same — see the
 * gallery's `gallerySolidPropTiles` for why this cannot live in the renderer.
 */
export function figaroSolidPropTiles(map = figaroCourtyardMap) {
  const { width, depth } = map.grid;
  return (map.props || [])
    .filter(prop => prop.x >= 0 && prop.x < width && prop.z >= 0 && prop.z < depth)
    .map(prop => ({ kind: prop.kind, x: prop.x, z: prop.z }));
}
