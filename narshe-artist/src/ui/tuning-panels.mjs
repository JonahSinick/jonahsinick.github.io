/**
 * Jonah's live tuning chrome — the two `&tune=1` panels.
 *
 * These exist so a number can be found by moving a slider and watching the game
 * answer, instead of by editing a constant and reloading. They are dev-only:
 * the page decides whether to build them at all, and playtesters never see one.
 *
 * What makes them worth a module is that each panel knows its own knobs — the
 * label, the legal range, the step, and how a value is read back — and none of
 * that is the game's business. The page hands over accessors and gets an
 * element; retuning which dials exist, or how they read, happens here.
 *
 * Two things stay with the page on purpose. It MOUNTS the element and decides
 * how long the panel lives, because lifetime is scene knowledge (the tint panel
 * dies with the cliffs), and it NAVIGATES, because the restart button only
 * knows which values it wants seeded, not where the page lives.
 */

// Shared chrome: FF6 cobalt, fixed to a corner, above the battle UI but below
// dialogue. Only the corner and the width differ between the two panels.
const PANEL_CSS = 'position:fixed;z-index:80;background:linear-gradient(#26367a,#131d4c);' +
  'border:2px solid #eef2ff;border-radius:7px;color:#eef2ff;' +
  'font:12px -apple-system,"Segoe UI",sans-serif;';

export const TUNING_CONTEXT_FIELDS = [
  'document',  // builds the panel
  'battleId',  // the encounter a restart should come back to
  'knobs',     // { name: { get, set } } — accessors, so the restart button reads
               // what the sliders have since done rather than a boot snapshot
  'enemies',   // { captain: {hp, atk}, beast: {hp, atk} } — starting stats
  'reload',    // (params) -> re-enter the game with these values seeded
];

/**
 * The warning-bell encounter's dials. The first group applies live, because
 * those numbers are read at the moment they are used; the enemy stats below can
 * only apply at deployment, so they are staged and take a restart. The panel
 * says so rather than leaving a slider that silently does nothing.
 */
export function createEncounterTuningPanel(context) {
  const missing = TUNING_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('tuning panel: missing context field(s) ' + missing.join(', '));
  }
  const { document, battleId, knobs, enemies, reload } = context;

  const panel = document.createElement('details');
  panel.id = 'wbTune';
  panel.style.cssText = PANEL_CSS + 'top:10px;right:10px;padding:4px 10px 8px;min-width:230px';
  panel.innerHTML = '<summary style="cursor:pointer;font-weight:700;letter-spacing:.06em">TUNING</summary>';
  // the panel sits over the diorama; a drag on it must not pan the camera
  panel.addEventListener('pointerdown', ev => ev.stopPropagation());

  const row = (label, min, max, step, value, apply) => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px';
    div.innerHTML = `<span style="flex:0 0 96px">${label}</span>` +
      `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="flex:1">` +
      `<b style="flex:0 0 28px;text-align:right">${value}</b>`;
    const slider = div.querySelector('input'), out = div.querySelector('b');
    slider.addEventListener('input', () => { out.textContent = slider.value; apply(parseFloat(slider.value)); });
    panel.appendChild(div);
  };

  row('Revenge dmg', 1, 20, 1, knobs.revengeDamage.get(), v => knobs.revengeDamage.set(v));
  row('Heal amount', 4, 30, 1, knobs.healAmount.get(), v => knobs.healAmount.set(v));
  row('Berserk ×', 1, 4, 0.5, knobs.berserkMultiplier.get(), v => knobs.berserkMultiplier.set(v));

  const solo = document.createElement('label');
  solo.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer';
  solo.innerHTML = `<input type="checkbox" ${knobs.soloRevenge.get() ? 'checked' : ''}> Survivor avenges itself`;
  solo.querySelector('input').addEventListener('change', ev => knobs.soloRevenge.set(ev.target.checked));
  panel.appendChild(solo);

  const note = document.createElement('div');
  note.style.cssText = 'margin-top:8px;border-top:1px solid rgba(238,242,255,.35);padding-top:2px;opacity:.8';
  note.textContent = 'Enemy stats — restart applies:';
  panel.appendChild(note);

  // Staged, not live: a unit's stats are read when it is deployed.
  const staged = {
    chp: enemies.captain.hp, catk: enemies.captain.atk,
    bhp: enemies.beast.hp, batk: enemies.beast.atk,
  };
  row('Captain HP', 40, 120, 2, staged.chp, v => { staged.chp = v; });
  row('Captain ATK', 6, 24, 1, staged.catk, v => { staged.catk = v; });
  row('Beast HP', 40, 140, 2, staged.bhp, v => { staged.bhp = v; });
  row('Beast ATK', 6, 24, 1, staged.batk, v => { staged.batk = v; });

  const btn = document.createElement('button');
  btn.textContent = '↻ Restart with these stats';
  btn.style.cssText = 'margin-top:8px;width:100%;padding:4px;border:1px solid #eef2ff;border-radius:5px;background:#3350b8;color:#fff;cursor:pointer;font-weight:700';
  // Everything the panel touched, live or staged, goes back into the query so
  // the reloaded encounter is the one that was just being tuned.
  btn.addEventListener('click', () => reload({
    battle: battleId,
    revenge: knobs.revengeDamage.get(),
    heal: knobs.healAmount.get(),
    berserk: knobs.berserkMultiplier.get(),
    solorev: knobs.soloRevenge.get() ? '1' : '0',
    chp: staged.chp, catk: staged.catk, bhp: staged.bhp, batk: staged.batk,
  }));
  panel.appendChild(btn);

  return { element: panel };
}

export const TINT_CONTEXT_FIELDS = [
  'document',  // builds the panel
  'THREE',     // Color, for the multiply and the hex readout
  'tints',     // { rock, basin, snow } committed base colours
  'materials', // { rock, basin, snow } the live materials to write
];

/**
 * The cliffs tint dials for the stopgap intro reskin: brightness multipliers
 * over the committed dusk tints, with live hex readouts, so a winning value can
 * be read straight off the panel and committed as a literal.
 */
export function createCliffsTintPanel(context) {
  const missing = TINT_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('tint panel: missing context field(s) ' + missing.join(', '));
  }
  const { document, THREE, tints, materials } = context;

  const panel = document.createElement('div');
  panel.style.cssText = PANEL_CSS + 'top:10px;left:10px;padding:8px 12px;min-width:250px';
  panel.innerHTML = '<b style="letter-spacing:.06em">CLIFFS TINTS</b>';
  panel.addEventListener('pointerdown', ev => ev.stopPropagation());

  for (const [key, label] of [['rock', 'Canyon rock'], ['basin', 'Valley basin'], ['snow', 'Crest snow']]) {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:6px';
    div.innerHTML = `<span style="flex:0 0 88px">${label}</span>` +
      '<input type="range" min="40" max="220" step="5" value="100" style="flex:1">' +
      `<code style="flex:0 0 60px;text-align:right">#${new THREE.Color(tints[key]).getHexString()}</code>`;
    const slider = div.querySelector('input'), out = div.querySelector('code');
    slider.addEventListener('input', () => {
      // clamped per channel: past 100% a bright channel saturates rather than
      // wrapping, so the readout stays the colour that is actually on screen
      const c = new THREE.Color(tints[key]).multiplyScalar(slider.value / 100);
      c.r = Math.min(1, c.r); c.g = Math.min(1, c.g); c.b = Math.min(1, c.b);
      materials[key].color.copy(c);
      out.textContent = '#' + c.getHexString();
    });
    panel.appendChild(div);
  }

  return { element: panel };
}
