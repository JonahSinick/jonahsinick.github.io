export const warningBellGalleryMap = {
  schemaVersion: 1,
  id: "warning-bell-gallery",
  skin: "narshe-mine",
  grid: {
    width: 13,
    depth: 11,
    tileSize: 0.97,
    slabHeight: 0.18,
    surfaceY: -0.1,
    edgeSides: ["west", "east", "south"],
    variation: {
      xFactor: 7,
      zFactor: 11,
      steps: 5,
      amount: 0.012,
      bias: -0.024,
    },
  },
  modules: [
    {
      kind: "cavern-walls",
      far: {
        from: -7,
        to: 7,
        step: 0.72,
        z: -5.82,
        gapHalfWidth: 1.42,
      },
      sides: {
        x: [-6.72, 6.72],
        from: -5.1,
        to: 5.1,
        step: 0.78,
      },
    },
    {
      kind: "timbered-shaft",
      position: [0, 1.38, -5.64],
      opening: [2.55, 2.85],
      postX: [-1.28, 1.28],
      cap: [2.9, 0.3, 0.32],
      faceZ: -5.5,
      crownRocks: [
        [-1.55, 2.65, 0.55, 0.62],
        [-0.95, 3.05, 0.62, 0.55],
        [-0.3, 3.23, 0.66, 0.52],
        [0.38, 3.2, 0.65, 0.5],
        [1.02, 3.03, 0.58, 0.55],
        [1.58, 2.63, 0.52, 0.62],
      ],
    },
    {
      kind: "mine-rails",
      railX: [-0.34, 0.34],
      centerZ: -0.55,
      length: 10.1,
      sleeper: {
        from: -5.35,
        to: 4.35,
        step: 0.48,
      },
    },
    // Set dressing pared to what reads unambiguously (Jonah, 2026-07-31):
    // crates, wall ore-seams, and work-lamps removed — the seams read as
    // floating ice and the lamps as stray bronze spheres competing with the
    // warning bell, which must stay the scene's only bronze. Carts are empty:
    // parked haulers, not ice wagons.
    // Props are kit GEOMETRY, tile-snapped: they occupy squares and rotate
    // with the world (billboard plates read as straddling and turning
    // wrongly — Jonah, 2026-07-31). Carts stay empty haulers.
    { kind: "ore-cart", position: [-4, -1], empty: true },
    { kind: "ore-cart", position: [4, 0], empty: true },
    { kind: "crate", position: [-4, 2], size: 0.62 },
    { kind: "crate", position: [4, 3], size: 0.56 },
    { kind: "timber-brace", position: [-6.28, 1], along: "z" },
    { kind: "timber-brace", position: [6.28, -2], along: "z" },
    // The near (south) wall frames the scene when the camera swings to face
    // it, and hides otherwise so it never obstructs the party's approach.
    // Its plain timbered opening has no bell and no rock crown — the bell
    // wall stays unmistakable.
    {
      kind: "cavern-walls",
      viewGroup: "south",
      near: {
        from: -7,
        to: 7,
        step: 0.72,
        z: 5.82,
        gapHalfWidth: 1.42,
      },
    },
    {
      kind: "timbered-shaft",
      viewGroup: "south",
      position: [0, 1.05, 5.64],
      opening: [2.55, 2.2],
      postX: [-1.28, 1.28],
      cap: [2.9, 0.26, 0.32],
      faceZ: 5.5,
    },
  ],
  anchors: {
    warningBell: [2.28, 1.22, -5.13],
    shaftMouth: [0, 0, -5.15],
    enemyStaging: [0, 0, -4],
    partyStaging: [0, 0, 4],
  },
};

/**
 * Prop kinds that are solid objects standing on the floor.
 *
 * Rails and sleepers are laid INTO the floor and are walked over; braces are
 * wall furniture in the edge column. These two are the things with a body: a
 * hauler and a crate, each filling most of its square.
 */
const SOLID_PROP_KINDS = new Set(['ore-cart', 'crate']);

/**
 * Which battle tiles the gallery's solid props stand on.
 *
 * WHY THIS IS HERE AND NOT IN THE TERRAIN KIT. Jonah played the bell on
 * 2026-08-03 and walked straight through an ore cart — the gallery had no
 * occupancy at all, because `BLOCKED` is written only by battle 1's scenery
 * builder and nothing ever wrote it for this map. The fix could have gone into
 * the kit, beside the geometry, which is exactly the mistake AGENT_BRIEF trap 6
 * records: a view module writing a rules input as a side effect of building the
 * scene is how the node sim and the browser came to disagree about one tile.
 *
 * So the occupancy is derived from the MAP — pure data in, tile list out, no
 * three.js — and both consumers write it themselves: the page marks these tiles
 * blocked (src/battle-scene.mjs) and so does the headless sim
 * (src/sim/run-battle.mjs). One function, two callers, no side effects, and a
 * Node test can assert the tiles without constructing a renderer.
 *
 * The arithmetic mirrors where the page puts the kit: its coordinates are
 * centred on the room, and the group is translated to the grid centre, so a
 * prop at kit x = -4 on a 13-wide floor stands on tile 2. Props sit on tile
 * CENTRES, so the floor of the translated coordinate is the tile.
 */
export function gallerySolidPropTiles(map = warningBellGalleryMap) {
  const { width, depth } = map.grid;
  const tiles = [];
  for (const module of map.modules || []) {
    if (!SOLID_PROP_KINDS.has(module.kind) || !module.position) continue;
    const [kitX, kitZ] = module.position;
    const x = Math.floor(kitX + width / 2);
    const z = Math.floor(kitZ + depth / 2);
    if (x >= 0 && x < width && z >= 0 && z < depth) tiles.push({ kind: module.kind, x, z });
  }
  return tiles;
}
