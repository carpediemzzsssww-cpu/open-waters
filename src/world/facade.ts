import * as THREE from 'three';
import { atmo, withAtmo, env } from '../core/atmosphere';
import { LIGHT_GEOMETRY } from '../core/env';
import type { Kit } from './materials';
import { patchStd } from './materials';

/**
 * 奥斯曼式立面，全在片元着色器里按「开间 × 楼层」生成：
 * 石材的横缝和檐线、带进深的窗洞（视角一变，窗框和窗台的遮挡关系跟着变）、
 * 白色木窗和纱帘、铁艺栏杆、底层的店面和雨篷、锌皮的芒萨尔屋顶和老虎窗。
 * 天色暗下来，一扇一扇的窗会各自亮起暖光。
 * 好处：几百栋楼只要很少的三角形，而且再近也不糊。
 */
export const facadeUniforms = { uWinGlow: { value: 0 } };

const PARS = /* glsl */ `
varying vec4 vF;
varying float vK;
varying vec3 vP;
uniform float uWinGlow;
vec3 fEmit = vec3(0.0);
float fRough = 0.92;
float fMetal = 0.0;

float h11(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float band(float a, float b, float x, float w) {
  return clamp((x - a) / w + 0.5, 0.0, 1.0) - clamp((x - b) / w + 0.5, 0.0, 1.0);
}
// 一条半宽 hw 的线，按像素覆盖率抗锯齿；细到不足一个像素时按比例变淡
float lineAA(float d, float hw, float px) {
  return clamp((hw - d) / px + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / px + 0.15);
}
vec3 stoneTint(float seed) {
  float h = h11(seed * 3.7);
  vec3 honey = vec3(0.66, 0.535, 0.33), cream = vec3(0.76, 0.69, 0.53), grey = vec3(0.60, 0.545, 0.45);
  return h < 0.5 ? mix(honey, cream, h * 2.0) : mix(cream, grey, (h - 0.5) * 2.0);
}
vec3 warmLight(float h) { return mix(vec3(1.0, 0.56, 0.24), vec3(1.0, 0.78, 0.50), h); }

vec3 windowPane(vec2 g, vec2 size, float id, float id2, float px, float litScale, out float rough, out float metal, out vec3 emit) {
  // g：窗内坐标（米），size：窗宽高
  float frame = 1.0 - band(0.06, size.x - 0.06, g.x, px) * band(0.05, size.y - 0.06, g.y, px);
  float stile = lineAA(abs(g.x - size.x * 0.5), 0.034, px);
  float bars = lineAA(abs(g.y - size.y * 0.36), 0.022, px) + lineAA(abs(g.y - size.y * 0.72), 0.03, px);
  float wood = clamp(frame + stile + bars, 0.0, 1.0);
  // 玻璃后面：有的拉着纱帘，有的半掩，有的黑着
  float curtain = step(0.38, id);
  float half_ = step(0.72, id);
  float cmask = curtain * mix(1.0, step(abs(g.x / size.x - 0.5), 0.5) * step(0.22, abs(g.x / size.x - 0.5)), half_);
  float folds = 0.82 + 0.18 * sin(g.x * 46.0 + id * 30.0);
  vec3 glass = vec3(0.030, 0.038, 0.048);
  vec3 col = mix(glass, vec3(0.50, 0.47, 0.41) * folds, cmask * 0.78);
  rough = mix(0.07, 0.5, cmask * 0.8);
  metal = mix(0.5, 0.1, cmask);
  // 亮灯
  float lit = step(id2, uWinGlow * litScale);
  float gx = g.x / size.x, gy = g.y / size.y;
  float lamp = 0.5 + 0.5 * exp(-((gx - 0.3 - id * 0.4) * (gx - 0.3 - id * 0.4) * 7.0 + (gy - 0.7) * (gy - 0.7) * 4.0));
  vec3 warm = warmLight(fract(id * 7.3)) * (0.7 + 1.5 * fract(id2 * 13.7));
  emit = warm * lamp * mix(1.0, 0.72 * folds, cmask) * lit * (1.0 - wood * 0.9) * 1.25;
  col = mix(col, vec3(0.62, 0.60, 0.56), wood);
  rough = mix(rough, 0.6, wood);
  metal *= 1.0 - wood;
  return col;
}

vec3 facadeWall(vec2 uv, float W, float seed, float FH, float nFl, float bayW, vec3 Vt, vec3 Lt) {
  vec3 st = stoneTint(seed);
  const float G = 4.6;
  float fw = max(fwidth(uv.x), 1e-4), fh = max(fwidth(uv.y), 1e-4);
  float px = max(fw, fh);
  float fl, fy, flH;
  if (uv.y < G) { fl = 0.0; fy = uv.y; flH = G; }
  else { fl = min(1.0 + floor((uv.y - G) / FH), nFl - 1.0); fy = uv.y - G - (fl - 1.0) * FH; flH = FH; }
  float nb = max(floor(W / bayW + 0.5), 1.0);
  float bw = W / nb;
  float bi = floor(uv.x / bw);
  float bx = uv.x - bi * bw;
  float ground = 1.0 - step(0.5, fl);

  // 石面：横缝（底层是深的凹缝）、风化的深浅
  vec3 col = st;
  float n1 = texture2D(uNoiseTex, vec2(uv.x * 0.06 + seed * 0.37, uv.y * 0.011)).r;
  float n2 = texture2D(uNoiseTex, uv * 0.31 + seed).g;
  col *= 0.86 + 0.2 * n1 + 0.1 * n2;
  float course = ground > 0.5 ? 0.46 : 0.41;
  float jy = abs(fract(uv.y / course) - 0.5) * course;
  col *= 1.0 - lineAA(jy, ground > 0.5 ? 0.022 : 0.006, fh) * (ground > 0.5 ? 0.32 : 0.14);
  col *= mix(0.84, 1.0, smoothstep(0.0, 3.0, uv.y));
  // 每层顶上一道檐线：亮边 + 下面的阴影
  float topD = flH - fy;
  col *= 1.0 + 0.12 * band(0.0, 0.17, topD, fh) - 0.2 * band(0.17, 0.5, topD, fh) * (1.0 - smoothstep(0.17, 0.5, topD));

  // 窗洞
  float ww = ground > 0.5 ? bw * 0.64 : 1.2;
  float x0 = (bw - ww) * 0.5, x1 = x0 + ww;
  float y0 = ground > 0.5 ? 0.2 : 0.3;
  float y1 = ground > 0.5 ? G - 1.0 : (fl < 1.5 ? flH - 0.48 : flH - 0.62);
  float open = band(x0, x1, bx, fw) * band(y0, y1, fy, fh);
  float sur = band(x0 - 0.17, x1 + 0.17, bx, fw) * band(y0 - 0.06, y1 + 0.22, fy, fh);
  col = mix(col, st * 1.08, clamp(sur - open, 0.0, 1.0) * 0.55);
  // 窗楣下的拱心石
  col *= 1.0 - 0.1 * band(x0 + ww * 0.5 - 0.11, x0 + ww * 0.5 + 0.11, bx, fw) * band(y1 + 0.02, y1 + 0.3, fy, fh);

  if (open > 0.003) {
    const float D = 0.26; // 窗洞的进深
    vec2 g = vec2(bx, fy) - Vt.xy / max(Vt.z, 0.22) * D;
    float inside = step(x0, g.x) * step(g.x, x1) * step(y0, g.y) * step(g.y, y1);
    vec2 cell = vec2(bi, fl);
    float id = h21(cell + seed * 17.0), id2 = h21(cell * 1.7 + seed * 5.0 + 3.0);
    vec3 wc; float r_, m_; vec3 e_ = vec3(0.0);
    if (inside > 0.5) {
      if (ground > 0.5) {
        // 店面：大玻璃，里面早早亮灯；有的带一条雨篷
        float aw = step(0.45, h11(seed * 2.2)) * step(y1 - 0.75, g.y);
        vec3 awc = mix(vec3(0.20, 0.025, 0.03), vec3(0.03, 0.10, 0.065), step(0.5, h11(seed * 4.4)));
        awc = mix(awc, vec3(0.5, 0.45, 0.36), step(0.8, h11(seed * 6.1)));
        float mull = lineAA(abs(fract((g.x - x0) / (ww / 3.0)) - 0.5) * (ww / 3.0), 0.03, px);
        float glow = step(id2, 0.25 + uWinGlow * 1.4) * smoothstep(0.3, 0.6, uWinGlow + 0.25);
        wc = mix(vec3(0.03, 0.035, 0.04), vec3(0.08, 0.075, 0.07), mull);
        e_ = warmLight(id) * glow * (0.6 + 0.8 * id) * (1.0 - mull) * (0.6 + 0.4 * (g.y - y0) / (y1 - y0));
        r_ = 0.1; m_ = 0.4 * (1.0 - mull);
        wc = mix(wc, awc, aw); e_ *= 1.0 - aw; r_ = mix(r_, 0.85, aw); m_ *= 1.0 - aw;
      } else {
        wc = windowPane(g - vec2(x0, y0), vec2(ww, y1 - y0), id, id2, px, 0.62, r_, m_, e_);
      }
      // 窗洞在玻璃上投的影
      if (Lt.z > 0.02) {
        vec2 sg = g + Lt.xy / max(Lt.z, 0.1) * D;
        float sunIn = step(x0, sg.x) * step(sg.x, x1) * step(y0, sg.y) * step(sg.y, y1);
        wc *= mix(0.55, 1.0, sunIn);
      }
    } else {
      // 看到的是窗洞的侧壁 / 窗楣底
      float sideLit = g.x < x0 ? max(Lt.x, 0.0) : (g.x > x1 ? max(-Lt.x, 0.0) : 0.0);
      wc = st * (0.6 + 0.5 * sideLit) * (g.y > y1 ? 0.7 : 1.0);
      r_ = 0.92; m_ = 0.0;
    }
    col = mix(col, wc, open);
    fRough = mix(fRough, r_, open);
    fMetal = mix(fMetal, m_, open);
    fEmit = e_ * open;
  }

  // 中间几层窗前的小铁栏
  if (ground < 0.5 && fl > 1.5 && fl < nFl - 1.5) {
    float rm = band(x0 - 0.12, x1 + 0.12, bx, fw) * band(y0 + 0.02, y0 + 0.92, fy, fh);
    if (rm > 0.003) {
      float barsV = lineAA(abs(fract(bx / 0.115) - 0.5) * 0.115, 0.012, fw);
      float rail = lineAA(abs(fy - y0 - 0.9), 0.025, fh) + lineAA(abs(fy - y0 - 0.06), 0.02, fh) + lineAA(abs(fy - y0 - 0.62), 0.012, fh);
      float iron = clamp(barsV + rail, 0.0, 1.0);
      col = mix(col, vec3(0.012, 0.013, 0.015), iron * rm);
      fEmit *= 1.0 - iron * rm * 0.8;
      fRough = mix(fRough, 0.6, iron * rm);
    }
  }
  return col;
}

vec3 zincRoof(vec2 uv, float seed, bool seams) {
  float slate = step(0.6, h11(seed * 8.3));
  vec3 zinc = mix(vec3(0.26, 0.29, 0.325), vec3(0.115, 0.125, 0.15), slate);
  float n = texture2D(uNoiseTex, uv * 0.09 + seed).b;
  zinc *= 0.82 + 0.36 * n;
  if (seams) {
    float fw = max(fwidth(uv.x), 1e-4), fh = max(fwidth(uv.y), 1e-4);
    zinc *= 1.0 - 0.3 * lineAA(abs(fract(uv.x / 0.55) - 0.5) * 0.55, 0.018, fw) * (1.0 - slate);
    zinc *= 1.0 - 0.22 * lineAA(abs(fract(uv.y / 0.34) - 0.5) * 0.34, 0.012, fh) * slate;
  }
  fRough = mix(0.36, 0.62, slate);
  fMetal = mix(0.7, 0.12, slate);
  return zinc;
}
`;

const COLOR = /* glsl */ `
{
  vec3 Nw = normalize(vWNrm);
  vec3 Tw = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-5, 0.0, 0.0));
  vec3 Vw = normalize(cameraPosition - vWPos);
  vec3 Vt = vec3(dot(Vw, Tw), Vw.y, dot(Vw, Nw));
  vec3 Lt = vec3(dot(uSunDir, Tw), uSunDir.y, dot(uSunDir, Nw));
  float seed = vF.w;
  vec3 c;
  if (vK < 0.5) {
    c = facadeWall(vF.xy, vF.z, seed, vP.x, vP.y, vP.z, Vt, Lt);
  } else if (vK < 1.5) {
    c = zincRoof(vF.xy, seed, true);
  } else if (vK < 2.5) {
    c = zincRoof(vF.xy * 3.0, seed, false);
  } else if (vK < 3.5) {
    // 老虎窗的正面
    vec2 q = vec2(fract(vF.x), vF.y);
    float px = max(fwidth(vF.x), fwidth(vF.y));
    vec2 size = vec2(0.82, 1.18);
    vec2 g = vec2((q.x - 0.5) * 1.15 + 0.41, (q.y - 0.12) * 1.5);
    float inWin = band(0.0, size.x, g.x, px * 1.15) * band(0.0, size.y, g.y, px * 1.5);
    float id = h21(vec2(floor(vF.x), 9.0) + seed * 3.0), id2 = h21(vec2(floor(vF.x), 4.0) + seed * 11.0);
    float r_, m_; vec3 e_;
    vec3 wc = windowPane(g, size, id, id2, px * 1.3, 0.42, r_, m_, e_);
    c = stoneTint(seed) * 1.04;
    c = mix(c, wc, inWin);
    fRough = mix(0.9, r_, inWin); fMetal = m_ * inWin; fEmit = e_ * inWin;
  } else if (vK < 4.5) {
    // 烟囱和山墙：抹灰，往上被烟熏黑
    float n = texture2D(uNoiseTex, vF.xy * 0.2 + seed).r;
    c = mix(vec3(0.50, 0.43, 0.34), vec3(0.36, 0.30, 0.25), h11(seed * 2.9)) * (0.8 + 0.4 * n);
    c *= mix(1.0, 0.62, smoothstep(0.3, 1.0, vF.y));
  } else if (vK < 5.5) {
    c = stoneTint(seed) * 1.07;
  } else if (vK < 6.5) {
    // 通长阳台的铁栏
    float fw = max(fwidth(vF.x), 1e-4), fh = max(fwidth(vF.y), 1e-4);
    float barsV = lineAA(abs(fract(vF.x / 0.12) - 0.5) * 0.12, 0.012, fw);
    float scroll = lineAA(abs(fract(vF.x / 0.48) - 0.5) * 0.48 - 0.12 * sin(vF.y * 9.0), 0.014, fw) * band(0.12, 0.7, vF.y, fh);
    float rail = lineAA(abs(vF.y - 0.92), 0.03, fh) + lineAA(abs(vF.y - 0.07), 0.025, fh) + lineAA(abs(vF.y - 0.74), 0.014, fh);
    float iron = clamp(barsV + scroll + rail, 0.0, 1.0);
    c = mix(vec3(0.10, 0.095, 0.085) * stoneTint(seed) * 2.0, vec3(0.012, 0.013, 0.015), iron);
    fRough = 0.7;
  } else {
    c = zincRoof(vF.xy, seed, false);
  }
  diffuseColor.rgb = c;
}`;

export function makeFacadeMaterial(kit: Kit) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.FrontSide });
  withAtmo(mat, 'facade', (s) =>
    patchStd(s, {
      uniforms: { uNoiseTex: { value: kit.noise }, ...facadeUniforms },
      vpars: 'attribute vec4 aF;\nattribute float aK;\nattribute vec3 aP;\nvarying vec4 vF;\nvarying float vK;\nvarying vec3 vP;',
      vmain: 'vF = aF; vK = aK; vP = aP;',
      pars: PARS,
      color: COLOR,
      rough: 'roughnessFactor = fRough; metalnessFactor = fMetal;',
      emissive: 'totalEmissiveRadiance += fEmit;',
    }),
  );
  void atmo;
  void env;
  return mat;
}

// ───────────────────────── 几何 ─────────────────────────

export type V2 = { x: number; z: number };
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

/** 专给立面用的顶点缓冲：每个顶点带 aF（u, v, 墙宽, 种子）、aK（部位）、aP（层高, 层数, 开间） */
export class FacadeBuilder {
  pos: number[] = [];
  nor: number[] = [];
  aF: number[] = [];
  aK: number[] = [];
  aP: number[] = [];
  idx: number[] = [];

  quad(p: number[][], uv: number[][], kind: number, W: number, seed: number, P: [number, number, number]) {
    const base = this.pos.length / 3;
    _a.set(p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]);
    _b.set(p[3][0] - p[0][0], p[3][1] - p[0][1], p[3][2] - p[0][2]);
    _n.crossVectors(_a, _b).normalize();
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.nor.push(_n.x, _n.y, _n.z);
      this.aF.push(uv[i][0], uv[i][1], W, seed);
      this.aK.push(kind);
      this.aP.push(P[0], P[1], P[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** 沿 t 方向宽 W、从 y0 到 y1 的一面竖墙；o 是从外面看的左下角 */
  wall(o: V2, t: V2, W: number, y0: number, y1: number, kind: number, seed: number, P: [number, number, number], v0 = 0, v1 = y1 - y0, u0 = 0, u1 = W) {
    this.quad(
      [[o.x, y0, o.z], [o.x + t.x * W, y0, o.z + t.z * W], [o.x + t.x * W, y1, o.z + t.z * W], [o.x, y1, o.z]],
      [[u0, v0], [u1, v0], [u1, v1], [u0, v1]],
      kind, W, seed, P,
    );
  }

  /** 贴着 t / n 方向的盒子（n = 朝外） */
  box(c: V2, t: V2, n: V2, w: number, d: number, y0: number, y1: number, kind: number, seed: number, P: [number, number, number]) {
    const hx = w / 2, hd = d / 2;
    const corner = (a: number, b: number): V2 => ({ x: c.x + t.x * a * hx + n.x * b * hd, z: c.z + t.z * a * hx + n.z * b * hd });
    const fl = corner(-1, 1), fr = corner(1, 1), bl = corner(-1, -1), br = corner(1, -1);
    const nt = { x: -t.x, z: -t.z }, nn = { x: -n.x, z: -n.z };
    this.wall(fl, t, w, y0, y1, kind, seed, P, 0, 1);
    this.wall(fr, nn, d, y0, y1, kind, seed, P, 0, 1);
    this.wall(br, nt, w, y0, y1, kind, seed, P, 0, 1);
    this.wall(bl, n, d, y0, y1, kind, seed, P, 0, 1);
    this.quad([[fl.x, y1, fl.z], [fr.x, y1, fr.z], [br.x, y1, br.z], [bl.x, y1, bl.z]], [[0, 1], [1, 1], [1, 1], [0, 1]], kind, w, seed, P);
    this.quad([[bl.x, y0, bl.z], [br.x, y0, br.z], [fr.x, y0, fr.z], [fl.x, y0, fl.z]], [[0, 0], [1, 0], [1, 0], [0, 0]], kind, w, seed, P);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aF', new THREE.Float32BufferAttribute(this.aF, 4));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.aK, 1));
    g.setAttribute('aP', new THREE.Float32BufferAttribute(this.aP, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

export interface BlockOpts {
  floors: number;
  detail: boolean;
  baseY: number;
  seed: number;
  floorH?: number;
  mansard?: boolean;
}

/**
 * 一栋奥斯曼楼。P = 从正面看过去的左下角，t = 正面朝右的方向（单位向量），W × depth 是占地。
 * 返回屋顶最高点，给烟囱顶上的陶罐用。
 */
export function addBlock(fb: FacadeBuilder, pots: { x: number; y: number; z: number; s: number }[], P: V2, t: V2, W: number, depth: number, o: BlockOpts, rand: () => number) {
  const n: V2 = { x: -t.z, z: t.x }; // t × up 的水平分量：朝外
  const nt = { x: -t.x, z: -t.z }, nn = { x: -n.x, z: -n.z };
  const G = 4.6, FH = o.floorH ?? 3.2 + rand() * 0.3;
  const nb = Math.max(1, Math.round(W / (2.75 + rand() * 0.45)));
  const params: [number, number, number] = [FH, o.floors, W / nb];
  const y0 = o.baseY, H = G + (o.floors - 1) * FH, yT = y0 + H;
  const seed = o.seed;
  const c = (a: number, b: number): V2 => ({ x: P.x + t.x * a - n.x * b, z: P.z + t.z * a - n.z * b });
  const FL = c(0, 0), FR = c(W, 0), BR = c(W, depth), BL = c(0, depth);
  const nbSide = Math.max(1, Math.round(depth / 3.0));
  const pSide: [number, number, number] = [FH, o.floors, depth / nbSide];
  fb.wall(FL, t, W, y0, yT, 0, seed, params);
  fb.wall(FR, nn, depth, y0, yT, 0, seed + 0.31, pSide);
  fb.wall(BR, nt, W, y0, yT, 0, seed + 0.57, params);
  fb.wall(BL, n, depth, y0, yT, 0, seed + 0.83, pSide);

  // 檐口
  const mid = c(W / 2, depth / 2);
  fb.box(mid, t, n, W + 0.9, depth + 0.9, yT - 0.38, yT, 5, seed, params);

  // 芒萨尔屋顶
  const MH = o.mansard === false ? 0.6 : 3.0 + rand() * 0.5, IN = o.mansard === false ? 0.3 : 1.45;
  const cc = (a: number, b: number, ins: number): number[] => {
    const q = c(a + (a === 0 ? ins : -ins), b + (b === 0 ? ins : -ins));
    return [q.x, yT + (ins > 0 ? MH : 0), q.z];
  };
  const sl = Math.hypot(MH, IN);
  const slope = (a0: number, b0: number, a1: number, b1: number, len: number) =>
    fb.quad([cc(a0, b0, 0), cc(a1, b1, 0), cc(a1, b1, IN), cc(a0, b0, IN)], [[0, 0], [len, 0], [len - IN, sl], [IN, sl]], 1, len, seed, params);
  slope(0, 0, W, 0, W);
  slope(W, 0, W, depth, depth);
  slope(W, depth, 0, depth, W);
  slope(0, depth, 0, 0, depth);
  fb.quad([cc(0, 0, IN), cc(W, 0, IN), cc(W, depth, IN), cc(0, depth, IN)], [[0, 0], [W, 0], [W, depth], [0, depth]], 2, W, seed, params);
  const yR = yT + MH;

  if (o.detail && o.mansard !== false) {
    // 老虎窗：正背两面，每个开间一个
    const bw = W / nb;
    const dormerSides = (LIGHT_GEOMETRY ? [[FL, t, n, 0]] : [[FL, t, n, 0], [BR, nt, nn, 50]]) as [V2, V2, V2, number][];
    for (const [org, dir, out, idOff] of dormerSides) {
      for (let i = 0; i < nb; i++) {
        const u = (i + 0.5) * bw, dw = 1.06, yb = yT + 0.42, yt = yT + 2.0;
        const fo = -0.12; // 正面比墙面退进去一点
        const px = (a: number, back: number): number[] => [org.x + dir.x * (u + a) + out.x * (fo - back), 0, org.z + dir.z * (u + a) + out.z * (fo - back)];
        const backB = Math.max(0.03, ((yb - yT) / MH) * IN + fo), backT = Math.max(0.3, ((yt - yT) / MH) * IN + fo);
        const f0 = px(-dw / 2, 0), f1 = px(dw / 2, 0);
        const withY = (p: number[], y: number) => [p[0], y, p[2]];
        fb.quad([withY(f0, yb), withY(f1, yb), withY(f1, yt), withY(f0, yt)], [[i + idOff, 0], [i + idOff + 1, 0], [i + idOff + 1, 1], [i + idOff, 1]], 3, 1, seed, params);
        const b0b = px(-dw / 2, backB), b0t = px(-dw / 2, backT);
        const b1b = px(dw / 2, backB), b1t = px(dw / 2, backT);
        fb.quad([withY(b0b, yb), withY(f0, yb), withY(f0, yt), withY(b0t, yt)], [[0, 0], [1, 0], [1, 1], [0, 1]], 7, 1, seed, params);
        fb.quad([withY(f1, yb), withY(b1b, yb), withY(b1t, yt), withY(f1, yt)], [[0, 0], [1, 0], [1, 1], [0, 1]], 7, 1, seed, params);
        const e0 = px(-dw / 2 - 0.1, -0.12), e1 = px(dw / 2 + 0.1, -0.12);
        fb.quad([withY(e0, yt + 0.02), withY(e1, yt + 0.02), withY(b1t, yt + 0.2), withY(b0t, yt + 0.2)], [[0, 0], [1, 0], [1, 1], [0, 1]], 7, 1, seed, params);
      }
    }
    // 二层和顶层的通长阳台
    for (const [org, dir, out] of (LIGHT_GEOMETRY ? [[FL, t, n]] : [[FL, t, n], [BR, nt, nn]]) as [V2, V2, V2][]) {
      for (const fl of [1, o.floors - 1]) {
        const yb = y0 + G + (fl - 1) * FH;
        const cen = { x: org.x + dir.x * (W / 2) + out.x * 0.36, z: org.z + dir.z * (W / 2) + out.z * 0.36 };
        fb.box(cen, dir, out, W - 0.4, 0.72, yb - 0.16, yb, 5, seed, params);
        const ro = { x: org.x + dir.x * 0.25 + out.x * 0.68, z: org.z + dir.z * 0.25 + out.z * 0.68 };
        fb.wall(ro, dir, W - 0.5, yb, yb + 0.98, 6, seed, params, 0, 0.98);
      }
    }
  }

  // 烟囱：贴着两头的山墙，中间再隔一段来一排
  const stacks = o.detail ? Math.max(2, Math.round(W / 13) + 1) : rand() < 0.6 ? 2 : 1;
  for (let i = 0; i < stacks; i++) {
    const a = stacks === 1 ? W * (0.3 + rand() * 0.4) : 0.45 + ((W - 0.9) * i) / (stacks - 1);
    const d = 1.6 + rand() * 2.2, b = depth * (0.3 + rand() * 0.4), h = 1.5 + rand() * 1.3;
    const cen = c(a, b);
    fb.box(cen, t, n, 0.62, d, yR - 2.2, yR + h, 4, seed + i, params);
    const np = Math.max(2, Math.round(d / 0.55));
    if (o.detail || rand() < 0.5) for (let k = 0; k < np; k++) {
      const q = c(a, b + (k - (np - 1) / 2) * 0.5);
      pots.push({ x: q.x, y: yR + h, z: q.z, s: 0.8 + rand() * 0.5 });
    }
  }
  return yR;
}
