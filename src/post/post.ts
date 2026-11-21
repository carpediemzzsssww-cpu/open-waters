import * as THREE from 'three';

/**
 * 胶片感的后期，都很克制：
 * 泛光（镜头里本来就有的那点漫射）→ 高光周围一圈偏红的光晕（halation，胶片片基反光）→
 * AgX 调色（高光自然褪色，不会烧成一块死黄）→ 轻微暗角、边缘一点点色散 → 颗粒。
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DOWN = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
vec3 s(vec2 o) {
  vec3 c = texture2D(tSrc, vUv + o * uTexel).rgb;
  if (uFirst > 0.5) c = min(c, vec3(18.0));
  return c;
}
float karis(vec3 c) { return 1.0 / (1.0 + max(c.r, max(c.g, c.b)) * 0.25); }
void main() {
  // 13 点降采样（Jimenez 2014）：小亮点不会闪
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2));
  vec3 d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2));
  vec3 j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = karis(g0), w1 = karis(g1), w2 = karis(g2), w3 = karis(g3), w4 = karis(g4);
    col = (g0 * w0 * 0.125 + g1 * w1 * 0.125 + g2 * w2 * 0.125 + g3 * w3 * 0.125 + g4 * w4 * 0.5) / (w0 * 0.125 + w1 * 0.125 + w2 * 0.125 + w3 * 0.125 + w4 * 0.5);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const UP = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc;   // 更小的一级（已累加）
uniform sampler2D tBase;  // 本级的降采样
uniform vec2 uTexel;
uniform float uMix;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += (texture2D(tSrc, vUv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv - vec2(t.x, 0.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y)).rgb + texture2D(tSrc, vUv - vec2(0.0, t.y)).rgb) * 2.0;
  c += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb;
  c /= 16.0;
  gl_FragColor = vec4(mix(texture2D(tBase, vUv).rgb, c, uMix), 1.0);
}`;

const FINAL = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tWide;
uniform float uExposure;
uniform float uBloom;
uniform float uHalation;
uniform float uGrain;
uniform float uVignette;
uniform float uTime;
uniform float uAspect;
uniform float uFade;
uniform vec2 uRes;

vec3 agxCurve(vec3 x) {
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float minEv = -12.47393, maxEv = 4.026069;
  v = m * v;
  v = clamp(log2(max(v, vec3(1e-10))), minEv, maxEv);
  v = (v - minEv) / (maxEv - minEv);
  return agxCurve(v);
}
vec3 agxEotf(vec3 v) {
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return mi * v;
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c * vec2(uAspect, 1.0), c * vec2(uAspect, 1.0));
  // 边缘的一点点横向色散
  vec2 ca = c * r2 * 0.0035;
  vec3 col;
  col.r = texture2D(tScene, uv + ca).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - ca).b;

  vec3 bloom = texture2D(tBloom, uv).rgb;
  col = mix(col, bloom, uBloom);

  // halation：只有很亮的地方才会透过乳剂层反一圈红
  vec3 wide = texture2D(tWide, uv).rgb;
  float hl = max(max(wide.r, wide.g), wide.b);
  col += wide * smoothstep(0.9, 4.0, hl) * vec3(1.0, 0.30, 0.10) * uHalation;

  // 暗角（按曝光衰减算，在调色之前）
  col *= mix(1.0, 1.0 / pow(1.0 + r2 * 1.15, 2.0), uVignette);
  col *= uExposure;

  // AgX + 一点暖调和对比
  col = agx(col);
  col = pow(max(col, 0.0), vec3(1.15, 1.15, 1.16));
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = luma + (col - luma) * 1.2;
  col = agxEotf(col);
  col = clamp(col, 0.0, 1.0);
  // 暗部微微抬起、带一点冷
  col = col * 0.98 + vec3(0.010, 0.011, 0.016);

  // 颗粒：24 格 / 秒，中间调最明显
  float t = floor(uTime * 24.0);
  vec2 gp = floor(gl_FragCoord.xy / max(1.0, floor(uRes.y / 1100.0 + 0.5)));
  float g = (hash13(vec3(gp, t)) + hash13(vec3(gp + 17.0, t + 3.0)) - 1.0);
  float l2 = dot(col, vec3(0.3, 0.6, 0.1));
  col += g * uGrain * (0.35 + 0.65 * (1.0 - abs(l2 * 2.0 - 1.0)));

  col *= uFade;
  gl_FragColor = vec4(col, 1.0);
}`;

const LEVELS = 6;

export class Post {
  scene: THREE.WebGLRenderTarget;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private tri: THREE.Mesh;
  private cam = new THREE.Camera();
  private mDown: THREE.ShaderMaterial;
  private mUp: THREE.ShaderMaterial;
  mFinal: THREE.ShaderMaterial;

  constructor(samples: number, type: THREE.TextureDataType = THREE.HalfFloatType) {
    this.scene = new THREE.WebGLRenderTarget(4, 4, {
      type,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      samples,
      depthBuffer: true,
    });
    const opt: THREE.RenderTargetOptions = { type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    for (let i = 0; i < LEVELS; i++) {
      this.down.push(new THREE.WebGLRenderTarget(4, 4, opt));
      this.up.push(new THREE.WebGLRenderTarget(4, 4, opt));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const base = { vertexShader: VERT, depthTest: false, depthWrite: false };
    this.mDown = new THREE.ShaderMaterial({ ...base, fragmentShader: DOWN, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } } });
    this.mUp = new THREE.ShaderMaterial({ ...base, fragmentShader: UP, uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.6 } } });
    this.mFinal = new THREE.ShaderMaterial({
      ...base,
      fragmentShader: FINAL,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tWide: { value: null },
        uExposure: { value: 1 },
        uBloom: { value: 0.11 },
        uHalation: { value: 0.11 },
        uGrain: { value: 0.027 },
        uVignette: { value: 0.75 },
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uFade: { value: 1 },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.tri = new THREE.Mesh(geo, this.mDown);
    this.tri.frustumCulled = false;
  }

  /** 运行时改 MSAA：释放后下一帧按新的采样数重建 */
  setSamples(n: number) {
    if (this.scene.samples === n) return;
    this.scene.samples = n;
    this.scene.dispose();
  }

  setSize(w: number, h: number) {
    this.scene.setSize(w, h);
    let cw = w, ch = h;
    for (let i = 0; i < LEVELS; i++) {
      cw = Math.max(2, Math.floor(cw / 2));
      ch = Math.max(2, Math.floor(ch / 2));
      this.down[i].setSize(cw, ch);
      this.up[i].setSize(cw, ch);
    }
    this.mFinal.uniforms.uAspect.value = w / h;
  }

  private pass(mat: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null, renderer: THREE.WebGLRenderer) {
    this.tri.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(this.tri, this.cam);
  }

  render(renderer: THREE.WebGLRenderer, time: number, exposure: number, outW: number, outH: number) {
    let src: THREE.WebGLRenderTarget = this.scene;
    for (let i = 0; i < LEVELS; i++) {
      const u = this.mDown.uniforms;
      u.tSrc.value = src.texture;
      u.uTexel.value.set(1 / src.width, 1 / src.height);
      u.uFirst.value = i === 0 ? 1 : 0;
      this.pass(this.mDown, this.down[i], renderer);
      src = this.down[i];
    }
    let acc: THREE.WebGLRenderTarget = this.down[LEVELS - 1];
    for (let i = LEVELS - 2; i >= 0; i--) {
      const u = this.mUp.uniforms;
      u.tSrc.value = acc.texture;
      u.tBase.value = this.down[i].texture;
      u.uTexel.value.set(1 / acc.width, 1 / acc.height);
      u.uMix.value = 0.62;
      this.pass(this.mUp, this.up[i], renderer);
      acc = this.up[i];
    }
    const f = this.mFinal.uniforms;
    f.tScene.value = this.scene.texture;
    f.tBloom.value = this.up[0].texture;
    f.tWide.value = this.up[2].texture;
    f.uExposure.value = exposure;
    f.uTime.value = time;
    f.uRes.value.set(outW, outH);
    this.pass(this.mFinal, null, renderer);
  }
}
