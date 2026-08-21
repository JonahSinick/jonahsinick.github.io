import {
  applyBerserkState,
  applyDamageState,
  berserkMultiplierOf,
  clearMarkState,
  isMarked,
  markedUnit,
  setMarkState,
} from '../core/battle-state.mjs';
import { addStatus, hasStatus, removeStatus } from '../core/statuses.mjs';
import { createEventLog } from '../core/event-log.mjs';

/**
 * The one seam where presentation reacts to the domain.
 *
 * `battle-state.mjs` owns the rules and returns serializable events; every
 * damage, heal, status, form-switch and defeat in the game funnels through
 * `present()` here and becomes a flash, a floating number, a bark, a costume
 * change. Colors and float heights are presentation, so they live here and not
 * in the events.
 *
 * Three behaviours in this module are Jonah-ruled and gate-asserted:
 *
 * - an out-of-band `'revenge'`-kind fall runs the end check and then ends the
 *   turn (`observeOutOfBandFall`), because reprisal damage lands after the
 *   attacker's action has already completed and the turn engine only checks
 *   endings at `nextTurn`;
 * - one reprisal per avenger per provocation (the `reprisalPending` status);
 * - a berserk avenger's reprisal scales by the multiplier captured when it
 *   turned, never by the live tunable.
 *
 * Whether a reprisal is currently held at all belongs to the reaction registry,
 * which this module only asks — and so does whether one is still resolving. A
 * reprisal lands its damage at the end of an animation, so the seam declares
 * the resolution open when it queues one and closed when the damage is on the
 * stream; the turn machine holds the next turn boundary on that count. Without
 * it, frame pacing decided whether the revenge recorded before or after the
 * next `turnStarted`.
 */

/**
 * The bonded pair's classes. Cross-retaliation and grief-berserk are declared
 * by the battle descriptor, but WHO answers for whom is still read off the
 * class here; a second bonded pair would want this on the descriptor.
 */
export const isBonded = cls => cls === 'champion' || cls === 'beast';

export function createBattleEvents({
  THREE, scene, world,
  units, flow, reactions,
  // view primitives
  floatText, tileCenter, tween, later, uiCol, hash, cheb, faceToward,
  setWalking, setSpritePose, applyFormArt, markMesh, bark,
  // HUD
  banner, renderStrip, refreshButtons,
  unitById,
  // The turn machine is mutually recursive with this seam — a turn presents
  // events, an out-of-band reprisal fells the acting unit, and the turn has to
  // end. Both arrive as calls so neither has to be constructed first.
  checkEnd, endTurn,
  // live tunables: read per reprisal, so a mid-battle slider move is seen
  revengeDamage, berserkMultiplier, soloRevenge,
}) {
  for (const [name, value] of Object.entries({
    THREE, scene, world, units, flow, reactions,
    floatText, tileCenter, tween, later, uiCol, hash, cheb, faceToward,
    setWalking, setSpritePose, applyFormArt, markMesh, bark,
    banner, renderStrip, refreshButtons, unitById,
    checkEnd, endTurn, revengeDamage, berserkMultiplier, soloRevenge,
  })) {
    if (value === undefined || value === null)
      throw new Error(`battle-events: missing context "${name}"`);
  }

  // --------------------------------------------------------- damage views
  function redrawHp(u) {
    // The bar carries three things now: team (its colour), health (its length)
    // and poison (its keyline), so a status change redraws it as a damage tick
    // does. See unit-factory's hpSprite for why poison rides the border.
    u.bar.userData.draw(Math.max(0, u.hp) / u.maxHp, hasStatus(u, 'poison'));
    renderStrip();
  }
  // sprites are unlit, so a hit reads as a red tint on the texture rather than emissive
  function flash(u) {
    const hot = new THREE.Color(0xff3a28);
    // the untinted colour is remembered once, so overlapping hits (a poison tick
    // landing on top of an arrow) can never leave a sprite permanently stained —
    // and it is read live rather than captured, because the killing blow can grey
    // a downed sprite out while this tween is still running
    u.mats.forEach(m => {
      if (m.userData.baseColor === undefined) m.userData.baseColor = m.color.getHex();
    });
    tween(0.28, p => {
      const k = 1 - p;
      u.mats.forEach(m => m.color.setHex(m.userData.baseColor).lerp(hot, k * 0.9));
    }, () => u.mats.forEach(m => m.color.setHex(m.userData.baseColor)));
  }
  function killUnitView(u) {
    setWalking(u, false);
    u.bar.visible = false; u.shieldRing.visible = false;
    u.aimMesh.visible = false; u.poisonIcon.visible = false;
    const y0 = u.group.position.y;
    // drop the alpha cutout for the fade — a cut-out sprite can't dissolve below 0.5
    u.mats.forEach(m => { m.transparent = true; m.alphaTest = 0; m.depthWrite = false; });
    tween(0.6, p => {
      u.group.position.y = y0 - p * 0.55;
      u.group.scale.setScalar(1 - p * 0.4);
      u.mats.forEach(m => { m.opacity = 1 - p; });
    }, () => { world.remove(u.group); renderStrip(); });
  }
  // Downed, not dead: the militia stay on the field on their knees. The post-battle
  // scene needs the bodies visible, so nothing is ever removed or faded — the sprite
  // simply swaps to its kneeling frame and stays there.
  function downUnitView(u) {
    setWalking(u, false);
    u.bar.visible = false; u.shieldRing.visible = false;
    u.aimMesh.visible = false; u.poisonIcon.visible = false;
    setSpritePose(u, 'down');
    u.fig.userData.pitch = 0.42 + hash(u.x, u.z) * 0.2;   // reported by __BATTLE.pose()
    const off = (hash(u.z, u.x) - 0.5) * 0.3;
    tween(0.45, p => {
      u.fig.position.y = -p * 0.06;      // a small settle as the body comes to rest
      u.sprite.position.x = p * off;     // billboard-local: always a sideways slump on screen
    }, renderStrip);
  }

  // ------------------------------------------------------------- reactions
  // Reactive mechanics are declared by the battle (src/content/battles/), not
  // branched on inside the seam. The registry answers "what does this event
  // provoke, and is it currently held"; these runners are the animated,
  // battle-specific half it deliberately knows nothing about.
  const REACTION_RUNNERS = {
    // each half of the bonded pair answers harm to the OTHER. Only true attacks
    // with a known attacker provoke it (declared in the descriptor), so a
    // reprisal can never chain into another reprisal
    'bond-retaliation': (ev, u) => queueRetaliation(u, ev.sourceId),
    'berserk-survivor': (ev, u) => berserkSurvivor(u),
  };
  function fireReaction(record, unit) {
    const run = REACTION_RUNNERS[record.id];
    if (run) run(record.event, unit);
  }
  function runReactions(event, unit) {
    for (const record of reactions.provoked(event, unit)) fireReaction(record, unit);
  }

  // ------------------------------------------------------------- the seam
  // Every domain event lands here, so this is also where the golden-log
  // capture taps the stream (SCALABILITY doc, "Golden event-log regression
  // tests"): each event is recorded with the round and acting-unit context
  // BEFORE the view branch below runs, so an event a future view branch
  // doesn't handle is still captured.
  const eventLog = createEventLog();
  function present(events, color) {
    const actorId = flow.queue[flow.qi] ? flow.queue[flow.qi].id : null;
    for (const ev of events) {
      eventLog.record(flow.round, flow.qi, actorId, ev);
      const u = units.find(v => v.id === ev.unitId);
      if (!u) continue;
      if (ev.type === 'damageApplied') {
        redrawHp(u);
        runReactions(ev, u);
        if (ev.kind === 'self') {          // a paid cost, not a hit: no flash
          floatText('-' + ev.amount, tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.9, 0)),
            color || '#d39cff');
        } else {
          flash(u);
          floatText(String(ev.amount), tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.68, 0)),
            color || (ev.kind === 'poison' ? '#8fe07a'
                      : u.team === 'player' ? '#ff9a8a' : '#ffe08a'));
        }
      } else if (ev.type === 'healApplied') {
        redrawHp(u);
        floatText('+' + ev.amount, tileCenter(u.x, u.z).add(new THREE.Vector3(0, 1.68, 0)), '#b4ffdc');
      } else if (ev.type === 'formChanged') {
        // The tell is the costume: the unit changes plates on this beat, and its
        // dialogue/panel face changes with them. (The rose tint that stood in for
        // the art is gone — it was a placeholder for exactly this.)
        banner(u.name, u.role);
        floatText('STRESS → ' + u.role, tileCenter(u.x, u.z).add(new THREE.Vector3(0, 2.1, 0)), '#ffb4d0');
        applyFormArt(u, ev.form);
        renderStrip(); refreshButtons();
      } else if (ev.type === 'unitDowned') {
        if (hasStatus(u, 'marked')) clearMark();
        downUnitView(u);
        runReactions(ev, u);
        observeOutOfBandFall(u, ev);
      } else if (ev.type === 'unitDefeated') {
        // the mark falls with either end of it: its bearer or the caster holding it
        const marked = markedUnit(units);
        if (marked && (marked.id === u.id || isMarked(marked, u.id))) clearMark();
        killUnitView(u);
        runReactions(ev, u);
        observeOutOfBandFall(u, ev);
      } else if (ev.type === 'berserkApplied') {
        presentBerserk(u);
      } else if (ev.type === 'tpSpent') {
        renderStrip();
      } else if (ev.type === 'statusAdded' || ev.type === 'statusRemoved') {
        const on = ev.type === 'statusAdded';
        if (ev.status === 'aimed') {
          u.aimMesh.visible = on && u.alive;
        } else if (ev.status === 'defending') {
          u.shieldRing.visible = on;
        } else if (ev.status === 'poison') {
          u.poisonIcon.visible = on;
          // The sickly ring at the feet went with the ground identity layer;
          // poison is the bar's keyline now, so the bar is what redraws.
          redrawHp(u);
        } else if (ev.status === 'marked') {
          markMesh.visible = on;
          if (on) markMesh.position.copy(u.group.position);
        }
      }
    }
  }
  function applyDamage(def, dmg, color, sourceId = null, kind = 'attack') {
    present(applyDamageState(def, dmg, kind, sourceId), color);
  }
  // Righteous Anger's mark rides the target as a status carrying its caster's
  // id, and the two transitions that move it come through the seam like
  // everything else.
  function setMark(caster, target) { present(setMarkState(units, caster.id, target.id)); }
  function clearMark() { present(clearMarkState(units)); }

  // Reprisal damage is the game's first that lands OUTSIDE the turn flow (a
  // delayed flight after the attacker's action already completed). The turn
  // engine only checks endings at nextTurn, so an out-of-band kill used to
  // leave a dead unit holding a live turn — current() returns null for the
  // dead, every button gates on it, and the battle soft-locks; a reprisal
  // felling Seira also left the defeat unobserved. The seam itself now
  // watches: only 'revenge'-kind falls route here, because in-band damage
  // (attacks, poison, cry) already has its ending handled by the turn flow
  // and a second endTurn would double-advance the queue.
  function observeOutOfBandFall(u, ev) {
    if (ev.kind !== 'revenge' || flow.phase === 'over') return;
    if (checkEnd()) return;
    if (flow.queue[flow.qi] === u && flow.phase === 'player') { flow.uiTurn = false; endTurn(); }
  }

  // ----------------------------------------------------- grief and reprisal
  // When one of the bonded pair falls, the survivor's grief turns violent: its
  // attacks scale by the berserk multiplier from that point (forecasts see it
  // too, since atk itself changes), and with solo revenge it begins avenging
  // itself the way it avenged its partner — so the endgame never collapses into
  // free hits. The enraged review portraits carry the moment: her grin dies into
  // the snarl. The state change is a domain transition (atk scaling, the stored
  // multiplier) and comes back as a berserkApplied event; everything below the
  // transition is how the moment looks. Routing it through the seam is what
  // keeps the doubled atk explained by an event rather than by an unrecorded
  // write.
  function berserkSurvivor(fallen) {
    const survivor = units.find(v => v.alive && v.id !== fallen.id && isBonded(v.cls));
    if (!survivor) return;
    present(applyBerserkState(survivor, berserkMultiplier()));
  }
  function presentBerserk(u) {
    banner(u.name, 'BERSERK');
    floatText('BERSERK', tileCenter(u.x, u.z).add(new THREE.Vector3(0, 2.05, 0)), '#ff5030');
    const RVP = 'art/runtime/review/bonded_defender_cragbeast/portraits/';
    bark(u,
      u.cls === 'champion' ? "SKARN—! ...I'll break every one of you." : 'RRRAAAGH—!',
      RVP + (u.cls === 'champion'
        ? 'defender_type8_aggressive_enraged_candidate.png'
        : 'cragbeast_enraged_candidate.png'));
    renderStrip();
  }
  // Cross-retaliation (Jonah's spec): hurt the beast and the captain answers,
  // hurt the captain and the beast answers. The revenge is a FIXED amount —
  // never proportional — so many small hits cost more than one prepared blow.
  // A stone answers a distant attacker; a lunge answers an adjacent one.
  //
  // The registry has already decided that this victim's class and this damage
  // kind provoke a reprisal, and whether the moment is suspended; what is left
  // here is who answers and how it looks.
  function queueRetaliation(victim, sourceId) {
    let partner = units.find(v => v.alive && v.id !== victim.id && isBonded(v.cls));
    if (!partner && soloRevenge() && victim.alive) partner = victim;  // the berserk survivor avenges itself
    const target = unitById(sourceId);
    if (!partner || !target || !target.alive) return;
    // Jonah's ruling: one reprisal per avenger per provocation — a survivor
    // whose partner just fell never fires its partner's reprisal AND its own
    // from the same burst. The flag clears when the stone lands or aborts.
    if (hasStatus(partner, 'reprisalPending')) return;
    addStatus(partner, 'reprisalPending');
    // From here the reprisal's DOMAIN resolution is in flight and the turn
    // machine will not open the next turn until it closes. The 300ms below and
    // the tweens under it are VIEW pacing — when the stone is thrown, how long
    // it flies — and view pacing used to decide whether this reprisal's
    // `damageApplied` recorded before or after the next `turnStarted`, which
    // made the battle's golden stream a coin flip. Pacing stays; the ordering
    // is now a domain decision.
    //
    // `resolved()` must be reached on every path out of this chain, or the
    // boundary it holds never opens. It is idempotent, so an exit that is
    // somehow reached twice is safe.
    const resolved = reactions.beginResolution();
    later(() => {
      if (!partner.alive || !target.alive || flow.phase === 'over') {
        removeStatus(partner, 'reprisalPending'); resolved(); return;
      }
      faceToward(partner, target.x, target.z);
      const land = () => {
        removeStatus(partner, 'reprisalPending');
        // never land under the outcome overlay
        if (!target.alive || flow.phase === 'over') { resolved(); return; }
        // A berserk avenger's grief doubles the reprisal along with its attacks,
        // using the multiplier captured when it went berserk — reading the live
        // tunable here instead let a mid-battle slider change leave one unit
        // carrying two different active multipliers.
        const dmg = Math.round(revengeDamage() * (berserkMultiplierOf(partner) ?? 1));
        // THE REPRISAL NAMES ITS AVENGER. This carried `null` until 2026-08-03,
        // which meant the event stream recorded that revenge happened, how much
        // and to whom, but never who dealt it — so the golden logs would replay
        // byte-identical through a bond that answered with the WRONG half of the
        // pair, which is exactly the bug Jonah suspected he had seen. A stream
        // that cannot record who acted cannot catch the wrong actor.
        //
        // It cannot start a chain: `bond-retaliation` is declared for
        // `kinds: ['attack']` and this damage is kind 'revenge', so the
        // provocation never matches however the source is filled in. The
        // declaration's `requiresSource` is belt-and-braces beside that, not the
        // thing preventing the loop — which is now pinned by a test
        // (tests/reprisal-attribution.test.mjs) rather than left as a comment.
        applyDamage(target, dmg, '#ffa060', partner.id, 'revenge');
        floatText('REVENGE', tileCenter(target.x, target.z).add(new THREE.Vector3(0, 2.05, 0)), '#ffa060');
        // last, and never before applyDamage: closing this is what lets the
        // held turn boundary open, and the revenge damage has to be on the
        // stream by then. `applyDamage` also runs the out-of-band fall check
        // inside itself, so the ending is observed before the release too.
        resolved();
      };
      if (cheb(partner, target) > 1) {
        stoneThrow(partner, target, land);
      } else {
        const home = partner.group.position.clone();
        const reach = home.clone().lerp(tileCenter(target.x, target.z), 0.3);
        tween(0.16, p => partner.group.position.lerpVectors(home, reach, p),
          () => tween(0.18, p => partner.group.position.lerpVectors(reach, home, p), land));
      }
    }, 300);
  }
  function stoneThrow(from, to, done) {
    const stone = new THREE.Mesh(new THREE.DodecahedronGeometry(0.11, 0),
      new THREE.MeshBasicMaterial({ color: 0x9a8f80 }));
    stone.renderOrder = 880;
    scene.add(stone);
    const a = tileCenter(from.x, from.z).add(new THREE.Vector3(0, 0.8, 0));
    const b = tileCenter(to.x, to.z).add(new THREE.Vector3(0, 0.6, 0));
    const arc = 0.5 + a.distanceTo(b) * 0.09;
    tween(0.12 + a.distanceTo(b) * 0.04, p => {
      stone.position.lerpVectors(a, b, p);
      stone.position.y += Math.sin(p * Math.PI) * arc;
      stone.rotation.x = p * 9; stone.rotation.z = p * 7;
    }, () => { scene.remove(stone); stone.geometry.dispose(); stone.material.dispose(); done(); });
  }

  return {
    present, applyDamage, setMark, clearMark,
    // the warning-bell opening replays a held reprisal by handing back the
    // record the registry parked, so it needs the runner by name
    fireReaction,
    // golden-log capture surface: only entries()/clear() are public — record()
    // is present()'s own business, not a caller's
    eventLog: { entries: eventLog.entries, clear: eventLog.clear },
  };
}
