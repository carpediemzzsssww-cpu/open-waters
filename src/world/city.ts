import * as THREE from 'three';
import { rng } from '../core/util';
import { env } from '../core/atmosphere';
import { MINI, LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';
import { addBlock, FacadeBuilder, facadeUniforms, makeFacadeMaterial, type V2 } from './facade';
import { at, frame, STREET, UP_Y } from './river';

/**
 * 两岸的城市。真实的地形是这样的：
 * 左岸（-X）：协和桥头是波旁宫，往西是奥赛堤岸的一排大楼，亚历山大三世桥正对着荣军院广场的大空地，
 *            再往西又是连绵的奥斯曼楼，一直排到弯道那头的铁塔脚下。
 * 右岸（+X）：桥东是香榭丽舍花园的树，桥西是大皇宫，之后是阿尔贝一世林荫道后面的楼。
 * 临河第一排做得细（老虎窗、阳台、烟囱），后排和远处只留体块和屋顶线。
 */
export const pots: { x: number; y: number; z: number; s: number }[] = [];

export function build(ctx: Ctx): Part {
  const r = rng(1853);
  const fb = LIGHT_GEOMETRY ? ctx.shared.facade : new FacadeBuilder();

  const row = (side: number, u0: number, u1: number, s: number, o: { floors: [number, number]; depth: number; detail: (u: number) => boolean; floorH?: number; gap?: number }) => {
    let u = u0;
    while (u < u1 - 14) {
      const W = Math.min(20 + r() * 26, u1 - u);
      const f = frame(u + W / 2);
      const floors = o.floors[0] + Math.floor(r() * (o.floors[1] - o.floors[0] + 1));
      let P: V2, t: V2;
      if (side < 0) {
        const p = at(u, -s);
        P = { x: p.x, z: p.z };
        t = { x: f.tx, z: f.tz };
      } else {
        const p = at(u + W, s);
        P = { x: p.x, z: p.z };
        t = { x: -f.tx, z: -f.tz };
      }
      addBlock(fb, pots, P, t, W, o.depth, { floors, detail: o.detail(u), baseY: UP_Y, seed: 1 + r() * 97, floorH: o.floorH }, r);
      u += W + (r() < (o.gap ?? 0.22) ? 9 + r() * 7 : 0.02);
    }
  };

  const S1 = STREET + 24;
  const near = (u: number) => u > -700 && u < 1050;
  // ── 左岸
  row(-1, -1180, -650, S1, { floors: [6, 7], depth: 15, detail: near });
  row(-1, -470, -152, S1, { floors: [4, 5], depth: 18, detail: () => true, floorH: 3.9, gap: 0.12 }); // 奥赛堤岸的部委大楼：层高更高
  row(-1, 152, 2300, S1, { floors: [6, 7], depth: 15, detail: near });
  for (const [s, d] of [[S1 + 38, 14], [S1 + 76, 14], [S1 + 114, 14]] as const) {
    row(-1, -1180, -152, s, { floors: [6, 8], depth: d, detail: () => false, gap: 0.3 });
    row(-1, 190, 2300, s, { floors: [6, 8], depth: d, detail: () => false, gap: 0.3 });
  }
  // 荣军院广场两侧：垂直于河的两排楼，一直退到荣军院
  for (const sgn of [-1, 1]) {
    let x = -(S1 + 4);
    while (x > -520) {
      const W = 24 + r() * 22;
      const z = sgn * 150;
      // sgn=+1：东侧（z=+150），立面朝西（-Z）；sgn=-1：西侧，立面朝东
      const t: V2 = sgn > 0 ? { x: -1, z: 0 } : { x: 1, z: 0 };
      const P: V2 = sgn > 0 ? { x, z } : { x: x - W, z };
      addBlock(fb, pots, P, t, W, 15, { floors: 6 + Math.floor(r() * 2), detail: x > -260, baseY: UP_Y, seed: 1 + r() * 97 }, r);
      x -= W + (r() < 0.25 ? 11 : 0.02);
    }
  }
  // 荣军院主楼：近 200 m 长的一整面
  addBlock(fb, pots, { x: -565, z: 98 }, { x: 0, z: -1 }, 196, 22, { floors: 4, detail: true, baseY: UP_Y, seed: 41.5, floorH: 4.3 }, r);

  // ── 右岸
  row(1, 262, 2300, STREET + 44, { floors: [6, 7], depth: 15, detail: near });
  row(1, 262, 2300, STREET + 82, { floors: [6, 8], depth: 14, detail: () => false, gap: 0.3 });
  row(1, 300, 2300, STREET + 120, { floors: [6, 8], depth: 14, detail: () => false, gap: 0.3 });
  row(1, -1180, -700, STREET + 64, { floors: [5, 6], depth: 16, detail: () => false, gap: 0.1, floorH: 3.8 });
  // 小皇宫的位置：桥东北，一栋矮而长的古典建筑
  addBlock(fb, pots, { x: 172, z: 42 }, { x: 0, z: 1 }, 118, 90, { floors: 3, detail: false, baseY: UP_Y, seed: 12.5, floorH: 5.6, mansard: false }, r);

  if (!LIGHT_GEOMETRY) {
    const mesh = new THREE.Mesh(fb.build(), makeFacadeMaterial(ctx.kit));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.name = 'city';
    ctx.scene.add(mesh);
  }

  // 烟囱顶上的陶罐
  // 轻量画质：陶罐只留临河第一排（老虎窗那几栋），四棱、不封口
  const potList = LIGHT_GEOMETRY ? pots.filter((_, i) => i % (MINI ? 12 : 3) === 0) : pots;
  const potGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.6, LIGHT_GEOMETRY ? 4 : 6, 1, LIGHT_GEOMETRY);
  const potMat = ctx.kit.std({ color: 0x96573a, roughness: 0.85 }, 'pots');
  const im = new THREE.InstancedMesh(potGeo, potMat, potList.length);
  const m = new THREE.Matrix4();
  potList.forEach((p, i) => im.setMatrixAt(i, m.makeScale(p.s, p.s, p.s).setPosition(p.x, p.y + 0.3 * p.s, p.z)));
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = false;
  im.name = 'chimney-pots';
  ctx.scene.add(im);
  if (LIGHT_GEOMETRY) mainOnly(im);

  return {
    update() {
      facadeUniforms.uWinGlow.value = env.windowGlow;
    },
  };
}
