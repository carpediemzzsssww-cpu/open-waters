import * as THREE from 'three';
import { Batch, M, rng } from '../core/util';
import { paintBatch, put, stoneBatch, type Ctx, type Part } from './build';
import { addCollider } from './collide';
import type { Obstacle } from './player';
import { BEND_R, BEND_U, frame, lampSpots, LOW_Y, WALL } from './river';
import { lampPost } from './quays';

/**
 * 上下游的几座石拱桥：协和桥（上游，身后）、荣军院桥（下游第一座）、阿尔玛桥（弯道口，远景）。
 * 做法是画出桥的立面轮廓（桥身减去一个个拱洞），再沿桥宽挤出来。
 */
interface Opening { a: number; b: number; ys: number; rise: number }
interface Spec {
  u: number; // 沿河位置
  width: number;
  deck: number;
  openings: Opening[];
  piers: number[]; // 水里的桥墩中心（沿桥轴）
  pierW: number;
  tint: number;
  lamps: number;
}

function archBridge(spec: Spec, stone: Batch, iron: Batch, obstacles: Obstacle[], r: ReturnType<typeof rng>) {
  const f = frame(spec.u);
  const L = WALL + 4;
  const s = new THREE.Shape();
  s.moveTo(-L, -3);
  // 底边从左到右，遇到拱洞就拐上去
  for (const o of spec.openings) {
    s.lineTo(o.a, -3);
    s.lineTo(o.a, o.ys);
    const n = 14, mid = (o.a + o.b) / 2, half = (o.b - o.a) / 2;
    for (let i = 1; i < n; i++) {
      const x = o.a + ((o.b - o.a) * i) / n;
      s.lineTo(x, o.ys + o.rise * Math.sqrt(Math.max(0, 1 - ((x - mid) / half) * ((x - mid) / half))));
    }
    s.lineTo(o.b, o.ys);
    s.lineTo(o.b, -3);
  }
  s.lineTo(L, -3);
  s.lineTo(L, spec.deck);
  s.lineTo(-L, spec.deck);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: spec.width, bevelEnabled: false, curveSegments: 4 });
  const part = new Batch();
  part.add(g, M(0, 0, -spec.width / 2), spec.tint);
  const hw = spec.width / 2;
  // 檐口和护栏
  for (const sz of [-1, 1]) {
    part.box(0, spec.deck - 0.2, sz * (hw + 0.14), L * 2, 0.4, 0.5, 0xfff6e4);
    part.box(0, spec.deck + 0.55, sz * (hw - 0.1), L * 2, 1.1, 0.42, 0xf6ecd8);
    part.box(0, spec.deck + 1.13, sz * (hw - 0.1), L * 2, 0.12, 0.6, 0xfff8ea);
  }
  // 桥墩的分水尖：两头半圆，上面收一个石帽
  for (const px of spec.piers) {
    for (const sz of [-1, 1]) {
      part.add(new THREE.CylinderGeometry(spec.pierW / 2, spec.pierW / 2 + 0.15, 7.2, 12), M(px, 0.6, sz * hw), 0xf2e8d4, [2, 1]);
      part.add(new THREE.ConeGeometry(spec.pierW / 2, 1.2, 12), M(px, 4.8, sz * hw), 0xf8eeda, [2, 0.3]);
      part.box(px, spec.deck - 1.4, sz * (hw + 0.05), spec.pierW * 0.7, 2.0, 0.5, 0xfbf2de);
    }
  }
  const m = M(f.x, 0, f.z, 1, 1, 1, f.yaw);
  stone.addBatch(part, m);
  // 桥上的路灯
  const v = new THREE.Vector3();
  for (let i = 0; i < spec.lamps; i++) {
    const x = -L + 6 + ((L * 2 - 12) * i) / (spec.lamps - 1);
    for (const sz of [-1, 1]) {
      v.set(x, spec.deck, sz * (hw - 1.4)).applyMatrix4(m);
      lampPost(iron, v.x, v.y, v.z, 4.6, 0.1 + r() * 0.4, 0.9);
    }
  }
  // 从拱洞之间的实心轮廓生成碰撞，连同分水尖和两侧低矮拱脚。
  let edge = -L;
  for (const o of [...spec.openings, { a: L, b: L, ys: 0, rise: 0 }]) {
    if (o.a > edge) {
      const center = (edge + o.a) / 2, half = (o.a - edge) / 2;
      v.set(center, 0, 0).applyMatrix4(m);
      const pier = spec.piers.some((px) => Math.abs(px - center) < spec.pierW);
      addCollider({ x: v.x, z: v.z, yaw: f.yaw, hw: half + 0.2, hl: hw + (pier ? spec.pierW / 2 + 0.2 : 0), r: 0 });
    }
    edge = o.b;
  }

}

export function build(ctx: Ctx): Part {
  const r = rng(77);
  const stone = stoneBatch(ctx), iron = paintBatch(ctx, 'iron', true);
  const obstacles: Obstacle[] = [];
  const quayArch = (sx: number): Opening => (sx < 0 ? { a: -68.4, b: -56.6, ys: LOW_Y + 1.7, rise: 2.5 } : { a: 56.6, b: 68.4, ys: LOW_Y + 1.7, rise: 2.5 });

  // 荣军院桥：四孔，矮而敦实
  archBridge({
    u: 240, width: 18, deck: 8.9, pierW: 3.2, tint: 0xf4ead4, lamps: 9,
    piers: [-27, 0, 27],
    openings: [quayArch(-1), { a: -52.4, b: -28.6, ys: 1.1, rise: 5.5 }, { a: -25.4, b: -1.6, ys: 1.1, rise: 5.9 }, { a: 1.6, b: 25.4, ys: 1.1, rise: 5.9 }, { a: 28.6, b: 52.4, ys: 1.1, rise: 5.5 }, quayArch(1)],
  }, stone, iron, obstacles, r);

  // 协和桥：五孔
  const co: Opening[] = [quayArch(-1)];
  const cp: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -53 + i * 21.6;
    co.push({ a: a + 1.2, b: a + 20.4, ys: 1.2, rise: 5.6 + (i === 2 ? 0.7 : i === 1 || i === 3 ? 0.4 : 0) });
    if (i > 0) cp.push(a);
  }
  co.push(quayArch(1));
  archBridge({ u: -560, width: 34, deck: 9.4, pierW: 3.0, tint: 0xf8eeda, lamps: 10, piers: cp, openings: co }, stone, iron, obstacles, r);

  // 阿尔玛桥：在弯道口，只当远景
  const uAlma = BEND_U + BEND_R * 0.232;
  archBridge({
    u: uAlma, width: 30, deck: 9.2, pierW: 4, tint: 0xe6dfd2, lamps: 8, piers: [-6],
    openings: [quayArch(-1), { a: -52, b: -8.5, ys: 1.2, rise: 5.2 }, { a: -3.5, b: 52, ys: 1.2, rise: 5.6 }, quayArch(1)],
  }, stone, iron, obstacles, r);

  put(ctx, stone, ctx.kit.stone, 8, 'bridges-stone');
  put(ctx, iron, ctx.kit.iron, 1, 'bridges-iron');
  return { obstacles: obstacles.filter((o) => Math.abs(o.z) < 800) };
}
