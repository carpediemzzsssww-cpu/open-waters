import * as THREE from 'three';
import { rng } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';
import { deckY, HALF, LOW_Y, PARAPET, STREET, UP_Y, WALL } from './river';
import { terraces } from './traffic';

/**
 * 河边的人。夏天的傍晚，巴黎人会带一瓶酒坐到码头边上，把腿垂在水面上；
 * 有人沿河散步，有人靠在桥栏上看日落。
 * 每个人由头、头发、躯干、四肢几个小胶囊拼成，全部走实例化渲染，走路的人每帧更新姿势。
 */
const SKIN = [0xe2b594, 0xcf9a78, 0xa8704e, 0x7a4f38, 0xecc4a6];
const HAIR = [0x2a2018, 0x18130f, 0x5a3d26, 0x8a6a3e, 0xb9a47a, 0x6a6660, 0x3a2a22];
const CLOTH = [0xe8e2d2, 0x2c3a52, 0xa9442f, 0xd9c7a0, 0x53624a, 0x1e1e20, 0xc98f9b, 0x6f86a8, 0xf2efe8, 0x8a3a44, 0x3d5a6a, 0xd8b04a];

interface Person {
  x: number; y: number; z: number;
  yaw: number; // 面朝的方向
  s: number; // 身高比例
  pose: 'walk' | 'sit' | 'stand' | 'lean';
  speed: number;
  phase: number;
  skirt: boolean;
  // 走路的人沿着一条线段来回
  ax?: number; az?: number; bx?: number; bz?: number; t?: number; len?: number; dir?: number;
  lean?: number;
}

export function build(ctx: Ctx): Part {
  const r = rng(1995);
  const people: Person[] = [];
  const q = ctx.quality.people;
  const mk = (p: Partial<Person> & { x: number; y: number; z: number; yaw: number; pose: Person['pose'] }): Person => {
    const person: Person = { s: 0.93 + r() * 0.14, speed: 0, phase: r() * 6.28, skirt: r() < 0.3, ...p };
    people.push(person);
    return person;
  };

  for (const side of [-1, 1]) {
    // 坐在码头边上的：两三个人一堆
    for (let z = -520; z < 480; z += 22 + r() * 34) {
      if (Math.abs(z) < 30 || Math.abs(z + 240) < 16 || r() > 0.72 * q) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++)
        mk({ x: side * (HALF + 0.22), y: LOW_Y + 0.02, z: z + k * (0.55 + r() * 0.2), yaw: (side < 0 ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 0.5, pose: 'sit', lean: (r() - 0.3) * 0.3 });
    }
    // 沿下层码头散步的
    for (let i = 0; i < 9 * q; i++) {
      const s = HALF + 3 + r() * 9, z0 = -480 + r() * 900, len = 120 + r() * 200;
      const pair = r() < 0.55 ? 2 : 1, sp = 0.95 + r() * 0.45, dir = r.sign();
      for (let k = 0; k < pair; k++)
        mk({ x: side * (s + k * 0.62), y: LOW_Y, z: z0, yaw: 0, pose: 'walk', speed: sp, ax: side * (s + k * 0.62), az: z0 - len / 2, bx: side * (s + k * 0.62), bz: z0 + len / 2, t: r(), len, dir });
    }
    // 上层护栏边站着看河的
    for (let z = -400; z < 420; z += 30 + r() * 60) {
      if (Math.abs(z) < 34 || r() > 0.55 * q) continue;
      mk({ x: side * (STREET + 0.38), y: UP_Y, z, yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2, pose: 'lean' });
      if (r() < 0.5) mk({ x: side * (STREET + 0.42), y: UP_Y, z: z + 0.6, yaw: (side < 0 ? -Math.PI / 2 : Math.PI / 2) + 0.2, pose: 'lean' });
    }
  }
  // 桥上：靠着栏杆看日落的，和过桥的
  for (let i = 0; i < 16 * q; i++) {
    const x = -62 + r() * 124, sz = r() < 0.72 ? -1 : 1; // 多数人在西侧，朝着落日
    mk({ x, y: deckY(x) + 0.13, z: sz * 19.45, yaw: sz < 0 ? 0 : Math.PI, pose: 'lean' });
  }
  for (let i = 0; i < 9 * q; i++) {
    const sz = r.sign(), z = sz * (16 + r() * 2.6), dir = r.sign(), sp = 1.0 + r() * 0.4;
    mk({ x: 0, y: UP_Y, z, yaw: 0, pose: 'walk', speed: sp, ax: -74, az: z, bx: 74, bz: z, t: r(), len: 148, dir });
  }
  // 驳船露台上的
  for (const tr of terraces)
    for (let i = 0; i < 9; i++)
      mk({ x: tr.x + (r() - 0.5) * tr.wid, y: tr.y, z: tr.z + (r() - 0.5) * tr.len, yaw: r() * 6.28, pose: 'stand' });
  void PARAPET; void WALL;

  // ── 实例
  // 轻量画质：只画离镜头最近的 SLOTS 个人（每 0.4 s 重新挑一次），几何也更省
  if (LIGHT_GEOMETRY) for (const p of people) p.skirt = false;
  const SLOTS = 44;
  const n = LIGHT_GEOMETRY ? Math.min(SLOTS, people.length) : people.length;
  const mat = ctx.kit.std({ roughness: 0.82 }, 'people');
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, LIGHT_GEOMETRY ? 6 : 10, LIGHT_GEOMETRY ? 5 : 8), mat, n);
  const hair = new THREE.InstancedMesh(new THREE.SphereGeometry(0.107, LIGHT_GEOMETRY ? 6 : 10, LIGHT_GEOMETRY ? 5 : 8), mat, n);
  const torsoG = LIGHT_GEOMETRY ? new THREE.CapsuleGeometry(0.15, 0.26, 2, 6) : new THREE.CapsuleGeometry(0.15, 0.26, 4, 10);
  const torso = new THREE.InstancedMesh(torsoG, mat, n);
  const limbG = LIGHT_GEOMETRY ? new THREE.CapsuleGeometry(1, 1, 1, 5) : new THREE.CapsuleGeometry(1, 1, 3, 7); // 半径 1、直段长 1，用矩阵缩放
  const limbs = new THREE.InstancedMesh(limbG, mat, n * 6);
  const skirtG = new THREE.CylinderGeometry(0.13, 0.25, 0.5, 10, 1, false);
  const skirts = new THREE.InstancedMesh(skirtG, mat, people.filter((p) => p.skirt).length || 1);
  const meshes = [head, hair, torso, limbs, skirts];
  if (LIGHT_GEOMETRY) {
    skirts.visible = false;
    for (const m of [head, hair, torso, limbs]) m.count = 0;
  }
  const col = new THREE.Color();
  let si = 0;
  const skirtIndex = new Map<Person, number>();
  // 每个人的配色先定好，再按「槽位」写进实例（网页版槽位就是人的序号）
  const palette = people.map((p) => {
    const skin = col.set(r.pick(SKIN)).clone();
    const hairC = col.set(r.pick(HAIR)).clone();
    const top = col.set(r.pick(CLOTH)).clone();
    const bottom = col.set(r.pick(CLOTH)).multiplyScalar(0.8).clone();
    const bare = r() < 0.4;
    const sleeve = r() < 0.6 ? skin : top;
    if (p.skirt) {
      skirts.setColorAt(si, r() < 0.5 ? top : bottom);
      skirtIndex.set(p, si++);
    }
    return { skin, hairC, top, limbs: [bottom, bottom, bare || p.skirt ? skin : bottom, bare || p.skirt ? skin : bottom, sleeve, sleeve] };
  });
  const paint = (slot: number, pi: number) => {
    const c = palette[pi];
    head.setColorAt(slot, c.skin);
    hair.setColorAt(slot, c.hairC);
    torso.setColorAt(slot, c.top);
    for (let k = 0; k < 6; k++) limbs.setColorAt(slot * 6 + k, c.limbs[k]);
  };
  if (!LIGHT_GEOMETRY) people.forEach((_, i) => paint(i, i));
  for (const m of meshes) {
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    ctx.scene.add(m);
    if (LIGHT_GEOMETRY) mainOnly(m); // 人太小，进倒影也看不清
  }
  skirts.count = si;

  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3();
  const A = new THREE.Vector3(), B = new THREE.Vector3(), D = new THREE.Vector3(), UPV = new THREE.Vector3(0, 1, 0), E = new THREE.Euler();
  const setLimb = (idx: number, a: THREE.Vector3, b: THREE.Vector3, rad: number) => {
    D.subVectors(b, a);
    const len = Math.max(D.length() - rad * 1.2, 0.01);
    D.normalize();
    Q.setFromUnitVectors(UPV, D);
    P.addVectors(a, b).multiplyScalar(0.5);
    // 胶囊的两端半球也被拉长，所以这里是个近似；远看足够
    limbs.setMatrixAt(idx, M4.compose(P, Q, S.set(rad, len / 1.0 * 0.62, rad)));
  };

  const pose = (p: Person, i: number, t: number) => {
    const s = p.s, f = { x: -Math.sin(p.yaw), z: -Math.cos(p.yaw) }, rt = { x: -f.z, z: f.x };
    let hipY = 0.86 * s, lean = p.lean ?? 0, bob = 0;
    let la = 0, lb = 0, ka = 0, kb = 0, aa = 0, ab = 0; // 大腿摆角、膝盖弯曲、手臂摆角
    let thigh = 0; // 坐姿：大腿抬平
    if (p.pose === 'walk') {
      const ph = p.phase;
      la = Math.sin(ph) * 0.46; lb = -la;
      ka = Math.max(0, -Math.sin(ph + 0.9)) * 0.75; kb = Math.max(0, Math.sin(ph + 0.9)) * 0.75;
      aa = -la * 0.7; ab = -lb * 0.7;
      bob = Math.abs(Math.cos(ph)) * 0.025 * s;
      lean = 0.04;
    } else if (p.pose === 'sit') {
      hipY = 0.1 * s; thigh = 1;
      lean = -0.12 + (p.lean ?? 0) + Math.sin(t * 0.3 + p.phase) * 0.015;
    } else if (p.pose === 'lean') {
      lean = 0.2; aa = 0.9; ab = 0.9;
    } else {
      aa = Math.sin(t * 0.4 + p.phase) * 0.1; ab = 0.25;
    }
    const bx = p.x, by = p.y + hipY + bob, bz = p.z;
    // 躯干
    const shoulderY = by + 0.5 * s;
    const tx = f.x * Math.sin(lean) * 0.5 * s, tz = f.z * Math.sin(lean) * 0.5 * s;
    E.set(-lean, p.yaw, 0, 'YXZ');
    Q.setFromEuler(E);
    torso.setMatrixAt(i, M4.compose(P.set(bx + tx * 0.5, by + 0.27 * s, bz + tz * 0.5), Q, S.set(s * 1.0, s, s * 0.66)));
    head.setMatrixAt(i, M4.compose(P.set(bx + tx * 1.25, shoulderY + 0.2 * s, bz + tz * 1.25), Q, S.set(s, s * 1.14, s)));
    hair.setMatrixAt(i, M4.compose(P.set(bx + tx * 1.25 - f.x * 0.022 * s, shoulderY + 0.225 * s, bz + tz * 1.25 - f.z * 0.022 * s), Q, S.set(s, s * 1.1, s)));
    const sk = skirtIndex.get(p);
    if (sk !== undefined) {
      E.set(thigh ? -1.1 : 0, p.yaw, 0, 'YXZ');
      Q.setFromEuler(E);
      skirts.setMatrixAt(sk, M4.compose(P.set(bx + (thigh ? f.x * 0.16 * s : 0), by - (thigh ? 0.02 : 0.2) * s, bz + (thigh ? f.z * 0.16 * s : 0)), Q, S.set(s, s, s)));
    }
    // 腿
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? -1 : 1, ang = k === 0 ? la : lb, knee = k === 0 ? ka : kb;
      A.set(bx + rt.x * sd * 0.085 * s, by, bz + rt.z * sd * 0.085 * s);
      if (thigh) {
        B.set(A.x + f.x * 0.42 * s, A.y - 0.02 * s, A.z + f.z * 0.42 * s);
        setLimb(i * 6 + k, A, B, 0.07 * s);
        const sw = Math.sin(t * 0.9 + p.phase + k * 2.1) * 0.1;
        A.set(B.x + f.x * sw * 0.4 * s, B.y - 0.4 * s, B.z + f.z * sw * 0.4 * s);
        setLimb(i * 6 + 2 + k, B, A, 0.052 * s);
      } else {
        B.set(A.x + f.x * Math.sin(ang) * 0.43 * s, A.y - Math.cos(ang) * 0.43 * s, A.z + f.z * Math.sin(ang) * 0.43 * s);
        setLimb(i * 6 + k, A, B, 0.07 * s);
        const a2 = ang - knee;
        A.set(B.x + f.x * Math.sin(a2) * 0.43 * s, B.y - Math.cos(a2) * 0.43 * s, B.z + f.z * Math.sin(a2) * 0.43 * s);
        setLimb(i * 6 + 2 + k, B, A, 0.052 * s);
      }
    }
    // 手臂
    for (let k = 0; k < 2; k++) {
      const sd = k === 0 ? -1 : 1, ang = k === 0 ? aa : ab;
      A.set(bx + tx + rt.x * sd * 0.185 * s, shoulderY - 0.03 * s, bz + tz + rt.z * sd * 0.185 * s);
      B.set(A.x + f.x * Math.sin(ang) * 0.54 * s + rt.x * sd * 0.03, A.y - Math.cos(ang) * 0.54 * s, A.z + f.z * Math.sin(ang) * 0.54 * s + rt.z * sd * 0.03);
      setLimb(i * 6 + 4 + k, A, B, 0.043 * s);
    }
  };

  if (!LIGHT_GEOMETRY) people.forEach((p, i) => pose(p, i, 0));
  const flush = () => {
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  flush();
  const movers = people.map((p, i) => [p, i] as const).filter(([p]) => p.pose === 'walk' || p.pose === 'sit');
  let tick = 0;
  const walk = (p: Person, dt: number) => {
    p.t! += (p.dir! * p.speed * dt) / p.len!;
    if (p.t! > 1) { p.t = 1; p.dir = -1; }
    if (p.t! < 0) { p.t = 0; p.dir = 1; }
    p.x = p.ax! + (p.bx! - p.ax!) * p.t!;
    p.z = p.az! + (p.bz! - p.az!) * p.t!;
    if (p.ax === -74) p.y = deckY(p.x) + 0.13;
    p.yaw = Math.atan2(-(p.bx! - p.ax!) * p.dir!, -(p.bz! - p.az!) * p.dir!);
    p.phase += dt * p.speed * 4.4;
  };

  // ── 轻量画质：挑最近的人进槽位
  const slots: number[] = [];
  const order = people.map((_, i) => i);
  const dist = new Float32Array(people.length);
  const fwd = new THREE.Vector3();
  let pickT = 1e9;
  const pick = (cam: THREE.Camera) => {
    cam.getWorldDirection(fwd);
    const cx = cam.position.x, cz = cam.position.z;
    for (let i = 0; i < people.length; i++) {
      const p = people[i], dx = p.x - cx, dz = p.z - cz, d = Math.hypot(dx, dz);
      // 身后的人往后排；太远的人（>360 m）不画
      const behind = (dx * fwd.x + dz * fwd.z) < -8 ? 400 : 0;
      dist[i] = d > 360 ? 1e9 : d + behind;
    }
    order.sort((a, b) => dist[a] - dist[b]);
    slots.length = 0;
    for (let k = 0; k < n && dist[order[k]] < 1e8; k++) slots.push(order[k]);
    slots.forEach((pi, k) => {
      paint(k, pi);
      pose(people[pi], k, 0);
    });
    for (const m of [head, hair, torso]) m.count = slots.length;
    limbs.count = slots.length * 6;
    for (const m of meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  };

  return {
    update(dt, t, cam) {
      tick++;
      if (LIGHT_GEOMETRY) {
        for (const p of people) if (p.pose === 'walk') walk(p, dt);
        pickT += dt;
        if (pickT > 0.4) {
          pickT = 0;
          pick(cam);
        }
        slots.forEach((pi, k) => {
          const p = people[pi];
          if (p.pose === 'walk' || (p.pose === 'sit' && (tick + k) % 4 === 0)) pose(p, k, t);
        });
        flush();
        return;
      }
      for (const [p, i] of movers) {
        if (p.pose === 'walk') {
          walk(p, dt);
          pose(p, i, t);
        } else if ((tick + i) % 4 === 0) {
          // 坐着的人只是偶尔晃晃腿；离得远就不算了
          if (Math.abs(p.z - cam.position.z) < 140) pose(p, i, t);
        }
      }
      flush();
    },
  };
}
