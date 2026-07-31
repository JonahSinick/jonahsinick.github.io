export const warningBellGalleryMap = {
  schemaVersion: 1,
  id: "warning-bell-gallery",
  skin: "narshe-mine",
  grid: {
    width: 13,
    depth: 11,
    tileSize: 0.97,
    slabHeight: 0.18,
    surfaceY: -0.1,
    edgeSides: ["west", "east", "south"],
    variation: {
      xFactor: 7,
      zFactor: 11,
      steps: 5,
      amount: 0.012,
      bias: -0.024,
    },
  },
  modules: [
    {
      kind: "cavern-walls",
      far: {
        from: -7,
        to: 7,
        step: 0.72,
        z: -5.82,
        gapHalfWidth: 1.42,
      },
      sides: {
        x: [-6.72, 6.72],
        from: -5.1,
        to: 5.1,
        step: 0.78,
      },
    },
    {
      kind: "timbered-shaft",
      position: [0, 1.38, -5.64],
      opening: [2.55, 2.85],
      postX: [-1.28, 1.28],
      cap: [2.9, 0.3, 0.32],
      faceZ: -5.5,
      crownRocks: [
        [-1.55, 2.65, 0.55, 0.62],
        [-0.95, 3.05, 0.62, 0.55],
        [-0.3, 3.23, 0.66, 0.52],
        [0.38, 3.2, 0.65, 0.5],
        [1.02, 3.03, 0.58, 0.55],
        [1.58, 2.63, 0.52, 0.62],
      ],
    },
    {
      kind: "mine-rails",
      railX: [-0.34, 0.34],
      centerZ: -0.55,
      length: 10.1,
      sleeper: {
        from: -5.35,
        to: 4.35,
        step: 0.48,
      },
    },
    // Set dressing pared to what reads unambiguously (Jonah, 2026-07-31):
    // crates, wall ore-seams, and work-lamps removed — the seams read as
    // floating ice and the lamps as stray bronze spheres competing with the
    // warning bell, which must stay the scene's only bronze. Carts are empty:
    // parked haulers, not ice wagons.
    // Props are kit GEOMETRY, tile-snapped: they occupy squares and rotate
    // with the world (billboard plates read as straddling and turning
    // wrongly — Jonah, 2026-07-31). Carts stay empty haulers.
    { kind: "ore-cart", position: [-4, -1], empty: true },
    { kind: "ore-cart", position: [4, 0], empty: true },
    { kind: "crate", position: [-4, 2], size: 0.62 },
    { kind: "crate", position: [4, 3], size: 0.56 },
    { kind: "timber-brace", position: [-6.28, 1], along: "z" },
    { kind: "timber-brace", position: [6.28, -2], along: "z" },
    // The near (south) wall frames the scene when the camera swings to face
    // it, and hides otherwise so it never obstructs the party's approach.
    // Its plain timbered opening has no bell and no rock crown — the bell
    // wall stays unmistakable.
    {
      kind: "cavern-walls",
      viewGroup: "south",
      near: {
        from: -7,
        to: 7,
        step: 0.72,
        z: 5.82,
        gapHalfWidth: 1.42,
      },
    },
    {
      kind: "timbered-shaft",
      viewGroup: "south",
      position: [0, 1.05, 5.64],
      opening: [2.55, 2.2],
      postX: [-1.28, 1.28],
      cap: [2.9, 0.26, 0.32],
      faceZ: 5.5,
    },
  ],
  anchors: {
    warningBell: [2.28, 1.22, -5.13],
    shaftMouth: [0, 0, -5.15],
    enemyStaging: [0, 0, -4],
    partyStaging: [0, 0, 4],
  },
};
