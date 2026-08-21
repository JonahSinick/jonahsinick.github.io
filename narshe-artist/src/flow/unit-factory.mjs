import { CARDINAL_DIRECTIONS as DIRS } from '../core/grid.mjs';
import { createUnitState } from '../core/battle-state.mjs';
import { PALETTE, SPRITE_TOP } from '../render/sprite-painter.mjs';

/**
 * Turns a roster definition into a fielded unit: the battle-state record
 * (from `createUnitState`) plus every visual indicator it carries in the
 * 3D scene (the team-coloured HP bar, Defend shield ring, Take Aim reticle,
 * poison droplet) — and the two sprite factories those indicators are built
 * from, `hpSprite`/`floatText`.
 *
 * Nothing here draws on the FLOOR any more. The underfoot team markers were
 * deleted on 2026-08-05 (Jonah's FFT scheme, DESIGN.md): the ground says what a
 * square affords, and identity moved onto the bar.
 *
 * `spriteFigure`, `setArtFrame`, and `layoutOverhead` are page-owned shared
 * instances (one `createSpritePainter`/`createPaintedArt` each, reused by the
 * cutscene actors too), so they arrive as injected context rather than being
 * reconstructed here — the same shape `cliffs-opening.mjs` and
 * `mine-finale.mjs` already take them in.
 *
 * The warning-bell tuning knobs (REVENGE_DMG/HEAL_AMT/BERSERK_MULT/
 * SOLO_REVENGE) live here too, as live get/set pairs: everything that used to
 * read the page `let`s directly (the reaction seam, the forecast, the `&tune=1`
 * panel, the debug snapshot) now goes through an accessor, so a value the
 * tuning panel just moved can never be read stale from a captured copy.
 */
export function createUnitFactory({
  THREE, world, scene, tileCenter, spriteFigure, setArtFrame, layoutOverhead,
  uiCol, uiCss, makeTex, tween, query,
}) {
  for (const [name, value] of Object.entries({
    THREE, world, scene, tileCenter, spriteFigure, setArtFrame, layoutOverhead,
    uiCol, uiCss, makeTex, tween, query,
  })) {
    if (value === undefined || value === null)
      throw new Error(`unit-factory: missing context "${name}"`);
  }

  // ---------------------------------------------------------------- HP bars & floating text
  // THE BAR PLATE, AND THE TURN NUMERAL BESIDE IT, are one sprite: laid out in
  // these logical units and drawn on a canvas at BAR_SS times the density, so
  // the numeral is a crisp glyph rather than a 16-pixel-tall smudge. World size
  // per logical unit is BAR_PPU, chosen so the PLATE keeps exactly the size it
  // had before the numeral arrived (96 logical wide = 0.74 world).
  const BAR_W = 96, BAR_H = 16;      // the plate itself, unchanged
  const NUM_W = 26, NUM_GAP = 5;     // the numeral's column, and its air
  const BAR_TOTAL_W = NUM_W + NUM_GAP + BAR_W;
  const BAR_TOTAL_H = 28;            // the numeral stands taller than the plate
  const BAR_X = NUM_W + NUM_GAP;     // where the plate starts
  const BAR_Y = (BAR_TOTAL_H - BAR_H) / 2;
  const BAR_PPU = BAR_W / 0.74;      // logical units per world unit
  const BAR_SS = 2;                  // canvas supersampling
  function hpSprite(team) {
    const c = document.createElement('canvas');
    c.width = BAR_TOTAL_W * BAR_SS; c.height = BAR_TOTAL_H * BAR_SS;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false }));
    sp.scale.set(BAR_TOTAL_W / BAR_PPU, BAR_TOTAL_H / BAR_PPU, 1);
    sp.renderOrder = 900;
    // THE BAR CARRIES THE TEAM (Jonah, 2026-08-05, the FFT scheme). There are no
    // markers underfoot any more, so this is where "whose side is that" is
    // answered: teal fill for the party, red for the enemy, the way FFT's own
    // bars do it. Health is the fill's LENGTH, which is what a bar is for and
    // what it always was — the old green/amber/red hue was a second encoding of
    // the same number, and it is the channel the team needed.
    //
    // POISON RIDES THE KEYLINE, rehomed from the sickly ring at the feet that
    // went with the rest of the ground identity layer. It is drawn on the
    // border rather than in the fill so it reads against BOTH team colours —
    // the border sits on the dark plate, not on the fill it would otherwise
    // have to fight.
    // SAMPLED FROM FF_tactics_images/battle_colors.png (Jonah, 2026-08-05), not
    // approximated: the ally bar's fill runs #4589b6 -> #4f93c2 across its
    // length and the enemy's #bf5e38 -> #cf653a, so these are the midpoints of
    // the real thing rather than a guess at "light blue" and "orange-red".
    const TEAM_FILL = team === 'player' ? 0x4a8dbb : 0xc25f36;
    const TEAM_EDGE = team === 'player' ? 0x9fd0ea : 0xe8a184;
    // THE TURN NUMERAL, sampled from the same shot as everything else in the
    // scheme (FF_tactics_images/battle_colors.png): a pale glyph in a dark
    // keyline, no plate behind it, standing immediately left of the bar and a
    // little taller than it. Ally #d0eff7 in #3e4f58, enemy #f9dee0 in #885255.
    const NUM_FILL = team === 'player' ? 0xd0eff7 : 0xf9dee0;
    const NUM_EDGE = team === 'player' ? 0x3e4f58 : 0x885255;
    // WHAT THE NUMERAL MEANS is the unit's place in the turn order — its row in
    // the TURN ORDER panel, which is the same list read the same way, so the two
    // can be checked against each other by eye. The VALUE is bound in one place
    // (`turnNumeralOf` in the page, which reads `flow.queue`); if Jonah rules it
    // should say hit points or a unit index instead, that function is the whole
    // of the change and nothing here moves.
    let lastFrac = 1, lastPoison = false, order = null;
    const paint = () => {
      const ctx = c.getContext('2d');
      ctx.setTransform(BAR_SS, 0, 0, BAR_SS, 0, 0);      // draw in logical units
      ctx.clearRect(0, 0, BAR_TOTAL_W, BAR_TOTAL_H);
      // every colour goes through uiCol so the grade delivers what is written here
      ctx.fillStyle = uiCss(0x14120c, 0.9);       // the image's dark plate
      ctx.beginPath(); ctx.roundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 5); ctx.fill();
      ctx.strokeStyle = lastPoison ? uiCss(0x8fe07a, 0.95) : uiCss(TEAM_EDGE, team === 'player' ? 0.85 : 0.8);
      ctx.lineWidth = lastPoison ? 2.6 : 2;
      ctx.beginPath(); ctx.roundRect(BAR_X + 1, BAR_Y + 1, BAR_W - 2, BAR_H - 2, 4.5); ctx.stroke();
      const w = Math.max(0, Math.round((BAR_W - 10) * lastFrac));
      ctx.fillStyle = uiCss(TEAM_FILL);
      if (w > 0) { ctx.beginPath(); ctx.roundRect(BAR_X + 5, BAR_Y + 4, w, 8, 3); ctx.fill(); }
      if (order != null) {
        // right-aligned against the bar, so a two-digit order grows away from it
        // rather than crowding it; the font shrinks if the column would overflow
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        const text = String(order);
        let size = 25;
        ctx.font = `bold ${size}px Georgia, serif`;
        const room = NUM_W - 2;
        const wide = ctx.measureText(text).width;
        if (wide > room) {
          size = Math.max(12, Math.floor(size * room / wide));
          ctx.font = `bold ${size}px Georgia, serif`;
        }
        ctx.lineJoin = 'round';
        ctx.lineWidth = 5;
        ctx.strokeStyle = uiCss(NUM_EDGE, 0.95);
        ctx.strokeText(text, NUM_W, BAR_TOTAL_H / 2);
        ctx.fillStyle = uiCss(NUM_FILL);
        ctx.fillText(text, NUM_W, BAR_TOTAL_H / 2);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      tex.needsUpdate = true;
    };
    sp.userData.draw = (frac, poisoned = false) => {
      lastFrac = frac; lastPoison = poisoned;
      paint();
    };
    /** The turn order changes at a round boundary, not on every damage tick. */
    sp.userData.setOrder = n => {
      if (n === order) return;
      order = n;
      sp.userData.order = n;      // what is DRAWN, for the debug read-back
      paint();
    };
    sp.userData.order = null;
    // where a gate may read the fill colour: inside the bar, not in the numeral
    // column, and in CANVAS pixels rather than logical ones
    sp.userData.fillProbe = { x: (BAR_X + 10) * BAR_SS, y: (BAR_Y + 8) * BAR_SS };
    paint();
    return sp;
  }
  // The canvas is measured to the string, not fixed at 128px: 'MARKED' and 'POISON'
  // used to run off both edges. Height (and so the on-screen text size) is constant;
  // the quad's width follows the canvas aspect, so long words simply get wider.
  const FT_H = 64, FT_FONT = 'bold 44px Georgia, serif', FT_PAD = 13;
  const FT_SCALE_Y = 0.47, FT_PER_PX = 0.94 / 128;      // world units per canvas pixel of width
  function floatText(txt, pos, color) {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    ctx.font = FT_FONT;
    const w = Math.ceil(ctx.measureText(String(txt)).width) + FT_PAD * 2;
    c.width = Math.max(64, w); c.height = FT_H;
    // resizing the canvas resets the 2D state, so every draw setting is re-applied here
    ctx.font = FT_FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = uiCss(0x060810, 0.9); ctx.strokeText(txt, c.width / 2, 34);
    // callers pass '#rrggbb'; pre-compensate it like every other piece of UI colour
    ctx.fillStyle = uiCss(parseInt(String(color).replace('#', ''), 16));
    ctx.fillText(txt, c.width / 2, 34);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const sp = new THREE.Sprite(m);
    sp.scale.set(c.width * FT_PER_PX, FT_SCALE_Y, 1); sp.renderOrder = 950;
    sp.position.copy(pos); scene.add(sp);
    tween(0.95, p => {
      sp.position.y = pos.y + 0.6 * p;
      m.opacity = p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
    }, () => { scene.remove(sp); m.map.dispose(); m.dispose(); });
  }

  // ---------------------------------------------------------------- units
  const units = [];
  let uid = 0;
  // In-world UI — bars, indicators, highlights — is chrome painted into
  // the 3D scene, not scenery, so the scene's atmosphere must not touch it. Two things
  // were touching it: the distance fog, and (the one that actually greyed the player
  // HP bars at the default camera, where the fog's near plane hasn't even started)
  // the ACES tone mapping, which desaturates saturated UI colour toward grey. The
  // character sprites already opt out of tone mapping for the same reason; terrain
  // and characters keep the fog.
  function uiChrome(obj) {
    obj.traverse(o => {
      const m = o.material;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) {
        mm.fog = false; mm.toneMapped = false; mm.needsUpdate = true;
      }
    });
    return obj;
  }
  function addUnit(def) {
    // fig is the billboard node: updateGame yaws it to the camera every frame, so
    // group.rotation.y is free to stay the unit's *logical* facing
    const { group: fig, mats, mesh } = spriteFigure(def.kind, def.pal);
    const group = new THREE.Group();   // outer node: holds ring/bar and takes the turn pulse
    group.add(fig);
    // Domain fields come from the serializable core; everything assigned on top
    // is presentation. Downed-not-dead is a militia trait, stated at creation.
    const u = Object.assign(createUnitState({
      id: uid++, name: def.name, role: def.role, team: def.team, cls: def.cls,
      x: def.x, z: def.z, hp: def.hp, atk: def.atk,
      move: def.move, speed: def.speed, range: def.range || 1,
      abil: def.abil || [], downable: def.downable,
    }), {
      artMaxW: def.artMaxW || 0,       // clamp a wide plate to its one tile (Skarn)
      // Which character this unit IS, and the plate set that character wears.
      // A form switch repoints artSet; charId is how the unit finds the form.
      charId: def.charId, artSet: def.artSet,
      pal: def.pal, kind: def.kind,
      chipColor: '#' + PALETTE[def.pal].accent.toString(16).padStart(6, '0'),
      group, fig, mats, sprite: mesh, flip: 1,
      art: null, artFace: 'front', artKey: 'front', topY: SPRITE_TOP,
      walking: false, walkT: 0, walkDist: 0, lastX: 0, lastZ: 0,
      cutscene: false,                 // a battle unit: its gait is behind BATTLE_WALK_ANIM
    });
    // A deployment may hand a unit turn points to open with (Seira's scripted
    // first move spends hers), before anything can read them.
    if (def.tp) u.tp = def.tp;
    u.setFrame = f => setArtFrame(u, f);
    group.userData.unitRef = u;
    // NO MARKER UNDERFOOT, either side (Jonah, 2026-08-05, the FFT scheme). The
    // identity layer is gone from the ground entirely: team is the HP bar's
    // colour now, and the floor is left to say what a SQUARE affords — which is
    // the only thing it was ever able to say without competing with the art.
    // Everything that used to hang off the team ring has a new home: poison is
    // the bar's keyline, berserk was already the sprite's own red throb.
    // defend indicator (hidden until Defend is chosen)
    const shield = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.028, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0xa8d8ff, emissive: 0x2f6f9c, emissiveIntensity: 1.4, transparent: true, opacity: 0.85 }));
    shield.rotation.x = -Math.PI / 2; shield.position.y = 0.74; shield.visible = false;
    group.add(shield);
    u.shieldRing = shield;
    // Take Aim: an amber reticle over the head, held steady while the shot is saved
    const ow = new THREE.Group();
    ow.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 6, 16),
      new THREE.MeshStandardMaterial({ color: 0xffc070, emissive: 0xff9028, emissiveIntensity: 1.7 })));
    for (const [dx, dz] of DIRS) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(dx ? 0.1 : 0.026, 0.026, dz ? 0.1 : 0.026),
        new THREE.MeshStandardMaterial({ color: 0xffd79a, emissive: 0xff9028, emissiveIntensity: 1.5 }));
      tick.position.set(dx * 0.26, 0, dz * 0.26); ow.add(tick);
    }
    ow.children[0].rotation.x = -Math.PI / 2;
    ow.visible = false;                                  // y comes from layoutOverhead
    group.add(ow); u.aimMesh = ow;
    // poison: a green droplet over the shoulder plus a sickly ring at the feet
    const pz = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeTex((ctx, s) => {
        ctx.clearRect(0, 0, s, s);
        ctx.fillStyle = uiCss(0x08140a, 0.85);
        ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.42, 0, 7); ctx.fill();
        ctx.fillStyle = uiCss(0x8fe07a);
        ctx.beginPath(); ctx.moveTo(s / 2, s * 0.22);
        ctx.quadraticCurveTo(s * 0.78, s * 0.62, s / 2, s * 0.78);
        ctx.quadraticCurveTo(s * 0.22, s * 0.62, s / 2, s * 0.22); ctx.fill();
      }, 64),
      transparent: true, depthTest: false, depthWrite: false,
    }));
    pz.scale.set(0.5, 0.5, 1); pz.position.x = 0.55; pz.renderOrder = 920;
    pz.visible = false; pz.raycast = () => {};
    group.add(pz); u.poisonIcon = pz;
    // the sprite sizes itself from the layout constants above (the plate keeps
    // the 0.74 world width it was given here before the numeral joined it)
    const bar = hpSprite(def.team);
    bar.raycast = () => {};                              // never intercept tile picking
    // HIDDEN UNTIL THE BATTLE BEGINS (Jonah, 2026-08-05). A bar and its turn
    // numeral describe a fight in progress, and floating them over the opening
    // dialogue or over Ragna and Skarn walking into the gallery describes one
    // that has not started. The page turns them on from `flow.started`, the
    // same latch the action bar reads; nothing else ever sets this true.
    bar.visible = false;
    group.add(bar); u.bar = bar;
    [shield, ow, pz, bar].forEach(uiChrome);
    layoutOverhead(u);                                   // heights follow the sprite, not a constant
    group.position.copy(tileCenter(u.x, u.z));
    group.rotation.y = def.team === 'player' ? Math.PI : 0;   // face the enemy
    // held back until the art pass has settled — see artReady. Belt and braces with
    // the entry curtain: even if the curtain's fallback timer wins the race, a unit
    // is never shown in placeholder art it is about to replace.
    group.visible = false;
    world.add(group);
    units.push(u);
    return u;
  }

  // ---------------------------------------------------------------- warning-bell knobs
  // Every number here is provisional and Jonah-tunable — live from the on-screen
  // TUNING panel; the URL seeds them so a stat restart preserves every value.
  // The encounter's doctrine (DESIGN.md) is fixed revenge per attack.
  const wbNum = (key, dflt) => { const v = parseFloat(query.get(key)); return Number.isFinite(v) ? v : dflt; };
  let REVENGE_DMG = wbNum('revenge', 9);   // fixed cross-retaliation damage, never proportional
  let HEAL_AMT = wbNum('heal', 14);
  const HEAL_RANGE = 3;
  let BERSERK_MULT = wbNum('berserk', 2);  // survivor damage multiplier once its partner falls
  const BERSERK_HOT = new THREE.Color(0xff2a18);  // the arcade rage-pulse red
  let SOLO_REVENGE = query.get('solorev') !== '0';  // the berserk survivor also avenges itself

  return {
    units, addUnit, uiChrome, floatText,
    wbNum,
    revengeDamage: () => REVENGE_DMG, setRevengeDamage: v => { REVENGE_DMG = v; },
    healAmount: () => HEAL_AMT, setHealAmount: v => { HEAL_AMT = v; },
    healRange: HEAL_RANGE,
    berserkMultiplier: () => BERSERK_MULT, setBerserkMultiplier: v => { BERSERK_MULT = v; },
    berserkHot: BERSERK_HOT,
    soloRevenge: () => SOLO_REVENGE, setSoloRevenge: v => { SOLO_REVENGE = v; },
  };
}
