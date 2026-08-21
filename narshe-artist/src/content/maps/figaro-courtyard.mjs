/**
 * Battle 3 map data — the Figaro Castle entryway courtyard.
 *
 * The layout is a defense: the keep stands at the north edge (z = 0), the party
 * holds a raised terrace in front of its door, and the attackers come through a
 * breached gatehouse at the south edge (z = 18) and over two wall ladders on
 * the flanks. Everything that decides where a unit may stand is here; nothing
 * here draws anything.
 *
 * TWO HALVES, AND THE SPLIT IS DELIBERATE.
 *
 *  - `createFigaroCourtyardMap` fills the `H`/`T`/`S` grids the shared
 *    pathing/height code reads. Walls are ROCK, which is already the type
 *    nothing may stand on (`battle-grid.mjs` walkable()), so the curtain walls,
 *    the parapet and the gatehouse need no occupancy of their own.
 *  - `figaroSolidPropTiles` derives the tiles the courtyard's freestanding
 *    cover stands on — crates and a barrel, which sit on ORDINARY COBBLE and
 *    would otherwise be walked through. It is pure (map data in, tile list out,
 *    no three.js) and the PAGE writes them into `BLOCKED`, exactly as the
 *    gallery does. AGENT_BRIEF trap 6: a view module that writes a rules input
 *    while building the scene is how the node sim and the browser came to
 *    disagree about one tile, so `figaro-scenery.mjs` draws these props and
 *    never marks them.
 *
 * Constructible from Node with no page globals: the tile-type enum arrives as
 * plain values rather than being imported, matching the other map modules.
 */

/** North (z = 0) is the keep; south (z = 18) is the desert beyond the gate. */
export const figaroCourtyardMap = {
  schemaVersion: 1,
  id: 'figaro-courtyard',
  grid: { width: 17, depth: 19 },
  /**
   * The bands, north to south. `h` is in height units (the engine's HU), and
   * the two that matter to the rules are the terrace's 2 and the courtyard's 0:
   * a 2-unit rise is exactly what `stepOK` refuses without a STAIR, so the
   * three parapet gaps below are the ONLY ways onto the terrace.
   */
  bands: {
    keepWall: { z0: 0, z1: 0, h: 9 },
    terrace: { z0: 1, z1: 3, h: 2 },
    parapet: { z: 4, h: 3 },
    courtyard: { z0: 5, z1: 16, h: 0 },
    gatehouse: { z: 17, h: 7 },
    approach: { z: 18, h: 7 },
  },
  /** Curtain walls run the full depth down both edges. */
  curtainWall: { x: [0, 16], h: 6 },
  /**
   * The three ways up. The centre gap is the carpeted ceremonial stair (three
   * tiles, on the castle's axis); the two side gaps are service stairs at the
   * ends of the parapet, which is what gives the flanking ladder-climbers
   * somewhere to go.
   */
  stairs: { centre: [7, 8, 9], sides: [1, 15] },
  /** The crimson runner: the keep door's axis, drawn as its own tile type. */
  carpetX: 8,
  /** The gate is broken open across these columns; sand drifts in through it. */
  breachX: [7, 8, 9],
  /** The sand fan just inside the gate, and the strip of desert outside it. */
  sandInsideX: [6, 7, 8, 9, 10],
  sandOutsideX: [6, 7, 8, 9, 10],
  /**
   * Freestanding cover, and the only thing on this map that needs `BLOCKED`.
   * Two crates mid-courtyard break the open charge; the barrel sits beside the
   * gate mouth where the attackers funnel.
   */
  props: [
    { kind: 'crate', x: 4, z: 10 },
    { kind: 'crate', x: 12, z: 10 },
    { kind: 'barrel', x: 7, z: 15 },
  ],
  /**
   * Where the scenery pass hangs its set pieces, in TILE coordinates. Declared
   * here rather than in the renderer so the art and the rules cannot drift: the
   * ladder anchors are the tiles the enemies actually climb down onto, and the
   * door anchor is the tile the carpet runs to.
   */
  anchors: {
    keepDoor: { x: 8, z: 0 },
    breach: { x: 8, z: 17 },
    towers: [{ x: 3, z: 17 }, { x: 13, z: 17 }],
    ladders: [{ x: 1, z: 8 }, { x: 15, z: 11 }],
  },
};

/**
 * Build the walkable grids for the courtyard.
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
  const { bands, curtainWall, stairs, carpetX, breachX } = map;
  const H = [], T = [], S = [];
  for (let z = 0; z < D; z++) {
    H.push(new Array(W).fill(bands.keepWall.h));
    T.push(new Array(W).fill(ROCK));
    S.push(new Array(W).fill(null));
  }
  const set = (x, z, h, t) => { H[z][x] = h; T[z][x] = t; };
  const inner = x => x > curtainWall.x[0] && x < curtainWall.x[1];

  // --- the keep wall (z = 0) is the default fill; everything below overwrites it.
  // The terrace: the party's ground, one 2-unit rise above the courtyard.
  for (let z = bands.terrace.z0; z <= bands.terrace.z1; z++)
    for (let x = 0; x < W; x++)
      if (inner(x)) set(x, z, bands.terrace.h, x === carpetX ? CARPET : COBBLE);

  // The parapet closes the terrace's south edge except at its three gaps, each
  // a STAIR bridging the 2-unit rise.
  const gaps = new Set([...stairs.centre, ...stairs.sides]);
  for (let x = 0; x < W; x++) {
    if (!inner(x)) continue;
    if (gaps.has(x)) {
      H[bands.parapet.z][x] = bands.terrace.h;
      T[bands.parapet.z][x] = STAIR;
      // dir [0,-1]: the flight climbs north, toward the keep.
      S[bands.parapet.z][x] = { lo: bands.courtyard.h, hi: bands.terrace.h, dir: [0, -1] };
    } else {
      set(x, bands.parapet.z, bands.parapet.h, ROCK);
    }
  }

  // The courtyard floor, with the runner continuing down the castle's axis and
  // the sand fan drifted in through the breach across its last row.
  const sandInside = new Set(map.sandInsideX);
  for (let z = bands.courtyard.z0; z <= bands.courtyard.z1; z++) {
    for (let x = 0; x < W; x++) {
      if (!inner(x)) continue;
      const drifted = z === bands.courtyard.z1 && sandInside.has(x);
      set(x, z, bands.courtyard.h,
        drifted ? SAND : x === carpetX ? CARPET : COBBLE);
    }
  }

  // The gatehouse wall, broken open across the breach columns.
  for (const x of breachX) set(x, bands.gatehouse.z, bands.courtyard.h, SAND);
  // The desert outside it, between the two tower footprints.
  for (const x of map.sandOutsideX) set(x, bands.approach.z, bands.courtyard.h, SAND);

  // The curtain walls run the whole depth; the gatehouse and approach rows are
  // already ROCK at their own heights, so only the height differs.
  for (let z = 0; z < D; z++) {
    for (const x of curtainWall.x) {
      if (T[z][x] !== ROCK) continue;
      H[z][x] = z >= bands.gatehouse.z ? bands.gatehouse.h
        : z === 0 ? bands.keepWall.h : curtainWall.h;
    }
  }
  // The gatehouse and approach rows keep their own wall height where they are
  // still solid (tower footprints and the wall either side of the breach).
  for (const z of [bands.gatehouse.z, bands.approach.z])
    for (let x = 0; x < W; x++) if (T[z][x] === ROCK) H[z][x] = bands.gatehouse.h;

  return { H, T, S };
}

/**
 * Which battle tiles the courtyard's freestanding cover stands on.
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
