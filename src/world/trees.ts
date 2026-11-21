import * as THREE from 'three';
import { ATMO_GLSL, atmo, env } from '../core/atmosphere';
import { foliage, seasonState } from '../core/seasons';
import { Batch, rng, type Rng } from '../core/util';
import { LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';
import { at, frame, LOW_Y, STREET, UP_Y, WALL } from './river';

/**
 * 树。每棵树的树冠是几十张永远面向镜头的小面片，每张贴着一簇叶子；
 * 光照不用面片自己的朝向，而是用「从树冠中心指向这张面片」的方向，所以整棵树是一个柔和的团，
 * 轮廓却是碎的。朝着太阳看过去时，树冠边缘的叶子会被照透，发黄绿色的光。
 */
const VERT = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 aLeaf;   // 大小, 随机, 离树冠中心的远近(0..1), 高度(0..1)
attribute vec4 aTree;   // 明暗, 偏黄, 相位, 树冠中心高度
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vToFrag;
varying vec4 vL;
varying vec3 vTint;
void main() {
  vec4 c = instanceMatrix * vec4(position, 1.0);
  vec3 crown = (instanceMatrix * vec4(0.0, aTree.w, 0.0, 1.0)).xyz;
  float h = length(instanceMatrix[1].xyz);
  float ph = aTree.z + uTime * 0.55;
  float up = max(c.y - crown.y + h * 0.3, 0.0);
  c.x += sin(ph + c.z * 0.11) * 0.012 * up + sin(uTime * 2.1 + aLeaf.y * 40.0) * 0.035;
  c.z += cos(ph * 0.83 + c.x * 0.09) * 0.010 * up + cos(uTime * 1.7 + aLeaf.y * 31.0) * 0.035;
  vec4 mv = viewMatrix * vec4(c.xyz, 1.0);
  float ang = aLeaf.y * 6.2832;
  vec2 cr = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * aCorner;
  mv.xy += cr * aLeaf.x * h;
  gl_Position = projectionMatrix * mv;
  vUv = aCorner * 0.5 + 0.5;
  vN = normalize(c.xyz - crown + vec3(0.0, h * 0.12, 0.0));
  vToFrag = c.xyz - cameraPosition;
  vL = aLeaf;
  vTint = aTree.xyz;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLeaf;
uniform vec3 uLeafTint;
uniform float uLeafDensity;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uSunL;
uniform float uMainPass;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vToFrag;
varying vec4 vL;
varying vec3 vTint;
${ATMO_GLSL}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  if (uLeafDensity < 0.01) discard;
  vec4 t = texture2D(uLeaf, vUv);
  float dist = length(vToFrag);
  // 远处叶子小到看不清，整簇变成一团半透明的软边
  float a = t.a * uLeafDensity * (1.0 + smoothstep(40.0, 420.0, dist) * 1.1);
  float n = ign(gl_FragCoord.xy);
  if (uMainPass > 0.5) {
    if (a < 0.1) discard;
    a = clamp(a + (n - 0.5) * 0.18, 0.0, 1.0);
  } else {
    if (a < 0.25 + 0.5 * n) discard;
    a = 1.0;
  }
  vec3 N = normalize(vN);
  vec3 Vd = vToFrag / dist;
  float nl = dot(N, uSunDir);
  float lit = smoothstep(-0.2, 0.8, nl);
  lit *= mix(0.22, 1.0, smoothstep(0.1, 0.8, vL.w));   // 树冠下半截被旁边的树挡着
  lit *= mix(0.35, 1.0, vL.z * vL.z);
  float leafV = 0.62 + 0.7 * t.r;
  vec3 base = mix(vec3(0.046, 0.078, 0.022), vec3(0.10, 0.108, 0.028), t.g * 0.3 + vTint.y) * leafV * vTint.x * (0.82 + 0.36 * vL.y);
  base *= uLeafTint;
  float ao = mix(0.26, 1.0, vL.z * vL.z) * mix(0.55, 1.0, vL.w);
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * ao;
  float back = max(dot(Vd, uSunDir), 0.0);
  float trans = pow(back, 5.0) * smoothstep(0.45, 1.0, vL.z) * (0.3 + 0.7 * t.r);
  vec3 col = base * (amb * 2.1 + uSunL * lit) + vec3(0.20, 0.21, 0.03) * uLeafTint * uSunL * trans;
  col = atmoFog(col, vToFrag, cameraPosition.y);
  gl_FragColor = vec4(col, a);
}`;

const DEPTH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uLeaf;
uniform vec3 uLeafTint;
uniform float uLeafDensity;
varying vec2 vUv;
void main() {
  if (texture2D(uLeaf, vUv).a * uLeafDensity < 0.3) discard;
  gl_FragColor = vec4(1.0);
}`;

// 树冠里面再垫一个暗色的实心团：近看时叶片之间不会透出天来，树才有分量
const CORE_VERT = /* glsl */ `
attribute vec4 aTree;
varying vec3 vN;
varying vec3 vToFrag;
varying float vH;
varying vec3 vTint;
void main() {
  vec4 c = instanceMatrix * vec4(position, 1.0);
  vec3 crown = (instanceMatrix * vec4(0.0, aTree.w, 0.0, 1.0)).xyz;
  vN = normalize(c.xyz - crown);
  vToFrag = c.xyz - cameraPosition;
  vH = uv.y;
  vTint = aTree.xyz;
  gl_Position = projectionMatrix * viewMatrix * c;
}`;
const CORE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uLeafTint;
uniform float uLeafDensity;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform vec3 uSunL;
varying vec3 vN;
varying vec3 vToFrag;
varying float vH;
varying vec3 vTint;
${ATMO_GLSL}
void main() {
  if (uLeafDensity < 0.5) discard;
  vec3 N = normalize(vN);
  float lit = smoothstep(-0.2, 0.8, dot(N, uSunDir)) * mix(0.22, 1.0, smoothstep(0.1, 0.8, vH)) * 0.3;
  vec3 base = vec3(0.040, 0.066, 0.020) * uLeafTint * vTint.x;
  vec3 amb = mix(uAmbGround, uAmbSky, N.y * 0.5 + 0.5) * 0.3 * mix(0.55, 1.0, vH);
  vec3 col = base * (amb * 2.2 + uSunL * lit);
  col = atmoFog(col, vToFrag, cameraPosition.y);
  gl_FragColor = vec4(col, 1.0);
}`;

function coreGeo(kind: 'round' | 'poplar', r: Rng) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  const sc = kind === 'round' ? [0.2, 0.19, 0.2, 0.66] : [0.066, 0.3, 0.066, 0.56];
  // 同一位置的顶点要用同一个位移，不然会裂开
  const disp = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!disp.has(key)) disp.set(key, 0.8 + r() * 0.3);
    const d = disp.get(key)!;
    const y = p.getY(i);
    uv.setY(i, y * 0.5 * d + 0.5);
    p.setXYZ(i, p.getX(i) * d * sc[0], y * d * sc[1] + sc[3], p.getZ(i) * d * sc[2]);
  }
  return g;
}

/** 主画面用 alpha-to-coverage 出软边；水面倒影那一遍没有多重采样，改用抖动丢弃 */
export const treePass = { value: 1 };

interface Tpl { geo: THREE.BufferGeometry; crownY: number }

function template(kind: 'round' | 'poplar' | 'ivy', n: number, r: Rng): Tpl {
  const pos: number[] = [], corner: number[] = [], leaf: number[] = [], idx: number[] = [];
  const lobes: [number, number, number, number, number, number][] = [];
  let crownY = 0.66;
  if (kind === 'round') {
    lobes.push([0, 0.66, 0, 0.3, 0.3, 0.3]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.283 + r() * 0.8;
      lobes.push([Math.cos(a) * 0.2, 0.56 + r() * 0.2, Math.sin(a) * 0.2, 0.19 + r() * 0.06, 0.17 + r() * 0.07, 0.19 + r() * 0.06]);
    }
  } else if (kind === 'poplar') {
    crownY = 0.56;
    lobes.push([0, 0.56, 0, 0.105, 0.43, 0.105]);
    lobes.push([0.02, 0.34, 0.01, 0.12, 0.2, 0.12], [-0.01, 0.78, 0.0, 0.07, 0.2, 0.07]);
  } else {
    crownY = 0.5;
    lobes.push([0, 0.5, 0, 0.5, 0.48, 0.18]);
    for (let i = 0; i < 4; i++) lobes.push([(r() - 0.5) * 0.7, 0.25 + r() * 0.5, 0, 0.26, 0.3, 0.14]);
  }
  const ext = kind === 'round' ? 0.4 : kind === 'poplar' ? 0.45 : 0.5;
  for (let i = 0; i < n; i++) {
    const L = lobes[i % lobes.length];
    // 大部分面片在团的表面，少数在里面
    const th = r() * 6.283, ph = Math.acos(2 * r() - 1), rad = r() < 0.72 ? 0.82 + r() * 0.22 : Math.pow(r(), 0.6) * 0.8;
    let x = L[0] + Math.sin(ph) * Math.cos(th) * L[3] * rad;
    const y = L[1] + Math.cos(ph) * L[4] * rad;
    let z = L[2] + Math.sin(ph) * Math.sin(th) * L[5] * rad;
    if (kind === 'ivy') z = Math.abs(z) * 0.6;
    if (kind === 'ivy') x *= 1.0;
    const d = Math.min(1, Math.hypot(x, (y - crownY) * (kind === 'poplar' ? 0.3 : 1), z) / ext);
    const size = kind === 'round' ? 0.1 + r() * 0.055 : kind === 'poplar' ? 0.068 + r() * 0.034 : 0.17 + r() * 0.1;
    const base = pos.length / 3;
    const hN = kind === 'ivy' ? 0.8 : (y - (crownY - ext)) / (2 * ext);
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(x, y, z);
      corner.push(cx, cy);
      leaf.push(size, r(), d, Math.min(1, Math.max(0, hN)));
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  geo.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 4));
  geo.setIndex(idx);
  return { geo, crownY };
}

interface Inst { x: number; y: number; z: number; h: number; w: number; ry: number; bright: number; yellow: number; trunk: boolean; d?: number }

export function build(ctx: Ctx): Part {
  const r = rng(1789);
  const q = ctx.quality.trees;
  const uniforms = {
    ...atmo,
    ...foliage,
    uLeaf: { value: ctx.kit.foliage },
    uAmbSky: { value: env.ambSky },
    uAmbGround: { value: env.ambGround },
    uSunL: { value: new THREE.Color() },
    uMainPass: treePass,
  };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, alphaToCoverage: true, side: THREE.DoubleSide });
  const depthMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: DEPTH_FRAG, uniforms, side: THREE.DoubleSide });

  const coreMat = new THREE.ShaderMaterial({ vertexShader: CORE_VERT, fragmentShader: CORE_FRAG, uniforms });
  const lists: Record<string, Inst[]> = { roundNear: [], roundFar: [], poplarNear: [], poplarFar: [], ivy: [] };
  const nearU = (u: number, s: number) => u > -560 && u < 760 && Math.abs(s) < 150;
  const add = (kind: 'round' | 'poplar', u: number, s: number, y: number, h: number, w = 1) => {
    if (LIGHT_GEOMETRY && r() < 0.28) return; // 轻量画质：行道树稀一点
    const p = at(u, s);
    lists[kind + (nearU(u, s) ? 'Near' : 'Far')].push({ x: p.x, y, z: p.z, h, w, ry: r() * 6.283, bright: 0.82 + r() * 0.36, yellow: r() * 0.16, trunk: true });
  };
  const bridgeHeads = [0, -560, 240, 883];
  const clear = (u: number, m = 30) => bridgeHeads.every((b) => Math.abs(u - b) > m);

  for (const side of [-1, 1]) {
    const dens = side < 0 ? [0.58, 0.42] : [0.9, 0.9, 0.72];
    const rows = side < 0 ? [STREET + 3.3, STREET + 17.5] : [STREET + 3.3, STREET + 11.5, STREET + 20];
    rows.forEach((s, ri) => {
      for (let u = -1160; u < 2300; u += 9.6 + r() * 2.6) {
        if (!clear(u)) continue;
        const far = u > 900 || u < -700;
        if (r() > dens[ri] * (far ? 0.55 : 1)) continue;
        if (side < 0 && Math.abs(u) < 150 && ri === 1) continue;
        // 左岸留几段空档，让楼的立面露出来
        if (side < 0 && ((u > 170 && u < 215) || (u > 330 && u < 372) || (u > -330 && u < -290))) continue;
        add('round', u, side * (s + (r() - 0.5) * 0.8), UP_Y, 14.5 + r() * 5.5, 0.9 + r() * 0.3);
      }
    });
    // 下层码头：贴着挡墙的一排，白杨和悬铃木混着
    for (let u = -720; u < 1500; u += 8.5 + r() * 3.5) {
      if (!clear(u, 34)) continue;
      const far = u > 700;
      if (r() > (side < 0 ? 0.5 : 0.62) * (far ? 0.6 : 1)) continue;
      if (r() < 0.55) add('poplar', u, side * (WALL - 2.4 - r() * 0.8), LOW_Y, 19 + r() * 6, 1.1 + r() * 0.35);
      else add('round', u, side * (WALL - 3.2 - r()), LOW_Y, 11 + r() * 4, 0.85 + r() * 0.25);
    }
  }
  // 右岸：香榭丽舍花园和大小皇宫周围
  for (let i = 0; i < 190 * q; i++) {
    const u = -660 + r() * 900, s = STREET + 28 + r() * 260;
    if (u > 30 && u < 250 && s > 140 - 12) continue; // 大皇宫
    if (u > -175 && u < -30 && s > 160) continue; // 小皇宫
    if (Math.abs(u) < 24) continue;
    add('round', u, s, UP_Y, 15 + r() * 8, 0.95 + r() * 0.35);
  }
  // 左岸：荣军院广场两边修剪整齐的椴树
  for (const zz of [-128, -117, 117, 128])
    for (let s = STREET + 30; s < 500; s += 10.5) {
      if (r() < 0.12) continue;
      const p = { u: -zz, s: -s };
      add('round', p.u, p.s, UP_Y, 10 + r() * 2, 0.85);
    }
  // 铁塔脚下和布朗利河岸
  for (let i = 0; i < 110 * q; i++) {
    const a = r() * 6.283, d = 60 + r() * 330;
    const x = -611 + Math.cos(a) * d, z = -1390 + Math.sin(a) * d;
    lists.roundFar.push({ x, y: UP_Y, z, h: 14 + r() * 9, w: 1 + r() * 0.3, ry: r() * 6, bright: 0.85 + r() * 0.3, yellow: r() * 0.15, trunk: false });
  }
  // 挡墙上垂下来的爬藤
  for (const side of [-1, 1])
    for (let u = -680; u < 620; u += 30 + r() * 46) {
      if (!clear(u, 40)) continue;
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const uu = u + k * 5.5 + r() * 2, f = frame(uu), p = at(uu, side * (WALL + 0.05));
        const h = 5.5 + r() * 3.5;
        lists.ivy.push({ x: p.x, y: UP_Y + 0.9 - h * 0.72, z: p.z, h, w: 1.0 + r() * 0.6, ry: f.yaw + (side < 0 ? Math.PI / 2 : -Math.PI / 2), bright: 0.7 + r() * 0.3, yellow: r() * 0.25, trunk: false, d: 0.5 });
      }
    }

  if (LIGHT_GEOMETRY) return buildCulled(ctx, lists, r, mat, coreMat, uniforms);

  const tpl = {
    roundNear: template('round', Math.round(150 * q), r),
    roundFar: template('round', Math.round(46 * q), r),
    poplarNear: template('poplar', Math.round(84 * q), r),
    poplarFar: template('poplar', Math.round(32 * q), r),
    ivy: template('ivy', 70, r),
  };
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler();
  const pv = new THREE.Vector3(), sv = new THREE.Vector3();
  let total = 0;
  const trunks: Inst[] = [];
  for (const [name, list] of Object.entries(lists)) {
    if (!list.length) continue;
    const t = tpl[name as keyof typeof tpl];
    const far = name.endsWith('Far');
    const geo = t.geo;
    if (far) {
      // 远处的树面片少，所以每张大一点
      const lf = geo.attributes.aLeaf as THREE.BufferAttribute;
      for (let i = 0; i < lf.count; i++) lf.setX(i, lf.getX(i) * 1.45);
    }
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const tree = new Float32Array(list.length * 4);
    list.forEach((it, i) => {
      e.set(0, it.ry, 0);
      qt.setFromEuler(e);
      m.compose(pv.set(it.x, it.y, it.z), qt, sv.set(it.h * it.w, it.h, it.h * (it.d ?? it.w)));
      im.setMatrixAt(i, m);
      tree.set([it.bright, it.yellow, r() * 6.283, t.crownY], i * 4);
      if (name !== 'ivy') trunks.push(it);
    });
    geo.setAttribute('aTree', new THREE.InstancedBufferAttribute(tree, 4));
    im.instanceMatrix.needsUpdate = true;
    if (name !== 'ivy') {
      const cg = coreGeo(name.startsWith('round') ? 'round' : 'poplar', r);
      cg.setAttribute('aTree', new THREE.InstancedBufferAttribute(tree, 4));
      const core = new THREE.InstancedMesh(cg, coreMat, list.length);
      list.forEach((_, i) => {
        im.getMatrixAt(i, m);
        core.setMatrixAt(i, m);
      });
      core.instanceMatrix.needsUpdate = true;
      core.castShadow = true;
      core.customDepthMaterial = new THREE.ShaderMaterial({ vertexShader: CORE_VERT, uniforms, fragmentShader: 'uniform float uLeafDensity; void main() { if (uLeafDensity < 0.5) discard; gl_FragColor = vec4(1.0); }' });
      core.frustumCulled = false;
      core.name = 'tree-core-' + name;
      ctx.scene.add(core);
    }
    im.customDepthMaterial = depthMat;
    im.castShadow = name !== 'ivy';
    im.receiveShadow = false;
    im.frustumCulled = false;
    im.name = 'trees-' + name;
    ctx.scene.add(im);
    total += list.length;
  }

  // 树干：一根收分的圆柱，加两三根主枝
  const tg = branchGeometry();
  const trunkMat = ctx.kit.std({ color: 0x3b3229, roughness: 0.95 }, 'trunk');
  const tm = new THREE.InstancedMesh(tg, trunkMat, trunks.length);
  trunks.forEach((it, i) => tm.setMatrixAt(i, m.compose(pv.set(it.x, it.y, it.z), qt.setFromEuler(e.set(0, it.ry, 0)), sv.set(it.h * it.w, it.h, it.h * it.w))));
  tm.instanceMatrix.needsUpdate = true;
  tm.castShadow = true;
  tm.frustumCulled = false;
  tm.name = 'trunks';
  ctx.scene.add(tm);
  console.debug('[open-waters] trees:', total);

  return {
    update() {
      uniforms.uSunL.value.copy(env.sunLight).multiplyScalar(env.sunIntensity / Math.PI);
    },
  };
}

// ───────────────────────── 轻量画质：按视野挑树 ─────────────────────────

const NEAR = 260; // 这以内画完整叶片 + 暗核 + 树干
const FAR = 1700; // 这以内画少量大叶片；再远交给雾

interface Lod { mesh: THREE.InstancedMesh; tree: THREE.InstancedBufferAttribute; n: number }

/**
 * 手机上不能每帧把两千棵树全画一遍。树的位置不动，所以每隔一会儿（镜头转过几度、走过几米，最长 0.5 s）
 * 重新挑一次：视野里（放宽一圈，转头时不会穿帮）或者倒影里看得见的树，近的用完整模板，远的用少片大叶的模板。
 * 只改实例数组和 count，不建新对象。
 */
function buildCulled(ctx: Ctx, lists: Record<string, Inst[]>, r: Rng, mat: THREE.ShaderMaterial, coreMat: THREE.ShaderMaterial, uniforms: { uSunL: { value: THREE.Color } }): Part {
  const kinds: { name: string; items: Inst[]; near: number; far: number; core: boolean; farScale: number }[] = [
    { name: 'round', items: [...lists.roundNear, ...lists.roundFar], near: 64, far: 16, core: true, farScale: 1.75 },
    { name: 'poplar', items: [...lists.poplarNear, ...lists.poplarFar], near: 40, far: 12, core: true, farScale: 1.6 },
    { name: 'ivy', items: lists.ivy, near: 36, far: 0, core: false, farScale: 1 },
  ];
  const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), e = new THREE.Euler(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  const mk = (geo: THREE.BufferGeometry, material: THREE.Material, cap: number, name: string): Lod => {
    const tree = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    tree.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aTree', tree);
    const mesh = new THREE.InstancedMesh(geo, material, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.name = name;
    ctx.scene.add(mesh);
    return { mesh, tree, n: 0 };
  };
  const groups = kinds.filter((k) => k.items.length).map((k) => {
    const n = k.items.length;
    const nearT = template(k.name as 'round', k.near, r);
    const lods = { near: mk(nearT.geo, mat, n, `trees-${k.name}`), far: null as Lod | null, core: null as Lod | null };
    if (k.far) {
      const farT = template(k.name as 'round', k.far, r);
      const lf = farT.geo.attributes.aLeaf as THREE.BufferAttribute;
      for (let i = 0; i < lf.count; i++) lf.setX(i, lf.getX(i) * k.farScale);
      lods.far = mk(farT.geo, mat, n, `trees-${k.name}-far`);
    }
    if (k.core) {
      lods.core = mk(coreGeo(k.name as 'round', r), coreMat, n, `tree-core-${k.name}`);
      mainOnly(lods.core.mesh); // 倒影里有叶片就够了
    }
    // 每棵树的矩阵和参数先算好，挑的时候直接拷
    const mats = new Float32Array(n * 16), data = new Float32Array(n * 4), sphere = new Float32Array(n * 4);
    k.items.forEach((it, i) => {
      e.set(0, it.ry, 0);
      qt.setFromEuler(e);
      m.compose(pv.set(it.x, it.y, it.z), qt, sv.set(it.h * it.w, it.h, it.h * (it.d ?? it.w)));
      m.toArray(mats, i * 16);
      data.set([it.bright, it.yellow, r() * 6.283, nearT.crownY], i * 4);
      sphere.set([it.x, it.y + it.h * nearT.crownY, it.z, it.h * 0.55 * Math.max(it.w, 1)], i * 4);
    });
    return { k, lods, mats, data, sphere };
  });

  // 树干
  const trunkItems = kinds.filter((k) => k.name !== 'ivy').flatMap((k) => k.items);
  const tg = branchGeometry();
  const trunks = new THREE.InstancedMesh(tg, ctx.kit.std({ color: 0x3b3229, roughness: 0.95 }, 'trunk'), trunkItems.length);
  trunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trunks.count = 0;
  trunks.frustumCulled = false;
  trunks.name = 'trunks';
  ctx.scene.add(trunks);
  mainOnly(trunks);
  const trunkMats = new Float32Array(trunkItems.length * 16);
  trunkItems.forEach((it, i) => m.compose(pv.set(it.x, it.y, it.z), qt.setFromEuler(e.set(0, it.ry, 0)), sv.set(it.h * it.w, it.h, it.h * it.w)).toArray(trunkMats, i * 16));

  const frustum = new THREE.Frustum(), wide = new THREE.PerspectiveCamera(), pm = new THREE.Matrix4();
  const lastPos = new THREE.Vector3(1e9, 0, 0), lastDir = new THREE.Vector3(), dir = new THREE.Vector3(), sph = new THREE.Sphere();
  let since = 1e9;
  const visible = (x: number, y: number, z: number, rad: number) => {
    sph.center.set(x, y, z);
    sph.radius = rad;
    if (frustum.intersectsSphere(sph)) return true;
    sph.center.y = -y; // 倒影：水面以下的镜像
    return frustum.intersectsSphere(sph);
  };
  const put = (lod: Lod, src: Float32Array, data: Float32Array | null, i: number) => {
    (lod.mesh.instanceMatrix.array as Float32Array).set(src.subarray(i * 16, i * 16 + 16), lod.n * 16);
    if (data) (lod.tree.array as Float32Array).set(data.subarray(i * 4, i * 4 + 4), lod.n * 4);
    lod.n++;
  };
  const commit = (lod: Lod | null) => {
    if (!lod) return;
    lod.mesh.count = lod.n;
    const im = lod.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, lod.n * 16);
    im.needsUpdate = true;
    lod.tree.clearUpdateRanges();
    lod.tree.addUpdateRange(0, lod.n * 4);
    lod.tree.needsUpdate = true;
  };
  const cull = (cam: THREE.PerspectiveCamera) => {
    // 视锥放宽一圈：两次重挑之间转头，边上的树不会突然冒出来
    wide.copy(cam);
    wide.fov = Math.min(cam.fov * 1.45 + 10, 150);
    wide.aspect = cam.aspect * 1.25;
    wide.far = FAR;
    wide.updateProjectionMatrix();
    pm.multiplyMatrices(wide.projectionMatrix, cam.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pm);
    const cx = cam.position.x, cz = cam.position.z;
    const tl = { lod: trunks, n: 0 } as unknown as Lod;
    for (const g of groups) {
      const { lods, mats, data, sphere } = g;
      lods.near.n = 0;
      if (lods.far) lods.far.n = 0;
      if (lods.core) lods.core.n = 0;
      for (let i = 0; i < g.k.items.length; i++) {
        const x = sphere[i * 4], y = sphere[i * 4 + 1], z = sphere[i * 4 + 2], rad = sphere[i * 4 + 3];
        const d = Math.hypot(x - cx, z - cz);
        if (d > FAR || !visible(x, y, z, rad)) continue;
        if (d < NEAR || !lods.far) {
          put(lods.near, mats, data, i);
          if (lods.core) put(lods.core, mats, data, i);
        } else put(lods.far, mats, data, i);
      }
      commit(lods.near);
      commit(lods.far);
      commit(lods.core);
    }
    let tn = 0;
    const ta = trunks.instanceMatrix.array as Float32Array;
    for (let i = 0; i < trunkItems.length; i++) {
      const it = trunkItems[i];
      if (Math.hypot(it.x - cx, it.z - cz) > (seasonState.current === 'winter' ? 900 : NEAR) || !visible(it.x, it.y + it.h * 0.5, it.z, it.h * 0.6)) continue;
      ta.set(trunkMats.subarray(i * 16, i * 16 + 16), tn * 16);
      tn++;
    }
    trunks.count = tn;
    trunks.instanceMatrix.clearUpdateRanges();
    trunks.instanceMatrix.addUpdateRange(0, tn * 16);
    trunks.instanceMatrix.needsUpdate = true;
    void tl;
  };

  return {
    update(dt, _t, cam) {
      uniforms.uSunL.value.copy(env.sunLight).multiplyScalar(env.sunIntensity / Math.PI);
      const c = cam as THREE.PerspectiveCamera;
      c.getWorldDirection(dir);
      since += dt;
      if (since > 0.5 || c.position.distanceToSquared(lastPos) > 2.25 || dir.dot(lastDir) < 0.9976) {
        since = 0;
        lastPos.copy(c.position);
        lastDir.copy(dir);
        cull(c);
      }
    },
  };
}

function branchGeometry() {
  const b = new Batch(), random = rng(831);
  type P = [number, number, number];
  // 弯曲、逐段变细的枝条；同一份几何实例化，四季切换不重建场景。
  const branch = (start: P, dir: P, length: number, radius: number, depth: number) => {
    let p = start;
    const nodes: P[] = [p];
    const segments = depth > 0 ? 3 : 2;
    for (let j = 1; j <= segments; j++) {
      const k = j / segments;
      const q: P = [start[0] + dir[0] * length * k + (random() - .5) * length * .12,
        start[1] + dir[1] * length * k + .12 * length * k * k,
        start[2] + dir[2] * length * k + (random() - .5) * length * .12];
      b.limb(p, q, radius * (1 - .8 * (j - 1) / segments), radius * (1 - .8 * k), 0xffffff, depth > 1 ? 5 : 3);
      p = q; nodes.push(p);
    }
    if (depth <= 0) return;
    for (let j = 0; j < 3; j++) {
      const a = random() * Math.PI * 2;
      const child: P = [dir[0] * .55 + Math.cos(a) * .65, .65 + random() * .4, dir[2] * .55 + Math.sin(a) * .65];
      branch(nodes[j === 0 ? 1 : 2], child, length * (.42 + random() * .22), radius * .42, depth - 1);
    }
  };
  b.limb([0, 0, 0], [.009, .42, -.008], .024, .014, 0xffffff, 6);
  for (let j = 0; j < 6; j++) {
    const a = j * 2.4;
    branch([.009, .32 + j * .024, -.008], [Math.cos(a) * .48, .8 + random() * .2, Math.sin(a) * .48], .34 + random() * .16, .012, 2);
  }
  return b.build();
}
