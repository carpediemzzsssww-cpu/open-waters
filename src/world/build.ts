import * as THREE from 'three';
import { LIGHT_GEOMETRY } from '../core/env';
import { Batch } from '../core/util';
import { FacadeBuilder, makeFacadeMaterial } from './facade';
import { PAINT, type Kit } from './materials';
import type { Obstacle } from './player';

export interface BoatInfo {
  x: number;
  z: number;
  heading: number;
  speed: number;
  length: number;
}
export interface Ctx {
  scene: THREE.Scene;
  kit: Kit;
  quality: { tier: string; trees: number; people: number };
  playerGroup: THREE.Group;
  /** 轻量画质：各模块的静态几何写进这几批，最后各出一个 mesh */
  shared: { stone: Batch; painted: Batch; fine: Batch; facade: FacadeBuilder };
}
export interface Part {
  update?(dt: number, t: number, cam: THREE.Camera): void;
  obstacles?: Obstacle[];
  boats?: BoatInfo[];
  music?: { x: number; z: number };
}

/** 石头：轻量画质写进共享批次，标准画质各模块自己一批 */
export function stoneBatch(ctx: Ctx) {
  return LIGHT_GEOMETRY ? ctx.shared.stone.view() : new Batch();
}
/**
 * 不带贴图的金属 / 杂项。fine = 细小的东西（路灯杆、栏杆、烛台、花环、金饰）：
 * 轻量画质只画在主画面里，不进水面倒影（倒影被波纹一揉，这些细节本来就看不见）。
 */
export function paintBatch(ctx: Ctx, kind: keyof typeof PAINT, fine = false) {
  if (!LIGHT_GEOMETRY) return new Batch();
  const [tint, mr] = PAINT[kind];
  return (fine ? ctx.shared.fine : ctx.shared.painted).view(tint, [mr[0], mr[1]]);
}
/** 加进场景；共享批次的视图跳过（最后统一出 mesh） */
export function put(ctx: Ctx, b: Batch, mat: THREE.Material, tile: number, name: string, cast = true) {
  if (b.isView || !b.vertexCount) return;
  ctx.scene.add(b.mesh(mat, tile, { name, cast }));
}

/** 不进水面倒影的东西放第 2 层（主相机看得见，镜像相机看不见） */
export function mainOnly(o: THREE.Object3D) {
  o.traverse((c) => c.layers.set(2));
}

export type WorldContext = Omit<Ctx, 'shared'>;
export type Progress = (label: string, fraction: number) => Promise<void>;
export type BuildStage = readonly [label: string, build: (ctx: Ctx) => Part | void];

export async function buildStages(ctx: WorldContext, step: Progress, stages: BuildStage[]): Promise<Part[]> {
  const full: Ctx = { ...ctx, shared: { stone: new Batch(), painted: new Batch(), fine: new Batch(), facade: new FacadeBuilder() } };
  const parts: Part[] = [];
  for (const [i, [label, build]] of stages.entries()) {
    await step(label, i / stages.length);
    const part = build(full);
    if (part) parts.push(part);
  }
  if (LIGHT_GEOMETRY) {
    const sh = full.shared;
    put(full, sh.stone, ctx.kit.stone, 8, 'shared-stone');
    put(full, sh.painted, ctx.kit.painted, 1, 'shared-painted');
    put(full, sh.fine, ctx.kit.painted, 1, 'shared-fine', false);
    const fine = ctx.scene.getObjectByName('shared-fine');
    if (fine) mainOnly(fine);
    if (sh.facade.pos.length) {
      const m = new THREE.Mesh(sh.facade.build(), makeFacadeMaterial(ctx.kit));
      m.castShadow = m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      m.name = 'shared-facade';
      ctx.scene.add(m);
    }
  }
  await step('', 1);
  return parts;
}
