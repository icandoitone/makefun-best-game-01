// Neon Streets — the procedural night city. One job: build the world geometry
// (ground, roads, blocks, buildings, props) and hand back the building
// collision boxes. Layout is deterministic per seed.
import * as THREE from '../vendor/three/three.module.min.js';
import { CONFIG, makeRng, streetCoords } from './config.js';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A facade: dark glass with a grid of lit and dark windows.
function facadeTexture(base, lit) {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const cols = 8, rows = 16, cw = w / cols, ch = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const on = Math.random() < 0.45;
        g.fillStyle = on ? lit : '#0a1220';
        g.fillRect(c * cw + 2, r * ch + 3, cw - 4, ch - 6);
      }
    }
  });
}

// One road strip texture: asphalt with a dashed centre line and edge lines.
function roadTexture() {
  const t = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#23262e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#2e323d';
    for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    g.fillStyle = '#e8c33a';
    g.fillRect(w / 2 - 2, 8, 4, 34);
    g.fillRect(w / 2 - 2, 74, 4, 34);
    g.fillStyle = '#c8ccd4';
    g.fillRect(3, 0, 2, h); g.fillRect(w - 5, 0, 2, h);
  });
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildCity(scene) {
  const { step, roadWidth, half } = CONFIG.city;
  const rng = makeRng(1337);
  const group = new THREE.Group();
  const buildings = []; // AABBs for collision: {minX,maxX,minZ,maxZ}
  const streets = streetCoords();

  // Ground.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(half * 2 + 80, half * 2 + 80),
    new THREE.MeshLambertMaterial({ color: 0x0b0e16 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  group.add(ground);

  // Roads: one textured strip per street, both directions.
  const roadTex = roadTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
  const roadLen = half * 2 + roadWidth;
  const repeats = Math.round(roadLen / 24);
  for (const c of streets) {
    for (const dir of [0, 1]) {
      const tex = roadTex.clone();
      tex.needsUpdate = true;
      tex.repeat.set(repeats, 1);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(roadLen, roadWidth),
        new THREE.MeshLambertMaterial({ map: tex }),
      );
      m.rotation.x = -Math.PI / 2;
      if (dir === 1) m.rotation.z = Math.PI / 2;
      m.position.set(dir === 0 ? 0 : c, dir === 0 ? 0.015 : 0.02, dir === 0 ? c : 0);
      group.add(m);
    }
  }

  // Blocks: pale sidewalk slabs between the streets; buildings sit on them.
  const blockMat = new THREE.MeshLambertMaterial({ color: 0x2a2f3a });
  const blockSize = step - roadWidth;
  const facadeMats = [
    new THREE.MeshLambertMaterial({ map: facadeTexture('#1a2233', '#ffd76a'), emissive: 0x222222 }),
    new THREE.MeshLambertMaterial({ map: facadeTexture('#241a2e', '#7de3ff'), emissive: 0x222222 }),
    new THREE.MeshLambertMaterial({ map: facadeTexture('#1e2a22', '#ffb36b'), emissive: 0x222222 }),
  ];
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x141824 });
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const neonCols = [0x29e6ff, 0xff2e88, 0xffc233, 0x7dff9b, 0xb46bff];

  for (let i = 0; i < streets.length - 1; i++) {
    for (let j = 0; j < streets.length - 1; j++) {
      const cx = streets[i] + step / 2;
      const cz = streets[j] + step / 2;
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(blockSize, blockSize), blockMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(cx, 0.008, cz);
      group.add(slab);
      // One to three buildings per block, kept off the slab edge.
      const n = 1 + Math.floor(rng() * 3);
      for (let b = 0; b < n; b++) {
        const w = 8 + rng() * 12;
        const d = 8 + rng() * 12;
        const h = 7 + rng() * rng() * 26;
        const bx = cx + (rng() - 0.5) * (blockSize - w - 4);
        const bz = cz + (rng() - 0.5) * (blockSize - d - 4);
        const mesh = new THREE.Mesh(unitBox, facadeMats[Math.floor(rng() * facadeMats.length)]);
        mesh.scale.set(w, h, d);
        mesh.position.set(bx, h / 2, bz);
        group.add(mesh);
        const roof = new THREE.Mesh(unitBox, roofMat);
        roof.scale.set(w + 0.4, 0.5, d + 0.4);
        roof.position.set(bx, h + 0.25, bz);
        group.add(roof);
        buildings.push({ minX: bx - w / 2, maxX: bx + w / 2, minZ: bz - d / 2, maxZ: bz + d / 2 });
        // A neon sign on some tall buildings.
        if (h > 16 && rng() < 0.5) {
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 5),
            new THREE.MeshBasicMaterial({ color: neonCols[Math.floor(rng() * neonCols.length)] }),
          );
          sign.position.set(bx + w / 2 + 0.1, h * 0.55, bz);
          sign.rotation.y = Math.PI / 2;
          group.add(sign);
        }
      }
      // A tree or two on the block corner.
      if (rng() < 0.6) {
        const tx = cx + (rng() - 0.5) * (blockSize - 6);
        const tz = cz + (rng() - 0.5) * (blockSize - 6);
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.35, 2.2, 6),
          new THREE.MeshLambertMaterial({ color: 0x4a3220 }),
        );
        trunk.position.set(tx, 1.1, tz);
        group.add(trunk);
        const top = new THREE.Mesh(
          new THREE.ConeGeometry(1.8, 4.5, 8),
          new THREE.MeshLambertMaterial({ color: 0x1d4a2a }),
        );
        top.position.set(tx, 4.2, tz);
        group.add(top);
      }
    }
  }

  // Streetlights at every other intersection (emissive head, no real light).
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  for (let i = 0; i < streets.length; i += 2) {
    for (let j = 0; j < streets.length; j += 2) {
      const x = streets[i] + roadWidth / 2 + 1;
      const z = streets[j] + roadWidth / 2 + 1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6, 6), poleMat);
      pole.position.set(x, 3, z);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), lampMat);
      lamp.position.set(x, 6.1, z);
      group.add(lamp);
    }
  }

  // A glowing ring at the city edge so the boundary reads in the dark.
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(half + 6, half + 7, 64),
    new THREE.MeshBasicMaterial({ color: 0x29e6ff, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }),
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.03;
  group.add(edge);

  scene.add(group);
  return { group, buildings };
}

// Clamp a point inside the drivable city (with a margin).
export function clampToCity(x, z, margin) {
  const { half } = CONFIG.city;
  const m = half - (margin || 4);
  return [Math.max(-m, Math.min(m, x)), Math.max(-m, Math.min(m, z))];
}
