/**
 * `window.__BATTLE` — the handle every gate, bot and QA script drives the game
 * through.
 *
 * This is a projection, not logic: it lets tooling project tiles to screen
 * space, inspect turn state, and run every action headlessly. That is why its
 * context is enormous and why that is not the smell it would be anywhere else —
 * the context IS the surface. It is extracted last in the decomposition on
 * purpose, so its export list only had to be written once everything else had
 * found its home.
 *
 * The one thing it cannot be handed is a binding it needs to WRITE. `fast()`,
 * `pace()`, `setBattleWalk()` and `seed()` retune live page variables, and a
 * module cannot assign to an injected name, so those four arrive as a `knobs`
 * object whose setters live beside the variables they move. Everything else is
 * read-only from here.
 *
 * Pure core predicates are the one exception to "everything arrives as
 * context": reading a unit's statuses is a rule, not a page binding, so it is
 * imported the way `core/enemy-ai.mjs` and the ability kit import their rules.
 */

import { isBerserk, markedUnit } from '../core/battle-state.mjs';
import { hasStatus, statusOf, statusTurns } from '../core/statuses.mjs';
// sheet() blows up sprite frames at native pixel size; nothing else in this
// file draws, so these two constants weren't otherwise in scope here.
import { SPX, SPY } from '../render/sprite-painter.mjs';

export function createBattleApi({
  ABIL, ART_VIEWS, ART_WALK_MAX, BATTLE_DEF, POST_BATTLE_EXPLORE,
  SIDE_VIEW_IN_BATTLE, THREE, TP_CAP, WALK_CONTACT_HOLD, WALK_CYCLES_PER_TILE, WARBELL,
  abilTargets,
  abilities, advanceDialogue, afterPlayerMove, applyDamage, artLoadErrors, artReady,
  artSetKey, attack, attackCursorUnit, attackTargets, availableCommands, azimuthNow,
  battleVictory,
  azimuthTarget, beginExploration, berserkMultiplier, billboard, bloom,
  bokeh, bubbles, buildingOccluders, camera, cameraMoving, canCast,
  castAbility, cliffActors, cliffsOpening, commandKey, completeAction, composer,
  couldShootFrom, cursorMeshes, idleActive, idleOrigin, living, setIdleGrid,
  canDefend, configureMineBeats, dangerReport, defendAction, dialogue, endTurn, enterMine, eventLog, exploration,
  faceAtNearestFoe,
  exploreTo, faceOf, facingPicker, floatText, flow, gaitOn,
  healAmount, hlActive, hlMat, hud, loadProgress, markMesh,
  marker, mineActors, mineFinale, moveTarget, moveUnit, mulberry,
  music, outcomeErrors, paintedArt, pathTo, reachable, reactions,
  refreshButtons, renderStrip, revengeDamage, rotate, rotateTo, rules, runtimeTimers,
  scene, sceneNow, setAimed, setPoison, shotRange, minShotRange, soloRevenge, spriteBust,
  startDialogue, stepCliffExit, stepMineStory, stepTweens, stopCliffExit, storyStatus,
  threatArcs, tileCenter, tileTop, tweens, unitAt, unitById, unitSprite,
  units, updateBuildingOcclusion, victorySequence, walkCycle, walkFraction, walkFrameCount,
  walkFrames, walkPhase, walkWeights, walkable, wbCineActors,
  // `SCENES` is a page `let` that the script loader REPLACES when
  // story/opening-scene.md finishes parsing, so it arrives as an accessor.
  // Captured by value it froze at FALLBACK_SCENES and beginMine staged the
  // stand-in script.
  scenes,
  // the four live knobs this API rewrites, as operations rather than bindings
  knobs,
}) {
  if (!knobs) throw new Error('battle-api: missing context "knobs"');
  // The mark now rides its target as a status; the shape reported here is the
  // one the doctrine bots have always read.
  function markState() {
    const target = markedUnit(units);
    if (!target) return null;
    const entry = statusOf(target, 'marked');
    return { caster: unitById(entry.sourceId).name, target: target.name, turns: entry.turns };
  }
  return {
  units, tileTop, camera, scene, THREE, marker, ABIL, composer, bloom, bokeh,
  timers: () => runtimeTimers.state(),
  // what the entry card's loading bar is drawing, and the per-source counts
  // behind it: { done, total, fraction, shown, complete, sources[] }
  loadProgress: () => loadProgress.report(),
  // which encounter booted, and anything its descriptor could not resolve
  battle: () => ({
    id: BATTLE_DEF.id, title: BATTLE_DEF.title,
    grid: { ...BATTLE_DEF.grid }, scene: BATTLE_DEF.scene,
    zonedAi: BATTLE_DEF.zonedAi, outcome: { ...BATTLE_DEF.outcome },
    errors: outcomeErrors.slice(),
  }),
  // The map as the RULES see it: which tiles a unit may stand on. That is the
  // same predicate an arrow now asks (rock walls and building footprints are
  // solid to both, `laneSolid` in main.mjs), so this is also where a gate
  // learns where the cover is. Gates used to hard-code footprints copied out of
  // battle1-scenery, which is how a staging quietly stops testing anything the
  // day the bunkhouse moves two tiles.
  map: () => {
    const { width, depth } = BATTLE_DEF.grid;
    const rows = [];
    for (let z = 0; z < depth; z++) {
      const row = [];
      for (let x = 0; x < width; x++) row.push(walkable(x, z));
      rows.push(row);
    }
    return { width, depth, walkable: rows };
  },
  // The danger-zone model as tiles, and the arcs currently on screen. Both are
  // read through calls: the tile map is rebuilt on every entry into Move mode,
  // and the arc set changes with the cursor.
  danger: () => dangerReport(),
  threatArcs: () => threatArcs.state(),
  // Which DOMAIN RULES this page is playing under, and any descriptor key or
  // `?rules=` token it did not recognise. A gate asserts against this rather
  // than trusting that the URL it built took effect — a typo'd flag would
  // otherwise silently test the battle's defaults and pass.
  rules: () => rules.all(),
  ruleErrors: () => rules.unknown(),
  // Flip one live. Everything downstream reads its flag at the moment it acts,
  // so a rule set this way takes effect on the very next attack rather than on
  // the next reload; returns null for a name this build does not have.
  setRule: (name, on) => rules.set(name, on),
  story: () => ({
    source: storyStatus.source,
    directives: storyStatus.directives.slice(),
    errors: storyStatus.errors.slice(),
  }),
  // every material the in-world UI owns, with the flags that decide whether the
  // scene's atmosphere is allowed to touch it
  uiMaterials: () => {
    const out = [];
    const add = (label, o) => o && o.traverse(n => {
      if (!n.material) return;
      for (const m of (Array.isArray(n.material) ? n.material : [n.material]))
        // `shape` is the geometry the chrome is drawn on. It rides here rather
        // than in its own hook because the underfoot marker's shape is a RULED
        // property now (Jonah, 2026-08-04: enemies are squares, the party keeps
        // its disc) and a ruling nothing asserts is a ruling that drifts back.
        // `depthTest` rides here for the same reason `shape` does: ground chrome
        // being OCCLUDED BY FIGURES is a ruling (Jonah, 2026-08-05), and a
        // ruling nothing asserts is a ruling that drifts back. A cursor drawn
        // with depthTest off paints over the legs of the unit standing on the
        // square it marks, at every camera angle.
        out.push({ label, type: m.type, shape: n.geometry && n.geometry.type,
                   fog: !!m.fog, toneMapped: !!m.toneMapped, opacity: m.opacity,
                   depthTest: !!m.depthTest, depthWrite: !!m.depthWrite,
                   renderOrder: n.renderOrder });
    });
    for (const u of units) {
      add(u.name + ' bar', u.bar);
      add(u.name + ' aim', u.aimMesh); add(u.name + ' poison', u.poisonIcon);
      add(u.name + ' shield', u.shieldRing);
    }
    add('marker', marker); add('mark', markMesh);
    for (const m of facingPicker.faceArrows) add('faceArrow', m);
    for (const m of cursorMeshes) add('cursor', m);
    for (const k in hlMat) out.push({ label: 'highlight ' + k, type: hlMat[k].type,
      fog: !!hlMat[k].fog, toneMapped: !!hlMat[k].toneMapped, opacity: hlMat[k].opacity,
      depthTest: !!hlMat[k].depthTest, depthWrite: !!hlMat[k].depthWrite });
    const arc = threatArcs.material;
    // The threat arc is the game's ONE deliberate exception to "chrome is
    // depth-tested": it bows over the terrain and draws through it, because a
    // threat line a cliff can swallow is worse than none (see threat-arcs.mjs).
    // Reported with its blending because the alpha and the blend mode are both
    // rulings — normal, not additive, so it stays red over snow.
    out.push({ label: 'threatArc', type: arc.type, fog: !!arc.fog,
      toneMapped: !!arc.toneMapped, opacity: arc.opacity,
      depthTest: !!arc.depthTest, depthWrite: !!arc.depthWrite,
      blending: arc.blending });
    return out;
  },
  fast: () => knobs.fast(),
  rotate: dir => { rotate(dir); return azimuthTarget(); },   // same 90° step the Q/E keys take
  // off-lattice camera angles, which the player's 90° steps cannot reach: the
  // cutscene uses them, and a test needs them to hold a unit in profile
  rotateTo: az => { rotateTo(+az); return azimuthTarget(); },
  pace: s => knobs.setStepTime(+s || 0.15),   // seconds per tile
  // no longer drives a moving figure — the gait is stepped by ground covered — so
  // this only reaches the in-place fallback path in walkPhase()
  walkFps: n => paintedArt.setWalkFps(Math.max(0.05, +n || 7)),
  // the battle-gait revert switch at runtime, so both states are testable without
  // editing the file. Cutscene walking is unaffected either way.
  setBattleWalk: on => knobs.setBattleWalk(on),
  stepAnimations: (count = 1, dt = 0.05) => {
    count = THREE.MathUtils.clamp(Math.floor(+count || 1), 1, 100);
    dt = THREE.MathUtils.clamp(+dt || 0.05, 0.001, 0.05);
    for (let i = 0; i < count; i++) stepTweens(dt);
    return tweens.length;
  },
  stepCliffs: (count = 1, dt = 0.05) => {
    count = THREE.MathUtils.clamp(Math.floor(+count || 1), 1, 500);
    dt = THREE.MathUtils.clamp(+dt || 0.05, 0.001, 0.05);
    for (let i = 0; i < count && cliffsOpening.exitProgress() != null; i++) stepCliffExit(dt);
    return cliffsOpening.exitProgress();
  },
  // Deterministic staging step for the mine finale. Headless browsers may
  // throttle requestAnimationFrame, so the regression gate can still verify
  // the beast's recoil and the shared resonance pulse.
  stepMine: (count = 1, dt = 0.05) => {
    count = THREE.MathUtils.clamp(Math.floor(+count || 1), 1, 500);
    dt = THREE.MathUtils.clamp(+dt || 0.05, 0.001, 0.05);
    for (let i = 0; i < count; i++) stepMineStory(dt, performance.now() / 1000);
    return mineFinale.beastReactionProgress();
  },
  stepOcclusion: (count = 1, dt = 0.05) => {
    count = THREE.MathUtils.clamp(Math.floor(+count || 1), 1, 100);
    dt = THREE.MathUtils.clamp(+dt || 0.05, 0.001, 0.05);
    for (let i = 0; i < count; i++) updateBuildingOcclusion(dt);
    return buildingOccluders.map(building => ({
      name: building.name,
      blocked: building.blocked,
      opacity: +building.opacity.toFixed(3),
    }));
  },
  commands: () => ({
    selected: hud.cursorKey(),
    moveTarget: moveTarget() && { ...moveTarget() },
    attackTarget: attackCursorUnit() && {
      id: attackCursorUnit().id,
      name: attackCursorUnit().name,
      x: attackCursorUnit().x,
      z: attackCursorUnit().z,
    },
    available: availableCommands().map(button => ({
      key: commandKey(button),
      text: button.textContent.trim(),
    })),
  }),
  portraitRules: dialogue.portraitRules,
  portraitErrors: dialogue.portraitErrors,
  explore: () => {
    const eu = exploration.unit(), pos = exploration.position();
    return {
      enabled: POST_BATTLE_EXPLORE,
      speed: exploration.speed,
      active: flow.phase === 'explore',
      unit: eu && eu.name,
      x: eu && eu.x,
      z: eu && eu.z,
      worldX: pos && +pos.x.toFixed(4),
      worldZ: pos && +pos.z.toFixed(4),
      walking: !!(eu && eu.walking),
      pathing: exploration.isPathing(),
      keys: exploration.keysHeld(),
      artFace: eu && eu.artFace,
      artKey: eu && eu.artKey,
      cycle: eu ? walkCycle(eu, eu.artFace) : [],
      reachable: flow.phase === 'explore' ? exploration.reachableTiles().tiles : [],
    };
  },
  mine: () => ({
    active: sceneNow() === 'mine',
    ...mineFinale.debugState(),
    actors: mineActors.map(actor => ({
      name: actor.name,
      x: +actor.group.position.x.toFixed(3),
      y: +actor.group.position.y.toFixed(3),
      z: +actor.group.position.z.toFixed(3),
      visible: actor.group.visible,
      custom: !!actor.staticPlate,
      loaded: actor.staticPlate ? !!actor.sprite.material.map : !!actor.art,
    })),
  }),
  seed: n => knobs.seed(n),
  state: () => {
    const u = flow.phase === 'explore' ? exploration.unit() : flow.current();
    return {
      phase: flow.phase, mode: flow.mode, curAbil: flow.curAbil,
      round: flow.round, qi: flow.qi,
      // the shared "the battle has begun" latch every piece of combat chrome
      // reads (flow/turn-state): false through the opening, true from the first
      // real turn onward
      started: flow.started,
      cur: u && u.name, curId: u && u.id, tp: u && u.tp,
      moved: u && u.moved, acted: u && u.acted,
      // kept as [speaker, text] for tooling; a narration card has no speaker and a
      // scene change reports itself, so "a card is up" is always truthy here
      dialogue: dialogue.currentBeat()
        ? [dialogue.currentBeat().who || '',
           dialogue.currentBeat().text ||
             (dialogue.currentBeat().kind === 'tbc' ? 'TO BE CONTINUED' : '(scene change)')]
        : null,
      dialogueKind: dialogue.currentBeat() ? dialogue.currentBeat().kind : null,
      dialogueSkippable: dialogue.fxSkippable(),
      dialoguePortrait: dialogue.portraitKey(),
      dialoguePortraitFrame: dialogue.portraitFrame(),
      scene: sceneNow(),
      openingCamera: {
        zoom: +camera.zoom.toFixed(3),
        moving: cameraMoving(),
      },
      animations: tweens.map(tw => ({
        t: +tw.t.toFixed(3),
        dur: Number.isFinite(tw.dur) ? +tw.dur.toFixed(3) : null,
      })),
      mark: markState(),
      warbell: WARBELL ? { revenge: revengeDamage(), heal: healAmount(),
                           berserk: berserkMultiplier(), soloRevenge: soloRevenge(),
                           // null once the opening releases them; a number here
                           // after the handover means reprisals are stuck held
                           heldReprisals: reactions.suspended ? reactions.pending : null } : null,
      music: music.state(),
    };
  },
  roster: () => units.map(u => ({
    id: u.id, name: u.name, team: u.team, cls: u.cls, x: u.x, z: u.z,
    hp: u.hp, maxHp: u.maxHp, tp: u.tp, alive: u.alive, downed: u.downed, downable: !!u.downable,
    // the six statuses stay flat in the roster: the Python doctrine bots read
    // `aimed`/`poison`/`defending`/`berserk` by name, and that contract is
    // older than the collection behind it
    // `reach` is the far edge of the shooting envelope; `minReach` the near
    // one, which is 1 for everything until rules.archerMinRange puts a hole in
    // the middle of a bow's arc. A bot that plans shots without reading both
    // walks into the hole and wastes the turn.
    aimed: hasStatus(u, 'aimed'), reach: shotRange(u), minReach: minShotRange(u),
    atk: u.atk, move: u.move,
    poison: statusTurns(u, 'poison'),
    defending: hasStatus(u, 'defending'), form: u.form, abil: [...u.abil],
    // reaction/cutscene state the warning-bell gates assert against: a bot
    // cannot otherwise tell a doubled atk from a retuned one, or a live unit
    // from one the entrance still owns
    berserk: isBerserk(u), cutscene: !!u.cutscene,
  })),
  // active battle barks, so a gate can assert the encounter SAID something
  // rather than only that the numbers moved
  barks: () => bubbles.active.map(b => ({ name: b.u.name, text: b.text })),
  // the golden-log capture surface (src/core/event-log.mjs): every domain
  // event this battle has emitted so far, round/turn/actor-tagged and
  // normalized for a byte-for-byte diff against a committed fixture. clearLog
  // is for a page that runs more than one battle (mine, warningbell) and
  // wants a fresh capture per encounter rather than one run bleeding into the
  // next; no current gate calls it because every golden bot loads a fresh page.
  log: () => eventLog.entries(),
  clearLog: () => { eventLog.clear(); return true; },
  // which of the current unit's abilities are affordable and legal right now
  abils: () => { const u = flow.current(); return u && flow.phase === 'player' ? u.abil.filter(k => canCast(u, k)) : []; },
  highlights: () => hlActive().map(m => m.userData.tile),
  toScreen: (x, z) => {
    const v = new THREE.Vector3(x + 0.5, tileTop[z][x], z + 0.5).project(camera);
    return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight };
  },
  advance: () => advanceDialogue(),
  // headless equivalents of the action bar
  moveTo: (x, z) => {
    const u = flow.current();
    if (flow.phase !== 'player' || !u || u.moved) return false;
    const res = reachable(u);
    if (!res.tiles.some(q => q.x === x && q.z === z)) return false;
    // `postAct` kept in the same shape commitPlayerMoveTo writes (battle-input.mjs)
    // even though no bot calls undo: nothing here ever reaches the facing picker
    // (uiTurn stays false), so it can only ever read as "not eligible" if it did.
    u.undo = { x: u.x, z: u.z, ry: u.group.rotation.y, postAct: u.acted };
    u.moved = true;
    moveUnit(u, pathTo(res, u, x, z), () => afterPlayerMove(u));
    return true;
  },
  // Could this unit shoot anything if it MOVED to (x, z)? The AI's own
  // reposition predicate, exposed because it is where the "a shooter does not
  // block its own retreat lane" rule lives: the unit is still standing on its
  // current tile when the question is asked, and counting that body made every
  // stance straight back along the line look blocked.
  canShootFrom: (id, x, z) => {
    const u = units[id];
    if (!u || !u.alive) return null;
    return couldShootFrom(u, { x, z }, living(u.team === 'player' ? 'enemy' : 'player'));
  },
  // Who could this unit legally strike from where it stands, by the same list
  // the UI lights up? `attackAt` can only ever ask it about the unit whose turn
  // it is, which makes the line-of-sight rules — a lane through a building, a
  // bow's minimum range, a bolt point blank — untestable for anyone else. This
  // asks without swinging, so one staging can serve many assertions.
  targetsFor: id => {
    const u = units[id];
    return u && u.alive ? attackTargets(u).map(t => t.id) : [];
  },
  attackAt: (x, z) => {
    const u = flow.current(), t = unitAt(x, z);
    if (flow.phase !== 'player' || !u || u.acted || !t || !attackTargets(u).includes(t)) return false;
    u.acted = true; attack(u, t, () => completeAction(u));
    return true;
  },
  cast: (key, x, z) => {
    const u = flow.current();
    if (flow.phase !== 'player' || !u || !canCast(u, key)) return false;
    const def = abilities.get(key);
    // a stance and a self-centred burst have nothing to point at
    if (def.aim === 'self' || def.aim === 'burst') return castAbility(u, key);
    if (!abilTargets(u, key).some(q => q.x === x && q.z === z)) return false;
    const t = unitAt(x, z);
    if (!t) return false;
    return castAbility(u, key, t);
  },
  // Returns false when the guard could not be taken -- already acted, or
  // (under rules.defendCostsTp) nothing left to pay with. A bot that reads the
  // answer plans the same way the action bar greys the button; one that ignores
  // it wastes the turn, which is the honest consequence of a priced stance.
  defend: () => {
    const u = flow.current();
    if (flow.phase !== 'player' || !u) return false;
    return defendAction(u);
  },
  canDefend: () => canDefend(flow.current()),
  // Turn the acting unit toward its nearest enemy: the facing beat a player
  // gets at the end of every turn and a headless bot never sees. Spends
  // nothing and takes no action -- it only sets the rotation the picker would.
  faceNearest: () => (flow.phase === 'player' ? faceAtNearestFoe(flow.current()) : null),
  wait: () => { if (flow.phase === 'player' && flow.current()) { endTurn(); return true; } return false; },
  reach: () => (flow.phase === 'player' && flow.current()) ? reachable(flow.current()).tiles : [],
  // The idle reach preview's lit tiles — the full move grid drawn while a unit
  // awaits orders with no command picked. Presentation state, exposed so a gate
  // can assert the preview exists at idle and yields to the mode highlights.
  idleReach: () => idleActive().map(m => ({
    x: Math.floor(m.position.x), z: Math.floor(m.position.z),
  })),
  // The gold origin ring's tile while a committed-but-unconfirmed move keeps
  // the grid up (the undo window) — null whenever no ring is shown.
  idleOrigin: () => idleOrigin(),
  // Test-only staging: suppress/restore the idle grid layer, for probes whose
  // pixel math a lit board would corrupt (art-hooks z-order). Same contract
  // as setRule staging: turn it off for the shots, restore it after.
  idleGrid: on => { setIdleGrid(on); return !!on; },
  // test-only conveniences
  beginVictory: () => {
    stopCliffExit();
    dialogue.abandon();
    victorySequence();
  },
  // The ending THIS encounter actually plays, campaign hand-off included.
  // `beginVictory` above is battle 1's staging by name — in the gallery it runs
  // the wrong ending entirely — and the campaign gate needs the real one for a
  // battle whose balance is already gated elsewhere, without replaying it. It
  // is deliberately the same function the turn machine calls on a won battle,
  // so what a gate reaches this way is what a player reaches.
  finishBattle: () => {
    dialogue.abandon();
    battleVictory();
    return true;
  },
  // the parameter is `withDialogue` rather than `dialogue`: the engine itself
  // is now a binding by that name in this scope
  beginMine: (withDialogue = false) => {
    runtimeTimers.cancelAll();
    stopCliffExit();
    dialogue.abandon();
    enterMine();
    if (withDialogue)
      startDialogue(configureMineBeats(scenes().mine).concat(
        [{ kind: 'tbc', text: 'End of Part I' }]), () => {});
    return true;
  },
  beginExplore: () => beginExploration(),
  exploreTo: (x, z) => exploreTo(x, z),
  exploreKey: (key, on = true) => {
    const name = on ? exploration.press(key) : exploration.release(key);
    return !!name;
  },
  // Deterministic QA stepping for continuous exploration. It invokes the same
  // production movement and billboard paths as requestAnimationFrame, avoiding
  // false failures when a headless browser temporarily throttles animation.
  stepExplore: (count = 1, dt = 0.016) => {
    count = THREE.MathUtils.clamp(Math.floor(+count || 1), 1, 100);
    dt = THREE.MathUtils.clamp(+dt || 0.016, 0.001, 0.05);
    for (let i = 0; i < count; i++) {
      exploration.step(dt);
      const eu = exploration.unit();
      if (eu && eu.sprite && eu.group.parent)
        billboard(eu, dt, eu.alive);
    }
    return flow.phase === 'explore';
  },
  exploreStarts: (key, runway = 0.45) => {
    if (flow.phase !== 'explore' || !exploration.position()) return [];
    const dir = exploration.keyVector(key);
    if (!dir) return [];
    runway = THREE.MathUtils.clamp(+runway || 0.45, 0.05, 4);
    return exploration.reachableTiles().tiles.filter(tile => {
      const x = tile.x + 0.5, z = tile.z + 0.5;
      for (let d = 0.05; d <= runway; d += 0.05)
        if (!exploration.canOccupy(x + dir[0] * d, z + dir[1] * d, x, z))
          return false;
      return true;
    });
  },
  grantTp: n => { const u = flow.current(); if (u) { u.tp = Math.min(TP_CAP, u.tp + n); renderStrip(); refreshButtons(); } },
  poison: (id, turns) => setPoison(units[id], turns),
  arm: (id, on = true) => { const u = units[id]; if (u.alive) setAimed(u, on); },
  place: (id, x, z) => {
    const u = units[id];
    if (!u.alive || !walkable(x, z) || unitAt(x, z)) return false;
    u.x = x; u.z = z;
    u.group.position.copy(tileCenter(x, z));
    if (flow.current() === u) marker.position.set(x + 0.5, tileTop[z][x] + 0.02, z + 0.5);
    refreshButtons();
    return true;
  },
  down: id => { const u = units[id]; if (u.alive) applyDamage(u, u.hp); },
  // float an arbitrary string over a unit: the clipping check needs long words on demand
  float: (txt, id = 0, color = '#ffe08a') => {
    const u = units[id];
    floatText(String(txt), tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.68, 0)), color);
    return true;
  },
  pose: id => ({ inScene: !!units[id].group.parent, pitch: units[id].fig.userData.pitch || 0, y: units[id].fig.position.y }),
  // art inspection: every sprite frame blown up with nearest-neighbour, as data URLs
  sheet: (scale = 10) => {
    const out = {};
    for (const [kind, pal] of [['knight', 'cassien'], ['archer', 'brecht'], ['archer', 'miner'],
                               ['mage', 'seira'], ['alchemist', 'alch']])
      for (const pose of ['stand', 'down']) {
        const grid = unitSprite(kind, pal, pose).grid;
        const c = document.createElement('canvas');
        c.width = SPX * scale; c.height = SPY * scale;
        const x = c.getContext('2d');
        x.fillStyle = '#7f8ca6'; x.fillRect(0, 0, c.width, c.height);
        for (let j = 0; j < SPY; j++) for (let i = 0; i < SPX; i++) {
          const col = grid[j * SPX + i];
          if (col) { x.fillStyle = col; x.fillRect(i * scale, j * scale, scale, scale); }
        }
        out[kind + '_' + pal + '_' + pose] = c.toDataURL();
      }
    return out;
  },
  bust: (kind, pal, team) => spriteBust(kind, pal, team),
  // facing inspection: logical yaw vs the plate/mirror actually on screen right now
  azimuth: azimuthNow,
  facing: () => units.map(u => {
    const gy = u.group.rotation.y;
    const yaw = Math.atan2(camera.position.x - u.group.position.x, camera.position.z - u.group.position.z);
    return {
      id: u.id, name: u.name, team: u.team, alive: u.alive, downed: u.downed,
      x: u.x, z: u.z, ry: gy, dx: Math.sin(gy), dz: Math.cos(gy),
      toward: Math.cos(gy - yaw), side: Math.sin(gy - yaw),
      frame: u.artFace, flip: u.flip, hasArt: !!u.art, hasBack: !!(u.art && u.art.back),
      view: u.artFace, frameKey: u.artKey, scaleX: u.sprite.scale.x,
    };
  }),
  // walk-cycle inspection: which drawing every figure is showing this instant, and
  // whether it is mid-gait. Covers the cutscene actors too, which have no unit row.
  walk: () => {
    const row = v => ({
      name: v.name, view: v.artFace, frameKey: v.artKey, walking: !!v.walking,
      x: +v.group.position.x.toFixed(3), z: +v.group.position.z.toFixed(3),
      ry: +v.group.rotation.y.toFixed(4),
      walkT: +(v.walkT || 0).toFixed(3), flip: v.flip, scaleX: v.sprite.scale.x,
      // the gait's own odometer, in tiles, and the phase it puts the figure in.
      // tileFrac is where inside the current tile the feet are — the number a test
      // locks a screenshot to, since the phase is a pure function of it.
      walkDist: +(v.walkDist || 0).toFixed(4),
      tileFrac: +(((v.walkDist || 0) % 1 + 1) % 1).toFixed(4),
      // the stride fraction is the view-independent quantity a test watches across
      // a view switch: it must stay continuous while `phase` re-resolves
      fraction: v.walking ? +walkFraction(v).toFixed(4) : null,
      phase: v.walking && walkFrames(v, v.artFace) ? walkPhase(v, walkCycle(v, v.artFace).length) : null,
      cycle: v.art ? walkCycle(v, v.artFace) : [],
      // the hop rides on the group's y, so this is where "the gait replaced the
      // bounce" is checked: flat through a walk with frames, arched without
      y: +v.group.position.y.toFixed(4),
      cutscene: !!v.cutscene, gait: gaitOn(v),   // gait false == this figure cannot animate now
      hasSide: !!(v.art && v.art.side),
      walkViews: ART_VIEWS.filter(w => walkFrames(v, w)),
      walkCounts: ART_VIEWS.map(w => walkFrameCount(v, w)),   // numbered frames drawn per view
      gaitOffset: +(v.gaitOffset || 0).toFixed(3),
      frames: v.art ? Object.keys(v.art) : [],
    });
    return {
      fps: paintedArt.walkFps(), maxWalkFrames: ART_WALK_MAX, cyclesPerTile: WALK_CYCLES_PER_TILE,
      contactHold: WALK_CONTACT_HOLD,
      weights: [2, 4, 8].reduce((o, n) => (o[n] = walkWeights(n).w, o), {}),
      battleWalk: knobs.battleWalk(), sideInBattle: SIDE_VIEW_IN_BATTLE,
      ...cliffsOpening.debugState(),
      units: units.map(row), actors: cliffActors.map(row),
      // the gallery's own cutscene figures (the bell sentry), while they exist
      galleryActors: wbCineActors.map(row),
    };
  },
  occlusion: () => buildingOccluders.map(building => ({
    name: building.name,
    blocked: building.blocked,
    opacity: +building.opacity.toFixed(3),
  })),
  // rest/hover state of the four chevrons, for UI tests
  arrowStates: () => facingPicker.arrowStates(),
  // the end-of-turn facing beat, for UI tests; null unless the picker is up
  facingPicker: () => facingPicker.state(),
  // character-art inspection: which units picked up delivered art, and how it sits
  artReady, art: () => units.map(u => ({
    id: u.id, name: u.name, key: artSetKey(u),
    frames: u.art ? Object.keys(u.art) : [], face: u.artFace, frameKey: u.artKey, downed: u.downed,
    topY: +u.topY.toFixed(3), tilt: +u.sprite.rotation.x.toFixed(3),
    // How far a fallen figure with no `_down` plate has been knocked over in
    // the screen plane (src/render/painted-art.mjs layDownArt). Reported beside
    // `tilt` rather than instead of it: `tilt` is the away-from-camera angle
    // that fallback used to use, and a reader comparing the two should be able
    // to see that it is now zero.
    roll: +u.sprite.rotation.z.toFixed(3),
    quad: [+u.sprite.geometry.parameters.width.toFixed(3), +u.sprite.geometry.parameters.height.toFixed(3)],
    // How wide the PAINTED content is, in tiles — the quad times the fraction
    // of it that is not transparent margin. This is the number a fallen figure
    // is judged by: `quad` alone says nothing about how much floor a plate
    // appears to cover, which is what put a dropped sword in the next square.
    inkWidth: +(u.sprite.geometry.parameters.width *
                (u.sprite.userData.artFrame ? u.sprite.userData.artFrame.ink : 1)).toFixed(3),
    footY: +(u.sprite.position.y - u.sprite.geometry.parameters.height / 2).toFixed(3),
    opacity: +u.sprite.material.opacity.toFixed(2), tint: u.sprite.material.color.getHexString(),
    paintedPortrait: faceOf(u) !== spriteBust(u.kind, u.pal, u.team),
  })),
  // What the ground and the bars are saying, for the gate that holds the FFT
  // scheme in place (Jonah, 2026-08-05): no unit may put anything on the floor,
  // and its bar's fill is what carries the team. The bar is a canvas, so the
  // colour is read back from the pixel that is actually drawn rather than from
  // a constant this hook could get wrong in the same direction as the code.
  groundGlyphs: () => units.map(u => {
    const onFloor = [];
    // WORLD height, not local: the Take Aim reticle's parts sit at local y ~ 0
    // inside a group that hangs over the unit's head, and a local test called
    // them floor objects. What "on the floor" means is "at the tile's surface",
    // so the comparison is against the unit's own group.
    const here = new THREE.Vector3();
    const there = new THREE.Vector3();
    u.group.getWorldPosition(here);
    u.group.traverse(o => {
      if (!o.geometry || o === u.sprite) return;
      o.getWorldPosition(there);
      if (there.y - here.y > 0.2) return;
      onFloor.push(o.geometry.type);
    });
    const canvas = u.bar.material.map && u.bar.material.map.image;
    let fill = null;
    if (canvas && canvas.getContext) {
      // A pixel inside the FILL. The point comes from the drawing code
      // (`fillProbe`) rather than being a constant here: the bar's canvas now
      // also carries the turn numeral to its left, and a hard-coded 10px along
      // would be reading that column instead of the health it means to read.
      const probe = u.bar.userData.fillProbe || { x: 10, y: 8 };
      const d = canvas.getContext('2d').getImageData(probe.x, probe.y, 1, 1).data;
      fill = '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    return {
      name: u.name, team: u.team, alive: u.alive, onFloor, barFill: fill,
      // the numeral beside the bar, as a number rather than as pixels, so a gate
      // can hold it against the TURN ORDER panel it is supposed to agree with
      turnNumeral: u.bar.userData.order == null ? null : u.bar.userData.order,
      // is the bar (and so its numeral) actually on screen? Combat chrome only
      // exists once the battle has begun — see `started` in flow/turn-state
      barShown: !!u.bar.visible,
    };
  }),
  artErrors: () => artLoadErrors.map(error => ({ ...error })),
  };
}
