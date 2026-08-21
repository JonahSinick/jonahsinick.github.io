/**
 * Whether an arrow has a clear lane, for `rules.arrowLos`.
 *
 * An archer cannot shoot through a body or a solid prop. That is the whole
 * rule, and it is pure grid geometry: walk the line from the shooter's tile to
 * the target's, and if any INTERMEDIATE tile is occupied — either team, since
 * an arrow does not care whose back it is, and any scenery the caller counts as
 * solid — the shot is refused. What counts as occupied is entirely the
 * caller's predicate; this module only answers which tiles the lane crosses.
 *
 * Two deliberate simplifications for v1, both worth stating because both will
 * eventually be questioned:
 *
 *  - HEIGHT IS IGNORED. Shooting down a terrace over a friend's head is
 *    exactly the case a height-aware LOS would allow, and modelling it
 *    properly means elevation sampling along the lane, which is a bigger
 *    design than this rule. Today a body blocks regardless of how far below
 *    the lane it stands.
 *  - BOWS ONLY. The caller decides who this applies to; the flask is lobbed
 *    and Seira's bolt is magic, so neither is screened.
 *
 * THE TRAVERSAL. The lane is the SUPERCOVER of the segment between the two
 * tile centres: every tile whose interior the segment passes through, found by
 * comparing when the segment next crosses a vertical grid line against when it
 * next crosses a horizontal one. Both comparisons are done in integers
 * ((2m+1)·dz against (2k+1)·dx, the crossing times cleared of their
 * denominators), so there is no floating point anywhere and no tie is ever
 * decided by rounding.
 *
 * This replaced a plain Bresenham walk, which was wrong in two ways that a
 * player could feel. Bresenham takes a DIAGONAL step whenever the error term
 * allows one, and the old code treated every such step as a corner crossing —
 * so on a shallow lane like (0,0) to (4,2), a body standing squarely at (1,1),
 * a tile the segment openly runs through, did not block the shot. And because
 * the error term is seeded from the shooter's end, the walk was not symmetric:
 * 160 of 28,056 (target, body) pairs answered differently depending on which
 * end you started from, so who was shooting decided whether the shot existed.
 * A supercover walk is symmetric by construction — the segment is the same
 * segment either way round.
 *
 * The corner rule is the one real judgement call, and it survives unchanged
 * because it is now the case it was always meant to describe: a lane that
 * crosses EXACTLY through the point where four tiles meet, which happens only
 * when the two crossing times are equal. "Which tile is it in" has no answer
 * there. Rather than pick one arbitrarily, a true corner crossing is treated
 * as a GAP: the arrow threads it unless BOTH flanking tiles are occupied. That
 * is the permissive reading, and it is the right one for a game where the
 * player is being asked to position deliberately — a shot should fail because
 * someone is clearly in the way, never because of a tie-break they cannot see.
 */

/**
 * Walk the supercover of the lane, handing each entered tile to `visit`.
 *
 * `visit(x, z, flankA, flankB)` receives the tile the lane just entered.
 * `flankA`/`flankB` are null for an ordinary step and are the two tiles the
 * corner sits between when the lane crossed an exact lattice corner — the
 * arrow moved diagonally past them without entering either. Returning a truthy
 * value stops the walk, so a caller that only wants the first blocker does not
 * pay for the rest of the lane.
 *
 * Private on purpose: `laneBlocked` and `laneTiles` MUST agree about the shape
 * of a lane, and the previous version had them as two hand-written walks that
 * were only equal by inspection.
 */
function walkLane(from, to, visit) {
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  const sx = Math.sign(to.x - from.x);
  const sz = Math.sign(to.z - from.z);
  let x = from.x, z = from.z;
  let m = 0, k = 0;                    // steps already taken along x and along z
  // A guard against a malformed call walking forever; a lane can never be
  // longer than its own bounding box.
  const limit = dx + dz + 2;

  for (let step = 0; step < limit; step++) {
    if (x === to.x && z === to.z) return;
    // The segment next crosses a vertical grid line at (m + 1/2) / dx and a
    // horizontal one at (k + 1/2) / dz. Cross-multiplied, that is
    // (2m+1)·dz against (2k+1)·dx, which is exact in integers.
    const tX = (2 * m + 1) * dz;
    const tZ = (2 * k + 1) * dx;
    const canX = m < dx, canZ = k < dz;
    if (canX && canZ && tX === tZ) {
      // exact corner: step past it diagonally, having considered both flanks
      const stopped = visit(x + sx, z + sz, { x: x + sx, z }, { x, z: z + sz });
      x += sx; z += sz; m++; k++;
      if (stopped) return;
    } else if (canX && (!canZ || tX < tZ)) {
      const stopped = visit(x + sx, z, null, null);
      x += sx; m++;
      if (stopped) return;
    } else if (canZ) {
      const stopped = visit(x, z + sz, null, null);
      z += sz; k++;
      if (stopped) return;
    } else return;
  }
}

/**
 * Does anything stand between these two tiles?
 *
 * `occupied(x, z)` answers whether a tile is solid — a body, a wall, whatever
 * the caller counts. The shooter's own tile and the target's are never tested:
 * the shooter is not in its own way, and the target is the thing being shot at.
 *
 * One step per tile of separation rather than a scan of the bounding box. That
 * matters: the danger-zone shading asks this question once per (stance, tile)
 * pair across every living enemy.
 */
export function laneBlocked(from, to, occupied) {
  let blocked = false;
  walkLane(from, to, (x, z, a, b) => {
    // The corner is crossed BEFORE the tile beyond it is entered, so its
    // flanks are judged first — even when that tile is the target. A diagonal
    // neighbour is the one adjacency whose lane has a corner in it at all, and
    // a corner closed on both sides is exactly the shot that should fail.
    if (a && b) {
      const aBody = !isEnd(a, from, to) && occupied(a.x, a.z);
      const bBody = !isEnd(b, from, to) && occupied(b.x, b.z);
      if (aBody && bBody) { blocked = true; return true; }
    }
    if (x === to.x && z === to.z) return true;          // arrived: nothing in the way
    if (occupied(x, z)) { blocked = true; return true; }
    return false;
  });
  return blocked;
}

function isEnd(tile, from, to) {
  return (tile.x === from.x && tile.z === from.z)
      || (tile.x === to.x && tile.z === to.z);
}

/**
 * The intermediate tiles a lane crosses, for tests and debug output.
 *
 * The two tiles a corner crossing is threaded between are NOT reported: the
 * arrow considers them and travels through neither, so listing them would
 * describe a shape the arrow never takes.
 */
export function laneTiles(from, to) {
  const out = [];
  walkLane(from, to, (x, z) => {
    if (x === to.x && z === to.z) return true;
    out.push({ x, z });
    return false;
  });
  return out.filter(t => !isEnd(t, from, to));
}
