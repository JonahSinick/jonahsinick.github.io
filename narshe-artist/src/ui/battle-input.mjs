/**
 * The player's half of the battle: what a tap or a key means.
 *
 * Two input paths reach the same commands. The pointer picks a tile and
 * commits directly; the keyboard drives a cursor (a destination ring in Move,
 * a target ring in Attack, the action-bar cursor otherwise) and confirms with
 * Enter. Both funnel into the same four `commit*`/`choose*` functions, so a
 * rule enforced for one is enforced for the other.
 *
 * Everything here reads `flow.phase` and `flow.mode` before it does anything;
 * `mode`, `curAbil` and `uiTurn` are the only spine fields it writes. `uiTurn`
 * is the flag that earns the FFT facing beat at end of turn — set on every
 * pointer- or keyboard-driven action, and never by the debug adapter, which is
 * why the balance bots never stall on a picker they cannot click.
 */
export function createBattleInput({
  flow, units, camera, canvas, raycaster, ndc, viewport,
  // the scene's pickable surfaces. `highlights` is an accessor because
  // clearHighlights REPLACES the array rather than emptying it.
  highlights, tileMeshes,
  // grid rules
  unitAt, walkable, inBounds, reachable, moveTiles, pathTo, attackTargets, abilTargets, canCast,
  // The range ENVELOPE as tiles, empty squares included — the highlight's
  // input, and only the highlight's. Every commit site below still asks
  // `attackTargets`/`abilTargets`, so a lit empty square grants nothing.
  attackFootprint, abilFootprint,
  // targeting chrome, owned by the page beside its meshes
  showHighlights, clearHighlights, setMoveCursor, setAttackCursor, clearAttackCursor,
  moveTarget, attackCursorUnit,
  // the threat arcs (src/ui/threat-arcs.mjs): who threatens the tile a Move
  // destination is pinned on. `showThreatArcs` is the module's own `show`,
  // taking a threats array and a tile — the keyboard cursor below calls it
  // with the same "is this tile lit as danger" test the pointer hover already
  // uses, so a destination SELECTED by keyboard gets the same answer a
  // hovered one does, and stays pinned there rather than needing the mouse to
  // sit on it.
  showThreatArcs, threatUnitsAt,
  // HUD
  refreshButtons, moveActionCursor, executeActionCursor,
  // actions and the turn machine
  moveUnit, attack, castAbility, defendAction, undoMove, completeAction, endTurn,
  ability, forecast, centerOn,
  // the facing beat owns both the click and the keyboard while it is up
  facing,
  // a dialogue card swallows the keyboard, and Space advances it
  dialogueUp, advanceDialogue,
  // post-battle free roam
  exploration, exploreTo,
  // global toggles that have always lived on the same keymap
  toggleTac, toggleMute,
  // the four fixed action-bar buttons
  btn,
  // The scene's AbortSignal. Every listener this module hangs on the WINDOW or
  // the CANVAS takes it, because both outlive the battle that added them: the
  // canvas belongs to the session and the window to the tab. Listeners on
  // chrome ELEMENTS need no signal — the session replaces that markup between
  // battles, and a listener dies with the node it was attached to.
  signal,
}) {
  for (const [name, value] of Object.entries({
    flow, units, camera, canvas, raycaster, ndc, viewport,
    highlights, tileMeshes, unitAt, walkable, inBounds, reachable, moveTiles, pathTo,
    attackTargets, abilTargets, canCast, attackFootprint, abilFootprint,
    showHighlights, clearHighlights, setMoveCursor, setAttackCursor, clearAttackCursor,
    moveTarget, attackCursorUnit, showThreatArcs, threatUnitsAt,
    refreshButtons, moveActionCursor, executeActionCursor,
    moveUnit, attack, castAbility, defendAction, undoMove, completeAction, endTurn,
    ability, forecast, centerOn, facing, dialogueUp, advanceDialogue,
    exploration, exploreTo, toggleTac, toggleMute, btn,
  })) {
    if (value === undefined || value === null)
      throw new Error(`battle-input: missing context "${name}"`);
  }

  // ---------------------------------------------------------------- picking
  function aimRay(ev) {
    const { width, height } = viewport();
    ndc.x = (ev.clientX / width) * 2 - 1;
    ndc.y = -(ev.clientY / height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }
  function tileFromHit(hit) {
    let o = hit && hit.object;
    while (o) {
      if (o.userData.unitRef) return { x: o.userData.unitRef.x, z: o.userData.unitRef.z };
      if (o.userData.tile) return o.userData.tile;
      o = o.parent;
    }
    return null;
  }
  function pick(ev, highlightFirst = false) {
    aimRay(ev);
    // In Move mode the player is choosing a square, not the billboard that may
    // project across it. Give the visible legal-square plane first refusal so a
    // tall foreground sprite cannot swallow the intended destination click.
    if (highlightFirst) {
      for (const h of raycaster.intersectObjects(highlights(), false)) {
        const tile = tileFromHit(h);
        if (tile) return tile;
      }
    }
    const hits = raycaster.intersectObjects([...highlights(), ...tileMeshes, ...units.filter(u => u.alive).map(u => u.group)], true);
    for (const h of hits) {
      const tile = tileFromHit(h);
      if (tile) return tile;
    }
    return null;
  }
  function pickExploration(ev) {
    aimRay(ev);
    const hit = raycaster.intersectObjects(tileMeshes, true)[0];
    if (!hit) return null;
    const x = Math.floor(hit.point.x), z = Math.floor(hit.point.z);
    return walkable(x, z)
      ? { x, z, px: hit.point.x, pz: hit.point.z }
      : null;
  }

  // ------------------------------------------------------------------- mode
  function setMode(m) {
    const u = flow.current();
    if (flow.phase !== 'player' || !u) return;
    flow.mode = (flow.mode === m) ? null : m;
    flow.curAbil = null;
    if (flow.mode === 'move') {
      if (u.moved) flow.mode = null;
      else {
        // `moveTiles` is `reachable(u).tiles` with a per-tile `kind` attached
        // when rules.dangerTiles is on. Legality still comes from `reachable`
        // at every commit site below, so the shading can never grant or refuse
        // a move — it only colours one.
        showHighlights(moveTiles(u), 'move');
        setMoveCursor(u.x, u.z, false);
      }
    } else if (flow.mode === 'attack') {
      if (u.acted) flow.mode = null;
      else {
        // The highlight is the ENVELOPE, empty squares and all, so that range
        // reads as range on an open field; the cursor still opens on a real
        // target, and the commit still asks `attackTargets`.
        const targets = orderedAttackTargets(u);
        showHighlights(attackFootprint(u), 'attack');
        if (targets.length) setAttackCursor(targets[0]);
      }
    } else clearHighlights();
    refreshButtons();
  }

  // ----------------------------------------------------------- move command
  // Pin the threat arcs to a destination the player just SELECTED (keyboard
  // cursor or a click that missed — see commitPlayerMoveTo), the same "is
  // this tile lit as danger" test the pointer's own hover already runs. This
  // is what makes a keyboard-selected destination answer "by whom" without
  // the mouse ever sitting on it, and lets the arcs stay up while the player
  // deliberates rather than only while the cursor happens to be hovering
  // (Jonah, 2026-08-05).
  function pinThreatArcs(x, z) {
    const lit = highlights().some(m => m.userData.tile.x === x && m.userData.tile.z === z);
    showThreatArcs(lit ? threatUnitsAt(x, z) : [], lit ? { x, z } : null);
  }
  function moveMoveCursor(key) {
    const u = flow.current();
    const dir = facing.keyDir(key);
    if (flow.phase !== 'player' || flow.mode !== 'move' || !u || !dir) return false;
    const legal = reachable(u).tiles;
    const from = moveTarget() || { x: u.x, z: u.z };
    // Skip over a non-landable ally or scenery edge to the first legal square in
    // the requested screen direction; the destination itself still has to be in
    // the real BFS result, so this never grants movement the unit does not have.
    for (let distance = 1; distance <= u.move; distance++) {
      const x = from.x + dir[0] * distance;
      const z = from.z + dir[1] * distance;
      if (!inBounds(x, z)) break;
      if (x === u.x && z === u.z) {
        setMoveCursor(x, z);
        centerOn(x, z, 0.18);
        pinThreatArcs(x, z);
        return true;
      }
      if (legal.some(tile => tile.x === x && tile.z === z)) {
        setMoveCursor(x, z);
        centerOn(x, z, 0.18);
        pinThreatArcs(x, z);
        return true;
      }
    }
    return false;
  }
  function commitPlayerMoveTo(t) {
    const u = flow.current();
    if (flow.phase !== 'player' || flow.mode !== 'move' || !u || !t) return false;
    const res = reachable(u);
    if (!res.tiles.some(q => q.x === t.x && q.z === t.z)) return false;
    flow.uiTurn = true;
    // `postAct` marks a move committed AFTER the unit already acted this turn
    // — the act-then-move ordering `undoMove` (unit-actions.mjs) reads at the
    // facing picker to decide whether THIS move is still reversible there.
    u.undo = { x: u.x, z: u.z, ry: u.group.rotation.y, postAct: u.acted };
    u.moved = true;
    moveUnit(u, pathTo(res, u, t.x, t.z), () => afterPlayerMove(u));
    return true;
  }
  function confirmMoveCursor() {
    return moveTarget() ? commitPlayerMoveTo(moveTarget()) : false;
  }
  function afterPlayerMove(u) {
    if (u.acted) { endTurn(); return; }
    flow.phase = 'player'; flow.clearMode(); refreshButtons();
  }

  // --------------------------------------------------------- attack command
  function orderedAttackTargets(u) {
    return attackTargets(u).slice().sort((a, b) => {
      const ap = a.group.position.clone().project(camera);
      const bp = b.group.position.clone().project(camera);
      return ap.x - bp.x || ap.y - bp.y || a.id - b.id;
    });
  }
  function moveAttackCursor(direction) {
    const u = flow.current();
    if (flow.phase !== 'player' || flow.mode !== 'attack' || !u) return false;
    const targets = orderedAttackTargets(u);
    if (!targets.length) { clearAttackCursor(); return false; }
    let index = targets.indexOf(attackCursorUnit());
    if (index < 0) index = 0;
    else index = (index + direction + targets.length) % targets.length;
    setAttackCursor(targets[index]);
    centerOn(targets[index].x, targets[index].z, 0.18);
    forecast.show('attack', u, targets[index]);
    return true;
  }
  function commitPlayerAttack(target) {
    const u = flow.current();
    if (flow.phase !== 'player' || flow.mode !== 'attack' || !u || !target ||
        u.acted || !attackTargets(u).includes(target)) return false;
    flow.uiTurn = true;
    u.acted = true;
    attack(u, target, () => completeAction(u));
    return true;
  }
  function confirmAttackCursor() {
    return attackCursorUnit() ? commitPlayerAttack(attackCursorUnit()) : false;
  }

  // -------------------------------------------------------- ability command
  function chooseAbil(key) {
    const u = flow.current();
    if (flow.phase !== 'player' || !u || !canCast(u, key)) return;
    const def = ability(key);
    flow.uiTurn = true;                       // ability buttons are a UI path, same as the action bar
    if (def.aim === 'self') { castAbility(u, key); return; }   // no target to pick
    if (flow.mode === 'abil' && flow.curAbil === key) {
      // the burst has no target but its own footprint, so the second press is the confirm
      if (def.aim === 'burst') { castAbility(u, key); return; }
      flow.clearMode(); clearHighlights(); refreshButtons(); return;
    }
    flow.mode = 'abil'; flow.curAbil = key;
    // envelope, not target list (a burst's footprint is already the envelope);
    // `handleTap` below still refuses any square `abilTargets` does not name
    showHighlights(abilFootprint(u, key), def.hl);
    if (def.aim === 'burst') forecast.show(key, u);
    refreshButtons();
  }

  // ------------------------------------------------------------ the pointer
  function handleTap(ev) {
    // the facing beat owns the click: a chevron sets the new facing, anything else keeps it
    if (facing.active()) { facing.close(facing.pickArrow(ev)); return; }
    if (flow.phase === 'explore') {
      const destination = pickExploration(ev);
      if (destination)
        exploreTo(destination.x, destination.z, destination.px, destination.pz);
      return;
    }
    if (flow.phase !== 'player' || !flow.mode) return;
    const u = flow.current(), t = pick(ev, flow.mode === 'move');
    if (!t) return;
    flow.uiTurn = true;                       // a real pointer drove this turn — offer the facing step
    if (flow.mode === 'move') {
      commitPlayerMoveTo(t);
    } else if (flow.mode === 'attack') {
      const target = unitAt(t.x, t.z);
      commitPlayerAttack(target);
    } else if (flow.mode === 'abil') {
      const def = ability(flow.curAbil);
      if (!def || !abilTargets(u, flow.curAbil).some(q => q.x === t.x && q.z === t.z)) return;
      if (def.aim === 'burst') { castAbility(u, flow.curAbil); return; }   // any tile in the preview confirms it
      const target = unitAt(t.x, t.z);
      if (!target) return;
      castAbility(u, flow.curAbil, target);
    }
  }

  canvas.addEventListener('pointerdown', ev => {
    if (ev.button !== 2) return;
    if (facing.active()) { facing.close(null); return; }   // right-click keeps the facing
    flow.clearMode(); clearHighlights(); refreshButtons();
  }, { signal });
  canvas.addEventListener('contextmenu', e => e.preventDefault(), { signal });
  btn.move.addEventListener('click', () => setMode('move'));
  btn.attack.addEventListener('click', () => setMode('attack'));
  // A guard that could not be paid for must not consume the turn or earn the
  // facing beat, so the uiTurn flag follows the action rather than the click.
  btn.defend.addEventListener('click', () => {
    if (flow.phase !== 'player' || !flow.current()) return;
    if (defendAction(flow.current())) flow.uiTurn = true;
  });
  btn.wait.addEventListener('click', () => { if (flow.phase === 'player' && flow.current()) { flow.uiTurn = true; endTurn(); } });

  // ----------------------------------------------------------- the keyboard
  addEventListener('keydown', e => {
    if (e.code === 'Space' && dialogueUp()) { e.preventDefault(); advanceDialogue(); return; }
    // the facing beat owns the keyboard while it is up: arrows/WASD choose a
    // direction (screen-relative, so "up" always means away from the camera),
    // Escape and Enter keep whatever the unit is already looking at
    if (facing.active()) {
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); facing.close(null); return; }
      // The one exception to the picker owning the keyboard: an act-then-move
      // turn's undo is still live here (see undoMove in unit-actions.mjs,
      // which is itself the authority on whether this particular picker
      // offers it — Wait's picker and a stale move-then-act snapshot both
      // decline and this is a no-op for them).
      if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undoMove(); return; }
      const dir = facing.keyDir(e.key);
      if (dir) { e.preventDefault(); facing.close(dir); return; }
      return;
    }
    if (flow.phase === 'explore' && !dialogueUp() && exploration.keyVector(e.key)) {
      e.preventDefault();
      exploration.press(e.key);
      exploration.clearPath();
      return;
    }
    if (flow.phase === 'player' && flow.mode === 'move' && !dialogueUp() &&
        e.key.startsWith('Arrow')) {
      e.preventDefault();
      moveMoveCursor(e.key);
      return;
    }
    if (flow.phase === 'player' && flow.mode === 'move' && !dialogueUp() && e.key === 'Enter') {
      e.preventDefault();
      confirmMoveCursor();
      return;
    }
    if (flow.phase === 'player' && flow.mode === 'attack' && !dialogueUp() &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveAttackCursor(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (flow.phase === 'player' && flow.mode === 'attack' && !dialogueUp() && e.key === 'Enter') {
      e.preventDefault();
      confirmAttackCursor();
      return;
    }
    if (flow.phase === 'player' && !dialogueUp() &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveActionCursor(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (flow.phase === 'player' && !dialogueUp() && e.key === 'Enter') {
      e.preventDefault();
      executeActionCursor();
      return;
    }
    if (e.key === 'Escape') { flow.clearMode(); clearHighlights(); refreshButtons(); }
    if (e.key === 't' || e.key === 'T') toggleTac();
    if (e.key === 'm' || e.key === 'M') toggleMute();
    if (e.key === 'u' || e.key === 'U') undoMove();
    if (e.key === 'c' || e.key === 'C') {
      const focus = flow.phase === 'explore' ? exploration.unit() : flow.current();
      if (focus) centerOn(focus.x, focus.z);
    }
  }, { signal });
  addEventListener('keyup', e => { exploration.release(e.key); }, { signal });
  addEventListener('blur', () => exploration.clearKeys(), { signal });

  return {
    // the pointer-up handler in the camera rig decides tap-vs-drag, then hands
    // the tap here
    handleTap,
    // the hover forecast projects through the same picker
    pick,
    // the action bar's ability buttons, and the debug adapter's move
    chooseAbil, afterPlayerMove,
  };
}
