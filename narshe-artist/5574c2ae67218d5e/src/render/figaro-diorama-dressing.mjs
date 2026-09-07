/**
 * Battle 3's palette: painterly canvas materials and the dusk sky, ported from
 * the approved standalone diorama (`figaro-castle-slice.html`).
 *
 * The colours are the FFVI Figaro sprite's, sampled and then lifted for golden
 * hour: lavender-grey stone with soft per-block shading, warm flagstone courts
 * with gold mosaic diamonds, dune-rippled sand, a crimson runner, brass and
 * copper for the wrecked automatons. Everything is drawn with the injected
 * `makeTex` (one definition of filtering/wrapping for the whole game) and
 * returned as materials for the page to mix into `mat` — the terrain builder
 * reads `sand`/`cobble`/`carpet`/`figaroStone`/`figaroCap`; the rest belong to
 * `figaro-diorama-battlefield.mjs`.
 *
 * `sky` is the dusk gradient (violet through rose to amber, with a low sun
 * bloom) handed to `scene-mood.mjs` as battle 3's `scene.background`.
 */
export function createFigaroDioramaDressing({ THREE, makeTex, atlasUrl }) {
  if (!THREE || !makeTex) throw new Error('Figaro diorama dressing: incomplete context');
  void atlasUrl;   // the painted-atlas era of this module; kept in the signature

  /* The sprite-sampled palette, warmed for dusk. */
  const P = {
    stoneLight: '#c9b9bc', stone: '#9d8a90', stoneMid: '#7c6a72', seam: '#57484f',
    black: '#2e2831', rust: '#7e4a44', pale: '#e2d6d4', white: '#f4eeea',
    sand: '#e7ad73', sandLight: '#f7ce84', courtTan: '#a98e77', courtBrown: '#8d7361',
    gold: '#d9b05e', crestBlue: '#5b93b8', crestDark: '#3d5f7e',
  };

  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const shade = (hex, amt) => {
    const n = parseInt(hex.slice(1), 16);
    const f = v => Math.max(0, Math.min(255, Math.round(v + amt)));
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  const grain = (g, size, count, col, alpha) => {
    g.globalAlpha = alpha;
    for (let i = 0; i < count; i++) {
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(rnd() * size, rnd() * size, 1 + rnd() * 2.5, 1 + rnd() * 2.5, rnd() * 3, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
  };

  /* Soft-shaded ashlar courses: each block its own subtle gradient. */
  const stoneTex = (base, rows) => makeTex((g, size) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, shade(base, 14));
    grad.addColorStop(1, shade(base, -18));
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    const rh = size / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh, off = (r % 2) * (size / 8), n = 6;
      for (let i = -1; i < n; i++) {
        const x = i * (size / n) + off, sw = size / n;
        const j = (rnd() - .5) * 26;
        const sg = g.createLinearGradient(0, y, 0, y + rh);
        sg.addColorStop(0, shade(base, 16 + j));
        sg.addColorStop(.75, shade(base, j - 4));
        sg.addColorStop(1, shade(base, j - 26));
        g.fillStyle = sg;
        g.beginPath(); g.roundRect(x + 1.5, y + 1.5, sw - 3, rh - 3, 4); g.fill();
        g.strokeStyle = 'rgba(255,244,230,.28)'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x + 4, y + 2.5); g.lineTo(x + sw - 4, y + 2.5); g.stroke();
      }
      g.fillStyle = 'rgba(40,28,38,.5)'; g.fillRect(0, y, size, 1.6);
    }
    grain(g, size, 140, shade(base, 30), .08);
    grain(g, size, 120, shade(base, -40), .08);
  }, 256);

  /* Fish-scale masonry for the round towers, softly lit per scale. */
  const scaleTex = makeTex((g, size) => {
    g.fillStyle = shade(P.stone, -20); g.fillRect(0, 0, size, size);
    const r = 20;
    for (let y = 0; y <= size + r; y += r * .78) {
      const off = (((y / (r * .78)) | 0) % 2) * r;
      for (let x = -r; x <= size + r; x += r * 2) {
        const j = (rnd() - .5) * 22;
        const sg = g.createRadialGradient(x + off, y - r * .5, 2, x + off, y, r);
        sg.addColorStop(0, shade(P.stoneLight, j));
        sg.addColorStop(.8, shade(P.stone, j - 6));
        sg.addColorStop(1, shade(P.seam, j));
        g.fillStyle = sg;
        g.beginPath(); g.arc(x + off, y, r, 0, Math.PI); g.fill();
        g.strokeStyle = 'rgba(40,28,38,.45)'; g.lineWidth = 1.4;
        g.beginPath(); g.arc(x + off, y, r, 0, Math.PI); g.stroke();
      }
    }
  }, 256);

  /* One battle tile of warm flagstones (2x2 per tile) with gold mosaic diamonds. */
  const courtTex = makeTex((g, size) => {
    const grad = g.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, shade(P.courtTan, 10));
    grad.addColorStop(1, shade(P.courtBrown, -6));
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    const n = 2, s = size / n;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = c * s, y = r * s, j = (rnd() - .5) * 16;
      const sg = g.createLinearGradient(x, y, x + s, y + s);
      sg.addColorStop(0, shade(P.courtTan, 12 + j));
      sg.addColorStop(1, shade(P.courtBrown, j - 8));
      g.fillStyle = sg;
      g.beginPath(); g.roundRect(x + 3, y + 3, s - 6, s - 6, 8); g.fill();
      if (rnd() < .3) {
        g.fillStyle = P.gold; g.globalAlpha = .7;
        g.beginPath();
        g.moveTo(x + s / 2, y + s / 2 - 12); g.lineTo(x + s / 2 + 12, y + s / 2);
        g.lineTo(x + s / 2, y + s / 2 + 12); g.lineTo(x + s / 2 - 12, y + s / 2);
        g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
    }
    grain(g, size, 90, shade(P.courtTan, 26), .1);
  }, 128);

  /* One battle tile of dune sand: soft ripples catching the low sun. */
  const sandTex = makeTex((g, size) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, shade(P.sand, 8));
    grad.addColorStop(1, shade(P.sand, -8));
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    for (let y = 12; y < size; y += 26) {
      g.beginPath();
      for (let x = 0; x <= size; x += 8) g.lineTo(x, y + Math.sin((x / size) * Math.PI * 3 + y) * 5);
      g.strokeStyle = 'rgba(255,222,150,.4)'; g.lineWidth = 2.6; g.stroke();
      g.beginPath();
      for (let x = 0; x <= size; x += 8) g.lineTo(x, y + 4 + Math.sin((x / size) * Math.PI * 3 + y) * 5);
      g.strokeStyle = 'rgba(120,80,60,.22)'; g.lineWidth = 1.6; g.stroke();
    }
    grain(g, size, 60, '#fff0c8', .12);
  }, 128);

  /* The crimson runner, gold-bordered. */
  const carpetTex = makeTex((g, size) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, '#a43350'); grad.addColorStop(1, '#7c2338');
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    g.strokeStyle = P.gold; g.lineWidth = 7; g.globalAlpha = .85;
    g.beginPath(); g.moveTo(10, 0); g.lineTo(10, size); g.stroke();
    g.beginPath(); g.moveTo(size - 10, 0); g.lineTo(size - 10, size); g.stroke();
    g.globalAlpha = 1;
    grain(g, size, 50, '#5c1a2c', .18);
  }, 128);

  /* The luminous knotwork shield over the gate. */
  const crestTex = makeTex((g, size) => {
    g.clearRect(0, 0, size, size);
    const u = size / 128;
    const sg = g.createLinearGradient(0, 0, 0, size);
    sg.addColorStop(0, shade(P.crestBlue, 26)); sg.addColorStop(1, shade(P.crestDark, -8));
    g.fillStyle = P.gold;
    g.beginPath(); g.moveTo(14 * u, 6 * u); g.lineTo(114 * u, 6 * u); g.lineTo(114 * u, 72 * u);
    g.lineTo(64 * u, 122 * u); g.lineTo(14 * u, 72 * u); g.closePath(); g.fill();
    g.fillStyle = sg;
    g.beginPath(); g.moveTo(20 * u, 12 * u); g.lineTo(108 * u, 12 * u); g.lineTo(108 * u, 68 * u);
    g.lineTo(64 * u, 112 * u); g.lineTo(20 * u, 68 * u); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(244,238,234,.9)'; g.lineWidth = 3 * u; g.lineJoin = 'round';
    for (let i = 0; i < 3; i++)
      g.strokeRect((34 + i * 8) * u, (28 + i * 8) * u, (60 - i * 16) * u, (44 - i * 16) * u);
    g.beginPath(); g.moveTo(64 * u, 24 * u); g.lineTo(64 * u, 96 * u); g.stroke();
  }, 128);

  /* The rust rosette wheel the round towers wear, seen from above. */
  const rosetteTex = makeTex((g, size) => {
    const bg = g.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    bg.addColorStop(0, shade(P.black, 20)); bg.addColorStop(1, P.black);
    g.fillStyle = bg; g.fillRect(0, 0, size, size);
    g.save(); g.translate(size / 2, size / 2);
    for (let i = 0; i < 8; i++) {
      g.rotate(Math.PI / 4);
      const sg = g.createLinearGradient(0, -9, 0, 9);
      sg.addColorStop(0, shade(P.rust, 26)); sg.addColorStop(1, shade(P.rust, -18));
      g.fillStyle = sg;
      g.beginPath(); g.moveTo(6, -4); g.lineTo(size / 2 - 6, -9);
      g.lineTo(size / 2 - 6, 9); g.lineTo(6, 4); g.closePath(); g.fill();
    }
    g.restore();
    const hub = g.createRadialGradient(size / 2 - 3, size / 2 - 3, 1, size / 2, size / 2, 12);
    hub.addColorStop(0, shade(P.gold, 30)); hub.addColorStop(1, shade(P.gold, -30));
    g.fillStyle = hub; g.beginPath(); g.arc(size / 2, size / 2, 11, 0, 7); g.fill();
  }, 128);

  /* A hanging banner: gradient field, pale border, gold diamond and fringe. */
  const bannerTex = (a, b) => makeTex((g, size) => {
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, shade(a, 18)); grad.addColorStop(.6, a); grad.addColorStop(1, shade(b, -14));
    g.fillStyle = grad; g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(255,240,210,.4)'; g.lineWidth = 4;
    g.strokeRect(8, 8, size - 16, size - 16);
    g.fillStyle = P.gold;
    g.beginPath();
    g.moveTo(size / 2, size * .32); g.lineTo(size * .66, size * .5);
    g.lineTo(size / 2, size * .68); g.lineTo(size * .34, size * .5);
    g.closePath(); g.fill();
    g.fillRect(0, size - 12, size, 12);
  }, 128);

  /* The warm torch/window glow, for sprites. */
  const glowTex = makeTex((g, size) => {
    const r = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    r.addColorStop(0, 'rgba(255,190,110,.9)');
    r.addColorStop(.5, 'rgba(255,150,70,.28)');
    r.addColorStop(1, 'rgba(255,150,70,0)');
    g.fillStyle = r; g.fillRect(0, 0, size, size);
  }, 128);

  const sky = makeTex((g, size) => {
    const gradient = g.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#3a2c4a');
    gradient.addColorStop(.24, '#6b4258');
    gradient.addColorStop(.52, '#b06a72');
    gradient.addColorStop(.76, '#e29a6c');
    gradient.addColorStop(1, '#f6c488');
    g.fillStyle = gradient; g.fillRect(0, 0, size, size);
    const glow = g.createRadialGradient(size * .3, size * .74, 0, size * .3, size * .74, size * .3);
    glow.addColorStop(0, 'rgba(255,221,159,.75)');
    glow.addColorStop(1, 'rgba(255,221,159,0)');
    g.fillStyle = glow; g.fillRect(0, 0, size, size);
  }, 512);

  const standard = options => new THREE.MeshStandardMaterial(options);
  return {
    sky,
    materials: {
      /* --- what the terrain builder reads --- */
      figaroStone: standard({ map: stoneTex(P.stone, 7), roughness: .92 }),
      figaroCap: standard({ map: stoneTex(P.stoneMid, 8), roughness: .95 }),
      sand: standard({ map: sandTex, roughness: 1 }),
      cobble: standard({ map: courtTex, roughness: .95 }),
      carpet: standard({ map: carpetTex, roughness: .9 }),
      /* --- what the scenery reads --- */
      figaroScale: standard({ map: scaleTex, roughness: .92 }),
      figaroPale: standard({ color: P.pale, roughness: .92 }),
      figaroWhite: standard({ color: P.white, roughness: .9 }),
      figaroBlack: standard({ color: P.black, roughness: .92 }),
      figaroRust: standard({ color: P.rust, roughness: .9 }),
      figaroIron: standard({ color: '#8b8494', roughness: .4, metalness: .65 }),
      figaroGold: standard({ color: P.gold, roughness: .3, metalness: .75 }),
      figaroBrass: standard({ color: '#b8863f', roughness: .35, metalness: .7 }),
      figaroCopper: standard({ color: '#8f5a38', roughness: .45, metalness: .6 }),
      figaroBanner: standard({ map: bannerTex('#3f6d92', '#2c4a6b'), roughness: .85,
        side: THREE.DoubleSide }),
      figaroBannerCrimson: standard({ map: bannerTex('#8e2f3d', '#5c1f2e'), roughness: .85,
        side: THREE.DoubleSide }),
      figaroCrest: standard({ map: crestTex, transparent: true, roughness: .75 }),
      figaroRosette: standard({ map: rosetteTex, roughness: .85 }),
      figaroFlame: new THREE.MeshBasicMaterial({ color: 0xffc36b }),
      figaroWindow: new THREE.MeshBasicMaterial({ color: 0xffca7a }),
      figaroSmoke: standard({ color: '#9a8f92', transparent: true, opacity: .5, roughness: 1 }),
      figaroGlowTex: glowTex,
    },
  };
}
