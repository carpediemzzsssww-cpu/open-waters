import * as THREE from 'three';
import { LIGHT_GEOMETRY, seg } from './env';

/** 可复现的随机数（mulberry32） */
export function rng(seed: number) {
  let s = seed | 0;
  const f = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Object.assign(f, {
    range: (a: number, b: number) => a + (b - a) * f(),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(f() * arr.length)],
    sign: () => (f() < 0.5 ? -1 : 1),
  });
}
export type Rng = ReturnType<typeof rng>;

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 帧率无关的指数趋近 */
export const damp = (a: number, b: number, lambda: number, dt: number) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapPi = (a: number) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const DEG = Math.PI / 180;

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** 位置 + 缩放 + 欧拉角 → 矩阵（返回新矩阵，可直接传给 Batch.add） */
export function M(x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_SPHERE = new THREE.SphereGeometry(1, 12, 8);
const UNIT_SPHERE_LITE = new THREE.SphereGeometry(1, 7, 5);
const _la = new THREE.Vector3(), _lb = new THREE.Vector3(), _ld = new THREE.Vector3(), _lm = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0), _ONE = new THREE.Vector3(1, 1, 1);

/**
 * 把很多小几何体烘进一个 BufferGeometry（一个材质 = 一次 draw call）。
 * UV 默认按世界坐标做盒式投影（单位：米 / tile），这样整条河岸的石缝是连续的。
 */
export class Batch {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  idx: number[] = [];
  own: number[] = []; // 1 = 保留几何体自带 UV
  extra: Record<string, { size: number; data: number[] }> = {};
  /** 写进来的颜色先乘上这个底色（共享批次用：材质颜色烘进顶点色） */
  tint: THREE.Color | null = null;
  /** 金属度 / 粗糙度：写进 mr 属性（「上色」共享材质用） */
  mrv: [number, number] = [0, 0.9];
  mr: number[] = [];
  usesMR = false;
  isView = false;

  /**
   * 一个写进同一批顶点的视图：模块照常往里加几何体，最后只出一个 mesh（一次 draw call）。
   * tint 是原来材质的颜色，mr 是原来材质的金属度和粗糙度。
   */
  view(tint?: THREE.ColorRepresentation, mr?: [number, number]) {
    const v = new Batch();
    v.pos = this.pos; v.nor = this.nor; v.uv = this.uv; v.col = this.col; v.idx = this.idx; v.own = this.own; v.extra = this.extra; v.mr = this.mr;
    v.isView = true;
    v.tint = tint === undefined ? null : new THREE.Color(tint);
    if (mr) {
      v.mrv = mr;
      this.usesMR = true;
    }
    return v;
  }

  private pushColor(c: THREE.Color) {
    if (this.tint) this.col.push(c.r * this.tint.r, c.g * this.tint.g, c.b * this.tint.b);
    else this.col.push(c.r, c.g, c.b);
    this.mr.push(this.mrv[0], this.mrv[1]);
  }

  get vertexCount() {
    return this.pos.length / 3;
  }

  add(g: THREE.BufferGeometry, m: THREE.Matrix4 = _m.identity(), color: THREE.ColorRepresentation = 0xffffff, ownUV?: [number, number]) {
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const u = g.attributes.uv as THREE.BufferAttribute | undefined;
    const base = this.pos.length / 3;
    _nm.getNormalMatrix(m);
    _c.set(color);
    const flip = m.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.nor.push(_n.x, _n.y, _n.z);
      if (ownUV && u) {
        this.uv.push(u.getX(i) * ownUV[0], u.getY(i) * ownUV[1]);
        this.own.push(1);
      } else {
        this.uv.push(0, 0);
        this.own.push(0);
      }
      this.pushColor(_c);
    }
    const index = g.index;
    const count = index ? index.count : p.count;
    for (let i = 0; i < count; i += 3) {
      const a = base + (index ? index.getX(i) : i);
      const b = base + (index ? index.getX(i + 1) : i + 1);
      const c = base + (index ? index.getX(i + 2) : i + 2);
      if (flip) this.idx.push(a, c, b);
      else this.idx.push(a, b, c);
    }
    return this;
  }

  /** 轴对齐盒子：中心 (x,y,z)，尺寸 (w,h,d)，可绕 Y 旋转 */
  box(x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation = 0xffffff, ry = 0) {
    return this.add(UNIT_BOX, M(x, y, z, w, h, d, ry), color);
  }

  /** 任意四边形（a→b→c→d 逆时针朝外），可带自定义 UV */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.ColorRepresentation = 0xffffff, uvs?: number[]) {
    const base = this.pos.length / 3;
    _n.subVectors(b, a).cross(_v.subVectors(d, a)).normalize();
    _c.set(color);
    const pts = [a, b, c, d];
    for (let i = 0; i < 4; i++) {
      this.pos.push(pts[i].x, pts[i].y, pts[i].z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (uvs) {
        this.uv.push(uvs[i * 2], uvs[i * 2 + 1]);
        this.own.push(1);
      } else {
        this.uv.push(0, 0);
        this.own.push(0);
      }
      this.pushColor(_c);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    return base;
  }

  /** 把另一个 Batch 整体变换后并进来（保留它的顶点色和 UV 模式） */
  addBatch(o: Batch, m: THREE.Matrix4) {
    const base = this.pos.length / 3;
    _nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const n = o.pos.length / 3;
    for (let i = 0; i < n; i++) {
      _v.set(o.pos[i * 3], o.pos[i * 3 + 1], o.pos[i * 3 + 2]).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      _n.set(o.nor[i * 3], o.nor[i * 3 + 1], o.nor[i * 3 + 2]).applyMatrix3(_nm).normalize();
      this.nor.push(_n.x, _n.y, _n.z);
      this.uv.push(o.uv[i * 2], o.uv[i * 2 + 1]);
      this.own.push(o.own[i]);
      this.pushColor(_c.setRGB(o.col[i * 3], o.col[i * 3 + 1], o.col[i * 3 + 2]));
    }
    for (let i = 0; i < o.idx.length; i += 3) {
      if (flip) this.idx.push(base + o.idx[i], base + o.idx[i + 2], base + o.idx[i + 1]);
      else this.idx.push(base + o.idx[i], base + o.idx[i + 1], base + o.idx[i + 2]);
    }
    return this;
  }

  /** 椭球 */
  ell(x: number, y: number, z: number, sx: number, sy: number, sz: number, color: THREE.ColorRepresentation = 0xffffff, rz = 0, rx = 0, ry = 0) {
    return this.add(LIGHT_GEOMETRY ? UNIT_SPHERE_LITE : UNIT_SPHERE, M(x, y, z, sx, sy, sz, ry, rx, rz), color, [1, 1]);
  }

  /** 两点之间的一段圆台（做四肢、杆件、管子） */
  limb(p0: [number, number, number], p1: [number, number, number], r0: number, r1 = r0, color: THREE.ColorRepresentation = 0xffffff, sides = 7) {
    const a = _la.set(p0[0], p0[1], p0[2]), b = _lb.set(p1[0], p1[1], p1[2]);
    const len = a.distanceTo(b);
    if (len < 1e-5) return this;
    _ld.subVectors(b, a).normalize();
    _q.setFromUnitVectors(_UP, _ld);
    const m = new THREE.Matrix4().compose(_lm.addVectors(a, b).multiplyScalar(0.5), _q, _ONE);
    return this.add(new THREE.CylinderGeometry(r1, r0, len, seg(sides, 4), 1, LIGHT_GEOMETRY), m, color, [1, 1]);
  }

  /** 给最近加入的 count 个顶点补一个自定义属性 */
  attr(name: string, size: number, values: number[]) {
    const e = (this.extra[name] ??= { size, data: [] });
    const want = (this.pos.length / 3) * size;
    while (e.data.length < want - values.length) e.data.push(0);
    for (const v of values) e.data.push(v);
  }

  build(tile = 1): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    const nv = this.pos.length / 3;
    const uv = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) {
      if (this.own[i]) {
        uv[i * 2] = this.uv[i * 2];
        uv[i * 2 + 1] = this.uv[i * 2 + 1];
        continue;
      }
      const x = this.pos[i * 3], y = this.pos[i * 3 + 1], z = this.pos[i * 3 + 2];
      const ax = Math.abs(this.nor[i * 3]), ay = Math.abs(this.nor[i * 3 + 1]), az = Math.abs(this.nor[i * 3 + 2]);
      if (ay > 0.7) {
        uv[i * 2] = x / tile;
        uv[i * 2 + 1] = z / tile;
      } else if (ax > az) {
        uv[i * 2] = z / tile;
        uv[i * 2 + 1] = y / tile;
      } else {
        uv[i * 2] = x / tile;
        uv[i * 2 + 1] = y / tile;
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.usesMR) g.setAttribute('mr', new THREE.Float32BufferAttribute(this.mr, 2));
    for (const [name, e] of Object.entries(this.extra)) {
      while (e.data.length < nv * e.size) e.data.push(0);
      g.setAttribute(name, new THREE.Float32BufferAttribute(e.data, e.size));
    }
    g.setIndex(nv > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  mesh(material: THREE.Material, tile = 1, opts: { cast?: boolean; receive?: boolean; name?: string } = {}) {
    const mesh = new THREE.Mesh(this.build(tile), material);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = opts.receive ?? true;
    mesh.matrixAutoUpdate = false;
    if (opts.name) mesh.name = opts.name;
    return mesh;
  }
}

/** 旋转体轮廓：[[半径, 高度], ...] */
export function lathe(profile: [number, number][], sides = 16) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg(sides, 4));
}

/** CanvasRenderingContext2D.roundRect 要 Chrome 99+：自己画一个 */
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function nextFrame() {
  return new Promise<void>((r) => requestAnimationFrame(() => r()));
}
