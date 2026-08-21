/**
 * Post-battle free-roam: continuous sub-tile movement for the exploring unit
 * (Seira, in the current demo), driven by held keys or a click-to-path
 * destination. Uses the battle map's real walkability/step rules but treats
 * every other figure — including a downed one — as scenery to walk around,
 * with no turn budget, so the search can span the whole connected map.
 *
 * This module owns the avatar's position/path/held-keys state and the
 * physics that moves it (`step`), but not when exploration starts or ends —
 * `begin`/`end` are called by the page's win/lose flow (`beginExploration`/
 * `finish`), which also owns the UI chrome (hint banner, marker visibility,
 * camera framing) around entering and leaving the mode. Everything numeric
 * or stateful that this module needs from the page — grid queries, the
 * camera rig, the cursor `marker`, `setWalking` — arrives through context
 * rather than being imported, matching `battle-kit.mjs`/`enemy-ai.mjs`.
 */

import { findReachable, reconstructPath } from '../core/grid.mjs';

export const EXPLORATION_CONTEXT_FIELDS = [
  'THREE',
  'grid',         // { width, depth } — the battle map's tile dimensions
  'walkable',     // (x, z) -> bool
  'stepOK',       // (x, z, nx, nz) -> bool, height-step legality between neighbors
  'inBounds',     // (x, z) -> bool
  'tileTop',      // tileTop[z][x] -> walkable world-space Y of a tile
  'stairAt',      // (x, z) -> stair descriptor or falsy
  'heightUnit',   // HU — world Y per height unit, for a stair's low/high fallback
  'topThick',     // terrain top-surface thickness, same fallback
  'units',        // live roster array, for footprint collision
  'azimuth',      // () -> current camera azimuth, so keys stay screen-relative
  'faceKeys',     // { ArrowUp: 'up', w: 'up', ... } screen-relative key map
  'phase',        // () -> current battle phase; moveTo/step no-op outside 'explore'
  'setWalking',   // (unit, on) -> toggle the walk-cycle animation
  'center',       // the camera's THREE.Vector3 look-at point, followed while moving
  'clampCenter',  // () -> keep `center` inside the map bounds
  'placeCamera',  // () -> re-apply the camera rig after `center` moves
  'marker',       // the ground-cursor mesh; position is kept under the avatar
];

export function createExplorationMode(context) {
  const missing = EXPLORATION_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('exploration mode: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, grid, walkable, stepOK, inBounds, tileTop, stairAt, heightUnit,
    topThick, units, azimuth, faceKeys, phase, setWalking, center, clampCenter,
    placeCamera, marker,
  } = context;

  const EXPLORE_SPEED = 4.9;
  const EXPLORE_RADIUS = 0.16;

  let exploreUnit = null;
  let explorePos = null;
  let explorePath = [];
  const exploreKeys = new Set();

  function exploreKeyName(key) {
    if (String(key).startsWith('Arrow')) return String(key);
    const lower = String(key).toLowerCase();
    return 'wasd'.includes(lower) ? lower : null;
  }
  // Exploration is analog in world space, so it can follow the camera's exact
  // screen axes instead of rounding them to a combat-grid edge. Up is therefore
  // always visually up, even at the board's usual 45-degree camera angle.
  function explorationKeyVector(key) {
    const which = faceKeys[key] || faceKeys[String(key).toLowerCase()];
    if (!which) return null;
    const az = azimuth();
    const right = [Math.cos(az), -Math.sin(az)];
    const up = [-Math.sin(az), -Math.cos(az)];
    if (which === 'up') return up;
    if (which === 'down') return [-up[0], -up[1]];
    if (which === 'right') return right;
    return [-right[0], -right[1]];
  }
  function explorationSurfaceY(px, pz) {
    const x = Math.floor(px), z = Math.floor(pz);
    if (!walkable(x, z)) return null;
    const stair = stairAt(x, z);
    if (!stair) return tileTop[z][x];
    const localX = px - x, localZ = pz - z;
    const progress = stair.dir[0] !== 0
      ? (stair.dir[0] > 0 ? localX : 1 - localX)
      : (stair.dir[1] > 0 ? localZ : 1 - localZ);
    const lowX = x - stair.dir[0], lowZ = z - stair.dir[1];
    const highX = x + stair.dir[0], highZ = z + stair.dir[1];
    const lowY = inBounds(lowX, lowZ) && walkable(lowX, lowZ)
      ? tileTop[lowZ][lowX] : stair.lo * heightUnit + topThick;
    const highY = inBounds(highX, highZ) && walkable(highX, highZ)
      ? tileTop[highZ][highX] : stair.hi * heightUnit + topThick;
    return THREE.MathUtils.lerp(
      lowY, highY, THREE.MathUtils.clamp(progress, 0, 1));
  }
  function explorationCanOccupy(px, pz, fromX, fromZ) {
    // Sample the avatar's small footprint, not just its centre, so a shoulder
    // cannot drift through a cliff/building corner while moving diagonally.
    for (const [ox, oz] of [
      [0, 0], [EXPLORE_RADIUS, 0], [-EXPLORE_RADIUS, 0],
      [0, EXPLORE_RADIUS], [0, -EXPLORE_RADIUS],
    ]) {
      if (!walkable(Math.floor(px + ox), Math.floor(pz + oz))) return false;
    }
    const fx = Math.floor(fromX), fz = Math.floor(fromZ);
    const tx = Math.floor(px), tz = Math.floor(pz);
    if ((fx !== tx || fz !== tz) && !stepOK(fx, fz, tx, tz)) return false;
    for (const other of units) {
      if (other === exploreUnit || !other.group.parent) continue;
      const dx = px - other.group.position.x;
      const dz = pz - other.group.position.z;
      if (dx * dx + dz * dz < 0.48 * 0.48) return false;
    }
    return explorationSurfaceY(px, pz) !== null;
  }
  function explorationOccupantAt(x, z) {
    return units.find(u =>
      u !== exploreUnit && u.group.parent && u.x === x && u.z === z) || null;
  }
  function reachableTiles() {
    if (!exploreUnit) return { tiles: [], prev: new Map(), width: grid.width };
    return findReachable({
      start: exploreUnit,
      maxSteps: grid.width * grid.depth,
      width: grid.width,
      canTraverse: (x, z, nx, nz) =>
        walkable(nx, nz) && stepOK(x, z, nx, nz),
      occupantAt: explorationOccupantAt,
      isHostile: () => true,
    });
  }
  function placeExplorer(px, pz) {
    const y = explorationSurfaceY(px, pz);
    if (y === null) return false;
    explorePos.x = px; explorePos.z = pz;
    exploreUnit.x = Math.floor(px); exploreUnit.z = Math.floor(pz);
    exploreUnit.group.position.set(px, y, pz);
    marker.position.set(px, y + 0.02, pz);
    return true;
  }
  function moveExplorerBy(dx, dz) {
    if (!explorePos || (!dx && !dz)) return 0;
    const distance = Math.hypot(dx, dz);
    const slices = Math.max(1, Math.ceil(distance / 0.07));
    let moved = 0;
    for (let i = 0; i < slices; i++) {
      const sx = dx / slices, sz = dz / slices;
      const ox = explorePos.x, oz = explorePos.z;
      let nx = ox + sx, nz = oz + sz;
      if (explorationCanOccupy(nx, nz, ox, oz)) {
        placeExplorer(nx, nz);
      } else if (sx && explorationCanOccupy(ox + sx, oz, ox, oz)) {
        nx = ox + sx; nz = oz; placeExplorer(nx, nz);
      } else if (sz && explorationCanOccupy(ox, oz + sz, ox, oz)) {
        nx = ox; nz = oz + sz; placeExplorer(nx, nz);
      } else {
        break;
      }
      moved += Math.hypot(explorePos.x - ox, explorePos.z - oz);
    }
    return moved;
  }
  function moveTo(tx, tz, px = tx + 0.5, pz = tz + 0.5) {
    if (phase() !== 'explore' || !exploreUnit || !walkable(tx, tz)) return false;
    px = THREE.MathUtils.clamp(px, tx + 0.08, tx + 0.92);
    pz = THREE.MathUtils.clamp(pz, tz + 0.08, tz + 0.92);
    // Validate the destination footprint itself; adjacency/height legality is
    // enforced continuously along the reconstructed route, not as one giant
    // step from the current point to a faraway target.
    if (!explorationCanOccupy(px, pz, px, pz)) return false;
    const sameTile = exploreUnit.x === tx && exploreUnit.z === tz;
    const res = reachableTiles();
    if (!sameTile && !res.tiles.some(tile => tile.x === tx && tile.z === tz)) return false;
    const cells = sameTile ? [] : reconstructPath(res, exploreUnit, { x: tx, z: tz });
    if (!cells) return false;
    explorePath = cells.map(([x, z]) => ({ x: x + 0.5, z: z + 0.5 }));
    if (explorePath.length) explorePath[explorePath.length - 1] = { x: px, z: pz };
    else explorePath.push({ x: px, z: pz });
    exploreKeys.clear();
    return true;
  }
  function step(dt) {
    if (phase() !== 'explore' || !exploreUnit || !explorePos) return;
    let vx = 0, vz = 0;
    for (const key of exploreKeys) {
      const dir = explorationKeyVector(key);
      if (dir) { vx += dir[0]; vz += dir[1]; }
    }
    const keyMagnitude = Math.hypot(vx, vz);
    let moved = 0;
    if (keyMagnitude) {
      explorePath = [];
      vx /= keyMagnitude; vz /= keyMagnitude;
      if (!exploreUnit.walking) setWalking(exploreUnit, true);
      exploreUnit.group.rotation.y = Math.atan2(vx, vz);
      moved = moveExplorerBy(vx * EXPLORE_SPEED * dt, vz * EXPLORE_SPEED * dt);
    } else if (explorePath.length) {
      if (!exploreUnit.walking) setWalking(exploreUnit, true);
      let budget = EXPLORE_SPEED * dt;
      while (budget > 0.0001 && explorePath.length) {
        const target = explorePath[0];
        const dx = target.x - explorePos.x, dz = target.z - explorePos.z;
        const distance = Math.hypot(dx, dz);
        if (distance < 0.015) { placeExplorer(target.x, target.z); explorePath.shift(); continue; }
        const step = Math.min(distance, budget);
        exploreUnit.group.rotation.y = Math.atan2(dx, dz);
        const covered = moveExplorerBy(dx / distance * step, dz / distance * step);
        moved += covered;
        budget -= covered;
        if (covered < step * 0.5) { explorePath = []; break; }
        if (step >= distance - 0.001) explorePath.shift();
      }
    }
    if (!keyMagnitude && !explorePath.length && exploreUnit.walking)
      setWalking(exploreUnit, false);
    if (moved > 0) {
      const follow = Math.min(1, dt * 4.5);
      center.x += (explorePos.x - center.x) * follow;
      center.z += (explorePos.z - center.z) * follow;
      clampCenter();
      placeCamera();
    } else if ((keyMagnitude || explorePath.length) && exploreUnit.walking) {
      setWalking(exploreUnit, false);
    }
  }
  function press(key) {
    const name = exploreKeyName(key);
    if (name) exploreKeys.add(name);
    return name;
  }
  function release(key) {
    const name = exploreKeyName(key);
    if (name) exploreKeys.delete(name);
    return name;
  }
  function begin(unit) {
    exploreUnit = unit;
    explorePos = { x: unit.group.position.x, z: unit.group.position.z };
    explorePath = [];
    exploreKeys.clear();
  }
  function end() {
    exploreKeys.clear();
    explorePath = [];
    explorePos = null;
    exploreUnit = null;
  }

  return {
    unit: () => exploreUnit,
    position: () => explorePos,
    isPathing: () => explorePath.length > 0,
    keysHeld: () => [...exploreKeys],
    speed: EXPLORE_SPEED,
    keyVector: explorationKeyVector,
    canOccupy: explorationCanOccupy,
    reachableTiles,
    begin,
    end,
    press,
    release,
    clearKeys: () => exploreKeys.clear(),
    clearPath: () => { explorePath = []; },
    moveTo,
    step,
  };
}
