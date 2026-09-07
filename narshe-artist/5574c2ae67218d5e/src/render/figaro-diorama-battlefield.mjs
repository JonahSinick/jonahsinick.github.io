/**
 * Battle 3 static scenery — the Figaro gate as the approved standalone diorama
 * (`figaro-castle-slice.html`) renders it, rebuilt on the engine's terrain.
 *
 * The terrain module has already raised every ROCK column (keep, gatehouse,
 * cheeks, parapets, towers' footprints) to the heights the map declares, in the
 * dressing's coursed stone. This module adds what the diorama adds: the crowned
 * keep tower and its rosette-capped flankers, the gate lintel and crest, the
 * battlement merlons, the round towers on their footprints, the wall ladders,
 * the fallen portcullis and rubble of the stage-two breach, the wrecked
 * automaton line, banners, torches and their lights.
 *
 * IT MUST NOT WRITE OCCUPANCY (AGENT_BRIEF trap 6): which tiles the wrecks
 * claim is `figaroSolidPropTiles` in the map module, and the page writes it.
 * This module only draws a wreck where the map says one lies.
 *
 * WHERE THE HEIGHTS COME FROM: `tileTop`, the surface the terrain actually
 * built — never the map's `h` numbers. Only one of them is what units stand on.
 *
 * LEGIBILITY: the camera looks from the south, so everything tall lives on the
 * north half (keep, gatehouse, back towers) where the map already puts it. The
 * gate towers flanking the ramp exit are the one tall thing mid-board, so that
 * pair is registered with the building-occlusion gate and ghosts when a unit
 * walks behind it, exactly like battle 1's bunkhouse.
 *
 * Everything arrives in one explicit context object and it imports nothing —
 * THREE included — so it stays constructible from Node against a stub. Returns
 * `{ group, torches, flicker }`; `flicker(t)` is the page's per-frame call and
 * also drives the wreck smoke and the one sparking hulk.
 */
export function createFigaroDioramaBattlefield(c) {
  const {
    THREE, world, box, mat, tileTop, warmLight, lights, map, W,
    registerBuildingOccluder,
  } = c;
  const stage = new THREE.Group();
  stage.name = 'figaro-diorama-battlefield';
  world.add(stage);

  const top = (x, z) => tileTop[z]?.[x] ?? 0;
  const cx = map.carpetX + 0.5;
  const b = (w, h, d, m, x, y, z, group = stage, shadow = true) =>
    box(w, h, d, m, x, y, z, { group, shadow });
  function put(geometry, m, x, y, z, group = stage, shadow = true) {
    const q = new THREE.Mesh(geometry, m);
    q.position.set(x, y, z);
    q.castShadow = q.receiveShadow = shadow;
    group.add(q);
    return q;
  }
  const cyl = (r, h, m, x, y, z, sides = 16, group = stage) =>
    put(new THREE.CylinderGeometry(r, r, h, sides), m, x, y, z, group);

  /* ---- battlements: a row of merlons along a wall top ---- */
  function merlons(x0, x1, y, z, depth = 0.4, m = mat.figaroPale) {
    const n = Math.max(3, Math.round((x1 - x0) / 0.9)) | 1;
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i += 2)
      b(w * 0.84, 0.34, depth, m, x0 + (i + 0.5) * w, y + 0.17, z);
  }
  function merlonsAlongZ(z0, z1, y, x, depth = 0.4, m = mat.figaroPale) {
    const n = Math.max(3, Math.round((z1 - z0) / 0.9)) | 1;
    const d = (z1 - z0) / n;
    for (let i = 0; i < n; i += 2)
      b(depth, 0.34, d * 0.84, m, x, y + 0.17, z0 + (i + 0.5) * d);
  }

  /* ---- the rosette-capped round tower the diorama is made of ---- */
  function roundTower(x, z, r, h, baseY, group = stage) {
    cyl(r, h, mat.figaroScale, x, baseY + h / 2, z, 20, group);
    cyl(r + 0.14, 0.2, mat.figaroPale, x, baseY + h + 0.1, z, 20, group);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q = b(0.34, 0.3, 0.2, mat.figaroPale,
        x + Math.cos(a) * (r + 0.04), baseY + h + 0.35, z + Math.sin(a) * (r + 0.04), group);
      q.rotation.y = -a;
    }
    const side = mat.figaroBlack;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r * 0.82, 0.22, 20),
      [side, mat.figaroRosette, side]);
    cap.position.set(x, baseY + h + 0.61, z);
    cap.castShadow = cap.receiveShadow = true;
    group.add(cap);
    const knob = put(new THREE.SphereGeometry(0.11, 12, 8), mat.figaroGold,
      x, baseY + h + 0.86, z, group);
    void knob;
  }

  /* ---- a hanging banner with its gold rod ---- */
  const bannerMeshes = [];
  function banner(x, y, z, m, w = 0.7, h = 1.3, rotY = 0, group = stage) {
    const q = put(new THREE.PlaneGeometry(w, h), m, x, y, z, group);
    q.rotation.y = rotY;
    bannerMeshes.push(q);
    const rod = b(w + 0.24, 0.07, 0.07, mat.figaroGold, x, y + h / 2 + 0.05, z, group, false);
    rod.rotation.y = rotY;
  }

  /* ---- a lit window with its glow ---- */
  function litWindow(x, y, z, w = 0.3, h = 0.44, group = stage) {
    put(new THREE.PlaneGeometry(w, h), mat.figaroWindow, x, y, z, group, false);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mat.figaroGlowTex, transparent: true, depthWrite: false, opacity: 0.7,
    }));
    glow.raycast = () => {};
    glow.scale.set(1.1, 1.1, 1);
    glow.position.set(x, y, z + 0.1);
    group.add(glow);
  }

  const gateTopY = top(map.gate.x[0] - 1, 1);          // the gatehouse wall top
  const plateauY = top(map.carpetX, map.ramp.high.z0); // where the party stands
  const parapetTopY = plateauY + (map.bands.parapet.h - map.bands.courtyards.h) * 0.3;

  /* ================= the keep and gatehouse (one occluder group) ============ */
  const keep = new THREE.Group();
  keep.name = 'figaro-keep';
  stage.add(keep);

  // The crowned central tower above the gate, as the sprite draws it.
  const keepTopY = top(0, 0);
  b(3.0, 2.4, 1.7, mat.figaroStone, cx, keepTopY + 1.2, 0.6, keep);
  b(3.4, 0.26, 2.0, mat.figaroCap, cx, keepTopY + 2.53, 0.6, keep);
  merlons(cx - 1.6, cx + 1.6, keepTopY + 2.66, -0.15, 0.34, mat.figaroWhite);
  merlons(cx - 1.6, cx + 1.6, keepTopY + 2.66, 1.35, 0.34, mat.figaroWhite);
  litWindow(cx, keepTopY + 1.7, 1.46, 0.36, 0.52, keep);
  // The crest rides high on the tower face, like the sprite's.
  put(new THREE.PlaneGeometry(1.0, 1.35), mat.figaroCrest, cx, keepTopY + 0.75, 1.47, keep, false);

  // The rosette towers flanking the keep, standing on the gatehouse.
  for (const t of map.anchors.backTowers)
    roundTower(t.x + 0.5, t.z + 0.5, 0.8, 2.2, gateTopY, keep);

  // The gate lintel: the passage is walkable underneath, the wall reads whole.
  b(3.4, 0.5, 2.1, mat.figaroStone, cx, gateTopY - 0.25, 2.0, keep);
  b(3.6, 0.18, 2.2, mat.figaroCap, cx, gateTopY + 0.05, 2.0, keep);

  // Battlements along the gatehouse lip and the blue house banners beside the gate.
  merlons(1.4, cx - 1.9, gateTopY + 0.05, 2.78);
  merlons(cx + 1.9, W - 1.4, gateTopY + 0.05, 2.78);
  banner(cx - 2.1, 1.45, 3.02, mat.figaroBanner, 0.7, 1.3, 0, keep);
  banner(cx + 2.1, 1.45, 3.02, mat.figaroBanner, 0.7, 1.3, 0, keep);
  litWindow(cx - 3.4, 1.75, 3.02, 0.3, 0.44, keep);
  litWindow(cx + 3.4, 1.75, 3.02, 0.3, 0.44, keep);

  registerBuildingOccluder(keep, 'figaro-keep');

  /* ================= curtain walls, parapets, cheeks ======================== */
  const curtainTopY = top(map.carpetX, map.ramp.high.z0)
    + (map.curtainWall.h - map.bands.courtyards.h) * 0.3;
  for (const wx of map.curtainWall.x) {
    const x = wx + 0.5;
    merlonsAlongZ(1.2, map.curtainWall.z1 + 0.6, curtainTopY, x + (wx === 0 ? 0.28 : -0.28), 0.36);
    // A crimson banner on each inner face, over the courtyard.
    banner(x + (wx === 0 ? 0.54 : -0.54), plateauY + 0.75, 6.0, mat.figaroBannerCrimson,
      0.66, 1.15, (wx === 0 ? 1 : -1) * Math.PI / 2);
  }

  // The terraces' south parapets, pierced only by the ladders.
  const ladderX = new Set(map.ladders.map(l => l.x));
  for (let x = 1; x < W - 1; x++) {
    if (map.ramp.x.includes(x) || map.ramp.cheekX.includes(x) || ladderX.has(x)) continue;
    if (x === 0 || x === W - 1) continue;
    merlons(x + 0.08, x + 0.92, parapetTopY, map.bands.parapet.z + 0.82, 0.3);
  }

  // The cheek walls that funnel the throat get a plain cap band.
  for (const wx of map.ramp.cheekX) {
    const y = plateauY + (map.ramp.cheekH - map.bands.courtyards.h) * 0.3;
    b(0.9, 0.14, 4.1, mat.figaroCap, wx + 0.5, y + 0.07, 8.0);
  }

  /* ================= the towers on their footprints ========================= */
  const gateTowers = new THREE.Group();
  gateTowers.name = 'figaro-gate-towers';
  stage.add(gateTowers);
  for (const t of map.towers.front)
    roundTower(t.x + 0.5, t.z + 0.5, 0.78, 1.5, top(t.x, t.z), gateTowers);
  registerBuildingOccluder(gateTowers, 'figaro-gate-towers');
  for (const t of map.towers.corner)
    roundTower(t.x + 0.5, t.z + 0.5, 0.7, 1.1, top(t.x, t.z));

  /* ================= the ladders the flankers climb ========================= */
  for (const l of map.ladders) {
    const x = l.x + 0.5, z = l.z + 0.98, y1 = plateauY + 0.16;
    for (const side of [-1, 1])
      b(0.06, y1, 0.08, mat.figaroGold, x + side * 0.2, y1 / 2, z, stage);
    for (let y = 0.14; y < y1; y += 0.22)
      b(0.46, 0.05, 0.09, mat.figaroGold, x, y, z, stage);
  }

  /* ================= the stage-two breach: portcullis and rubble ============ */
  const portcullis = new THREE.Group();
  portcullis.name = 'figaro-fallen-portcullis';
  stage.add(portcullis);
  for (let i = -2; i <= 2; i++)
    b(0.08, 1.9, 0.08, mat.figaroIron, i * 0.36, 0, 0, portcullis);
  for (let j = -1; j <= 1; j++)
    b(1.8, 0.08, 0.08, mat.figaroIron, 0, j * 0.6, 0, portcullis);
  portcullis.rotation.set(-Math.PI / 2.06, 0.14, 0);
  portcullis.position.set(cx + 0.2, top(map.carpetX, map.ramp.mid.z0) + 0.1, 7.4);
  const rubbleY = top(map.carpetX, map.ramp.mid.z0);
  for (const [dx, dz, s] of [[-0.9, -0.4, 0.42], [0.7, 0.2, 0.34], [-0.2, 0.5, 0.5]]) {
    const r = b(s, s * 0.6, s * 0.8, mat.figaroCap, cx + dx, rubbleY + s * 0.25, 6.4 + dz);
    r.rotation.set(dx, dz, dx * dz);
  }

  /* ================= the wrecked automaton line ============================= */
  const smokes = [];
  let spark = null;
  let wreckIndex = 0;
  for (const prop of map.props || []) {
    const x = prop.x + 0.5, z = prop.z + 0.5, y = top(prop.x, prop.z);
    if (prop.kind === 'wreck-cannonet') {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.z = prop.x < W / 2 ? 0.8 : -0.8;
      stage.add(g);
      b(0.8, 0.44, 0.6, mat.figaroBrass, 0, 0.3, 0, g);
      b(0.6, 0.12, 0.44, mat.figaroCopper, 0, 0.06, 0, g);
      const barrel = cyl(0.08, 0.6, mat.figaroBrass, 0, 0.34, 0.5, 10, g);
      barrel.rotation.x = Math.PI / 2;
      put(new THREE.SphereGeometry(0.17, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2),
        mat.figaroCopper, 0, 0.52, 0, g);
    } else {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.y = (prop.x * 0.7 + prop.z) % 1.2 - 0.6;
      stage.add(g);
      const body = b(0.52, 0.56, 0.4, mat.figaroBrass, 0, 0.24, 0.1, g);
      body.rotation.x = Math.PI / 2.1;                    // face-down in the sand
      b(0.14, 0.3, 0.17, mat.figaroCopper, -0.15, 0.2, -0.28, g).rotation.x = 1.2;
      b(0.14, 0.3, 0.17, mat.figaroCopper, 0.15, 0.22, -0.3, g).rotation.x = 1.4;
      put(new THREE.SphereGeometry(0.2, 14, 10), mat.figaroBrass, 0.42, 0.2, 0.5, g);
      // The wind-up key, stilled, pointing at the sky.
      const key = b(0.28, 0.08, 0.04, mat.figaroGold, 0, 0.52, 0.06, g);
      key.rotation.x = Math.PI / 2;
      if (wreckIndex === 1 || wreckIndex === 3) {
        const column = [];
        // Each puff clones the smoke material: the flicker loop animates every
        // puff's opacity independently, and a shared material would gang them.
        for (let i = 0; i < 3; i++)
          column.push(put(new THREE.SphereGeometry(0.09 + i * 0.04, 10, 8),
            mat.figaroSmoke.clone(), x, y + 0.7, z, stage, false));
        smokes.push({ column, x, y, z, phase: wreckIndex });
      }
      if (wreckIndex === 2) {
        spark = new THREE.Sprite(new THREE.SpriteMaterial({
          map: mat.figaroGlowTex, transparent: true, depthWrite: false,
        }));
        spark.raycast = () => {};
        spark.scale.set(0.7, 0.7, 1);
        spark.position.set(x, y + 0.5, z);
        stage.add(spark);
      }
      wreckIndex++;
    }
  }

  /* ================= torches and their warm lights ========================== */
  const torches = [], flames = [];
  function torch(x, y, z) {
    cyl(0.05, 0.9, mat.figaroBlack, x, y + 0.45, z, 8);
    cyl(0.11, 0.12, mat.figaroGold, x, y + 0.94, z, 8);
    const f = put(new THREE.SphereGeometry(0.12, 8, 6), mat.figaroFlame, x, y + 1.12, z, stage, false);
    flames.push(f);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mat.figaroGlowTex, transparent: true, depthWrite: false, opacity: 0.8,
    }));
    glow.raycast = () => {};
    glow.scale.set(1.4, 1.4, 1);
    glow.position.set(x, y + 1.16, z);
    stage.add(glow);
    torches.push(warmLight(x, y + 1.15, z, 2.2, 5.6, lights));
  }
  torch(cx - 2.0, 0, 10.7);
  torch(cx + 2.0, 0, 10.7);
  torch(cx - 1.4, plateauY, 3.3);
  torch(cx + 1.4, plateauY, 3.3);

  /* ================= per-frame life ========================================= */
  const base = torches.map(light => light.intensity);
  function flicker(time) {
    for (let i = 0; i < torches.length; i++) {
      const pulse = 0.92 + Math.sin(time * 10.7 + i * 1.9) * 0.1;
      torches[i].intensity = base[i] * pulse;
      flames[i].scale.setScalar(0.94 + pulse * 0.08);
    }
    for (const s of smokes) {
      for (let i = 0; i < s.column.length; i++) {
        const ph = (time * 0.35 + s.phase * 0.4 + i * 0.33) % 1;
        const puff = s.column[i];
        puff.position.set(s.x + Math.sin(ph * 7 + i) * 0.08, s.y + 0.55 + ph * 1.1, s.z);
        puff.material.opacity = 0.45 * (1 - ph);
      }
    }
    if (spark) spark.material.opacity = Math.sin(time * 23) > 0.2 ? 0.9 : 0.06;
    for (let i = 0; i < bannerMeshes.length; i++)
      bannerMeshes[i].rotation.z = Math.sin(time * 1.3 + i * 1.9) * 0.05;
  }
  return { group: stage, torches, flicker };
}
