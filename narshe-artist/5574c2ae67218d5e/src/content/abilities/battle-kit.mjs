/**
 * The Battle 1 and warning-bell ability kit — one self-contained definition
 * each for Righteous Anger, Purify, Take Aim, Mournful Cry, Poison Flask and
 * Heal.
 *
 * A definition owns everything about its ability that is not the renderer:
 * what the action bar calls it and what it costs, what it may be pointed at
 * (`aim` + `range`, read by `registry.mjs`), what casting it actually does, and
 * the numbers the enemy AI needs in order to plan with it. Adding an ability is
 * adding one entry here — not an edit to the targeting switch, the legality
 * switch, the action bar, the pointer handler, the debug adapter and the AI.
 *
 * Casting is animated, so execution is written against injected page
 * primitives rather than imported ones: the same explicit-context boundary
 * `scenes/warning-bell-opening.mjs` and `render/terrain-kit.mjs` use. Pure
 * rules (damage profiles, healing clamps, the self-cost that can never fell its
 * payer) are imported from core instead, because those must be the same rules
 * the tests and the forecast see.
 *
 * Numbers are NOT redefined here. Live tuning knobs arrive as accessors so a
 * mid-battle slider change is visible to the tooltip and the cast at once —
 * the failure this kit already had once, when Heal's tip promised 14 while the
 * slider healed something else.
 */

import { applyHealState, applySelfCost } from '../../core/battle-state.mjs';
import { hasStatus } from '../../core/statuses.mjs';
import { damageProfile, rollDamage } from '../../core/combat.mjs';

// Every page primitive a cast may use. Listed rather than duck-typed so a page
// edit that drops one fails loudly at boot instead of mid-cast, where a throw
// would leave the caster's turn stranded with the field locked in 'anim'.
export const ABILITY_CONTEXT_FIELDS = [
  'THREE',            // scene-graph constructors (injected, never imported)
  'world',            // the group cast effects are added to
  'units',            // live roster array
  'distance',         // (a, b) -> tiles apart, by the RANGE metric in force
  // `burstDistance` is OPTIONAL and defaults to `distance`: a burst measures
  // its own footprint (Mournful Cry stays square when weapon ranges become
  // diamonds), but a caller that has only one metric is not wrong, it just has
  // no distinction to make.
  'tileCenter',       // (x, z) -> world position of a tile's centre
  'floatText',        // (text, position, colour) -> the rising label
  'faceToward',       // (unit, x, z) -> logical facing
  'projectile',       // (from, to, unit, done) -> arrow/bolt arc
  'tween',            // (seconds, onUpdate, onDone)
  'later',            // (fn, ms) scheduled on the battle's own generation
  'beginAnimation',   // take the field: no orders while a cast plays
  'present',          // (events) -> the domain-event presenter seam
  'spend',            // (unit, cost) -> pay turn points, consume the action
  'completeAction',   // (unit) -> hand control back or end the turn
  'applyDamage',      // (unit, amount, colour, sourceId, kind)
  'setMark',          // (caster, target) -> Righteous Anger's ×3 mark
  'setPoison',        // (unit, turns)
  'setAimed',         // (unit, on)
  'heightMod',        // (attacker, defender) -> high/low ground multiplier
  'attackForecast',   // (attacker, defender, overrides) -> the attack's damage range
  'randomSource',     // () -> the current RNG (seed() swaps it)
  'healAmount',       // () -> live-tunable heal size
  'cry',              // { damage, selfCost, radius } — Mournful Cry's numbers
  'poisonTurns',      // () -> how long a Poison Flask sticks; live, lethalPoison moves it
  'flaskRange',       // how far the alchemists can throw; the search sweeps it
];

export function createBattleAbilities(context) {
  const missing = ABILITY_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('ability kit: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, world, units, distance, tileCenter, floatText, faceToward, projectile,
    tween, later, beginAnimation, present, spend, completeAction, applyDamage,
    setMark, setPoison, setAimed, heightMod, attackForecast, randomSource,
    healAmount, cry, poisonTurns, flaskRange,
  } = context;
  const burstDistance = context.burstDistance || distance;

  const above = (unit, height) => tileCenter(unit.x, unit.z).add(new THREE.Vector3(0, height, 0));

  // What a definition hands the forecast panel. `mid` is the plate between the
  // cards; an ability either promises one target a `loss` of hit points (zero
  // when the card should show no bar movement) or lists everyone it touches as
  // `rows`. The panel renders that description and recomputes nothing, which is
  // what keeps a forecast and its cast the same statement.
  const promise = (num, label, loss = 0) => ({ mid: { num, label }, loss });

  const anger = {
    id: 'anger',
    name: 'Righteous Anger',
    cost: 1,
    range: 4,
    aim: 'enemy',
    hl: 'cast',
    tip: 'Mark an enemy within 4. Cassien’s next hit on it deals ×3. Expires after 2 turns.',
    forecast(caster, target) {
      const r = attackForecast(caster, target, { marked: true });   // hypothetical marked follow-up
      return promise('×3', 'NEXT STRIKE', Math.min(target.hp, r.mid));
    },
    execute(caster, target) {
      spend(caster, anger.cost);
      setMark(caster, target);
      faceToward(caster, target.x, target.z);
      floatText('MARKED', above(target, 1.9), '#ffb27a');
      completeAction(caster);
    },
  };

  const purify = {
    id: 'purify',
    name: 'Purify',
    cost: 1,
    range: 2,
    aim: 'ally',
    hl: 'heal',
    tip: 'Cleanse poison from an ally or self within 2.',
    forecast() { return promise('✦', 'CLEANSE'); },
    execute(caster, target) {
      spend(caster, purify.cost);
      setPoison(target, 0);
      faceToward(caster, target.x, target.z);
      floatText('PURIFY', above(target, 1.68), '#b4ffdc');
      completeAction(caster);
    },
  };

  // Take Aim is a stance, not a reaction. Nothing about it interrupts anyone's
  // walk — it simply sits on the archer until the archer chooses to spend it.
  const aim = {
    id: 'aim',
    name: "Sentinel's Eye",
    cost: 1,
    range: 0,
    aim: 'self',
    hl: null,
    tip: 'Keep watch. The next shot deals ×2 and reaches 6 tiles; the vigil is held until that shot is taken.',
    /** A steadied bow cannot be steadied again: the button greys out. */
    uiRedundant(unit) { return hasStatus(unit, 'aimed'); },
    execute(caster) {
      setAimed(caster, true);
      spend(caster, aim.cost);
      floatText('READY', above(caster, 1.68), '#ffc070');
      completeAction(caster);
    },
  };

  // The grief-note breaks out of Seira herself: a 5×5 centred where she stands,
  // so she has to wade into the defence to be worth her 3 TP.
  const mournfulCry = {
    id: 'cry',
    name: 'Mournful Cry',
    cost: 3,
    range: 2,
    aim: 'burst',
    hl: 'cast',
    tip: 'A grief-note around Seira herself: every enemy within 2 tiles takes ~16. Costs Seira 5 HP. Click again — or click a highlighted tile — to loose it.',
    /**
     * One profile for the grief-note, so the cast and anything that previews
     * it read the same number. A second copy of this arithmetic is exactly how
     * a forecast starts lying.
     */
    profileAgainst(caster, target) {
      return damageProfile({
        power: cry.damage,
        height: heightMod(caster, target),
        lowVariance: 0.85,
        highVariance: 1.15,
      });
    },
    /** Everyone the burst catches, in roster order. */
    caught(caster) {
      // SQUARE, deliberately, even when weapon ranges are diamonds: the
      // grief-note is a 5x5 burst around Seira by Jonah's spec, and a burst is
      // an area of effect rather than a reach — the diamondRange rule is about
      // how far a weapon THROWS, not what shape an explosion is.
      return units.filter(t => t.alive && t.team !== caster.team && burstDistance(caster, t) <= cry.radius);
    },
    /** The burst lists what it touches: Seira's own clamped cost, then the catch. */
    forecast(caster) {
      const hit = mournfulCry.caught(caster);
      return {
        mid: {
          num: hit.length ? `${cry.damage}±` : '—',
          label: hit.length ? `${hit.length} CAUGHT` : 'NO TARGETS',
        },
        rows: [{ unit: caster, loss: Math.min(cry.selfCost, caster.hp - 1), self: true }]
          .concat(hit.map(t => ({ unit: t, loss: mournfulCry.profileAgainst(caster, t).mid }))),
      };
    },
    execute(caster, target, done) {
      spend(caster, mournfulCry.cost);
      beginAnimation();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.34, 28),
        new THREE.MeshBasicMaterial({
          color: 0xd9b0ff, transparent: true, opacity: 0.95,
          depthWrite: false, side: THREE.DoubleSide,
        }));
      ring.rotation.x = -Math.PI / 2; ring.renderOrder = 940;
      ring.position.copy(above(caster, 0.06));
      world.add(ring);
      tween(0.55, p => { ring.scale.setScalar(1 + p * 7); ring.material.opacity = 0.95 * (1 - p); },
        () => { world.remove(ring); ring.geometry.dispose(); ring.material.dispose(); });
      // Seira pays first, and can never put herself down
      present(applySelfCost(caster, cry.selfCost));
      later(() => {
        for (const t of mournfulCry.caught(caster)) {
          const roll = rollDamage(mournfulCry.profileAgainst(caster, t), randomSource());
          applyDamage(t, roll, undefined, caster.id);
        }
        later(done || (() => completeAction(caster)), 520);
      }, 300);
    },
  };

  const flask = {
    id: 'flask',
    name: 'Poison Flask',
    cost: 2,
    // How far the artillery throws. Swept by the design search: an alchemist
    // that can only act from inside a bow's reach is an alchemist that can be
    // hunted before it has done anything, which is the exploit this number is
    // being asked about.
    range: flaskRange,
    aim: 'enemy',
    hl: 'cast',
    tip: 'Poison for 3 turns, 6 damage at the victim’s turn start.',
    /**
     * What the alchemist AI needs in order to plan with the flask: never at
     * arm's length (that is what its panic move is for), a ceiling the pacing
     * escalation may not push the throw past, and how often that escalation
     * grants another tile.
     */
    ai: { minDistance: 2, rangeCap: 9, escalateEveryRounds: 2 },
    execute(caster, target, done) {
      spend(caster, flask.cost);
      beginAnimation();
      faceToward(caster, target.x, target.z);
      projectile(tileCenter(caster.x, caster.z), tileCenter(target.x, target.z), caster, () => {
        setPoison(target, poisonTurns());
        floatText('POISON', above(target, 1.68), '#8fe07a');
        later(done, 380);
      });
    },
  };

  // Seira's Type-2 kit (warning-bell prototype; numbers provisional). The tip
  // reads the live knob because a hardcoded number here once told the player 14
  // while the slider healed something else.
  const heal = {
    id: 'heal',
    name: 'Heal',
    cost: 1,
    range: 3,
    aim: 'ally',
    hl: 'heal',
    get tip() { return `Restore up to ${healAmount()} HP to an ally or self within 3.`; },
    forecast(caster, target) {
      const restored = Math.min(healAmount(), target.maxHp - Math.max(0, target.hp));
      return promise('+' + restored, 'RESTORE');
    },
    execute(caster, target) {
      spend(caster, heal.cost);
      faceToward(caster, target.x, target.z);
      present(applyHealState(target, healAmount()));
      completeAction(caster);
    },
  };

  return [anger, purify, aim, mournfulCry, flask, heal];
}
