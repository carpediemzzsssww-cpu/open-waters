import * as THREE from 'three';
import { ATMO_GLSL, atmo, env, withAtmo } from '../core/atmosphere';
import { Batch, DEG, lathe, M, rng, smoothstep } from '../core/util';
import { fame } from './alexandre';
import { LIGHT_GEOMETRY } from '../core/env';
import { paintBatch, put, stoneBatch, type Ctx, type Part } from './build';
import { addBlock, FacadeBuilder, makeFacadeMaterial } from './facade';
import { patchStd } from './materials';
import { BEND_R, BEND_U, frame, STREET, UP_Y } from './river';

/**
 * 天际线上认得出来的那几样：埃菲尔铁塔、大皇宫的玻璃穹顶、荣军院的金顶、
 * 波旁宫的柱廊、协和广场的方尖碑、美国教堂的尖塔。
 */

// ───────────────────────── 埃菲尔铁塔 ─────────────────────────
const EIFFEL = { x: -611, z: -1390, y: 5 };

function buildEiffel(ctx: Ctx) {
  const pos: number[] = [], uv: number[] = [], solid: number[] = [], nor: number[] = [], idx: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  const quad = (p: number[][], u0: number, u1: number, v0: number, v1: number, s = 0) => {
    const base = pos.length / 3;
    a.set(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    b.set(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]);
    n.crossVectors(a, b).normalize();
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      nor.push(n.x, n.y, n.z);
      uv.push(uvs[i][0], uvs[i][1]);
      solid.push(s);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tube = (c0: number[][], c1: number[][], h0: number, h1: number, v0: number, v1: number, nU: number, s = 0) => {
    for (let k = 0; k < 4; k++) {
      const P = c0[k], Q = c0[(k + 1) % 4], P1 = c1[k], Q1 = c1[(k + 1) % 4];
      quad([[P[0], h0, P[1]], [Q[0], h0, Q[1]], [Q1[0], h1, Q1[1]], [P1[0], h1, P1[1]]], 0, nU, v0, v1, s);
    }
  };
  const sq = (cx: number, cz: number, hw: number) => [[cx - hw, cz - hw], [cx + hw, cz - hw], [cx + hw, cz + hw], [cx - hw, cz + hw]];
  const box = (hw: number, y0: number, y1: number) => {
    tube(sq(0, 0, hw), sq(0, 0, hw), y0, y1, 0, 1, 1, 1);
    quad([[-hw, y1, -hw], [hw, y1, -hw], [hw, y1, hw], [-hw, y1, hw]], 0, 1, 0, 1, 1);
    quad([[-hw, y0, -hw], [hw, y0, -hw], [hw, y0, hw], [-hw, y0, hw]], 0, 1, 0, 1, 1);
  };

  // 四条腿：外缘按指数曲线向内收（这条曲线是埃菲尔为抗风算出来的）
  const W = (h: number) => 62.5 * Math.exp(-h / 88);
  const L = (h: number) => 15 - 8.5 * Math.min(h / 115.7, 1);
  const hs = [0, 9, 18, 28, 38, 48, 57.6, 68, 80, 92, 104, 115.7];
  for (const cx of [-1, 1])
    for (const cz of [-1, 1]) {
      let v = 0;
      for (let i = 0; i < hs.length - 1; i++) {
        const h0 = hs[i], h1 = hs[i + 1];
        const leg = (h: number) => {
          const w = W(h), l = L(h), c = w - l / 2;
          return sq(cx * c, cz * c, l / 2);
        };
        const dv = (h1 - h0) / ((L(h0) + L(h1)) / 2);
        tube(leg(h0), leg(h1), h0, h1, v, v + dv, 1);
        v += dv;
      }
    }
  // 二层以上并成一根塔身
  const W2 = (h: number) => 16.8 * Math.exp(-(h - 115.7) / 118);
  let v = 0;
  for (let i = 0; i < 14; i++) {
    const h0 = 115.7 + (160.3 * i) / 14, h1 = 115.7 + (160.3 * (i + 1)) / 14;
    const nU = h0 < 190 ? 2 : 1;
    const dv = (h1 - h0) / ((W2(h0) + W2(h1)) / nU);
    tube(sq(0, 0, W2(h0)), sq(0, 0, W2(h1)), h0, h1, v, v + dv, nU);
    v += dv;
  }
  tube(sq(0, 0, 4.3), sq(0, 0, 2.4), 276, 300, 0, 3, 1, 0.55);
  tube(sq(0, 0, 0.7), sq(0, 0, 0.35), 300, 330, 0, 1, 1, 1);
  box(35.5, 54.6, 59.4);
  box(19.6, 112.8, 117.4);
  box(8.6, 273.2, 278.2);
  // 腿之间的大拱
  for (let side = 0; side < 4; side++) {
    const N = 22;
    for (let i = 0; i < N; i++) {
      const a0 = Math.PI * (0.06 + (0.88 * i) / N), a1 = Math.PI * (0.06 + (0.88 * (i + 1)) / N);
      const pt = (ang: number, R: number): number[] => {
        const c = Math.cos(ang) * R, y = 6 + Math.sin(ang) * R * 0.98;
        const w = W(y) - 0.4;
        return side === 0 ? [w, y, c] : side === 1 ? [-w, y, c] : side === 2 ? [c, y, w] : [c, y, -w];
      };
      quad([pt(a0, 41.5), pt(a1, 41.5), pt(a1, 46), pt(a0, 46)], i * 0.5, (i + 1) * 0.5, 0, 0.5, 0);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSolid', new THREE.Float32BufferAttribute(solid, 1));
  g.setIndex(idx);
  const uniforms = {
    ...atmo,
    uLattice: { value: ctx.kit.lattice },
    uLit: { value: 0 },
    uSparkle: { value: 0 },
    uAmb: { value: env.ambSky },
    uSunL: { value: new THREE.Color() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute float aSolid;
      varying vec2 vUv; varying float vSolid; varying vec3 vToFrag; varying float vH; varying vec3 vN;
      void main() {
        vUv = uv; vSolid = aSolid; vH = position.y / 330.0;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vToFrag = w.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv; varying float vSolid; varying vec3 vToFrag; varying float vH; varying vec3 vN;
      uniform sampler2D uLattice; uniform float uLit; uniform float uSparkle; uniform float uTime;
      uniform vec3 uAmb; uniform vec3 uSunL;
      ${ATMO_GLSL}
      float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
      void main() {
        float a = max(min(texture2D(uLattice, vUv).a * 1.35, 1.0), vSolid);
        if (a < 0.02) discard;
        vec3 iron = vec3(0.12, 0.095, 0.075);
        float ndl = abs(dot(normalize(vN), uSunDir));
        vec3 col = iron * (uAmb * 1.5 + uSunL * (0.1 + 0.25 * ndl));
        // 入夜后从里面打亮的金色
        col += vec3(1.0, 0.50, 0.15) * uLit * (0.8 + 0.6 * (1.0 - vH)) * 0.8;
        // 整点时的闪烁
        float h = hash12(floor(vUv * 6.0) + floor(vH * 260.0) * 3.7 + floor(uTime * 11.0) * 7.31);
        col += vec3(1.5, 1.55, 1.8) * step(0.9935, h) * uSparkle * 7.0;
        col = atmoFog(col, vToFrag, cameraPosition.y);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(EIFFEL.x, EIFFEL.y, EIFFEL.z);
  mesh.rotation.y = 45 * DEG;
  mesh.updateMatrix();
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  mesh.name = 'eiffel';
  ctx.scene.add(mesh);

  // 塔顶的探照灯：两道很淡的光，夜里慢慢扫
  const bg = new THREE.BufferGeometry();
  const bp: number[] = [], ba: number[] = [];
  for (const s of [1, -1]) {
    const Lb = 1500 * s;
    bp.push(0, 0, 0, Lb, 30, -14, Lb, 30, 14, 0, 0, 0, Lb, 22, 0, Lb, 38, 0);
    ba.push(1, 0, 0, 1, 0, 0);
  }
  bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bg.setAttribute('aA', new THREE.Float32BufferAttribute(ba, 1));
  const beamU = { uOn: { value: 0 } };
  const beam = new THREE.Mesh(
    bg,
    new THREE.ShaderMaterial({
      uniforms: beamU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'precision highp float; varying float vA; uniform float uOn; void main(){ gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * vA * vA * uOn * 0.07, 1.0); }',
    }),
  );
  beam.position.set(EIFFEL.x, EIFFEL.y + 296, EIFFEL.z);
  beam.frustumCulled = false;
  beam.renderOrder = 6;
  ctx.scene.add(beam);

  let sparkleT = -1, lastNight = 0;
  return (dt: number, t: number) => {
    uniforms.uSunL.value.copy(env.sunLight).multiplyScalar(env.sunIntensity / Math.PI);
    uniforms.uLit.value = smoothstep(0.35, 1.0, env.night);
    // 灯刚全亮的时候闪一次，之后每隔几分钟再闪
    if (env.night > 0.97 && lastNight <= 0.97) sparkleT = 0;
    lastNight = env.night;
    if (sparkleT >= 0) {
      sparkleT += dt;
      if (sparkleT > 200) sparkleT = 0;
    }
    uniforms.uSparkle.value = sparkleT >= 0 && sparkleT < 28 ? smoothstep(0, 1.5, sparkleT) * (1 - smoothstep(25, 28, sparkleT)) : 0;
    beamU.uOn.value = smoothstep(0.75, 1.0, env.night);
    beam.rotation.y = t * 0.13;
  };
}

// ───────────────────────── 其余的 ─────────────────────────

export function build(ctx: Ctx): Part {
  const r = rng(1889);
  const k = ctx.kit;
  const stone = stoneBatch(ctx), gold = paintBatch(ctx, 'gold'), plain = paintBatch(ctx, 'plain'), bronze = paintBatch(ctx, 'bronze');
  const fb = LIGHT_GEOMETRY ? ctx.shared.facade : new FacadeBuilder();
  const pots: { x: number; y: number; z: number; s: number }[] = [];
  const updEiffel = buildEiffel(ctx);

  // ── 大皇宫：石头的基座 + 钢和玻璃的大拱顶
  const gp = { x0: 150, x1: 390, z0: -170, z1: -60, top: UP_Y + 17.4 };
  addBlock(fb, pots, { x: gp.x0, z: gp.z0 }, { x: 0, z: 1 }, gp.z1 - gp.z0, gp.x1 - gp.x0, { floors: 3, detail: false, baseY: UP_Y, seed: 23.5, floorH: 6.4, mansard: false }, r);
  const colm = lathe([[0.95, 0], [0.98, 0.3], [0.82, 0.6], [0.8, 6], [0.7, 11.2], [0.92, 11.8], [0.98, 12.2]], 12);
  for (let z = gp.z0 + 6; z < gp.z1 - 3; z += 5.4) stone.add(colm, M(gp.x0 - 1.5, UP_Y + 4.4, z), 0xfff3dc, [2, 1.5]);
  for (let x = gp.x0 + 6; x < gp.x1 - 3; x += 5.4) stone.add(colm, M(x, UP_Y + 4.4, gp.z1 + 1.5), 0xfff3dc, [2, 1.5]);
  stone.box(gp.x0 - 1.5, UP_Y + 17.0, (gp.z0 + gp.z1) / 2, 3.2, 1.0, gp.z1 - gp.z0 + 3, 0xfff6e2);
  stone.box((gp.x0 + gp.x1) / 2, UP_Y + 17.0, gp.z1 + 1.5, gp.x1 - gp.x0 + 3, 1.0, 3.2, 0xfff6e2);
  stone.box(gp.x0 - 1.5, UP_Y + 2.2, (gp.z0 + gp.z1) / 2, 3.6, 4.4, gp.z1 - gp.z0 + 3, 0xf2e6cf);
  stone.box((gp.x0 + gp.x1) / 2, UP_Y + 2.2, gp.z1 + 1.5, gp.x1 - gp.x0 + 3, 4.4, 3.6, 0xf2e6cf);
  // 转角上的铜马车群像
  const q = new Batch();
  fame(q);
  for (const z of [gp.z0 + 4, gp.z1 - 4]) bronze.addBatch(q, M(gp.x0 + 3, gp.top + 0.5, z, -2.3, 2.3, 2.3));

  const cz = (gp.z0 + gp.z1) / 2, cx = 270, R = 21.5, base = gp.top + 1.2;
  const glassPatch = (dome: boolean) => ({
    uniforms: { uNoiseTex: { value: k.noise } },
    pars: /* glsl */ `
      float gLine(float d, float hw, float px) { return clamp((hw - d) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / px + 0.2); }
      float gRib = 0.0;`,
    color: dome
      ? /* glsl */ `
      {
        float ang = atan(vWPos.z - (${cz.toFixed(1)}), vWPos.x - ${cx.toFixed(1)});
        float rr = length(vWPos.xz - vec2(${cx.toFixed(1)}, ${cz.toFixed(1)}));
        gRib = gLine(abs(fract(ang / 0.2618) - 0.5) * 0.2618 * rr, 0.22, fwidth(ang) * rr + 0.02);
        gRib = max(gRib, gLine(abs(fract(vWPos.y / 3.2) - 0.5) * 3.2, 0.1, fwidth(vWPos.y) + 0.02));
        diffuseColor.rgb = mix(vec3(0.36, 0.44, 0.44), vec3(0.20, 0.25, 0.22), gRib);
      }`
      : /* glsl */ `
      {
        float ang = atan(vWPos.y - ${base.toFixed(1)}, vWPos.z - (${cz.toFixed(1)}));
        gRib = gLine(abs(fract(vWPos.x / 3.6) - 0.5) * 3.6, 0.16, fwidth(vWPos.x) + 0.02);
        gRib = max(gRib, gLine(abs(fract(ang / 0.1745) - 0.5) * 0.1745 * ${R.toFixed(1)}, 0.1, fwidth(ang) * ${R.toFixed(1)} + 0.02));
        diffuseColor.rgb = mix(vec3(0.36, 0.44, 0.44), vec3(0.20, 0.25, 0.22), gRib);
      }`,
    rough: 'roughnessFactor = mix(0.16, 0.6, gRib); metalnessFactor = mix(0.6, 0.3, gRib);',
    emissive: 'totalEmissiveRadiance += vec3(1.0, 0.76, 0.46) * uNight * 0.2 * (1.0 - gRib * 0.92) * (0.7 + 0.3 * texture2D(uNoiseTex, vWPos.xz * 0.02).r);',
  });
  const mkGlass = (dome: boolean) => withAtmo(new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.5, side: THREE.DoubleSide }), 'gp-glass-' + dome, (s) => patchStd(s, glassPatch(dome)));
  const vault = new THREE.Mesh(new THREE.CylinderGeometry(R, R, gp.x1 - gp.x0 - 30, LIGHT_GEOMETRY ? 24 : 48, 1, false, 0, Math.PI), mkGlass(false));
  vault.position.set((gp.x0 + gp.x1) / 2, base, cz);
  vault.rotation.z = Math.PI / 2;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(29, LIGHT_GEOMETRY ? 24 : 40, LIGHT_GEOMETRY ? 8 : 14, 0, Math.PI * 2, 0, Math.PI / 2), mkGlass(true));
  dome.position.set(cx, base + 8, cz);
  dome.scale.y = 0.86;
  for (const m of [vault, dome]) {
    m.updateMatrix();
    m.matrixAutoUpdate = false;
    m.castShadow = true;
    ctx.scene.add(m);
  }
  stone.add(new THREE.CylinderGeometry(29.6, 30.2, 8.4, 40, 1, true), M(cx, base + 4, cz), 0xdfe6dc, [6, 1]);
  bronze.add(lathe([[3.6, 0], [3.4, 5], [3.9, 5.4], [3.2, 6], [1.2, 8.4], [0.3, 9]], 12), M(cx, base + 8 + 24.6, cz), 0xcfd8cc);
  bronze.limb([cx, base + 41, cz], [cx, base + 54, cz], 0.14, 0.06, 0x888888);
  for (const [i, c] of [0x24408e, 0xf2f0ea, 0xc8202e].entries()) plain.box(cx, base + 52.2, cz - 0.9 - i * 1.5, 0.06, 2.9, 1.5, c);

  // ── 荣军院的金顶
  const dx = -770, dz = 0;
  stone.box(dx, UP_Y + 14, dz, 46, 28, 46, 0xf2e6cf);
  stone.add(new THREE.CylinderGeometry(14.6, 14.9, 22, 28), M(dx, UP_Y + 39, dz), 0xf6ead4, [8, 2]);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    stone.add(new THREE.CylinderGeometry(0.9, 0.95, 15, 8), M(dx + Math.cos(a) * 15.7, UP_Y + 36.5, dz + Math.sin(a) * 15.7), 0xfff3dc, [1, 2]);
  }
  stone.add(new THREE.CylinderGeometry(15.4, 16.6, 1.6, 28), M(dx, UP_Y + 44.6, dz), 0xfff6e2, [8, 0.3]);
  stone.add(new THREE.CylinderGeometry(13.9, 14.3, 5.4, 28), M(dx, UP_Y + 48.2, dz), 0xf2e6cf, [8, 0.6]);
  const domeMat = k.std({ color: 0xffffff, roughness: 0.34, metalness: 0.9 }, 'invalides-dome', {
    uniforms: { uNoiseTex: { value: k.noise } },
    color: /* glsl */ `
      {
        float ang = atan(vWPos.z - (${dz.toFixed(1)}), vWPos.x - (${dx.toFixed(1)}));
        float s = abs(fract(ang * 12.0 / 6.28318) - 0.5);
        float goldAmt = smoothstep(0.10, 0.16, s) * (0.55 + 0.45 * step(0.5, fract(vWPos.y * 0.22)));
        diffuseColor.rgb = mix(vec3(0.13, 0.15, 0.18), vec3(1.0, 0.72, 0.30), goldAmt);
      }`,
  });
  const domeI = new THREE.Mesh(lathe([[13.6, 0], [13.4, 3.2], [12.4, 7], [10.4, 10.8], [7.6, 14], [4.4, 16.2], [3.3, 16.8]], 36), domeMat);
  domeI.position.set(dx, UP_Y + 50.8, dz);
  domeI.updateMatrix();
  domeI.matrixAutoUpdate = false;
  ctx.scene.add(domeI);
  gold.add(lathe([[3.3, 0], [3.5, 0.5], [3.0, 1], [2.9, 8], [3.4, 8.6], [2.6, 9.6], [1.2, 12], [0.5, 14], [0.22, 26], [0.02, 30]], 12), M(dx, UP_Y + 67.4, dz), 0xffffff, [1, 1]);

  // ── 波旁宫：正对协和桥的十二根柱子
  const bz = 560, bx = -(STREET + 14);
  for (let i = 0; i < 4; i++) stone.box(bx - 5 - i * 0.7, UP_Y + 0.45 + i * 0.9, bz, 18 - i * 1.4, 0.9, 50 - i * 1.2, 0xf4e8d2);
  const pc = lathe([[0.98, 0], [1.0, 0.3], [0.86, 0.6], [0.84, 7], [0.74, 12.6], [0.98, 13.2], [1.02, 13.6]], 12);
  for (let i = 0; i < 12; i++) stone.add(pc, M(bx - 4, UP_Y + 3.6, bz - 19.8 + i * 3.6), 0xfff3dc, [2, 1.6]);
  stone.box(bx - 7.5, UP_Y + 18.2, bz, 9, 2.0, 44, 0xfff6e2);
  const tri = new THREE.Shape();
  tri.moveTo(-22.6, 0);
  tri.lineTo(22.6, 0);
  tri.lineTo(0, 5.6);
  tri.closePath();
  stone.add(new THREE.ExtrudeGeometry(tri, { depth: 9, bevelEnabled: false }), M(bx - 3, UP_Y + 19.2, bz, 1, 1, 1, -Math.PI / 2), 0xfff3dc);
  addBlock(fb, pots, { x: bx - 12, z: bz + 40 }, { x: 0, z: -1 }, 80, 44, { floors: 3, detail: false, baseY: UP_Y, seed: 7.5, floorH: 5.4, mansard: false }, r);
  bronze.limb([bx - 12, UP_Y + 24, bz], [bx - 12, UP_Y + 34, bz], 0.12, 0.05, 0x888888);
  for (const [i, c] of [0x24408e, 0xf2f0ea, 0xc8202e].entries()) plain.box(bx - 12, UP_Y + 32.6, bz - 0.8 - i * 1.3, 0.06, 2.5, 1.3, c);

  // ── 协和广场的方尖碑
  stone.box(335, UP_Y + 2.4, 560, 4.2, 4.8, 4.2, 0xe9dccb);
  stone.add(lathe([[1.25, 0], [0.82, 20.4]], 4), M(335, UP_Y + 4.8, 560, 1, 1, 1, Math.PI / 4), 0xe7c7ab, [1, 2]);
  gold.add(new THREE.ConeGeometry(0.82, 2.3, 4), M(335, UP_Y + 26.35, 560, 1, 1, 1, Math.PI / 4), 0xffffff, [1, 1]);

  // ── 美国教堂的尖塔（左岸，下游方向）
  const ax = -(STREET + 32), az = -432;
  stone.box(ax, UP_Y + 19, az, 9, 38, 9, 0xe6dccb);
  for (const a of [-1, 1]) for (const c of [-1, 1]) plain.add(new THREE.ConeGeometry(1.1, 7, 4), M(ax + a * 3.9, UP_Y + 41.5, az + c * 3.9, 1, 1, 1, Math.PI / 4), 0x4a4f58);
  plain.add(new THREE.ConeGeometry(5.6, 31, 8), M(ax, UP_Y + 53.5, az), 0x40454e);

  // ── 弯道尽头、右岸夏乐宫方向的高地：只是一道远远的轮廓
  for (let i = 0; i < 26; i++) {
    const u = BEND_U + BEND_R * (0.5 + i * 0.03), f = frame(u), s = 150 + r() * 260;
    const W = 30 + r() * 50;
    addBlock(fb, pots, { x: f.x + f.rx * s, z: f.z + f.rz * s }, { x: -f.tx, z: -f.tz }, W, 16, { floors: 6 + Math.floor(r() * 3), detail: false, baseY: UP_Y + 6 + r() * 22, seed: 1 + r() * 90 }, r);
  }

  if (!LIGHT_GEOMETRY) {
    const fm = new THREE.Mesh(fb.build(), makeFacadeMaterial(k));
    fm.castShadow = fm.receiveShadow = true;
    fm.matrixAutoUpdate = false;
    ctx.scene.add(fm);
  }
  put(ctx, stone, k.stone, 8, 'landmark-stone');
  put(ctx, gold, k.gold, 1, 'landmark-gold');
  put(ctx, bronze, k.bronze, 1, 'landmark-bronze');
  put(ctx, plain, k.plain, 1, 'landmark-plain');

  return { update: (dt, t) => updEiffel(dt, t) };
}
