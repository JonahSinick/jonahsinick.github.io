/**
 * Original Figaro battle scenery.
 *
 * This is a clean-room composition built for the enlarged battle board. It
 * deliberately shares only the battle scene's small construction contract;
 * no geometry or placement is inherited from the earlier Figaro renderer.
 */

const REQUIRED = [
  'THREE', 'world', 'box', 'mat', 'HU', 'topThick', 'tileTop', 'warmLight',
  'lights', 'map', 'W', 'D', 'registerBuildingOccluder',
];

export function createFigaroOriginalScenery(context) {
  const missing = REQUIRED.filter(key => context[key] == null);
  if (missing.length) throw new Error(`original Figaro scenery missing: ${missing.join(', ')}`);

  const {
    THREE, world, box, mat, tileTop, warmLight, lights, map, W, D,
    registerBuildingOccluder,
  } = context;
  const root = new THREE.Group();
  root.name = 'figaro-original-citadel';
  world.add(root);

  const stone = mat.figaroStone || mat.stone;
  const towerStone = mat.figaroTowerStone || stone;
  const trim = mat.figaroAshlar || mat.figaroCap || stone;
  const cap = mat.figaroCap || trim;
  const iron = mat.figaroIron || mat.iron;
  const brightIron = mat.figaroIronLt || iron;
  const dark = mat.figaroDark || mat.dark;
  const timber = mat.figaroTimber || mat.woodDk;
  const banner = mat.figaroBanner || mat.carpet;
  const fringe = mat.figaroFringe || mat.carpet;
  const flameMat = mat.figaroFlame || mat.lampGlass;
  const carpet = mat.carpet;

  const top = (x, z) => tileTop[z]?.[x] ?? 0;
  const floorY = top(map.carpetX, map.bands.courtyard.z0);
  const terraceY = top(map.carpetX, map.bands.terrace.z0);
  const curtainY = top(0, map.bands.courtyard.z0);
  const gateY = top(0, map.bands.gatehouse.z);
  const cx = W / 2;

  function mesh(geometry, material, x, y, z, parent = root, shadow = true) {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.castShadow = shadow;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }

  function block(w, h, d, material, x, y, z, parent = root, shadow = true) {
    return box(w, h, d, material, x, y, z, { group: parent, shadow });
  }

  function ring(radius, y, z, material, parent, count = 12) {
    for (let i = 0; i < count; i++) {
      const a = i / count * Math.PI * 2;
      const merlon = block(0.28, 0.3, 0.24, material,
        Math.cos(a) * radius, y + 0.15, z + Math.sin(a) * radius, parent);
      merlon.rotation.y = -a;
    }
  }

  function slit(parent, radius, y, angle) {
    const s = block(0.11, 0.48, 0.06, dark,
      Math.cos(angle) * (radius + 0.015), y, Math.sin(angle) * (radius + 0.015), parent, false);
    s.rotation.y = Math.PI / 2 - angle;
  }

  /** Layered cylindrical tower, the recurring shape that gives Figaro its silhouette. */
  function drumTower({ x, z, base, height, radius, crown = true, standards = false }) {
    const g = new THREE.Group();
    g.position.set(x, base, z);
    root.add(g);
    mesh(new THREE.CylinderGeometry(radius * 0.86, radius, height, 24, 3), towerStone,
      0, height / 2, 0, g);
    mesh(new THREE.CylinderGeometry(radius * 1.04, radius * 1.04, 0.13, 24), trim,
      0, height * 0.27, 0, g);
    mesh(new THREE.CylinderGeometry(radius * 1.07, radius * 1.07, 0.16, 24), trim,
      0, height * 0.73, 0, g);
    mesh(new THREE.CylinderGeometry(radius * 1.1, radius * 1.1, 0.16, 24), cap,
      0, height, 0, g);
    for (const angle of [0.25 * Math.PI, 0.75 * Math.PI, 1.25 * Math.PI, 1.75 * Math.PI])
      slit(g, radius * 0.9, height * 0.53, angle);
    if (crown) ring(radius * 0.91, height + 0.02, 0, stone, g, 12);
    if (standards) {
      block(0.045, 0.9, 0.045, brightIron, 0, height + 0.72, 0, g);
      const pennant = block(0.52, 0.32, 0.035, banner, 0.27, height + 0.94, 0, g, false);
      pennant.rotation.y = 0.08;
    }
    registerBuildingOccluder(g, 'figaro-original-tower');
    return g;
  }

  function crenellatedLine(x0, x1, y, z, parent = root, spacing = 0.78) {
    const count = Math.max(1, Math.floor((x1 - x0) / spacing));
    for (let i = 0; i <= count; i++) {
      const x = x0 + (x1 - x0) * (i / count);
      block(0.42, 0.3, 0.42, stone, x, y + 0.15, z, parent);
      block(0.48, 0.05, 0.48, cap, x, y + 0.325, z, parent);
    }
  }

  // ---------------------------------------------------------------- citadel
  // The keep is built behind the playable north edge as a stepped, symmetrical
  // mass. From the battle camera it reads as an entire fortress, not a wall
  // with decoration attached to it.
  const citadel = new THREE.Group();
  citadel.name = 'figaro-citadel';
  root.add(citadel);
  const keepBase = terraceY;

  block(11.8, 2.6, 2.5, stone, cx, keepBase + 1.3, -0.18, citadel);
  block(8.0, 1.35, 2.8, towerStone, cx, keepBase + 3.15, -0.38, citadel);
  block(4.25, 1.45, 3.0, stone, cx, keepBase + 4.55, -0.58, citadel);
  block(4.55, 0.15, 3.2, cap, cx, keepBase + 5.28, -0.58, citadel);
  crenellatedLine(cx - 2.0, cx + 2.0, keepBase + 5.36, 0.75, citadel, 0.66);
  crenellatedLine(cx - 5.65, cx + 5.65, keepBase + 2.64, 0.86, citadel, 0.8);

  // Broad stepped shoulders and four towers reproduce Figaro's distinctive
  // nesting: gate, court, upper keep, then central crown.
  drumTower({ x: cx - 4.55, z: 0.12, base: keepBase, height: 4.0, radius: 0.92 });
  drumTower({ x: cx + 4.55, z: 0.12, base: keepBase, height: 4.0, radius: 0.92 });
  drumTower({ x: cx - 2.25, z: -0.5, base: keepBase, height: 5.25, radius: 0.72 });
  drumTower({ x: cx + 2.25, z: -0.5, base: keepBase, height: 5.25, radius: 0.72 });

  // Recessed ceremonial door and ironwork, centred on the battle's carpet.
  block(2.2, 2.25, 0.3, dark, cx, keepBase + 1.12, 1.02, citadel, false);
  for (let i = -4; i <= 4; i++)
    block(0.075, 2.08, 0.08, iron, cx + i * 0.23, keepBase + 1.05, 1.2, citadel);
  for (const y of [0.24, 0.72, 1.2, 1.68])
    block(2.08, 0.07, 0.09, brightIron, cx, keepBase + y, 1.22, citadel);
  for (const side of [-1, 1]) {
    block(0.38, 2.75, 0.48, trim, cx + side * 1.35, keepBase + 1.38, 1.05, citadel);
    block(1.5, 2.25, 0.045, banner, cx + side * 3.05, keepBase + 2.72, 1.17, citadel, false);
    block(1.66, 0.12, 0.12, fringe, cx + side * 3.05, keepBase + 3.9, 1.18, citadel, false);
  }
  registerBuildingOccluder(citadel, 'figaro-original-citadel');

  // Rows of deep windows make the facade read at battle-camera distance.
  for (const y of [keepBase + 3.05, keepBase + 4.34]) {
    for (const side of [-1, 1]) {
      block(0.24, 0.62, 0.06, dark, cx + side * (y > keepBase + 4 ? 1.08 : 2.9), y, 1.05, citadel, false);
      block(0.36, 0.1, 0.09, trim, cx + side * (y > keepBase + 4 ? 1.08 : 2.9), y + 0.36, 1.08, citadel);
    }
  }

  // ---------------------------------------------------------------- curtain walks
  // Low enough to preserve tactical legibility, but rhythmic towers and dressed
  // bands make the long sides feel like castle wings rather than board borders.
  for (const side of [0, W]) {
    const inward = side === 0 ? 1 : -1;
    for (let z = map.bands.courtyard.z0; z <= map.bands.courtyard.z1; z += 1.25) {
      block(0.38, 0.3, 0.42, stone, side + inward * 0.34, curtainY + 0.15, z + 0.5);
    }
    for (const z of [6.5, 11.0, 15.0]) {
      const h = 2.35;
      const g = new THREE.Group();
      g.position.set(side === 0 ? 0.58 : W - 0.58, floorY, z);
      root.add(g);
      mesh(new THREE.CylinderGeometry(0.56, 0.7, h, 18), towerStone, 0, h / 2, 0, g);
      mesh(new THREE.CylinderGeometry(0.74, 0.74, 0.12, 18), trim, 0, h, 0, g);
      ring(0.59, h + 0.01, 0, stone, g, 8);
    }
  }

  // ---------------------------------------------------------------- southern barbican
  // A deep, four-tower gate complex closes the far end. The gate is open—the
  // attackers are entering through it—so the focal point remains playable.
  const gateZ = map.bands.gatehouse.z + 0.5;
  const gate = new THREE.Group();
  gate.name = 'figaro-barbican';
  root.add(gate);
  block(5.0, 3.2, 1.5, stone, 3.0, floorY + 1.6, gateZ, gate);
  block(5.0, 3.2, 1.5, stone, W - 3.0, floorY + 1.6, gateZ, gate);
  block(3.1, 1.15, 1.65, towerStone, cx, floorY + 2.63, gateZ, gate);
  block(3.45, 0.14, 1.85, cap, cx, floorY + 3.25, gateZ, gate);
  crenellatedLine(0.7, 6.0, floorY + 3.22, gateZ - 0.55, gate, 0.72);
  crenellatedLine(W - 6.0, W - 0.7, floorY + 3.22, gateZ - 0.55, gate, 0.72);
  crenellatedLine(cx - 1.45, cx + 1.45, floorY + 3.28, gateZ - 0.62, gate, 0.66);

  for (const x of [2.2, 4.25, W - 4.25, W - 2.2])
    drumTower({ x, z: gateZ, base: floorY, height: 4.15, radius: 0.78, standards: x === 2.2 || x === W - 2.2 });

  // Open portcullis suspended above the breach: visible iron teeth, clear floor.
  for (let i = -5; i <= 5; i++) {
    const bar = block(0.065, 1.72, 0.07, brightIron, cx + i * 0.25,
      floorY + 2.25, gateZ - 0.84, gate);
    bar.rotation.z = i % 2 ? 0.01 : -0.01;
  }
  block(2.7, 0.09, 0.1, iron, cx, floorY + 1.72, gateZ - 0.84, gate);
  block(2.7, 0.09, 0.1, iron, cx, floorY + 2.48, gateZ - 0.84, gate);
  registerBuildingOccluder(gate, 'figaro-original-barbican');

  // ---------------------------------------------------------------- courtyard ornament
  // A restrained ceremonial axis: carpet borders, two standards and braziers.
  for (const x of [map.carpetX + 0.08, map.carpetX + 0.92])
    block(0.055, 0.008, 11.7, fringe, x, floorY + 0.013, 10.9, root, false);

  const torches = [];
  const flames = [];
  function brazier(x, z, y = floorY) {
    block(0.08, 0.7, 0.08, iron, x, y + 0.35, z);
    mesh(new THREE.CylinderGeometry(0.31, 0.2, 0.2, 10), iron, x, y + 0.75, z);
    const flame = mesh(new THREE.ConeGeometry(0.17, 0.42, 9), flameMat, x, y + 1.02, z, root, false);
    flames.push(flame);
    torches.push(warmLight(x, y + 1.05, z, 2.8, 6.5, lights));
  }
  for (const z of [6.4, 12.7]) for (const x of [cx - 2.25, cx + 2.25]) brazier(x, z);
  for (const x of [cx - 1.45, cx + 1.45]) brazier(x, 1.38, terraceY);

  // Battle cover belongs to map data. This module only gives it a new visual.
  for (const prop of map.props || []) {
    const x = prop.x + 0.5, z = prop.z + 0.5, y = top(prop.x, prop.z);
    if (prop.kind === 'barrel') {
      mesh(new THREE.CylinderGeometry(0.29, 0.25, 0.62, 14), timber, x, y + 0.31, z);
      for (const dy of [0.11, 0.51])
        mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.055, 14), iron, x, y + dy, z, root, false);
    } else {
      const crate = block(0.68, 0.62, 0.68, timber, x, y + 0.31, z);
      crate.rotation.y = (prop.x * 0.31 + prop.z * 0.17) % 0.55;
      block(0.73, 0.075, 0.73, iron, x, y + 0.12, z, root, false).rotation.y = crate.rotation.y;
      block(0.73, 0.075, 0.73, iron, x, y + 0.5, z, root, false).rotation.y = crate.rotation.y;
    }
  }

  const baseIntensity = torches.map(light => light.intensity);
  function flicker(time) {
    for (let i = 0; i < torches.length; i++) {
      const pulse = 0.9 + Math.sin(time * 8.1 + i * 1.7) * 0.07
        + Math.sin(time * 19.3 + i * 4.2) * 0.03;
      torches[i].intensity = baseIntensity[i] * pulse;
      flames[i].scale.set(0.92 + pulse * 0.09, 0.78 + pulse * 0.28, 0.92 + pulse * 0.09);
    }
  }

  return { group: root, torches, flicker };
}
