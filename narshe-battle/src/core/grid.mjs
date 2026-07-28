/**
 * Pure square-grid distances and breadth-first pathfinding.
 *
 * Map rules remain caller-owned callbacks so the core can serve different
 * battlefields, terrain systems, factions, and movement types.
 */

export const CARDINAL_DIRECTIONS = Object.freeze(
  [[1, 0], [-1, 0], [0, 1], [0, -1]].map(Object.freeze),
);

export function chebyshevDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

export function gridKey(x, z, width) {
  return z * width + x;
}

export function findReachable({
  start,
  maxSteps,
  width,
  canTraverse,
  occupantAt = () => null,
  isHostile = () => false,
  directions = CARDINAL_DIRECTIONS,
}) {
  const key = (x, z) => gridKey(x, z, width);
  const dist = new Map([[key(start.x, start.z), 0]]);
  const prev = new Map();
  let frontier = [[start.x, start.z]];

  for (let step = 0; step < maxSteps; step++) {
    const next = [];
    for (const [x, z] of frontier) {
      for (const [dx, dz] of directions) {
        const nx = x + dx;
        const nz = z + dz;
        const nextKey = key(nx, nz);
        if (dist.has(nextKey) || !canTraverse(x, z, nx, nz)) continue;
        const occupant = occupantAt(nx, nz);
        if (occupant && isHostile(occupant)) continue;
        dist.set(nextKey, step + 1);
        prev.set(nextKey, [x, z]);
        next.push([nx, nz]);
      }
    }
    frontier = next;
  }

  const tiles = [];
  for (const [tileKey, distance] of dist) {
    if (distance === 0) continue;
    const x = tileKey % width;
    const z = (tileKey - x) / width;
    if (occupantAt(x, z)) continue;
    tiles.push({ x, z, d: distance });
  }
  return { tiles, prev, width };
}

export function reconstructPath(result, start, target) {
  const path = [];
  let current = [target.x, target.z];
  while (
    current &&
    !(current[0] === start.x && current[1] === start.z)
  ) {
    path.push(current);
    current = result.prev.get(gridKey(current[0], current[1], result.width));
  }
  return path.reverse();
}
