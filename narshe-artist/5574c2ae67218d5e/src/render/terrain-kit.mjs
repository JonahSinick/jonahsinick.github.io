const EDGE_SIDES = new Set(["north", "south", "west", "east"]);
const MODULE_KINDS = new Set([
  "cavern-walls",
  "timbered-shaft",
  "mine-rails",
  "crate",
  "ore-cart",
  "ore-seam",
  "work-lamp",
  "timber-brace",
]);
const REQUIRED_MATERIALS = [
  "stone",
  "stoneDark",
  "rock",
  "rockDark",
  "timber",
  "timberLight",
  "iron",
  "rail",
  "brass",
  "ore",
  "dark",
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validatePosition(position, length, label) {
  invariant(
    Array.isArray(position)
      && position.length === length
      && position.every(finiteNumber),
    `${label} must contain ${length} finite coordinates`,
  );
}

export function validateTerrainDefinition(map, skin) {
  invariant(map && typeof map === "object", "terrain map is required");
  invariant(typeof map.id === "string" && map.id, "terrain map needs an id");
  invariant(map.schemaVersion === 1, `${map.id}: unsupported schema version`);
  invariant(map.grid && typeof map.grid === "object", `${map.id}: grid is required`);
  invariant(
    Number.isInteger(map.grid.width) && map.grid.width > 0,
    `${map.id}: grid width must be a positive integer`,
  );
  invariant(
    Number.isInteger(map.grid.depth) && map.grid.depth > 0,
    `${map.id}: grid depth must be a positive integer`,
  );
  invariant(
    finiteNumber(map.grid.tileSize) && map.grid.tileSize > 0,
    `${map.id}: tileSize must be positive`,
  );
  invariant(
    finiteNumber(map.grid.slabHeight) && map.grid.slabHeight > 0,
    `${map.id}: slabHeight must be positive`,
  );
  invariant(
    Array.isArray(map.grid.edgeSides)
      && map.grid.edgeSides.every(side => EDGE_SIDES.has(side)),
    `${map.id}: edgeSides contains an unknown side`,
  );
  invariant(Array.isArray(map.modules), `${map.id}: modules must be an array`);
  for (const [index, module] of map.modules.entries()) {
    invariant(
      module && MODULE_KINDS.has(module.kind),
      `${map.id}: module ${index} has an unknown kind`,
    );
  }
  invariant(map.anchors && typeof map.anchors === "object", `${map.id}: anchors are required`);
  for (const [name, position] of Object.entries(map.anchors)) {
    validatePosition(position, 3, `${map.id}: anchor ${name}`);
  }

  invariant(skin && typeof skin === "object", `${map.id}: terrain skin is required`);
  invariant(map.skin === skin.id, `${map.id}: expected skin ${map.skin}`);
  invariant(skin.environment && typeof skin.environment === "object", `${skin.id}: environment is required`);
  invariant(skin.textures && typeof skin.textures === "object", `${skin.id}: textures are required`);
  invariant(skin.materials && typeof skin.materials === "object", `${skin.id}: materials are required`);
  for (const materialName of REQUIRED_MATERIALS) {
    invariant(skin.materials[materialName], `${skin.id}: missing material ${materialName}`);
  }
  for (const [name, material] of Object.entries(skin.materials)) {
    if (material.texture) {
      invariant(skin.textures[material.texture], `${skin.id}: material ${name} references an unknown texture`);
    }
  }
  return true;
}

export function terrainGridCells(map) {
  const { width, depth } = map.grid;
  const xOffset = (width - 1) / 2;
  const zOffset = (depth - 1) / 2;
  const cells = [];
  for (let zIndex = 0; zIndex < depth; zIndex++) {
    for (let xIndex = 0; xIndex < width; xIndex++) {
      cells.push({
        xIndex,
        zIndex,
        x: xIndex - xOffset,
        z: zIndex - zOffset,
      });
    }
  }
  return cells;
}

export function terrainBounds(map) {
  return {
    minX: -(map.grid.width - 1) / 2,
    maxX: (map.grid.width - 1) / 2,
    minZ: -(map.grid.depth - 1) / 2,
    maxZ: (map.grid.depth - 1) / 2,
  };
}

function isEdgeCell(cell, map) {
  const { width, depth, edgeSides } = map.grid;
  return (
    (edgeSides.includes("west") && cell.xIndex === 0)
    || (edgeSides.includes("east") && cell.xIndex === width - 1)
    || (edgeSides.includes("north") && cell.zIndex === 0)
    || (edgeSides.includes("south") && cell.zIndex === depth - 1)
  );
}

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createTexture({ THREE, renderer, definition, pending, errors, name, onSettled }) {
  let texture;
  if (definition.url) {
    // Fetched skins report readiness so an entry curtain can hold until the
    // floor is actually dressed; a failed fetch settles rather than hangs.
    // Settling silently would recreate the silent-partial-art failure mode,
    // so a failure is also RECORDED: the caller routes these into whatever
    // structured error channel it already shows.
    let settle;
    if (pending) pending.push(new Promise(resolve => { settle = resolve; }));
    // A caller driving a progress indicator needs each sheet as it lands, not
    // only the aggregate `ready`; success and failure both report, because both
    // end the wait for that sheet.
    const done = () => {
      if (onSettled) onSettled(name);
      if (settle) settle();
    };
    texture = new THREE.TextureLoader().load(
      definition.url,
      () => done(),
      undefined,
      () => {
        if (errors) errors.push({ texture: name, url: definition.url });
        done();
      },
    );
  } else {
    const random = seeded(definition.seed);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const context = canvas.getContext("2d");
    context.fillStyle = definition.palette[0];
    context.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 540; i++) {
      const size = 2 + Math.floor(random() * 10);
      const x = Math.floor(random() * 128);
      const y = Math.floor(random() * 128);
      context.fillStyle = definition.palette[
        1 + Math.floor(random() * (definition.palette.length - 1))
      ];
      context.globalAlpha = 0.18 + random() * 0.38;
      context.fillRect(
        x,
        y,
        size * (1.1 + random()),
        size * (0.35 + random() * 0.8),
      );
    }
    context.globalAlpha = 1;
    texture = new THREE.CanvasTexture(canvas);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...definition.repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function createMaterials({ THREE, renderer, skin, pending, errors, onSettled }) {
  const textures = Object.fromEntries(
    Object.entries(skin.textures).map(([name, definition]) => [
      name,
      createTexture({ THREE, renderer, definition, pending, errors, name, onSettled }),
    ]),
  );
  return Object.fromEntries(
    Object.entries(skin.materials).map(([name, definition]) => {
      const { type, texture, ...parameters } = definition;
      if (texture) parameters.map = textures[texture];
      const Material = type === "basic"
        ? THREE.MeshBasicMaterial
        : THREE.MeshStandardMaterial;
      return [name, new Material(parameters)];
    }),
  );
}

function addEnvironment({ THREE, scene, skin, group }) {
  const environment = skin.environment;
  scene.background = new THREE.Color(environment.background);
  scene.fog = new THREE.FogExp2(
    environment.fog.color,
    environment.fog.density,
  );
  const hemisphere = new THREE.HemisphereLight(
    environment.hemisphere.sky,
    environment.hemisphere.ground,
    environment.hemisphere.intensity,
  );
  group.add(hemisphere);
  const key = new THREE.DirectionalLight(
    environment.key.color,
    environment.key.intensity,
  );
  key.position.set(...environment.key.position);
  key.castShadow = true;
  key.shadow.mapSize.set(
    environment.key.shadowMapSize,
    environment.key.shadowMapSize,
  );
  const bound = environment.key.shadowBounds;
  key.shadow.camera.left = -bound;
  key.shadow.camera.right = bound;
  key.shadow.camera.top = bound;
  key.shadow.camera.bottom = -bound;
  group.add(key);
  return { hemisphere, key };
}

// `onTextureSettled(name)` is optional and fires once per FETCHED texture as it
// lands or fails — procedural textures never fetch, so they never report.
export function buildTerrainKit({ THREE, renderer, scene, map, skin, onTextureSettled }) {
  validateTerrainDefinition(map, skin);
  const group = new THREE.Group();
  group.name = `terrain:${map.id}`;
  group.userData.terrainMapId = map.id;
  group.userData.terrainSkinId = skin.id;
  scene.add(group);

  const pending = [];
  const errors = [];
  const materials = createMaterials({
    THREE, renderer, skin, pending, errors, onSettled: onTextureSettled,
  });
  const environment = addEnvironment({ THREE, scene, skin, group });
  const ready = Promise.all(pending);

  // Meshes attach to `parent`, which is the kit group except while building
  // a module that declares a viewGroup — those collect into a named subgroup
  // the page can toggle (e.g. a near wall shown only when the camera faces
  // it, so it frames the scene without ever obstructing the entry approach).
  let parent = group;
  const namedGroups = {};
  function box(width, height, depth, material, x, y, z, cast = true) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      material,
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function rock(x, y, z, sx, sy, sz, dark = false) {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      dark ? materials.rockDark : materials.rock,
    );
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.rotation.set(x * 0.17, z * 0.11, (x + z) * 0.07);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  for (const cell of terrainGridCells(map)) {
    const edge = isEdgeCell(cell, map);
    const tile = box(
      map.grid.tileSize,
      map.grid.slabHeight,
      map.grid.tileSize,
      edge ? materials.stoneDark : materials.stone,
      cell.x,
      map.grid.surfaceY,
      cell.z,
      false,
    );
    const variation = map.grid.variation;
    const step = (
      (cell.x * variation.xFactor + cell.z * variation.zFactor)
      % variation.steps
    );
    tile.material = tile.material.clone();
    if (tile.material.map) {
      // An authored floor sheet is sampled from a deterministic variety of
      // regions so adjacent tactical cells share a material language without
      // looking rubber-stamped. Texture clones share the same loaded bitmap.
      const mapTexture = tile.material.map.clone();
      const sampleRandom = seeded(
        0x9e3779b9
          ^ (cell.xIndex + 1) * 0x85ebca6b
          ^ (cell.zIndex + 1) * 0xc2b2ae35,
      );
      mapTexture.offset.set(
        sampleRandom() * Math.max(0, 1 - mapTexture.repeat.x),
        sampleRandom() * Math.max(0, 1 - mapTexture.repeat.y),
      );
      mapTexture.needsUpdate = true;
      tile.material.map = mapTexture;
    }
    tile.material.color.offsetHSL(
      0,
      0,
      step * variation.amount + variation.bias,
    );
    tile.userData.tile = {
      x: cell.xIndex,
      z: cell.zIndex,
      terrain: edge ? "stone-edge" : "stone",
    };
  }

  function buildCavernWalls(module) {
    const wallHeight = (axis, salt) => (
      1.48
      + (Math.sin(axis * 1.73 + salt) + 1) * 0.14
      + (Math.sin(axis * 3.11 - salt) + 1) * 0.07
    );
    // far and near are the same run mirrored in z; either (and sides) may be
    // omitted so one map can split its walls across differently-grouped
    // modules (the near wall lives in a toggleable viewGroup).
    for (const run of [module.far, module.near].filter(Boolean)) {
      const sign = run === module.near ? 1 : -1;   // crest rocks lean outward
      let farIndex = 0;
      for (let x = run.from; x <= run.to; x += run.step) {
        if (run.gapHalfWidth && Math.abs(x) < run.gapHalfWidth) continue;
        const height = wallHeight(x, 0.9);
        box(
          run.step * 1.05,
          height,
          0.72,
          farIndex % 3 === 0 ? materials.rockDark : materials.rock,
          x,
          height / 2 - 0.03,
          run.z,
        );
        rock(
          x + Math.sin(x * 2.4) * 0.13,
          height + 0.08,
          run.z + sign * 0.03,
          0.45,
          0.34 + (farIndex % 2) * 0.07,
          0.42,
          farIndex % 4 === 0,
        );
        if (farIndex % 3 === 1) {
          rock(
            x - 0.22,
            0.18,
            run.z - sign * 0.38,
            0.28,
            0.2,
            0.22,
            true,
          );
        }
        farIndex++;
      }
    }
    const sides = module.sides;
    if (!sides) return;
    for (const x of sides.x) {
      let sideIndex = 0;
      for (let z = sides.from; z <= sides.to; z += sides.step) {
        const side = Math.sign(x);
        const height = wallHeight(z, side * 1.7);
        box(
          0.72,
          height,
          sides.step * 1.06,
          sideIndex % 3 === 0 ? materials.rockDark : materials.rock,
          x,
          height / 2 - 0.03,
          z,
        );
        rock(
          x + side * 0.02,
          height + 0.08,
          z + Math.sin(z * 2.1) * 0.14,
          0.42,
          0.32 + (sideIndex % 2) * 0.08,
          0.46,
          sideIndex % 4 === 0,
        );
        if (sideIndex % 3 === 2) {
          rock(
            x - side * 0.38,
            0.18,
            z + 0.16,
            0.22,
            0.2,
            0.3,
            true,
          );
        }
        sideIndex++;
      }
    }
  }

  function buildShaft(module) {
    const [x, y, z] = module.position;
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(...module.opening),
      materials.dark,
    );
    shaft.position.set(x, y, z);
    parent.add(shaft);
    for (const postX of module.postX) {
      box(0.3, 2.85, 0.3, materials.timberLight, x + postX, 1.4, module.faceZ);
    }
    box(...module.cap, materials.timberLight, x, 2.78, module.faceZ);
    for (const braceX of [-1.12, 1.12]) {
      const brace = box(
        0.22,
        2.65,
        0.22,
        materials.timber,
        x + braceX,
        1.35,
        module.faceZ + 0.15,
      );
      brace.rotation.z = braceX < 0 ? -0.38 : 0.38;
    }
    for (const [rockX, rockY, sx, sy] of module.crownRocks || []) {
      rock(x + rockX, rockY, z - 0.19, sx, sy, 0.55);
    }
  }

  function buildRails(module) {
    for (const x of module.railX) {
      box(0.08, 0.07, module.length, materials.rail, x, 0.075, module.centerZ, false);
    }
    for (
      let z = module.sleeper.from;
      z <= module.sleeper.to;
      z += module.sleeper.step
    ) {
      box(0.92, 0.045, 0.1, materials.timber, 0, 0.04, z, false);
    }
  }

  // Props are real geometry that OCCUPIES its tile and rotates with the
  // world — never billboards (Jonah, 2026-07-31: plates read as straddling
  // squares and turning wrongly). Nicer comes from more parts and the
  // authored timber grain, not from higher resolution.
  function buildCrate(module) {
    const [x, z] = module.position;
    const size = module.size;
    const crate = box(size * 0.94, size, size * 0.94, materials.timber, x, size / 2, z);
    // corner posts frame the slats
    const half = size / 2;
    for (const [dx, dz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
      box(0.07, size + 0.03, 0.07, materials.timberLight, x + dx * 0.94, size / 2, z + dz * 0.94);
    }
    // two iron bands wrap the FULL perimeter
    for (const dy of [-0.16, 0.16]) {
      const bandY = size / 2 + dy * size;
      box(size + 0.03, 0.05, size * 0.94, materials.iron, x, bandY, z);
      box(size * 0.94, 0.05, size + 0.03, materials.iron, x, bandY, z);
    }
    return crate;
  }

  function buildOreCart(module) {
    const [x, z] = module.position;
    // slatted body: three planks a side with a shadow gap between them
    const cart = box(0.9, 0.14, 0.6, materials.timber, x, 0.3, z);
    for (const layer of [0, 1, 2]) {
      const y = 0.42 + layer * 0.155;
      box(0.9, 0.13, 0.6 - 0.02 * layer, materials.timberLight, x, y, z);
    }
    // corner posts and an iron rim
    for (const [dx, dz] of [[-0.44, -0.29], [0.44, -0.29], [-0.44, 0.29], [0.44, 0.29]]) {
      box(0.08, 0.55, 0.08, materials.timber, x + dx, 0.5, z + dz);
    }
    box(0.96, 0.05, 0.66, materials.iron, x, 0.78, z);
    // four wheels with hubs, both sides
    for (const dz of [-0.34, 0.34]) {
      for (const dx of [-0.28, 0.28]) {
        const wheel = new THREE.Mesh(
          new THREE.CylinderGeometry(0.16, 0.16, 0.09, 14),
          materials.iron,
        );
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x + dx, 0.16, z + dz);
        parent.add(wheel);
        const hub = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8),
          materials.rail,
        );
        hub.rotation.x = Math.PI / 2;
        hub.position.set(x + dx, 0.16, z + dz);
        parent.add(hub);
      }
    }
    // axle beams tie the undercarriage together
    for (const dx of [-0.28, 0.28]) {
      box(0.07, 0.07, 0.74, materials.timber, x + dx, 0.16, z);
    }
    if (module.empty) return;   // an empty hauler: no ore load above the rim
    for (let index = 0; index < 5; index++) {
      const ore = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.18 + (index % 2) * 0.05, 0),
        materials.ore,
      );
      ore.position.set(
        x - 0.35 + index * 0.17,
        0.78 + (index % 2) * 0.08,
        z,
      );
      ore.rotation.set(index, index * 0.4, 0);
      parent.add(ore);
    }
  }

  function buildOreSeam(module) {
    const [x, y, z] = module.position;
    for (let index = 0; index < 5; index++) {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.12 + index * 0.018, 0),
        materials.ore,
      );
      crystal.position.set(
        x + index * 0.13,
        y + (index % 2) * 0.14,
        z + index * 0.04,
      );
      crystal.rotation.z = index * 0.41;
      parent.add(crystal);
    }
  }

  function buildWorkLamp(module) {
    const [x, y, z] = module.position;
    const lamp = new THREE.PointLight(0xffae56, 8.5, 4.8, 2);
    lamp.position.set(x, y, z);
    parent.add(lamp);
    const cage = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 10, 7),
      materials.brass,
    );
    cage.position.copy(lamp.position);
    parent.add(cage);
  }

  const builders = {
    "cavern-walls": buildCavernWalls,
    "timbered-shaft": buildShaft,
    "mine-rails": buildRails,
    crate: buildCrate,
    "ore-cart": buildOreCart,
    "ore-seam": buildOreSeam,
    "work-lamp": buildWorkLamp,
    "timber-brace": buildTimberBrace,
  };
  // A wall support: two posts and a cap beam flat against a side wall,
  // oriented by `along` ('z' for the west/east walls, 'x' for far/near).
  function buildTimberBrace(module) {
    const [x, z] = module.position;
    const alongZ = module.along !== "x";
    const post = (offset) => box(
      alongZ ? 0.13 : 0.15,
      1.72,
      alongZ ? 0.15 : 0.13,
      materials.timber,
      x + (alongZ ? 0 : offset),
      0.86,
      z + (alongZ ? offset : 0),
    );
    post(-0.52);
    post(0.52);
    box(
      alongZ ? 0.15 : 1.32,
      0.17,
      alongZ ? 1.32 : 0.15,
      materials.timberLight,
      x,
      1.78,
      z,
    );
  }

  for (const module of map.modules) {
    if (module.viewGroup) {
      if (!namedGroups[module.viewGroup]) {
        const sub = new THREE.Group();
        sub.name = `view:${module.viewGroup}`;
        group.add(sub);
        namedGroups[module.viewGroup] = sub;
      }
      parent = namedGroups[module.viewGroup];
    } else {
      parent = group;
    }
    builders[module.kind](module);
  }
  parent = group;

  return {
    group,
    materials,
    environment,
    anchors: map.anchors,
    /** Subgroups for modules declaring viewGroup; pages may toggle these. */
    namedGroups,
    ready,
    /** Texture fetches that failed; populated by the time `ready` settles. */
    errors,
    box,
    rock,
  };
}
