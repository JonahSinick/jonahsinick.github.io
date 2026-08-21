/**
 * Playable battlefield adaptation of `triangle-diorama.html`.
 * Its castle grammar, proportions, palette roles and ornament come from that
 * standalone composition; only the courtyard has been stretched to hold play.
 */
export function createFigaroDioramaBattlefield(c) {
  const {
    THREE, world, box, mat, tileTop, warmLight, lights, map, W,
    registerBuildingOccluder,
  } = c;
  const stage = new THREE.Group();
  stage.name = 'figaro-diorama-battlefield';
  world.add(stage);

  const M = {
    ash: mat.figaroStone,
    ashDark: mat.figaroCap,
    cobble: mat.cobble,
    iron: mat.figaroIron,
    ironLight: mat.figaroIronLt,
    blue: mat.figaroBanner,
    crimson: mat.figaroBannerCrimson || mat.carpet,
    gold: mat.figaroGold || mat.figaroFringe,
    sand: mat.sand,
    wood: mat.figaroTimber,
    green: mat.figaroGreen,
    dark: mat.figaroDark,
    flame: mat.figaroFlame,
  };
  const top = (x, z) => tileTop[z]?.[x] ?? 0;
  const floor = top(map.carpetX, map.bands.courtyard.z0);
  const terrace = top(map.carpetX, map.bands.terrace.z0);
  const curtain = top(0, map.bands.courtyard.z0);
  const cx = W / 2;
  const objects = [];

  function b(w, h, d, material, x, y, z, group = stage, shadow = true) {
    const q = box(w, h, d, material, x, y, z, { group, shadow });
    objects.push(q);
    return q;
  }
  function put(geometry, material, x, y, z, group = stage, shadow = true) {
    const q = new THREE.Mesh(geometry, material);
    q.position.set(x, y, z);
    q.castShadow = q.receiveShadow = shadow;
    group.add(q);
    objects.push(q);
    return q;
  }
  const cyl = (r, h, material, x, y, z, sides = 16, group = stage) =>
    put(new THREE.CylinderGeometry(r, r, h, sides), material, x, y, z, group);

  function masonryWall(x, y, z, width, height, depth, group = stage) {
    b(width, height, depth, M.ash, x, y + height / 2, z, group);
    for (let yy = 0.48; yy < height - 0.12; yy += 0.58)
      b(width + 0.035, 0.045, depth + 0.035, M.ashDark, x, y + yy, z, group);
    b(width + 0.18, 0.16, depth + 0.14, M.ash, x, y + height + 0.08, z, group);
  }

  function merlons(x0, x1, y, z, count, depth = 0.52, group = stage) {
    for (let i = 0; i < count; i++) if (i % 2 === 0)
      b((x1 - x0) / count * 0.82, 0.62, depth, M.ash,
        x0 + (i + 0.5) * (x1 - x0) / count, y + 0.31, z, group);
  }

  function tower(x, z, base, height = 5.7, radius = 1.35, group = stage) {
    cyl(radius, height, M.ash, x, base + height / 2, z, 20, group);
    for (let yy = 0.58; yy < height; yy += 0.64)
      cyl(radius + 0.025, 0.055, M.ashDark, x, base + yy, z, 20, group);
    cyl(radius + 0.2, 0.3, M.ash, x, base + height + 0.15, z, 20, group);
    cyl(radius + 0.05, 0.46, M.ashDark, x, base + height + 0.47, z, 20, group);
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      const q = b(0.5, 0.64, 0.42, M.ash,
        x + Math.cos(a) * (radius - 0.04), base + height + 0.79,
        z + Math.sin(a) * (radius - 0.04), group);
      q.rotation.y = -a;
    }
    cyl(0.1, 0.72, M.gold, x, base + height + 1.5, z, 8, group);
    cyl(0.17, 0.14, M.gold, x, base + height + 1.88, z, 10, group);
  }

  function archGate(x, y, z, width, height, group = stage, raised = false) {
    b(width, height, 0.78, M.ashDark, x, y + height / 2, z, group);
    const radius = width * 0.34;
    b(width * 0.23, height * 0.75, 0.84, M.ash,
      x - width * 0.385, y + height * 0.375, z - 0.03, group);
    b(width * 0.23, height * 0.75, 0.84, M.ash,
      x + width * 0.385, y + height * 0.375, z - 0.03, group);
    for (let i = 0; i < 11; i++) {
      const a = Math.PI * i / 10;
      const q = b(0.38, 0.52, 0.88, M.ash,
        x + Math.cos(a) * radius, y + height * 0.64 + Math.sin(a) * radius,
        z - 0.05, group);
      q.rotation.z = a - Math.PI / 2;
    }
    const gateBottom = raised ? y + height * 0.57 : y;
    for (let i = -4; i <= 4; i++)
      b(0.085, height * 0.64, 0.12, M.ironLight,
        x + i * width * 0.065, gateBottom + height * 0.32, z - 0.46, group);
    for (let j = 0; j < 4; j++)
      b(width * 0.58, 0.08, 0.13, M.iron, x,
        gateBottom + height * (0.1 + j * 0.15), z - 0.46, group);
  }

  function banner(x, y, z, material, scale = 0.72, group = stage) {
    b(1.22 * scale, 2.2 * scale, 0.045, material,
      x, y - 1.1 * scale, z, group, false);
    b(1.34 * scale, 0.12 * scale, 0.08, M.crimson, x, y + 0.05, z, group, false);
    b(1.48 * scale, 0.055, 0.08, M.gold, x, y + 0.18, z, group);
    for (const side of [-1, 1])
      b(0.05, 2.05 * scale, 0.06, M.gold,
        x + side * 0.57 * scale, y - 1.06 * scale, z - 0.04, group);
    const crest = b(0.5 * scale, 0.5 * scale, 0.055, M.gold,
      x, y - 1.08 * scale, z - 0.06, group);
    crest.rotation.z = Math.PI / 4;
  }

  const torches = [], flames = [];
  function torch(x, y, z) {
    cyl(0.055, 1.15, M.iron, x, y + 0.57, z, 8);
    cyl(0.18, 0.15, M.gold, x, y + 1.2, z, 8);
    const f = put(new THREE.SphereGeometry(0.14, 8, 6), M.flame, x, y + 1.41, z, stage, false);
    flames.push(f);
    torches.push(warmLight(x, y + 1.42, z, 2.2, 5.6, lights));
  }

  // Sandstone display plinth and the broad court from the standalone diorama.
  b(W + 5.5, 0.55, map.grid.depth + 5.5, M.sand,
    cx, floor - 0.48, map.grid.depth / 2, stage, false);

  // North inner gate and the tiered crown rising behind it.
  const keep = new THREE.Group();
  keep.name = 'figaro-diorama-keep';
  stage.add(keep);
  masonryWall(cx, terrace, 0.55, 14.2, 4.7, 1.25, keep);
  archGate(cx, terrace, 1.18, 3.7, 3.8, keep, false);
  tower(2.15, 0.72, terrace, 6.15, 1.32, keep);
  tower(W - 2.15, 0.72, terrace, 6.15, 1.32, keep);
  merlons(3.7, W - 3.7, terrace + 5.02, 0.96, 14, 0.66, keep);

  b(10.2, 3.0, 4.4, M.ash, cx, terrace + 6.15, -1.72, keep);
  b(8.45, 0.22, 4.7, M.ashDark, cx, terrace + 7.74, -1.72, keep);
  b(8.0, 2.15, 3.5, M.ash, cx, terrace + 8.88, -1.86, keep);
  b(6.35, 0.2, 3.75, M.ashDark, cx, terrace + 10.05, -1.86, keep);
  b(5.6, 1.65, 2.7, M.ash, cx, terrace + 10.88, -1.98, keep);
  merlons(cx - 2.65, cx + 2.65, terrace + 11.98, -1.58, 8, 0.7, keep);
  tower(cx - 4.7, -1.72, terrace + 3.0, 7.15, 1.24, keep);
  tower(cx + 4.7, -1.72, terrace + 3.0, 7.15, 1.24, keep);
  cyl(0.18, 1.1, M.gold, cx, terrace + 12.92, -1.98, 8, keep);
  registerBuildingOccluder(keep, 'figaro-diorama-keep');

  banner(cx - 3.35, terrace + 4.35, 1.22, M.crimson, 0.72, keep);
  banner(cx + 3.35, terrace + 4.35, 1.22, M.blue, 0.72, keep);

  // Long, readable curtain walls. Their spacing and rounded relays are the
  // standalone castle's entryway corridor stretched into a tactical arena.
  for (const x of [0.52, W - 0.52]) {
    b(1.04, 2.72, 12.0, M.ash, x, floor + 1.36, 10.5);
    b(1.2, 0.15, 12.15, M.ashDark, x, floor + 2.78, 10.5);
    for (let z = 5.0; z <= 16.0; z += 1.35)
      b(0.58, 0.58, 0.52, M.ash, x, floor + 3.18, z);
  }
  for (const z of [6.3, 11.1, 15.1]) {
    tower(0.45, z, floor, 4.35, 0.88);
    tower(W - 0.45, z, floor, 4.35, 0.88);
  }

  // South gatehouse mirrors the standalone's paired round entrance towers.
  const gate = new THREE.Group();
  gate.name = 'figaro-diorama-gatehouse';
  stage.add(gate);
  masonryWall(cx, floor, 17.48, 14.8, 5.1, 1.25, gate);
  archGate(cx, floor, 16.84, 4.2, 4.2, gate, true);
  tower(2.6, 17.35, floor, 5.7, 1.36, gate);
  tower(W - 2.6, 17.35, floor, 5.7, 1.36, gate);
  merlons(4.45, W - 4.45, floor + 5.22, 17.05, 12, 0.66, gate);
  registerBuildingOccluder(gate, 'figaro-diorama-gatehouse');

  // Crimson axis and lamps reproduce the standalone entryway composition.
  for (const x of [cx - 0.68, cx + 0.68])
    b(0.055, 0.008, 12.2, M.gold, x, floor + 0.013, 10.8, stage, false);
  for (const p of [
    [cx - 3.0, floor, 6.2], [cx + 3.0, floor, 6.2],
    [cx - 4.0, floor, 12.6], [cx + 4.0, floor, 12.6],
    [cx - 2.55, terrace, 2.05], [cx + 2.55, terrace, 2.05],
  ]) torch(...p);

  // Map-authored cover remains the only scenery that blocks movement.
  for (const prop of map.props || []) {
    const x = prop.x + 0.5, z = prop.z + 0.5, y = top(prop.x, prop.z);
    if (prop.kind === 'barrel') {
      cyl(0.27, 0.62, M.wood, x, y + 0.31, z, 12);
      for (const dy of [0.12, 0.5]) cyl(0.29, 0.055, M.iron, x, y + dy, z, 12);
    } else {
      const crate = b(0.68, 0.62, 0.68, M.wood, x, y + 0.31, z);
      crate.rotation.y = (prop.x * 0.37 + prop.z * 0.19) % 0.62;
      for (const dy of [0.12, 0.5]) {
        const band = b(0.72, 0.07, 0.72, M.iron, x, y + dy, z, stage, false);
        band.rotation.y = crate.rotation.y;
      }
    }
  }

  const base = torches.map(light => light.intensity);
  function flicker(time) {
    for (let i = 0; i < torches.length; i++) {
      const pulse = 0.92 + Math.sin(time * 10.7 + i * 1.9) * 0.1;
      torches[i].intensity = base[i] * pulse;
      flames[i].scale.setScalar(0.94 + pulse * 0.08);
    }
  }
  return { group: stage, torches, flicker };
}
