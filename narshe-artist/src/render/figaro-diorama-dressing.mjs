/** Materials lifted from the standalone Figaro diorama's visual language. */
export function createFigaroDioramaDressing({ THREE, makeTex, atlasUrl }) {
  if (!THREE || !makeTex || !atlasUrl) throw new Error('Figaro diorama dressing: incomplete context');

  const panel = (col, row, repeat = 2.5) => {
    const texture = new THREE.TextureLoader().load(atlasUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(0.49 * repeat, 0.323 * repeat);
    texture.offset.set(col * 0.505, (2 - row) * 0.338);
    texture.anisotropy = 8;
    return texture;
  };
  const ash = panel(0, 0, 2.4);
  const ashDark = panel(1, 0, 2.4);
  const crimson = panel(1, 1, 2.0);
  const iron = panel(0, 2, 2.0);
  const sand = panel(1, 2, 2.5);
  const standard = options => new THREE.MeshStandardMaterial(options);

  const sky = makeTex((ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#657f99');
    gradient.addColorStop(0.52, '#91a0a3');
    gradient.addColorStop(0.78, '#d6ae78');
    gradient.addColorStop(1, '#755e55');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const glow = ctx.createRadialGradient(size * 0.28, size * 0.72, 0,
      size * 0.28, size * 0.72, size * 0.3);
    glow.addColorStop(0, 'rgba(255,221,159,.72)');
    glow.addColorStop(1, 'rgba(255,221,159,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);
  }, 512);

  return {
    sky,
    materials: {
      figaroStone: standard({ map: ash, color: 0xf0c789, roughness: 0.92 }),
      figaroTowerStone: standard({ map: ash, color: 0xe1b77d, roughness: 0.94 }),
      figaroCap: standard({ map: ashDark, color: 0xc39b70, roughness: 0.9 }),
      figaroAshlar: standard({ map: ash, color: 0xf4d09a, roughness: 0.88 }),
      sand: standard({ map: sand, color: 0xd0ad72, roughness: 1 }),
      // The playable court is deliberately one quiet sandstone surface. The
      // tile chrome supplies the gameplay grid; the crimson runner supplies
      // the ceremonial axis. No repeated ground motif competes with either.
      cobble: standard({ color: 0xba8b5c, roughness: 0.96 }),
      carpet: standard({ map: crimson, color: 0x9c2743, roughness: 0.9 }),
      figaroIron: standard({ map: iron, color: 0x8796a1, roughness: 0.58, metalness: 0.35 }),
      figaroIronLt: standard({ color: 0xb2bdc4, roughness: 0.45, metalness: 0.48 }),
      figaroBanner: standard({ color: 0x315276, roughness: 0.92, side: THREE.DoubleSide }),
      figaroBannerCrimson: standard({ map: crimson, color: 0x9c2743, roughness: 0.9,
        side: THREE.DoubleSide }),
      figaroFringe: standard({ color: 0xd8aa50, roughness: 0.42, metalness: 0.32 }),
      figaroRubble: standard({ map: ashDark, color: 0xa78765, roughness: 1, flatShading: true }),
      figaroTimber: standard({ color: 0x5a382d, roughness: 0.95 }),
      figaroFlame: standard({ color: 0xffc268, emissive: 0xff8a3d, emissiveIntensity: 2.5 }),
      figaroSoot: new THREE.MeshBasicMaterial({ color: 0x463630, transparent: true, opacity: 0.32 }),
      figaroDark: standard({ map: ashDark, color: 0x584842, roughness: 1 }),
      figaroGold: standard({ color: 0xd8aa50, roughness: 0.42, metalness: 0.32 }),
      figaroGreen: standard({ color: 0x516f4a, roughness: 1 }),
    },
  };
}
