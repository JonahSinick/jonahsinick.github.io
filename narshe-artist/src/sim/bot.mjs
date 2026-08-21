/**
 * The bot-facing half of the sim: `tools/botlib.py`, minus the browser.
 *
 * The Python harness reads the board through `window.__BATTLE` and writes
 * through the same five actions, then polls until the animation it just started
 * has finished. Here the same reads and writes go to the same `battle-api.mjs`
 * surface, and "poll until it settles" becomes "drain the virtual clock" — the
 * two are the same statement about when a bot is allowed to look again, and
 * that is why a policy ports across as a transport change rather than a rewrite.
 *
 * The comparator helpers exist for the same reason. Every doctrine policy in
 * this project was written in Python against `min`/`max`/`sorted` with tuple
 * keys, whose semantics are exact and not JavaScript's: tuples compare
 * lexicographically, `False < True`, and both `min` and `max` return the FIRST
 * extremal element rather than the last. A policy ported with `Math.min` or a
 * bare `sort` is a DIFFERENT policy, and it will diverge from the fixture on a
 * tie three rounds in with nothing to point at. So the semantics are provided
 * once, here, and the ports read like their originals.
 */

/**
 * Python tuple ordering: elementwise, lexicographic, booleans as 0/1, and
 * strings by their own order — `warbell_kit_bot.py` breaks a hit-point tie on
 * the unit's NAME, so a numeric-only comparator would silently make that tie
 * arbitrary rather than deterministic.
 */
export function compareKeys(a, b) {
  const left = Array.isArray(a) ? a : [a];
  const right = Array.isArray(b) ? b : [b];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = typeof left[i] === 'string' ? left[i] : +left[i];
    const y = typeof right[i] === 'string' ? right[i] : +right[i];
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Python `min(list, key=...)`: the FIRST element with the smallest key. */
export function minBy(list, key) {
  let best = null, bestKey = null;
  for (const item of list) {
    const k = key(item);
    if (best === null || compareKeys(k, bestKey) < 0) { best = item; bestKey = k; }
  }
  return best;
}

/** Python `max(list, key=...)`: the FIRST element with the largest key. */
export function maxBy(list, key) {
  let best = null, bestKey = null;
  for (const item of list) {
    const k = key(item);
    if (best === null || compareKeys(k, bestKey) > 0) { best = item; bestKey = k; }
  }
  return best;
}

/** Python `sorted(list, key=...)`: stable, ascending. */
export function sortedBy(list, key) {
  return [...list].sort((a, b) => compareKeys(key(a), key(b)));
}

export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
export const manh = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);

/**
 * A policy's handle on the battle. Field-for-field the surface `botlib.Bot`
 * exposes, so a ported policy calls the same names in the same order.
 */
export function createSimBot(sim) {
  const bot = {
    sim,
    api: sim.api,
    trace: [],
    /** scratch the doctrine policies hang their own state on (kit's stall break) */
    pressing: false,

    // ---- reads
    state: () => sim.api.state(),
    roster: () => sim.api.roster(),
    reach: () => sim.api.reach(),
    abils: () => sim.api.abils(),
    live: team => sim.api.roster().filter(u => u.alive && u.team === team),
    me() {
      const cur = sim.api.state().cur;
      return sim.api.roster().find(u => u.name === cur) || null;
    },
    here: u => ({ x: u.x, z: u.z, d: 0 }),

    // ---- writes. Each one settles the battle before the policy looks again,
    // which is what botlib's move_to/attack_at polling buys in the browser.
    moveTo(x, z) {
      if (!sim.api.moveTo(x, z)) return false;
      sim.drain();
      return true;
    },
    attackAt(x, z) {
      if (!sim.api.attackAt(x, z)) return false;
      sim.drain();
      return true;
    },
    cast(key, x = 0, z = 0) {
      if (!sim.api.cast(key, x, z)) return false;
      sim.drain();
      return true;
    },
    defend() {
      const ok = sim.api.defend();
      sim.drain();
      return ok;
    },
    wait() {
      sim.api.wait();
      sim.drain();
    },
    note(message, who = null) {
      const s = sim.api.state();
      bot.trace.push(`r${s.round} ${who || s.cur || '-'} ${message}`);
    },
  };
  return bot;
}

/**
 * `botlib.play`: run player turns through `turnFn` until the battle ends or the
 * round cap hits. A turn that decided nothing still has to end, which is the
 * last clause — without it a policy that falls through every branch spins.
 */
export function playSim(bot, turnFn, { maxRounds = 14, stop = null, trace = false } = {}) {
  bot.sim.begin();
  let guard = 0, seen = -1;
  while (guard++ < 600) {
    const s = bot.state();
    if (trace && s.round !== seen) {
      seen = s.round;
      const roster = bot.roster();
      bot.trace.push(`R${seen}  ${roster.filter(u => u.team === 'player')
        .map(u => `${u.name.slice(0, 3)} ${Math.max(0, u.hp)}${u.poison ? 'p' : ''}`).join('  ')}` +
        `   | enemies up: ${roster.filter(u => u.team === 'enemy' && u.alive).length}`);
    }
    if (s.phase === 'over') break;
    if (s.round > maxRounds) break;
    if (stop && stop(bot)) break;
    if (s.phase !== 'player') {
      // In the browser this is "wait 120ms and look again". Here, nothing
      // pending and not the player's turn is a stuck battle, not a slow one.
      if (bot.sim.drain() === 0)
        throw new Error(`sim: stalled in phase "${s.phase}" with nothing scheduled`);
      continue;
    }
    const before = [s.round, s.qi, s.cur];
    turnFn(bot, s);
    const after = bot.state();
    if (after.phase === 'player' &&
        after.round === before[0] && after.qi === before[1] && after.cur === before[2])
      bot.wait();
  }
  return bot.state();
}
