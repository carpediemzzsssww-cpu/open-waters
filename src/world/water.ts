import * as THREE from 'three';
import { ATMO_GLSL, atmo, env } from '../core/atmosphere';
import { clamp } from '../core/util';

/**
 * 塞纳河的水面。
 *
 * - 倒影：把整个场景从水下镜像再画一遍（半分辨率），桥、树、灯都真的倒映在水里。
 * - 波纹：三层不同尺度的坡度贴图相向流动；每个像素既有「平均坡度」，也有「看不清的那部分波有多乱」（方差）。
 *   平均坡度让近处的倒影晃动，方差让远处的倒影被竖向拉成长丝——这就是莫奈画里那种一笔一笔的倒影。
 * - 碎金：按 Cox–Munk 的做法，用坡度分布直接算太阳在水面上的反光带，宽窄随水面的粗糙程度变化。
 * - 尾迹：船周围一小块水面跑真正的波动方程（见 WakeSim），其余船只用解析的 V 形尾波。
 */

const VERT = /* glsl */ `
uniform mat4 uTexMatrix;
varying vec3 vWorld;
varying vec4 vMirror;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vMirror = uTexMatrix * w;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec4 vMirror;
uniform sampler2D uRefl;
uniform float uLiveReflection;
uniform sampler2D uSlope;
uniform sampler2D uNoise;
uniform sampler2D uWake;
uniform vec4 uWakeRect;   // 窗口原点 xz, 边长, 1/分辨率
uniform float uWakeOn;
uniform vec3 uBody;
uniform vec2 uFovScale;   // 1/tan(hfov/2), 1/tan(vfov/2)
uniform float uTime;
uniform vec4 uBoats[4];   // 其他船：x, z, 航向, 速度
uniform vec4 uShade;      // 桥底阴影：z 中心, 半宽, 强度, -
${ATMO_GLSL}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// 其他船拖出的 V 形尾波（开尔文角约 19.5°）
vec2 boatWake(vec4 b, vec2 P, out float churn) {
  churn = 0.0;
  if (b.w < 0.05) return vec2(0.0);
  vec2 f = vec2(-sin(b.z), -cos(b.z));
  vec2 r = vec2(-f.y, f.x);
  vec2 rel = P - b.xy;
  float zb = -dot(rel, f);
  if (zb < 0.0 || zb > 260.0) return vec2(0.0);
  float xl = dot(rel, r);
  float ax = abs(xl);
  float arm = ax - zb * 0.354;
  float w = 1.4 + zb * 0.035;
  float envl = exp(-arm * arm / (w * w)) * b.w / sqrt(1.0 + zb * 0.07) * smoothstep(260.0, 150.0, zb);
  float ph = (ax * 0.94 + zb * 0.33) * 1.9 - uTime * 3.2;
  vec2 n = normalize(r * sign(xl) * 0.94 + (-f) * 0.33);
  churn = exp(-xl * xl / (9.0 + zb * 0.25)) * smoothstep(0.0, 6.0, zb) * exp(-zb * 0.018) * b.w;
  return n * cos(ph) * envl * 0.05;
}

void main() {
  vec3 toFrag = vWorld - cameraPosition;
  float dist = length(toFrag);
  vec3 V = -toFrag / dist;
  vec2 vdir = normalize(toFrag.xz + vec2(1e-5));
  vec2 vright = vec2(-vdir.y, vdir.x);
  vec2 P = vWorld.xz;

  // 水面有静区和起皱的区：风一阵一阵地过
  float patchN = texture2D(uNoise, P * 0.0027 + vec2(uTime * 0.0016, -uTime * 0.0009)).g;
  float patchN2 = texture2D(uNoise, P * 0.011 + vec2(-uTime * 0.003, uTime * 0.002)).b;
  float rough = smoothstep(0.28, 0.72, patchN * 0.75 + patchN2 * 0.25);
  float amp = mix(0.42, 1.0, rough);

  // 三层坡度各转一个角度、各走各的方向，平铺的格子就不会和视线对齐
  const mat2 R1 = mat2(0.9563, 0.2924, -0.2924, 0.9563);   // 17°
  const mat2 R2 = mat2(0.3256, 0.9455, -0.9455, 0.3256);   // 71°
  const mat2 R3 = mat2(0.7431, -0.6691, 0.6691, 0.7431);   // -42°
  vec2 warp = (texture2D(uNoise, P * 0.004).ba - 0.5) * 3.0;
  vec4 a = texture2D(uSlope, R1 * (P + warp) * 0.047 + uTime * vec2(0.006, -0.019));
  vec4 b = texture2D(uSlope, R2 * (P - warp) * 0.139 + uTime * vec2(-0.021, 0.030));
  vec4 c = texture2D(uSlope, R3 * P * 0.43 + uTime * vec2(0.052, 0.041));
  const float A1 = 0.038, A2 = 0.035, A3 = 0.030;
  vec2 S = (transpose(R1) * a.rg * A1 + transpose(R2) * b.rg * A2 + transpose(R3) * c.rg * A3) * amp;
  float var = (A1 * A1 * max(a.b - dot(a.rg, a.rg), 0.0)
             + A2 * A2 * max(b.b - dot(b.rg, b.rg), 0.0)
             + A3 * A3 * max(c.b - dot(c.rg, c.rg), 0.0)) * amp * amp + 6e-5;

  float foam = 0.0;
  // 自己船的尾迹：读波动方程的高度场
  if (uWakeOn > 0.5) {
    vec2 wuv = (P - uWakeRect.xy) / uWakeRect.z;
    vec2 e2 = min(wuv, 1.0 - wuv);
    float inside = smoothstep(0.0, 0.06, min(e2.x, e2.y));
    if (inside > 0.0) {
      float e = uWakeRect.w;
      float hl = texture2D(uWake, wuv - vec2(e, 0.0)).r;
      float hr = texture2D(uWake, wuv + vec2(e, 0.0)).r;
      float hd = texture2D(uWake, wuv - vec2(0.0, e)).r;
      float hu = texture2D(uWake, wuv + vec2(0.0, e)).r;
      float tw = uWakeRect.z * e;
      vec2 ws = vec2(hr - hl, hu - hd) / (2.0 * tw);
      float wl = length(ws);
      ws *= min(1.0, 0.09 / max(wl, 1e-4)); // 尾迹再大，坡度也不超过 5°
      S += ws * inside;
      var += wl * wl * 0.06 * inside;
      foam += texture2D(uWake, wuv).b * inside * 0.7;
    }
  }
  for (int i = 0; i < 4; i++) {
    float churn;
    S += boatWake(uBoats[i], P, churn);
    var += churn * 0.0016;
    foam += churn * 0.22;
  }

  vec3 N = normalize(vec3(-S.x, 1.0, -S.y));
  float sig = sqrt(var * 0.5);

  // 菲涅尔：掠射角时接近镜面，但水面越乱越打折扣
  float cosT = clamp(dot(N, V) + sig * 1.4, 0.0, 1.0);
  float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
  F = min(F, 0.94);

  // 倒影：平均坡度决定往哪偏，方差决定竖向抹多长
  vec3 refl;
  vec4 R = vec4(0.0);
  if (uLiveReflection < .5) {
    refl = atmoSky(reflect(-V, N));
  } else {
    vec2 uv = vMirror.xy / vMirror.w;
    float sa = dot(S, vdir), sc = dot(S, vright);
    vec2 off = vec2(sc * V.y * uFovScale.x, -sa * uFovScale.y);
    float sv = sig * uFovScale.y;
    float jit = hash12(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5;
    float wsum = 0.0;
    for (int i = 0; i < 5; i++) {
      float t = (float(i) - 2.0 + jit) * 0.8;
      float w = exp(-0.5 * t * t);
      vec2 u2 = uv + off + vec2(0.0, t * sv);
      R += texture2D(uRefl, clamp(u2, vec2(0.002), vec2(0.998))) * w;
      wsum += w;
    }
    R /= wsum;
    refl = min(R.rgb, vec3(24.0));
  }

  // 桥洞下面：水是暗的
  float shade = 1.0 - uShade.z * smoothstep(uShade.y + 3.0, uShade.y - 3.0, abs(vWorld.z - uShade.x));
  vec3 body = uBody * mix(0.45, 1.0, shade);
  vec3 col = mix(body, refl, F);

  // 太阳在水面上的碎金
  vec3 L = uSunDir;
  if (L.y > -0.02) {
    vec3 H = normalize(L + V);
    vec2 sReq = -H.xz / max(H.y, 1e-3);
    vec2 dS = sReq - S;
    float v1 = var * 0.5 + 3.0e-4;
    float pdf = exp(-dot(dS, dS) / (2.0 * v1)) / (6.2832 * v1);
    float Fh = 0.02 + 0.98 * pow(1.0 - clamp(dot(H, V), 0.0, 1.0), 5.0);
    float glint = Fh * pdf / (4.0 * pow(H.y, 4.0) * max(V.y, 0.03));
    float sunVis = (1.0 - smoothstep(0.02, 0.5, R.a)) * smoothstep(-0.02, 0.03, L.y) * shade;
    col += uSunColor * min(glint * 0.00052, 0.55) * sunVis;
  }

  // 泡沫 / 被搅动的水
  foam = clamp(foam, 0.0, 1.0);
  if (foam > 0.001) {
    float fn = texture2D(uNoise, P * 0.9 + uTime * 0.05).r * 0.6 + texture2D(uNoise, P * 2.7 - uTime * 0.08).a * 0.4;
    float fm = smoothstep(0.82 - foam * 0.5, 1.0 - foam * 0.3, fn) * foam;
    vec3 foamCol = (uZenith * 0.5 + uMidSun * 0.5 + uHorSun * 0.25) * 0.9;
    col = mix(col, foamCol, fm * 0.38);
  }

  col = atmoFog(col, toFrag, cameraPosition.y);
  gl_FragColor = vec4(col, 1.0);
}`;

// ───────────────────────── 尾迹：一小块真正在传播的水波 ─────────────────────────

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SIM_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform float uTexel;
uniform float uK;
uniform float uDamp;
uniform float uFoamDecay;
uniform vec4 uSrc[6];   // uv.x, uv.y, 半径(uv), 强度
uniform float uSrcFoam[6];
void main() {
  vec2 uv = vUv + uShift;
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 s = texture2D(uPrev, uv) * inb;
  float h = s.r, hp = s.g;
  float hl = texture2D(uPrev, uv - vec2(uTexel, 0.0)).r;
  float hr = texture2D(uPrev, uv + vec2(uTexel, 0.0)).r;
  float hd = texture2D(uPrev, uv - vec2(0.0, uTexel)).r;
  float hu = texture2D(uPrev, uv + vec2(0.0, uTexel)).r;
  float lap = (hl + hr + hd + hu) * inb - 4.0 * h;
  float hn = h + (h - hp) * uDamp + uK * lap;
  vec2 e = min(vUv, 1.0 - vUv);
  hn *= mix(0.86, 1.0, smoothstep(0.0, 0.09, min(e.x, e.y))); // 边缘吸收，免得波被窗口弹回来
  float foam = s.b * uFoamDecay;
  for (int i = 0; i < 6; i++) {
    vec2 d = vUv - uSrc[i].xy;
    float r2 = uSrc[i].z * uSrc[i].z;
    float g = exp(-dot(d, d) / r2);
    hn += uSrc[i].w * g;
    foam += uSrcFoam[i] * exp(-dot(d, d) / (r2 * 2.2));
  }
  gl_FragColor = vec4(clamp(hn, -1.0, 1.0), h, min(foam, 1.4), 1.0);
}`;

export interface WakeSource {
  x: number;
  z: number;
  radius: number; // 米
  strength: number;
  foam: number;
}

export class WakeSim {
  readonly size: number;
  readonly span: number; // 窗口边长（米）
  origin = new THREE.Vector2();
  private a: THREE.WebGLRenderTarget;
  private b: THREE.WebGLRenderTarget;
  private mat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private cam = new THREE.Camera();
  private first = true;

  constructor(size = 256, texel = 0.25) {
    this.size = size;
    this.span = size * texel;
    const opt: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    };
    this.a = new THREE.WebGLRenderTarget(size, size, opt);
    this.b = new THREE.WebGLRenderTarget(size, size, opt);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uPrev: { value: null },
        uShift: { value: new THREE.Vector2() },
        uTexel: { value: 1 / size },
        uK: { value: 0.01 },
        uDamp: { value: 0.995 },
        uFoamDecay: { value: 0.99 },
        uSrc: { value: Array.from({ length: 6 }, () => new THREE.Vector4(-9, -9, 0.01, 0)) },
        uSrcFoam: { value: new Float32Array(6) },
      },
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
  }

  releaseTargets() {
    this.a.dispose();
    this.b.dispose();
    this.first = true;
  }

  get texture() {
    return this.a.texture;
  }

  step(renderer: THREE.WebGLRenderer, cx: number, cz: number, sources: WakeSource[], dt: number, waveSpeed: number) {
    const texel = this.span / this.size;
    // 窗口跟着船走，但只按整格移动，波才不会被重采样抹糊
    const nx = Math.round((cx - this.span / 2) / texel) * texel;
    const nz = Math.round((cz - this.span / 2) / texel) * texel;
    const u = this.mat.uniforms;
    if (this.first) {
      this.origin.set(nx, nz);
      this.first = false;
    }
    u.uShift.value.set((nx - this.origin.x) / this.span, (nz - this.origin.y) / this.span);
    this.origin.set(nx, nz);
    const k = (waveSpeed * Math.min(dt, 1 / 30)) / texel;
    u.uK.value = Math.min(k * k, 0.45);
    u.uDamp.value = Math.pow(0.993, dt * 60);
    u.uFoamDecay.value = Math.pow(0.9905, dt * 60);
    for (let i = 0; i < 6; i++) {
      const s = sources[i];
      const v = u.uSrc.value[i] as THREE.Vector4;
      if (s) {
        v.set((s.x - nx) / this.span, (s.z - nz) / this.span, s.radius / this.span, s.strength);
        u.uSrcFoam.value[i] = s.foam;
      } else {
        v.set(-9, -9, 0.01, 0);
        u.uSrcFoam.value[i] = 0;
      }
    }
    u.uPrev.value = this.a.texture;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.b);
    renderer.render(this.quad, this.cam);
    renderer.setRenderTarget(prev);
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }
}

// ───────────────────────── 水面本体 + 镜像相机 ─────────────────────────

export class Water {
  mesh: THREE.Mesh;
  rt: THREE.WebGLRenderTarget;
  uniforms: Record<string, THREE.IUniform>;
  wake: WakeSim | null = null;
  private mirror = new THREE.PerspectiveCamera();
  private texMatrix = new THREE.Matrix4();
  private plane = new THREE.Plane();
  private clipPlane = new THREE.Vector4();
  private q = new THREE.Vector4();
  private v = new THREE.Vector3();
  private look = new THREE.Vector3();
  private target = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private readonly N = new THREE.Vector3(0, 1, 0);

  constructor(noise: THREE.Texture, slope: THREE.Texture, wakeSize: number) {
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    if (wakeSize > 0) this.wake = new WakeSim(wakeSize, 0.25);
    this.uniforms = {
      ...atmo,
      uTexMatrix: { value: this.texMatrix },
      uRefl: { value: this.rt.texture },
      uLiveReflection: { value: 1 },
      uSlope: { value: slope },
      uNoise: { value: noise },
      uWake: { value: this.wake ? this.wake.texture : null },
      uWakeRect: { value: new THREE.Vector4(0, 0, 64, 1 / 256) },
      uWakeOn: { value: this.wake ? 1 : 0 },
      uBody: { value: env.water },
      uFovScale: { value: new THREE.Vector2(1, 1) },
      uBoats: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uShade: { value: new THREE.Vector4(0, 20, 0, 0) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms, fog: false });
    const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    this.mirror.layers.set(0);
  }

  setSize(w: number, h: number, scale: number) {
    this.rt.setSize(Math.max(2, Math.floor(w * scale)), Math.max(2, Math.floor(h * scale)));
  }

  stepWake(renderer: THREE.WebGLRenderer, cx: number, cz: number, sources: WakeSource[], dt: number, speed: number) {
    if (!this.wake) return;
    this.wake.step(renderer, cx, cz, sources, dt, clamp(0.36 * speed, 0.4, 1.3));
    this.uniforms.uWake.value = this.wake.texture;
    this.uniforms.uWakeRect.value.set(this.wake.origin.x, this.wake.origin.y, this.wake.span, 1 / this.wake.size);
  }

  /** 从水下的镜像位置把场景再画一遍（做法同 three 的 Water.js，带斜裁剪面） */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, skyDisc: THREE.IUniform) {
    const m = this.mirror, N = this.N;
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.mesh.updateMatrixWorld();

    const camPos = this.v.setFromMatrixPosition(camera.matrixWorld);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(camPos);
    // 关于 y=0 镜像
    m.position.set(camPos.x, -camPos.y, camPos.z);
    this.target.set(this.look.x, -this.look.y, this.look.z);
    m.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(N);
    m.lookAt(this.target);
    m.near = camera.near;
    m.far = camera.far;
    m.fov = camera.fov;
    m.aspect = camera.aspect;
    m.updateMatrixWorld();
    m.projectionMatrix.copy(camera.projectionMatrix);
    m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    m.matrixWorldInverse.copy(m.matrixWorld).invert();

    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMatrix.multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);

    // 斜近裁剪面：只画水面以上的东西
    this.plane.setFromNormalAndCoplanarPoint(N, new THREE.Vector3(0, 0, 0));
    this.plane.applyMatrix4(m.matrixWorldInverse);
    const cp = this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = m.projectionMatrix.elements;
    const q = this.q;
    q.x = (Math.sign(cp.x) + pm[8]) / pm[0];
    q.y = (Math.sign(cp.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    cp.multiplyScalar(2 / cp.dot(q));
    pm[2] = cp.x;
    pm[6] = cp.y;
    pm[10] = cp.z + 1 - 0.002;
    pm[14] = cp.w;

    this.uniforms.uFovScale.value.set(1 / (Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), 1 / Math.tan((camera.fov * Math.PI) / 360));

    const prevDisc = skyDisc.value;
    skyDisc.value = 0; // 日面不进倒影：水面上的太阳由碎金负责
    this.mesh.visible = false;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(prev);
    this.mesh.visible = true;
    skyDisc.value = prevDisc;
  }
}
