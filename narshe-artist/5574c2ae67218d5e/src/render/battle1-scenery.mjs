/**
 * Battle 1 static scenery — the rugged buildings, mine entrance, headframe,
 * timber/ore piles, watch post, lamps, pines, boulders, and crates/barrels/
 * fences that dress the terraced invasion ravine.
 *
 * Everything here is one-way mesh construction against the shared battle
 * `world` group: nothing it builds is read back except the headframe's
 * hoist wheel (spun every frame by the page's render loop) and the smoke
 * puffs a chimney registers into the page's own per-frame list. Building
 * occlusion (the visibility-gate mechanic that ghosts a roof between the
 * camera and a unit standing behind it) stays page state — it's a generic
 * per-frame system keyed on camera/units that happens to read the buildings
 * this module registers into it, not a scenery concern itself — so
 * `registerBuildingOccluder` arrives as context rather than moving here.
 *
 * None of this runs for the warning-bell gallery (`warbell` gates every
 * call site exactly as the inline code did): that battle dresses itself
 * through `src/render/terrain-kit.mjs` and its own terrain skin instead.
 *
 * THREE and the page's construction primitives arrive through one explicit
 * context object, matching `cliffs-opening.mjs`/`mine-finale.mjs`, so this
 * stays constructible from Node with a stub.
 */

const CONTEXT_FIELDS = [
  'THREE',                    // scene graph constructors (injected, never imported)
  'world',                    // the battle floor's THREE.Group every prop joins
  'box',                      // (w,h,d,mat,x,y,z,{shadow,group}) -> kit-geometry mesh
  'mat',                      // the shared Battle-1 materials dict
  'HU',                       // one height unit
  'topThick',                 // world-space thickness of a tile's top slab
  'blockTiles',                // (x0,z0,x1,z1) -> mark tiles occupied by scenery
  'warmLight',                 // (x,y,z,intensity,dist,bucket) -> lit-window PointLight
  'warbell',                   // WARBELL: none of this dresses the gallery battle
  'mulberry',                  // seeded PRNG, for ore-pile/pine/boulder jitter
  'hash',                      // deterministic jitter, for pine/crate placement
  'H',                         // terrain height grid, for ground-height lookups
  'T',                         // terrain tile-type grid, for boulder's rock check
  'W',                         // grid width, for clamping a prop's cell lookup
  'D',                         // grid depth, unused directly but kept with W for parity
  'rockTile',                  // the ROCK tile-type enum value
  'registerBuildingOccluder', // (group, name) -> enrolls a building in the visibility gate
  'smokeStacks',               // the page's per-frame chimney-smoke animation list
];

export function createBattle1Scenery(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('battle1 scenery: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, world, box, mat, HU, topThick, blockTiles, warmLight, warbell,
    mulberry, hash, H, T, W, D, rockTile, registerBuildingOccluder, smokeStacks,
  } = context;

  // ---------------------------------------------------------------- rugged buildings
  function cabin(cx, baseH, cz, { w = 2.6, d = 2.0, wallH = 0.95, roofH = 0.75, rotY = 0, windows = 2, chimney = true, shed = false } = {}) {
    const g = new THREE.Group();
    // rough stone footing
    box(w + 0.16, 0.26, d + 0.16, mat.stone, 0, 0.13, 0, { group: g });
    // plank walls
    box(w, wallH, d, mat.plank, 0, 0.26 + wallH / 2, 0, { group: g });
    // heavy corner posts + sill/top beams
    const py = 0.26 + wallH / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      box(0.14, wallH, 0.14, mat.beam, sx * (w / 2 - 0.02), py, sz * (d / 2 - 0.02), { group: g });
    box(w + 0.06, 0.1, d + 0.06, mat.beam, 0, 0.26 + wallH - 0.04, 0, { group: g });
    const ry = 0.26 + wallH;
    if (shed) {
      // single-slope shed roof, high side at -x
      const slope = Math.hypot(roofH, w + 0.4);
      const ang = Math.atan2(roofH, w + 0.4);
      const plane = box(slope, 0.08, d + 0.45, mat.plankDk, 0, ry + roofH / 2, 0, { group: g });
      plane.rotation.z = ang;
      const snowP = box(slope * 0.98, 0.09, d + 0.5, mat.snow, 0, ry + roofH / 2 + 0.08, 0, { group: g });
      snowP.rotation.z = ang;
    } else {
      const slope = Math.hypot(roofH, w / 2 + 0.22);
      const ang = Math.atan2(roofH, w / 2 + 0.11);
      for (const s of [-1, 1]) {
        const plane = box(slope, 0.08, d + 0.5, mat.plankDk, s * (w / 4 + 0.05), ry + roofH / 2, 0, { group: g });
        plane.rotation.z = -s * ang;
        const snowP = box(slope * 0.98, 0.09, d + 0.56, mat.snow, s * (w / 4 + 0.05), ry + roofH / 2 + 0.08, 0, { group: g });
        snowP.rotation.z = -s * ang;
      }
      box(0.2, 0.12, d + 0.6, mat.snow, 0, ry + roofH + 0.05, 0, { group: g });
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(0, roofH); shape.closePath();
      const triGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false });
      for (const sz of [-1, 1]) {
        const tri = new THREE.Mesh(triGeo, mat.plank);
        tri.position.set(0, ry, sz * (d / 2 - 0.04) - 0.04);
        tri.castShadow = true; tri.receiveShadow = true;
        g.add(tri);
      }
    }
    // plank door + small dim windows
    box(0.44, 0.6, 0.06, mat.plankDk, w * 0.2, 0.26 + 0.3, d / 2 + 0.02, { group: g, shadow: false });
    for (let i = 0; i < windows; i++) {
      const wx = -w / 2 + (i + 0.75) * (w / (windows + 0.5));
      box(0.26, 0.26, 0.04, mat.window, wx - w * 0.12, 0.26 + wallH * 0.55, d / 2 + 0.03, { group: g, shadow: false });
      // rough shutters
      box(0.07, 0.3, 0.03, mat.woodDk, wx - w * 0.12 - 0.19, 0.26 + wallH * 0.55, d / 2 + 0.03, { group: g, shadow: false });
      box(0.07, 0.3, 0.03, mat.woodDk, wx - w * 0.12 + 0.19, 0.26 + wallH * 0.55, d / 2 + 0.03, { group: g, shadow: false });
    }
    if (chimney) {
      box(0.32, roofH + 0.75, 0.32, mat.stone, -w * 0.3, ry + (roofH + 0.75) / 2 - 0.1, -d * 0.16, { group: g });
      const sm = new THREE.Group();
      sm.position.set(-w * 0.3, ry + roofH + 0.68, -d * 0.16);
      for (let i = 0; i < 4; i++) {
        const puff = new THREE.Mesh(new THREE.SphereGeometry(0.11 + i * 0.035, 8, 6), mat.smoke.clone());
        puff.position.y = i * 0.3; sm.add(puff);
      }
      g.add(sm); smokeStacks.push(sm);
    }
    g.position.set(cx, baseH * HU, cz);
    g.rotation.y = rotY;
    world.add(g);
    registerBuildingOccluder(g, shed ? 'storehouse' : 'bunkhouse');
    return g;
  }

  if (!warbell) {
    // bunkhouse on terrace 1 (long, low, rugged) — east side
    cabin(8.5, 2, 11.5, { w: 1.9, d: 2.5, rotY: Math.PI / 2, windows: 2 });
    blockTiles(7, 10, 9, 12);
    warmLight(8.5, 2 * HU + 0.9, 10.6);
    // storehouse on terrace 2 (shed roof, no chimney) — west side
    cabin(3.0, 4, 7.0, { w: 1.8, d: 2.0, rotY: -Math.PI / 2, windows: 1, chimney: false, shed: true });
    blockTiles(2, 6, 3, 7);
    warmLight(4.1, 4 * HU + 0.9, 7.0);
  }

  // ---------------------------------------------------------------- mine entrance in the great cliff
  if (!warbell) {
    const mx = 5.5, my = 6 * HU, mz = 2.04;
    box(1.6, 1.5, 0.1, mat.dark, mx, my + 0.72, mz + 0.02, { shadow: false });
    box(0.2, 1.7, 0.24, mat.beam, mx - 0.88, my + 0.85, mz + 0.06);
    box(0.2, 1.7, 0.24, mat.beam, mx + 0.88, my + 0.85, mz + 0.06);
    box(2.15, 0.22, 0.28, mat.beam, mx, my + 1.72, mz + 0.06);
    box(1.85, 0.15, 0.24, mat.plankDk, mx, my + 1.97, mz + 0.05);
    // secondary bracing
    box(0.14, 1.4, 0.18, mat.woodDk, mx - 0.55, my + 0.7, mz + 0.05);
    box(0.14, 1.4, 0.18, mat.woodDk, mx + 0.55, my + 0.7, mz + 0.05);
    box(0.16, 0.2, 0.16, mat.lampGlass, mx, my + 1.5, mz + 0.18, { shadow: false });
    warmLight(mx, my + 1.45, mz + 0.5, 2.2, 4.5);
    // rails out of the mine, across the yard
    const railY = my + topThick;
    for (const rx of [mx - 0.3, mx + 0.3]) box(0.07, 0.05, 2.6, mat.iron, rx, railY + 0.05, 3.4);
    for (let i = 0; i < 5; i++) box(0.8, 0.05, 0.12, mat.woodDk, mx, railY + 0.02, 2.35 + i * 0.5);
    box(0.8, 0.3, 0.12, mat.beam, mx, railY + 0.2, 4.65);
    const cart = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.4, 0.8), mat.iron); body.castShadow = true;
    const ore1 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16), mat.ore); ore1.position.set(-0.1, 0.22, 0.1);
    const ore2 = new THREE.Mesh(new THREE.DodecahedronGeometry(0.13), mat.ore); ore2.position.set(0.13, 0.2, -0.15);
    cart.add(body, ore1, ore2);
    cart.position.set(mx, railY + 0.3, 3.4);
    world.add(cart);
    blockTiles(5, 3, 5, 3);                    // the ore cart blocks its road tile
  }

  // ---------------------------------------------------------------- headframe over the shaft (terrace 4)
  const hoistWheel = new THREE.Group();
  if (!warbell) {
    const hx = 8.5, hy = 6 * HU, hz = 3.5;
    const g = new THREE.Group();
    const legH = 2.5, spread = 0.75, top = 0.16;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = box(0.13, legH, 0.13, mat.beam, 0, 0, 0, { group: g });
      leg.position.set(sx * (spread + top) / 2, legH / 2, sz * (spread + top) / 2);
      leg.rotation.z = sx * Math.atan2(spread - top, legH) * 0.5;
      leg.rotation.x = -sz * Math.atan2(spread - top, legH) * 0.5;
    }
    // cross braces
    for (const sz of [-1, 1]) {
      const b1 = box(1.15, 0.09, 0.09, mat.woodDk, 0, legH * 0.38, sz * spread * 0.62, { group: g });
      b1.rotation.z = 0.5;
      const b2 = box(1.15, 0.09, 0.09, mat.woodDk, 0, legH * 0.38, sz * spread * 0.62, { group: g });
      b2.rotation.z = -0.5;
    }
    box(0.9, 0.09, 0.9, mat.woodDk, 0, legH * 0.75, 0, { group: g });
    // hoist wheel at the apex
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.05, 8, 18), mat.iron);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.72, 0.05), mat.iron);
      spoke.rotation.z = i * Math.PI / 4; hoistWheel.add(spoke);
    }
    hoistWheel.add(rim);
    hoistWheel.position.set(0, legH + 0.32, 0);
    hoistWheel.traverse(o => { if (o.isMesh) o.castShadow = true; });
    g.add(hoistWheel);
    // cable down into the shaft
    box(0.03, legH + 0.3, 0.03, mat.iron, 0, (legH + 0.3) / 2, 0, { group: g, shadow: false });
    // shaft mouth: dark pit with timber curb
    box(0.85, 0.1, 0.85, mat.dark, 0, 0.06, 0, { group: g, shadow: false });
    box(1.05, 0.12, 0.14, mat.beam, 0, 0.12, -0.48, { group: g });
    box(1.05, 0.12, 0.14, mat.beam, 0, 0.12, 0.48, { group: g });
    box(0.14, 0.12, 1.05, mat.beam, -0.48, 0.12, 0, { group: g });
    box(0.14, 0.12, 1.05, mat.beam, 0.48, 0.12, 0, { group: g });
    g.position.set(hx, hy, hz);
    world.add(g);
    blockTiles(8, 3, 8, 3);                    // shaft mouth under the headframe
  }

  // ---------------------------------------------------------------- timber + ore piles
  if (!warbell) {
    // stacked logs near the yard
    const lx = 2.6, ly = 6 * HU, lz = 2.6;
    const logGeo = new THREE.CylinderGeometry(0.11, 0.11, 1.3, 8);
    const positions = [[0, 0.11, 0], [0.24, 0.11, 0], [-0.24, 0.11, 0], [0.12, 0.3, 0], [-0.12, 0.3, 0], [0, 0.49, 0]];
    for (const [ox, oy, oz] of positions) {
      const log = new THREE.Mesh(logGeo, mat.wood);
      log.rotation.x = Math.PI / 2;
      log.position.set(lx + ox, ly + oy, lz + oz);
      log.castShadow = true; log.receiveShadow = true;
      world.add(log);
    }
    box(1.0, 0.06, 1.36, mat.snow, lx, ly + 0.62, lz, { shadow: false });
    blockTiles(2, 2, 2, 3);                    // log stack footprint
    // ore piles
    function orePile(x, baseH, z, n = 6) {
      const r = mulberry((x * 31 + z * 7) | 0);
      for (let i = 0; i < n; i++) {
        const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + r() * 0.12), mat.ore);
        rock.position.set(x + (r() - 0.5) * 0.6, baseH * HU + 0.1 + r() * 0.12, z + (r() - 0.5) * 0.6);
        rock.rotation.set(r() * 3, r() * 3, r() * 3);
        rock.castShadow = true; rock.receiveShadow = true;
        world.add(rock);
      }
    }
    orePile(3.5, 6, 4.5, 8); blockTiles(3, 4, 3, 4);
  }

  // ---------------------------------------------------------------- watch post on terrace 1 (defenders' side)
  if (!warbell) {
    const wx = 2.5, wy = 2 * HU, wz = 10.5;
    blockTiles(2, 10, 3, 10);
    const legH = 1.15;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      box(0.11, legH, 0.11, mat.woodDk, wx + sx * 0.5, wy + legH / 2, wz + sz * 0.5);
    box(1.3, 0.08, 1.3, mat.plankDk, wx, wy + legH + 0.04, wz);
    for (const [ox, oz, w, d] of [[0, -0.62, 1.3, 0.05], [0, 0.62, 1.3, 0.05], [-0.62, 0, 0.05, 1.3], [0.62, 0, 0.05, 1.3]])
      box(w, 0.34, d, mat.woodDk, wx + ox, wy + legH + 0.25, wz + oz);
    // brazier
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.1, 0.16, 8), mat.iron);
    bowl.position.set(wx, wy + legH + 0.16, wz); bowl.castShadow = true; world.add(bowl);
    box(0.14, 0.1, 0.14, mat.lampGlass, wx, wy + legH + 0.27, wz, { shadow: false });

    // ladder
    for (let i = 0; i < 4; i++) box(0.34, 0.04, 0.04, mat.woodDk, wx + 0.72, wy + 0.2 + i * 0.28, wz);
    box(0.05, legH + 0.1, 0.05, mat.woodDk, wx + 0.88, wy + (legH + 0.1) / 2, wz - 0.15);
    box(0.05, legH + 0.1, 0.05, mat.woodDk, wx + 0.88, wy + (legH + 0.1) / 2, wz + 0.15);
  }

  // ---------------------------------------------------------------- lamps along the invasion road
  function lamp(x, baseH, z) {
    const y0 = baseH * HU;
    box(0.09, 1.15, 0.09, mat.iron, x, y0 + 0.575, z);
    box(0.22, 0.26, 0.22, mat.lampGlass, x, y0 + 1.24, z, { shadow: false });
    box(0.28, 0.06, 0.28, mat.iron, x, y0 + 1.4, z);
    warmLight(x, y0 + 1.25, z, 3, 5);
  }
  if (!warbell) {
    lamp(7.5, 0, 14.5); blockTiles(7, 14, 7, 14);
    lamp(8.5, 6, 4.5); blockTiles(8, 4, 8, 4);
  }

  // ---------------------------------------------------------------- realistic pines (jittered silhouettes)
  function pine(x, z, s = 1) {
    const cellX = Math.min(W - 1, x | 0), cellZ = Math.min(D - 1, z | 0);
    const y0 = Math.max(H[cellZ][cellX], 1) * HU + hash(x * 3, z * 3) * 0.18;
    const r = mulberry((x * 137 + z * 61) | 0);
    const g = new THREE.Group();
    const totalH = (1.7 + r() * 0.8) * s;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05 * s, 0.09 * s, totalH * 0.3, 7), mat.trunk);
    trunk.position.y = totalH * 0.14;
    g.add(trunk);
    const tiers = 5 + Math.floor(r() * 2);
    function jitterCone(radius, height, phase) {
      const geo = new THREE.ConeGeometry(radius, height, 9);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vz = pos.getZ(i);
        const rad = Math.hypot(vx, vz);
        if (rad > 0.01) {
          const a = Math.atan2(vz, vx);
          const f = 0.82 + 0.14 * Math.sin(3 * a + phase) + 0.1 * Math.sin(7 * a + phase * 2.1) + 0.06 * Math.sin(11 * a + phase * 0.7);
          pos.setX(i, vx * f); pos.setZ(i, vz * f);
        }
      }
      geo.computeVertexNormals();
      return geo;
    }
    for (let t = 0; t < tiers; t++) {
      const frac = t / tiers;
      const radius = 0.62 * s * (1 - frac * 0.72);
      const tierH = totalH * 0.34;
      const y = totalH * 0.22 + frac * totalH * 0.72;
      const phase = r() * 6.28;
      const cone = new THREE.Mesh(jitterCone(radius, tierH, phase), r() > 0.5 ? mat.pineA : mat.pineB);
      cone.position.y = y;
      cone.rotation.y = r() * 6.28;
      cone.castShadow = true; cone.receiveShadow = true;
      g.add(cone);
      // clinging snow: shallow jittered cap over each tier
      const cap = new THREE.Mesh(jitterCone(radius * 0.88, tierH * 0.38, phase + 1.7), mat.pineSnow);
      cap.position.y = y + tierH * 0.22;
      cap.rotation.y = cone.rotation.y;
      cap.castShadow = false; cap.receiveShadow = true;
      g.add(cap);
    }
    g.rotation.z = (r() - 0.5) * 0.07;
    g.rotation.y = r() * 6.28;
    g.position.set(x, y0, z);
    world.add(g);
  }
  if (!warbell) {
    pine(1.4, 3.5, 1.1); pine(0.6, 7.4, 0.95); pine(1.3, 11.6, 1.2); pine(0.7, 15.3, 1.0);
    pine(10.6, 2.6, 1.05); pine(11.3, 6.5, 0.9); pine(10.5, 10.4, 1.15); pine(11.2, 14.5, 1.0);
    pine(1.5, 16.8, 0.9); pine(10.8, 16.9, 0.85);
  }

  // ---------------------------------------------------------------- boulders
  function boulder(x, z, s = 1) {
    const cellX = Math.min(W - 1, x | 0), cellZ = Math.min(D - 1, z | 0);
    const y0 = (T[cellZ][cellX] === rockTile ? Math.max(H[cellZ][cellX], 1) : H[cellZ][cellX]) * HU;
    const r = mulberry((x * 17 + z * 43) | 0);
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 * s, 0), mat.rock);
    rock.position.set(x, y0 + 0.2 * s, z);
    rock.rotation.set(r() * 3, r() * 3, r() * 3);
    rock.scale.set(1, 0.75 + r() * 0.3, 0.85 + r() * 0.3);
    rock.castShadow = true; rock.receiveShadow = true;
    world.add(rock);
    const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 * s, 0), mat.snow);
    cap.position.set(x, y0 + 0.38 * s, z);
    cap.rotation.copy(rock.rotation);
    cap.scale.set(1.1, 0.4, 1.0);
    world.add(cap);
  }
  if (!warbell) {
    boulder(2.5, 13.5, 1.0); blockTiles(2, 13, 2, 13);
    boulder(2.5, 5.5, 1.1); blockTiles(2, 5, 2, 5);
  }

  // ---------------------------------------------------------------- crates, barrels, fences
  function crate(x, baseH, z, s = 0.42) {
    const y0 = baseH * HU;
    const c = box(s, s, s, mat.plank, x, y0 + s / 2, z);
    c.rotation.y = hash(x, z) * 0.8;
    box(s * 1.02, 0.05, s * 1.02, mat.snow, x, y0 + s + 0.02, z).rotation.y = c.rotation.y;
  }
  function barrel(x, baseH, z) {
    const y0 = baseH * HU;
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.44, 10), mat.woodDk);
    b.position.set(x, y0 + 0.22, z); b.castShadow = true; b.receiveShadow = true;
    world.add(b);
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 10), mat.iron);
    ring.position.set(x, y0 + 0.3, z); world.add(ring);
  }
  if (!warbell) {
    crate(3.6, 6, 3.4); barrel(3.3, 6, 2.6); blockTiles(3, 2, 3, 3);
    barrel(9.6, 2, 12.35); crate(9.25, 2, 12.7, 0.36);   // tucked against the bunkhouse (tiles already blocked)
  }

  function fenceRun(x0, z0, x1, z1, baseH) {
    const y0 = baseH * HU;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const posts = Math.max(2, Math.round(len / 0.9) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      box(0.09, 0.5, 0.09, mat.woodDk, x0 + dx * t, y0 + 0.25, z0 + dz * t);
    }
    const rail = box(len, 0.06, 0.06, mat.woodDk, x0 + dx / 2, y0 + 0.42, z0 + dz / 2);
    rail.rotation.y = Math.atan2(-dz, dx);
    const rail2 = box(len, 0.05, 0.05, mat.woodDk, x0 + dx / 2, y0 + 0.22, z0 + dz / 2);
    rail2.rotation.y = Math.atan2(-dz, dx);
  }
  // terrace rims flanking each stair run (defensive chokepoints)
  if (!warbell) {
    fenceRun(2.1, 13.9, 4.4, 13.9, 2);
    fenceRun(7.6, 13.9, 9.9, 13.9, 2);
    fenceRun(2.1, 9.9, 4.4, 9.9, 4);
    fenceRun(7.6, 9.9, 9.9, 9.9, 4);
    fenceRun(2.1, 5.9, 4.4, 5.9, 6);
    fenceRun(7.6, 5.9, 9.9, 5.9, 6);
  }

  return { hoistWheel };
}
