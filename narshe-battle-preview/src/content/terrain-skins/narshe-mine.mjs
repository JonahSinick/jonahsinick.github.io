const terrainAsset = filename => new URL(
  `../../../art/environments/narshe-mine/${filename}`,
  import.meta.url,
).href;

export const narsheMineSkin = {
  id: "narshe-mine",
  environment: {
    background: 0x171522,
    fog: { color: 0x171522, density: 0.019 },
    hemisphere: {
      sky: 0x9fb7d2,
      ground: 0x39253a,
      intensity: 2.05,
    },
    key: {
      color: 0xffdfb0,
      intensity: 2.7,
      position: [-5, 13, 8],
      shadowMapSize: 2048,
      shadowBounds: 10,
    },
  },
  textures: {
    floor: {
      url: terrainAsset("slate-floor-v1.jpg"),
      repeat: [0.38, 0.38],
    },
    rock: {
      url: terrainAsset("cavern-rock-v1.jpg"),
      repeat: [1.25, 1.25],
    },
    timber: {
      url: terrainAsset("hewn-timber-v1.jpg"),
      repeat: [0.7, 1.8],
    },
  },
  materials: {
    stone: {
      type: "standard",
      color: 0xd5deea,
      texture: "floor",
      roughness: 0.9,
    },
    stoneDark: {
      type: "standard",
      color: 0x7d899c,
      texture: "floor",
      roughness: 0.96,
    },
    rock: {
      type: "standard",
      color: 0xcbb6c4,
      texture: "rock",
      roughness: 1,
    },
    rockDark: {
      type: "standard",
      color: 0x796574,
      texture: "rock",
      roughness: 1,
    },
    timber: {
      type: "standard",
      color: 0x785c4e,
      texture: "timber",
      roughness: 0.88,
    },
    timberLight: {
      type: "standard",
      color: 0xad8365,
      texture: "timber",
      roughness: 0.84,
    },
    iron: {
      type: "standard",
      color: 0x303840,
      metalness: 0.65,
      roughness: 0.42,
    },
    rail: {
      type: "standard",
      color: 0x8a9397,
      metalness: 0.72,
      roughness: 0.33,
    },
    brass: {
      type: "standard",
      color: 0x8f6328,
      metalness: 0.76,
      roughness: 0.34,
    },
    ore: {
      type: "standard",
      color: 0x68a7b0,
      emissive: 0x1e6670,
      emissiveIntensity: 0.7,
      roughness: 0.48,
    },
    dark: {
      type: "basic",
      color: 0x071015,
    },
  },
};

// Kept as a runtime-selectable fallback while the authored material pass is
// under visual review. It intentionally shares the map's skin id.
export const narsheMineLegacySkin = {
  id: "narshe-mine",
  environment: narsheMineSkin.environment,
  textures: {
    floor: {
      palette: ["#263142", "#34465c", "#46566a", "#1b2634", "#675168"],
      seed: 6017,
      repeat: [4, 4],
    },
    rock: {
      palette: ["#2b2030", "#443044", "#59424f", "#6d5056", "#241d2d", "#786264"],
      seed: 9929,
      repeat: [2, 2],
    },
    timber: {
      palette: ["#4a2c1d", "#75462a", "#9a6536", "#2f1d18"],
      seed: 3211,
      repeat: [1, 5],
    },
  },
  materials: {
    stone: {
      type: "standard",
      color: 0x8694aa,
      texture: "floor",
      roughness: 0.9,
    },
    stoneDark: {
      type: "standard",
      color: 0x374356,
      texture: "floor",
      roughness: 0.96,
    },
    rock: {
      type: "standard",
      color: 0x77606f,
      texture: "rock",
      roughness: 1,
    },
    rockDark: {
      type: "standard",
      color: 0x433347,
      texture: "rock",
      roughness: 1,
    },
    timber: {
      type: "standard",
      color: 0x704225,
      texture: "timber",
      roughness: 0.88,
    },
    timberLight: {
      type: "standard",
      color: 0x9a6334,
      texture: "timber",
      roughness: 0.84,
    },
    iron: narsheMineSkin.materials.iron,
    rail: narsheMineSkin.materials.rail,
    brass: narsheMineSkin.materials.brass,
    ore: narsheMineSkin.materials.ore,
    dark: narsheMineSkin.materials.dark,
  },
};
