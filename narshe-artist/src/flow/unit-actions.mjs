import {
  attackProfile,
  facingFromAngle,
  isRearAttack,
  rollDamage,
} from '../core/combat.mjs';
import {
  beginDefend,
  berserkMultiplierOf,
  isBerserk,
  isMarked,
  setAimedState,
  setPoisonState,
  spendTp,
  switchFormState,
} from '../core/battle-state.mjs';
import { hasStatus } from '../core/statuses.mjs';
import { isBonded } from './battle-events.mjs';

/**
 * What a unit does on its turn, and what the forecast says it will do.
 *
 * Execution and preview are deliberately one module. `attack` and
 * `attackRange` build the same `attackProfile`, and `revengeRange` mirrors the
 * reprisal rules in `battle-events.mjs` exactly — fixed revenge, one reprisal
 * per avenger, berserk doubling. Keeping them apart is how a forecast panel
 * starts lying about a rule someone changed on the execution side.
 *
 * Every path into an ability — the action bar, the pointer, the keyboard, the
 * debug adapter, the enemy AI — comes through `castAbility`, so an ability's
 * behaviour is decided once, in its definition.
 */
export function createUnitActions({
  THREE, scene, units, flow,
  // view primitives
  tileCenter, tileTop, tween, later, floatText, faceToward, distance, marker,
  setWalking, walkFrames, clearHighlights,
  // Combat tuning. `adjacencyPenalty` and `rearMultiplier` are ACCESSORS rather
  // than values because a rule flag decides them, and `__BATTLE.setRule()` can
  // move a flag mid-battle: capturing either would freeze this module on
  // whichever rule set happened to be up when the page booted.
  heightMod, adjacencyPenalty, aimMultiplier, rearMultiplier, supportMultiplier,
  // live knobs: __BATTLE.pace()/setBattleWalk()/seed() move all three
  stepTime, walkAnim, randomSource,
  // what taking the guard costs — 0 or 1, decided by a live rule flag, so an
  // accessor rather than a captured value
  defendCost,
  // the turn machine and the event seam
  beginActionAnimation, completeAction, present, applyDamage, clearMark,
  refreshButtons,
  // the facing picker's own dismissal, so a mid-pick undo can drop the
  // chevrons without going through `close()` — `close()` always finishes the
  // turn, which an undo must not do (see `undoMove`)
  hideFacingArrows,
  // character records, for the form switch
  characterForm,
  // the ability registry is constructed from this module's primitives, so it
  // arrives as a lookup rather than a reference
  ability,
  // warning-bell reprisal rules the forecast mirrors
  warbell, revengeDamage, berserkMultiplier, soloRevenge,
}) {
  for (const [name, value] of Object.entries({
    THREE, scene, units, flow,
    tileCenter, tileTop, tween, later, floatText, faceToward, distance, marker,
    setWalking, walkFrames, clearHighlights,
    heightMod, adjacencyPenalty, aimMultiplier, rearMultiplier, supportMultiplier, supportMultiplier,
    stepTime, walkAnim, randomSource, defendCost,
    beginActionAnimation, completeAction, present, applyDamage, clearMark,
    refreshButtons, hideFacingArrows, characterForm, ability,
    revengeDamage, berserkMultiplier, soloRevenge,
  })) {
    if (value === undefined || value === null)
      throw new Error(`unit-actions: missing context "${name}"`);
  }

  // ---------------------------------------------------------------- movement
  function moveUnit(u, path, done) {
    beginActionAnimation();
    let i = 0;
    const stepOnce = () => {
      if (i >= path.length) {
        setWalking(u, false);
        marker.position.set(u.x + 0.5, tileTop[u.z][u.x] + 0.02, u.z + 0.5);
        done(); return;
      }
      const [nx, nz] = path[i++];
      const from = u.group.position.clone();
      const to = tileCenter(nx, nz);
      faceToward(u, nx, nz);
      if (walkAnim()) setWalking(u, true);
      tween(stepTime(), p => {
        u.group.position.lerpVectors(from, to, p);
        // The hop is the placeholder gait: once painted walk frames are carrying the
        // step, the legs do the work and the whole figure stops bouncing. Both halves
        // are read live, so the camera turning mid-step (which can change the view)
        // and the revert switch flipping mid-step both land on the very next frame —
        // and with the switch off this is the original line, unconditionally.
        if (!walkAnim() || !walkFrames(u, u.artFace))
          u.group.position.y += Math.sin(p * Math.PI) * 0.14;
      }, () => { u.x = nx; u.z = nz; stepOnce(); });
    };
    stepOnce();
  }
  // Return to where this unit started the turn. The snapshot holds view
  // rotation as well as the tile, which is why it is taken page-side.
  //
  // Undo lives in two windows now (Jonah's ruling, 2026-08-05). Mid-turn,
  // before the unit has acted, it works exactly as before. Once acted, it
  // works ONLY while the facing picker is up, and only for a move committed
  // AFTER the unit already acted (attack/cast first, then move — the turn
  // auto-ends straight into the picker). `u.undo.postAct` marks that ordering
  // at the moment the move was committed (`commitPlayerMoveTo` in
  // battle-input.mjs), which is what tells this apart from the two pickers
  // that must stay final: Wait's (however the unit got there — moved or not,
  // acted or not) and the move-THEN-act ordering's, where the stale `u.undo`
  // snapshot points at the tile before the move, not the tile the unit acted
  // from. Either way the action itself stays spent — this reverts position
  // and facing only.
  function undoMove() {
    const u = flow.current();
    if (!u || !u.undo) return;
    if (flow.phase === 'facing') {
      if (!u.undo.postAct) return;
      revertToUndo(u);
      hideFacingArrows();
      flow.phase = 'player';
      clearHighlights(); refreshButtons();
      return;
    }
    if (flow.phase !== 'player' || u.acted) return;
    revertToUndo(u);
    flow.clearMode(); clearHighlights(); refreshButtons();
  }
  function revertToUndo(u) {
    u.x = u.undo.x; u.z = u.undo.z;
    u.group.position.copy(tileCenter(u.x, u.z));
    u.group.rotation.y = u.undo.ry;
    u.undo = null; u.moved = false;
    marker.position.set(u.x + 0.5, tileTop[u.z][u.x] + 0.02, u.z + 0.5);
    floatText('UNDO', tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.68, 0)), '#c6d2ea');
  }

  // ------------------------------------------------------------------ attack
  /**
   * Is the attacker standing in this target's rear quadrant?
   *
   * The defender's facing is read from `group.rotation.y`, which unit-factory
   * already documents as the unit's LOGICAL facing — the billboard node beneath
   * it is what turns to the camera, so the outer yaw is untouched by rendering.
   * Reading the fact the game already keeps is deliberate: a duplicate domain
   * `facing` field would need keeping in step through movement, the facing
   * picker, the undo snapshot and the militia's turn-to-face, and the copy that
   * goes stale is the one a rule would then be decided by.
   *
   * `attack` faces the ATTACKER at its target before this runs, which is right:
   * turning to strike is what an attacker does, and it cannot change where the
   * defender is looking.
   */
  function strikesFromRear(att, def) {
    if (!def.group) return false;
    return isRearAttack(att, def, facingFromAngle(def.group.rotation.y));
  }
  function strike(def, profile, att) {
    applyDamage(def, rollDamage(profile, randomSource()), undefined, att ? att.id : null);
  }
  // arrow / bolt: a small mesh on a shallow arc between the two tiles
  function projectile(from, to, u, done) {
    const bolt = u.cls === 'mage'
      ? new THREE.Mesh(new THREE.OctahedronGeometry(0.09),
          new THREE.MeshBasicMaterial({ color: 0xe0c4ff }))
      : new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.035, 0.34),
          new THREE.MeshBasicMaterial({ color: 0xf0e2c4 }));
    bolt.renderOrder = 880;
    scene.add(bolt);
    const a = from.clone().add(new THREE.Vector3(0, 0.62, 0));
    const b = to.clone().add(new THREE.Vector3(0, 0.62, 0));
    const arc = 0.22 + a.distanceTo(b) * 0.07;
    tween(0.1 + a.distanceTo(b) * 0.035, p => {
      bolt.position.lerpVectors(a, b, p);
      bolt.position.y += Math.sin(p * Math.PI) * arc;
      bolt.lookAt(b);
    }, () => { scene.remove(bolt); bolt.geometry.dispose(); bolt.material.dispose(); done(); });
  }
  function attack(att, def, done, scale = 1) {
    beginActionAnimation();
    faceToward(att, def.x, def.z);
    const profile = attackProfile({
      power: att.atk,
      baseScale: scale,
      isRanged: att.range > 1,
      distance: distance(att, def),
      aimed: hasStatus(att, 'aimed'),
      marked: isMarked(def, att.id),
      rear: strikesFromRear(att, def),
      adjacencyPenalty: adjacencyPenalty(),
      aimMultiplier,
      markMultiplier: 3,
      rearMultiplier: rearMultiplier(),
      supportMultiplier: supportMultiplier(att),
      height: heightMod(att, def),
      defending: hasStatus(def, 'defending'),
    });
    if (profile.fromRear) {
      floatText('REAR', tileCenter(att.x, att.z).add(new THREE.Vector3(0, 2.15, 0)), '#ffe08a');
    }
    if (profile.consumesAim) {                                         // the saved shot, spent
      setAimed(att, false);
      floatText('×2', tileCenter(att.x, att.z).add(new THREE.Vector3(0, 1.9, 0)), '#ffc070');
    }
    if (profile.consumesMark) {
      clearMark();
      floatText('×3', tileCenter(att.x, att.z).add(new THREE.Vector3(0, 1.9, 0)), '#ffb27a');
    }
    const land = () => { strike(def, profile, att); later(done, 300); };
    if (att.range > 1) {
      projectile(tileCenter(att.x, att.z), tileCenter(def.x, def.z), att, land);
    } else {
      const home = att.group.position.clone();
      const lunge = home.clone().lerp(tileCenter(def.x, def.z), 0.3);
      tween(0.16, p => att.group.position.lerpVectors(home, lunge, p),
        () => tween(0.18, p => att.group.position.lerpVectors(lunge, home, p), land));
    }
  }
  /**
   * Take the guard. Under rules.defendCostsTp it is BOUGHT, for 1 TP.
   *
   * The rule exists because a free Defend dominated Wait: there was never a
   * reason to end a turn unspent rather than end it guarding, so one of the two
   * buttons was dead. Pricing the guard makes Wait the legitimate TP-banking
   * move and Defend a purchased hedge that competes with Righteous Anger,
   * Sentinel's Eye and the rest for the same currency.
   *
   * Returns false when the unit cannot pay, which is a real outcome rather than
   * a guard rail: an archer at 0 TP genuinely has nothing to spend, and the
   * militia AI reads this answer instead of being handed a free stance. The
   * caller decides what to do instead — the action bar greys the button, the
   * AI ends its turn.
   */
  function defendAction(u) {
    // `canDefend` is the legality question, and this is the ONLY caller allowed
    // to skip asking it — so it does not. The old `__BATTLE.defend()` carried
    // its own `!acted` test and the button carried another; folding both in
    // here is what stops a third caller inventing a different answer. (Left
    // out on the first pass, and the flags-off golden gate caught it: with the
    // rule off, a unit that had already acted could guard a second time.)
    if (!canDefend(u)) return false;
    const cost = defendCost();
    if (cost > 0) present(spendTp(u, cost));      // also consumes the action
    present(beginDefend(u));
    floatText('GUARD', tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.68, 0)), '#9fd8ff');
    completeAction(u);
    return true;
  }
  /** May this unit take the guard right now — the question the HUD and AI ask. */
  function canDefend(u) {
    if (!u || !u.alive || u.acted) return false;
    const cost = defendCost();
    return cost === 0 || u.tp >= cost;
  }

  // --------------------------------------------------------------- abilities
  function setPoison(u, turns) { present(setPoisonState(u, turns)); }
  function setAimed(u, on) { present(setAimedState(u, on)); }
  function castAbility(u, key, target = null, done = null) {
    const def = ability(key);
    if (!def) return false;
    def.execute(u, target, done);
    return true;
  }
  /**
   * Enter one of a unit's forms. What the form IS — its role label, its kit, the
   * plates and dialogue face it wears — belongs to the character record, so this
   * path is the same for every character and the next one's form is a record edit
   * plus its art. WHEN a switch fires stays with whoever triggers it: today that
   * is the warning-bell script, stressing Seira 4 → 2 on Cassien's rebuke.
   * Returns false for a form the character does not have.
   */
  function switchUnitForm(u, formId) {
    const form = characterForm(u.charId, formId);
    if (!form) return false;
    present(switchFormState(u, { form: formId, role: form.role, abil: form.kit }));
    return true;
  }

  // ---------------------------------------------------------------- forecast
  // FFT-style: attacker card, damage plate, target card(s). How that panel is
  // DRAWN belongs to `ui/forecast-panel.mjs`; these are the two rules it
  // previews. Both mirror something this module executes — a plain strike's
  // profile and the reprisal a strike provokes — and execution and forecast
  // share the pure combat profile, so presentation cannot drift away from the
  // rules.
  function attackRange(att, def, overrides = {}) {
    return attackProfile({
      power: att.atk,
      isRanged: att.range > 1,
      distance: distance(att, def),
      aimed: overrides.aimed ?? hasStatus(att, 'aimed'),
      marked: overrides.marked ?? isMarked(def, att.id),
      rear: overrides.rear ?? strikesFromRear(att, def),
      adjacencyPenalty: adjacencyPenalty(),
      aimMultiplier,
      markMultiplier: 3,
      rearMultiplier: rearMultiplier(),
      supportMultiplier: supportMultiplier(att),
      height: heightMod(att, def),
      defending: hasStatus(def, 'defending'),
    });
  }
  // What striking a bonded enemy will cost the ATTACKER. Mirrors
  // queueRetaliation exactly — fixed revenge, one reprisal per avenger
  // (Jonah's rule), berserk doubling — so the panel never lies. Where the
  // outcome depends on whether this hit kills (berserk onset, or the last
  // survivor's self-revenge), the roll range decides: certain outcomes show
  // one number, uncertain ones show the honest range.
  function revengeRange(att, tgt) {
    const none = { lo: 0, hi: 0 };
    if (!warbell) return none;
    if (!isBonded(tgt.cls)) return none;
    const r = attackRange(att, tgt);
    const base = revengeDamage();
    // An avenger that is ALREADY berserk uses the multiplier it stored when it
    // turned; one that is about to turn will use the live tunable. Reading the
    // right one in each case is what keeps the panel honest across a mid-battle
    // slider change.
    const hot = a => Math.round(
      revengeDamage() * (a && isBerserk(a) ? berserkMultiplierOf(a) : berserkMultiplier()));
    const partner = units.find(v => v.alive && v.id !== tgt.id && isBonded(v.cls));
    if (partner) {
      if (isBerserk(partner) || r.lo >= tgt.hp) return { lo: hot(partner), hi: hot(partner) };
      return { lo: base, hi: r.hi >= tgt.hp ? hot(partner) : base };
    }
    if (!soloRevenge() || r.lo >= tgt.hp) return none;   // a dead last-survivor avenges nothing
    const solo = isBerserk(tgt) ? hot(tgt) : base;
    return { lo: r.hi >= tgt.hp ? 0 : solo, hi: solo };
  }

  return {
    moveUnit, undoMove,
    attack, projectile, defendAction, canDefend,
    setPoison, setAimed, castAbility, switchUnitForm,
    attackRange, revengeRange,
  };
}
