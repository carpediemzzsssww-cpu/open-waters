import * as THREE from 'three';
import { Batch, lathe, M, rng } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { paintBatch, put, stoneBatch, type Ctx, type Part } from './build';
import { addCollider } from './collide';
import { deckY, HALF, lampSpots, LOW_Y, UP_Y, WALL } from './river';

/**
 * 亚历山大三世桥（1900）。一跨 107.5 m 的扁钢拱，拱高只有 6 m 多——当年特意压得这么低，
 * 为的是不挡住香榭丽舍望向荣军院的视线。桥轴沿世界 X，桥在 z=0，宽 40 m。
 * 这里按真实比例搭：并排的拱肋、拱上立柱、桥面、栏杆、32 盏烛台灯、檐下的花环、
 * 拱顶的镀金水仙群像，以及四角 17 m 高、顶着镀金飞马的桥头柱。
 */
const XS = 53.75, YS = 1.0, RISE = 6.2, HW = 20;
const intr = (x: number) => YS + RISE * (1 - (x / XS) * (x / XS));
const depth = (x: number) => 0.85 + 0.55 * (x / XS) * (x / XS);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const STEEL = 0xffffff, STEEL_DARK = 0xb9bdb8, UNDER = 0x8d9390;

function rib(b: Batch, z: number, thick: number, color: number) {
  const N = 44, zf = z + thick / 2, zb = z - thick / 2;
  for (let i = 0; i < N; i++) {
    const x0 = -XS + (2 * XS * i) / N, x1 = -XS + (2 * XS * (i + 1)) / N;
    const y0 = intr(x0), y1 = intr(x1), e0 = y0 + depth(x0), e1 = y1 + depth(x1);
    b.quad(V(x0, y0, zf), V(x1, y1, zf), V(x1, e1, zf), V(x0, e0, zf), color);
    b.quad(V(x1, y1, zb), V(x0, y0, zb), V(x0, e0, zb), V(x1, e1, zb), color);
    b.quad(V(x0, y0, zb), V(x1, y1, zb), V(x1, y1, zf), V(x0, y0, zf), UNDER);
    b.quad(V(x0, e0, zf), V(x1, e1, zf), V(x1, e1, zb), V(x0, e0, zb), color);
  }
}

/** 沿桥轴把一个 (z, 相对桥面的高度) 剖面拉出来；mirror=true 时生成 -z 一侧 */
function sweep(b: Batch, pts: [number, number, number][], x0: number, x1: number, n: number, mirror: boolean) {
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n, xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const ya = deckY(xa), yb = deckY(xb);
    for (let k = 0; k < pts.length - 1; k++) {
      const [z0, o0, c] = pts[k], [z1, o1] = pts[k + 1];
      const s = mirror ? -1 : 1;
      const A = V(xa, ya + o0, s * z0), B = V(xb, yb + o0, s * z0), C = V(xb, yb + o1, s * z1), D = V(xa, ya + o1, s * z1);
      if (mirror) b.quad(A, D, C, B, c);
      else b.quad(A, B, C, D, c);
    }
  }
}

/** 截面为矩形的一根杆，顺着桥面的弧度走 */
function bar(b: Batch, x0: number, x1: number, zc: number, w: number, y0: number, y1: number, color: number, n = 26) {
  const pts: [number, number, number][] = [[zc - w / 2, y0, color], [zc + w / 2, y0, color], [zc + w / 2, y1, color], [zc - w / 2, y1, color], [zc - w / 2, y0, color]];
  sweep(b, pts, x0, x1, n, false);
}

/** 桥头柱顶的镀金群像：扬蹄的飞马和牵着它的名誉女神。朝本地 +X。 */
export function fame(g: Batch) {
  const t = new Batch();
  const G = 0xffffff;
  t.ell(0, 0.22, 0, 1.35, 0.3, 0.85, G);
  t.ell(0, 2.0, 0, 1.05, 0.5, 0.45, G, 0.61); // 马身，前高后低
  t.limb([0.72, 2.5, 0], [1.22, 3.32, 0], 0.27, 0.17, G);
  t.ell(1.46, 3.4, 0, 0.36, 0.17, 0.15, G, -0.5);
  t.ell(0.92, 3.05, 0, 0.11, 0.5, 0.06, G, -0.6); // 鬃
  t.limb([0.8, 2.3, 0.22], [1.45, 2.55, 0.25], 0.13, 0.1, G);
  t.limb([1.45, 2.55, 0.25], [1.56, 2.0, 0.25], 0.09, 0.07, G);
  t.limb([0.8, 2.35, -0.22], [1.34, 2.78, -0.25], 0.13, 0.1, G);
  t.limb([1.34, 2.78, -0.25], [1.62, 2.32, -0.25], 0.09, 0.07, G);
  for (const s of [-1, 1]) {
    t.limb([-0.75, 1.55, 0.25 * s], [-0.45, 0.92, 0.3 * s], 0.21, 0.13, G);
    t.limb([-0.45, 0.92, 0.3 * s], [-0.82, 0.3, 0.3 * s], 0.11, 0.08, G);
    // 翅膀：两片竖起来的羽
    t.ell(-0.12, 3.35, 0.55 * s, 0.5, 1.3, 0.07, G, 0.42, -0.34 * s);
    t.ell(-0.5, 3.0, 0.62 * s, 0.4, 1.0, 0.06, G, 0.8, -0.45 * s);
    t.ell(-0.8, 2.6, 0.6 * s, 0.3, 0.7, 0.05, G, 1.1, -0.5 * s);
  }
  t.limb([-0.9, 1.6, 0], [-1.5, 1.05, 0], 0.13, 0.06, G);
  t.limb([-1.5, 1.05, 0], [-1.62, 0.5, 0], 0.06, 0.03, G);
  // 女神
  t.ell(0.85, 1.0, 0.78, 0.3, 0.78, 0.28, G);
  t.ell(0.97, 1.78, 0.76, 0.24, 0.45, 0.2, G);
  t.ell(1.0, 2.4, 0.76, 0.17, 0.19, 0.17, G);
  t.limb([1.05, 2.02, 0.7], [1.3, 2.75, 0.4], 0.075, 0.06, G);
  t.limb([0.95, 2.02, 0.86], [0.6, 2.6, 1.1], 0.075, 0.06, G);
  t.limb([0.6, 2.6, 1.1], [-0.1, 3.3, 1.5], 0.03, 0.11, G); // 号角
  g.addBatch(t, M());
  return t;
}

function pylon(stone: Batch, gold: Batch, fameT: Batch, sx: number, sz: number) {
  const x = sx * 81, z = sz * 24.6, y0 = UP_Y;
  stone.box(x, y0 + 1.1, z, 5.4, 2.2, 5.4, 0xf4ead6);
  stone.box(x, y0 + 2.4, z, 4.8, 0.4, 4.8, 0xfff6e4);
  stone.box(x, y0 + 7.4, z, 3.3, 9.6, 3.3, 0xfbf1dc);
  const col = lathe([[0.62, 0], [0.66, 0.2], [0.56, 0.45], [0.55, 4.5], [0.5, 8.4], [0.56, 8.5], [0.5, 8.6], [0.74, 9.25], [0.78, 9.4]], 12);
  for (const a of [-1, 1]) for (const c of [-1, 1]) stone.add(col, M(x + a * 1.72, y0 + 2.6, z + c * 1.72), 0xfff7e6, [2, 1.2]);
  stone.box(x, y0 + 12.45, z, 4.9, 0.9, 4.9, 0xfff2de);
  stone.box(x, y0 + 13.1, z, 5.6, 0.45, 5.6, 0xfff8e8);
  stone.box(x, y0 + 14.2, z, 3.5, 1.8, 3.5, 0xf8eeda);
  stone.box(x, y0 + 15.25, z, 3.9, 0.3, 3.9, 0xfff6e4);
  // 四角的小装饰和正面的铭牌
  for (const a of [-1, 1]) for (const c of [-1, 1]) gold.ell(x + a * 2.2, y0 + 13.75, z + c * 2.2, 0.28, 0.42, 0.28);
  gold.box(x - sz * 0, y0 + 14.2, z - sz * 1.78, 2.0, 0.9, 0.08);
  // 柱脚的坐像（石头的寓意像）
  const fz = z - sz * 3.1;
  stone.box(x, y0 + 0.7, fz, 2.0, 1.4, 1.6, 0xf2e6d0);
  stone.ell(x, y0 + 2.5, fz, 0.6, 0.95, 0.5, 0xf6ecd8);
  stone.ell(x, y0 + 3.75, fz, 0.32, 0.36, 0.32, 0xf6ecd8);
  stone.ell(x, y0 + 1.75, fz - sz * 0.5, 0.62, 0.42, 0.75, 0xf6ecd8);
  // 柱顶的群像
  gold.addBatch(fameT, M(x, y0 + 15.4, z, 1.42 * sx, 1.42, 1.42 * sz, 0));
}

export function build(ctx: Ctx): Part {
  const r = rng(1900);
  // 外侧拱脚净空不足以容纳坐姿相机及船身起伏。
  for (const side of [-1, 1]) addCollider({ x: side * 53, z: 0, yaw: 0, hw: 2.5, hl: HW + 0.5, r: 0 });
  const steel = paintBatch(ctx, 'steel'), rail = LIGHT_GEOMETRY ? paintBatch(ctx, 'steel', true) : steel, bronze = paintBatch(ctx, 'bronze', true), gold = paintBatch(ctx, 'gold', true), stone = stoneBatch(ctx), plain = new Batch();

  // ── 拱肋：九片，最外两片是迎面看到的装饰拱
  const ribZ = [-19.2, -14.4, -9.6, -4.8, 0, 4.8, 9.6, 14.4, 19.2];
  for (const z of ribZ) rib(steel, z, Math.abs(z) > 19 ? 0.7 : 0.45, Math.abs(z) > 19 ? STEEL : STEEL_DARK);
  // 拱上立柱
  for (const z of ribZ) {
    const outer = Math.abs(z) > 19;
    for (let x = -50.6; x <= 50.7; x += 3.615) {
      const top = deckY(x) - 0.78, bot = intr(x) + depth(x) - 0.05, h = top - bot;
      if (h < 0.5) continue;
      steel.box(x, bot + h / 2, z, outer ? 0.3 : 0.2, h, outer ? 0.34 : 0.2, outer ? STEEL : STEEL_DARK);
      if (outer && h > 1.2) {
        steel.box(x, top - 0.12, z, 0.62, 0.22, 0.4, STEEL);
        steel.box(x, bot + 0.1, z, 0.56, 0.2, 0.4, STEEL);
      }
    }
  }
  // 横向联系梁
  for (let x = -49; x <= 49.1; x += 7) steel.box(x, intr(x) + depth(x) - 0.28, 0, 0.26, 0.5, 38.6, UNDER);
  for (let x = -45.5; x <= 45.6; x += 7) steel.box(x, deckY(x) - 1.1, 0, 0.3, 0.6, 38.6, UNDER);
  // 拱脚的铰座
  for (const z of ribZ) for (const s of [-1, 1]) steel.box(s * (XS + 0.1), YS + 0.6, z, 1.2, 1.5, 1.1, STEEL_DARK);

  // ── 桥面
  const prof: [number, number, number][] = [
    [0, -0.75, UNDER], [19.55, -0.75, UNDER], [19.55, -1.3, STEEL_DARK], [20.25, -1.3, STEEL], [20.25, -0.22, STEEL],
    [20.62, -0.22, STEEL], [20.62, 0.13, STEEL], [19.9, 0.13, 0xd9d2c4], [11, 0.13, 0xd9d2c4], [11, 0, 0x6a655f], [0, 0, 0x6a655f],
  ];
  sweep(steel, prof, -78, 78, 52, false);
  sweep(steel, prof, -78, 78, 52, true);

  // ── 栏杆
  const bal = lathe([[0.06, 0], [0.078, 0.05], [0.05, 0.13], [0.09, 0.32], [0.05, 0.52], [0.074, 0.68], [0.06, 0.74]], 6);
  const cand = lathe([[0.21, 0], [0.25, 0.08], [0.13, 0.3], [0.17, 0.5], [0.075, 0.72], [0.055, 1.9], [0.105, 2.0], [0.05, 2.1], [0.04, 2.62]], 8);
  const arm = LIGHT_GEOMETRY ? new THREE.TorusGeometry(0.4, 0.028, 3, 4, Math.PI / 2) : new THREE.TorusGeometry(0.4, 0.028, 5, 8, Math.PI / 2);
  const cup = new THREE.CylinderGeometry(0.1, 0.045, 0.1, LIGHT_GEOMETRY ? 5 : 8, 1, LIGHT_GEOMETRY);
  const pedX: number[] = [];
  for (let i = 0; i < 8; i++) pedX.push(4.6 + i * 9.2, -(4.6 + i * 9.2));
  for (const sz of [-1, 1]) {
    const z = sz * 19.95;
    bar(steel, -76, 76, z, 0.3, 0.13, 0.24, STEEL, 40);
    bar(steel, -76, 76, z, 0.26, 0.98, 1.13, STEEL, 40);
    for (let x = -75.7; x <= 75.75; x += 0.58) {
      if (pedX.some((p) => Math.abs(p - x) < 0.5)) continue;
      if (LIGHT_GEOMETRY) rail.box(x, deckY(x) + 0.61, z, 0.1, 0.74, 0.1, STEEL);
      else steel.add(bal, M(x, deckY(x) + 0.24, z), STEEL, [1, 1]);
    }
    for (const x of pedX) {
      const y = deckY(x);
      steel.box(x, y + 0.72, z, 0.74, 1.2, 0.74, STEEL);
      steel.box(x, y + 1.36, z, 0.9, 0.12, 0.9, STEEL);
      bronze.add(cand, M(x, y + 1.42, z), 0xffffff, [1, 1]);
      const delay = 0.16 + r() * 0.16;
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + (sz > 0 ? 0.52 : 1.57);
        const dx = Math.cos(a), dz = Math.sin(a);
        bronze.add(arm, M(x, y + 3.2, z, 1, 1, 1, -a, 0, -Math.PI / 2), 0xffffff, [1, 1]);
        bronze.add(cup, M(x + dx * 0.4, y + 3.27, z + dz * 0.4), 0xffffff, [1, 1]);
        lampSpots.push({ x: x + dx * 0.4, y: y + 3.5, z: z + dz * 0.4, r: 0.18, power: 0.8, pool: -1, delay });
      }
      bronze.add(cup, M(x, y + 4.06, z), 0xffffff, [1, 1]);
      lampSpots.push({ x, y: y + 4.34, z, r: 0.23, power: 1.15, pool: y + 0.14, delay });
    }

    // ── 檐下的花环：一串一串垂在两个托座之间
    const zf = sz * 20.42;
    for (let x = -74; x < 73.9; x += 3.7) {
      const ya = deckY(x) - 0.42, yb = deckY(x + 3.7) - 0.42;
      const curve = new THREE.QuadraticBezierCurve3(V(x, ya, zf), V(x + 1.85, (ya + yb) / 2 - 1.05, zf + sz * 0.1), V(x + 3.7, yb, zf));
      bronze.add(new THREE.TubeGeometry(curve, LIGHT_GEOMETRY ? 5 : 8, 0.1, LIGHT_GEOMETRY ? 3 : 5, false), M(), 0xdfe8dc, [1, 1]);
      gold.ell(x, ya + 0.02, zf, 0.17, 0.17, 0.12);
      if (!LIGHT_GEOMETRY) gold.limb([x, ya - 0.1, zf], [x, ya - 0.52, zf], 0.06, 0.02, 0xffffff, 5);
      steel.box(x, deckY(x) - 0.66, sz * 20.36, 0.3, 0.72, 0.26, STEEL);
    }
    // 拱圈上的小金花
    for (let x = -48.6; x <= 48.7; x += 5.4) if (Math.abs(x) > 5) gold.ell(x, intr(x) + depth(x) * 0.5, sz * 19.58, 0.15, 0.15, 0.07);

    // ── 拱顶：镀金的盾徽和两位斜倚的水仙
    const k = new Batch();
    // 盾徽：一面椭圆的盾，镶一圈边，顶上一顶小冠
    k.ell(0, 0, 0.1, 0.56, 0.78, 0.14);
    k.add(new THREE.TorusGeometry(0.7, 0.07, 6, 28), M(0, 0, 0.13, 0.86, 1.18, 1), 0xffffff, [1, 1]);
    k.ell(0, 1.0, 0.14, 0.46, 0.07, 0.12);
    for (let i = -2; i <= 2; i++) k.ell(i * 0.19, 1.1 + (2 - Math.abs(i)) * 0.07, 0.15, 0.075, 0.1, 0.075);
    for (let i = 0; i < 3; i++) k.ell(0, -1.02 - i * 0.2, 0.1, 0.1 - i * 0.022, 0.11, 0.08);
    for (const s of [-1, 1]) {
      k.add(new THREE.TorusGeometry(0.26, 0.06, 6, 14, Math.PI * 1.5), M(s * 0.9, -0.3, 0.12, s, 1, 1, 0, 0, 0.6), 0xffffff, [1, 1]);
      // 两束月桂枝从盾后伸出去，一束贴着檐口，一束往上扬
      const sprays: [THREE.Vector3, THREE.Vector3, THREE.Vector3, number][] = [
        [V(s * 0.6, -0.55, 0.1), V(s * 2.3, -1.15, 0.1), V(s * 4.6, -0.5, 0.08), 15],
        [V(s * 0.6, 0.45, 0.1), V(s * 1.9, 1.25, 0.1), V(s * 3.3, 0.95, 0.08), 10],
      ];
      for (const [a0, a1, a2, n] of sprays) {
        const cv = new THREE.QuadraticBezierCurve3(a0, a1, a2);
        k.add(new THREE.TubeGeometry(cv, LIGHT_GEOMETRY ? 6 : 12, 0.035, LIGHT_GEOMETRY ? 3 : 5), M(), 0xffffff, [1, 1]);
        for (let j = 1; j <= n; j += LIGHT_GEOMETRY ? 2 : 1) {
          const t = j / (n + 0.5), pt = cv.getPoint(t), tg = cv.getTangent(t);
          const ang = Math.atan2(tg.y, tg.x), up = j % 2 ? 1 : -1, sz = 0.26 * (1 - t * 0.45);
          const la = ang + up * 0.75;
          k.ell(pt.x + Math.cos(la) * sz * 0.8, pt.y + Math.sin(la) * sz * 0.8, pt.z + 0.02, sz, sz * 0.3, 0.035, 0xffffff, la);
        }
      }
    }
    gold.addBatch(k, M(0, intr(0) + 1.55, sz * 20.3, 1.2, 1.2, sz * 1.2));
  }

  // ── 桥台：石砌，下层码头从它的拱洞里穿过去
  const fameT = new Batch();
  fame(fameT);
  for (const sx of [-1, 1]) {
    stone.box(sx * 56.9, 3.1, 0, 6.3, 12.2, 43.4, 0xf4ead6);
    stone.box(sx * 65.2, 7.75, 0, 10.6, 2.9, 40.4, 0xe9dfca); // 码头通道的顶
    for (const sz of [-1, 1]) {
      // 立面：带一个扁拱洞的石墙
      const s = new THREE.Shape();
      const a = 60.6, b = 69.6, top = deckY(66) + 0.2;
      s.moveTo(59.4, LOW_Y - 0.2);
      s.lineTo(a, LOW_Y - 0.2);
      s.lineTo(a, 4.4);
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, xx = a + (b - a) * t;
        s.lineTo(xx, 4.4 + 1.9 * Math.sqrt(Math.max(0, 1 - (2 * t - 1) * (2 * t - 1))));
      }
      s.lineTo(b, LOW_Y - 0.2);
      s.lineTo(WALL + 0.9, LOW_Y - 0.2);
      s.lineTo(WALL + 0.9, top);
      s.lineTo(59.4, top);
      s.closePath();
      const g = new THREE.ExtrudeGeometry(s, { depth: 1.9, bevelEnabled: false, curveSegments: 4 });
      stone.add(g, M(0, 0, sz > 0 ? 19.7 : -21.6, sx, 1, 1), 0xf6ecd8);
      // 桥墩两端的半圆壁柱
      stone.add(new THREE.CylinderGeometry(1.25, 1.4, 12.2, 14), M(sx * 55.2, 3.1, sz * 21.7), 0xfbf2de, [3, 1.5]);
      stone.box(sx * 55.2, 9.5, sz * 21.7, 3.2, 0.5, 3.2, 0xfff6e4);
      // 桥头到桥头柱之间的石栏
      stone.box(sx * 66.5, deckY(66) + 0.62, sz * 20.9, 23, 1.0, 0.55, 0xf8eeda);
      stone.box(sx * 66.5, deckY(66) + 1.17, sz * 20.9, 23.3, 0.13, 0.75, 0xfff8ea);
      pylon(stone, gold, fameT, sx, sz);
      // 桥头的大烛台
      const lx = sx * 76.8, lz = sz * 20.9, ly = UP_Y + 1.2;
      bronze.add(cand, M(lx, ly, lz, 1.5, 1.5, 1.5), 0xffffff, [1, 1]);
      for (let q = 0; q < 4; q++) {
        const an = (q / 4) * Math.PI * 2 + 0.78;
        lampSpots.push({ x: lx + Math.cos(an) * 0.7, y: ly + 3.6, z: lz + Math.sin(an) * 0.7, r: 0.2, power: 0.9, pool: -1, delay: 0.12 });
      }
      lampSpots.push({ x: lx, y: ly + 4.5, z: lz, r: 0.27, power: 1.3, pool: UP_Y, delay: 0.1 });
    }
  }
  void HALF; void plain;

  const k = ctx.kit;
  put(ctx, steel, k.steel, 4, 'alex-steel');
  put(ctx, bronze, k.bronze, 1, 'alex-bronze');
  put(ctx, gold, k.gold, 1, 'alex-gold');
  put(ctx, stone, k.stone, 8, 'alex-stone');
  return {};
}
