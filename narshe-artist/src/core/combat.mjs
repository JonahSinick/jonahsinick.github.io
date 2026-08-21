/**
 * Pure combat calculations shared by execution, forecasts, AI, and tests.
 *
 * This module deliberately knows nothing about the map, DOM, Three.js, or
 * mutable status objects. Callers translate their current state into these
 * primitive inputs, then decide how to present and consume the result.
 */

export function heightModifier(
  attackerHeight,
  defenderHeight,
  highGroundMultiplier = 1.25,
  lowGroundMultiplier = 0.8,
) {
  if (attackerHeight > defenderHeight) return highGroundMultiplier;
  if (attackerHeight < defenderHeight) return lowGroundMultiplier;
  return 1;
}

/**
 * The four ways a unit can be looking, indexed by quarter-turns of the yaw the
 * scene graph already stores. `rotation.y = atan2(dx, dz)` is the convention
 * every writer of a facing uses (`faceToward`, the facing picker, the roster's
 * opening orientation), so yaw 0 is +z and the ring runs clockwise from there.
 */
export const FACING_VECTORS = Object.freeze(
  [[0, 1], [1, 0], [0, -1], [-1, 0]].map(Object.freeze),
);

/**
 * Which way a unit stands, from the one yaw the game already keeps.
 *
 * Facing is deliberately DERIVED rather than stored a second time. It has
 * exactly one writer today — the scene-graph yaw — and a duplicate domain field
 * would be a second thing to keep in step through movement, the facing picker,
 * the undo snapshot and the militia's end-of-turn turn-to-face. That is trap 2
 * in a different costume: two representations of one fact, one of which goes
 * quietly stale.
 */
export function facingFromAngle(rotationY) {
  const quarter = Math.PI / 2;
  const q = ((Math.round(rotationY / quarter) % 4) + 4) % 4;
  return FACING_VECTORS[q];
}

/**
 * Is the attacker standing in the defender's REAR quadrant?
 *
 * The genre's rule, not a half-plane: the board is cut into four quadrants by
 * the diagonals through the defender, so a strike from directly behind is a
 * rear attack and one from behind-and-to-the-side is a flank, which gets
 * nothing. `back > side` is exactly that test — how far behind the attacker
 * lies, against how far off the axis it stands. Same-tile and unknown facings
 * are never rear.
 *
 * Melee reaches only cardinal neighbours, so for a knight this means striking
 * the tile directly behind. It matters far more for bows, which can sit
 * anywhere in the quadrant.
 */
export function isRearAttack(attacker, defender, facing) {
  if (!facing) return false;
  const dx = attacker.x - defender.x;
  const dz = attacker.z - defender.z;
  if (!dx && !dz) return false;
  const back = -(dx * facing[0] + dz * facing[1]);
  const side = Math.abs(dx * facing[1] - dz * facing[0]);
  return back > side;
}

export function damageProfile({
  power,
  scale = 1,
  height = 1,
  defending = false,
  lowVariance = 0.82,
  highVariance = 1.18,
}) {
  let base = power * scale * height;
  if (defending) base /= 2;
  return {
    base,
    lowVariance,
    highVariance,
    lo: Math.max(1, Math.round(base * lowVariance)),
    hi: Math.max(1, Math.round(base * highVariance)),
    mid: Math.max(1, Math.round(base)),
  };
}

export function attackProfile({
  power,
  baseScale = 1,
  isRanged = false,
  distance = Infinity,
  aimed = false,
  marked = false,
  rear = false,
  adjacencyPenalty = 1,
  aimMultiplier = 1,
  markMultiplier = 1,
  rearMultiplier = 1,
  // Formation support (rules.massedVolley): a shooter in a formed rank hits
  // harder. Multiplies like height does rather than replacing anything.
  supportMultiplier = 1,
  height = 1,
  defending = false,
  lowVariance = 0.82,
  highVariance = 1.18,
}) {
  const consumesAim = isRanged && aimed;
  const consumesMark = marked;
  // A rear hit multiplies like height does: it scales the blow rather than
  // replacing anything, so it stacks with high ground, a steadied bow and the
  // mark. The multiplier is 1 when the rule is off, and geometry alone is then
  // not a rear ATTACK — otherwise the forecast would announce a bonus of ×1 on
  // every flank in a build that does not have the rule.
  const fromRear = !!rear && rearMultiplier > 1;
  let scale = baseScale;
  if (isRanged && distance <= 1) scale *= adjacencyPenalty;
  if (consumesAim) scale *= aimMultiplier;
  if (consumesMark) scale *= markMultiplier;
  if (fromRear) scale *= rearMultiplier;
  if (supportMultiplier !== 1) scale *= supportMultiplier;
  return {
    ...damageProfile({
      power,
      scale,
      height,
      defending,
      lowVariance,
      highVariance,
    }),
    scale,
    consumesAim,
    consumesMark,
    // the forecast says so out loud, so a player can tell a big number from a
    // flanked one rather than having to infer the rule
    fromRear,
    rearMultiplier: fromRear ? rearMultiplier : 1,
    supportMultiplier,
  };
}

export function rollDamage(profile, random = Math.random) {
  const variance =
    profile.lowVariance +
    random() * (profile.highVariance - profile.lowVariance);
  return Math.max(1, Math.round(profile.base * variance));
}
