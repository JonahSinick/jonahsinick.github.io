/**
 * Experiment batch 1's three player policies, ported from `tools/`.
 *
 * These exist because main's kit policy scores 0/200 under the batch's rules:
 * it kites at square range, shoots through bodies and respects no minimum, so
 * it is not playing this game. Measuring a batch configuration with it would
 * measure the gap between the bot and the rules rather than the balance — the
 * policy-config pairing lesson, which this project has now learned four times.
 *
 * ONE OF THE THREE HAS SINCE GRADUATED. `kit-v4` is battle 1's registered gate
 * as of 2026-08-03, when `rules.smartMilitia` shipped on and took the old
 * policy's competence with it; it lives here still because this is where it was
 * written, not because it is unblessed. `tandem-plain` and `alch-hunt` remain
 * batch instruments, asked for by name.
 *
 *   tandem-plain  formation, NO abilities. Must LOSE. The falsifier for
 *                 "abilities are essential": if attack-only play in good
 *                 formation wins, the doctrine is broken rather than working.
 *   kit-batch     the same formation WITH the kit, opportunistically — move,
 *                 swing, and spend the action on an ability only when there
 *                 was no swing. Must WIN. Ordering is the whole lesson: the
 *                 cut that cast BEFORE moving was worse than using no
 *                 abilities at all, because abilities were not adding damage,
 *                 they were replacing it.
 *   alch-hunt     tandem-plain with alchemists first in target selection —
 *                 Jonah's ability-free win against lethal poison, encoded. An
 *                 instrument, not a gate: it is a regression FLOOR, and the
 *                 claim a bot can support is "beats every strategy found so
 *                 far", never a certification.
 *
 * Ported under `policies/kit.mjs`'s rules: Python's `min(key=...)` is `minBy`
 * with an array key, and every ablation that was an environment variable is an
 * explicit option, so a policy can be pinned to a fixture.
 */

import { cheb, minBy } from '../bot.mjs';
import * as tandem from './tandem.mjs';

const MAX_ROUNDS = 20;

/**
 * The rule set these three policies were written for, written out as a
 * `?rules=` spec instead of inherited from the battle descriptor.
 *
 * Every flag the batch built ships OFF on main — they are experiments awaiting
 * Jonah's per-element verdict — so a replay that takes the descriptor's
 * defaults plays MAIN's game, in which these policies are not the right
 * instrument (see this file's header). Anything measuring them has to name the
 * configuration, and it starts at `none` so it names ALL of it, `lastStanding`
 * included, rather than adding to whatever the descriptor happens to declare.
 */
export const BATCH_RULES = [
  'none', 'rearAttack', 'archerMinRange', 'defendCostsTp', 'dangerTiles',
  'diamondRange', 'arrowLos', 'aggressiveDefense', 'smartMilitia',
  'lethalPoison', 'lastStanding',
].join(',');

const alive = (bot, team) => bot.live(team);
const isAlchemist = f => f.cls === 'alchemist';

/** Everything in this unit's shooting envelope, near edge included. */
function shootable(bot, me, foes) {
  const near = me.minReach ?? 1, far = me.reach ?? 1;
  return foes.filter(f => {
    const d = tandem.dist(bot, me, f);
    return d >= near && d <= far;
  });
}

/** Prefer something we can finish; otherwise the nearest arrival. */
function bestShot(bot, me, foes) {
  const shots = shootable(bot, me, foes);
  if (!shots.length) return null;
  const killable = shots.filter(f => f.hp <= (me.atk ?? 0));
  return minBy(killable.length ? killable : shots,
    f => [f.hp, tandem.dist(bot, me, f)]);
}

/**
 * The victim of committed fire buys a guard. For `rules.stickyFocus`, where
 * rotating a hurt unit out no longer sheds the attention — the answer has to be
 * surviving the volley instead of dodging it. Note it does NOTHING against
 * poison: `defending` is read only on the attack path, so under lethal poison
 * this spends an action and the victim dies anyway. Policy must match threat.
 */
function braceIfHunted(bot, me, foes) {
  const victim = tandem.likelyVictim(bot, foes);
  if (!victim || victim.name !== me.name) return false;
  if (me.hp >= 0.6 * me.maxHp) return false;
  return !!bot.defend();
}

// ------------------------------------------------------- tandem: no abilities
export function tandemTurn(bot, s) {
  const foes = alive(bot, 'enemy');
  let me = bot.me();
  if (!foes.length || !me) return;

  let target = bestShot(bot, me, foes);
  if (target && bot.attackAt(target.x, target.z)) return;

  me = tandem.step(bot, me, s, foes);
  if (!me) return;

  target = bestShot(bot, me, alive(bot, 'enemy'));
  if (target && bot.attackAt(target.x, target.z)) return;

  if (bot.defend()) return;
  bot.wait();
}

// ------------------------------------------------------- alchemist hunt
/**
 * "First" is meant literally: an alchemist in reach outranks an archer one hit
 * from falling. Softening it into a tiebreak would preserve a different
 * strategy from the one Jonah played.
 */
function huntShot(bot, me, foes) {
  const shots = shootable(bot, me, foes);
  if (!shots.length) return null;
  // The Python key is `(f["cls"] != "alchemist", ...)`, and False sorts FIRST:
  // an alchemist scores 0 and everything else 1. Writing the predicate the
  // other way round — the natural-reading `isAlchemist ? 1 : 0` — inverts the
  // whole policy into "alchemists last", and it did: the ported bot then made
  // exactly the same moves as the ability-free control, seed for seed, which is
  // what caught it.
  return minBy(shots, f => [isAlchemist(f) ? 0 : 1, f.hp > (me.atk ?? 0) ? 1 : 0,
    f.hp, tandem.dist(bot, me, f)]);
}

export function alchHuntTurn(bot, s) {
  const foes = alive(bot, 'enemy');
  let me = bot.me();
  if (!foes.length || !me) return;

  let target = huntShot(bot, me, foes);
  if (target && bot.attackAt(target.x, target.z)) return;

  me = tandem.step(bot, me, s, foes);
  if (!me) return;

  target = huntShot(bot, me, alive(bot, 'enemy'));
  if (target && bot.attackAt(target.x, target.z)) return;

  if (bot.defend()) return;
  bot.wait();
}

// ------------------------------------------------------- kit: the ability line
function cassien(bot, s) {
  const foes = alive(bot, 'enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const mk = s.mark;
  const marked = mk && mk.caster === 'Cassien'
    ? foes.find(f => f.name === mk.target) : null;

  // Cash the mark first if it is in reach, else hit whatever is touching.
  const swing = unit => {
    if (!unit) return false;
    if (marked && tandem.dist(bot, unit, marked) === 1
      && bot.attackAt(marked.x, marked.z)) return true;
    const touching = alive(bot, 'enemy').filter(f => tandem.dist(bot, unit, f) === 1);
    if (!touching.length) return false;
    const hurt = minBy(touching, f => f.hp);
    return bot.attackAt(hurt.x, hurt.z);
  };

  if (swing(me)) return;
  me = tandem.step(bot, me, s, foes);
  if (!me) return;
  if (swing(me)) return;

  // No swing was available, so the action is free — NOW the kit is a gain
  // rather than a substitution.
  const sick = alive(bot, 'player').filter(u => u.poison > 0
    && tandem.dist(bot, me, u) <= 2 && u.hp < 0.7 * u.maxHp);
  if (sick.length && bot.abils().includes('purify')
    && bot.cast('purify', sick[0].x, sick[0].z)) {
    bot.note(`purify -> ${sick[0].name}`);
    return;
  }

  const near = minBy(foes, f => tandem.dist(bot, me, f));
  if (!marked && bot.abils().includes('anger') && tandem.dist(bot, me, near) <= 4
    && bot.cast('anger', near.x, near.z)) {
    bot.note(`anger -> ${near.name}`);
    return;
  }

  if (braceIfHunted(bot, me, foes) || bot.defend()) return;
  bot.wait();
}

function brecht(bot, s) {
  const foes = alive(bot, 'enemy');
  let me = bot.me();
  if (!foes.length || !me) return;

  let target = bestShot(bot, me, foes);
  if (target && bot.attackAt(target.x, target.z)) return;

  me = tandem.step(bot, me, s, foes);
  if (me) {
    target = bestShot(bot, me, alive(bot, 'enemy'));
    if (target && bot.attackAt(target.x, target.z)) return;
  }
  if (me && braceIfHunted(bot, me, foes)) return;
  // An aimed stance never decays, so banking the x2 for the next arrival is free.
  if (me && !me.aimed && bot.abils().includes('aim') && bot.cast('aim')) {
    bot.note('steady the bow');
    return;
  }
  bot.wait();
}

function seira(bot, s) {
  const foes = alive(bot, 'enemy');
  let me = bot.me();
  if (!foes.length || !me) return;

  // The grief-note pays when it catches two or more. The burst is SQUARE even
  // under diamondRange, so it is measured with cheb deliberately.
  const clump = unit => alive(bot, 'enemy').filter(f => cheb(unit, f) <= 2);
  if (clump(me).length >= 2 && bot.abils().includes('cry') && bot.cast('cry')) {
    bot.note(`cry catches ${clump(me).length}`);
    return;
  }

  let target = bestShot(bot, me, foes);
  if (target && bot.attackAt(target.x, target.z)) return;

  me = tandem.step(bot, me, s, foes);
  if (me) {
    if (clump(me).length >= 2 && bot.abils().includes('cry') && bot.cast('cry')) {
      bot.note(`cry catches ${clump(me).length}`);
      return;
    }
    target = bestShot(bot, me, alive(bot, 'enemy'));
    if (target && bot.attackAt(target.x, target.z)) return;
  }
  if (me && braceIfHunted(bot, me, foes)) return;
  bot.wait();
}

const BY_NAME = { Cassien: cassien, Brecht: brecht, Seira: seira };

export function kitBatchTurn(bot, s) {
  const fn = BY_NAME[s.cur];
  if (fn) fn(bot, s);
  else bot.wait();
}

// ------------------------------------------------------- verdicts
const standing = roster => roster.filter(u => u.team === 'player' && u.alive).length;
/**
 * Every verdict below asks the ENGINE what happened rather than re-deriving it
 * from the roster, so each one tracks whichever outcome rule is in force.
 * Re-deriving hard-codes one: under `rules.lastStanding` an ability-free line
 * that loses an imperial and takes the gate anyway has WON, and scoring that as
 * a loss would hide exactly the regression these instruments exist to catch —
 * while at `?rules=none` the old any-imperial-falls rule still has to be read
 * correctly for the flags-off comparison to mean anything.
 */

export const kitBatchPolicy = {
  // v4: the tandem formation plus the guard-the-hunted-unit rule. Named for
  // the version deliberately -- main's sim shipped v3.1 as `kit-v3`, and two
  // policies both called "kit" is how a matrix silently measures the old
  // doctrine while passing parity.
  //
  // BATTLE 1'S REGISTERED GATE since 2026-08-03 (`rules.smartMilitia`, Jonah).
  // It was always the doctrine `tools/kit_bot.py` plays and always what the
  // `kit` fixture records -- the browser gate has run v4 since the batch merged
  // -- so the swap registered the sim's port of the shipped bot in place of the
  // port of a bot that no longer exists. See policies/index.mjs.
  id: 'kit-v4',
  fixture: 'kit',
  battle: null,
  maxRounds: MAX_ROUNDS,
  gate: true,
  turn: kitBatchTurn,
  /**
   * tools/kit_bot.py. The doctrine claim is deliberately STRICTER than the
   * engine's: a no-loss win is the design target for the ability line, so
   * `pass` asks for all three standing while `won` reports what the engine
   * ruled. Both go in the matrix.
   */
  verdict(roster, state, outcome = null) {
    const alive = standing(roster);
    const players = roster.filter(u => u.team === 'player').length;
    return {
      won: outcome === 'victory',
      pass: outcome === 'victory' && alive === players,
      standing: alive, round: state.round,
    };
  },
};

export const tandemPolicy = {
  id: 'tandem-plain',
  battle: null,
  maxRounds: MAX_ROUNDS,
  gate: true,
  turn: tandemTurn,
  /**
   * tools/tandem_bot.py: a WIN is the FAILURE. Ability-free play clearing the
   * field means attack-only play beats the militia and the doctrine is broken.
   */
  verdict(roster, state, outcome = null) {
    const won = outcome === 'victory';
    return { won, pass: !won, standing: standing(roster), round: state.round };
  },
};

export const alchHuntPolicy = {
  id: 'alch-hunt',
  battle: null,
  maxRounds: MAX_ROUNDS,
  /**
   * An INSTRUMENT, deliberately. It encodes a human-found exploit and makes no
   * doctrine claim: no configuration is ever reported as certified from bot
   * evidence, and a bot suite's strongest claim is "beats every strategy found
   * so far". Its rate is the floor, and the human remains the arbiter.
   */
  gate: false,
  turn: alchHuntTurn,
  verdict(roster, state, outcome = null) {
    const won = outcome === 'victory';
    return { won, pass: !won, standing: standing(roster), round: state.round };
  },
};
