/**
 * Domain rules flags: the switches that change what the GAME is, not how it
 * looks or how fast it runs.
 *
 * The project already has two kinds of knob. `?idlefps=` and the tuning panel
 * move presentation and provisional numbers; `__BATTLE.seed()` and `fast()`
 * retune the harness. Neither can express "does an attack from behind deal
 * more", because that is a rule the sim itself has to read — the balance bots
 * and the golden logs must be able to run against any combination of them, and
 * a rule hidden behind a branch in a UI module cannot be combined with anything.
 *
 * So a rule flag is declared by the battle descriptor (per-battle defaults),
 * overridable from the URL (`?rules=`) and from `__BATTLE.setRule()`, and read
 * LIVE at every use site — never captured at construction, for the reason
 * AGENT_BRIEF's trap 2 gives: a flag flipped mid-battle by a gate has to take
 * effect on the next attack, not on the next page load.
 *
 * `?rules=` takes a comma-separated list of tokens, applied left to right:
 *
 *   ?rules=none                      every flag off
 *   ?rules=all                       every flag on
 *   ?rules=none,rearAttack           only the rear-attack bonus
 *   ?rules=-defendCostsTp            this battle's defaults minus one flag
 *
 * A token may be prefixed `-` or `no-` to turn its flag off. Unrecognised
 * tokens are collected rather than thrown: a mistyped URL should still give the
 * player a game, the same contract `resolveBattle` keeps. `__BATTLE.rules()`
 * reports them so a gate can assert it actually got the configuration it asked
 * for instead of silently testing the defaults.
 */

/**
 * Every flag, with what it means. The list is the schema: a descriptor that
 * declares something not named here is reported as unknown rather than obeyed.
 */
export const RULE_FLAGS = Object.freeze({
  /** An attack landing in the target's rear quadrant is multiplied. */
  rearAttack: 'rear-attack damage bonus (gives the facing picker its purpose)',
  /**
   * Bows cannot shoot at all inside their minimum range. BOWS ONLY (Jonah,
   * 2026-08-02): a bolt and a lobbed flask are not wound up, so neither is
   * refused point blank.
   */
  archerMinRange: 'hard minimum archery range, replacing the adjacent-shot penalty',
  /** Guarding is bought with the same currency abilities are. */
  defendCostsTp: 'Defend costs 1 TP, so it competes with abilities; Wait stays free',
  /** Move mode shades reachable tiles by enemy threat, and draws its arcs. */
  dangerTiles: 'danger-zone tile shading and hover threat arcs',
  /** Reach is measured as a diamond, the genre convention, not as a square. */
  diamondRange: 'Manhattan (diamond) weapon and ability range, replacing Chebyshev',
  /** An arrow cannot pass through a body — bows only, height ignored in v1. */
  arrowLos: 'arrows are blocked by any unit standing in the lane',
  /** Prepared defenders advance instead of the flask's range creeping. */
  aggressiveDefense: 'militia advance once prepared; flask-range escalation off',
  /**
   * The militia's AI improvements as one switch: the alchemist that used to
   * flee-and-brace without ever throwing, the archers steadying rather than
   * bracing at an empty horizon, and guards bought only when they are worth
   * buying. Flagged because they MOVE BATTLE 1'S LOCKED BALANCE — with this
   * off, `?rules=none` reproduces main, which is what makes the flags-off
   * golden gate meaningful and a merge safe.
   */
  smartMilitia: 'militia AI improvements (alchemist throws, archers steady, guards budgeted)',
  /** The militia finish a victim instead of re-picking by position each turn. */
  stickyFocus: 'militia commit focus fire to one target until it falls',
  /**
   * Poison kills if it is not cleansed, which makes Purify a CAPABILITY check
   * rather than a convenience. Plain attacks have no answer to it at all —
   * which is the point: the doctrine needs abilities to do what attacking
   * cannot, and no amount of damage substitutes for a cleanse.
   */
  lethalPoison: 'poison is lethal uncleansed, so Purify answers what attacks cannot',
  /**
   * Militia shooting from a formed rank hit harder, so a clustered firing line
   * is genuinely dangerous — and the answer is to break the cluster in one
   * action, which only Mournful Cry can do. Legible in fiction (they are
   * volleying in ranks) and it gives Seira's wade-in identity its purpose.
   */
  massedVolley: 'militia hit harder per adjacent ally; clusters answered by AoE',
  /**
   * Poison measured against the victim rather than in flat points. Flat lethal
   * poison is 10 a turn for four turns — exactly Seira's 40 maximum — so one
   * unanswered flask does not cost the mage something, it deletes her, and
   * deleting the two units that can throw one becomes the dominant reply.
   * Scaling de-targets the threat: it is the same fraction of everybody, so
   * the flask is a serious wound to whoever catches it instead of an execution
   * aimed at one member of the party.
   */
  scaledPoison: 'poison damage is a fraction of the victim’s maximum HP, not flat points',
  /**
   * A third alchemist, deployed deep. Redundancy rather than protection: the
   * geometry says a range-3 thrower cannot be kept away from a range-4 bow and
   * a range-3 mage, so the answer to "the check is two removable units" is more
   * carriers, not a better screen.
   */
  thirdAlchemist: 'a third alchemist joins the deployment, so the poison check outlives a hunt',
  /**
   * RULED (Jonah, 2026-08-02, via the lead session): a battle is lost only when
   * NO player unit is left standing, in BOTH encounters — retiring both battle
   * 1's any-imperial-falls rule and the warning bell's Seira-only one. Fallen
   * imperials are DOWNED rather than dead, so the story still has all three
   * afterwards, the way an FF6 party recovers on victory.
   *
   * It is a RULING, not an experiment: it ships on, and the descriptors carry
   * it. It is a flag anyway for one reason — `?rules=none` has to keep
   * reproducing main, and the outcome rule decides when a run STOPS, so
   * without the flag every golden fixture and every parity check against main
   * would diverge for a reason unrelated to the rules under trial.
   */
  lastStanding: 'a battle is lost only when no player unit stands; the fallen are downed, not dead',
  /**
   * RULED (Jonah, 2026-08-16, from playing battle 1): Seira could walk onto a
   * tile a fallen militiaman was lying on and stand inside the body. Downed-
   * not-dead means the bodies STAY on the field — nothing is ever removed or
   * faded — so a tile with a body on it has something on it, and movement has
   * to see that. It is a ruling, not an experiment: it ships on.
   *
   * A flag anyway, for `lastStanding`'s exact reason — it moves where units may
   * stand, so it moves pathing, so without the flag `?rules=none` would stop
   * reproducing pre-batch main and every parity fixture would diverge for a
   * reason unrelated to the rules under trial.
   *
   * Only STANDING is refused. A body is prone: the walk steps over it, the way
   * it already steps through an ally. Making a corpse solid would let the
   * fallen wall off a terrace and carve the field into pockets the AI stalls
   * in, which is the failure `approachCost` exists to have fixed.
   */
  bodiesBlock: 'the fallen hold their tile: nobody may end a move standing on a body',
  /** Two more bows on the flanks of the middle terrace — a wider front. */
  moreMilitia: 'a denser militia line: two extra miner-archers on the flanks',
  /**
   * Trades the yard's bow for an alchemist rather than adding one: with
   * `thirdAlchemist` it makes the line 3 bows and 3 flasks at the SAME head
   * count, which is a composition question rather than a difficulty one.
   */
  swapArcher: 'the yard bow is not fielded (pair with thirdAlchemist for a 3-and-3 line)',
});

export const RULE_NAMES = Object.freeze(Object.keys(RULE_FLAGS));

/** Every flag off: what "no experiment is running" means. */
export function defaultRules() {
  const out = {};
  for (const name of RULE_NAMES) out[name] = false;
  return out;
}

/**
 * Parse one `?rules=` value into an ordered list of operations. Exported for
 * its own test: this is string handling, and string handling that decides
 * whether a balance gate ran the configuration it thinks it ran is worth
 * testing directly rather than through a browser.
 */
export function parseRuleSpec(spec) {
  const ops = [];
  const unknown = [];
  for (const raw of String(spec || '').split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const lower = token.toLowerCase();
    if (lower === 'all') { ops.push({ all: true, on: true }); continue; }
    if (lower === 'none') { ops.push({ all: true, on: false }); continue; }
    const off = token.startsWith('-') || lower.startsWith('no-');
    const bare = token.replace(/^-/, '').replace(/^no-/i, '');
    const name = RULE_NAMES.find(n => n.toLowerCase() === bare.toLowerCase());
    if (!name) { unknown.push(token); continue; }
    ops.push({ name, on: !off });
  }
  return { ops, unknown };
}

/**
 * The live flag set for one battle: descriptor defaults, then the URL, then
 * whatever a gate flips at runtime.
 *
 * `get` is the only read, and every consumer calls it at the moment it needs
 * the answer. That is what lets `tools/*_bot.py` run the same page under four
 * different rule sets without reloading it.
 */
export function createRules(defaults = {}, spec = null) {
  const state = defaultRules();
  const unknown = [];
  for (const [name, on] of Object.entries(defaults || {})) {
    if (RULE_NAMES.includes(name)) state[name] = !!on;
    else unknown.push(name);
  }
  const parsed = parseRuleSpec(spec);
  unknown.push(...parsed.unknown);
  for (const op of parsed.ops) {
    if (op.all) for (const name of RULE_NAMES) state[name] = op.on;
    else state[op.name] = op.on;
  }
  return {
    get(name) { return !!state[name]; },
    set(name, on) {
      if (!RULE_NAMES.includes(name)) return null;
      state[name] = !!on;
      return state[name];
    },
    all() { return { ...state }; },
    /** Descriptor keys and URL tokens this build does not recognise. */
    unknown() { return unknown.slice(); },
  };
}
