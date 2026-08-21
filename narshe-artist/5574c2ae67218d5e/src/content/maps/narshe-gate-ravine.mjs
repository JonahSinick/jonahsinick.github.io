/**
 * Battle 1 map data — the terraced invasion ravine the imperial trio climbs
 * from the entry snowfield up to the mine yard, the noise helpers
 * (`hash`/`mulberry`) the rest of the page reuses for jitter and seeded
 * combat RNG, and the `BLOCKED` occupancy grid the static scenery populates
 * one prop footprint at a time via `blockTiles`.
 *
 * The warning-bell battle's terrain is data compiled by
 * `src/render/terrain-kit.mjs` from `warning-bell-gallery.mjs`, but it still
 * needs a walkable `H`/`T`/`S` grid for the shared pathing/height code to
 * read, so `WARBELL` selects a trivial one-flat-tile-type fill here instead
 * of living in a second module — this moves the block exactly as it already
 * stood, branch included.
 *
 * `FLAT` is the same trivial fill for a battle whose terrain is authored by its
 * OWN map module and written over these grids afterwards (battle 3's courtyard,
 * `figaro-courtyard.mjs`). It exists because the ravine block indexes rows this
 * file knows the size of and no other map does: run it on a differently-shaped
 * board and it throws before anything else can be built. Everything below the
 * terrain — the occupancy grid every battle shares, and the two noise helpers
 * the page and the sim both reuse — is the same for all three.
 *
 * Takes the grid dimensions and tile-type enum as plain values (never
 * imported) so this stays constructible from Node with no page globals,
 * matching `warning-bell-gallery.mjs` and the other content modules.
 */
export function createNarsheGateMap({ W, D, WARBELL, FLAT = false, ROCK, SNOW, PATH, ICE, STAIR }) {
  function hash(x, z) { let h = (x * 374761393 + z * 668265263) ^ 0x5bf03635; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967295; }
  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---------------------------------------------------------------- map data
  // The party invades from the south (high z), climbing terraces to the mine (z=0).
  const H = [], T = [], S = [];
  for (let z = 0; z < D; z++) { H.push(new Array(W).fill(0)); T.push(new Array(W).fill(ROCK)); S.push(new Array(W).fill(null)); }
  function fill(x0, x1, z0, z1, h, t) { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) { H[z][x] = h; T[z][x] = t; } }
  function stair(x, z, lo, hi, dir) { H[z][x] = hi; T[z][x] = STAIR; S[z][x] = { lo, hi, dir }; }

  // --- terraced invasion route (center road x5..6), each terrace 2 units up ---
  if (WARBELL || FLAT) {
    // The gallery is one flat working floor; the terrain kit dresses it and the
    // cavern carries the walls, so every tile stays walkable and level. A FLAT
    // battle gets the same base and then authors over it.
    fill(0, W - 1, 0, D - 1, 0, PATH);
  } else {
    // entry snowfield (h0)
    fill(2, 9, 14, 17, 0, SNOW);
    fill(5, 6, 14, 16, 0, PATH);
    fill(2, 3, 15, 17, 0, ICE);                       // frozen pond, SW of the entry
    // terrace 1 (h2) — bunkhouse + watch post
    fill(2, 9, 10, 13, 2, SNOW);
    fill(5, 6, 10, 12, 2, PATH);
    stair(5, 13, 0, 2, [0, -1]); stair(6, 13, 0, 2, [0, -1]);
    // terrace 2 (h4) — storehouse
    fill(2, 9, 6, 9, 4, SNOW);
    fill(5, 6, 6, 8, 4, PATH);
    stair(5, 9, 2, 4, [0, -1]); stair(6, 9, 2, 4, [0, -1]);
    // mine yard (h6) at the top, backed by the great cliff
    fill(2, 9, 2, 5, 6, SNOW);
    fill(4, 7, 2, 4, 6, PATH);
    stair(5, 5, 4, 6, [0, -1]); stair(6, 5, 4, 6, [0, -1]);

    // ravine walls: always tower ~3-5 units above the local terrace, huge at the back
    function terraceH(z) { return z >= 14 ? 0 : z >= 10 ? 2 : z >= 6 ? 4 : 6; }
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      if (T[z][x] !== ROCK) continue;
      const edge = (x === 0 || x === W - 1) ? 1 : 0;
      H[z][x] = terraceH(z) + 3 + edge + Math.round(hash(x, z + 5) * 2);
    }
    for (let x = 0; x < W; x++) for (let z = 0; z <= 1; z++) H[z][x] = 13 + Math.round(hash(x, z + 40) * 2);
  }

  // --- occupancy: scenery props claim tiles so units can't stand in a building ---
  const BLOCKED = [];
  for (let z = 0; z < D; z++) BLOCKED.push(new Array(W).fill(false));
  function blockTiles(x0, z0, x1, z1) {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (x >= 0 && x < W && z >= 0 && z < D) BLOCKED[z][x] = true;
  }

  return { H, T, S, BLOCKED, blockTiles, hash, mulberry };
}
