import * as THREE from 'three';

/**
 * 河道。直的一段沿 Z 轴：-Z 是下游（西），+X 是右岸（北，大皇宫一侧），-X 是左岸（荣军院、铁塔一侧）。
 * 亚历山大三世桥在 z=0。过了 z=-620，河向左（西南）拐一个大弯，绕到铁塔脚下。
 * 尺寸尽量按真实的来：河面约 108 m 宽，下层码头高出水面 1.7 m，上层街道高出 9.4 m。
 */
export const HALF = 54; // 河面半宽
export const QUAY = 16; // 下层码头宽
export const LOW_Y = 1.7;
export const UP_Y = 9.4;
export const PARAPET = 1.0;
export const WALL = HALF + QUAY; // 上层挡墙的墙脚
export const STREET = WALL + 1.1; // 护栏内侧，街面从这里开始
export const BEND_U = 620;
export const BEND_R = 1133;

export interface Frame {
  x: number;
  z: number;
  tx: number;
  tz: number; // 下游方向
  rx: number;
  rz: number; // 右岸方向
  yaw: number; // 让 -Z 轴转到下游方向的 rotation.y
}

/** u = 沿河往下游走的距离（米），u=0 在亚历山大三世桥 */
export function frame(u: number): Frame {
  if (u <= BEND_U) return { x: 0, z: -u, tx: 0, tz: -1, rx: 1, rz: 0, yaw: 0 };
  const phi = Math.min((u - BEND_U) / BEND_R, 1.25);
  const extra = u - BEND_U - phi * BEND_R; // 弯道之后的直线段
  const tx = -Math.sin(phi), tz = -Math.cos(phi);
  return {
    x: -BEND_R * (1 - Math.cos(phi)) + tx * extra,
    z: -BEND_U - BEND_R * Math.sin(phi) + tz * extra,
    tx, tz,
    rx: -tz, rz: tx,
    yaw: phi,
  };
}

/** 河道坐标 (u, s, y) → 世界坐标；s>0 在右岸一侧 */
export function at(u: number, s: number, y = 0, out = new THREE.Vector3()) {
  const f = frame(u);
  return out.set(f.x + f.rx * s, y, f.z + f.rz * s);
}

/** 亚历山大三世桥的桥面高度（沿桥轴，也就是世界 X） */
export function deckY(x: number) {
  const k = Math.min(Math.abs(x) / 78, 1);
  return UP_Y + 0.8 * (1 - k * k);
}

/** 全世界的灯都登记在这里，由 lamps.ts 统一画灯泡、光晕和地上的光斑 */
export interface LampSpot {
  x: number;
  y: number;
  z: number;
  r: number; // 灯泡半径
  power: number; // 亮度
  pool: number; // 地面光斑的高度（<0 表示不要）
  delay: number; // 0..1：天黑到什么程度才亮
  color?: number;
}
export const lampSpots: LampSpot[] = [];
