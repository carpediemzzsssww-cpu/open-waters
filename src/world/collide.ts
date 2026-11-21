/**
 * 水面上的碰撞：全是二维的「圆角长方形」（桥墩、靠岸的驳船、小划艇、亚历山大三世桥压得很低的拱脚，
 * 以及会动的游船）。玩家的船按船体算：从船头到船尾一串圆，任何一个圆碰到了就把整条船推出去，
 * 船头不会再插进石墙、驳船或者桥墩里。
 */
export interface Collider {
  x: number;
  z: number;
  /** 长轴方向（rotation.y，0 = 沿 Z） */
  yaw: number;
  /** 半长（沿长轴）、半宽 */
  hl: number;
  hw: number;
  /** 圆角半径（≤ hw、≤ hl） */
  r: number;
  /** 会动的（游船）：每帧由主人改 x / z / yaw */
  moving?: boolean;
  /** 粗筛用的外接圆半径（自动算） */
  bound?: number;
}

export const colliders: Collider[] = [];

export function addCollider(c: Collider) {
  c.bound = Math.hypot(c.hl, c.hw) + 0.5;
  colliders.push(c);
  return c;
}

/** 点到圆角长方形的有符号距离；nx / nz 写出往外推的方向 */
const out = { d: 0, nx: 0, nz: 0 };
export function sdCollider(c: Collider, px: number, pz: number) {
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const dx = px - c.x, dz = pz - c.z;
  // 世界 → 本地：本地 z 沿长轴
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  const ax = Math.abs(lx), az = Math.abs(lz);
  const qx = ax - (c.hw - c.r), qz = az - (c.hl - c.r);
  let d: number, nlx: number, nlz: number;
  if (qx > 0 && qz > 0) {
    const L = Math.hypot(qx, qz);
    d = L - c.r;
    nlx = qx / L;
    nlz = qz / L;
  } else if (qx > qz) {
    d = qx - c.r;
    nlx = 1;
    nlz = 0;
  } else {
    d = qz - c.r;
    nlx = 0;
    nlz = 1;
  }
  nlx *= Math.sign(lx) || 1;
  nlz *= Math.sign(lz) || 1;
  // 本地 → 世界
  out.d = d;
  out.nx = nlx * cs + nlz * sn;
  out.nz = -nlx * sn + nlz * cs;
  return out;
}

/** 一条船的船体：沿船身的几个圆（本地 z，半径） */
export interface HullCircle {
  z: number;
  r: number;
}

const res = { x: 0, z: 0, hit: 0, nx: 0, nz: 0 };
/**
 * 把一条船（中心 x/z、朝向 heading：0 = 朝 -Z）推出所有障碍物和河岸。
 * 返回推了多少（hit = 最深的穿透深度）和推的方向。
 * riverHalf：直段河面半宽（|x| ≤ riverHalf）。skip：不和自己撞。
 */
export function resolveHull(x: number, z: number, heading: number, hull: HullCircle[], riverHalf: number, skip?: Collider, margin = 0.15) {
  const fx = -Math.sin(heading), fz = -Math.cos(heading);
  let px = x, pz = z, deepest = 0, nx = 0, nz = 0;
  // 迭代两遍：推出一个障碍物以后可能碰到另一个（比如驳船和石墙之间的夹缝）
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const h of hull) {
      let cx = px - fx * h.z, cz = pz - fz * h.z; // 本地 z 正向是船尾
      // 石墙
      const over = Math.abs(cx) + h.r + margin - riverHalf;
      if (over > 0) {
        px -= Math.sign(cx) * over;
        if (over > deepest) { deepest = over; nx = -Math.sign(cx); nz = 0; }
        moved = true;
      }
      for (const c of colliders) {
        cx = px - fx * h.z; cz = pz - fz * h.z;
        if (c === skip) continue;
        const ddx = cx - c.x, ddz = cz - c.z, br = c.bound! + h.r + margin;
        if (ddx * ddx + ddz * ddz > br * br) continue;
        const s = sdCollider(c, cx, cz);
        const pen = h.r + margin - s.d;
        if (pen > 1e-6) {
          px += s.nx * pen;
          pz += s.nz * pen;
          if (pen > deepest) { deepest = pen; nx = s.nx; nz = s.nz; }
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  res.x = px;
  res.z = pz;
  res.hit = deepest;
  res.nx = nx;
  res.nz = nz;
  return res;
}

/** 从 (x, z) 沿 (dx, dz) 往前看 dist 米、宽 halfW，最先碰到障碍的距离（没有就返回 Infinity）；给游船让路用 */
export function probe(x: number, z: number, dx: number, dz: number, dist: number, halfW: number, skip?: Collider) {
  let best = Infinity;
  for (let s = 0; s <= dist; s += 1) {
    const px = x + dx * s, pz = z + dz * s;
    for (const c of colliders) {
      if (c === skip) continue;
      const ddx = px - c.x, ddz = pz - c.z, br = c.bound! + halfW;
      if (ddx * ddx + ddz * ddz > br * br) continue;
      if (sdCollider(c, px, pz).d < halfW) {
        best = Math.min(best, s);
      }
    }
    if (best < Infinity) break;
  }
  return best;
}
