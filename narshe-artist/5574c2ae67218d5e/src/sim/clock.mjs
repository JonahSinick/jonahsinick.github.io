/**
 * The headless sim's clock.
 *
 * A battle is a tree of delayed callbacks — `later(fn, ms)` for pacing, a tween
 * per animation leg — and in the browser both are paid in wall time: the QA
 * bots spend ~40-75 seconds per playthrough waiting out animations that exist
 * for a human's eye. Nothing about the RULES needs that wait; what the rules
 * need is the ORDER those callbacks resolve in.
 *
 * So this keeps the order and throws away the waiting. Time is a number that
 * only moves when the next scheduled callback is due, ties break by scheduling
 * order, and `drain()` runs the battle forward until nothing is pending. A
 * playthrough costs milliseconds instead of a minute, and stays bit-identical
 * because every duration in the game is still honoured — in virtual units.
 *
 * The two schedulers stay separate on purpose, exactly as they are on the page:
 * `later` runs through `core/scheduler.mjs` (so `cancelAll()` at the end of a
 * battle drops pending gameplay timers), while tweens do not — a fade already
 * in flight when the battle is decided still finishes there, and must here.
 */

/** A callback queue ordered by (due time, scheduling order). */
export function createSimClock() {
  let now = 0;
  let seq = 0;
  let queue = [];

  /** Schedule `fn` `delay` virtual milliseconds from now. Returns a handle. */
  function setTimer(fn, delay = 0) {
    const entry = {
      at: now + Math.max(0, Number(delay) || 0),
      seq: seq++,
      fn,
      cancelled: false,
    };
    queue.push(entry);
    return entry;
  }

  function clearTimer(entry) {
    if (entry) entry.cancelled = true;
  }

  /**
   * Run the next due callback. Returns false when nothing is pending, which is
   * what "the battle is waiting for the player" looks like from out here.
   */
  function step() {
    let best = -1;
    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      if (entry.cancelled) continue;
      if (best < 0) { best = i; continue; }
      const winner = queue[best];
      if (entry.at < winner.at || (entry.at === winner.at && entry.seq < winner.seq)) best = i;
    }
    if (best < 0) { queue = []; return false; }
    const entry = queue.splice(best, 1)[0];
    if (queue.length > 64) queue = queue.filter(pending => !pending.cancelled);
    now = Math.max(now, entry.at);
    entry.fn();
    return true;
  }

  /**
   * Run until nothing is pending. The cap is a stuck-battle guard, not a
   * budget: a callback chain that never settles is a bug, and a sim that spins
   * forever reports it as a timeout instead of hanging a test runner.
   */
  function drain(maxSteps = 200000) {
    let steps = 0;
    while (steps < maxSteps && step()) steps++;
    if (steps >= maxSteps)
      throw new Error(`sim clock: ${maxSteps} callbacks without settling (runaway chain?)`);
    return steps;
  }

  return {
    setTimer,
    clearTimer,
    step,
    drain,
    now: () => now,
    pending: () => queue.filter(entry => !entry.cancelled).length,
  };
}

/**
 * The page's `tween(seconds, onUpdate, onDone)` against a virtual clock.
 *
 * A tween's job in the rules is to delay whatever `onDone` does by its own
 * duration; the intermediate frames only move meshes. So the sim runs the final
 * frame and the completion, at the moment the tween would really have ended.
 * That is what keeps a projectile's flight time — which varies with the
 * distance it covers — ordered against everything else the way it is on screen.
 *
 * Deliberately NOT on the `later` scheduler: see the module header.
 */
export function createSimTweens(clock) {
  let live = 0;
  function tween(seconds, onUpdate, onDone) {
    live++;
    clock.setTimer(() => {
      live--;
      if (onUpdate) onUpdate(1);
      if (onDone) onDone();
    }, Math.max(0, (Number(seconds) || 0) * 1000));
  }
  return { tween, inFlight: () => live };
}
