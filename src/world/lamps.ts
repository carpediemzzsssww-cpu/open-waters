import * as THREE from 'three';
import { ATMO_GLSL, atmo, env } from '../core/atmosphere';
import { MINI, LIGHT_GEOMETRY } from '../core/env';
import { mainOnly, type Ctx, type Part } from './build';
import type { Kit } from './materials';
import { lampSpots, type LampSpot } from './river';

/**
 * 灯。不用真正的点光源（几百盏太贵），每盏灯是三样东西：
 * 一颗会发光的灯泡、一圈随距离缩放的光晕、地上一摊暖色的光斑。
 * 每盏灯有自己的「点亮时刻」，所以天黑下来时它们是一盏一盏亮起来的。
 * 灯泡和光晕都会进水面的倒影，被波纹拉成一条条竖着的光——这是夜里塞纳河最好看的东西。
 */
const WARM = new THREE.Color(1.0, 0.66, 0.34);

let mats: { bulb: THREE.ShaderMaterial; halo: THREE.ShaderMaterial; pool: THREE.ShaderMaterial; u: Record<string, THREE.IUniform> } | null = null;

function materials(kit: Kit) {
  if (mats) return mats;
  const u: Record<string, THREE.IUniform> = {
    ...atmo,
    uGlowTex: { value: kit.glow },
    uAmb: { value: env.ambSky },
    uSunL: { value: new THREE.Color() },
    uViewH: { value: 900 },
  };
  const bulb = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec2 aLamp; attribute vec3 aCol;
      varying float vOn; varying vec3 vToFrag; varying vec3 vN; varying vec3 vCol;
      ${ATMO_GLSL}
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vToFrag = w.xyz - cameraPosition;
        vN = normalize(mat3(modelMatrix) * normal);
        vOn = smoothstep(aLamp.y, aLamp.y + 0.1, uNight) * aLamp.x;
        vCol = aCol;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vOn; varying vec3 vToFrag; varying vec3 vN; varying vec3 vCol;
      uniform vec3 uAmb; uniform vec3 uSunL;
      ${ATMO_GLSL}
      void main() {
        vec3 N = normalize(vN), V = -normalize(vToFrag);
        float nv = max(dot(N, V), 0.0);
        // 没亮的时候是一颗乳白的玻璃球，映着天
        vec3 off = vec3(0.50, 0.49, 0.46) * (uAmb * 1.2 + uSunL * (0.15 + 0.85 * max(dot(N, uSunDir), 0.0))) + atmoSky(reflect(-V, N)) * 0.08 * pow(1.0 - nv, 3.0);
        vec3 on = vCol * (2.2 + 5.5 * nv * nv);
        vec3 col = mix(off, on, min(vOn, 1.0)) + on * max(vOn - 1.0, 0.0);
        col = atmoFog(col, vToFrag, cameraPosition.y);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const halo = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec2 aLamp; attribute vec3 aCol;
      uniform float uViewH;
      varying vec3 vCol;
      ${ATMO_GLSL}
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        float on = smoothstep(aLamp.y, aLamp.y + 0.1, uNight);
        float dist = max(-mv.z, 0.1);
        float px = (2.6 + 1.6 * aLamp.x) * projectionMatrix[1][1] * uViewH * 0.5 / dist;
        float k = min(px / 3.0, 1.0);
        gl_PointSize = clamp(px, 3.0, 260.0);
        float fogA = atmoFogAmount(w.xyz - cameraPosition, cameraPosition.y);
        // 有雾气的夜里，远处的灯反而晕得更开一点
        vCol = aCol * on * aLamp.x * k * k * (1.0 - fogA * 0.85) * 0.5;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uGlowTex;
      varying vec3 vCol;
      void main() {
        float g = texture2D(uGlowTex, gl_PointCoord).a;
        gl_FragColor = vec4(vCol * g, 1.0);
      }`,
  });
  const pool = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    vertexShader: /* glsl */ `
      attribute vec2 aLamp; attribute vec3 aCol;
      varying vec2 vUv; varying vec3 vCol; varying vec3 vToFrag;
      ${ATMO_GLSL}
      void main() {
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vUv = uv;
        vToFrag = w.xyz - cameraPosition;
        vCol = aCol * smoothstep(aLamp.y, aLamp.y + 0.1, uNight) * aLamp.x;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uGlowTex;
      varying vec2 vUv; varying vec3 vCol; varying vec3 vToFrag;
      ${ATMO_GLSL}
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float g = pow(max(1.0 - d, 0.0), 2.2);
        float fogA = atmoFogAmount(vToFrag, cameraPosition.y);
        gl_FragColor = vec4(vCol * g * 0.2 * (1.0 - fogA), 1.0);
      }`,
  });
  mats = { bulb, halo, pool, u };
  return mats;
}

const BULB = MINI ? new THREE.OctahedronGeometry(1) : LIGHT_GEOMETRY ? new THREE.SphereGeometry(1, 5, 3) : new THREE.SphereGeometry(1, 10, 7);
const _m = new THREE.Matrix4(), _c = new THREE.Color();

/** 一组灯。可以挂在会动的东西（船）下面。 */
export class LampSet {
  group = new THREE.Group();

  constructor(spots: LampSpot[], kit: Kit) {
    const M = materials(kit);
    const n = spots.length;
    const lamp = new Float32Array(n * 2), col = new Float32Array(n * 3), pos = new Float32Array(n * 3);
    const bulbs = new THREE.InstancedMesh(BULB, M.bulb, n);
    spots.forEach((s, i) => {
      bulbs.setMatrixAt(i, _m.makeScale(s.r, s.r, s.r).setPosition(s.x, s.y, s.z));
      lamp.set([s.power, s.delay], i * 2);
      if (s.color !== undefined) _c.set(s.color);
      else _c.copy(WARM);
      col.set([_c.r, _c.g, _c.b], i * 3);
      pos.set([s.x, s.y, s.z], i * 3);
    });
    const bg = BULB.clone();
    bg.setAttribute('aLamp', new THREE.InstancedBufferAttribute(lamp, 2));
    bg.setAttribute('aCol', new THREE.InstancedBufferAttribute(col, 3));
    bulbs.geometry = bg;
    bulbs.instanceMatrix.needsUpdate = true;
    bulbs.frustumCulled = false;
    this.group.add(bulbs);
    if (LIGHT_GEOMETRY) mainOnly(bulbs); // 倒影里留光晕就够了

    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    hg.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 2));
    hg.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const halo = new THREE.Points(hg, M.halo);
    halo.frustumCulled = false;
    halo.renderOrder = 20;
    halo.onBeforeRender = (renderer) => {
      const rt = renderer.getRenderTarget();
      M.u.uViewH.value = rt ? rt.height : renderer.domElement.height;
      M.halo.uniformsNeedUpdate = true;
    };
    this.group.add(halo);

    const pools = spots.filter((s) => s.pool > -0.5);
    if (pools.length) {
      const pg = new THREE.PlaneGeometry(1, 1);
      pg.rotateX(-Math.PI / 2);
      const pl = new Float32Array(pools.length * 2), pc = new Float32Array(pools.length * 3);
      const pm = new THREE.InstancedMesh(pg, M.pool, pools.length);
      pools.forEach((s, i) => {
        const rad = (s.y - s.pool) * 3.4 + 4;
        pm.setMatrixAt(i, _m.makeScale(rad, 1, rad).setPosition(s.x, s.pool + 0.05, s.z));
        pl.set([s.power, s.delay], i * 2);
        if (s.color !== undefined) _c.set(s.color);
        else _c.copy(WARM);
        pc.set([_c.r, _c.g, _c.b], i * 3);
      });
      pg.setAttribute('aLamp', new THREE.InstancedBufferAttribute(pl, 2));
      pg.setAttribute('aCol', new THREE.InstancedBufferAttribute(pc, 3));
      pm.instanceMatrix.needsUpdate = true;
      pm.frustumCulled = false;
      pm.renderOrder = 10;
      this.group.add(pm);
      if (LIGHT_GEOMETRY) mainOnly(pm);
    }
  }
}

export function build(ctx: Ctx): Part {
  const set = new LampSet(lampSpots, ctx.kit);
  set.group.name = 'lamps';
  ctx.scene.add(set.group);
  const M = materials(ctx.kit);
  console.debug('[open-waters] lamps:', lampSpots.length);
  return {
    update() {
      (M.u.uSunL.value as THREE.Color).copy(env.sunLight).multiplyScalar(env.sunIntensity / Math.PI);
    },
  };
}
