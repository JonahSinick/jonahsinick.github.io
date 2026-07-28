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
  adjacencyPenalty = 1,
  aimMultiplier = 1,
  markMultiplier = 1,
  height = 1,
  defending = false,
  lowVariance = 0.82,
  highVariance = 1.18,
}) {
  const consumesAim = isRanged && aimed;
  const consumesMark = marked;
  let scale = baseScale;
  if (isRanged && distance <= 1) scale *= adjacencyPenalty;
  if (consumesAim) scale *= aimMultiplier;
  if (consumesMark) scale *= markMultiplier;
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
  };
}

export function rollDamage(profile, random = Math.random) {
  const variance =
    profile.lowVariance +
    random() * (profile.highVariance - profile.lowVariance);
  return Math.max(1, Math.round(profile.base * variance));
}
