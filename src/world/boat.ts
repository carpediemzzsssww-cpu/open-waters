import * as THREE from 'three';
import { withAtmo } from '../core/atmosphere';
import { Batch, lathe, M } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';
import { LampSet } from './lamps';
import { patchStd } from './materials';
import type { Player } from './player';

/**
 * 玩家坐的那条船：一条六米多长、上了清漆的桃花心木小艇（老式的 canot automobile，改了电机）。
 * 坐在后排往前看，长长的前甲板映着整片天；船舷一圈黄铜包边，船尾插着一面小旗。
 * 船上有人刚放下的东西：一顶草帽、一只装着长棍面包和酒的柳条篮、一条毯子和一本书。
 * 本地坐标：船头朝 -Z，水线在 y=0。
 */
const Z0 = -3.9, Z1 = 2.4, LEN = Z1 - Z0;
const tOf = (z: number) => (z - Z0) / LEN;
const beam = (t: number) => 0.96 * Math.pow(Math.sin((Math.PI / 2) * Math.min(t / 0.5, 1)), 0.62) * (1 - 0.16 * Math.pow(Math.max(0, (t - 0.55) / 0.45), 2));
const sheer = (t: number) => 0.66 - 0.3 * t + 0.14 * t * t;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

function grid(nu: number, nv: number, fn: (i: number, j: number) => [number, number, number, number, number], flip = false) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      const p = fn(i / nu, j / nv);
      pos.push(p[0], p[1], p[2]);
      uv.push(p[3], p[4]);
    }
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, b = a + nv + 1, c = a + 1, d = b + 1;
      if (flip) idx.push(a, c, b, c, d, b);
      else idx.push(a, b, c, c, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export let playerRef: Player | null = null;
export function setPlayer(p: Player) {
  playerRef = p;
}

export function build(ctx: Ctx): Part {
  const k = ctx.kit;
  const root = ctx.playerGroup;
  const deck = new Batch(), wood = new Batch(), teak = new Batch();
  // 轻量画质：黄铜、杂物、皮垫、柳条、酒瓶共用一个「上色」材质，一次画完
  const local = new Batch();
  const pv = (tint: number, mr: [number, number]) => (LIGHT_GEOMETRY ? local.view(tint, mr) : new Batch());
  const brass = pv(0xd8a84c, [1, 0.24]), plain = pv(0xffffff, [0, 0.9]), leather = pv(0xe9dcc2, [0, 0.5]), wicker = pv(0x9c7a4a, [0, 0.8]);
  const own: [number, number] = [1, 1];

  // ── 船壳（外侧）
  for (const sx of [1, -1]) {
    const g = grid(30, 6, (a, b) => {
      const z = Z0 + LEN * a, t = a;
      const B = Math.max(beam(t), 0.012), S = sheer(t);
      const side = Math.min(b / 0.78, 1), bot = Math.max(0, (b - 0.78) / 0.22);
      const x = B * (1 - 0.13 * side * side) * (1 - bot);
      const y = S - (S + 0.06) * side - 0.2 * bot;
      return [sx * x, y, z, b * 0.6, z / 1.4];
    }, sx < 0);
    wood.add(g, M(), 0xf2e6e0, own);
  }
  // 船尾板
  {
    const B = beam(1), S = sheer(1);
    wood.quad(V(B, S, Z1), V(-B, S, Z1), V(-B * 0.87, -0.06, Z1), V(B * 0.87, -0.06, Z1), 0xf2e6e0, [0, 0, 1.4, 0, 1.3, 0.5, 0.1, 0.5]);
  }

  // ── 甲板：窄木条 + 浅色嵌缝，中间略微拱起
  const deckPiece = (za: number, zb: number, inner = 0) => {
    for (const sx of inner > 0 ? [1, -1] : [1]) {
      const g = grid(Math.max(2, Math.round((zb - za) / 0.22)), inner > 0 ? 1 : 8, (a, b) => {
        const z = za + (zb - za) * a, t = tOf(z), B = beam(t) - 0.015;
        const x = inner > 0 ? sx * (B - inner * (1 - b)) : -B + 2 * B * b;
        const y = sheer(t) + 0.045 * (1 - (x / Math.max(B, 0.01)) * (x / Math.max(B, 0.01))) + 0.004;
        return [x, y, z, x / 1.3 + 0.5, z / 1.3];
      }, inner > 0 && sx < 0);
      deck.add(g, M(), 0xffffff, own);
    }
  };
  const CZ0 = -0.62, CZ1 = 1.86, SIDE = 0.15; // 座舱的范围
  deckPiece(Z0 + 0.02, CZ0);
  deckPiece(CZ1, Z1);
  deckPiece(CZ0, CZ1, SIDE);
  // 甲板中线的主板和船舷的压条（深一号的木头）
  {
    const g = grid(22, 1, (a, b) => {
      const z = Z0 + 0.35 + (CZ0 - Z0 - 0.4) * a;
      return [-0.065 + 0.13 * b, sheer(tOf(z)) + 0.0545, z, b * 0.1 + 0.02, z / 1.4];
    });
    wood.add(g, M(), 0xd9b3a8, own);
  }
  const railPts: [number, number, number][][] = [[], []];
  for (let i = 0; i <= 36; i++) {
    const t = i / 36, z = Z0 + LEN * t, B = beam(t), S = sheer(t);
    railPts[0].push([B + 0.012, S - 0.012, z]);
    railPts[1].push([-B - 0.012, S - 0.012, z]);
  }
  // 黄铜包边：贴着船舷走一圈
  for (const pts of railPts) for (let i = 0; i < pts.length - 1; i++) brass.limb(pts[i], pts[i + 1], 0.017, 0.017, 0xffffff, 5);
  brass.limb([beam(1), sheer(1) - 0.012, Z1 + 0.01], [-beam(1), sheer(1) - 0.012, Z1 + 0.01], 0.017, 0.017, 0xffffff, 5);

  // ── 座舱
  const FLOOR = 0.15;
  {
    const g = grid(8, 4, (a, b) => {
      const z = CZ0 + (CZ1 - CZ0) * a, B = beam(tOf(z)) - SIDE;
      const x = -B + 2 * B * b;
      return [x, FLOOR, z, x / 1.1 + 0.5, z / 1.1];
    });
    teak.add(g, M(), 0xffffff, own);
  }
  for (const sx of [1, -1]) {
    const g = grid(8, 1, (a, b) => {
      const z = CZ0 + (CZ1 - CZ0) * a, t = tOf(z), B = beam(t) - SIDE;
      return [sx * (B - 0.01 * (1 - b)), FLOOR + (sheer(t) + 0.05 - FLOOR) * b, z, b * 0.5, z / 1.4];
    }, sx < 0);
    wood.add(g, M(), 0xe8d6cc, own);
    // 舱口围板
    const g2 = grid(8, 1, (a, b) => {
      const z = CZ0 + (CZ1 - CZ0) * a, t = tOf(z), B = beam(t) - SIDE;
      return [sx * (B + 0.03 * b), sheer(t) + 0.05 + 0.0 * b, z, b * 0.05, z / 1.4];
    }, sx > 0);
    wood.add(g2, M(), 0xe8d6cc, own);
    for (let i = 0; i < 8; i++) {
      const z = CZ0 + ((CZ1 - CZ0) * (i + 0.5)) / 8, t = tOf(z);
      wood.box(sx * (beam(t) - SIDE + 0.012), sheer(t) + 0.075, z, 0.035, 0.05, (CZ1 - CZ0) / 8 + 0.01, 0xf0dcd2);
    }
  }
  const Bf = beam(tOf(CZ0)) - SIDE, Bb = beam(tOf(CZ1)) - SIDE, Sf = sheer(tOf(CZ0)) + 0.1, Sb = sheer(tOf(CZ1)) + 0.05;
  // 仪表板（朝着人）
  wood.quad(V(-Bf, FLOOR, CZ0), V(Bf, FLOOR, CZ0), V(Bf, Sf, CZ0), V(-Bf, Sf, CZ0), 0xf0dcd2, [0, 0, 1.3, 0, 1.3, 0.4, 0, 0.4]);
  wood.box(0, Sf + 0.012, CZ0 + 0.03, Bf * 2 + 0.06, 0.03, 0.1, 0xf6e4da);
  wood.quad(V(Bb, FLOOR, CZ1), V(-Bb, FLOOR, CZ1), V(-Bb, Sb, CZ1), V(Bb, Sb, CZ1), 0xf0dcd2, [0, 0, 1.3, 0, 1.3, 0.4, 0, 0.4]);
  // 两只黄铜圈的表
  for (const gx of [-0.32, 0.32]) {
    brass.add(new THREE.CylinderGeometry(0.058, 0.058, 0.02, 20), M(gx, Sf - 0.13, CZ0 + 0.012, 1, 1, 1, 0, Math.PI / 2), 0xffffff, own);
    plain.add(new THREE.CircleGeometry(0.048, 20), M(gx, Sf - 0.13, CZ0 + 0.024), 0xf3ecd8);
    plain.box(gx + 0.012, Sf - 0.118, CZ0 + 0.026, 0.004, 0.036, 0.002, 0x1a1a1a);
  }
  brass.box(0, Sf - 0.06, CZ0 + 0.015, 0.16, 0.04, 0.012); // 铭牌

  // 座椅：奶油色的皮垫
  const cushion = (x: number, y: number, z: number, w: number, h: number, d: number) => {
    leather.add(new THREE.BoxGeometry(w, h, d, 4, 2, 4).toNonIndexed(), M(x, y, z), 0xffffff);
  };
  wood.box(0, FLOOR + 0.13, 1.0, Bb * 2 - 0.02, 0.26, 0.62, 0xe6d2c8);
  cushion(0, FLOOR + 0.31, 0.98, Bb * 2 - 0.08, 0.1, 0.6);
  cushion(0, FLOOR + 0.56, 1.33, Bb * 2 - 0.08, 0.42, 0.11);
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) leather.box(sx * (0.28 + i * 0.0), FLOOR + 0.362, 0.98, 0.012, 0.004, 0.58, 0xd8c9ae);

  // ── 方向盘（单独一个节点，会跟着舵转）
  const wheel = new THREE.Group();
  wheel.position.set(0, Sf - 0.11, CZ0 + 0.3);
  wheel.rotation.x = -0.42;
  const wb = new Batch(), wr = new Batch();
  wr.add(new THREE.TorusGeometry(0.185, 0.016, 8, 32), M(), 0xf0dcd2, own);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    wb.limb([0, 0, 0], [Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0], 0.009, 0.007, 0xffffff, 6);
  }
  wb.add(new THREE.CylinderGeometry(0.035, 0.04, 0.03, 12), M(0, 0, 0, 1, 1, 1, 0, Math.PI / 2), 0xffffff, own);
  const brassMat = k.std({ color: 0xd8a84c, metalness: 1, roughness: 0.24, vertexColors: true }, 'brass');
  const coat = (map: THREE.Texture, rough: number) => {
    const m = new THREE.MeshPhysicalMaterial({ map, roughness: rough, clearcoat: 0.32, clearcoatRoughness: 0.12, vertexColors: true, envMapIntensity: 0.62 });
    return withAtmo(m, 'varnish');
  };
  const deckMat = coat(k.wood.deck, 0.58), woodMat = coat(k.wood.mahogany, 0.5);
  const wheelRim = new THREE.Mesh(wr.build(), woodMat), wheelMetal = new THREE.Mesh(wb.build(), brassMat);
  wheel.add(wheelRim, wheelMetal);
  root.add(wheel);
  brass.limb([0, Sf - 0.11, CZ0 + 0.3], [0, Sf - 0.2, CZ0 + 0.02], 0.02, 0.024, 0xffffff, 8);

  // ── 甲板上的小五金
  brass.limb([-0.11, sheer(tOf(-3.1)) + 0.085, -3.1], [0.11, sheer(tOf(-3.1)) + 0.085, -3.1], 0.012, 0.012, 0xffffff, 6); // 系缆羊角
  for (const sx of [-1, 1]) brass.limb([sx * 0.045, sheer(tOf(-3.1)) + 0.04, -3.1], [sx * 0.045, sheer(tOf(-3.1)) + 0.085, -3.1], 0.011, 0.011, 0xffffff, 6);
  brass.add(lathe([[0.04, 0], [0.045, 0.02], [0.03, 0.05], [0.034, 0.09], [0.012, 0.11]], 10), M(0, sheer(tOf(-3.62)) + 0.03, -3.62), 0xffffff, own); // 船头灯
  for (const sx of [-1, 1]) brass.add(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), M(sx * 0.42, sheer(tOf(-1.5)) + 0.03, -1.5), 0xffffff, own); // 通风帽
  // ── 船上的东西
  // 草帽（canotier）
  const hx = -0.5, hy = FLOOR + 0.365, hz = 0.95;
  plain.add(new THREE.CylinderGeometry(0.168, 0.168, 0.008, 28), M(hx, hy + 0.004, hz), 0xe2c98b, own);
  plain.add(new THREE.CylinderGeometry(0.086, 0.09, 0.085, 28), M(hx, hy + 0.05, hz), 0xe6cf93, own);
  plain.add(new THREE.CylinderGeometry(0.0915, 0.0925, 0.034, 28, 1, true), M(hx, hy + 0.026, hz), 0x1c2a4a, own);
  // 毯子和书
  plain.add(new THREE.BoxGeometry(0.42, 0.075, 0.3, 3, 1, 3).toNonIndexed(), M(0.5, hy + 0.04, 1.0, 1, 1, 1, 0.12), 0x7a2a2e);
  plain.box(0.5, hy + 0.081, 1.0, 0.03, 0.006, 0.3, 0xd9c9a4, 0.12);
  plain.box(0.5, hy + 0.081, 0.93, 0.42, 0.006, 0.03, 0xd9c9a4, 0.12);
  plain.box(0.46, hy + 0.094, 1.02, 0.13, 0.02, 0.19, 0xe9dfc8, -0.3);
  plain.box(0.46, hy + 0.105, 1.02, 0.132, 0.003, 0.192, 0xc8663a, -0.3);
  // 柳条篮：面包、酒、两只杯子
  const bx = 0.4, bz = -0.18, by = FLOOR;
  wicker.add(lathe([[0.02, 0.005], [0.18, 0.005], [0.2, 0.03], [0.215, 0.24], [0.2, 0.245], [0.19, 0.03], [0.02, 0.03]], 20), M(bx, by, bz), 0xffffff, [6, 3]);
  wicker.add(new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI), M(bx, by + 0.24, bz, 1, 1.15, 1, 0.5), 0xe8d5b0, [4, 1]);
  plain.box(bx, by + 0.2, bz, 0.3, 0.012, 0.3, 0xe9e2d0, 0.5);
  plain.box(bx - 0.06, by + 0.207, bz, 0.05, 0.004, 0.3, 0xb8463e, 0.5);
  plain.box(bx + 0.06, by + 0.207, bz, 0.05, 0.004, 0.3, 0xb8463e, 0.5);
  plain.limb([bx - 0.05, by + 0.17, bz + 0.1], [bx + 0.16, by + 0.52, bz - 0.2], 0.034, 0.03, 0xa9793f, 8); // 长棍面包
  plain.ell(bx + 0.165, by + 0.53, bz - 0.21, 0.03, 0.035, 0.03, 0xa9793f);
  const bottle = lathe([[0.001, 0], [0.037, 0], [0.038, 0.17], [0.03, 0.2], [0.014, 0.235], [0.013, 0.29], [0.016, 0.292], [0.016, 0.305], [0.001, 0.305]], 14);
  const glassMat = k.std({ color: 0x1d3a26, roughness: 0.12, metalness: 0.2, vertexColors: true }, 'bottle');
  const bottleM = M(bx - 0.08, by + 0.06, bz - 0.06, 1, 1, 1, 0, 0.16, -0.22);
  const bottleMesh = LIGHT_GEOMETRY ? null : new THREE.Mesh(new Batch().add(bottle, bottleM, 0xffffff, own).build(), glassMat);
  if (bottleMesh) root.add(bottleMesh);
  else pv(0x1d3a26, [0.2, 0.12]).add(bottle, bottleM, 0xffffff, own);
  plain.add(new THREE.CylinderGeometry(0.0165, 0.0165, 0.05, 10), M(bx - 0.153, by + 0.345, bz - 0.108, 1, 1, 1, 0, 0.16, -0.22), 0x6a1f28, own);

  // ── 船尾的旗杆和旗
  brass.limb([0, sheer(1), Z1 - 0.08], [0, sheer(1) + 1.0, Z1 + 0.12], 0.011, 0.008, 0xffffff, 6);
  brass.ell(0, sheer(1) + 1.01, Z1 + 0.122, 0.016, 0.016, 0.016);
  // 三条色带各是一片，交界才是直的
  const strips = [0x1f3a8a, 0xf0eee6, 0xc41f2c].map((hex, i) => {
    const g = new THREE.PlaneGeometry(0.62 / 3, 0.4, 6, 6);
    g.translate(0.62 / 6 + (0.62 / 3) * i, 0, 0);
    const c = new THREE.Color(hex), arr = new Float32Array(g.attributes.position.count * 3);
    for (let q = 0; q < g.attributes.position.count; q++) arr.set([c.r, c.g, c.b], q * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const fgb = new Batch();
  strips.forEach((g, i) => fgb.add(g, M(), [0x1f3a8a, 0xf0eee6, 0xc41f2c][i], own));
  const fgn = fgb.build();
  const flagU = { uFlagWind: { value: 0.3 } };
  const flagMat = k.std({ roughness: 0.85, vertexColors: true, side: THREE.DoubleSide }, 'flag', {
    uniforms: flagU,
    vpars: 'uniform float uFlagWind;',
    vbegin: /* glsl */ `
      {
        float fx = transformed.x / 0.62;
        float w = uFlagWind;
        transformed.z += sin(fx * 7.0 - uTime * (3.0 + 5.0 * w)) * 0.05 * fx * (0.35 + w);
        transformed.y += sin(fx * 5.0 - uTime * 4.1 + 1.0) * 0.012 * fx - fx * fx * 0.2 * (1.0 - w);
        transformed.x *= 1.0 - 0.3 * (1.0 - w) * fx;
      }`,
  });
  const flag = new THREE.Mesh(fgn, flagMat);
  flag.position.set(0, sheer(1) + 0.78, Z1 + 0.09);
  flag.rotation.y = -Math.PI / 2 + 0.6;
  flag.castShadow = true;
  root.add(flag);

  // ── 装配
  const add = (b: Batch, mat: THREE.Material, name: string) => {
    if (!b.vertexCount) return;
    const m = new THREE.Mesh(b.build(1), mat);
    m.castShadow = m.receiveShadow = true;
    m.name = name;
    root.add(m);
  };
  add(deck, deckMat, 'boat-deck');
  add(wood, woodMat, 'boat-wood');
  add(teak, k.std({ map: k.wood.teak, roughness: 0.72, vertexColors: true }, 'teak'), 'boat-teak');
  if (LIGHT_GEOMETRY) add(local, k.painted, 'boat-painted');
  else {
    add(brass, brassMat, 'boat-brass');
    add(plain, k.plain, 'boat-props');
    add(leather, k.std({ color: 0xe9dcc2, roughness: 0.5, vertexColors: true }, 'leather'), 'boat-leather');
    add(wicker, k.std({ map: k.wicker, roughness: 0.8, vertexColors: true }, 'wicker'), 'boat-wicker');
  }
  for (const m of [wheelRim, wheelMetal, bottleMesh]) if (m) m.castShadow = m.receiveShadow = true;

  // 航行灯：左红右绿，船尾一盏白灯
  const nav = new LampSet(
    [
      { x: -0.07, y: sheer(tOf(-3.62)) + 0.1, z: -3.62, r: 0.014, power: 0.5, pool: -1, delay: 0.25, color: 0xff2414 },
      { x: 0.07, y: sheer(tOf(-3.62)) + 0.1, z: -3.62, r: 0.014, power: 0.5, pool: -1, delay: 0.25, color: 0x1eff66 },
      { x: 0, y: sheer(1) + 1.04, z: Z1 + 0.125, r: 0.015, power: 0.45, pool: -1, delay: 0.3, color: 0xffe2b8 },
    ],
    k,
  );
  root.add(nav.group);
  if (LIGHT_GEOMETRY) mainOnly(root); // 自己的船不进倒影（正下方那点倒影被船身挡着，省一遍）

  return {
    update() {
      const p = playerRef;
      if (!p) return;
      wheel.rotation.z = p.wheel;
      flagU.uFlagWind.value = Math.min(1, 0.5 + Math.abs(p.speed) * 0.18);
    },
  };
}
