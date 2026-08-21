/**
 * Procedural canvas textures for Battle 1's terrain: snow, rock, cobblestone
 * and the two plank finishes (light/dark). Pure canvas-drawing functions —
 * `makeTex` never reads scene or battle state, only the injected `THREE` (for
 * `CanvasTexture`) and `mulberry` (the page's deterministic PRNG, so texture
 * jitter stays reproducible) — matching the injection style already used by
 * `src/render/terrain-kit.mjs` rather than importing page globals.
 */

export function createProceduralTextures({ THREE, mulberry }) {
  function makeTex(draw, size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    const ctx = c.getContext('2d');
    draw(ctx, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }
  const texSnow = makeTex((ctx, s) => {
    const r = mulberry(11);
    ctx.fillStyle = '#e9eef9'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 340; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(210,220,240,0.06)' : 'rgba(255,255,255,0.06)';
      const rad = 3 + r() * 22;
      ctx.beginPath(); ctx.arc(r() * s, r() * s, rad, 0, 7); ctx.fill();
    }
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(r() * s, r() * s, 1.4, 1.4);
    }
  });
  const texRock = makeTex((ctx, s) => {
    const r = mulberry(22);
    ctx.fillStyle = '#7c86a2'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 46; i++) {
      ctx.fillStyle = r() > 0.5 ? 'rgba(60,67,92,0.22)' : 'rgba(110,119,148,0.20)';
      ctx.beginPath();
      const cx = r() * s, cy = r() * s, rad = 8 + r() * 34;
      ctx.moveTo(cx + rad, cy);
      for (let a = 0.6; a < 6.3; a += 0.6) ctx.lineTo(cx + Math.cos(a) * rad * (0.6 + r() * 0.7), cy + Math.sin(a) * rad * (0.6 + r() * 0.7));
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(40,45,66,0.32)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      let x = r() * s, y = r() * s; ctx.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 60; y += r() * 40; ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(150,158,185,0.18)'; ctx.fillRect(r() * s, r() * s, 2, 2); }
  });
  const texCobble = makeTex((ctx, s) => {
    const r = mulberry(33);
    ctx.fillStyle = '#6b7492'; ctx.fillRect(0, 0, s, s);
    const rows = 5, cols = 5, ch = s / rows, cw = s / cols;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const inset = 3 + r() * 3;
      const shade = 136 + Math.floor(r() * 16);
      ctx.fillStyle = `rgb(${shade},${shade + 8},${shade + 30})`;
      const x = col * cw + inset + (r() - 0.5) * 3, y = row * ch + inset + (r() - 0.5) * 3;
      const w = cw - inset * 2, h = ch - inset * 2;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 6 + r() * 6); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 3, y + 2); ctx.lineTo(x + w - 3, y + 2); ctx.stroke();
    }
    for (let i = 0; i < 120; i++) { ctx.fillStyle = 'rgba(230,236,250,0.5)'; ctx.fillRect(r() * s, r() * s, 2, 1.5); } // snow dust in the cracks
  });
  function plankTex(seed, base, dark, grain) {
    return makeTex((ctx, s) => {
      const r = mulberry(seed);
      ctx.fillStyle = base; ctx.fillRect(0, 0, s, s);
      const planks = 5, pw = s / planks;
      for (let p = 0; p < planks; p++) {
        const x0 = p * pw;
        ctx.strokeStyle = dark; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, s); ctx.stroke();
        ctx.strokeStyle = grain; ctx.lineWidth = 1.2;
        for (let g = 0; g < 6; g++) {
          ctx.beginPath();
          let gx = x0 + 4 + r() * (pw - 8), gy = 0;
          ctx.moveTo(gx, gy);
          while (gy < s) { gy += 20 + r() * 26; gx += (r() - 0.5) * 6; ctx.lineTo(gx, gy); }
          ctx.stroke();
        }
        if (r() > 0.55) {
          ctx.fillStyle = dark;
          ctx.beginPath(); ctx.ellipse(x0 + 6 + r() * (pw - 12), r() * s, 3.4, 4.6, 0, 0, 7); ctx.fill();
        }
        ctx.fillStyle = 'rgba(30,24,18,0.8)';
        ctx.fillRect(x0 + pw / 2 - 1.5, 6, 3, 3); ctx.fillRect(x0 + pw / 2 - 1.5, s - 10, 3, 3);
      }
    });
  }
  const texPlank   = plankTex(44, '#6e5138', '#3d2c1c', 'rgba(58,42,27,0.5)');
  const texPlankDk = plankTex(55, '#4b3a28', '#2a2014', 'rgba(32,24,15,0.55)');

  return { makeTex, texSnow, texRock, texCobble, plankTex, texPlank, texPlankDk };
}
