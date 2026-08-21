/**
 * Battle 3 static scenery — the Figaro Castle entryway courtyard.
 *
 * The terrain module builds the walls as HEIGHT: brick columns at the heights
 * the map declares. This builds the CASTLE on top of them — battlements, the
 * portcullis and its banners, the two gatehouse towers, the wall ladders the
 * raiders come over, the wreckage in the breach, and the torches. Everything
 * here is one-way mesh construction plus one thing read back (`flicker`, the
 * per-frame torch guttering the page's render loop calls).
 *
 * IT MUST NOT WRITE OCCUPANCY. `blockTiles` is deliberately absent from the
 * context below, and adding it would be the mistake AGENT_BRIEF trap 6 records:
 * battle 1's scenery marks tiles blocked as a side effect of placing props, so
 * the node sim and the browser can disagree about one tile with nothing
 * throwing. Which tiles the courtyard's props occupy is DATA
 * (`figaroSolidPropTiles` in src/content/maps/figaro-courtyard.mjs) and the
 * page writes it. So: draw a prop where the map says one stands, and never the
 * other way round.
 *
 * WHERE THE HEIGHTS COME FROM. Not from the map's `h` numbers — from
 * `tileTop`, the surface the terrain actually built. The two agree today, but
 * only one of them is what the player's units stand on, and a battlement that
 * derives its own idea of where the wall ends is a battlement that will float
 * the first time the terrain's slab thickness or its height floor changes.
 *
 * LEGIBILITY IS THE BINDING CONSTRAINT, and the camera is why. The board is
 * viewed from the south-west at 37° of elevation, so anything tall on the WEST
 * or SOUTH side of the board stands between the player and the courtyard floor.
 * Three rules fall out of that and every piece below obeys them:
 *   1. Battlements sit on the OUTER lip of a wall walk, not its centre — which
 *      is both what a real one does and what keeps the merlon's shadow-cone off
 *      the walkable tiles behind it.
 *   2. Nothing tall stands on, or overhangs, a tile a unit may occupy. The
 *      breach wreckage is either flat debris or masonry above head height.
 *   3. The one thing that HAS to be tall and near — the gatehouse towers — is
 *      registered with the page's building-occlusion gate, the same mechanic
 *      that ghosts battle 1's bunkhouse when a unit walks behind it.
 * Ground decals sit at +0.006 above a tile, which is deliberately UNDER the
 * move-highlight plane at +0.012: soot never hides a reachable tile.
 *
 * Everything it needs arrives in one explicit context object and it imports
 * nothing — THREE included — so it stays constructible from Node against a
 * stub, matching `battle1-scenery.mjs` and every other module here. The palette
 * it draws with is `src/render/figaro-textures.mjs`, mixed into `mat` by the
 * page before the terrain is built.
 */

const CONTEXT_FIELDS = [
  'THREE',        // scene graph constructors (injected, never imported)
  'world',        // the battle world every prop joins, via this module's own group
  'box',          // (w,h,d,mat,x,y,z,{shadow,group}) -> kit-geometry mesh
  'mat',          // the shared material dict, with the battle's palette extension
  'HU',           // one height unit, for standing a prop on a tile's surface
  'topThick',     // world-space thickness of a tile's top slab
  'tileTop',      // [z][x] -> world-space y of that tile's walkable surface
  'warmLight',    // (x,y,z,intensity,dist,bucket) -> warm PointLight (torches)
  'lights',       // this battle's lamp bucket; scene-mood lights it with the scene
  'map',          // the courtyard map record: bands, anchors, props, grid
  'W',            // grid width
  'D',            // grid depth
  // Added by the art pass. The towers are the one set piece tall enough and near
  // enough to hide a unit from a south-west camera, and this is the page's
  // existing answer to exactly that — the visibility gate battle 1's buildings
  // are enrolled in. Borrowing it beat inventing a second rule for tall scenery.
  'registerBuildingOccluder',
];

/** Ground decals ride under the move-highlight plane (+0.012) so they never mask it. */
const DECAL_Y = 0.006;
/** Battlements stand this far in from a wall walk's centre, on the outer lip. */
const MERLON_OUT = 0.24;
const MERLON_H = 0.26;

export function createFigaroScenery(context) {
  const missing = CONTEXT_FIELDS.filter(key => context[key] === undefined);
  if (missing.length) {
    throw new Error('figaro scenery: missing context field(s) ' + missing.join(', '));
  }
  const {
    THREE, world, box, mat, HU, topThick, tileTop, warmLight, lights, map, W, D,
    registerBuildingOccluder,
  } = context;

  const group = new THREE.Group();
  world.add(group);

  // ---------------------------------------------------------------- primitives
  /** Every material this draws with, with a fallback so a stubbed `mat` still builds. */
  const use = (...names) => {
    for (const name of names) if (mat[name]) return mat[name];
    return mat.stone || mat.rock;
  };
  const BRICK  = use('figaroStone', 'stone');
  const TOWER_BRICK = use('figaroTowerStone', 'figaroStone', 'stone');
  const ASHLAR = use('figaroAshlar', 'figaroStone', 'stone');
  const IRON   = use('figaroIron', 'iron');
  const IRON_LT = use('figaroIronLt', 'figaroIron', 'iron');
  const TIMBER = use('figaroTimber', 'woodDk');
  const BANNER = use('figaroBanner', 'carpet');
  const FRINGE = use('figaroFringe', 'carpet');
  const RUBBLE = use('figaroRubble', 'figaroCap', 'stone');
  const FLAME  = use('figaroFlame', 'lampGlass');
  const SOOT   = use('figaroSoot', 'dark');
  const DARK   = use('figaroDark', 'dark');
  const SAND   = use('sand', 'snow');
  const CARPET = use('carpet');

  /** A non-box mesh (cylinders, cones, the rubble), shadowed like `box` is. */
  const put = (geo, material, x, y, z, { shadow = true, parent = group } = {}) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  /** The surface the terrain actually built for a tile — see the header. */
  const topY = (x, z) => (tileTop[z] && tileTop[z][x] != null ? tileTop[z][x] : 0);

  const { bands, stairs, carpetX, breachX, anchors } = map;
  const FLOOR    = topY(carpetX, bands.courtyard.z0);   // the courtyard the raiders cross
  const TERRACE  = topY(carpetX, bands.terrace.z0);     // the ground the party holds
  const KEEP_TOP = topY(carpetX, 0);
  const CURTAIN_TOP = topY(0, bands.courtyard.z0);
  const PARAPET_TOP = topY(2, bands.parapet.z);
  const GATE_TOP = topY(0, bands.gatehouse.z);
  const outsideSand = new Set(map.sandOutsideX);
  const breach = new Set(breachX);

  // ---------------------------------------------------------------- battlements
  /** One square merlon, capped, on a wall walk running along `along`. */
  function merlon(cx, top, cz, along) {
    const w = along === 'x' ? 0.56 : 0.40;
    const d = along === 'x' ? 0.40 : 0.56;
    box(w, MERLON_H, d, BRICK, cx, top + MERLON_H / 2, cz, { group });
    box(w + 0.08, 0.05, d + 0.08, ASHLAR, cx, top + MERLON_H + 0.025, cz, { group });
  }
  /**
   * A proud band of dressed stone: a cornice under a crest, or a plinth at a
   * foot. Its thickness is the terrain's own slab lip, so a course reads as one
   * more layer of the same masonry rather than as a stripe stuck to it.
   */
  const COURSE_T = topThick + 0.03;
  function courseX(x0, x1, y, z, thick = COURSE_T, depth = 1.12) {
    box(x1 - x0, thick, depth, ASHLAR, (x0 + x1) / 2, y, z, { group });
  }
  function courseZ(z0, z1, y, x, thick = COURSE_T, width = 1.12) {
    box(width, thick, z1 - z0, ASHLAR, x, y, (z0 + z1) / 2, { group });
  }

  // The keep's crest faces north, away from the courtyard; the parapet's faces
  // south, at the attackers it was built to stop.
  for (let x = 0; x < W; x++) merlon(x + 0.5, KEEP_TOP, 0.5 - MERLON_OUT, 'x');
  courseX(-0.03, W + 0.03, KEEP_TOP - 0.06, 0.5);

  const gaps = new Set([...stairs.centre, ...stairs.sides]);
  for (let x = 1; x < W - 1; x++) {
    if (gaps.has(x)) continue;
    merlon(x + 0.5, PARAPET_TOP, bands.parapet.z + 0.5 + MERLON_OUT, 'x');
  }

  // Both curtain walls, along their whole inhabited length, crest outboard.
  for (let z = bands.terrace.z0; z <= bands.courtyard.z1; z++) {
    merlon(0.5 - MERLON_OUT, CURTAIN_TOP, z + 0.5, 'z');
    merlon(W - 0.5 + MERLON_OUT, CURTAIN_TOP, z + 0.5, 'z');
  }
  courseZ(bands.terrace.z0, bands.gatehouse.z, CURTAIN_TOP - 0.06, 0.5);
  courseZ(bands.terrace.z0, bands.gatehouse.z, CURTAIN_TOP - 0.06, W - 0.5);

  // The gatehouse crest, on whichever of its two rows is the outward-facing one.
  for (let x = 0; x < W; x++) {
    if (!outsideSand.has(x)) merlon(x + 0.5, GATE_TOP, bands.approach.z + 0.5 + MERLON_OUT, 'x');
    else if (!breach.has(x) && x !== 4 && x !== 8)
      merlon(x + 0.5, GATE_TOP, bands.gatehouse.z + 0.5 + MERLON_OUT, 'x');
  }
  courseX(-0.03, 4, GATE_TOP - 0.06, bands.approach.z + 0.5);
  courseX(W - 4, W + 0.03, GATE_TOP - 0.06, bands.approach.z + 0.5);

  // Plinth courses where a wall meets the ground it was founded on.
  courseX(1, W - 1, TERRACE + 0.09, 1.03, 0.18, 0.26);
  courseZ(bands.courtyard.z0, bands.gatehouse.z, FLOOR + 0.09, 1.03, 0.18, 0.26);
  courseZ(bands.courtyard.z0, bands.gatehouse.z, FLOOR + 0.09, W - 1.03, 0.18, 0.26);
  courseX(1, Math.min(...breachX), FLOOR + 0.09, bands.gatehouse.z - 0.03, 0.18, 0.26);
  courseX(Math.max(...breachX) + 1, W - 1, FLOOR + 0.09, bands.gatehouse.z - 0.03, 0.18, 0.26);

  // Pilaster buttresses down the outward faces. A curtain wall seen side-on is
  // a very long flat rectangle, and this is what a castle does about that: a
  // rhythm of verticals cutting the horizontal coursing, each one throwing its
  // own shadow across the face under a raking sun.
  for (let z = 3; z <= bands.courtyard.z1; z += 3) {
    for (const [x, out] of [[0, -1], [W, 1]]) {
      box(0.3, CURTAIN_TOP - 0.02, 0.5, BRICK, x + out * 0.14, (CURTAIN_TOP - 0.02) / 2, z + 0.5, { group });
      box(0.38, 0.1, 0.58, ASHLAR, x + out * 0.14, CURTAIN_TOP - 0.06, z + 0.5, { group });
    }
  }
  for (const x of [1.5, 3.5, W - 3.5, W - 1.5]) {
    box(0.5, GATE_TOP - 0.02, 0.3, BRICK, x, (GATE_TOP - 0.02) / 2, bands.approach.z + 1.14, { group });
    box(0.58, 0.1, 0.38, ASHLAR, x, GATE_TOP - 0.06, bands.approach.z + 1.14, { group });
  }

  // ---------------------------------------------------------------- the keep door
  // A wrought-iron portcullis in a dressed surround, standing on the terrace the
  // party defends rather than on top of the wall. This is the far wall from the
  // camera, so it can carry as much relief as it likes without hiding anything.
  const door = anchors.keepDoor;
  const doorX = door.x + 0.5;
  const face = door.z + 1;                    // world z of the keep wall's south face
  const DW = 1.66, DH = 1.58;
  box(DW, DH, 0.34, DARK, doorX, TERRACE + DH / 2, face - 0.18, { group, shadow: false });
  for (let i = -3; i <= 3; i++)
    box(0.075, DH - 0.08, 0.075, IRON, doorX + i * 0.24, TERRACE + (DH - 0.08) / 2, face - 0.04, { group });
  for (const fy of [0.36, 0.82, 1.28])
    box(DW - 0.12, 0.075, 0.1, IRON, doorX, TERRACE + fy, face - 0.04, { group });
  for (const s of [-1, 1])
    box(0.3, DH + 0.52, 0.42, ASHLAR, doorX + s * (DW / 2 + 0.16), TERRACE + (DH + 0.52) / 2, face - 0.06, { group });
  box(DW + 0.94, 0.3, 0.46, ASHLAR, doorX, TERRACE + DH + 0.37, face - 0.06, { group });
  box(0.36, 0.36, 0.14, ASHLAR, doorX, TERRACE + DH + 0.72, face + 0.06, { group });

  // The two house banners, hung either side of the door on their iron rods.
  for (const s of [-1, 1]) {
    const bx = doorX + s * 2.35, bw = 1.62, bh = 1.94;
    const head = KEEP_TOP - 0.26;
    box(bw, bh, 0.05, BANNER, bx, head - bh / 2, face + 0.04, { group, shadow: false });
    box(bw + 0.16, 0.13, 0.13, FRINGE, bx, head + 0.05, face + 0.06, { group, shadow: false });
    box(bw + 0.34, 0.07, 0.07, IRON, bx, head + 0.15, face + 0.07, { group });
  }

  // ---------------------------------------------------------------- the ceremonial stair
  // The runner does not stop at the parapet: it carries across the centre
  // flight, which is what makes those three tiles read as the castle's axis
  // rather than as a gap in a wall. The two service stairs at the ends stay
  // bare stone — the map's comment is explicit that only the centre one is
  // ceremonial. It lays at the height the terrain gave the flight's top rather
  // than at a computed one, for the reason in this file's header.
  {
    const z = bands.parapet.z;
    const x0 = Math.min(...stairs.centre), x1 = Math.max(...stairs.centre);
    box((x1 - x0 + 1) - 0.16, 0.006, 0.94, CARPET,
      (x0 + x1) / 2 + 0.5, topY(carpetX, z) + DECAL_Y, z + 0.5, { group, shadow: false });
  }

  // ---------------------------------------------------------------- curtain walls
  // Arrow slits, dressed into the faces the camera can actually see (both are
  // the -x face: the west wall's outer skin and the east wall's inner one).
  for (const faceX of [0, W - 1]) {
    for (const z of [2, 5, 8, 11]) {
      const y = FLOOR + 0.98;
      box(0.16, 0.74, 0.36, ASHLAR, faceX - 0.05, y, z + 0.5, { group });
      box(0.1, 0.52, 0.13, DARK, faceX - 0.12, y, z + 0.5, { group, shadow: false });
    }
  }

  // The infiltration cue: one ladder against each curtain wall, its foot on the
  // tile the map says a raider lands on, its head well OVER the crest. The
  // overshoot is not decoration — a siege ladder does overshoot, and on the west
  // wall it is the only part of the ladder the player can see: that wall stands
  // between the camera and its own inner face, so a ladder stopping level with
  // the battlements is a ladder nobody knows is there.
  for (const anchor of anchors.ladders) {
    const west = anchor.x < W / 2;
    const dir = west ? 1 : -1;                 // which way the courtyard lies
    const faceX = west ? 1 : W - 1;            // the wall's inner face
    const foot = topY(anchor.x, anchor.z);
    const len = CURTAIN_TOP + 0.62 - foot;
    const lean = 0.15;
    const g = new THREE.Group();
    for (const s of [-1, 1]) box(0.07, len, 0.07, TIMBER, 0, len / 2, s * 0.19, { group: g });
    for (let i = 1; i < 9; i++) box(0.06, 0.05, 0.42, TIMBER, 0, (i / 9) * len, 0, { group: g });
    g.position.set(faceX + dir * (0.1 + len * Math.sin(lean)), foot, anchor.z + 0.5);
    g.rotation.z = dir * lean;
    group.add(g);
  }

  // ---------------------------------------------------------------- gatehouse towers
  // Cylindrical brick, founded on the ground rather than perched on the wall,
  // with the dark radial-finned cap the reference gives them.
  function tower(anchor) {
    const g = new THREE.Group();
    const H = bands.gatehouse.h * HU + 1.85;   // most of two storeys above the wall
    put(new THREE.CylinderGeometry(0.58, 0.74, H, 20, 1), TOWER_BRICK, 0, H / 2, 0, { parent: g });
    put(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 18), ASHLAR, 0, H * 0.42, 0, { parent: g });
    put(new THREE.CylinderGeometry(0.76, 0.76, 0.13, 18), ASHLAR, 0, H - 0.06, 0, { parent: g });
    // a ring of merlons under the roof
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const m = box(0.26, 0.24, 0.2, BRICK, Math.cos(a) * 0.63, H + 0.12, Math.sin(a) * 0.63, { group: g });
      m.rotation.y = -a;
    }
    // arrow slits, on the courtyard-facing quarter
    for (const a of [Math.PI * 0.9, Math.PI * 1.25]) {
      const s = box(0.1, 0.5, 0.16, DARK, Math.cos(a) * 0.62, H * 0.62, Math.sin(a) * 0.62, { group: g, shadow: false });
      s.rotation.y = -a;
    }
    // Figaro's SNES silhouette ends in a squat crenellated stone crown rather
    // than a fantasy cone roof. A small gilt standard keeps the tower readable
    // against the desert without changing that massing.
    put(new THREE.CylinderGeometry(0.56, 0.64, 0.34, 18), TOWER_BRICK, 0, H + 0.36, 0, { parent: g });
    put(new THREE.ConeGeometry(0.09, 0.3, 8), IRON_LT, 0, H + 0.68, 0, { parent: g });
    g.position.set(anchor.x + 0.5, 0, anchor.z + 0.5);
    group.add(g);
    registerBuildingOccluder(g, 'figaro-tower');
    return g;
  }
  for (const anchor of anchors.towers) tower(anchor);

  // ---------------------------------------------------------------- the breach
  // The gate did not open; it came down. The wall ends either side of the hole
  // crumble toward it, both leaves hang twisted off their hinges, and the sand
  // has been coming through ever since.
  const bx0 = Math.min(...breachX), bx1 = Math.max(...breachX);
  // `dir` points from the hole INTO the surviving wall, so the crest steps back
  // UP as it leaves the breach: lowest and most broken at the edge.
  for (const [edge, dir] of [[bx0, -1], [bx1 + 1, 1]]) {
    for (let i = 0; i < 3; i++) {
      const w = 0.2 + i * 0.06, h = 0.07 + i * 0.07;
      box(w, h, 0.52, BRICK, edge + dir * (0.14 + i * 0.26), GATE_TOP + h / 2 - 0.02,
        bands.gatehouse.z + 0.55, { group });
    }
    // soot up the jamb the fire licked
    box(0.03, 1.3, 0.7, SOOT, edge - dir * 0.02, FLOOR + 0.72, bands.gatehouse.z + 0.55,
      { group, shadow: false });
  }
  // and up the outward face either side of the hole
  for (const x of [bx0 - 0.5, bx1 + 1.5]) {
    box(0.9, 1.5, 0.03, SOOT, x, FLOOR + 0.85, bands.approach.z + 0.02, { group, shadow: false });
  }

  /**
   * One iron gate leaf, hanging off the hinge it has left.
   *
   * Bars LIGHT on a dark backing, not the other way round: a leaf standing in
   * the gatehouse's own shadow is the darkest thing in the frame, and dark
   * detail on a dark panel reads as a rectangular hole in the wall.
   */
  function gateLeaf(hingeX, side) {
    const g = new THREE.Group();
    box(1.02, 1.5, 0.08, DARK, side * 0.51, 0.75, 0, { group: g });
    for (let i = 0; i <= 4; i++)
      box(0.1, 1.44, 0.14, IRON_LT, side * (0.11 + i * 0.2), 0.75, 0.045, { group: g });
    for (const y of [0.14, 0.75, 1.38])
      box(1.06, 0.11, 0.17, IRON_LT, side * 0.51, y, 0.05, { group: g });
    box(0.15, 0.32, 0.22, IRON_LT, side * 0.02, 1.3, 0, { group: g });    // the surviving hinge
    g.position.set(hingeX, FLOOR, bands.gatehouse.z + 0.35);
    g.rotation.y = -side * 1.25;    // swung back flat against its own jamb
    g.rotation.z = side * 0.16;     // and hanging crooked
    group.add(g);
  }
  gateLeaf(bx0 + 0.02, 1);
  gateLeaf(bx1 + 0.98, -1);

  // Rubble. Every chunk is placed on a tile SEAM or against a wall, never on a
  // square's middle, so debris never sits where a unit's feet go.
  const gateZ = bands.gatehouse.z;
  const RUBBLE_CHUNKS = [
    [carpetX - 0.98, gateZ - 0.38, 0.2], [carpetX + 1.98, gateZ - 0.3, 0.17],
    [carpetX - 0.92, gateZ + 0.98, 0.15], [carpetX + 1.92, gateZ + 1.02, 0.19],
    [carpetX, gateZ + 0.02, 0.14], [carpetX + 1, gateZ - 0.02, 0.12],
    [carpetX - 1, gateZ - 1.1, 0.13], [carpetX + 2, gateZ - 1.04, 0.16],
    [carpetX - 1.45, gateZ + 1.98, 0.18], [carpetX + 2.5, gateZ + 1.94, 0.15],
  ];
  RUBBLE_CHUNKS.forEach(([x, z, r], i) => {
    const chunk = put(new THREE.DodecahedronGeometry(r, 0), RUBBLE, x, topY(Math.min(W - 1, x | 0), Math.min(D - 1, z | 0)) + r * 0.55, z);
    chunk.rotation.set(i * 1.1, i * 0.7, i * 1.9);
    chunk.scale.set(1, 0.7, 0.9);
  });
  // and a course of it fallen on the wall walk either side
  for (const x of [bx0 - 0.6, bx1 + 1.6]) {
    const chunk = put(new THREE.DodecahedronGeometry(0.22, 0), RUBBLE, x, GATE_TOP + 0.13, bands.gatehouse.z + 0.5);
    chunk.rotation.set(0.6, 1.2, 0.3);
  }

  // Scorch on the ground the fight came through, under the highlight plane. It
  // sits mostly INSIDE the gate rather than in the mouth of it: the mouth is in
  // the gatehouse's own shadow, where a dark smudge on dark ground is nothing,
  // and the cobble two rows in is the lit ground where it reads.
  for (const [x, z, s] of [
    [carpetX + 0.4, gateZ - 0.6, 2.4], [carpetX + 0.2, gateZ - 2.1, 2.1],
    [carpetX - 1.4, gateZ - 1.3, 1.5], [carpetX + 2.4, gateZ - 1.4, 1.4],
    [carpetX + 0.6, gateZ - 3.6, 1.3],
  ]) box(s, 0.004, s * 0.8, SOOT, x, FLOOR + DECAL_Y, z, { group, shadow: false });

  // The sand that has drifted in, banked where the wind drops it: against the
  // jambs inside, and along the foot of the outward wall.
  for (const [x, z, rx, rz] of [[bx0 + 0.22, gateZ - 0.14, 0.5, 0.22], [bx1 + 0.78, gateZ - 0.14, 0.5, 0.22]]) {
    const drift = put(new THREE.SphereGeometry(1, 14, 8), SAND, x, FLOOR - 0.03, z, { shadow: false });
    drift.scale.set(rx, 0.13, rz);
  }
  for (const [x, rx] of [[2.0, 1.7], [W - 2.4, 1.6]]) {
    const drift = put(new THREE.SphereGeometry(1, 14, 8), SAND, x, FLOOR - 0.02, bands.approach.z + 0.94, { shadow: false });
    drift.scale.set(rx, 0.12, 0.3);
  }

  // ---------------------------------------------------------------- cover
  // Drawn where the MAP says it stands. The tiles those props occupy are marked
  // blocked by the page, never here.
  for (const prop of map.props || []) {
    if (prop.x < 0 || prop.x >= W || prop.z < 0 || prop.z >= D) continue;
    const x = prop.x + 0.5, z = prop.z + 0.5, y = topY(prop.x, prop.z);
    if (prop.kind === 'barrel') {
      put(new THREE.CylinderGeometry(0.28, 0.25, 0.62, 12), TIMBER, x, y + 0.31, z);
      for (const ry of [0.12, 0.5])
        put(new THREE.CylinderGeometry(0.295, 0.285, 0.06, 12), IRON, x, y + ry, z, { shadow: false });
    } else {
      const c = box(0.68, 0.62, 0.68, TIMBER, x, y + 0.31, z, { group });
      c.rotation.y = (prop.x * 0.37 + prop.z * 0.19) % 0.7;
      for (const s of [-1, 1]) {
        const band = box(0.72, 0.07, 0.72, IRON, x, y + 0.31 + s * 0.2, z, { group, shadow: false });
        band.rotation.y = c.rotation.y;
      }
    }
  }

  // ---------------------------------------------------------------- torchlight
  // Iron sconces, and the warm points they throw into the battle's own lamp
  // bucket so scene-mood switches them with the scene. `flicker` is the page's
  // render loop guttering them: the same idiom the chimney smoke uses, one list
  // walked per frame.
  const torches = [];
  const flames = [];
  function sconce(x, y, z, dx, dz) {
    box(0.09, 0.26, 0.09, IRON, x, y, z, { group });
    box(0.16, 0.08, 0.16, IRON, x + dx * 0.02, y + 0.15, z + dz * 0.02, { group });
    const flame = put(new THREE.ConeGeometry(0.11, 0.3, 8), FLAME, x + dx * 0.02, y + 0.32, z + dz * 0.02, { shadow: false });
    flames.push(flame);
    torches.push(warmLight(x + dx * 0.12, y + 0.36, z + dz * 0.12, 2.4, 6.0, lights));
  }
  // either side of the keep door
  for (const s of [-1, 1]) sconce(doorX + s * 1.25, TERRACE + 1.16, face + 0.12, 0, 1);
  // one on each curtain wall, facing in over the courtyard
  sconce(1.12, FLOOR + 1.24, bands.courtyard.z0 + 1.5, 1, 0);
  sconce(W - 1.12, FLOOR + 1.24, bands.courtyard.z1 - 1.5, -1, 0);
  // Two braziers ON the wall walk beside the breach. On the walk rather than in
  // the gate mouth for one reason: a sconce on the gatehouse's inner face points
  // away from every camera angle the player starts at, and the defenders' fire
  // over the broken gate is the composition's warm accent.
  for (const x of [bx0 - 0.5, bx1 + 1.5]) {
    box(0.16, 0.2, 0.16, IRON, x, GATE_TOP + 0.1, bands.gatehouse.z + 0.5, { group });
    put(new THREE.CylinderGeometry(0.19, 0.12, 0.16, 10), IRON, x, GATE_TOP + 0.28, bands.gatehouse.z + 0.5);
    const flame = put(new THREE.ConeGeometry(0.14, 0.3, 8), FLAME, x, GATE_TOP + 0.48,
      bands.gatehouse.z + 0.5, { shadow: false });
    flames.push(flame);
    torches.push(warmLight(x, GATE_TOP + 0.5, bands.gatehouse.z + 0.5, 3.0, 7.0, lights));
  }

  const BASE_INTENSITY = torches.map(l => l.intensity);
  /** Called once per frame by the page's render loop; `t` is the scene clock. */
  function flicker(t) {
    for (let i = 0; i < torches.length; i++) {
      const wobble = 0.86
        + 0.1 * Math.sin(t * 7.3 + i * 2.1)
        + 0.06 * Math.sin(t * 17.9 + i * 5.3);
      torches[i].intensity = BASE_INTENSITY[i] * wobble;
      const f = flames[i];
      f.scale.set(0.9 + wobble * 0.15, 0.82 + wobble * 0.3, 0.9 + wobble * 0.15);
    }
  }

  return { group, torches, flicker };
}
