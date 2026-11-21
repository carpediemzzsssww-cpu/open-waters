import * as THREE from 'three';
import { env, withAtmo } from '../core/atmosphere';
import { LIGHT_GEOMETRY } from '../core/env';
import { Batch, M, rng, smoothstep, type Rng } from '../core/util';
import type { BoatInfo } from '../world/build';
import { addCollider, type Collider } from '../world/collide';

const TAU = Math.PI * 2;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
type Point = [number, number, number];
type Island = [x: number, z: number, rx: number, rz: number, height: number, seed: number];
const port: Island = [181, -103, 86, 76, 34, 1.2];
const islands: Island[] = [
  port, [-208, -117, 113, 94, 51, 2.1],
  [-120, -590, 52, 91, 26, 1.6], [189, -828, 72, 76, 38, 6.8],
  [-292, 253, 125, 87, 43, 3.1], [447, 168, 163, 134, 65, 4.1],
  [-585, -380, 245, 201, 93, 5.6], [546, -531, 195, 194, 86, 6.9],
  [-775, -865, 381, 170, 122, 4.7], [950, -987, 396, 262, 126, 1.7],
  [-118, -1340, 237, 153, 58, 1.3], [430, -1540, 308, 147, 79, 7.2],
  [-951, -1590, 423, 231, 133, 2.3], [-480, -2050, 618, 273, 180, 2.8],
  [440, -2470, 813, 395, 219, 1.5], [1510, -2450, 554, 321, 209, 8.5],
  [-819, 901, 542, 261, 170, 8.1], [59, 1206, 391, 192, 78, 6.1],
  [786, 975, 381, 194, 122, 3.1], [1458, -90, 375, 598, 163, 4.1],
  [-1680, -220, 414, 710, 213, 5.8],
];

// Radial shoreline shared by the terrain, collision segments and tree placement.
function coast(a: number, seed: number) {
  return 1 + 0.10 * Math.sin(3 * a + seed) + 0.058 * Math.cos(5 * a - seed) + 0.027 * Math.sin(9 * a + seed);
}

function height(i: Island, a: number, r: number) {
  const seed = i[5];
  const u = Math.cos(a) * r, v = Math.sin(a) * r;
  const mass = Math.max(0, 1 - r * r);
  const ridges = 0.72 + 0.18 * Math.sin(u * 4.4 + seed) * Math.cos(v * 3.7 - seed)
    + 0.11 * Math.cos(u * 8 + v * 2 + seed) * Math.sin(v * 4 - seed);
  return r > 1 ? -2 : i[4] * Math.pow(mass, 1.28) * ridges;
}

function hillPoint(i: Island, a: number, r: number): Point {
  const outline = coast(a, i[5]) * r;
  return [i[0] + Math.cos(a) * outline * i[2], height(i, a, r), i[1] + Math.sin(a) * outline * i[3]];
}

function collideBox(x: number, z: number, w: number, d: number, yaw = 0, round = 0.15) {
  return addCollider({ x, z, hw: w / 2, hl: d / 2, yaw, r: Math.min(round, w / 2, d / 2) });
}

function terrain(scene: THREE.Scene, crowns: THREE.Matrix4[], tints: THREE.Color[], rand: Rng) {
  const pos: number[] = [], colors: number[] = [], ids: number[] = [];
  const forest = new THREE.Color(0x485a48), pine = new THREE.Color(0x324a41);
  const rock = new THREE.Color(0x9a947e), salt = new THREE.Color(0xbbb29a), mixed = new THREE.Color(), foliage = new THREE.Color();
  for (const i of islands) {
    const near = Math.abs(i[0]) < 800 && i[1] > -1100 && i[1] < 525;
    const slices = near ? 96 : 64, rings = near ? 26 : 14;
    const radii = Array.from({ length: rings }, (_, j) => j / rings).concat([0.981, 1, 1.018]);
    const start = pos.length / 3;
    for (let k = 0; k < radii.length; k++) {
      const r = radii[k];
      for (let j = 0; j < slices; j++) {
        const a = TAU * j / slices, [x, y, z] = hillPoint(i, a, r);
        pos.push(x, y, z);
        const shore = smoothstep(0.65, 2.8, y + 0.75 * Math.sin(a * 13 + i[5]));
        const patch = 0.48 + 0.29 * Math.sin(x * 0.047 + z * 0.025) + 0.19 * Math.sin(z * 0.087);
        mixed.copy(rock).lerp(salt, 0.2 + 0.25 * Math.sin(a * 7) ** 2)
          .lerp(foliage.copy(forest).lerp(pine, patch), shore);
        mixed.multiplyScalar(0.92 + 0.12 * Math.cos(x * 0.19 - z * 0.12) * Math.sin(z * 0.17));
        colors.push(mixed.r, mixed.g, mixed.b);
        const next = (j + 1) % slices;
        if (k) {
          const o = start + (k - 1) * slices, n = start + k * slices;
          ids.push(o + j, n + next, n + j, o + j, o + next, n + next);
        }
        if (near && r === 1 && Math.abs(x) < 333 && z <= 296 && z >= -968) {
          const [x2, , z2] = hillPoint(i, TAU * (j + 1) / slices, 1);
          collideBox((x + x2) / 2, (z + z2) / 2, 0.9, Math.hypot(x2 - x, z2 - z) + 0.9, Math.atan2(x2 - x, z2 - z), 0.45);
        }
      }
    }

    if (!near) continue;
    const count = Math.round(Math.min(1000, i[2] * i[3] / 26) * (LIGHT_GEOMETRY ? 0.48 : 1));
    for (let j = 0; j < count; j++) {
      const a = rand() * TAU, r = Math.sqrt(rand()) * 0.98;
      // Leave the port and its first row of houses clear of the tree canopy.
      if (i === port && r > 0.65 && a > 2.05 && a < 4.1) continue;
      const [x, y, z] = hillPoint(i, a, r);
      if (y < 2.5) continue;
      const s = rand.range(1.7, 3.9) * (0.8 + 0.22 * Math.sin(a * 6 + i[5]));
      crowns.push(M(x, y - s * 0.11, z, s * 1.25, s, s * 1.25, rand() * TAU, rand.range(-0.10, 0.10)));
      tints.push(new THREE.Color().setRGB(rand.range(0.64, 1.04), rand.range(0.79, 1.12), rand.range(0.72, 0.98)));
    }
  }

  const land = new THREE.BufferGeometry();
  land.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  land.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  land.setIndex(ids);
  land.computeVertexNormals();
  const mat = withAtmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98 }), 'seto-coast', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vRock;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRock=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vRock;
      float grainHash(vec2 a){return fract(sin(dot(a,vec2(43.7,313.1)))*1731.2);}
      float grove(vec2 p){
        vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(grainHash(a),grainHash(a+vec2(1.,0.)),f.x),
          mix(grainHash(a+vec2(0.,1.)),grainHash(a+vec2(1.)),f.x),f.y);
      }`).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 p=vRock.xz+vRock.y*vec2(.9,-.45);
      float detail=grove(p*.18)*.33+grove(p*.45)*.18;
      diffuseColor.rgb *= 0.76 + detail;
      `);
  });
  const mesh = new THREE.Mesh(land, mat);
  mesh.name = 'Seto · wooded granite islands'; mesh.receiveShadow = true;
  scene.add(mesh);
}

// Draw wind-pruned black pines at twig scale. Intersecting planes keep the sparse
// crown legible from the water and its reflection without thousands of branch meshes.
function pineTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 512;
  const g = canvas.getContext('2d')!, random = rng(2110);
  g.lineCap = 'round';
  const stem = (x1: number, y1: number, x2: number, y2: number, w: number, color: string) => {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  };
  const trunk = [[182, 510], [184, 399], [173, 314], [189, 239], [212, 171], [218, 104], [245, 43]];
  for (let j = 1; j < trunk.length; j++) {
    const a = trunk[j - 1], b = trunk[j];
    stem(a[0], a[1], b[0], b[1], 12 - j * 1.37, '#605a47');
  }
  const pads = (cx: number, cy: number, radius: number) => {
    for (let j = 0; j < 75; j++) {
      const a = random() * TAU, r = Math.sqrt(random());
      const x = cx + Math.cos(a) * radius * r, y = cy + Math.sin(a) * radius * r * .43;
      const highlight = (1 - r) * .45 + random() * .38 - Math.sin(a) * r * .32;
      const v = Math.round(48 + 44 * highlight);
      g.fillStyle = 'rgb(' + v + ',' + (v + 20) + ',' + (v + 8) + ')';
      g.beginPath(); g.ellipse(x, y, random.range(3, 10), random.range(1.5, 4.5), random.range(-.7, .7), 0, TAU); g.fill();
    }
  };
  for (let j = 0; j < 18; j++) {
    const f = j / 18, y = 365 - 304 * f, center = 177 + 61 * f;
    const side = j % 2 ? -1 : 1, length = (137 - 83 * f) * random.range(.64, 1);
    const x1 = center + side * length * .54, x2 = center + side * length;
    const y1 = y + length * .10, y2 = y - random.range(10, 29);
    stem(center, y, x1, y1, 5.4 - 2 * f, '#67634f');
    stem(x1, y1, x2, y2, 3.7 - 2 * f, '#696b54');
    for (let k = 0; k < 5; k++) {
      const t = k / 5, x = x1 + (x2 - x1) * t + random.range(-13, 13), py = y1 + (y2 - y1) * t - random.range(5, 24);
      stem(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, x, py, 1.8, '#686a56');
      pads(x, py, random.range(19, 36) * (1 - f * .2));
    }
  }
  pads(245, 41, 34); pads(248, 32, 22);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function pineCanopy(scene: THREE.Scene, matrices: THREE.Matrix4[], tints: THREE.Color[]) {
  const pos: number[] = [], uv: number[] = [], normal: number[] = [], indices: number[] = [];
  for (let side = 0; side < 3; side++) {
    const a = side * Math.PI / 3, x = Math.cos(a), z = Math.sin(a), k = pos.length / 3;
    pos.push(-x, 0, -z, x, 0, z, x, 2.5, z, -x, 2.5, -z);
    normal.push(-x * .48, .72, -z * .48, x * .48, .72, z * .48, x * .2, .96, z * .2, -x * .2, .96, -z * .2);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1); indices.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(indices);
  const mat = withAtmo(new THREE.MeshStandardMaterial({ map: pineTexture(), roughness: 1, side: THREE.DoubleSide, alphaTest: 0.32 }));
  mat.alphaToCoverage = true;
  const canopy = new THREE.InstancedMesh(geo, mat, matrices.length);
  matrices.forEach((m, j) => { canopy.setMatrixAt(j, m); canopy.setColorAt(j, tints[j]); });
  canopy.name = 'Seto · black pine groves';
  scene.add(canopy);
}

const steel = 0xd8d7cb, steelShade = 0x9fa8a4, concrete = 0x98978a, asphalt = 0x646965;
function suspensionBridge(b: Batch, lamps: Batch) {
  const deckY = 31, towerY = 83, towerX = 146;
  const zAt = (x: number) => -434 - x * 0.105;
  b.box(0, deckY, zAt(0), 982, 1.55, 9.1, asphalt, Math.atan(0.105));
  // The two approach embankments end inside the large islands.
  for (const side of [-1, 1]) {
    for (const x of [-350, -270, -towerX, towerX, 270, 350]) {
      const z = zAt(x) + side * 5.3;
      const tower = Math.abs(x) === towerX;
      b.limb([x, -2, z], [x, 1.6, z], tower ? 3.1 : 2.1, tower ? 3.1 : 2.1, concrete, 12);
      b.limb([x, 1.6, z], [x, tower ? towerY : deckY, z - side * 1.0], tower ? 2.0 : 1.25, tower ? 1.12 : 1.25, tower ? steel : concrete, 4);
      if (Math.abs(x) < 330) collideBox(x, z, tower ? 6.2 : 4.2, tower ? 6.2 : 4.2, 0, 2.0);
    }
    const sideZ = (x: number) => zAt(x) + side * 4.55;
    const mainCable = (x: number) => {
      const u = Math.abs(x) / towerX;
      return u <= 1 ? 39 + (towerY - 39) * u * u : 29 + 54 * Math.pow(Math.max(0, 1 - (Math.abs(x) - towerX) / 202), 1.9);
    };
    for (let x = -480; x < 480; x += 8) {
      const z = sideZ(x), z1 = sideZ(x + 8);
      b.limb([x, deckY - 2.3, z], [x + 8, deckY - 2.3, z1], 0.25, 0.25, steelShade, 4);
      b.limb([x, deckY - 2.3, z], [x + 4, deckY, zAt(x + 4) + side * 4.55], 0.16, 0.16, steel, 4);
      b.limb([x + 4, deckY, zAt(x + 4) + side * 4.55], [x + 8, deckY - 2.3, z1], 0.16, 0.16, steel, 4);
      b.limb([x, deckY + 1.65, z], [x + 8, deckY + 1.65, z1], 0.12, 0.12, steel, 4);
      if (x >= -344 && x < 344) {
        b.limb([x, mainCable(x), z], [x + 8, mainCable(x + 8), z1], 0.41, 0.41, steel, 7);
        b.limb([x, deckY, z], [x, mainCable(x), z], 0.13, 0.13, steelShade, 5);
      }
      if (x % 32 === 0) {
        b.limb([x, deckY, z], [x, deckY + 4.4, z], 0.095, 0.065, steelShade, 6);
        lamps.box(x, deckY + 4.5, z, 0.44, 0.23, 0.34, 0xffdd9a);
      }
    }
  }

  for (const x of [-towerX, towerX]) {
    for (const y of [22, 52, 78]) b.box(x, y, zAt(x), 2.7, 2.0, 10.2, steel);
    for (const y of [33, 54]) {
      b.limb([x, y, zAt(x) - 4.55], [x, y + 21, zAt(x) + 4.55], 0.50, 0.50, steel, 4);
      b.limb([x, y, zAt(x) + 4.55], [x, y + 21, zAt(x) - 4.55], 0.50, 0.50, steel, 4);
    }
  }
}

function harborHouse(b: Batch, lamps: Batch, w: number, d: number, h: number, base: number, rand: Rng) {
  const plaster = rand.pick([0xbca98e, 0xb8ad97, 0x9e947e]);
  const timber = rand.pick([0x5a4c3e, 0x635647, 0x534a3f]);
  const roof = rand.pick([0x424b51, 0x54575a, 0x4f5454]);
  const woodFace = rand() < 0.68;
  const face = woodFace ? timber : plaster;
  // Carry the raised floor into the slope, including the lowest downhill corner.
  b.box(0, -base / 2, 0, w + 0.36, base, d + 0.36, 0x777366);
  b.box(0, 0.09, 0, w + 0.46, 0.18, d + 0.46, 0x888472);
  b.box(0, h / 2 + 0.12, 0, w, h, d, face);
  const roofRise = d * 0.31, overhang = 0.58, run = d / 2 + overhang;
  const eave = h + 0.14, ridge = eave + roofRise, roofPitch = Math.atan2(roofRise, run);
  for (const s of [-1, 1]) {
    b.add(unitBox, M(0, eave + roofRise / 2, s * run / 2, w + 1.04, 0.16,
      Math.hypot(run, roofRise), 0, s * roofPitch), roof);
    b.box(0, eave - 0.10, s * run, w + 1.06, 0.17, 0.14, 0x514a40);
    // Low ridges of fired clay tile catch the raking light.
    for (let x = -w / 2 - 0.40; x < w / 2 + 0.47; x += 0.31) {
      b.add(unitBox, M(x, eave + roofRise / 2 + 0.10, s * run / 2, 0.105, 0.075,
        Math.hypot(run, roofRise), 0, s * roofPitch), roof);
    }
    const edge = s * w / 2;
    const a = new THREE.Vector3(edge, eave - 0.04, -s * d / 2);
    const c = new THREE.Vector3(edge, eave - 0.04, s * d / 2);
    const top = new THREE.Vector3(edge, ridge - 0.08, 0);
    b.quad(a, top, c, c, face);
    // End walls have a small attic vent and a sheltered side window.
    b.box(edge + s * 0.04, eave + roofRise * 0.31, 0, 0.10, 0.35, 0.73, timber);
    b.box(edge + s * 0.05, 1.7, 0, 0.11, 1.15, 1.63, 0x4d5754);
    for (const z of [-0.80, -0.27, 0.27, 0.80]) b.box(edge + s * 0.12, 1.70, z, 0.12, 1.19, 0.065, timber);
    b.box(edge + s * 0.21, 2.42, 0, 0.56, 0.13, 2.02, roof);
  }
  b.box(0, ridge + 0.14, 0, w + 1.22, 0.26, 0.34, roof);

  // The main facade always faces the quay (local +Z).
  const z = d / 2;
  for (let x = -w / 2 + 0.09; x < w / 2; x += woodFace ? 0.32 : w / 3) {
    b.box(x, h * 0.5 + 0.12, z + 0.025, woodFace ? 0.035 : 0.14, h, 0.055, timber);
  }
  const bays = Math.max(3, Math.floor(w / 1.65)), bay = (w - 0.40) / bays;
  const floors = Math.floor(h / 2.5), doorIndex = rand() < 0.5 ? 0 : bays - 1;
  for (let row = 0; row < floors; row++) {
    for (let j = 0; j < bays; j++) {
      const x = (j + 0.5 - bays / 2) * bay;
      const door = row === 0 && j === doorIndex;
      const y = (door ? 1.20 : 1.67) + row * 2.50;
      const opening = door ? 2.12 : 1.30;
      b.box(x, y, z + 0.055, bay - 0.14, opening, 0.12, 0x3e3a32);
      b.box(x, y + 0.035, z + 0.12, bay - 0.29, opening - 0.19, 0.06, door ? 0x5b5245 : 0x637171);
      if (!door && rand() < 0.32) lamps.box(x, y + 0.035, z + 0.16, bay - 0.31, opening - 0.20, 0.01, 0xffcd92);
      const bars = door ? 6 : 3;
      for (let k = 1; k < bars; k++) b.box(x + (k / bars - 0.5) * (bay - 0.25), y, z + 0.18, 0.046, opening - 0.17, 0.055, timber);
      b.box(x, y - 0.07, z + 0.18, bay - 0.19, 0.065, 0.065, timber);
    }
  }
  for (const x of [-w / 2 + 0.09, w / 2 - 0.09]) b.box(x, h / 2, z + 0.08, 0.16, h, 0.18, timber);
  // Shallow entrance awning; wrappers for nets and buckets can be kept dry below it.
  b.add(unitBox, M(0, 2.64, z + 0.43, w + 0.16, 0.12, 1.03, 0, 0.13), roof);
  b.box(0, 0.14, z + 0.46, w - 0.1, 0.26, 0.83, 0x837861);
  for (const s of [-1, 1]) b.box(s * (w / 2 - 0.23), 1.46, z + 0.80, 0.11, 2.53, 0.11, timber);
  b.box(-w / 2 + 0.20, h / 2, z + 0.15, 0.09, h - 0.15, 0.11, 0x6b6e65);
}

function quaySegment(b: Batch, a: number, a1: number, rand: Rng) {
  const p = hillPoint(port, a, 1), q = hillPoint(port, a1, 1);
  const dx = q[0] - p[0], dz = q[2] - p[2], length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz), x = (p[0] + q[0]) / 2, z = (p[2] + q[2]) / 2;
  const outer = 1.02;
  const blockColors = [0x878676, 0x75786d, 0x858477, 0x777869, 0x939083];
  const local = new Batch();
  local.box(-0.9, -0.05, 0, 3.90, 2.72, length + 0.26, 0x737364);
  // Rough ashlar joints; use actual courses at the waterline where the boat can approach.
  for (let row = 0; row < 3; row++) {
    let along = -length / 2;
    while (along < length / 2 - 0.05) {
      const span = Math.min(rand.range(0.73, 1.42), length / 2 - along);
      const color = rand.pick(blockColors);
      local.box(outer, row * 0.46 + 0.06, along + span / 2, 0.18, 0.421, span - 0.035, color);
      along += span;
    }
  }
  local.box(-0.76, 1.36, 0, 4.09, 0.15, length + 0.12, 0xada996);
  local.limb([0.64, 1.45, 0], [0.64, 1.83, 0], 0.13, 0.10, 0x554b3e);
  local.limb([0.64, 1.82, 0], [0.64, 1.88, 0], 0.22, 0.22, 0x554b3e);
  b.addBatch(local, M(x, 0, z, 1, 1, 1, yaw));
  collideBox(x, z, 2.68, length + 0.25, yaw);
  if (Math.abs(a - 2.58) < 0.036 || Math.abs(a - 3.75) < 0.036) {
    // A landing below the coping is reachable from the quay at low tide.
    const stairs = new Batch();
    for (let j = 0; j < 8; j++) {
      const h = 1.81 - j * 0.20;
      stairs.box(2.05, -0.42 + h / 2, -1.43 + j * 0.41, 1.72, h, 0.42, 0x888776);
    }
    b.addBatch(stairs, M(x, 0, z, 1, 1, 1, yaw));
    collideBox(x + 2.05 * Math.cos(yaw), z - 2.05 * Math.sin(yaw), 1.76, 3.45, yaw);
  }
}

function village(b: Batch, lamps: Batch, rand: Rng) {
  // A continuous granite quay ties both rows of houses to the tide line.
  for (let a = 2.00; a < 4.14; a += 0.072) quaySegment(b, a, a + 0.072, rand);
  const wirePosts: Point[] = [];
  for (let row = 0; row < 2; row++) {
    for (let j = 0; j < 12; j++) {
      const a = 2.11 + j * 0.164 + (row ? 0.036 : 0);
      const radius = row ? 0.76 : 0.905;
      const [x, y, z] = hillPoint(port, a, radius);
      const floorY = row ? y + 0.18 : Math.max(1.44, y + 0.10);
      const house = new Batch(), windows = new Batch();
      const w = rand.range(5.3, 7.8), d = rand.range(4.6, 6.1);
      harborHouse(house, windows, w, d, rand.pick([3.05, 3.25, 5.52]), floorY + 0.55, rand);
      const rotation = Math.PI / 2 - a;
      const world = M(x, floorY, z, 1, 1, 1, rotation);
      b.addBatch(house, world); lamps.addBatch(windows, world);
      if (row === 0 && j % 2 === 0) {
        const [px, , pz] = hillPoint(port, a + 0.061, 0.96);
        b.limb([px, 0.55, pz], [px, 7.26, pz], 0.13, 0.105, 0x665747, 8);
        b.limb([px, 6.9, pz - 0.62], [px, 6.9, pz + 0.62], 0.085, 0.085, 0x5d5950, 5);
        wirePosts.push([px, 6.88, pz]);
      }
      // Salt bleaches the timber and canvas; crates accumulate by the working doors.
      if (row === 0 && j % 3 === 0) {
        const crates = new Batch();
        crates.box(w / 2 + 0.6, -floorY / 2, d / 2 - 0.1, 1.31, floorY + 0.14, 1.13, 0x827e70);
        for (let k = 0; k < 3; k++) {
          crates.box(w / 2 + 0.6, 0.26 + k * 0.32, d / 2 - 0.1, 1.0, 0.32, 0.74, k === 1 ? 0x627e7d : 0x887859);
          crates.box(w / 2 + 0.6, 0.40 + k * 0.32, d / 2 - 0.1, 1.05, 0.065, 0.79, 0x797767);
        }
        b.addBatch(crates, world);
      }
    }
  }
  for (let j = 1; j < wirePosts.length; j++) {
    const a = wirePosts[j - 1], c = wirePosts[j];
    for (const offset of [-0.47, 0.47]) {
      let previous: Point = [a[0], a[1], a[2] + offset];
      for (let k = 1; k <= 6; k++) {
        const f = k / 6;
        const next: Point = [a[0] + (c[0] - a[0]) * f, a[1] - 0.61 * Math.sin(Math.PI * f), a[2] + (c[2] - a[2]) * f + offset];
        b.limb(previous, next, 0.030, 0.030, 0x514e48, 4);
        previous = next;
      }
    }
  }
}

function beacon(b: Batch, lamps: Batch, x: number, z: number, y: number) {
  const red = 0xb23d31, dark = 0x5d3b33;
  b.limb([x, y, z], [x, y + 0.7, z], 2.3, 2.0, concrete, 20);
  b.limb([x, y + 0.7, z], [x, y + 6.8, z], 1.32, 0.88, red, 20);
  b.limb([x, y + 6.8, z], [x, y + 7.0, z], 1.35, 1.35, dark, 20);
  lamps.limb([x, y + 7.12, z], [x, y + 8.13, z], 0.62, 0.62, 0xff8250, 12);
  for (let j = 0; j < 10; j++) {
    const a = j * TAU / 10, a1 = (j + 1) * TAU / 10;
    const dx = Math.cos(a), dz = Math.sin(a);
    b.limb([x + dx * 1.27, y + 7, z + dz * 1.27], [x + dx * 1.27, y + 7.70, z + dz * 1.27], 0.048, 0.048, dark, 4);
    b.limb([x + dx * 1.27, y + 7.70, z + dz * 1.27], [x + Math.cos(a1) * 1.27, y + 7.70, z + Math.sin(a1) * 1.27], 0.055, 0.055, dark, 4);
    b.limb([x + dx * 0.71, y + 7, z + dz * 0.71], [x + dx * 0.71, y + 8.2, z + dz * 0.71], 0.048, 0.048, red, 4);
  }
  b.limb([x, y + 8.2, z], [x, y + 8.75, z], 0.92, 0, red, 16);
}

function breakwater(b: Batch, x1: number, z1: number, x2: number, z2: number, width: number) {
  const yaw = Math.atan2(x2 - x1, z2 - z1), length = Math.hypot(x2 - x1, z2 - z1), x = (x1 + x2) / 2, z = (z1 + z2) / 2;
  b.box(x, -0.45, z, width, 3.55, length, concrete, yaw);
  b.box(x, 1.37, z, width + 0.12, 0.20, length, 0xbab5a4, yaw);
  collideBox(x, z, width, length, yaw);
}

function mooredBoats(b: Batch) {
  for (let j = 0; j < 4; j++) {
    const x = 100.8, z = -107 + j * 8.9;
    const local = new Batch();
    const paint = [0x5c8790, 0x6a8586, 0x587a89, 0x9b6250][j];
    const rings = [[-3.25, 0.06], [-2.2, 0.93], [0, 1.15], [2.55, 0.85], [2.9, 0.63]];
    for (let k = 1; k < rings.length; k++) {
      const [za, wa] = rings[k - 1], [zb, wb] = rings[k];
      for (const side of [-1, 1]) {
        const pts = [new THREE.Vector3(side * wa * 0.70, -0.27, za), new THREE.Vector3(side * wa, 0.63, za),
        new THREE.Vector3(side * wb, 0.63, zb), new THREE.Vector3(side * wb * 0.7, -0.27, zb)];
        if (side < 0) pts.reverse();
        local.quad(pts[0], pts[1], pts[2], pts[3], paint);
      }
    }
    local.box(0, 0.44, 0.2, 1.55, 0.21, 4.9, 0xb5b8a9);
    local.box(0, 0.93, -0.5, 1.32, 0.8, 1.29, 0xc8c1ac);
    local.box(0, 1.08, -1.16, 1.14, 0.39, 0.05, 0x526b72);
    local.box(0, 1.43, -0.5, 1.67, 0.14, 1.6, 0xe1d7bc);
    local.limb([0.54, 1.37, 0], [0.54, 3.0, 0], 0.046, 0.036, steel, 4);
    // The bow and stern lines sag toward iron cleats set into the quay.
    for (const end of [-1, 1]) {
      const from: Point = [x + 0.92, 0.55, z + end * 1.9];
      const to: Point = [105.7, 1.57, z + end * 3.75];
      const sag: Point = [(from[0] + to[0]) / 2, 0.61, (from[2] + to[2]) / 2];
      b.limb(from, sag, 0.045, 0.045, 0x776b51, 4);
      b.limb(sag, to, 0.045, 0.045, 0x776b51, 4);
      b.box(to[0], to[1], to[2], 0.38, 0.17, 0.12, 0x514f45);
      b.add(new THREE.TorusGeometry(0.31, 0.117, 6, 14), M(104.86, 0.75, z + end * 2.33, 1, 1, 1, -Math.PI / 2), 0x404543);
    }
    local.box(-0.36, 0.61, 1.45, 0.61, 0.23, 0.85, 0x8b7b58);
    local.ell(0.36, 0.69, 1.82, 0.28, 0.20, 0.24, 0xae6950);
    b.addBatch(local, M(x, 0, z));
    collideBox(x, z, 2.30, 6.18, 0, 0.72);
  }
}

type Ferry = { mesh: THREE.Group; collider: Collider; phase: number };
export const ferryTraffic: BoatInfo = { x: 0, z: 0, heading: 0, speed: 0, length: 19.4 };
let ferry: Ferry | undefined;
let lightMaterial: THREE.MeshBasicMaterial | undefined;

function buildFerry(scene: THREE.Scene, mat: THREE.Material) {
  const hull = new Batch(), white = 0xddd9c5, blue = 0x396979;
  const sections = [[-10, 0.09, 1.6], [-8.7, 1.62, 1.48], [-6.1, 2.68, 1.33], [5.8, 2.68, 1.33], [9.4, 2.35, 1.33]];
  for (let j = 1; j < sections.length; j++) {
    const [za, wa, ha] = sections[j - 1], [zb, wb, hb] = sections[j];
    for (const side of [-1, 1]) {
      const quad = (a: Point, b: Point, c: Point, d: Point, tint: number) => {
        if (side < 0) [a, b, c, d] = [d, c, b, a];
        hull.quad(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(...c), new THREE.Vector3(...d), tint);
      };
      quad([side * wa * 0.82, -0.35, za], [side * wa, 0.68, za], [side * wb, 0.68, zb], [side * wb * 0.82, -0.35, zb], blue);
      quad([side * wa, 0.68, za], [side * wa, ha, za], [side * wb, hb, zb], [side * wb, 0.68, zb], white);
    }
    hull.quad(new THREE.Vector3(-wa, ha, za), new THREE.Vector3(-wb, hb, zb), new THREE.Vector3(wb, hb, zb), new THREE.Vector3(wa, ha, za), white);
  }
  hull.box(0, 0.45, 9.4, 4.65, 1.75, 0.16, blue);
  hull.box(0, 2.03, -1, 4.32, 1.52, 10.2, white);
  hull.box(0, 2.35, -6.12, 3.9, 0.54, 0.09, 0x425762);
  for (const side of [-1, 1]) for (let j = 0; j < 8; j++) hull.box(side * 2.18, 2.26, -5.35 + j * 1.16, 0.05, 0.62, 0.83, 0x425762);
  hull.box(0, 2.90, 0, 4.98, 0.27, 13.3, white);
  hull.box(0, 3.46, -3.1, 3.51, 1.0, 3.1, white);
  hull.box(0, 3.53, -4.66, 3.15, 0.50, 0.07, 0x3d515c);
  hull.box(0, 4.05, -3.0, 3.89, 0.17, 3.51, white);
  hull.box(0, 3.63, 2.8, 1.17, 1.49, 1.38, 0xad4f3b);
  hull.box(0, 4.4, 2.8, 1.18, 0.27, 1.39, 0x363f42);
  for (const s of [-1, 1]) for (const z of [5, 8.6]) hull.limb([s * 2.04, 1.35, z], [s * 2.04, 2.82, z], 0.09, 0.09, white);
  hull.limb([0, 4.15, -3.8], [0, 6.75, -3.8], 0.075, 0.04, white);
  hull.limb([-1.02, 6.13, -3.8], [1.02, 6.13, -3.8], 0.064, 0.064, white);
  const group = new THREE.Group();
  group.name = 'Seto · island ferry';
  group.add(hull.mesh(mat)); scene.add(group);
  ferry = { mesh: group, collider: addCollider({ x: 0, z: 0, hl: 9.9, hw: 2.68, r: 1.1, yaw: 0, moving: true }), phase: -0.85 };
}

export function buildSeto(scene: THREE.Scene): void {
  const rand = rng(716), crowns: THREE.Matrix4[] = [], tints: THREE.Color[] = [];
  terrain(scene, crowns, tints, rand); pineCanopy(scene, crowns, tints);
  const fixed = new Batch(), lamps = new Batch();
  suspensionBridge(fixed, lamps);
  village(fixed, lamps, rand);
  breakwater(fixed, 107, -110, 107, -64, 4.1);
  breakwater(fixed, 106, -66, 130, -44, 3.65);
  mooredBoats(fixed);
  // West mole at the sheltered end of the opposing island.
  breakwater(fixed, -122, -74, -90, -57, 4.4);
  breakwater(fixed, -90, -57, -85, -82, 4.4);
  beacon(fixed, lamps, -85, -81, 1.47);

  const mat = withAtmo(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }), 'seto-weathering', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vPier;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPier=position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vPier;
      float saltGrain(vec2 a){return fract(sin(dot(a,vec2(47.2,185.1)))*2341.7);}
      float saltNoise(vec2 p){vec2 a=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(saltGrain(a),saltGrain(a+vec2(1.,0.)),f.x),
          mix(saltGrain(a+vec2(0.,1.)),saltGrain(a+vec2(1.)),f.x),f.y);}
      `).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 uvSalt=vec2(vPier.x+.73*vPier.z,vPier.y*.83+vPier.z*.17);
      float tide=smoothstep(.05,.65,vPier.y+saltNoise(uvSalt*2.)*.23);
      diffuseColor.rgb*=mix(vec3(.54,.62,.55),vec3(1.),tide)
        *(.82+.26*saltNoise(uvSalt*4.)+.12*saltNoise(uvSalt*18.));
      `);
  });
  scene.add(fixed.mesh(mat, 1, { name: 'Seto · crossing and fishing port' }));
  lightMaterial = withAtmo(new THREE.MeshBasicMaterial({ vertexColors: true }));
  scene.add(lamps.mesh(lightMaterial, 1, { cast: false, receive: false, name: 'Seto · harbor lights' }));
  buildFerry(scene, mat);
  updateSeto(0);
}

export function updateSeto(dt: number): void {
  if (!ferry || !lightMaterial) return;
  lightMaterial.color.setScalar(0.32 + 3.6 * env.night);
  ferry.phase += dt * 0.009;
  const { phase, mesh, collider } = ferry;
  const x = 65 + 13 * Math.sin(phase), z = -367 + 234 * Math.cos(phase);
  const dx = 13 * Math.cos(phase) * 0.009, dz = -234 * Math.sin(phase) * 0.009;
  const yaw = Math.atan2(-dx, -dz);
  ferryTraffic.x = x;
  ferryTraffic.z = z;
  ferryTraffic.heading = yaw;
  ferryTraffic.speed = Math.hypot(dx, dz);
  mesh.position.set(x, 0.055 * Math.sin(phase * 93), z);
  mesh.rotation.set(0.004 * Math.cos(phase * 57), yaw, 0.006 * Math.sin(phase * 41), 'YXZ');
  collider.x = x; collider.z = z; collider.yaw = yaw;
}
