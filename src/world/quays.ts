import * as THREE from 'three';
import { Batch, lathe, M, rng } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { paintBatch, put, stoneBatch, type Ctx, type Part } from './build';
import { at, frame, HALF, lampSpots, LOW_Y, PARAPET, QUAY, STREET, UP_Y, WALL } from './river';

/**
 * 河岸：水边的石墙 → 铺石的下层码头 → 七米多高的挡墙和护栏 → 上层街面。
 * 沿河道中线把一个剖面「拉」出来，所以弯道也是同一套做法。
 * 再往上添：腰线、壁柱、系船环、上下码头的石阶、墙里的拱门、护栏上的旧书摊铁箱、路灯。
 */
const POST = lathe([[0.2, 0], [0.23, 0.12], [0.2, 0.3], [0.11, 0.55], [0.085, 1.2], [0.065, 0.92], [0.1, 0.96], [0.055, 1.0]].map(([r, y]) => [r, y] as [number, number]), 8);

/** 一盏老式路灯（铸铁灯柱 + 灯笼），并登记灯位 */
export function lampPost(iron: Batch, x: number, y: number, z: number, h: number, delay: number, power = 1) {
  const p = lathe([[0.2, 0], [0.24, 0.1], [0.21, 0.32], [0.12, 0.6], [0.09, 1.3], [0.07, h - 0.25], [0.12, h - 0.18], [0.06, h - 0.05], [0.03, h]], 8);
  iron.add(p, M(x, y, z));
  // 灯笼：上面一个小帽子，四根细筋
  iron.add(new THREE.ConeGeometry(0.3, 0.2, LIGHT_GEOMETRY ? 4 : 6, 1, LIGHT_GEOMETRY), M(x, y + h + 0.62, z, 1, 1, 1, LIGHT_GEOMETRY ? Math.PI / 4 : 0));
  if (!LIGHT_GEOMETRY) iron.add(new THREE.SphereGeometry(0.05, 6, 4), M(x, y + h + 0.76, z));
  for (let k = 0; k < (LIGHT_GEOMETRY ? 0 : 4); k++) {
    const a = (k / 4) * Math.PI * 2 + 0.78;
    iron.box(x + Math.cos(a) * 0.2, y + h + 0.28, z + Math.sin(a) * 0.2, 0.025, 0.56, 0.025);
  }
  if (!LIGHT_GEOMETRY) iron.add(new THREE.CylinderGeometry(0.15, 0.1, 0.06, 6), M(x, y + h + 0.02, z));
  lampSpots.push({ x, y: y + h + 0.3, z, r: 0.16, power, pool: y, delay });
}
void POST;

export function build(ctx: Ctx): Part {
  const r = rng(101);
  const stone = stoneBatch(ctx), cobble = new Batch(), plain = paintBatch(ctx, 'plain', true), iron = paintBatch(ctx, 'iron', true);
  const us: number[] = [];
  // 轻量画质：直段 40 m 一节、弯道 24 m 一节（墙面是平的，节数只影响压顶石的块数）
  for (let u = -1180; u < 620; u += LIGHT_GEOMETRY ? 40 : 20) us.push(u);
  for (let u = 620; u <= 2500; u += LIGHT_GEOMETRY ? 24 : 16) us.push(u);

  const A = new THREE.Vector3(), B = new THREE.Vector3(), C2 = new THREE.Vector3(), D = new THREE.Vector3();
  const col = new THREE.Color();
  type Prof = { s0: number; y0: number; s1: number; y1: number; b: Batch; tile: number; wall: boolean; color: number; far?: number };
  const profile: Prof[] = [
    { s0: HALF, y0: -3, s1: HALF, y1: LOW_Y, b: stone, tile: 8, wall: true, color: 0xf2ead8 },
    { s0: HALF, y0: LOW_Y, s1: WALL, y1: LOW_Y, b: cobble, tile: 3, wall: false, color: 0xffffff },
    { s0: WALL, y0: LOW_Y, s1: WALL + 0.6, y1: UP_Y + PARAPET, b: stone, tile: 8, wall: true, color: 0xffffff },
    { s0: WALL + 0.6, y0: UP_Y + PARAPET, s1: STREET, y1: UP_Y + PARAPET, b: stone, tile: 8, wall: false, color: 0xfff6e6 },
    { s0: STREET, y0: UP_Y + PARAPET, s1: STREET, y1: UP_Y, b: stone, tile: 8, wall: true, color: 0xe8dcc8 },
    { s0: STREET, y0: UP_Y, s1: STREET + 7, y1: UP_Y, b: plain, tile: 1, wall: false, color: 0x9a9184 }, // 人行道
    { s0: STREET + 7, y0: UP_Y, s1: STREET + 21, y1: UP_Y, b: plain, tile: 1, wall: false, color: 0x56534f }, // 车道
    { s0: STREET + 21, y0: UP_Y, s1: 640, y1: UP_Y, b: plain, tile: 1, wall: false, color: 0x7d776c },
  ];

  for (const side of [-1, 1]) {
    for (let i = 0; i < us.length - 1; i++) {
      const u0 = us[i], u1 = us[i + 1];
      const tint = 0.93 + r() * 0.12;
      for (const p of profile) {
        at(u0, side * p.s0, p.y0, A);
        at(u1, side * p.s0, p.y0, B);
        at(u1, side * p.s1, p.y1, C2);
        at(u0, side * p.s1, p.y1, D);
        col.set(p.color).multiplyScalar(tint);
        const t = p.tile;
        const va = p.wall ? p.y0 / t : p.s0 / t, vb = p.wall ? p.y1 / t : p.s1 / t;
        if (side < 0) p.b.quad(A, B, C2, D, col, [u0 / t, va, u1 / t, va, u1 / t, vb, u0 / t, vb]);
        else p.b.quad(A, D, C2, B, col, [u0 / t, va, u0 / t, vb, u1 / t, vb, u1 / t, va]);
      }
      // 腰线、护栏压顶、水边的压顶石
      const um = (u0 + u1) / 2, len = u1 - u0 + 0.05, f = frame(um);
      const P = at(um, side * (WALL + 0.36), UP_Y - 0.2);
      stone.box(P.x, P.y, P.z, 0.5, 0.34, len, 0xfff4e2, f.yaw);
      at(um, side * (WALL + 0.82), UP_Y + PARAPET + 0.06, P);
      stone.box(P.x, P.y, P.z, 0.78, 0.13, len, 0xfff8ea, f.yaw);
      at(um, side * (HALF + 0.32), LOW_Y + 0.05, P);
      stone.box(P.x, P.y, P.z, 0.8, 0.12, len, 0xf4ecdc, f.yaw);
    }

    // 壁柱
    for (let u = -1170; u < 1500; u += 26) {
      if (Math.abs(u) < 26) continue;
      const f = frame(u), P = at(u, side * (WALL + 0.15), (LOW_Y + UP_Y - 0.4) / 2);
      stone.box(P.x, P.y, P.z, 0.75, UP_Y - 0.4 - LOW_Y, 1.35, 0xfbf1df, f.yaw);
      at(u, side * (WALL + 0.12), LOW_Y + 0.35, P);
      stone.box(P.x, P.y, P.z, 0.95, 0.7, 1.6, 0xf2e6d2, f.yaw);
    }

    // 系船环和缆桩
    const ring = new THREE.TorusGeometry(0.17, 0.03, 5, 12);
    for (let u = -900; u < 700; u += LIGHT_GEOMETRY ? 60 : 15) {
      const f = frame(u), P = at(u, side * (HALF - 0.05), 1.0);
      if (!LIGHT_GEOMETRY) iron.add(ring, M(P.x, P.y, P.z, 1, 1, 1, f.yaw + Math.PI / 2, 0.25 * side));
      if (((u + 900) / 15) % 2 === 0) {
        at(u + 4, side * (HALF + 1.0), LOW_Y, P);
        iron.add(new THREE.CylinderGeometry(0.13, 0.17, 0.5, LIGHT_GEOMETRY ? 5 : 8, 1, LIGHT_GEOMETRY), M(P.x, P.y + 0.25, P.z));
        if (!LIGHT_GEOMETRY) iron.add(new THREE.SphereGeometry(0.19, 8, 5), M(P.x, P.y + 0.52, P.z, 1, 0.55, 1));
      }
    }

    // 上下码头的石阶：贴着挡墙的一跑
    const stairs = side < 0 ? [[-196, 1], [128, -1], [356, 1]] : [[-132, -1], [236, 1]];
    for (const [u0, dir] of stairs) {
      const N = 44, rise = (UP_Y - LOW_Y) / N, run = 0.37;
      for (let i = 0; i < N; i++) {
        const u = u0 + (i + 0.5) * run * dir, h = (i + 1) * rise;
        const P = at(u, side * (WALL - 1.15), LOW_Y + h / 2);
        stone.box(P.x, P.y, P.z, 2.3, h, run + 0.01, i % 2 ? 0xf6ecd8 : 0xeee2cc);
        if (i % 4 === 0) {
          at(u0 + (i + 2) * run * dir, side * (WALL - 2.45), LOW_Y + (h + rise * 3.5) / 2 + 0.5, P);
          stone.box(P.x, P.y, P.z, 0.32, h + rise * 3.5 + 1.0, run * 4 + 0.02, 0xfaf0dc);
        }
      }
    }

    // 挡墙里的拱门（旧仓库）
    const disc = new THREE.CircleGeometry(1.15, 14, 0, Math.PI);
    const arch = new THREE.RingGeometry(1.15, 1.5, 14, 1, 0, Math.PI);
    for (let u = -860; u < 600; u += 52) {
      if (Math.abs(u) < 60 || r() < 0.35) continue;
      const uu = u + r() * 20, f = frame(uu), ry = f.yaw - side * (Math.PI / 2);
      const doorCol = r.pick([0x26352e, 0x3a2c22, 0x2b3038, 0x4a2a24]);
      let P = at(uu, side * (WALL + 0.05), LOW_Y + 1.25);
      plain.box(P.x, P.y, P.z, 0.12, 2.5, 2.3, doorCol, f.yaw);
      P = at(uu, side * (WALL + 0.12), LOW_Y + 2.5);
      plain.add(disc, M(P.x, P.y, P.z, 1, 1, 1, ry), doorCol);
      P = at(uu, side * (WALL + 0.02), LOW_Y + 2.5);
      stone.add(arch, M(P.x, P.y, P.z, 1, 1, 1, ry), 0xfff2dc, [1, 1]);
      for (const o of [-1.33, 1.33]) {
        P = at(uu + o, side * (WALL - 0.02), LOW_Y + 1.25);
        stone.box(P.x, P.y, P.z, 0.2, 2.5, 0.36, 0xfff2dc, f.yaw);
      }
    }

    // 护栏上的旧书摊铁箱（傍晚都锁上了）
    for (let u = side < 0 ? -640 : -520; u < -70; u += 11.5) {
      if (r() < 0.3) { u += 12; continue; }
      for (let k = 0; k < 4; k++) {
        const uu = u + k * 2.08, f = frame(uu), P = at(uu, side * (WALL + 0.84), UP_Y + PARAPET + 0.52);
        plain.box(P.x, P.y, P.z, 0.82, 0.78 + (k % 2) * 0.04, 1.98, 0x1d4534, f.yaw);
        plain.box(P.x, P.y + 0.42, P.z, 0.9, 0.05, 2.02, 0x17382a, f.yaw);
      }
    }

    // 路灯：上层每 28 m 一盏，下层稀一些
    for (let u = -1100; u < 1700; u += LIGHT_GEOMETRY ? 42 : 28) {
      if (Math.abs(u) < 30) continue;
      const P = at(u + 6, side * (STREET + 1.7), UP_Y);
      lampPost(iron, P.x, P.y, P.z, 5.4, r() * 0.45);
    }
    for (let u = -700; u < 640; u += LIGHT_GEOMETRY ? 62 : 41) {
      if (Math.abs(u) < 30) continue;
      const P = at(u, side * (WALL - 1.0), LOW_Y);
      lampPost(iron, P.x, P.y, P.z, 3.9, 0.15 + r() * 0.5, 0.8);
    }
  }

  const k = ctx.kit;
  put(ctx, stone, k.stone, 8, 'quay-stone');
  put(ctx, cobble, k.cobble, 3, 'quay-cobble');
  put(ctx, plain, k.plain, 1, 'quay-plain');
  put(ctx, iron, k.iron, 1, 'quay-iron');
  return {};
}
