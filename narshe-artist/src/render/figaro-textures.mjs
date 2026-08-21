/**
 * Battle 3's palette: the canvas textures and materials the Figaro courtyard is
 * built out of, plus its dusk sky.
 *
 * SEPARATE FROM `procedural-textures.mjs` ON PURPOSE. That module is Battle 1's
 * winter set — snow, crag, cold cobble, planks — and both shipped battles
 * allocate exactly its textures and no others. Figaro is a desert castle at
 * dusk, so it needs its own: dark slate BRICK with visible coursing, warm ochre
 * cobble, dune-streaked sand, a crimson runner, and the blue-and-red house
 * banner. Keeping them here means battle 3 is the only entry that pays for
 * them — `createFigaroDressing` is called under the FIGARO branch and nowhere
 * else — and the two shipped battles' GPU footprint does not move.
 *
 * `makeTex` arrives injected rather than being redefined: it is the same
 * canvas → CanvasTexture helper the winter set uses, so how a procedural
 * texture is filtered and wrapped has one definition. `mulberry` likewise, so
 * every speck of grit is in the same place on every run.
 *
 * The one thing here that is not a material is `sky`: a vertical dusk gradient
 * with a low sun bloom, handed to `scene-mood.mjs` as battle 3's
 * `scene.background`. A flat colour behind a castle in a desert reads as a
 * missing backdrop; the whole warm-against-cool look starts here.
 */

/**
 * @param {object} ctx
 * @param {object} ctx.THREE      scene-graph constructors (the ledger's, so every
 *                                texture and material below is tracked for teardown)
 * @param {Function} ctx.makeTex  (draw, size?) -> CanvasTexture, from procedural-textures
 * @param {Function} ctx.mulberry seeded PRNG, so the grain is reproducible
 * @param {string} ctx.atlasUrl  embedded FFVI-derived painted material atlas
 * @returns {{materials: object, sky: object}}
 */
export function createFigaroDressing({ THREE, makeTex, mulberry, atlasUrl }) {
  for (const [name, value] of Object.entries({ THREE, makeTex, mulberry, atlasUrl })) {
    if (value === undefined || value === null)
      throw new Error(`figaro dressing: missing context "${name}"`);
  }

  // Six painted swatches in a 2×3 atlas. Each material gets its own texture
  // object so wrapping/repeat can differ without moving another surface's UVs.
  const atlasPanel = (col, row) => {
    const texture = new THREE.TextureLoader().load(atlasUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.49, 0.323);
    texture.offset.set(col * 0.505, (2 - row) * 0.338);
    texture.anisotropy = 8;
    return texture;
  };
  const painted = {
    ashlar: atlasPanel(0, 0),
    tower: atlasPanel(1, 0),
    cobble: atlasPanel(0, 1),
    carpet: atlasPanel(1, 1),
    iron: atlasPanel(0, 2),
    sand: atlasPanel(1, 2),
  };

  // ---------------------------------------------------------------- stone
  // Coursed brick. An EVEN course count matters: the offset alternates per row,
  // so an odd one puts two identically-offset courses against each other across
  // the wrap seam and the whole wall reads as a stack of stripes.
  const texBrick = makeTex((ctx, s) => {
    const r = mulberry(301);
    ctx.fillStyle = '#262b3a'; ctx.fillRect(0, 0, s, s);          // mortar behind everything
    // TEN courses of THREE, not a square grid: a brick is about twice as wide as
    // it is tall, and on a 1.8-unit curtain wall that lands at roughly the
    // course height the reference draws.
    const rows = 10, cols = 3, ch = s / rows, cw = s / cols;
    for (let row = 0; row < rows; row++) {
      const off = (row % 2) * 0.5;
      for (let c = -1; c <= cols; c++) {
        const x = (c + off) * cw, y = row * ch;
        const bw = cw - 3.5, bh = ch - 3;
        // Cooler than it looks it should be: the key light is deep amber, so a
        // neutral grey brick comes out brown. The blue is what survives it.
        const v = 74 + r() * 24;
        ctx.fillStyle = `rgb(${(v - 6 + r() * 7) | 0},${(v + 8) | 0},${(v + 40) | 0})`;
        ctx.fillRect(x + 1.75, y + 1.5, bw, bh);
        ctx.fillStyle = 'rgba(190,202,232,0.20)';                  // top arris catches the sun
        ctx.fillRect(x + 1.75, y + 1.5, bw, 2.5);
        ctx.fillStyle = 'rgba(4,6,12,0.45)';                       // shadowed underside
        ctx.fillRect(x + 1.75, y + bh - 0.5, bw, 3);
        if (r() > 0.7) {                                           // pitting
          ctx.fillStyle = 'rgba(16,20,30,0.34)';
          ctx.fillRect(x + 3 + r() * bw * 0.5, y + 3, bw * 0.3, bh * 0.5);
        }
      }
    }
    ctx.strokeStyle = 'rgba(12,16,26,0.22)'; ctx.lineWidth = 5;    // damp streaks down the face
    for (let i = 0; i < 5; i++) {
      let x = r() * s;
      ctx.beginPath(); ctx.moveTo(x, 0);
      for (let y = 0; y < s; y += 26) { x += (r() - 0.5) * 7; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  });

  // Wall tops are capstones, not brick seen end-on: big dressed slabs.
  const texCap = makeTex((ctx, s) => {
    const r = mulberry(302);
    ctx.fillStyle = '#232733'; ctx.fillRect(0, 0, s, s);
    const n = 3, cs = s / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 84 + r() * 22;
      ctx.fillStyle = `rgb(${(v - 5) | 0},${(v + 9) | 0},${(v + 40) | 0})`;
      ctx.fillRect(i * cs + 3, j * cs + 3, cs - 6, cs - 6);
      ctx.fillStyle = 'rgba(200,210,238,0.15)';
      ctx.fillRect(i * cs + 3, j * cs + 3, cs - 6, 3);
      ctx.fillStyle = 'rgba(6,8,16,0.3)';
      ctx.fillRect(i * cs + 3, j * cs + cs - 9, cs - 6, 3);
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(140,150,180,0.16)' : 'rgba(10,12,22,0.2)';
      ctx.fillRect(r() * s, r() * s, 2, 2);
    }
  });

  // Dressed ashlar for jambs, string courses and merlon caps — the same stone
  // one shade lighter, so an edge reads as cut rather than as more wall.
  const texAshlar = makeTex((ctx, s) => {
    const r = mulberry(303);
    ctx.fillStyle = '#262b38'; ctx.fillRect(0, 0, s, s);
    const rows = 4, ch = s / rows;
    for (let row = 0; row < rows; row++) {
      const v = 104 + r() * 20;
      ctx.fillStyle = `rgb(${(v - 5) | 0},${(v + 9) | 0},${(v + 40) | 0})`;
      ctx.fillRect(2, row * ch + 2, s - 4, ch - 4);
      ctx.fillStyle = 'rgba(210,220,244,0.17)';
      ctx.fillRect(2, row * ch + 2, s - 4, 3);
    }
  });

  // ---------------------------------------------------------------- ground
  // Warm ochre cobble: the reference's entry hall floor. Tone variation is
  // baked in — every fifth stone goes cool slate, which is what stops a floor
  // made of one repeating tile from looking printed.
  const texCobble = makeTex((ctx, s) => {
    const r = mulberry(311);
    ctx.fillStyle = '#4e3b25'; ctx.fillRect(0, 0, s, s);
    const rows = 4, cols = 4, ch = s / rows, cw = s / cols;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const inset = 3 + r() * 3;
      const cool = r() > 0.8;
      const v = 180 + r() * 38;
      ctx.fillStyle = cool
        ? `rgb(${(v * 0.72) | 0},${(v * 0.73) | 0},${(v * 0.78) | 0})`
        : `rgb(${v | 0},${(v * 0.82) | 0},${(v * 0.6) | 0})`;
      const x = col * cw + inset + (r() - 0.5) * 3, y = row * ch + inset + (r() - 0.5) * 3;
      const w = cw - inset * 2, h = ch - inset * 2;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 5 + r() * 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,236,200,0.16)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 3, y + 2); ctx.lineTo(x + w - 3, y + 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(40,26,14,0.30)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 3, y + h - 2); ctx.lineTo(x + w - 3, y + h - 2); ctx.stroke();
    }
    for (let i = 0; i < 150; i++) {                                 // wind-blown sand in the joints
      ctx.fillStyle = 'rgba(226,192,142,0.35)';
      ctx.fillRect(r() * s, r() * s, 2, 1.5);
    }
  });

  // Desert sand, with the reference's two-tone wavy dune streaks. The streaks
  // are sines of an integer period across the texture so the wrap is seamless.
  const texSand = makeTex((ctx, s) => {
    const r = mulberry(312);
    ctx.fillStyle = '#dcba8b'; ctx.fillRect(0, 0, s, s);
    for (let band = -1; band < 8; band++) {
      const y0 = band * (s / 7) + r() * 6;
      const amp = 4 + r() * 7, period = 1 + Math.floor(r() * 2);
      ctx.lineWidth = 5 + r() * 6;
      ctx.strokeStyle = 'rgba(186,148,101,0.42)';
      ctx.beginPath();
      for (let x = 0; x <= s; x += 4)
        ctx[x === 0 ? 'moveTo' : 'lineTo'](x, y0 + Math.sin((x / s) * Math.PI * 2 * period) * amp);
      ctx.stroke();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(246,224,186,0.40)';                   // the lit crest of the ripple
      ctx.beginPath();
      for (let x = 0; x <= s; x += 4)
        ctx[x === 0 ? 'moveTo' : 'lineTo'](x, y0 - 4 + Math.sin((x / s) * Math.PI * 2 * period) * amp);
      ctx.stroke();
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(255,240,214,0.30)' : 'rgba(160,124,84,0.22)';
      ctx.fillRect(r() * s, r() * s, 1.6, 1.6);
    }
  });

  // The crimson runner. Its border stripes are drawn at the LEFT AND RIGHT of
  // the canvas on purpose: BoxGeometry's +Y face maps u to x and v to z, so a
  // stripe at constant u is a stripe at constant x — a border that runs the
  // length of the runner instead of framing every tile of it.
  const texCarpet = makeTex((ctx, s) => {
    const r = mulberry(313);
    ctx.fillStyle = '#8e1f2f'; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(122,32,46,0.5)'; ctx.lineWidth = 1;     // weave
    for (let i = 0; i < s; i += 4) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    for (const [x0, w, fill] of [
      [0, s * 0.08, '#5f1220'], [s * 0.92, s * 0.08, '#5f1220'],
      [s * 0.095, s * 0.035, '#d4a955'], [s * 0.87, s * 0.035, '#d4a955'],
    ]) { ctx.fillStyle = fill; ctx.fillRect(x0, 0, w, s); }
    for (let i = 0; i < 120; i++) {                                  // pile scuff
      ctx.fillStyle = r() > 0.5 ? 'rgba(180,70,86,0.16)' : 'rgba(58,12,20,0.16)';
      ctx.fillRect(r() * s, r() * s, 3, 2);
    }
  });

  // Fire damage, as a soft alpha smudge rather than a rectangle of grey. A flat
  // dark quad reads as a sticker on stone; this is what lets the same material
  // serve for streaks up the gatehouse face and scorch on the ground.
  const texSoot = makeTex((ctx, s) => {
    const r = mulberry(321);
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      const cx = s * 0.5 + (r() - 0.5) * s * 0.7, cy = s * 0.5 + (r() - 0.5) * s * 0.8;
      const rad = s * (0.08 + r() * 0.22);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      g.addColorStop(0, `rgba(14,10,12,${0.30 + r() * 0.4})`);
      g.addColorStop(1, 'rgba(14,10,12,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 7); ctx.fill();
    }
  }, 128);
  texSoot.wrapS = texSoot.wrapT = THREE.ClampToEdgeWrapping;

  // ---------------------------------------------------------------- house colours
  // The Figaro banner: blue field, flared red cross, gold edging, crimson
  // fringe across the head. Drawn rather than authored because `art/` masters
  // are Codex's and this is scenery, not a sprite.
  const texBanner = makeTex((ctx, s) => {
    // The field has to WIN at forty pixels across, which is all a banner on a
    // wall ever gets: a bright blue ground with a compact crest, not a cross so
    // large the blue survives only in the corners.
    const field = ctx.createLinearGradient(0, 0, 0, s);
    field.addColorStop(0, '#4e9bff'); field.addColorStop(0.5, '#2b78f0'); field.addColorStop(1, '#1a54c4');
    ctx.fillStyle = field; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#d0a94f'; ctx.lineWidth = 6;                  // gold hem
    ctx.strokeRect(10, 10, s - 20, s - 20);
    const cx = s / 2, cy = s * 0.58;
    const bar = (w, h) => {                                          // flared cross arms
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.42, cy - h / 2); ctx.lineTo(cx + w * 0.42, cy - h / 2);
      ctx.lineTo(cx + w * 0.5, cy - h * 0.34); ctx.lineTo(cx + w * 0.5, cy + h * 0.34);
      ctx.lineTo(cx + w * 0.42, cy + h / 2); ctx.lineTo(cx - w * 0.42, cy + h / 2);
      ctx.lineTo(cx - w * 0.5, cy + h * 0.34); ctx.lineTo(cx - w * 0.5, cy - h * 0.34);
      ctx.closePath();
    };
    for (const [w, h] of [[s * 0.52, s * 0.145], [s * 0.175, s * 0.48]]) {
      bar(w, h); ctx.fillStyle = '#b8232f'; ctx.fill();
      ctx.strokeStyle = '#e2bd63'; ctx.lineWidth = 3.5; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.068, 0, 7);               // the boss at the crossing
    ctx.fillStyle = '#e2bd63'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, s * 0.036, 0, 7);
    ctx.fillStyle = '#4a7fcc'; ctx.fill();
    ctx.fillStyle = '#8f1d28'; ctx.fillRect(0, 0, s, s * 0.13);      // fringe across the head
    ctx.fillStyle = '#6b1220';
    for (let i = 0; i < 16; i++) {
      ctx.beginPath(); ctx.arc((i + 0.5) * s / 16, s * 0.13, s / 32, 0, Math.PI); ctx.fill();
    }
  });

  // ---------------------------------------------------------------- the dusk itself
  // A gradient, not a horizon line: the diorama floats on a plinth, so a drawn
  // horizon cuts through it. Dusty violet overhead falling to amber where the
  // sun is going down off the west shoulder of the frame, plus a soft vignette.
  //
  // THE TOP OF THIS GRADIENT IS A LEGIBILITY CONSTRAINT, not a taste one. The
  // camera-rotation key hints are dark ink with a white glow (`.hint` in
  // diorama.css, sized for the two snow battles' pale skies) and they sit in
  // the top-left eighth of the frame, so a night-blue up there makes them
  // unreadable. Hence a lifted violet rather than indigo, and a vignette weak
  // enough that the corner they live in stays light.
  const sky = makeTex((ctx, s) => {
    const grad = ctx.createLinearGradient(0, 0, 0, s);
    for (const [stop, color] of [
      [0, '#7d76ad'], [0.18, '#6a5c92'], [0.4, '#8a5a72'],
      [0.62, '#c2734d'], [0.82, '#e5a061'], [1, '#f2c084'],
    ]) grad.addColorStop(stop, color);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, s, s);
    const sun = ctx.createRadialGradient(s * 0.18, s * 0.82, 0, s * 0.18, s * 0.82, s * 0.62);
    sun.addColorStop(0, 'rgba(255,228,176,0.80)');
    sun.addColorStop(0.35, 'rgba(255,192,124,0.30)');
    sun.addColorStop(1, 'rgba(255,180,110,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, s, s);
    const vig = ctx.createRadialGradient(s / 2, s * 0.5, s * 0.3, s / 2, s * 0.5, s * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(30,18,42,0.30)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, s, s);
  }, 512);
  sky.wrapS = sky.wrapT = THREE.ClampToEdgeWrapping;

  const std = (options) => new THREE.MeshStandardMaterial(options);
  const retile = (texture, u, v) => {
    const copy = texture.clone();
    copy.needsUpdate = true;
    copy.repeat.set(u, v);
    return copy;
  };
  const materials = {
    // terrain: the three tile tops the map declares, plus the column and cap the
    // terrain mesh cuts every tile from
    figaroStone: std({ map: painted.ashlar, color: 0xb7a59a, roughness: 0.94 }),
    // The same brick, retiled for a cylinder. A box face gets one texture over
    // one tile; a tower's skin is four metres of circumference over one UV wrap,
    // so without its own repeat the coursing smears into bands and the towers
    // read as smooth silos. The texture is cloned rather than shared, since
    // `repeat` lives on the texture and the walls need theirs left alone.
    figaroTowerStone: std({ map: painted.tower, color: 0xaaa09c, roughness: 0.95 }),
    figaroCap:   std({ map: painted.ashlar, color: 0xc5b8ac, roughness: 0.9 }),
    sand:        std({ map: painted.sand, color: 0xd2b37f, roughness: 1 }),
    cobble:      std({ map: painted.cobble, color: 0xb18e6e, roughness: 0.93 }),
    carpet:      std({ map: painted.carpet, color: 0xa4384b, roughness: 0.98 }),
    // dressing
    figaroAshlar: std({ map: painted.ashlar, color: 0xc9b9a9, roughness: 0.88 }),
    figaroIron:   std({ map: painted.iron, color: 0x65717d, roughness: 0.5, metalness: 0.65 }),
    figaroIronLt: std({ color: 0x6d778c, roughness: 0.45, metalness: 0.7 }),
    figaroBanner: std({ map: texBanner, roughness: 0.85, side: THREE.DoubleSide }),
    figaroFringe: std({ color: 0x7d1a24, roughness: 0.95 }),
    figaroRubble: std({ map: texCap, color: 0xb9bed0, roughness: 1, flatShading: true }),
    figaroTimber: std({ color: 0x7d5b34, roughness: 0.95 }),
    figaroFlame:  std({ color: 0xffd08a, emissive: 0xff9c3c, emissiveIntensity: 2.6, roughness: 1 }),
    figaroSoot:   new THREE.MeshBasicMaterial({
      map: texSoot, transparent: true, opacity: 0.88, depthWrite: false }),
    figaroDark:   std({ color: 0x1e2330, roughness: 1 }),
  };

  return { materials, sky };
}
