/**
 * The procedural pixel-art sprite painter: the chibi figures every unit and
 * cutscene actor is built from, and the busts cropped out of their own heads.
 *
 * This is live infrastructure, not a legacy path. Every unit's base billboard
 * mesh comes from `spriteFigure`, painted art is applied ON TOP of it per
 * character and per pose, and any pose a character has no plate for keeps the
 * painted sprite underneath. Dialogue portraits fall back to `spriteBust` for
 * the same reason, so a speaker with no portrait file still gets a face that
 * matches the figure on the field.
 *
 * Layout: everything that needs nothing but arithmetic and a colour string
 * lives at module scope (and the sprite metrics are exported, since the page
 * positions markers against `SPRITE_TOP` and the debug API blows frames up at
 * `SPX`/`SPY`). Only the three functions that build a canvas texture or a mesh
 * need THREE, so they live in the factory, which follows this project's
 * convention of injecting THREE rather than importing it.
 *
 * `PALETTE` moved here with the painters. Its entries are nothing but the
 * accent/metal/glow ramp each BODY and HEADGEAR consumes; leaving it on the
 * page would have meant the module could not be constructed until the page had
 * declared it, three hundred lines further down.
 */
// HD-2D: units are 2D sprites painted one logical pixel at a time and billboarded
// into the 3D diorama (FFT chibi proportions — big head, small body, a face you
// can actually read). Each class supplies a BODY and a HEADGEAR painter; the
// shared skeleton in anat() hands the standing and the downed frame the same
// landmarks, so a class describes its garments once and gets both poses.
export const SPX = 32, SPY = 40;      // logical sprite pixels
const SPRITE_H = 1.65;         // world height of the billboard quad
const FOOT_ROW = 38.5;         // the canvas row that rests on the tile top
const INK = '#171320', EYE = '#241d30', MOUTH = '#a4614a';

// k > 1 lightens toward white, k <= 1 darkens — one knob for a whole ramp
function tone(n, k) {
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = v => Math.max(0, Math.min(255, Math.round(k <= 1 ? v * k : v + (255 - v) * (k - 1))));
  return '#' + ((f(r) << 16) | (f(g) << 8) | f(b)).toString(16).padStart(6, '0');
}

// a tiny painter's-algorithm pixel buffer: everything is drawn into a flat array
// of colour strings so the silhouette outline can be derived at the end
function pixBuf() {
  const g = new Array(SPX * SPY).fill(null);
  const api = {
    g,
    px(x, y, c) {
      x = Math.round(x); y = Math.round(y);
      if (c && x >= 0 && y >= 0 && x < SPX && y < SPY) g[y * SPX + x] = c;
      return api;
    },
    rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) api.px(x + i, y + j, c); return api; },
    row(x0, x1, y, c) { for (let x = x0; x <= x1; x++) api.px(x, y, c); return api; },
    col(x, y0, y1, c) { for (let y = y0; y <= y1; y++) api.px(x, y, c); return api; },
    disc(cx, cy, rx, ry, c) {
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) api.px(x, y, c);
        }
      return api;
    },
    // trapezoid between two widths — robes, hems, blades
    taper(cx, y0, y1, w0, w1, c) {
      for (let y = y0; y <= y1; y++) {
        const w = y1 === y0 ? w1 : w0 + (w1 - w0) * (y - y0) / (y1 - y0);
        api.row(Math.round(cx - w / 2), Math.round(cx + w / 2) - 1, y, c);
      }
      return api;
    },
    // shading pass: recolour only the pixels that are already a given colour
    over(x, y, w, h, from, to) {
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const px = Math.round(x + i), py = Math.round(y + j), k = py * SPX + px;
        if (px >= 0 && py >= 0 && px < SPX && py < SPY && g[k] === from) g[k] = to;
      }
      return api;
    },
    // classic sprite readability: one dark pixel all the way round the silhouette
    outline(c) {
      const o = g.slice();
      for (let y = 0; y < SPY; y++) for (let x = 0; x < SPX; x++) {
        const k = y * SPX + x;
        if (g[k]) continue;
        if ((x > 0 && g[k - 1]) || (x < SPX - 1 && g[k + 1]) ||
            (y > 0 && g[k - SPX]) || (y < SPY - 1 && g[k + SPX])) o[k] = c;
      }
      for (let i = 0; i < o.length; i++) g[i] = o[i];
      return api;
    },
  };
  return api;
}

// the chibi skeleton both frames hang off. 'down' is the same body knelt and
// sunk into its own shoulders, leaning a pixel off-centre.
function anat(pose) {
  return pose === 'down'
    ? { down: true,  lean: 1, headCY: 22, eyeY: 24, chin: 29, torsoTop: 28, torsoBot: 36, torsoW: 13, armTop: 30, hand: 35 }
    : { down: false, lean: 0, headCY: 11, eyeY: 13, chin: 18, torsoTop: 19, torsoBot: 30, torsoW: 12, armTop: 21, hand: 29 };
}

function legs(P, a, cloth, boot) {
  if (a.down) {                                    // folded under the body, boots turned out
    P.rect(9, 33, 15, 4, cloth);
    P.rect(7, 35, 6, 3, boot); P.rect(20, 35, 6, 3, boot);
  } else {
    P.rect(11, 29, 4, 8, cloth); P.rect(17, 29, 4, 8, cloth);
    P.rect(10, 35, 6, 3, boot);  P.rect(16, 35, 6, 3, boot);
  }
}
function torso(P, a, col, lo, hi) {
  const x = 16 + a.lean - (a.torsoW >> 1), h = a.torsoBot - a.torsoTop;
  P.rect(x, a.torsoTop, a.torsoW, h, col);
  P.rect(x, a.torsoTop, 2, h, hi);                 // light rakes in from the upper left
  P.rect(x + a.torsoW - 2, a.torsoTop, 2, h, lo);
}
function arms(P, a, sleeve, lo, skin) {
  const y = a.armTop, h = a.hand - y, L = 7 + a.lean, R = 22 + a.lean;
  P.rect(L, y, 3, h, sleeve); P.col(L, y, y + h - 1, lo);
  P.rect(R, y, 3, h, sleeve); P.col(R + 2, y, y + h - 1, lo);
  P.rect(L, a.hand, 3, 2, skin); P.rect(R, a.hand, 3, 2, skin);
}
function head(P, a, skin, skinLo) {
  const cx = 16 + a.lean;
  P.disc(cx, a.headCY, 7, 7.4, skin);
  P.over(cx + 3, a.headCY - 7, 5, 13, skin, skinLo);   // the camera-right cheek falls off
  P.rect(cx - 2, a.chin, 4, 2, skinLo);                // neck
}
// hats and hoods that hug the skull exactly: walk the head disc's own rows
function skullRows(P, a, y0, y1, col, grow = 0) {
  const cx = 16 + a.lean;
  for (let y = y0; y <= y1; y++) {
    const dy = (y + 0.5 - a.headCY) / (7.4 + grow);
    const w = Math.sqrt(Math.max(0, 1 - dy * dy)) * (7 + grow);
    if (w >= 0.5) P.row(Math.round(cx - w), Math.round(cx + w) - 1, y, col);
  }
}
// eyes sit a pixel right of centre so the sprite reads as looking where it walks
function face(P, a) {
  const cx = 16 + a.lean;
  if (a.down) {                                    // out of the fight: eyes closed
    P.row(cx - 5, cx - 3, a.eyeY + 1, EYE);
    P.row(cx + 2, cx + 4, a.eyeY + 1, EYE);
    P.row(cx - 1, cx, a.eyeY + 3, MOUTH);
    return;
  }
  P.rect(cx - 4, a.eyeY, 2, 2, EYE);
  P.rect(cx + 3, a.eyeY, 2, 2, EYE);
  P.rect(cx - 1, a.eyeY + 3, 3, 1, MOUTH);
}

const SKIN = {
  knight:    ['#eec49b', '#c99a72'],
  archer:    ['#e8bd93', '#c1906a'],
  mage:      ['#f6ddc9', '#d6b099'],
  alchemist: ['#e0b992', '#b98d6b'],
};

// ---- per-class garments. BODY paints everything below the neck (plus any prop
// that hangs behind the figure); HEADGEAR paints over the bare head.
const BODY = {
  knight(P, c, a) {
    const st = tone(c.metal, 1), stLo = tone(c.metal, 0.62), stHi = tone(c.metal, 1.3);
    const cl = tone(c.accent, 1), clLo = tone(c.accent, 0.62), clHi = tone(c.accent, 1.3);
    const skin = SKIN.knight[0];
    if (a.down) {
      legs(P, a, tone(c.accent, 0.4), '#3b2a20');
      torso(P, a, st, stLo, stHi);
      P.rect(13, 30, 5, 6, cl);                                  // tabard, crumpled
      arms(P, a, tone(c.accent, 0.5), tone(c.accent, 0.34), skin);
      P.rect(24, 36, 7, 2, stHi); P.rect(22, 35, 3, 3, cl);      // sword down in the snow
      return;
    }
    legs(P, a, tone(c.accent, 0.42), '#3b2a20');
    torso(P, a, tone(c.metal, 0.84), tone(c.metal, 0.54), tone(c.metal, 1.12));
    P.rect(13, 23, 6, 10, cl); P.col(18, 23, 32, clLo);          // tabard down the front
    P.rect(10, 27, 12, 2, '#4a3526'); P.rect(15, 27, 3, 2, tone(c.metal, 1.15));   // belt + buckle
    arms(P, a, tone(c.accent, 0.5), tone(c.accent, 0.34), skin);
    P.rect(6, 19, 5, 4, st); P.rect(6, 19, 5, 1, stHi);          // pauldrons
    P.rect(21, 19, 5, 4, st); P.rect(24, 20, 2, 3, stLo);
    // sword shouldered on the sprite's right, point up
    P.rect(26, 12, 2, 17, stHi); P.col(27, 12, 28, st); P.px(26, 11, stHi);
    P.rect(24, 29, 6, 2, cl);                                    // crossguard
    P.rect(26, 31, 2, 4, '#3b2a20'); P.rect(25, 35, 4, 2, clHi); // grip + pommel
    // kite shield on the left arm
    P.rect(3, 20, 7, 9, cl); P.taper(6.5, 29, 33, 7, 1, cl);
    P.col(3, 20, 28, clHi); P.row(3, 9, 20, stHi);
    P.rect(5, 23, 3, 3, st); P.px(6, 24, stHi);                  // boss
  },

  archer(P, c, a) {
    const clothN = c.lamp ? c.metal : c.accent;
    const cloth = tone(clothN, 1), clothLo = tone(clothN, 0.62), clothHi = tone(clothN, 1.28);
    const skin = SKIN.archer[0], wood = '#6b4a2c', woodLo = '#472f1c';
    if (a.down) {
      legs(P, a, '#4a3d2c', '#33261a');
      torso(P, a, cloth, clothLo, clothHi);
      arms(P, a, tone(clothN, 0.8), tone(clothN, 0.55), skin);
      for (let x = 22; x <= 29; x++) P.px(x, 37 - (x === 25 || x === 26 ? 1 : 0), wood);   // bow dropped
      if (c.lamp) { P.rect(12, 31, 4, 3, tone(c.metal, 0.5)); P.rect(13, 32, 2, 2, tone(c.glow, 0.7)); }
      return;
    }
    // longbow slung on the back — drawn first so the body sits in front of it
    for (let y = 12; y <= 36; y++) {
      const t = (y - 12) / 24;
      P.px(6 - Math.round(3 * Math.sin(Math.PI * t)), y, y < 24 ? wood : woodLo);
    }
    P.col(7, 13, 35, '#ddd0b4');                                 // string
    P.rect(23, 16, 3, 11, '#5a4028'); P.col(25, 16, 26, '#3a2a18');   // quiver
    for (const x of [23, 24, 25]) P.rect(x, 13, 1, 3, x === 24 ? '#e8e0cc' : '#c9bda0');
    legs(P, a, '#4a3d2c', '#33261a');
    torso(P, a, cloth, clothLo, clothHi);
    P.rect(10, 27, 12, 2, '#3d2c1e');                            // belt
    arms(P, a, tone(clothN, 0.8), tone(clothN, 0.55), skin);
    if (c.lamp) {                                                // miner's pit-lamp on the chest
      P.rect(12, 22, 4, 4, tone(c.metal, 0.5)); P.rect(13, 23, 2, 2, tone(c.glow, 1));
      P.px(13, 23, tone(c.glow, 1.7)); P.rect(12, 21, 4, 1, tone(c.metal, 0.35));
    } else {
      P.rect(11, 21, 4, 7, tone(c.metal, 1)); P.col(11, 21, 27, tone(c.metal, 1.25));  // baldric
    }
  },

  mage(P, c, a) {
    const rb = tone(c.accent, 1), rbLo = tone(c.accent, 0.58), rbHi = tone(c.accent, 1.28);
    const sil = tone(c.metal, 1), skin = SKIN.mage[0];
    if (a.down) {
      P.taper(17, 28, 38, 13, 17, rb);
      P.rect(11, 28, 3, 10, rbHi); P.rect(21, 28, 3, 10, rbLo);
      arms(P, a, tone(c.accent, 0.78), tone(c.accent, 0.5), skin);
      for (let i = 0; i < 8; i++) P.px(23 + i, 37 - (i > 4 ? 1 : 0), '#5a4530');
      return;
    }
    P.taper(16, 19, 38, 12, 18, rb);                             // robe flaring to the hem
    P.rect(10, 19, 3, 12, rbHi); P.rect(19, 19, 3, 12, rbLo);
    P.rect(11, 27, 11, 2, sil); P.rect(15, 27, 3, 2, tone(c.glow, 1.1));   // sash + clasp
    P.taper(16, 36, 38, 16, 18, rbLo);                           // shadowed hem
    arms(P, a, tone(c.accent, 0.78), tone(c.accent, 0.5), skin);
    P.rect(7, 21, 3, 5, rbHi); P.rect(22, 21, 3, 5, rbLo);       // wide sleeves
    // staff: a slim dark shaft under a faceted orb
    P.col(27, 12, 38, '#5a4530'); P.px(27, 12, '#8a6c48');
    P.disc(27, 11, 2.4, 2.4, tone(c.glow, 1)); P.rect(26, 10, 2, 2, tone(c.glow, 1.75));
  },

  alchemist(P, c, a) {
    const rb = tone(c.accent, 1), rbLo = tone(c.accent, 0.58), rbHi = tone(c.accent, 1.26);
    const hd = tone(c.metal, 1), hdLo = tone(c.metal, 0.62);
    const skin = SKIN.alchemist[0];
    if (a.down) {
      P.taper(17, 28, 38, 13, 17, rb);
      P.rect(11, 28, 3, 10, rbHi); P.rect(21, 28, 3, 10, rbLo);
      P.rect(9, 29, 14, 4, hd);                                  // hood cape over the shoulders
      arms(P, a, tone(c.accent, 0.78), tone(c.accent, 0.5), skin);
      P.rect(25, 36, 3, 2, tone(c.glow, 0.75)); P.row(23, 29, 38, tone(c.glow, 0.5));   // spilled flask
      return;
    }
    P.taper(16, 19, 38, 12, 17, rb);
    P.rect(10, 19, 3, 12, rbHi); P.rect(19, 19, 3, 12, rbLo);
    P.taper(16, 36, 38, 15, 17, rbLo);
    P.rect(9, 19, 14, 4, hd); P.rect(9, 19, 14, 1, tone(c.metal, 1.2)); // hood falling on the shoulders
    arms(P, a, tone(c.accent, 0.78), tone(c.accent, 0.5), skin);
    P.rect(4, 25, 7, 6, '#4a3a26'); P.rect(4, 25, 7, 2, '#33260f');     // satchel + flap
    P.rect(7, 26, 2, 1, tone(c.metal, 1.3));
    for (let i = 0; i < 6; i++) P.px(11 - i * 0.7, 20 + i, '#33260f');  // strap
    P.rect(23, 27, 4, 5, '#cfe4d8'); P.rect(23, 29, 4, 3, tone(c.glow, 1));   // flask
    P.px(24, 30, tone(c.glow, 1.7)); P.rect(24, 25, 2, 2, hdLo);              // cork
  },
};

const HEADGEAR = {
  knight(P, c, a, skin, skinLo) {
    const cx = 16 + a.lean;
    const st = tone(c.metal, 1), stLo = tone(c.metal, 0.6), stHi = tone(c.metal, 1.3);
    skullRows(P, a, a.headCY - 9, a.eyeY - 2, tone(c.metal, 0.9), 0.5);
    skullRows(P, a, a.headCY - 9, a.headCY - 5, tone(c.metal, 1.12), 0.5);   // lit crown
    P.rect(cx - 7, a.eyeY - 2, 14, 2, stLo);                     // brow band
    P.rect(cx - 7, a.eyeY - 1, 13, 8, stLo);                     // shadowed inside of the helm
    P.rect(cx - 5, a.eyeY - 1, 10, 7, skin);                     // the face opening
    P.over(cx + 2, a.eyeY - 1, 3, 7, skin, skinLo);
    P.rect(cx - 7, a.eyeY - 1, 2, 7, st); P.rect(cx + 5, a.eyeY - 1, 2, 7, stLo);  // cheek guards
    P.col(cx, a.eyeY - 1, a.eyeY + 3, stLo);                     // nasal bar
    if (!a.down) {                                               // plume, swept back
      P.rect(cx - 1, a.headCY - 10, 3, 3, tone(c.accent, 1.15));
      P.rect(cx - 4, a.headCY - 9, 3, 3, tone(c.accent, 1));
      P.rect(cx - 6, a.headCY - 7, 2, 3, tone(c.accent, 0.72));
    }
  },

  archer(P, c, a, skin, skinLo) {
    const cx = 16 + a.lean;
    const cap = c.lamp ? tone(c.metal, 0.85) : tone(c.metal, 1);
    const capLo = c.lamp ? tone(c.metal, 0.55) : tone(c.metal, 0.62);
    const capHi = c.lamp ? tone(c.metal, 1.2) : tone(c.metal, 1.32);
    const hair = c.lamp ? '#4a331f' : '#33291f';
    const scarf = c.lamp ? tone(c.accent, 1) : tone(c.accent, 1.2);
    skullRows(P, a, a.headCY - 9, a.eyeY - 3, cap, 0.7);         // the cap stops above the brow
    skullRows(P, a, a.headCY - 9, a.headCY - 6, capHi, 0.7);
    P.rect(cx - 8, a.eyeY - 3, 15, 2, capLo);                    // brim
    P.rect(cx - 6, a.eyeY - 1, 12, 1, hair);                     // fringe peeking out under it
    P.rect(cx - 7, a.eyeY, 2, 3, hair); P.rect(cx + 5, a.eyeY, 2, 4, hair);
    P.rect(cx + 6, a.eyeY + 2, 2, 5, capLo);                     // hood flap behind the neck
    P.rect(cx - 5, a.chin - 1, 10, 2, scarf);                    // scarf
    P.rect(cx - 5, a.chin - 1, 10, 1, tone(c.accent, c.lamp ? 1.35 : 1.5));
    P.rect(cx - 7, a.chin, 3, 4, tone(c.accent, c.lamp ? 0.72 : 0.95));   // trailing end
  },

  mage(P, c, a, skin, skinLo) {
    const cx = 16 + a.lean;
    const hair = '#2c2536', hairLo = '#1d1826', sil = tone(c.metal, 0.95);
    skullRows(P, a, a.headCY - 9, a.eyeY - 3, hair, 0.8);
    P.rect(cx - 8, a.eyeY - 3, 4, 12, hair); P.rect(cx + 4, a.eyeY - 3, 4, 12, hairLo);  // long locks
    P.rect(cx - 5, a.eyeY - 3, 11, 2, hair);                     // fringe
    P.col(cx - 7, a.eyeY - 1, a.eyeY + 3, sil);                  // a few silver strands
    P.col(cx + 6, a.eyeY + 1, a.eyeY + 4, sil);
    P.px(cx - 3, a.eyeY - 3, sil); P.px(cx + 2, a.eyeY - 2, sil);
    P.rect(cx - 1, a.headCY - 10, 3, 2, tone(c.glow, 1.2));      // circlet gem
  },

  alchemist(P, c, a, skin, skinLo) {
    const cx = 16 + a.lean;
    const hd = tone(c.metal, 1), hdLo = tone(c.metal, 0.6), hdHi = tone(c.metal, 1.25);
    skullRows(P, a, a.headCY - 10, a.eyeY - 3, hd, 1.1);
    skullRows(P, a, a.headCY - 10, a.headCY - 6, hdHi, 1.1);
    P.rect(cx - 8, a.eyeY - 3, 16, 2, hdLo);                     // hood brim
    P.rect(cx - 8, a.eyeY - 1, 3, 9, hd); P.rect(cx + 5, a.eyeY - 1, 3, 9, hdLo);  // hood sides
    P.over(cx - 5, a.eyeY - 1, 10, 1, skin, skinLo);             // brow shadow
    P.rect(cx - 6, a.eyeY - 5, 12, 2, '#2b2b25');                // goggles pushed up on the hood
    P.rect(cx - 5, a.eyeY - 6, 3, 3, tone(c.glow, 0.85));
    P.rect(cx + 2, a.eyeY - 6, 3, 3, tone(c.glow, 0.6));
  },
};

function paintSprite(kind, c, pose) {
  const P = pixBuf(), a = anat(pose);
  const [skin, skinLo] = SKIN[kind] || SKIN.archer;
  (BODY[kind] || BODY.archer)(P, c, a);
  head(P, a, skin, skinLo);
  (HEADGEAR[kind] || HEADGEAR.archer)(P, c, a, skin, skinLo);
  face(P, a);
  P.outline(INK);
  return P.g;
}

export const PALETTE = {
  cassien: { accent: 0x3f6fb8, metal: 0xcbd8ec, glow: 0x9fd8ff },              // imperial blue-silver
  brecht:  { accent: 0x2b8790, metal: 0xa6bcc6, glow: 0x8ff0e0 },              // cool teal, steel fittings
  seira:   { accent: 0x8a58d6, metal: 0xc3b8dc, glow: 0xd39cff },              // violet and silver
  miner:   { accent: 0xa8342c, metal: 0x6e5a48, glow: 0xffb054, lamp: true },  // grey-brown + enemy-red scarf
  alch:    { accent: 0x84413a, metal: 0x8e968b, glow: 0x8fe07a },              // red-brown robe, grey hood
  // warning-bell pair: review-candidate art overrides these procedural ramps
  defender:  { accent: 0xc8551e, metal: 0x8e6a4a, glow: 0xffa060 },            // Type-8 ochre and scarred iron
  cragbeast: { accent: 0x7a5a38, metal: 0x6a604c, glow: 0xd0b070 },            // dust-brown hide
};

export const SPRITE_TOP = SPRITE_H * FOOT_ROW / SPY;   // world height of the sprite's head-room
// picking follows the painted pixels, not the quad, so the empty corners of a
// sprite never steal a click from the tile behind it
export function gridSolid(grid) {
  return (ux, uy) => !!grid[Math.min(SPY - 1, Math.floor((1 - uy) * SPY)) * SPX +
                            Math.min(SPX - 1, Math.floor(ux * SPX))];
}

export function createSpritePainter({ THREE }) {
  // crisp pixels: nearest filtering, no mipmaps, no tone mapping downstream
  const spriteCache = {};
  function unitSprite(kind, palKey, pose) {
    const key = kind + '|' + palKey + '|' + pose;
    if (spriteCache[key]) return spriteCache[key];
    const grid = paintSprite(kind, PALETTE[palKey], pose);
    const cv = document.createElement('canvas'); cv.width = SPX; cv.height = SPY;
    const ctx = cv.getContext('2d');
    for (let y = 0; y < SPY; y++) for (let x = 0; x < SPX; x++) {
      const col = grid[y * SPX + x];
      if (col) { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false; tex.colorSpace = THREE.SRGBColorSpace;
    return (spriteCache[key] = { grid, tex, canvas: cv });
  }

  const _meshRaycast = THREE.Mesh.prototype.raycast;
  function spriteFigure(kind, palKey) {
    const g = new THREE.Group();
    const s = unitSprite(kind, palKey, 'stand');
    const m = new THREE.MeshBasicMaterial({
      map: s.tex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
      toneMapped: false, fog: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SPRITE_H * SPX / SPY, SPRITE_H), m);
    mesh.position.y = SPRITE_H * (FOOT_ROW / SPY - 0.5);   // feet land on the tile top
    mesh.userData.grid = s.grid;
    mesh.userData.solid = gridSolid(s.grid);
    mesh.raycast = function (rc, out) {
      const hits = []; _meshRaycast.call(this, rc, hits);
      const solid = this.userData.solid;
      for (const h of hits) if (!h.uv || !solid || solid(h.uv.x, h.uv.y)) out.push(h);
    };
    g.add(mesh);
    return { group: g, mats: [m], mesh };
  }

  // Busts are a nearest-neighbour zoom into the head and shoulders of the very same
  // pixel sprite that stands on the field, so portrait and unit can never disagree.
  // Real art in portraits/ still overrides these everywhere.
  const faceCache = {};
  const BUST = { x: 4, y: 1, w: 24, h: 24 };     // crop window in sprite pixels
  function spriteBust(kind, palKey, team) {
    const key = 'bust|' + kind + '|' + palKey + '|' + team;
    if (faceCache[key]) return faceCache[key];
    const grid = unitSprite(kind, palKey, 'stand').grid;
    const S = 96, sc = S / BUST.w;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, team === 'player' ? '#2b3560' : '#452a34');
    g.addColorStop(1, '#10162c');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    for (let j = 0; j < BUST.h; j++) for (let i = 0; i < BUST.w; i++) {
      const col = grid[(BUST.y + j) * SPX + (BUST.x + i)];
      if (!col) continue;
      x.fillStyle = col;
      x.fillRect(Math.round(i * sc), Math.round(j * sc), Math.ceil(sc), Math.ceil(sc));
    }
    x.strokeStyle = 'rgba(8,10,20,0.65)'; x.lineWidth = 10;
    x.strokeRect(-2, -2, S + 4, S + 4);
    return (faceCache[key] = c.toDataURL());
  }

  return { unitSprite, spriteFigure, spriteBust };
}
