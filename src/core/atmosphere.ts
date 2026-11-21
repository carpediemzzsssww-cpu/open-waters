import * as THREE from 'three';
import type { Voyage } from '../destinations/catalog';
import { SEASONS, seasonState, seasonTint } from './seasons';
import { DEG, lerp, smoothstep } from './util';

/**
 * 整个世界共用的一套大气：天空渐变、空气透视（雾）、太阳方向。
 * 天空穹顶、水面、树、以及所有 three 内置材质的雾，读的都是这同一组 uniform，
 * 所以远处的东西会准确地化进它身后那片天的颜色里。
 */
export const atmo = {
  uSunDir: { value: new THREE.Vector3(0, 0.1, -1).normalize() },
  uSunColor: { value: new THREE.Color(1, 0.7, 0.4) }, // 日面 / 水面碎金的辐亮度
  uZenith: { value: new THREE.Color() },
  uMidSun: { value: new THREE.Color() },
  uMidAway: { value: new THREE.Color() },
  uHorSun: { value: new THREE.Color() },
  uHorAway: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uFog: { value: new THREE.Vector4(0.00085, 0.0065, 1, 0) }, // 密度, 高度衰减, -, -
  uNight: { value: 0 },
  uTime: { value: 0 },
};

export const ATMO_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uMidSun;
uniform vec3 uMidAway;
uniform vec3 uHorSun;
uniform vec3 uHorAway;
uniform vec3 uGlow;
uniform vec4 uFog;
uniform float uNight;

vec3 atmoBase(vec3 d, out float s) {
  float y = max(d.y, 0.0);
  vec2 sa = normalize(uSunDir.xz);
  float az = clamp(dot(normalize(d.xz + vec2(1e-5)), sa) * 0.5 + 0.5, 0.0, 1.0); // 1 = 朝太阳
  float azS = az * az * (3.0 - 2.0 * az);
  vec3 hor = mix(uHorAway, uHorSun, az * az * sqrt(az));
  vec3 mid = mix(uMidAway, uMidSun, azS);
  float t1 = 1.0 - exp(-y * 8.5);
  float t2 = smoothstep(0.03, 0.62, y);
  vec3 c = mix(hor, mid, t1);
  c = mix(c, uZenith, t2);
  s = clamp(dot(normalize(vec3(d.x, max(d.y, 0.0), d.z)), uSunDir), 0.0, 1.0);
  return c;
}

vec3 atmoSky(vec3 d) {
  float s;
  vec3 c = atmoBase(d, s);
  float s2 = s * s, s4 = s2 * s2, s8 = s4 * s4, s32 = s8 * s8 * s8 * s8;
  c += uGlow * (0.42 * s4 * s + 1.3 * s32 * s8 + 3.2 * pow(s32, 6.0) + 7.0 * pow(s32, 22.0) + 16.0 * pow(s32, 90.0));
  return c;
}

float atmoFogAmount(vec3 toFrag, float camY) {
  float dist = length(toFrag);
  float t = uFog.y * toFrag.y;
  float hterm = abs(t) > 1e-3 ? (1.0 - exp(-t)) / t : 1.0;
  float od = uFog.x * dist * exp(-uFog.y * max(camY, 0.0)) * hterm;
  return 1.0 - exp(-od);
}

vec3 atmoFogColor(vec3 dir) {
  float s;
  vec3 c = atmoBase(normalize(vec3(dir.x, 0.03, dir.z)), s);
  float s2 = s * s, s4 = s2 * s2, s8 = s4 * s4;
  return c + uGlow * (0.3 * s4 * s + 0.55 * s8 * s8 * s8);
}

vec3 atmoFog(vec3 col, vec3 toFrag, float camY) {
  float f = atmoFogAmount(toFrag, camY);
  return mix(col, atmoFogColor(normalize(toFrag)), f);
}
`;

let patched = false;
/** 把 three 内置材质的雾换成上面的空气透视。必须在任何材质编译之前调用。 */
export function patchFogChunks() {
  if (patched) return;
  patched = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorld = transpose(mat3(viewMatrix)) * mvPosition.xyz;
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
  ${ATMO_GLSL}
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = atmoFog(gl_FragColor.rgb, vFogWorld, cameraPosition.y);
#endif`;
}

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };
export type ShaderPatch = (s: Shader) => void;

/** 给内置材质接上大气 uniform；patch 里可以再改着色器 */
export function withAtmo<T extends THREE.Material>(m: T, key = '', patch?: ShaderPatch): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmo);
    patch?.(shader as unknown as Shader);
  };
  m.customProgramCacheKey = () => 'atmo:' + key;
  return m;
}

/** 常用：往片元 / 顶点着色器里某个 #include 之后插代码 */
export function inject(src: string, anchor: string, code: string, before = false) {
  if (!src.includes(anchor)) console.warn('[open-waters] shader anchor missing:', anchor);
  return src.replace(anchor, before ? code + '\n' + anchor : anchor + '\n' + code);
}

// ───────────────────────── 时间：黄金时刻 → 蓝调时刻 ─────────────────────────

const C = (hex: number, mul = 1) => new THREE.Color(hex).multiplyScalar(mul);

interface Key {
  t: number;
  zen: THREE.Color;
  midS: THREE.Color;
  midA: THREE.Color;
  horS: THREE.Color;
  horA: THREE.Color;
  glow: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
  sun: THREE.Color; // 直射光颜色
  sunI: number; // 直射光强度
  disc: THREE.Color; // 日面辐亮度
  water: THREE.Color; // 水体本色（已含环境光）
  exposure: number;
  fog: number;
}

const KEYS: Key[] = [
  {
    t: 0.0, // 黄金时刻：太阳约 8°
    zen: C(0x4c7acb, 0.74), midS: C(0xf1c49a, 1.0), midA: C(0xa9a0dc, 0.82),
    horS: C(0xffd292, 1.34), horA: C(0xe6b8b4, 0.9), glow: C(0xffae5e, 0.9),
    cloudLit: C(0xffe6c8, 1.3), cloudShade: C(0xb9a8b4, 0.76),
    sun: C(0xffbd7c), sunI: 6.4, disc: C(0xffd49a, 90),
    water: C(0x3d4a3a, 0.3), exposure: 0.92, fog: 0.00048,
  },
  {
    t: 0.34, // 落日：太阳约 2.5°，颜色最浓
    zen: C(0x4a6cbc, 0.66), midS: C(0xf6ac86, 0.98), midA: C(0xa390d0, 0.74),
    horS: C(0xffa65e, 1.42), horA: C(0xd89cab, 0.8), glow: C(0xff8a3e, 1.0),
    cloudLit: C(0xffb08a, 1.36), cloudShade: C(0x9c88a6, 0.62),
    sun: C(0xff9250), sunI: 3.8, disc: C(0xff9448, 60),
    water: C(0x3c443c, 0.25), exposure: 0.98, fog: 0.00054,
  },
  {
    t: 0.56, // 余晖：太阳刚落到地平线下
    zen: C(0x3a569f, 0.56), midS: C(0xe79890, 0.78), midA: C(0x706eb4, 0.56),
    horS: C(0xff985c, 1.06), horA: C(0x9080b0, 0.54), glow: C(0xff7a42, 0.5),
    cloudLit: C(0xf08c88, 0.9), cloudShade: C(0x5f609a, 0.48),
    sun: C(0xff7a40), sunI: 0.0, disc: C(0xff7030, 10),
    water: C(0x30384a, 0.2), exposure: 1.06, fog: 0.00060,
  },
  {
    t: 0.78, // 暮色
    zen: C(0x1c3c84, 0.44), midS: C(0x7d80bc, 0.5), midA: C(0x2c468e, 0.42),
    horS: C(0xf08c5c, 0.72), horA: C(0x3c5494, 0.4), glow: C(0xe06c42, 0.2),
    cloudLit: C(0x8e74a2, 0.46), cloudShade: C(0x2c3e7c, 0.36),
    sun: C(0xff7a40), sunI: 0.0, disc: C(0xff7030, 0),
    water: C(0x1c2c54, 0.2), exposure: 1.36, fog: 0.00058,
  },
  {
    t: 1.0, // 蓝调时刻
    zen: C(0x0a2260, 0.36), midS: C(0x285a9e, 0.42), midA: C(0x12306e, 0.32),
    horS: C(0xe0905c, 0.44), horA: C(0x1c3a7a, 0.32), glow: C(0xa04c32, 0.07),
    cloudLit: C(0x34508c, 0.3), cloudShade: C(0x10265e, 0.25),
    sun: C(0xff7a40), sunI: 0.0, disc: C(0xff7030, 0),
    water: C(0x0e2250, 0.2), exposure: 1.62, fog: 0.00056,
  },
];


const waterTint = new THREE.Color(1, 1, 1);

const skyTint = new THREE.Color();
const SUN_EL0 = 8.2;
const SUN_EL1 = -8.5;

export const env = {
  dusk: 0,
  sunElevDeg: SUN_EL0,
  sunDir: new THREE.Vector3(),
  sunLight: new THREE.Color(),
  sunIntensity: 0,
  cloudLit: new THREE.Color(),
  cloudShade: new THREE.Color(),
  water: new THREE.Color(),
  ambSky: new THREE.Color(),
  ambGround: new THREE.Color(),
  exposure: 1,
  night: 0, // 0..1：灯亮起的程度
  windowGlow: 0, // 0..1：窗里亮灯的比例
};

let locationProfile: Pick<Voyage, 'waterTint'|'sunBearing'|'daylight'> = {};
export function setAtmosphereProfile(voyage: Voyage) { locationProfile = voyage; }

const _a = new THREE.Color();
export function setDusk(d: number) {
  d = Math.min(1, Math.max(0, d));
  env.dusk = d;
  let i = 0;
  while (i < KEYS.length - 2 && d > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const k = smoothstep(0, 1, (d - a.t) / (b.t - a.t)) * 0.5 + ((d - a.t) / (b.t - a.t)) * 0.5;
  atmo.uZenith.value.lerpColors(a.zen, b.zen, k);
  atmo.uMidSun.value.lerpColors(a.midS, b.midS, k);
  atmo.uMidAway.value.lerpColors(a.midA, b.midA, k);
  atmo.uHorSun.value.lerpColors(a.horS, b.horS, k);
  atmo.uHorAway.value.lerpColors(a.horA, b.horA, k);
  atmo.uGlow.value.lerpColors(a.glow, b.glow, k);
  atmo.uSunColor.value.lerpColors(a.disc, b.disc, k);
  atmo.uFog.value.x = lerp(a.fog, b.fog, k);
  env.cloudLit.lerpColors(a.cloudLit, b.cloudLit, k);
  env.cloudShade.lerpColors(a.cloudShade, b.cloudShade, k);
  env.water.lerpColors(a.water, b.water, k);
  env.sunLight.lerpColors(a.sun, b.sun, k);
  env.exposure = lerp(a.exposure, b.exposure, k);

  const daylight = locationProfile.daylight;
  const azimuth = (locationProfile.sunBearing ?? 7) * DEG;
  if (daylight) skyTint.fromArray(daylight.skyTint); else skyTint.setRGB(1, 1, 1);
  if (locationProfile.waterTint) waterTint.fromArray(locationProfile.waterTint); else waterTint.setRGB(1, 1, 1);
  const el = lerp(SUN_EL0, SUN_EL1, d);
  env.sunElevDeg = el;
  const e = el * DEG;
  env.sunDir.set(Math.sin(azimuth) * Math.cos(e), Math.sin(e), -Math.cos(azimuth) * Math.cos(e)).normalize();
  atmo.uSunDir.value.copy(env.sunDir);
  // 直射光：贴近地平线时被大气吃掉
  env.sunIntensity = lerp(a.sunI, b.sunI, k) * smoothstep(-0.6, 2.2, el);
  // 日面在地平线附近再压暗一点
  atmo.uSunColor.value.multiplyScalar(smoothstep(-1.2, 1.5, el));

  env.night = smoothstep(0.5, 0.9, d);
  env.windowGlow = smoothstep(0.42, 0.95, d);
  atmo.uNight.value = env.night;

  const season = SEASONS[seasonState.current];
  for (const u of [atmo.uZenith, atmo.uMidSun, atmo.uMidAway, atmo.uHorSun, atmo.uHorAway]) u.value.multiply(seasonTint).multiply(skyTint);
  atmo.uGlow.value.multiplyScalar(daylight?.glow ?? 1);
  env.cloudLit.multiply(seasonTint).multiply(skyTint);
  env.cloudShade.multiply(seasonTint).multiply(skyTint);
  env.water.multiply(seasonTint).multiply(waterTint);
  env.sunIntensity *= season.sun;
  atmo.uFog.value.x *= season.fog * (daylight?.haze ?? 1);

  // 给自写着色器（树、人）的环境光：天顶 / 地面两个方向
  env.ambSky.copy(atmo.uZenith.value).multiplyScalar(0.55).add(_a.copy(atmo.uMidAway.value).multiplyScalar(0.3)).add(_a.copy(atmo.uMidSun.value).multiplyScalar(0.25));
  env.ambGround.copy(atmo.uHorAway.value).multiplyScalar(0.22).add(_a.copy(atmo.uHorSun.value).multiplyScalar(0.12));
}
setDusk(0);
