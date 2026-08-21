/**
 * Balance gate B's doctrine, ported from `tools/kit_bot.py`.
 *
 * A line-by-line port, deliberately: same branch order, same comparator keys,
 * same points at which the board is re-read. The Python reads the board only
 * through `__BATTLE` and its whole policy is arithmetic over `reach()`/`live()`/
 * Chebyshev distance, so nothing here had to be re-decided — but a port that
 * "tidied" a comparison would be a different doctrine wearing the same name,
 * and `tests/sim-parity.test.mjs` is what makes that claim checkable rather
 * than asserted.
 *
 * Two Python behaviours the port depends on and JavaScript does not share:
 * `min`/`max` return the FIRST extremal element (never the last), and tuple keys
 * compare lexicographically with `False < True`. Both come from `sim/bot.mjs`;
 * see its header.
 *
 * Where the original captures a roster snapshot and then acts (Cassien's
 * `marked`, Brecht's pre-move `nearest`), the snapshot is kept stale here too.
 * That is not an oversight in either file: enemies cannot move during a player
 * turn, and re-reading would change which tile the policy measures from.
 */

import { cheb, manh, maxBy, minBy, sortedBy } from '../bot.mjs';

const MAX_ROUNDS = 20;

/** How much focus fire lands on tile t next enemy phase. */
function threat(t, foes) {
  let total = 0;
  for (const f of foes) {
    if (f.cls === 'archer') total += cheb(t, f) <= (f.aimed ? 6 : 4) ? 1 : 0;
    else total += cheb(t, f) <= 4 ? 0.5 : 0;                 // alchemist: poison pressure
  }
  return total;
}

const sameTile = (a, b) => a.x === b.x && a.z === b.z;

// ------------------------------------------------------------------ Cassien
function cassien(bot, s) {
  let foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const mk = s.mark;
  let marked = null;
  if (mk && mk.caster === 'Cassien') marked = foes.find(f => f.name === mk.target) || null;
  const goal = marked || minBy(foes, f => [cheb(me, f), f.hp]);
  const endgame = foes.length <= 2 || bot.pressing;
  const hurt = me.hp < (endgame ? 0.30 : 0.55) * me.maxHp;   // pressing lowers caution, never abolishes it

  if (!s.moved) {
    const cands = [bot.here(me)].concat(bot.reach());
    let dest;
    if (hurt) {
      // fall back: fewest guns on him, then southward
      dest = minBy(cands, t => [threat(t, foes), -t.z]);
    } else {
      // advance, but never into more than 2 archers' coverage; take an adjacent
      // tile only when he has a swing worth making
      const cap = endgame ? 99 : 3;
      const adj = cands.filter(t => manh(t, goal) === 1 && threat(t, foes) <= cap);
      const safeish = cands.filter(t => threat(t, foes) <= (endgame ? 99 : 2.5));
      dest = adj.length ? minBy(adj, t => t.d)
        : safeish.length ? minBy(safeish, t => [cheb(t, goal), t.z])
          : minBy(cands, t => [threat(t, foes), cheb(t, goal)]);
    }
    if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
  }

  me = bot.me();
  if (!me) return;
  const can = bot.abils();
  foes = bot.live('enemy');

  // poison is 6 a turn and Purify is the only answer to it
  if (me.poison > 0 && can.includes('purify') && bot.cast('purify', me.x, me.z)) return;
  const sick = bot.live('player').filter(u => u.poison > 0 && cheb(me, u) <= 2);
  if (sick.length && can.includes('purify') && bot.cast('purify', sick[0].x, sick[0].z)) return;

  const touching = foes.filter(f => manh(me, f) === 1);
  if (marked && manh(me, marked) === 1 && bot.attackAt(marked.x, marked.z)) {
    bot.note(`x3 hit -> ${marked.name}`); return;
  }
  // mark first, swing next turn: two turns of mark-then-hit beat two plain swings
  if (!marked && can.includes('anger') && !hurt) {
    const pick = touching.length ? touching : foes.filter(f => cheb(me, f) <= 4);
    if (pick.length) {
      const t = maxBy(pick, f => f.hp);
      if (bot.cast('anger', t.x, t.z)) { bot.note(`anger -> ${t.name}`); return; }
    }
  }
  for (const f of sortedBy(touching, f => f.hp)) {
    if (bot.attackAt(f.x, f.z)) return;
  }
  // under the guns with nothing to swing at: brace for the volley
  if (threat(bot.here(me), foes) > 0) {
    bot.note(`defend (threat ${threat(bot.here(me), foes).toFixed(1)})`);
    bot.defend(); return;
  }
  bot.wait();
}

// ------------------------------------------------------------------ Brecht
function brecht(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  if (me.hp < 0.35 * me.maxHp && !s.moved) {
    // winged: slip out of every firing lane before anything else
    const cands = [bot.here(me)].concat(bot.reach());
    const dest = minBy(cands, t => [threat(t, foes), -t.z]);
    if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
    me = bot.me();
    if (me) {
      for (const f of sortedBy(
        bot.live('enemy').filter(f => 2 <= cheb(me, f) && cheb(me, f) <= me.reach), f => f.hp)) {
        if (bot.attackAt(f.x, f.z)) return;
      }
      if (bot.abils().includes('aim') && bot.cast('aim')) return;
      if (threat(bot.here(me), foes) > 0) { bot.defend(); return; }
    }
  }
  const reach = me.reach;
  const tiles = bot.reach();
  const cands = [bot.here(me)].concat(tiles);

  if (me.aimed) {
    // snipe: stand as far back as the aimed shot still carries
    const good = cands.filter(t => foes.some(f => 2 <= cheb(t, f) && cheb(t, f) <= reach));
    if (good.length && !s.moved) {
      const dest = maxBy(good, t => [
        Math.min(...foes.filter(f => cheb(t, f) <= reach).map(f => cheb(t, f))), -t.d,
      ]);
      if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
    }
    me = bot.me();
    if (me) {
      const shots = sortedBy(
        bot.live('enemy').filter(f => 2 <= cheb(me, f) && cheb(me, f) <= me.reach), f => f.hp);
      for (const f of shots) {
        if (bot.attackAt(f.x, f.z)) return;
      }
    }
  } else {
    // steady the bow from a tile that keeps the militia at arm's length
    if (!s.moved && tiles.length) {
      const dest = maxBy(cands, t => [
        Math.min(...foes.map(f => cheb(t, f))) >= 3,
        -Math.min(...foes.map(f => Math.abs(cheb(t, f) - 5))),
        -t.d,
      ]);
      if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
    }
    // snapshot before the cast ends the turn
    const nearest = Math.min(...foes.map(f => cheb(me, f)));
    if (bot.abils().includes('aim') && bot.cast('aim')) {
      bot.note(`take aim (nearest foe ${nearest})`); return;
    }
    me = bot.me();
    if (me) {
      for (const f of sortedBy(
        bot.live('enemy').filter(f => 2 <= cheb(me, f) && cheb(me, f) <= me.reach), f => f.hp)) {
        if (bot.attackAt(f.x, f.z)) return;
      }
    }
  }
  me = bot.me();
  if (me && threat(bot.here(me), bot.live('enemy')) > 0) { bot.defend(); return; }
  bot.wait();
}

// ------------------------------------------------------------------ Seira
function seira(bot, s) {
  const foes = bot.live('enemy');
  let me = bot.me();
  if (!foes.length || !me) return;
  const cas = bot.live('player').find(u => u.name === 'Cassien') || null;
  const tiles = bot.reach();
  const cands = [bot.here(me)].concat(tiles);

  const caught = t => foes.filter(f => cheb(t, f) <= 2).length;

  // the grief-note is worth 3 TP only when it catches a pair — and never from
  // further up the road than Cassien, or the focus fire swings onto her
  if (s.tp >= 3 && me.hp > 12) {
    const filtered = cands.filter(t => cas === null || t.z >= cas.z);
    const safe = filtered.length ? filtered : cands;
    const best = maxBy(safe, t => [caught(t), -t.d]);
    if (caught(best) >= 2) {
      if (!sameTile(best, me) && !s.moved) bot.moveTo(best.x, best.z);
      if (bot.cast('cry')) { bot.note(`CRY on ${caught(best)}`); return; }
    }
  }

  // otherwise walk up behind Cassien and throw a bolt — staying light on threat
  const score = t => [
    bot.pressing ? 0 : -Math.max(threat(t, foes) - 1, 0),
    foes.some(f => 2 <= cheb(t, f) && cheb(t, f) <= 3),
    cas === null || t.z >= cas.z,
    -Math.min(...foes.map(f => cheb(t, f))),
    -t.d,
  ];

  if (!s.moved && tiles.length) {
    const dest = maxBy(cands, score);
    if (!sameTile(dest, me)) bot.moveTo(dest.x, dest.z);
  }
  me = bot.me();
  if (me) {
    for (const f of sortedBy(
      bot.live('enemy').filter(f => 2 <= cheb(me, f) && cheb(me, f) <= me.reach), f => f.hp)) {
      if (bot.attackAt(f.x, f.z)) return;
    }
  }
  me = bot.me();
  if (me && threat(bot.here(me), bot.live('enemy')) > 0) { bot.defend(); return; }
  bot.wait();
}

const TURN = { Cassien: cassien, Brecht: brecht, Seira: seira };

/**
 * The stall break. Held on the bot rather than in a closure for the same reason
 * the Python hangs it on the bot object: the per-character policies read
 * `bot.pressing`, and it must survive across their turns within a round.
 */
export function kitTurn(bot, s) {
  const hpNow = bot.live('enemy').reduce((sum, u) => sum + Math.max(u.hp, 0), 0);
  const rd = s.round;
  if (rd !== bot.stallRound) {
    if (hpNow < (bot.stallHp ?? Infinity)) bot.stallAt = rd;
    bot.stallHp = hpNow;
    bot.stallRound = rd;
    bot.pressing = rd - (bot.stallAt ?? rd) >= 2;
    if (bot.pressing) bot.note('STALL-BREAK: pressing', 'bot');
  }
  const fn = TURN[s.cur];
  if (fn) fn(bot, s);
}

export const kitPolicy = {
  // Renamed from `kit` when this branch's rewritten policy arrived as kit-v4.
  // A policy that silently measures the OLD doctrine while passing parity is
  // the failure mode that cannot be allowed, and two things both called "kit"
  // is how that happens. The fixture keeps its recorded name.
  id: 'kit-v3',
  fixture: 'kit',
  battle: null,                 // the default Narshe gate encounter
  maxRounds: MAX_ROUNDS,
  // SUPERSEDED 2026-08-03 by `rules.smartMilitia` (Jonah): this doctrine was
  // written against militia that reflex-guard and never throw, and it stops
  // passing when they stop doing that — 38.5% over 1,000 seeds, a round-cap
  // timeout at seed 1. It makes no claim any more; `kit-v4` is battle 1's gate.
  // What it still does is pin `tests/golden/main/kit.json`, pre-batch main's own
  // recording, which needs this exact policy to replay. See policies/index.mjs.
  gate: false,
  turn: kitTurn,
  /** The doctrine gate this policy exists to assert (tools/kit_bot.py). */
  /**
   * ALL-UNITS-DEFEATED (Jonah, 2026-08-02): this claim is now STRICTER than the
   * engine's. The battle is won when the field is cleared and anyone is left
   * standing; the doctrine asks for a NO-LOSS win, because "the abilities let
   * you take the gate without losing anybody" is the design target and
   * "somebody crawled out" is not. Both rates are reported — `pass` is the
   * doctrine, and the matrix's engine W/L column is the engine's own answer.
   */
  verdict(roster, state, outcome = null) {
    const players = roster.filter(u => u.team === 'player');
    const standing = players.filter(u => u.alive).length;
    return {
      won: outcome === 'victory',                            // the engine's
      pass: outcome === 'victory' && standing === players.length,  // the doctrine's
      standing, round: state.round,
    };
  },
};
