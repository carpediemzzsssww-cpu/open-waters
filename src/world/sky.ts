import * as THREE from 'three';
import { MINI } from '../core/env';
import { seasonState } from '../core/seasons';
import { ATMO_GLSL, atmo, env } from '../core/atmosphere';
import { DEG } from '../core/util';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform sampler2D uNoise;
uniform float uTime;
uniform float uSunDisc;
uniform vec3 uCloudLit;
uniform vec3 uCloudShade;
uniform vec3 uMoonDir;
uniform float uMoon;
${ATMO_GLSL}

float n2(vec2 p) { return texture2D(uNoise, p * 0.03125).r; }
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * n2(p); p = p * 2.03 + vec2(13.1, 7.7); a *= 0.5; }
  return s / 0.9375;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 d = normalize(vDir);
  vec3 col = atmoSky(d);
  float y = d.y;
  vec2 sunAz = normalize(uSunDir.xz);
  float az = clamp(dot(normalize(d.xz + vec2(1e-5)), sunAz) * 0.5 + 0.5, 0.0, 1.0);

  // 星：蓝调时刻才隐约出现的几颗
  if (uNight > 0.02 && y > 0.04) {
    vec2 suv = vec2(atan(d.z, d.x) * 60.0, asin(clamp(y, -1.0, 1.0)) * 60.0);
    vec2 id = floor(suv);
    vec2 f = fract(suv) - 0.5;
    float h = hash12(id);
    vec2 o = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;
    float star = step(0.982, h) * smoothstep(0.075, 0.0, length(f - o * 0.7));
    float tw = 0.75 + 0.25 * sin(uTime * (2.0 + h * 5.0) + h * 40.0);
    col += vec3(0.9, 0.95, 1.1) * star * tw * uNight * uNight * 0.4 * smoothstep(0.04, 0.35, y) * (1.0 - az * 0.7);
  }

  // 新月：挂在落日左上方，天越暗越清楚
  {
    vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 my = cross(mx, uMoonDir);
    vec2 q = vec2(dot(d, mx), dot(d, my)) / 0.0085;
    float r = length(q);
    if (r < 1.6 && dot(d, uMoonDir) > 0.0) {
      float disc = 1.0 - smoothstep(0.93, 1.0, r);
      vec2 toSun = normalize(vec2(dot(uSunDir, mx), dot(uSunDir, my)));
      float shade = smoothstep(0.92, 1.02, length(q + toSun * 0.42));
      float crescent = disc * shade;
      vec3 mc = vec3(1.0, 0.95, 0.86) * (0.55 + 1.6 * uMoon);
      col = mix(col, col + mc, crescent * (0.25 + 0.75 * uMoon));
      col += vec3(0.5, 0.56, 0.7) * disc * (1.0 - shade) * 0.02 * uMoon; // 地照
    }
  }

  if (y > 0.001) {
    vec3 haze = atmoSky(normalize(vec3(d.x, 0.03, d.z)));
    vec3 litCol = uCloudLit * mix(0.7, 1.35, pow(az, 1.6));

    // 高处的卷云：很淡的几缕
    float inv = 1.0 / (y + 0.09);
    vec2 p = d.xz * inv;
    vec2 q = mat2(0.94, -0.34, 0.34, 0.94) * p;
    vec2 q1 = q * vec2(0.5, 1.2) + vec2(uTime * 0.0011, 0.3);
    float c1 = fbm(q1);
    float w1 = n2(q1 * vec2(3.2, 6.0) + 3.7);
    float region = smoothstep(0.44, 0.64, n2(q * 0.3 + 9.1));
    float cir = smoothstep(0.54, 0.84, c1 * 0.72 + w1 * 0.34) * region * smoothstep(0.16, 0.34, y) * smoothstep(0.98, 0.6, y);
    col = mix(col, mix(uCloudShade, litCol, 0.85), cir * 0.34);

    // 低处的云：按方位角 / 仰角来排，是一条条横卧在地平线上方的长云，底边被落日从下面照亮
    vec2 nd = normalize(d.xz + vec2(1e-5));
    float el = y * 11.0;
    vec2 ua = vec2(nd.x * 2.3 + uTime * 0.0016, el) , ub = vec2(nd.y * 2.3 - uTime * 0.0016, el + 5.3);
    float wA = nd.y * nd.y;
    float c2 = mix(fbm(ub * 1.25), fbm(ua * 1.25), wA);
    float c2d = mix(fbm((ub - vec2(0.0, 0.42)) * 1.25), fbm((ua - vec2(0.0, 0.42)) * 1.25), wA);
    float cover = smoothstep(0.50, 0.66, c2) * smoothstep(0.012, 0.07, y) * smoothstep(0.46, 0.22, y);
    float under = clamp(0.42 + (c2 - c2d) * 7.0, 0.0, 1.0);
    float core = smoothstep(0.58, 0.8, c2);
    vec3 bankCol = mix(uCloudShade, litCol, clamp(under * (1.0 - core * 0.55) + (1.0 - cover) * 0.5, 0.0, 1.0));
    float aer = smoothstep(0.0, 0.12, y);
    col = mix(col, mix(haze, bankCol, 0.45 + 0.55 * aer), cover * 0.86);
  }

  // 日面
  float ang = length(d - uSunDir);
  float disc = 1.0 - smoothstep(0.0048, 0.0066, ang);
  col += uSunColor * disc * uSunDisc * smoothstep(-0.012, 0.035, y);

  gl_FragColor = vec4(clamp(col, vec3(0.0), vec3(200.0)), 0.0); // alpha 0 = 天空（水面用它判断太阳有没有被挡住）
}`;

export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;

  constructor(noise: THREE.Texture) {
    const moonAz = -27 * DEG, moonEl = 17 * DEG;
    this.uniforms = {
      ...atmo,
      uNoise: { value: noise },
      uSunDisc: { value: 1 },
      uCloudLit: { value: env.cloudLit },
      uCloudShade: { value: env.cloudShade },
      uMoonDir: { value: new THREE.Vector3(Math.sin(moonAz) * Math.cos(moonEl), Math.sin(moonEl), -Math.cos(moonAz) * Math.cos(moonEl)).normalize() },
      uMoon: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, MINI ? 24 : 48, MINI ? 12 : 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'sky';
  }

  update() {
    this.uniforms.uMoon.value = 0.18 + 0.82 * Math.min(1, env.dusk * 1.25);
  }
}

/**
 * 把同一片天空烘成环境贴图，给所有 PBR 材质当环境光：
 * 朝落日的面偏暖、背对的面偏淡紫，清漆甲板和窗玻璃里映的也是这片天。
 */
export class SkyEnvironment {
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private sky: Sky;
  private ground: THREE.Mesh;
  private current: THREE.WebGLRenderTarget | null = null;
  private lastDusk = -1;
  private lastSeason = -1;

  constructor(private renderer: THREE.WebGLRenderer, noise: THREE.Texture) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky = new Sky(noise);
    this.sky.uniforms.uSunDisc = { value: 0 };
    (this.sky.mesh.material as THREE.ShaderMaterial).uniforms = this.sky.uniforms;
    this.sky.mesh.scale.setScalar(50);
    this.scene.add(this.sky.mesh);
    // 下半球：水面和地面反上来的光
    this.ground = new THREE.Mesh(
      new THREE.SphereGeometry(40, 24, 8, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
      new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false }),
    );
    this.scene.add(this.ground);
  }

  releaseTargets() {
    this.current?.dispose();
    this.current = null;
    this.pmrem.dispose();
  }

  /** dusk 变了一点才重烘（每次几毫秒） */
  update(target: THREE.Scene, force = false) {
    if (!force && this.lastSeason === seasonState.revision && Math.abs(env.dusk - this.lastDusk) < 0.012) return false;
    this.lastDusk = env.dusk;
    this.lastSeason = seasonState.revision;
    const g = this.ground.material as THREE.MeshBasicMaterial;
    g.color.copy(atmo.uHorAway.value).multiplyScalar(0.3).add(new THREE.Color().copy(atmo.uHorSun.value).multiplyScalar(0.14)).add(new THREE.Color().copy(env.water).multiplyScalar(0.5));
    this.sky.update();
    const prevTarget = this.renderer.getRenderTarget();
    const rt = this.pmrem.fromScene(this.scene, 0, 0.5, 200);
    this.renderer.setRenderTarget(prevTarget);
    target.environment = rt.texture;
    this.current?.dispose();
    this.current = rt;
    return true;
  }
}
