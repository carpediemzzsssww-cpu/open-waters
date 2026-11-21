import * as THREE from 'three';
import { Batch, clamp, M, rng, smoothstep } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { paintBatch, put, type BoatInfo, type Ctx, type Part } from './build';
import { PAINT } from './materials';
import { LampSet } from './lamps';
import { addCollider, type Collider } from './collide';
import { playerRef } from './boat';
import { HALF, lampSpots, LOW_Y, type LampSpot } from './river';

/**
 * 河上别的船：
 * - 靠在下层码头边的驳船（péniche），有的住人，有一条改成了露天酒吧，挂着一串串灯泡；
 * - 一条逆流而上的游船（bateau-mouche），一条顺流的小客船；它们经过后，尾波会把我们晃几下；
 * - 石阶边系着的几条小划艇。
 */
export const terraces: { x: number; y: number; z: number; len: number; wid: number }[] = [];

interface Sets { hull: Batch; plain: Batch; win: Batch; iron: Batch }

function peniche(b: Sets, cx: number, cz: number, len: number, color: number, r: ReturnType<typeof rng>, bar: boolean, spots: LampSpot[]) {
  const t = new Batch(), p = new Batch(), w = new Batch();
  const hw = 2.5, L = len;
  addCollider({ x: cx, z: cz, yaw: 0, hw: 2.6, hl: len / 2 + 0.7, r: 0.35 });
  t.box(0, 0.45, 0, hw * 2, 1.5, L - 5, color);
  t.add(new THREE.CylinderGeometry(hw, hw * 0.92, 1.5, 14, 1, false, -Math.PI / 2, Math.PI), M(0, 0.45, -(L - 5) / 2, 1, 1, 1.25, Math.PI), color, [1, 1]);
  t.add(new THREE.CylinderGeometry(hw, hw * 0.95, 1.5, 12, 1, false, -Math.PI / 2, Math.PI), M(0, 0.45, (L - 5) / 2, 1, 1, 0.7, 0), color, [1, 1]);
  t.box(0, 0.06, 0, hw * 2 + 0.03, 0.22, L - 5, 0x6e2a22); // 水线
  p.box(0, 1.24, 0, hw * 2 + 0.1, 0.1, L - 5, 0xb5ae9e); // 舷缘
  p.box(0, 1.2, 0, hw * 2 - 0.3, 0.06, L - 4, 0x4b4f4a); // 甲板
  // 舱：一长条矮房子，侧面一排小窗
  const cabL = L * 0.56, cabZ = -L * 0.08;
  p.box(0, 1.72, cabZ, 4.1, 1.0, cabL, bar ? 0xb9b2a2 : r.pick([0xb8b2a4, 0x9a968c, 0x4d5a50, 0x6a3530, 0x3e4a5a]));
  p.box(0, 2.26, cabZ, 4.3, 0.09, cabL + 0.3, 0x3c403e);
  for (let z = cabZ - cabL / 2 + 1.2; z < cabZ + cabL / 2 - 0.8; z += 1.9)
    for (const sx of [-1, 1]) w.box(sx * 2.06, 1.82, z, 0.03, 0.46, 0.95, r() < 0.62 ? 0xffffff : 0x000000);
  // 驾驶室
  const wz = L / 2 - 5.2;
  p.box(0, 2.5, wz, 3.2, 2.5, 2.9, r.pick([0xbdb7a8, 0xa9a59a, 0xc9c2b0]));
  p.box(0, 3.8, wz, 3.6, 0.1, 3.3, 0x3c403e);
  for (const sx of [-1, 1]) w.box(sx * 1.62, 2.9, wz, 0.03, 0.8, 2.1, r() < 0.5 ? 0xffffff : 0x000000);
  w.box(0, 2.9, wz - 1.46, 2.6, 0.8, 0.03, 0x000000);
  w.box(0, 2.9, wz + 1.46, 2.6, 0.8, 0.03, r() < 0.5 ? 0xffffff : 0x000000);
  p.add(new THREE.TorusGeometry(0.3, 0.07, 6, 14), M(1.63, 2.0, wz + 1.0, 1, 1, 1, Math.PI / 2), 0xd8552c, [1, 1]);
  p.limb([0, 3.8, wz], [0, 6.2, wz], 0.04, 0.025, 0x3a3a3a);
  // 花盆
  for (let i = 0; i < Math.floor(cabL / 2.2); i++) {
    if (r() < 0.35) continue;
    const z = cabZ - cabL / 2 + 0.8 + i * 2.2, sx = r.sign();
    p.box(sx * 1.6, 2.42, z, 0.5, 0.26, 0.5, 0x9c5a3c);
    p.ell(sx * 1.6, 2.78, z, 0.42, 0.36, 0.42, r.pick([0x4a6a34, 0x5d7a3a, 0x3d5a30]));
    if (r() < 0.5) p.ell(sx * 1.6 + 0.1, 2.98, z, 0.16, 0.12, 0.16, r.pick([0xc94a5a, 0xe8c24a, 0xe9e2e8]));
  }
  if (bar) {
    // 屋顶改成的露台：四根杆子、几串灯泡、几把收起来的伞
    const y = 2.32, tz0 = cabZ - cabL / 2 + 0.6, tz1 = cabZ + cabL / 2 - 0.6;
    p.box(0, y + 0.03, cabZ, 4.2, 0.06, cabL, 0x8a6a48);
    const poles: [number, number][] = [];
    for (const z of [tz0, (tz0 + tz1) / 2, tz1]) for (const sx of [-1, 1]) {
      poles.push([sx * 2.0, z]);
      p.limb([sx * 2.0, y, z], [sx * 2.0, y + 3.0, z], 0.035, 0.03, 0x2a2a2a);
    }
    for (const sx of [-1, 1]) {
      p.box(sx * 2.05, y + 0.95, cabZ, 0.04, 0.05, cabL, 0x2a2a2a);
      for (let z = tz0; z <= tz1; z += 1.4) p.box(sx * 2.05, y + 0.5, z, 0.03, 0.9, 0.03, 0x2a2a2a);
    }
    const string = (a: [number, number], c: [number, number]) => {
      const n = Math.max(4, Math.round(Math.hypot(a[0] - c[0], a[1] - c[1]) / 0.75));
      for (let i = 0; i <= n; i++) {
        const k = i / n, sag = 0.55 * 4 * k * (1 - k);
        spots.push({ x: a[0] + (c[0] - a[0]) * k, y: y + 3.0 - sag, z: a[1] + (c[1] - a[1]) * k, r: 0.045, power: 0.42, pool: -1, delay: r() * 0.12, color: r() < 0.85 ? 0xffb060 : 0xffd9a0 });
      }
    };
    string(poles[0], poles[2]); string(poles[1], poles[3]); string(poles[2], poles[4]); string(poles[3], poles[5]);
    string(poles[0], poles[3]); string(poles[2], poles[5]); string(poles[1], poles[2]); string(poles[3], poles[4]);
    for (let i = 0; i < 4; i++) {
      const z = tz0 + 1.5 + i * ((tz1 - tz0 - 3) / 3), sx = i % 2 ? 0.9 : -0.9;
      p.add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 12), M(sx, y + 0.78, z), 0xe9e2d2, [1, 1]);
      p.limb([sx, y, z], [sx, y + 0.78, z], 0.03, 0.03, 0x2a2a2a);
      spots.push({ x: sx, y: y + 0.9, z, r: 0.04, power: 0.5, pool: y + 0.8, delay: 0.05, color: 0xffa64a });
    }
    terraces.push({ x: cx, y: y + 0.06, z: cz + cabZ, len: cabL - 1.6, wid: 3.0 });
  }
  const m = M(cx, 0, cz);
  b.hull.addBatch(t, m);
  b.plain.addBatch(p, m);
  b.win.addBatch(w, m);
  // 系在岸上的缆
  const side = Math.sign(cx);
  for (const z of [-L / 2 + 3, L / 2 - 3]) b.iron.limb([cx + side * 2.3, 1.2, cz + z], [side * (HALF + 0.9), LOW_Y + 0.3, cz + z + (z < 0 ? -2.5 : 2.5)], 0.025, 0.025, 0x7a7466, 4);
}

interface Cruiser { collider?: Collider; cruise?: number; group: THREE.Group; info: BoatInfo; lane: (z: number) => number; dir: number; z0: number; z1: number }

export function build(ctx: Ctx): Part {
  const r = rng(404);
  const k = ctx.kit;
  const sets: Sets = { hull: paintBatch(ctx, 'hull'), plain: paintBatch(ctx, 'plain'), win: new Batch(), iron: paintBatch(ctx, 'iron') };
  const winMat = k.std({ color: 0x20262b, roughness: 0.18, metalness: 0.35, vertexColors: false }, 'boat-window', {
    vpars: 'attribute vec3 color;\nvarying float vLit;',
    vmain: 'vLit = color.r;',
    pars: 'varying float vLit;',
    emissive: 'totalEmissiveRadiance += vec3(1.0, 0.70, 0.40) * smoothstep(0.2, 0.75, uNight + 0.12) * 1.7 * vLit;',
  });
  const hullMat = k.std({ color: 0xffffff, roughness: 0.55, metalness: 0.1, vertexColors: true }, 'boat-hull');

  // ── 驳船
  const spots: LampSpot[] = [];
  const moor: [number, number, number, number, boolean][] = [
    [-1, 196, 32, 0x1f3a2c, false], [-1, 122, 38, 0x18191b, false], [-1, -78, 37, 0x1c2a44, true], [-1, -156, 30, 0x5a2326, false], [-1, -338, 36, 0x18191b, false], [-1, -436, 30, 0x24382e, false],
    [1, 158, 34, 0x202226, false], [1, 84, 30, 0x4a2a22, false], [1, -98, 38, 0x1b2a3a, false], [1, -176, 32, 0x18191b, false], [1, -352, 34, 0x2a3a30, false], [1, 330, 36, 0x1a1c20, false],
  ];
  let music: { x: number; z: number } | undefined;
  for (const [side, z, len, color, bar] of moor) {
    peniche(sets, side * (HALF - 3.3), z, len, color, r, bar, bar ? spots : []);
    if (bar) music = { x: side * (HALF - 3.3), z };
  }
  // 灯串的位置是驳船本地坐标，这里挪到世界坐标再登记
  const barM = moor.find((m) => m[4])!;
  for (const s of spots) lampSpots.push({ ...s, x: s.x + barM[0] * (HALF - 3.3), z: s.z + barM[1] });

  // ── 小划艇
  const dinghy = new Batch();
  dinghy.add(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), M(0, 0.32, 0, 0.62, 0.42, 1.7), 0xffffff, [1, 1]);
  dinghy.box(0, 0.26, 0.2, 1.1, 0.04, 0.24, 0xb08a5a);
  dinghy.box(0, 0.26, -0.7, 0.9, 0.04, 0.2, 0xb08a5a);
  const dinghies: { g: THREE.Object3D; ph: number }[] = [];
  const dMat = k.std({ roughness: 0.6, vertexColors: true }, 'dinghy');
  const dSpots = [[-1, -190, 0xe8e2d4], [-1, 136.5, 0x2f5a78], [1, -126, 0xe8e2d4], [1, 240, 0x3d6a4a], [-1, 362, 0xa8402e], [1, -258, 0x2f5a78]] as const;
  // 轻量画质：六条小划艇一次画完（实例颜色区分船身），每帧只更新矩阵
  const dInst = LIGHT_GEOMETRY ? new THREE.InstancedMesh(dinghy.build(), dMat, dSpots.length) : null;
  if (dInst) {
    dSpots.forEach(([, , c], i) => dInst.setColorAt(i, new THREE.Color(c)));
    dInst.castShadow = true;
    dInst.frustumCulled = false;
    ctx.scene.add(dInst);
  }
  for (const [side, z, c] of [[-1, -190, 0xe8e2d4], [-1, 136.5, 0x2f5a78], [1, -126, 0xe8e2d4], [1, 240, 0x3d6a4a], [-1, 362, 0xa8402e], [1, -258, 0x2f5a78]] as const) {
    if (dInst) {
      const o = new THREE.Object3D();
      o.position.set(side * (HALF - 1.2), 0, z);
      o.rotation.y = (r() - 0.5) * 0.3;
      dinghies.push({ g: o, ph: r() * 6 });
      continue;
    }
    const b2 = new Batch();
    b2.addBatch(dinghy, M());
    for (let i = 0; i < b2.col.length; i += 3) {
      if (b2.col[i] > 0.9) {
        const cc = new THREE.Color(c);
        b2.col[i] = cc.r; b2.col[i + 1] = cc.g; b2.col[i + 2] = cc.b;
      }
    }
    const mesh = new THREE.Mesh(b2.build(), dMat);
    mesh.position.set(side * (HALF - 1.2), 0, z);
    mesh.rotation.y = (r() - 0.5) * 0.3;
    mesh.castShadow = true;
    ctx.scene.add(mesh);
    dinghies.push({ g: mesh, ph: r() * 6 });
  }

  for (const d of dinghies) addCollider({ x: d.g.position.x, z: d.g.position.z, yaw: d.g.rotation.y, hw: 0.65, hl: 1.75, r: 0.2 });

  // ── 游船
  const cruiser = (len: number, wid: number, decks: boolean, color: number, stripe: number): THREE.Group => {
    const g = new THREE.Group();
    const local = new Batch();
    const h = LIGHT_GEOMETRY ? local.view(PAINT.hull[0], [0.1, 0.55]) : new Batch(), p = LIGHT_GEOMETRY ? local.view(0xffffff, [0, 0.9]) : new Batch(), w = new Batch();
    const hw = wid / 2;
    h.box(0, 0.5, 1.5, wid, 1.6, len - 9, color);
    h.add(new THREE.CylinderGeometry(hw, hw * 0.8, 1.6, 14, 1, false, -Math.PI / 2, Math.PI), M(0, 0.5, -(len - 9) / 2 + 1.5, 1, 1, 2.0, Math.PI), color, [1, 1]);
    h.add(new THREE.CylinderGeometry(hw, hw * 0.9, 1.6, 12, 1, false, -Math.PI / 2, Math.PI), M(0, 0.5, (len - 9) / 2 + 1.5, 1, 1, 0.5, 0), color, [1, 1]);
    h.box(0, 0.95, 1.5, wid + 0.04, 0.22, len - 9, stripe);
    // 玻璃船舱
    const cl = len * 0.66, cz = 1.5;
    p.box(0, 1.36, cz, wid - 0.5, 0.12, cl + 1, 0xe8e6e0);
    for (const sx of [-1, 1]) {
      w.box(sx * (hw - 0.32), 2.2, cz, 0.04, 1.5, cl, 0xffffff);
      for (let z = cz - cl / 2; z <= cz + cl / 2 + 0.01; z += 1.6) p.box(sx * (hw - 0.3), 2.2, z, 0.07, 1.56, 0.07, 0xdad8d2);
    }
    w.box(0, 2.2, cz - cl / 2, wid - 0.7, 1.5, 0.04, 0xffffff);
    w.box(0, 2.2, cz + cl / 2, wid - 0.7, 1.5, 0.04, 0xffffff);
    p.box(0, 3.0, cz, wid - 0.4, 0.1, cl + 0.6, 0xe8e6e0);
    const lights: LampSpot[] = [];
    if (decks) {
      // 露天的上层甲板：栏杆和一排排游客
      for (const sx of [-1, 1]) {
        p.box(sx * (hw - 0.3), 3.95, cz, 0.04, 0.05, cl, 0xd8d6d0);
        for (let z = cz - cl / 2; z <= cz + cl / 2; z += 1.6) p.box(sx * (hw - 0.3), 3.5, z, 0.03, 0.9, 0.03, 0xd8d6d0);
      }
      for (let z = cz - cl / 2 + 1.2; z < cz + cl / 2 - 1; z += 1.25)
        for (let x = -hw + 1.0; x <= hw - 1.0; x += 0.78) {
          if (r() < (LIGHT_GEOMETRY ? 0.7 : 0.42)) continue;
          const c = r.pick([0xe8e2d2, 0x2c3a52, 0xa9442f, 0xd9c7a0, 0x53624a, 0x6f86a8, 0xc98f9b, 0xf2efe8]);
          p.ell(x, 3.62, z, 0.19, 0.3, 0.14, c);
          p.ell(x, 4.03, z, 0.1, 0.115, 0.1, r.pick([0xd9a98a, 0xc68f6e, 0x8a5a40, 0x3a2a22]));
        }
      for (let z = cz - cl / 2; z <= cz + cl / 2; z += 3.2) for (const sx of [-1, 1]) lights.push({ x: sx * (hw - 0.1), y: 3.2, z, r: 0.09, power: 1.3, pool: -1, delay: 0.02, color: 0xfff0d2 });
    }
    // 驾驶台
    p.box(0, 3.75, cz - cl / 2 - 0.5, wid * 0.42, 1.4, 2.4, 0xeeece6);
    w.box(0, 3.95, cz - cl / 2 - 1.72, wid * 0.36, 0.6, 0.03, 0x000000);
    lights.push({ x: -hw + 0.4, y: 1.7, z: -(len - 9) / 2 - 1.2, r: 0.06, power: 0.6, pool: -1, delay: 0.2, color: 0xff2414 });
    lights.push({ x: hw - 0.4, y: 1.7, z: -(len - 9) / 2 - 1.2, r: 0.06, power: 0.6, pool: -1, delay: 0.2, color: 0x1eff66 });
    lights.push({ x: 0, y: 4.9, z: cz - cl / 2 - 0.5, r: 0.07, power: 0.8, pool: -1, delay: 0.2, color: 0xfff2dc });
    const mk = (b: Batch, mat: THREE.Material) => {
      const m = new THREE.Mesh(b.build(), mat);
      m.castShadow = true;
      g.add(m);
    };
    if (LIGHT_GEOMETRY) mk(local, k.painted);
    else {
      mk(h, hullMat);
      mk(p, k.plain);
    }
    mk(w, winMat);
    g.add(new LampSet(lights, k).group);
    ctx.scene.add(g);
    return g;
  };
  const cruisers: Cruiser[] = [
    { group: cruiser(46, 8.6, true, 0xf2f0ea, 0x1f3a6a), info: { x: 0, z: -250, heading: Math.PI, speed: 2.5, length: 46 }, lane: (z) => -13.5 - 7.1 * smoothstep(-150, 200, z), dir: -1, z0: -600, z1: 700 },
    { group: cruiser(22, 5.2, false, 0xe8e4da, 0x7a2a26), info: { x: 0, z: 470, heading: 0, speed: 2.9, length: 22 }, lane: () => 41.5, dir: 1, z0: -640, z1: 720 },
  ];

  for (const c of cruisers) {
    c.cruise = c.info.speed;
    c.info.x = c.lane(c.info.z);
    c.collider = addCollider({ x: c.info.x, z: c.info.z, yaw: c.info.heading, hw: c.info.length > 30 ? 4.4 : 2.7, hl: c.info.length / 2 + 2, r: 0.4, moving: true });
  }

  const add = (b: Batch, mat: THREE.Material, name: string) => put(ctx, b, mat, 1, name);
  add(sets.hull, hullMat, 'peniche-hull');
  add(sets.plain, k.plain, 'peniche-plain');
  add(sets.win, winMat, 'peniche-win');
  add(sets.iron, k.iron, 'peniche-ropes');

  return {
    boats: cruisers.map((c) => c.info),
    music,
    update(dt, t) {
      for (const c of cruisers) {
        const i = c.info;
        // 玩家在航线上时减速让行，避免游船把小船长距离顶走。
        const p = playerRef;
        const ahead = p ? (i.z - p.z) * c.dir : Infinity;
        const nearLane = p && Math.abs(p.x - i.x) < c.collider!.hw + 4.5;
        i.speed = c.cruise! * (nearLane && ahead > 0 ? clamp((ahead - c.collider!.hl - 6) / 18, 0, 1) : 1);
        i.z -= c.dir * i.speed * dt;
        if (c.dir > 0 && i.z < c.z0) i.z = c.z1;
        if (c.dir < 0 && i.z > c.z1) i.z = c.z0;
        const x = c.lane(i.z), x2 = c.lane(i.z - c.dir * 4);
        i.x = x;
        i.heading = Math.atan2(-(x2 - x), c.dir * 4);
        Object.assign(c.collider!, { x: i.x, z: i.z, yaw: i.heading });
        c.group.position.set(i.x, Math.sin(t * 0.6 + c.z0) * 0.03, i.z);
        c.group.rotation.set(Math.sin(t * 0.5) * 0.004, i.heading, Math.sin(t * 0.7 + 1) * 0.008);
      }
      dinghies.forEach((d, i) => {
        d.g.position.y = Math.sin(t * 0.9 + d.ph) * 0.035;
        d.g.rotation.z = Math.sin(t * 0.8 + d.ph) * 0.05;
        d.g.rotation.x = Math.sin(t * 0.63 + d.ph * 2) * 0.025;
        if (dInst) {
          d.g.updateMatrix();
          dInst.setMatrixAt(i, d.g.matrix);
        }
      });
      if (dInst) dInst.instanceMatrix.needsUpdate = true;
      void clamp;
    },
  };
}
