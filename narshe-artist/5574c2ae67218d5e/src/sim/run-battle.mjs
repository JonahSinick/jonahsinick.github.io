/**
 * The headless composition root: a whole battle, in Node, with no browser.
 *
 * `src/main.mjs` builds the same battle interleaved with a WebGLRenderer, a
 * bloom composer and a DOM, and there is no clean span of it to extract — so
 * this is written fresh rather than carved out (tmp/approach-review.md, V1
 * blocker 1). It wires exactly the same modules in the same order:
 *
 *   map → terrain heights → battle grid → roster → turn state → event seam →
 *   turn machine → unit actions → ability kit → enemy AI → the debug API
 *
 * Everything above that line is the real production module. What is replaced
 * is only the two things a headless run cannot have:
 *
 *  - the CLOCK. `later` and `tween` resolve on `sim/clock.mjs`'s virtual time
 *    instead of setTimeout and requestAnimationFrame, so a playthrough costs
 *    milliseconds and still resolves callbacks in the order the durations
 *    imply.
 *  - the VIEW. HP bars, floating text, tile highlights, the camera, the HUD and
 *    the gait are inert. Every one of them is already an injected context
 *    field, so making them inert is passing a different function, not editing
 *    the module that calls it.
 *
 * The one thing deliberately NOT reimplemented is the action surface. `moveTo`,
 * `attackAt`, `cast`, `defend` and `wait` come from the real
 * `src/debug/battle-api.mjs`, constructed here with inert stubs for the view
 * fields it projects. That surface is what every bot and gate drives, and it is
 * the one place where a hand-written sim copy could silently disagree with the
 * browser about what an action MEANS.
 *
 * Two small pieces of the page are restated here rather than imported, both
 * noted at their definitions: `afterPlayerMove` (three lines that live inside
 * the pointer/keyboard layer, which needs a canvas) and a beat runner standing
 * in for the dialogue engine.
 *
 * The proof that any of this is faithful is not this comment: it is
 * `tests/sim-parity.test.mjs`, which replays a doctrine bot here and diffs the
 * resulting domain-event stream against the committed browser fixture in
 * `tests/golden/` byte for byte.
 */

import * as THREE from 'three';

import { createBattleGrid } from '../core/battle-grid.mjs';
import { createRules } from '../core/rules.mjs';
import { laneBlocked } from '../core/line-of-sight.mjs';
import { createUnitState, isBerserk, markedUnit } from '../core/battle-state.mjs';
import { createEnemyAI } from '../core/enemy-ai.mjs';
import { chebyshevDistance as cheb, manhattanDistance as manh } from '../core/grid.mjs';
import { createReactionRegistry } from '../core/reactions.mjs';
import { createScheduler } from '../core/scheduler.mjs';
import { hasStatus } from '../core/statuses.mjs';

import { createAbilityRegistry } from '../content/abilities/registry.mjs';
import { createBattleAbilities } from '../content/abilities/battle-kit.mjs';
import { outcomeOptionsFor, resolveBattle } from '../content/battles/index.mjs';
import { characterForm, rosterUnitDefs } from '../content/characters/index.mjs';
import { createNarsheGateMap } from '../content/maps/narshe-gate-ravine.mjs';
import { gallerySolidPropTiles } from '../content/maps/warning-bell-gallery.mjs';

import { createBattleEvents } from '../flow/battle-events.mjs';
import { createTurnMachine } from '../flow/turn-machine.mjs';
import { createTurnState } from '../flow/turn-state.mjs';
import { createUnitActions } from '../flow/unit-actions.mjs';
import { createUnitFactory } from '../flow/unit-factory.mjs';

import { createBattle1Scenery } from '../render/battle1-scenery.mjs';
import { createTerrainMesh } from '../render/terrain-mesh.mjs';
import { SPRITE_TOP } from '../render/sprite-painter.mjs';
import { createWarningBellOpening } from '../scenes/warning-bell-opening.mjs';
import { createBattleApi } from '../debug/battle-api.mjs';

import { createSimClock, createSimTweens } from './clock.mjs';

// ---------------------------------------------------------------- page constants
// Mirrored from src/main.mjs. Every one of these is a value the page declares
// at module scope and hands to a module; none of them is derived, so restating
// them is a lookup rather than a second definition of a rule.
const TILE = 1, HU = 0.3, TOP_THICK = 0.09;
const ROCK = 0, SNOW = 1, PATH = 2, ICE = 3, WOOD = 4, STAIR = 5;
const TP_GAIN = 1, TP_CAP = 5;
const ESCALATE_START = 6;
const ADJ_PENALTY = 0.4;
const AIM_MULT = 2, AIM_BONUS_RANGE = 2;
const HI_MOD = 1.25, LO_MOD = 0.8;
const ENGAGE_RANGE = 6;
const AIM_ALERT_RANGE = 6;
const CRY_DMG = 16, CRY_SELF = 5, CRY_RADIUS = 2, POISON_TURNS = 3, POISON_DMG = 6;
// EXPERIMENT BATCH 1: the numbers the rule flags switch between. Kept beside
// the page's own so the two composition roots can be read against each other --
// this file and src/main.mjs must agree about what a rule DOES, or the sim
// measures a game nobody plays.
const MIN_SHOT_RANGE = 2, REAR_MULT = 1.5, DEFEND_TP = 1;
const POISON_TURNS_LETHAL = 4, POISON_DMG_LETHAL = 10;


/**
 * Pacing knobs, at the values `__BATTLE.fast()` sets.
 *
 * Every bot, gate and golden fixture in this project runs the game through
 * `fast()` — botlib calls it before it does anything else — so these ARE the
 * numbers the committed fixtures were recorded under. In virtual time they cost
 * nothing; what they still do is order concurrent chains, which is precisely
 * what the event stream records. Running the sim at the player's pacing instead
 * would be a different battle for no benefit.
 */
const FAST_AI_BEAT = 30, FAST_STEP_TIME = 0.02, FAST_CINE_SCALE = 0.12;

/** Inert stand-ins for view objects the domain modules poke at. */
const inertChrome = () => ({
  visible: false,
  material: { color: { setHex() {} }, opacity: 1 },
});
const noop = () => {};

/**
 * Build one battle, ready to be driven.
 *
 * @param {object} [options]
 * @param {string|null} [options.battle] the `?battle=` value ('warningbell', or
 *   null/omitted for the default Narshe gate encounter)
 * @param {number} [options.seed] the combat PRNG seed, matching `BATTLE_SEED`
 * @param {object} [options.knobs] extra `?` parameters, e.g. `{ revenge: 12 }`,
 *   read exactly the way the page reads them off the URL
 */
export function createSimBattle({ battle = null, seed = 1, knobs: urlKnobs = {} } = {}) {
  const BATTLE_DEF = resolveBattle(battle);
  const WARBELL = BATTLE_DEF.id === 'warning-bell';
  const W = BATTLE_DEF.grid.width, D = BATTLE_DEF.grid.depth;
  const query = new URLSearchParams(
    Object.entries(urlKnobs).map(([key, value]) => [key, String(value)]),
  );
  // The domain rule flags, exactly as the page builds them: descriptor defaults
  // first, then a `rules` spec, which arrives here as a knob because that is how
  // the matrix names a config (`--config P:rules=lethalPoison`).
  const RULES = createRules(BATTLE_DEF.rules, query.get('rules'));
  const numKnob = (key, dflt) => {
    const v = parseFloat(query.get(key));
    return Number.isFinite(v) ? v : dflt;
  };
  // Sweepable, because the design search needs to ask how hard poison should
  // bite without a rebuild. The default is the shipped number.
  const POISON_FRACTION = numKnob('pfrac', 0.2);
  // Swept too: 25% an ally was always a guess, and the notes have called it
  // "the wrong size" since it was built.
  const VOLLEY_PER_ALLY = numKnob('volley', 0.25);
  const VOLLEY_CAP = numKnob('volleycap', 1.5);
  const rangeDist = (a, b) => (RULES.get('diamondRange') ? manh(a, b) : cheb(a, b));

  // ------------------------------------------------------------- clock & timers
  const clock = createSimClock();
  const runtimeTimers = createScheduler({
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  const later = (callback, delay = 0) => runtimeTimers.schedule(callback, delay);
  const { tween } = createSimTweens(clock);
  // The cinematic clock, exactly as the page defines it around `fast()`.
  const cineTween = (dur, onUpdate, onDone) => tween(dur * FAST_CINE_SCALE, onUpdate, onDone);
  const cineLater = (fn, ms) => later(fn, ms * FAST_CINE_SCALE);

  // ------------------------------------------------------------- map & terrain
  const { H, T, S, BLOCKED, blockTiles, hash, mulberry } =
    createNarsheGateMap({ W, D, WARBELL, ROCK, SNOW, PATH, ICE, STAIR });

  let combatRand = mulberry(seed | 0);

  // The scene graph is real (three runs unmodified in Node), because the domain
  // reads world-space distances off it: a projectile's flight time is a function
  // of how far it travels, and flight time orders events.
  const scene = new THREE.Scene();
  const world = new THREE.Group();
  scene.add(world);

  // `tileTop` comes from the production terrain builder rather than a second
  // copy of its arithmetic: `box` is already injected there, so a no-op box and
  // a throwaway material table give the real per-tile surface heights and build
  // nothing.
  // Terrain and scenery ask this table for materials by name and then clone,
  // recolour and dispose them. Real (unrendered) materials answer all of that
  // without a table of stubs that has to be kept in step with the art.
  const stubMaterials = new Proxy({}, {
    get(cache, name) {
      if (typeof name !== 'string') return undefined;
      if (!cache[name]) cache[name] = new THREE.MeshBasicMaterial();
      return cache[name];
    },
  });
  const { tileTop } = createTerrainMesh({
    THREE, world: { add: noop }, box: () => ({ userData: {} }), mat: stubMaterials,
    HU, TILE, W, D, T, S, H, ROCK, SNOW, PATH, ICE, WOOD, STAIR, hash,
    topThick: TOP_THICK,
  });
  const tileCenter = (x, z) => new THREE.Vector3(x + 0.5, tileTop[z][x], z + 0.5);

  // Scenery is not decoration to the rules: the props claim tiles. The
  // bunkhouse, the ore cart, the shaft mouth, the log stack, the two lamps, two
  // boulders and the crates all call `blockTiles`, and a lamp standing on
  // (7, 14) is the difference between a reachable tile and an unreachable one —
  // which is exactly where the first parity run diverged. So the real scenery
  // module runs here too. It is one-way mesh construction against an injected
  // `box`, so building it headless costs a few hundred throwaway meshes and
  // keeps the occupancy grid single-sourced.
  // A prop only has to be an Object3D the scenery can position, rotate and
  // parent — it never reads back a geometry or a material (verified against
  // battle1-scenery.mjs, which touches neither on a box it was handed). Skipping
  // the BoxGeometry allocation takes battle-1 construction from 3.3 ms to a
  // fraction of that, which is most of the per-battle cost at matrix scale.
  const box = (w, h, d, material, x, y, z, { group = world } = {}) => {
    const prop = new THREE.Object3D();
    prop.position.set(x, y, z);
    group.add(prop);
    return prop;
  };
  createBattle1Scenery({
    THREE, world, box, mat: stubMaterials, HU, topThick: TOP_THICK,
    blockTiles, warmLight: () => new THREE.Object3D(),
    warbell: WARBELL, mulberry, hash, H, T, W, D, rockTile: ROCK,
    registerBuildingOccluder: noop, smokeStacks: [],
  });
  // The gallery's haulers and crates occupy their squares, exactly as they do
  // in the page (src/battle-scene.mjs, same call). This is the OTHER half of
  // the trap-6 lesson: a board the sim and the browser disagree about by one
  // tile is a divergence nothing else would ever explain. The terrain kit that
  // draws these props is not constructed here — it does not have to be, because
  // the occupancy comes from the map rather than from the geometry.
  if (WARBELL) {
    for (const prop of gallerySolidPropTiles())
      blockTiles(prop.x, prop.z, prop.x, prop.z);
  }

  // ------------------------------------------------------------- warning-bell knobs
  // Constructed for its live tuning knobs alone (revenge/heal/berserk/solo
  // revenge and their URL seeding), so those balance numbers keep exactly one
  // definition. Its `addUnit` paints canvases and is not used here.
  const unitFactory = createUnitFactory({
    THREE, world, scene, tileCenter,
    spriteFigure: () => ({ group: new THREE.Group(), mats: [], mesh: new THREE.Object3D() }),
    setArtFrame: noop, layoutOverhead: noop,
    uiCol: hex => hex, uiCss: () => '#000', makeTex: () => null,
    tween, query,
  });
  const {
    revengeDamage, healAmount, berserkMultiplier, berserkHot, soloRevenge, wbNum,
  } = unitFactory;

  // ------------------------------------------------------------- roster
  const units = [];
  let uid = 0;
  /**
   * The domain half of `flow/unit-factory.mjs`'s `addUnit`, with inert stand-ins
   * where it builds meshes. Every field assigned on top of `createUnitState` is
   * presentation the domain modules still reach for — a bar to redraw, a ring to
   * recolour, a figure to slump — so they exist and do nothing.
   */
  function addUnit(def) {
    const group = new THREE.Group();
    const fig = new THREE.Group();
    group.add(fig);
    const u = Object.assign(createUnitState({
      id: uid++, name: def.name, role: def.role, team: def.team, cls: def.cls,
      x: def.x, z: def.z, hp: def.hp, atk: def.atk,
      move: def.move, speed: def.speed, range: def.range || 1,
      abil: def.abil || [], downable: def.downable,
    }), {
      artMaxW: def.artMaxW || 0,
      charId: def.charId, artSet: def.artSet, pal: def.pal, kind: def.kind,
      group, fig, sprite: new THREE.Object3D(), mats: [], flip: 1,
      art: null, artFace: 'front', artKey: 'front', topY: SPRITE_TOP,
      walking: false, walkT: 0, walkDist: 0, lastX: 0, lastZ: 0,
      cutscene: false,
      bar: { userData: { draw: noop }, visible: true },
      ring: inertChrome(), disc: inertChrome(), shieldRing: inertChrome(),
      aimMesh: inertChrome(), poisonIcon: inertChrome(), poisonRing: inertChrome(),
    });
    if (def.tp) u.tp = def.tp;
    u.setFrame = noop;
    group.position.copy(tileCenter(u.x, u.z));
    group.rotation.y = def.team === 'player' ? Math.PI : 0;
    // the page holds figures back until the art pass settles and then reveals
    // them all; this is that settled state
    group.visible = true;
    world.add(group);
    units.push(u);
    return u;
  }
  for (const def of rosterUnitDefs(BATTLE_DEF, {
    number: wbNum, ruleOn: name => RULES.get(name),
  })) addUnit(def);

  // ------------------------------------------------------------- battlefield rules
  const battleGrid = createBattleGrid({
    width: W, depth: D, heights: H, tiles: T, blocked: BLOCKED,
    rockTile: ROCK, stairTile: STAIR,
    units,
    aimBonusRange: AIM_BONUS_RANGE,
    highGroundMultiplier: HI_MOD, lowGroundMultiplier: LO_MOD,
    zonedAi: BATTLE_DEF.zonedAi,
    rangeDistance: (a, b) => rangeDist(a, b),
    minShotRange: u => minShotRange(u),
    shotBlocked: (att, tgt) => shotBlocked(att, tgt),
    bodiesBlock: () => RULES.get('bodiesBlock'),
  });
  const {
    inBounds, walkable, terraceOf, unitAt, unitById, living,
    reachable, pathTo, shotRange, attackTargets, heightMod,
  } = battleGrid;

  // ---- the reach rules themselves, mirroring src/main.mjs exactly
  // A bow cannot fire point blank (rules.archerMinRange). BOWS ONLY, per
  // Jonah's 2026-08-02 ruling: a bolt and a lobbed flask are not wound up.
  function minShotRange(u) {
    return u.cls === 'archer' && u.range > 1 && RULES.get('archerMinRange')
      ? MIN_SHOT_RANGE : 1;
  }
  // Solid to an arrow: off the board, a rock wall, a building footprint, or a
  // body that is not the unit doing the asking.
  function laneSolid(x, z, mover) {
    if (!inBounds(x, z)) return true;
    if (T[z][x] === ROCK || BLOCKED[z][x]) return true;
    const body = unitAt(x, z);
    return !!body && body !== mover;
  }
  function shotBlocked(att, tgt) { return shotBlockedFrom(att, tgt, null); }
  function shotBlockedFrom(att, tgt, mover) {
    if (!RULES.get('arrowLos') || att.cls !== 'archer') return false;
    return laneBlocked(att, tgt, (x, z) => laneSolid(x, z, mover));
  }
  // Could this unit shoot anything from a tile it has not moved to yet? Its own
  // body is excluded, because moving there vacates the tile it is standing on.
  function couldShootFrom(u, tile, foes) {
    if (u.range <= 1) return false;
    const from = { x: tile.x, z: tile.z, cls: u.cls, range: u.range, team: u.team };
    const near = minShotRange(u), far = shotRange(u);
    return foes.some(f => {
      const d = rangeDist(from, f);
      return d >= near && d <= far && !shotBlockedFrom(from, f, u);
    });
  }
  const poisonTurns = () => (RULES.get('lethalPoison') ? POISON_TURNS_LETHAL : POISON_TURNS);
  const poisonDamage = (victim = null) => {
    const flat = RULES.get('lethalPoison') ? POISON_DMG_LETHAL : POISON_DMG;
    if (!RULES.get('scaledPoison') || !victim) return flat;
    return Math.max(1, Math.round(POISON_FRACTION * victim.maxHp));
  };

  function faceToward(u, x, z) {
    const dx = (x + 0.5) - u.group.position.x, dz = (z + 0.5) - u.group.position.z;
    if (dx || dz) u.group.rotation.y = Math.atan2(dx, dz);
  }

  // ------------------------------------------------------------- turn spine
  const flow = createTurnState();
  const marker = new THREE.Group();
  const markMesh = new THREE.Group();
  const reactions = createReactionRegistry(BATTLE_DEF.reactions || []);

  const outcomeErrors = [];
  const outcomeOptions = () => outcomeOptionsFor(BATTLE_DEF, units, note => {
    const message = `${BATTLE_DEF.id}: essential unit "${note}" is not on the roster`;
    if (!outcomeErrors.includes(message)) outcomeErrors.push(message);
  }, { lastStanding: RULES.get('lastStanding') });
  /** The ending this playthrough reached, once it has reached one. */
  let outcome = null;

  const battleEvents = createBattleEvents({
    THREE, scene, world,
    units, flow, reactions,
    floatText: noop, tileCenter, tween, later, uiCol: hex => hex, hash, cheb, faceToward,
    setWalking: noop, setSpritePose: noop, applyFormArt: noop, markMesh, bark: noop,
    banner: noop, renderStrip: noop, refreshButtons: noop, unitById,
    checkEnd: () => checkEnd(), endTurn: () => endTurn(),
    revengeDamage, berserkMultiplier, soloRevenge,
  });
  const {
    present: presentBattleEvents, applyDamage, setMark, clearMark, fireReaction, eventLog,
  } = battleEvents;

  const turnMachine = createTurnMachine({
    flow, units, reactions,
    tpGain: TP_GAIN, tpCap: TP_CAP, poisonDamage: u => poisonDamage(u),
    aiBeat: () => FAST_AI_BEAT,
    marker, tileTop, centerOn: noop, clearHighlights: noop, later,
    hideFacingArrows: noop,
    // Only a pointer/keyboard turn gets the FFT facing beat, and nothing driving
    // this sim is one — `flow.uiTurn` is never set. Resolving immediately keeps
    // a future caller that DID set it from stalling on a picker with no screen.
    showFacingPicker: (u, done) => done(),
    cheb, faceToward, living,
    banner: noop, renderStrip: noop, refreshButtons: noop,
    present: presentBattleEvents, clearMark,
    outcomeOptions,
    // The page's two endings, reduced to their domain halves. Victory runs
    // `haltBattlePresentation` (which clears the mark, and so EMITS an event);
    // defeat runs `finish()`, which cancels timers and closes the phase but
    // deliberately does not clear the mark. That asymmetry is real and the
    // golden stream sees it, so it is preserved rather than tidied.
    onVictory: () => { outcome = 'victory'; haltBattlePresentation(); },
    onDefeat: () => {
      outcome = 'defeat';
      runtimeTimers.cancelAll();
      flow.phase = 'over';
      flow.mode = null;
    },
    music: { isHeld: () => false, isWanted: () => false, releaseHold: noop, state: () => ({}) },
    cueBattleMusic: noop,
    cancelTimers: () => runtimeTimers.cancelAll(),
    aiTurn: u => enemyAI.aiTurn(u),
  });
  const {
    newRound, nextTurn, beginTurn, endTurn, finishTurn,
    spend, completeAction, beginActionAnimation,
    checkEnd, haltBattlePresentation,
  } = turnMachine;

  // ------------------------------------------------------------- actions & kit
  const unitActions = createUnitActions({
    THREE, scene, units, flow,
    tileCenter, tileTop, tween, later, floatText: noop, faceToward,
    distance: (a, b) => rangeDist(a, b), marker,
    setWalking: noop, walkFrames: () => null, clearHighlights: noop, refreshButtons: noop,
    heightMod, aimMultiplier: AIM_MULT,
    // Every one of these is an ACCESSOR, not a value: a rule flipped mid-run
    // has to reach the next attack, and capturing the number here would freeze
    // the sim on whichever rule set happened to be up when it was built.
    adjacencyPenalty: () => (RULES.get('archerMinRange') ? 1 : ADJ_PENALTY),
    rearMultiplier: () => (RULES.get('rearAttack') ? REAR_MULT : 1),
    supportMultiplier: att => {
      if (!RULES.get('massedVolley') || att.team !== 'enemy' || att.range <= 1) return 1;
      const rank = units.filter(v => v.alive && v.team === att.team && v.id !== att.id
        && Math.max(Math.abs(v.x - att.x), Math.abs(v.z - att.z)) === 1).length;
      return Math.min(VOLLEY_CAP, 1 + VOLLEY_PER_ALLY * rank);
    },
    defendCost: () => (RULES.get('defendCostsTp') ? DEFEND_TP : 0),
    stepTime: () => FAST_STEP_TIME,
    walkAnim: () => true,
    randomSource: () => combatRand,
    beginActionAnimation, completeAction,
    present: presentBattleEvents, applyDamage, clearMark,
    hideFacingArrows: noop,
    characterForm,
    ability: key => abilities.get(key),
    warbell: WARBELL,
    revengeDamage, berserkMultiplier, soloRevenge,
  });
  const {
    moveUnit, undoMove, attack, projectile, defendAction, canDefend,
    setPoison, setAimed, castAbility, switchUnitForm,
    attackRange: fcRange, revengeRange: forecastRevenge,
  } = unitActions;

  const abilities = createAbilityRegistry(createBattleAbilities({
    THREE, world, units, distance: (a, b) => rangeDist(a, b), burstDistance: cheb, tileCenter,
    floatText: noop, faceToward, projectile, tween, later,
    beginAnimation: beginActionAnimation,
    present: presentBattleEvents,
    spend, completeAction, applyDamage,
    setMark, setPoison, setAimed, heightMod,
    attackForecast: fcRange,
    randomSource: () => combatRand,
    healAmount,
    cry: { damage: CRY_DMG, selfCost: CRY_SELF, radius: CRY_RADIUS },
    poisonTurns,
    flaskRange: numKnob('flask', 4),
  }));
  const ABIL = abilities.byId;
  const castCry = (u, done) => castAbility(u, 'cry', null, done);
  const takeAim = u => castAbility(u, 'aim');

  const abilityField = {
    units, distance: cheb, width: W, depth: D,
    castable: (x, z) => T[z][x] !== ROCK,
  };
  const abilTargets = (u, key) => abilities.targets(u, key, abilityField);
  const canCast = (u, key) => abilities.canCast(u, key, abilityField);

  const enemyAI = createEnemyAI({
    THREE, living, terraceOf, reachable, pathTo, moveUnit, later,
    aiBeat: () => FAST_AI_BEAT, endTurn, phase: () => flow.phase,
    attackTargets, defendAction, attack, abilities, takeAim, castAbility,
    approachCost: battleGrid.approachCost,
    round: () => flow.round, engageRange: ENGAGE_RANGE,
    aimAlertRange: AIM_ALERT_RANGE, shotRange, floatText: noop, tileCenter,
    // batch 1: the AI reasons about reach in the metric the rules apply, asks
    // whether a stance has a lane, and reads its own behaviour flags live
    distance: (a, b) => rangeDist(a, b),
    couldShootFrom,
    defendCost: () => (RULES.get('defendCostsTp') ? DEFEND_TP : 0),
    // rules.aggressiveDefense turns the flask-range creep OFF and lets a
    // prepared defender leave its terrace instead
    escalateStart: () => (RULES.get('aggressiveDefense') ? Infinity : ESCALATE_START),
    advanceWhenPrepared: () => RULES.get('aggressiveDefense'),
    smartMilitia: () => RULES.get('smartMilitia'),
    stickyFocus: () => RULES.get('stickyFocus'),
  });

  // ------------------------------------------------------------- dialogue stand-in
  /**
   * `ui/dialogue.mjs` is a portrait ladder, a bubble and a beat runner, and only
   * the last of those has anything to do with the rules: a scripted `fx` beat
   * runs code that moves units and casts abilities, and the beats after it must
   * not start until it hands control back. That is this. Lines are advanced
   * immediately, which is what the browser bots do to them (`skip_dialogue`).
   */
  function startDialogue(beats, done = noop) {
    let index = 0;
    const step = () => {
      if (index >= beats.length) { done(); return; }
      const beat = beats[index++];
      if (beat && beat.kind === 'fx' && typeof beat.run === 'function') { beat.run(step); return; }
      step();
    };
    step();
  }

  // ------------------------------------------------------------- warning-bell staging
  const artLoadErrors = [];
  const warbellScene = WARBELL ? createWarningBellOpening({
    THREE, world, grid: { width: W, depth: D }, units, tileTop, tileCenter,
    anchors: () => null,
    plateTextures: {}, artLoadErrors,
    spriteFigure: () => {
      const mats = [new THREE.MeshBasicMaterial()];
      return {
        group: new THREE.Group(), mats,
        mesh: new THREE.Mesh(new THREE.BufferGeometry(), mats[0]),
      };
    },
    useActorArt: () => true, actorSetFrame: noop, artHeight: SPRITE_TOP,
    setWalking: noop, faceToward, moveUnit, centerOn: noop,
    bark: noop, portraitOf: () => null,
    // the sim draws no health bars, so the beat that raises them is a no-op
    // here — it is presentation, and the scripted damage it announces is not
    beginScriptedCombat: noop,
    castCry, switchForm: switchUnitForm,
    reactions, fireReaction, unitById,
    revengeDamage,
    chimeBell: noop, cueBattleMusic: noop,
    later, cineLater, cineTween,
    haltBattle: haltBattlePresentation, startDialogue,
  }) : null;

  // ------------------------------------------------------------- the action surface
  /**
   * Restated from `ui/battle-input.mjs`, which cannot be constructed without a
   * canvas, a camera and a raycaster. Three lines, and the debug adapter's
   * `moveTo` is the only caller that matters here.
   */
  function afterPlayerMove(u) {
    if (u.acted) { endTurn(); return; }
    flow.phase = 'player'; flow.clearMode();
  }

  const api = createBattleApi({
    ABIL, BATTLE_DEF, THREE, TP_CAP, WARBELL,
    abilTargets, abilities, applyDamage, afterPlayerMove,
    attack, attackTargets, canCast, castAbility, completeAction,
    defendAction, endTurn, eventLog, flow,
    healAmount, berserkMultiplier, revengeDamage, soloRevenge,
    marker, markMesh, moveUnit, mulberry, outcomeErrors,
    pathTo, reachable, reactions, shotRange,
    tileCenter, tileTop, unitAt, unitById, units, walkable,
    // batch 1: the debug surface reports the rules and the reach envelope, and
    // the ported bots read `minReach` off the roster to plan around the hole in
    // a bow's arc
    minShotRange, rules: RULES, couldShootFrom, living, canDefend,
    faceAtNearestFoe: () => null,
    // The danger shading and its arcs are VIEW state. The sim draws nothing, so
    // it reports "not computed" rather than pretending: a bot that needed the
    // shading would be reading the renderer, not the rules.
    dangerReport: () => ({ on: RULES.get('dangerTiles'), computed: false, tiles: [] }),
    threatArcs: { state: () => ({ arcs: [] }) },
    // projections with nothing to project onto out here
    artLoadErrors, artReady: Promise.resolve(),
    camera: { zoom: 1 },
    cameraMoving: () => false,
    dialogue: {
      currentBeat: () => null, fxSkippable: () => null,
      portraitKey: () => null, portraitFrame: () => null,
      portraitRules: [], portraitErrors: [],
    },
    exploration: { unit: () => null },
    music: { state: () => ({}) },
    // Both encounters fight on the town world; the cliffs and mine scenes are
    // cutscenes the sim never enters.
    sceneNow: () => 'town',
    storyStatus: { source: 'sim', directives: [], errors: [] },
    tweens: [],
    floatText: noop, refreshButtons: noop, renderStrip: noop,
    setAimed, setPoison,
    knobs: {
      // The sim is already at fast() pacing; the hook exists so a ported bot can
      // call it exactly as botlib does.
      fast: noop,
      setStepTime: v => v,
      setBattleWalk: on => !!on,
      seed: n => { combatRand = mulberry(n | 0); },
      battleWalk: () => true,
    },
  });

  // ------------------------------------------------------------- entry
  let begun = false;
  /**
   * Boot the encounter the way `enterChosenScene()` does, minus the camera and
   * the curtain. Battle 1's opening dialogue emits no domain events, so it goes
   * straight to round 1; the warning bell's scripted opening emits several
   * (Seira's Cry, both reprisals, her form switch) and is therefore run.
   */
  function begin() {
    if (begun) return;
    begun = true;
    if (WARBELL) startDialogue(warbellScene.beats(), newRound);
    else newRound();
    clock.drain();
  }

  return {
    battleDef: BATTLE_DEF,
    /**
     * WHICH GAME THIS RUN PLAYED. The outcome rule decides when a battle STOPS,
     * so a matrix measured under the wrong one answers a question nobody asked
     * — which happened: 12,000 battles were run under the pre-ruling rule and
     * had to be thrown away. It is reported here so a report can stamp it, and
     * a wrong-rule matrix is visible on its own first page.
     */
    outcomeRule: () => ({
      lastStanding: RULES.get('lastStanding'),
      ...outcomeOptions(),
    }),
    api, units, flow, clock, abilities, battleGrid,
    berserkHot, artLoadErrors, outcomeErrors,
    /** Advance every pending callback: the sim's `settle()`. */
    drain: () => clock.drain(),
    begin,
    log: () => eventLog.entries(),
    outcome: () => outcome,
    /** Escape hatches a scripted scenario (rather than a bot) may need. */
    internals: {
      units, flow, later, tween, moveUnit, attack, castAbility, defendAction,
      undoMove, switchUnitForm, applyDamage, present: presentBattleEvents,
      newRound, nextTurn, beginTurn, endTurn, finishTurn, checkEnd,
      reachable, pathTo, attackTargets, abilTargets, canCast, living, unitAt, unitById,
      forecastRevenge, warbellScene, startDialogue,
    },
  };
}
