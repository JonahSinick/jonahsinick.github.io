/**
 * The FFT damage forecast: attacker card, damage plate, target card or rows.
 *
 * This module owns how a forecast LOOKS — the cards, the hit-point bars with
 * their losing segment, the plate between them, the multi-target row list, and
 * when the panel is on screen. It computes nothing about the battle. Everything
 * numeric arrives already decided: a plain strike's range and the reprisal it
 * provokes come in as injected rules, and an ability describes its own promise
 * through the registry (`def.forecast`), which the panel renders verbatim.
 *
 * That split is the point. A forecast that recomputes what a cast will do is
 * exactly how a preview starts lying — the failure the ability registry was
 * built to end — so the panel is deliberately given no way to disagree with the
 * rules it draws. It also means panel layout, card markup and bar geometry can
 * be revised here without opening `diorama.html`.
 *
 * The two rules it consumes stay in the page on purpose. `attackRange` mirrors
 * the live attack profile, and `revengeRange` mirrors cross-retaliation, which
 * is a reaction rather than an ability; neither belongs to a presenter, and
 * both are content the panel should have to ask about rather than know.
 */

// Every primitive the panel may use. Listed rather than duck-typed so a page
// edit that drops one fails loudly at construction instead of drawing a card
// with an undefined face halfway through a hover.
export const FORECAST_CONTEXT_FIELDS = [
  'element',      // the panel container: `show` writes its markup and reveals it
  'abilities',    // ability registry — a preview asks the definition, never a branch here
  'faceOf',       // (unit) -> portrait src for a card
  'attackRange',  // (attacker, defender) -> { lo, mid, hi } for a plain strike
  'revengeRange', // (attacker, defender) -> { lo, hi } the strike's reprisal, 0 when none
];

export function createForecastPanel(context) {
  const missing = FORECAST_CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('forecast panel: missing context field(s) ' + missing.join(', '));
  }
  const { element, abilities, faceOf, attackRange, revengeRange } = context;

  // The bar is the whole readable content of a card: current hit points as the
  // fill, the part this action would take as a second segment over it. `self`
  // colours a loss the actor is paying itself (Mournful Cry's cost, a reprisal).
  //
  // The FILL is team-coloured like every other health bar in the game (Jonah's
  // FFT scheme, 2026-08-05), which is why the card carries an ally/foe class:
  // a forecast that drew an enemy's health in the party's colour would be the
  // one place the language contradicted itself.
  function fcBar(u, loss, self) {
    const hp = Math.max(0, u.hp), keep = Math.max(0, hp - loss);
    const w = q => (q / u.maxHp * 100).toFixed(1) + '%';
    return `<div class="fcBar"><div class="fill" style="width:${w(hp)}"></div>` +
      `<div class="lose${self ? ' self' : ''}" style="left:${w(keep)};width:${w(hp - keep)}"></div></div>`;
  }
  function fcCard(u, cls, loss = 0, self = false) {
    const after = Math.max(0, u.hp - loss);
    const hpTxt = loss > 0
      ? `${Math.max(0, u.hp)} <span class="to">&#8594; ${after}</span>&thinsp;/&thinsp;${u.maxHp}`
      : `${Math.max(0, u.hp)}/${u.maxHp}`;
    return `<div class="fcCard ${cls} ${u.team === 'player' ? 'ally' : 'foe'}"><img src="${faceOf(u)}">` +
      `<div class="fcInfo"><div class="fcName">${u.name}</div><div class="fcRole">${u.role.toUpperCase()}</div>` +
      `${fcBar(u, loss, self)}<div class="fcHp">${hpTxt}</div></div></div>`;
  }
  // A burst catches several units at once, so they list rather than card.
  function fcRow(u, loss, self) {
    const after = Math.max(0, u.hp - loss);
    return `<div class="fcRow ${u.team === 'player' ? 'ally' : 'foe'}"><img src="${faceOf(u)}"><div class="fcName">${u.name}</div>` +
      `${fcBar(u, loss, self)}<div class="fcHp">${Math.max(0, u.hp)} <span class="to">&#8594; ${after}</span></div></div>`;
  }
  function fcMid(num, lab) {
    return `<div class="fcMid"><div class="num">${num}</div><div class="lab">${lab}</div></div>`;
  }

  /**
   * Draw the forecast for what the cursor is pointed at. `kind` is either
   * `'attack'` or an ability id; an unknown id draws the attacker card alone
   * rather than inventing a promise.
   */
  function show(kind, att, tgt) {
    let html = fcCard(att, 'att');
    if (kind === 'attack') {
      const r = attackRange(att, tgt);
      const rev = revengeRange(att, tgt);
      // A strike that will be answered redraws the attacker's own card with the
      // reprisal already taken out of it: the panel states the trade, not the
      // half of it the player is buying. A certain reprisal shows one number,
      // an uncertain one the honest range.
      if (rev.hi > 0) {
        html = fcCard(att, 'att', rev.hi, true) +
          fcMid(rev.lo === rev.hi ? `−${rev.hi}` : `−${rev.lo}–${rev.hi}`, 'REVENGE');
      }
      // The plate names the rule that made the number big. The forecast mirrors
      // the real math (house rule), and a rear bonus the player cannot see in
      // the preview is a rule they would have to reverse-engineer from damage
      // rolls — the same objection that retired the 40% adjacent penalty.
      const label = r.fromRear ? `REAR &times;${r.rearMultiplier}` : 'DAMAGE';
      html += fcMid(r.lo === r.hi ? r.lo : `${r.lo}–${r.hi}`, label) + fcCard(tgt, 'tgt', r.mid);
    } else {
      // An ability describes its own promise; the panel only draws it. Nothing
      // here recomputes what a cast will do, so a forecast cannot drift away
      // from the ability it is previewing.
      const def = abilities.get(kind);
      const fc = def && def.forecast ? def.forecast(att, tgt) : null;
      if (fc) {
        html += fcMid(fc.mid.num, fc.mid.label);
        html += fc.rows
          ? `<div class="fcRows">${fc.rows.map(r => fcRow(r.unit, r.loss, r.self)).join('')}</div>`
          : fcCard(tgt, 'tgt', fc.loss);
      }
    }
    element.innerHTML = html;
    element.classList.add('show');
  }

  function hide() { element.classList.remove('show'); }

  return { show, hide };
}
