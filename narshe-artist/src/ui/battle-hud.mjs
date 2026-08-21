/**
 * The battle HUD: the turn strip, the active unit's panel, the action bar, and
 * the keyboard cursor that runs along it.
 *
 * Everything here is a projection of turn state onto the DOM. The HUD reads
 * `flow` and never writes it — the one piece of state it owns is which command
 * the keyboard cursor is sitting on, per unit, which is a property of the
 * pointer/keyboard session rather than of the battle.
 *
 * The element handles stay with the page's other DOM lookups and arrive as
 * context, the same way `ui/dialogue.mjs` takes its three.
 */

import { hasStatus, statusTurns } from '../core/statuses.mjs';

export function createBattleHud({
  document,
  flow,
  // element handles
  elChips, elBar, elPips, elAbils, elPanelUp, btnUndo, btn, elAbilTip, elCostSep,
  tpCap,
  // page rules the bar has to ask about, all hoisted function declarations
  faceOf, attackTargets, canCast, chooseAbil,
  // what the guard costs right now (0 or 1) and whether this unit can pay —
  // both decided by a live rule flag, so both are accessors
  defendCost, canDefend,
  // forward references: the ability registry and the dialogue engine are both
  // constructed further down the page than the HUD is, so these resolve at call
  // time rather than at construction
  ability, dialogueUp,
}) {
  for (const [name, value] of Object.entries({
    document, flow, elChips, elBar, elPips, elAbils, elPanelUp, btnUndo, btn, elAbilTip, elCostSep,
    tpCap, faceOf, attackTargets, canCast, chooseAbil, defendCost, canDefend,
    ability, dialogueUp,
  })) {
    if (value === undefined || value === null)
      throw new Error(`battle-hud: missing context "${name}"`);
  }

  // ------------------------------------------------------------------- costs
  /**
   * What a priced button says its price is.
   *
   * ONE renderer for every cost on the bar — Defend's and every ability's.
   * They used to be written at two call sites in two shapes, which is how
   * "Defend 1 TP" ended up wrapping onto two lines beside a "3 TP" that did
   * not: a cost is one idea and it should be drawn once.
   *
   * The glyph is the game's own TP diamond, the one the unit panel already
   * uses for the same quantity, so the bar and the panel speak about the same
   * resource in the same alphabet.
   *
   * One pip per point, and no numeral at any cost (Jonah, 2026-08-02). A
   * "diamonds up to two, then 3◆" variant was built and tried on the argument
   * that counting pips stops being instant around three — Mournful Cry's cost.
   * Rejected by eye: ◆◆◆ reads fine, and mixing two notations on one bar was
   * worse than the problem it solved.
   */
  const DIAMOND = '&#9670;';
  function costMarkup(cost) {
    if (!(cost > 0)) return '';
    // the title carries the plain reading, so the meaning survives for anyone
    // who cannot tell four diamonds from three at a glance
    return `<span class="cost" title="${cost} TP">${DIAMOND.repeat(cost)}</span>`;
  }

  // ------------------------------------------------------------ action cursor
  const actionCursorByUnit = new Map();
  let actionCursorKey = null;

  function commandKey(button) {
    return button.dataset.abil ? 'abil:' + button.dataset.abil : button.id;
  }
  function availableCommands() {
    if (flow.phase !== 'player') return [];
    return [...elBar.querySelectorAll('.act-btn')].filter(button =>
      !button.disabled && !button.classList.contains('hidden') &&
      button.offsetParent !== null);
  }
  function syncActionCursor(focus = false) {
    const commands = availableCommands();
    for (const button of elBar.querySelectorAll('.act-btn')) {
      button.classList.remove('kbd');
      button.removeAttribute('aria-current');
    }
    if (!commands.length) { actionCursorKey = null; return; }
    const unit = flow.current();
    const remembered = unit && actionCursorByUnit.get(unit.id);
    let selected = commands.find(button =>
      commandKey(button) === (actionCursorKey || remembered));
    if (!selected) selected = commands[0];
    actionCursorKey = commandKey(selected);
    if (unit) actionCursorByUnit.set(unit.id, actionCursorKey);
    selected.classList.add('kbd');
    selected.setAttribute('aria-current', 'true');
    if (focus) selected.focus({ preventScroll: true });
  }
  function moveActionCursor(direction) {
    const commands = availableCommands();
    if (!commands.length) return false;
    let index = commands.findIndex(button => commandKey(button) === actionCursorKey);
    if (index < 0) index = 0;
    index = (index + direction + commands.length) % commands.length;
    actionCursorKey = commandKey(commands[index]);
    const unit = flow.current();
    if (unit) actionCursorByUnit.set(unit.id, actionCursorKey);
    syncActionCursor(true);
    return true;
  }
  function executeActionCursor() {
    const selected = availableCommands().find(button =>
      commandKey(button) === actionCursorKey);
    if (!selected) return false;
    selected.click();
    return true;
  }
  // Pressing a command with the pointer moves the keyboard cursor onto it, so
  // the two input paths never disagree about where the player is. Delegated
  // from the bar itself because the ability buttons are rebuilt every turn.
  elBar.addEventListener('click', event => {
    const button = event.target.closest('.act-btn');
    if (!button) return;
    actionCursorKey = commandKey(button);
    const unit = flow.current();
    if (unit) actionCursorByUnit.set(unit.id, actionCursorKey);
  });

  // ------------------------------------------------------------- turn strip
  function renderStrip() {
    updateUnitPanel();
    elChips.innerHTML = '';
    for (let i = 0; i < flow.queue.length; i++) {
      const u = flow.queue[i];
      const d = document.createElement('div');
      d.className = 'chip' + (i === flow.qi && u.alive ? ' active' : '') + (u.alive ? '' : ' dead');
      d.innerHTML = `<div class="nm caps">${u.name.replace('Miner-Archer', 'Archer').replace('Alchemist', 'Alchem.')}</div>`;
      elChips.appendChild(d);
    }
  }

  // ------------------------------------------------------------- unit panel
  function banner() { updateUnitPanel(); }
  function updateUnitPanel() {
    const u = flow.current();
    const show = u && (flow.phase === 'player' || flow.phase === 'enemy' || flow.phase === 'anim' || flow.phase === 'facing') && !dialogueUp();
    elPanelUp.classList.toggle('show', !!show);
    if (!show) return;
    elPanelUp.classList.toggle('enemy', u.team === 'enemy');
    elPanelUp.querySelector('.upFace').src = faceOf(u);
    elPanelUp.querySelector('.upName').textContent = u.name;
    elPanelUp.querySelector('.upTag').textContent = u.team === 'enemy' ? 'ENEMY' : '';
    elPanelUp.querySelector('.upRole').textContent = u.role;
    elPanelUp.querySelector('.upBar .fill').style.width = (Math.max(0, u.hp) / u.maxHp * 100) + '%';
    elPanelUp.querySelector('.upHp').textContent = Math.max(0, u.hp) + '/' + u.maxHp;
    elPanelUp.querySelector('.upTp').innerHTML =
      'TP&nbsp; ' + Array.from({ length: tpCap }, (_, i) => `<span class="${i < u.tp ? 'on' : ''}">&#9670;</span>`).join('');
    // A curated row, not a dump of the collection: these four read in a fixed
    // order the player learns, poison leading with its remaining turns. Grief
    // and the reprisal latch are deliberately absent — the first announces
    // itself with a banner, the second is bookkeeping nobody plays against.
    const st = [];
    const psn = statusTurns(u, 'poison');
    if (psn > 0) st.push(`<span class="stPsn">POISON ${psn}</span>`);
    if (hasStatus(u, 'aimed')) st.push('<span class="stAim">READY</span>');
    if (hasStatus(u, 'defending')) st.push('<span class="stGrd">GUARD</span>');
    if (hasStatus(u, 'marked')) st.push('<span class="stMrk">MARKED &times;3</span>');
    elPanelUp.querySelector('.upStatus').innerHTML = st.join('');
  }

  // --------------------------------------------------------- ability tooltip
  // One floating card, reused for whichever ability button is hovered or
  // holds the keyboard cursor. It has to disappear the instant an ability is
  // chosen — a stale tooltip left up while the player then hovers a target on
  // the field would sit on screen at the same time as the forecast panel,
  // which the button title's browser-native tooltip never risked because it
  // could not survive a click.
  function abilTipHtml(a) {
    return `<div class="tipHead"><span class="tipName caps">${a.name}</span>` +
      `<span class="tipCost">${a.cost} TP</span></div><div class="tipBody">${a.tip}</div>`;
  }
  function positionAbilTip(button) {
    const r = button.getBoundingClientRect();
    elAbilTip.style.left = (r.left + r.width / 2) + 'px';
    elAbilTip.style.bottom = (window.innerHeight - r.top + 10) + 'px';
  }
  function showAbilTip(button, a) {
    if (!a.tip) return;
    elAbilTip.innerHTML = abilTipHtml(a);
    positionAbilTip(button);
    elAbilTip.classList.add('show');
  }
  function hideAbilTip() {
    elAbilTip.classList.remove('show');
  }

  // ------------------------------------------------------------- action bar
  function refreshButtons() {
    const u = flow.current();
    const on = flow.phase === 'player' && !!u;
    elBar.classList.toggle('off', !on);
    // ABSENT, not dimmed, whenever there is nothing this bar can do. Two cases
    // share that: nobody is acting AT ALL (the opening dialogue, a cutscene,
    // the beat before round 1), and the end-of-turn FACING PICKER, which owns
    // the interaction while it is up — the unit is still `current`, so the bar
    // used to sit there greyed with every button unpressable, which Jonah
    // reported as noise during the orientation choice (2026-08-04). A ghosted
    // action menu is leftover UI in both cases; the keyboard already yields to
    // the picker (src/ui/battle-input.mjs checks `facing.active()` first).
    //
    // `!flow.started` is the shared "the battle has not begun" test (turn-state)
    // that the world bars and their numerals also read. It is redundant with
    // `!u` here — nobody is acting before the first turn either — and it is
    // written anyway, because the point of the latch is that ONE definition
    // decides when combat chrome exists, and a reader of this line should not
    // have to work out that the two happen to coincide.
    // The picker no longer hides the bar (Jonah, 2026-08-06, reversing his
    // 2026-08-04 call now that the bar has something live to offer there):
    // during the post-act facing pick, Undo Move is a real option and it
    // belongs in its usual place, not in a one-off chip. Everything else on
    // the bar stays disabled while the picker owns the interaction.
    const picking = flow.phase === 'facing' && !!u;
    elBar.classList.toggle('pre', !flow.started || !u);
    elBar.classList.toggle('off', !on && !picking);
    btn.move.disabled = !on || u.moved;
    const undoNow = u && u.undo && (picking ? u.undo.postAct : !u.acted);
    btnUndo.classList.toggle('hidden', !(on || picking) || !undoNow);
    btnUndo.disabled = !undoNow;
    btn.attack.disabled = !on || u.acted || attackTargets(u).length === 0;
    btn.wait.disabled = !on;
    // rules.defendCostsTp prices the guard, so Defend has to read like the
    // things it now competes with: the cost sits on the button in the same
    // `.cost` span an ability button uses, and the button greys out when the
    // unit cannot pay rather than failing silently on the click. Priced or
    // free, `canDefend` is the single answer the bar, the keyboard cursor and
    // the militia AI all take.
    const cost = defendCost();
    btn.defend.disabled = !on || !canDefend(u);
    btn.defend.innerHTML = 'Defend' + costMarkup(cost);
    // The rule marks where turn points start being spent, so it only earns a
    // divider when Defend is actually priced. With rules.defendCostsTp off,
    // Defend is free and belongs with the free actions; the abilities to its
    // right are already marked out by their own purple styling.
    elCostSep.style.display = cost > 0 ? '' : 'none';
    btn.move.classList.toggle('on', flow.mode === 'move');
    btn.attack.classList.toggle('on', flow.mode === 'attack');
    elPips.innerHTML = '';
    for (let i = 0; i < tpCap; i++) {
      const p = document.createElement('div');
      p.className = 'pip' + (on && i < u.tp ? ' on' : '');
      elPips.appendChild(p);
    }
    // ability buttons are per-unit: rebuilt whenever the turn or TP changes.
    // The old buttons are about to be detached, so drop any tooltip pinned to
    // one of them rather than leave it floating over a button that is gone.
    hideAbilTip();
    elAbils.innerHTML = '';
    if (!on) { syncActionCursor(); return; }
    for (const key of u.abil) {
      const a = ability(key);
      if (!a) continue;
      const b = document.createElement('button');
      b.className = 'act-btn abil' + (flow.mode === 'abil' && flow.curAbil === key ? ' on' : '');
      b.innerHTML = a.name + costMarkup(a.cost);
      b.dataset.abil = key;
      // an ability may also declare itself pointless right now (a steadied bow)
      b.disabled = !canCast(u, key) || (!!a.uiRedundant && a.uiRedundant(u));
      // hover and keyboard-focus both show the card; picking the ability (by
      // pointer or by Enter on the keyboard cursor) retires it immediately so
      // it can never be up at the same time as the forecast it would cover
      b.addEventListener('mouseenter', () => showAbilTip(b, a));
      b.addEventListener('mouseleave', hideAbilTip);
      b.addEventListener('focus', () => showAbilTip(b, a));
      b.addEventListener('blur', hideAbilTip);
      b.addEventListener('click', () => { hideAbilTip(); chooseAbil(key); });
      elAbils.appendChild(b);
    }
    syncActionCursor();
  }

  return {
    renderStrip, banner, updateUnitPanel, refreshButtons,
    commandKey, availableCommands,
    syncActionCursor, moveActionCursor, executeActionCursor,
    /** which command the keyboard cursor is sitting on, for `__BATTLE.commands()` */
    cursorKey: () => actionCursorKey,
  };
}
