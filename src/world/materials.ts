import * as THREE from 'three';
import { LIGHT_GEOMETRY } from '../core/env';
import { inject, withAtmo } from '../core/atmosphere';
import { makeCobbleTextures, makeFoliageTexture, makeGlowTexture, makeLatticeTexture, makeNoiseTexture, makeStoneTextures, makeWaterSlopeTexture, makeWickerTexture, makeWoodTexture } from '../core/textures';

type Shader = { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string };

export interface StdPatch {
  vpars?: string;
  vbegin?: string; // 在 begin_vertex 之后：改 transformed
  vmain?: string;
  pars?: string;
  color?: string; // 在 map_fragment 之后：改 diffuseColor
  rough?: string; // 改 roughnessFactor / metalnessFactor
  normal?: string; // 改 normal
  emissive?: string; // 加 totalEmissiveRadiance
  uniforms?: Record<string, THREE.IUniform>;
}

/** 给 MeshStandard / Physical 材质插几段代码；统一带上世界坐标和世界法线 */
export function patchStd(shader: Shader, o: StdPatch) {
  Object.assign(shader.uniforms, o.uniforms ?? {});
  shader.vertexShader = inject(shader.vertexShader, '#include <common>', 'varying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform float uTime;\n' + (o.vpars ?? ''));
  if (o.vbegin) shader.vertexShader = inject(shader.vertexShader, '#include <begin_vertex>', o.vbegin);
  shader.vertexShader = inject(
    shader.vertexShader,
    '#include <project_vertex>',
    /* glsl */ `
    vec4 wp4 = vec4(transformed, 1.0);
    vec3 wn3 = objectNormal;
    #ifdef USE_INSTANCING
      wp4 = instanceMatrix * wp4;
      wn3 = mat3(instanceMatrix) * wn3;
    #endif
    vWPos = (modelMatrix * wp4).xyz;
    vWNrm = normalize(mat3(modelMatrix) * wn3);
    ${o.vmain ?? ''}`,
  );
  let f = shader.fragmentShader;
  f = inject(f, '#include <fog_pars_fragment>', 'varying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform float uTime;\nuniform sampler2D uNoiseTex;\n' + (o.pars ?? ''));
  if (o.color) f = inject(f, '#include <map_fragment>', o.color);
  if (o.rough) f = inject(f, '#include <metalnessmap_fragment>', o.rough);
  if (o.normal) f = inject(f, '#include <normal_fragment_maps>', o.normal);
  if (o.emissive) f = inject(f, '#include <emissivemap_fragment>', o.emissive);
  shader.fragmentShader = f;
}

/** 原来各自一个材质的颜色 / 金属度 / 粗糙度：轻量画质把它们烘进「上色」共享材质的顶点 */
export const PAINT = {
  plain: [0xffffff, [0, 0.9]],
  steel: [0xb4bab4, [0.25, 0.55]],
  bronze: [0x34443a, [0.75, 0.48]],
  gold: [0xdaa640, [1, 0.36]],
  iron: [0x1d2226, [0.45, 0.62]],
  hull: [0xffffff, [0.1, 0.55]],
} as const satisfies Record<string, readonly [number, readonly [number, number]]>;

export function makeKit() {
  const noise = makeNoiseTexture();
  const stoneTex = makeStoneTextures();
  const cobbleTex = makeCobbleTextures();
  const N = { uNoiseTex: { value: noise } };

  // 石头：大尺度的深浅不匀 + 水线的青苔和潮痕 + 水光在近水的墙面上晃
  const STONE: StdPatch = {
    uniforms: N,
    pars: /* glsl */ `
      float seineCaustic(vec3 p, float t) {
        vec2 q = vec2(p.x + p.y * 0.6, p.z + p.y * 0.35);
        float a = texture2D(uNoiseTex, q * 0.19 + vec2(t * 0.031, t * 0.019)).r;
        float b = texture2D(uNoiseTex, q * 0.27 + vec2(-t * 0.027, t * 0.034) + 0.37).g;
        return pow(1.0 - abs(a - b), 18.0);
      }`,
    color: /* glsl */ `
      float mv = texture2D(uNoiseTex, vWPos.xz * 0.011 + vWPos.y * 0.017).r;
      float mv2 = texture2D(uNoiseTex, vec2(vWPos.x + vWPos.z, vWPos.y * 1.7) * 0.043).g;
      diffuseColor.rgb *= 0.84 + 0.3 * mv;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.8, 0.78, 0.72), smoothstep(0.52, 0.85, mv2) * 0.55);
      float wl = smoothstep(1.15 + mv2 * 0.7, 0.1, vWPos.y);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.40, 0.45, 0.32), wl * 0.85);`,
    rough: /* glsl */ `roughnessFactor = mix(roughnessFactor, 0.32, wl * 0.75);`,
    emissive: /* glsl */ `
      {
        float cm = smoothstep(5.0, 0.3, vWPos.y) * smoothstep(-0.02, 0.06, uSunDir.y) * (0.25 + 0.75 * smoothstep(0.3, -0.6, vWNrm.y));
        if (cm > 0.001) totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (seineCaustic(vWPos, uTime) * cm * 0.0011);
      }`,
  };

  const std = (o: THREE.MeshStandardMaterialParameters, key: string, patch?: StdPatch) => withAtmo(new THREE.MeshStandardMaterial(o), key, patch ? (s) => patchStd(s, patch) : undefined);

  const kit = {
    noise,
    slope: makeWaterSlopeTexture(),
    foliage: makeFoliageTexture(),
    lattice: makeLatticeTexture(),
    glow: makeGlowTexture(),
    stone: std({ map: stoneTex.map, normalMap: stoneTex.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.93, vertexColors: true }, 'stone', STONE),
    cobble: std({ map: cobbleTex.map, normalMap: cobbleTex.normalMap, roughness: 0.9, vertexColors: true }, 'cobble', {
      uniforms: N,
      color: /* glsl */ `
        float cv = texture2D(uNoiseTex, vWPos.xz * 0.021).r;
        diffuseColor.rgb *= 0.8 + 0.4 * cv;`,
    }),
    // 亚历山大三世桥：珠灰色的钢、暗青的铜、贴金
    steel: std({ color: 0xb4bab4, roughness: 0.55, metalness: 0.25, vertexColors: true }, 'steel', {
      uniforms: N,
      pars: STONE.pars,
      emissive: /* glsl */ `
        {
          float cm = smoothstep(11.0, 2.0, vWPos.y) * smoothstep(-0.02, 0.06, uSunDir.y) * smoothstep(0.2, -0.7, vWNrm.y);
          if (cm > 0.001) totalEmissiveRadiance += diffuseColor.rgb * uSunColor * (seineCaustic(vWPos, uTime) * cm * 0.003);
        }`,
    }),
    bronze: std({ color: 0x34443a, roughness: 0.48, metalness: 0.75, vertexColors: true }, 'bronze'),
    gold: std({ color: 0xdaa640, roughness: 0.36, metalness: 1.0, vertexColors: true }, 'gold'),
    iron: std({ color: 0x1d2226, roughness: 0.62, metalness: 0.45, vertexColors: true }, 'iron'),
    plain: std({ color: 0xffffff, roughness: 0.9, vertexColors: true }, 'plain'), // 顶点色决定颜色的杂项
    // 轻量画质：所有不带贴图的静态杂项共用一个材质，颜色、金属度、粗糙度都写在顶点上
    painted: std({ color: 0xffffff, roughness: 1, metalness: 1, vertexColors: true }, 'painted', {
      vpars: 'attribute vec2 mr;\nvarying vec2 vMR;',
      vmain: 'vMR = mr;',
      pars: 'varying vec2 vMR;',
      rough: 'roughnessFactor = vMR.y; metalnessFactor = vMR.x;',
    }),
    wood: {
      deck: makeWoodTexture({ seams: true, planks: 16, base: [12, 70, 17], seed: 31, gap: '#b99a66' }),
      mahogany: makeWoodTexture({ seams: false, planks: 5, base: [11, 68, 15], seed: 47, size: LIGHT_GEOMETRY ? 512 : 1024 }),
      teak: makeWoodTexture({ seams: true, planks: 10, base: [30, 40, 44], seed: 53, gap: '#2a2018', size: LIGHT_GEOMETRY ? 256 : 1024 }),
    },
    wicker: makeWickerTexture(),
    std,
  };
  return kit;
}
export type Kit = ReturnType<typeof makeKit>;
