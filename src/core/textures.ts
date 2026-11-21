import * as THREE from 'three';
import { rng, roundRect } from './util';
import { LIGHT_GEOMETRY } from './env';

/**
 * 所有贴图都在浏览器里现算：没有一张下载的图片。
 * 好处是整包很小、风格统一、没有版权问题；代价是开场多算一秒。
 */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

function finish(tex: THREE.Texture, srgb: boolean, aniso = 8) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = aniso;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 高度图（0..1）→ 切线空间法线贴图，四周按可平铺处理 */
function normalFromHeight(h: Float32Array, w: number, ht: number, strength: number) {
  const out = new Uint8Array(w * ht * 4);
  for (let y = 0; y < ht; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + ht) % ht, yd = (y + 1) % ht;
      const dx = (h[y * w + xr] - h[y * w + xl]) * strength;
      const dy = (h[yd * w + x] - h[yu * w + x]) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255;
      out[i + 1] = (dy * inv * 0.5 + 0.5) * 255; // canvas 的 y 朝下，贴图 flipY 后朝上
      out[i + 2] = (inv * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const [c, g] = canvas(w, ht);
  g.putImageData(new ImageData(new Uint8ClampedArray(out.buffer), w, ht), 0, 0);
  return finish(new THREE.CanvasTexture(c), false);
}

function grayOf(g: CanvasRenderingContext2D, w: number, h: number) {
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i * 4] / 255;
  return out;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const r = rng(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount * 255;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.9;
  }
  g.putImageData(img, 0, 0);
}

// ───────────────────────── 噪声 ─────────────────────────

/** 256² 可平铺的平滑噪声，四个通道四套种子。着色器里的云、水面静区、污渍都靠它 */
export function makeNoiseTexture() {
  const N = 256, L = 32;
  const data = new Uint8Array(N * N * 4);
  for (let ch = 0; ch < 4; ch++) {
    const r = rng(1000 + ch * 77);
    const lat = new Float32Array(L * L);
    for (let i = 0; i < L * L; i++) lat[i] = r();
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const fx = (x / N) * L, fy = (y / N) * L;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0;
        tx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        ty = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
        const x1 = (x0 + 1) % L, y1 = (y0 + 1) % L;
        const a = lat[y0 * L + x0], b = lat[y0 * L + x1], c = lat[y1 * L + x0], d = lat[y1 * L + x1];
        data[(y * N + x) * 4 + ch] = (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty) * 255;
      }
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  return finish(t, false, 4);
}

// ───────────────────────── 水面坡度 ─────────────────────────

/**
 * 水面坡度贴图（半浮点，自带 mip）：
 * RG = 坡度（已归一到均方根 1），B = 坡度平方和，A = 高度。
 * B 通道在 mip 里被平均后就是 E[s²]，和 RG 的平均值一减得到「这个像素里看不见的波有多乱」，
 * 远处的倒影拉丝和碎金宽度都从这个方差来（LEAN mapping 的思路）。
 */
export function makeWaterSlopeTexture() {
  const N = 256;
  const r = rng(4242);
  const waves: { kx: number; kz: number; a: number; ph: number }[] = [];
  for (let i = 0; i < 64; i++) {
    const mag = 2 + Math.pow(r(), 1.6) * 34;
    const ang = r() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * mag), kz = Math.round(Math.sin(ang) * mag);
    if (kx === 0 && kz === 0) continue;
    waves.push({ kx, kz, a: Math.pow(Math.hypot(kx, kz), -1.25) * (0.5 + r()), ph: r() * Math.PI * 2 });
  }
  const sx = new Float32Array(N * N), sz = new Float32Array(N * N), hh = new Float32Array(N * N);
  const TAU = Math.PI * 2, SH = 0.85;
  let sum = 0, hmax = 0;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0, dz = 0, h = 0;
      const u = x / N, v = y / N;
      for (const w of waves) {
        const th = TAU * (w.kx * u + w.kz * v) + w.ph;
        const e = Math.exp(SH * Math.sin(th)); // 波峰略尖、波谷略平
        const d = w.a * SH * Math.cos(th) * e * TAU;
        dx += d * w.kx;
        dz += d * w.kz;
        h += w.a * e;
      }
      const i = y * N + x;
      sx[i] = dx;
      sz[i] = dz;
      hh[i] = h;
      sum += dx * dx + dz * dz;
      hmax = Math.max(hmax, Math.abs(h));
    }
  }
  const rms = Math.sqrt(sum / (N * N));
  let level = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const a = sx[i] / rms, b = sz[i] / rms;
    level[i * 4] = a;
    level[i * 4 + 1] = b;
    level[i * 4 + 2] = a * a + b * b;
    level[i * 4 + 3] = hh[i] / hmax;
  }
  const toHalf = (f: Float32Array) => {
    const o = new Uint16Array(f.length);
    for (let i = 0; i < f.length; i++) o[i] = THREE.DataUtils.toHalfFloat(f[i]);
    return o;
  };
  const tex = new THREE.DataTexture(toHalf(level), N, N, THREE.RGBAFormat, THREE.HalfFloatType);
  const mips: any[] = [{ data: tex.image.data, width: N, height: N }];
  let size = N;
  while (size > 1) {
    const half = size >> 1;
    const next = new Float32Array(half * half * 4);
    for (let y = 0; y < half; y++)
      for (let x = 0; x < half; x++)
        for (let c = 0; c < 4; c++) {
          const a = level[((y * 2) * size + x * 2) * 4 + c], b = level[((y * 2) * size + x * 2 + 1) * 4 + c];
          const d = level[((y * 2 + 1) * size + x * 2) * 4 + c], e = level[((y * 2 + 1) * size + x * 2 + 1) * 4 + c];
          next[(y * half + x) * 4 + c] = (a + b + d + e) * 0.25;
        }
    mips.push({ data: toHalf(next), width: half, height: half });
    level = next;
    size = half;
  }
  tex.mipmaps = mips;
  tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

// ───────────────────────── 石材 ─────────────────────────

/** 巴黎石灰岩方石墙（8 m × 8 m 一铺）：蜂蜜色，每块石头略有深浅，带灰缝和雨痕 */
export function makeStoneTextures() {
  const S = LIGHT_GEOMETRY ? 768 : 1024, ROWS = 16;
  const r = rng(77);
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = '#b3a384';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, S, S);
  const rh = S / ROWS;
  for (let row = 0; row < ROWS; row++) {
    const cuts: number[] = [];
    let x = r() * 60;
    while (x < S) {
      cuts.push(x);
      x += 96 + r() * 110;
    }
    for (let i = 0; i < cuts.length; i++) {
      const x0 = cuts[i], x1 = i + 1 < cuts.length ? cuts[i + 1] : cuts[0] + S;
      const hue = 37 + (r() - 0.5) * 7;
      const sat = 31 + (r() - 0.5) * 10;
      let lig = 70 + (r() - 0.5) * 5.5;
      if (r() < 0.1) lig -= 5; // 老石头
      if (r() < 0.08) lig += 3.5; // 后补的新石头
      const raise = 0.72 + r() * 0.22;
      for (const off of [0, -S]) {
        g.fillStyle = `hsl(${hue} ${sat}% ${lig}%)`;
        g.fillRect(x0 + off + 1.5, row * rh + 1.5, x1 - x0 - 3, rh - 3);
        hg.fillStyle = `rgb(${raise * 255},${raise * 255},${raise * 255})`;
        hg.fillRect(x0 + off + 3, row * rh + 3, x1 - x0 - 6, rh - 6);
      }
    }
  }
  // 雨痕：竖直的深色条
  for (let i = 0; i < 46; i++) {
    const x = r() * S, w = 6 + r() * 40, y = r() * S * 0.5, len = S * (0.25 + r() * 0.6);
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, `rgba(70,58,44,${0.05 + r() * 0.1})`);
    grd.addColorStop(1, 'rgba(70,58,44,0)');
    g.fillStyle = grd;
    for (const off of [0, -S, S]) g.fillRect(x + off, y, w, len);
  }
  // 大块的明暗不匀
  for (let i = 0; i < 26; i++) {
    const x = r() * S, y = r() * S, rad = 60 + r() * 160;
    const dark = r() < 0.6;
    for (const ox of [0, -S, S])
      for (const oy of [0, -S, S]) {
        const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
        grd.addColorStop(0, dark ? 'rgba(80,66,50,0.10)' : 'rgba(255,240,214,0.08)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x + ox - rad, y + oy - rad, rad * 2, rad * 2);
      }
  }
  speckle(g, S, S, 0.07, 5);
  // 高度：把缝抹软一点，再加石面的细颗粒
  hg.filter = 'blur(1.6px)';
  hg.drawImage(hc, 0, 0);
  hg.filter = 'none';
  const h = grayOf(hg, S, S);
  const rr = rng(9);
  for (let i = 0; i < h.length; i++) h[i] += (rr() - 0.5) * 0.06;
  return { map: finish(new THREE.CanvasTexture(c), true), normalMap: normalFromHeight(h, S, S, 2.6) };
}

/** 码头的铺石（3 m 一铺） */
export function makeCobbleTextures() {
  const S = 512;
  const r = rng(321);
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  g.fillStyle = '#4c453c';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, S, S);
  const ROWS = 18, rh = S / ROWS;
  for (let row = 0; row < ROWS; row++) {
    let x = -r() * 30;
    while (x < S) {
      const w = 22 + r() * 16;
      const lig = 50 + (r() - 0.5) * 16, hue = 34 + (r() - 0.5) * 16, sat = 9 + r() * 10;
      for (const off of [0, S]) {
        g.fillStyle = `hsl(${hue} ${sat}% ${lig}%)`;
        g.beginPath();
        roundRect(g, x + off + 1.2, row * rh + 1.2, w - 2.4, rh - 2.4, 3.5);
        g.fill();
        hg.fillStyle = '#fff';
        hg.beginPath();
        roundRect(hg, x + off + 2.5, row * rh + 2.5, w - 5, rh - 5, 4);
        hg.fill();
      }
      x += w;
    }
  }
  speckle(g, S, S, 0.09, 12);
  hg.filter = 'blur(2.2px)';
  hg.drawImage(hc, 0, 0);
  hg.filter = 'none';
  const h = grayOf(hg, S, S);
  return { map: finish(new THREE.CanvasTexture(c), true), normalMap: normalFromHeight(h, S, S, 3.2) };
}

// ───────────────────────── 木头 ─────────────────────────

/**
 * 上过清漆的桃花心木。seams=true 时是老式游艇的甲板：窄木条之间嵌一道浅色的缝。
 * 纹理沿 V 方向（船头—船尾）。
 */
export function makeWoodTexture(opts: { seams: boolean; planks: number; base: [number, number, number]; seed: number; gap?: string; size?: number }) {
  const S = opts.size ?? 1024;
  const r = rng(opts.seed);
  const [c, g] = canvas(S, S);
  const [h0, s0, l0] = opts.base;
  const pw = S / opts.planks;
  for (let p = 0; p < opts.planks; p++) {
    const lig = l0 + (r() - 0.5) * 7, hue = h0 + (r() - 0.5) * 5;
    g.fillStyle = `hsl(${hue} ${s0}% ${lig}%)`;
    g.fillRect(p * pw, 0, pw + 1, S);
    // 木纹：很多条细长的、略微摆动的线
    for (let k = 0; k < 46; k++) {
      const x = p * pw + r() * pw;
      const dark = r() < 0.7;
      g.strokeStyle = dark ? `hsla(${hue - 6} ${s0 + 8}% ${lig - 12 - r() * 10}% / ${0.1 + r() * 0.22})` : `hsla(${hue + 6} ${s0}% ${lig + 10}% / ${0.06 + r() * 0.12})`;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      const amp = 1 + r() * 3, fr = 2 + r() * 5, ph = r() * 6.28;
      for (let y = -8; y <= S + 8; y += 16) {
        const xx = x + Math.sin((y / S) * Math.PI * 2 * Math.round(fr) + ph) * amp;
        if (y === -8) g.moveTo(xx, y);
        else g.lineTo(xx, y);
      }
      g.stroke();
    }
  }
  if (opts.seams) {
    g.fillStyle = opts.gap ?? '#e6d7b4';
    for (let p = 0; p < opts.planks; p++) g.fillRect(p * pw - 2, 0, 4, S);
    g.fillRect(S - 2, 0, 2, S);
  }
  speckle(g, S, S, 0.025, opts.seed + 1);
  return finish(new THREE.CanvasTexture(c), true, 16);
}

// ───────────────────────── 树叶 ─────────────────────────

/**
 * 一小簇叶子的剪影（树冠由几十张这样的面片堆成）。
 * R = 每片叶子的明暗，G = 偏黄的程度，A = 形状。透明处的 RG 填平均值，避免缩小后出现黑边。
 */
export function makeFoliageTexture() {
  const N = 512;
  const r = rng(555);
  const data = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    data[i * 4] = 170;
    data[i * 4 + 1] = 110;
  }
  // 先定几个小团，叶子围着小团长，整簇的外形才不是一个圆饼
  const clumps: [number, number, number][] = [];
  for (let i = 0; i < 15; i++) {
    const a = r() * 6.283, d = Math.pow(r(), 0.7) * 0.34;
    clumps.push([0.5 + Math.cos(a) * d, 0.5 + Math.sin(a) * d, 0.07 + r() * 0.09]);
  }
  for (let k = 0; k < 1150; k++) {
    const c = clumps[Math.floor(r() * clumps.length)];
    const rad = Math.pow(r(), 0.75) * c[2], ang = r() * 6.283;
    const cx = c[0] + Math.cos(ang) * rad, cy = c[1] + Math.sin(ang) * rad;
    const a = 0.012 + r() * 0.015, b = a * (0.45 + r() * 0.25), rot = r() * 6.283;
    const br = 95 + r() * 160, ye = r() * 255;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const x0 = Math.max(0, Math.floor((cx - a) * N)), x1 = Math.min(N - 1, Math.ceil((cx + a) * N));
    const y0 = Math.max(0, Math.floor((cy - a) * N)), y1 = Math.min(N - 1, Math.ceil((cy + a) * N));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x / N - cx, dy = y / N - cy;
        const u = (dx * cs + dy * sn) / a, v = (-dx * sn + dy * cs) / b;
        const d = u * u + v * v * (1 + 0.9 * Math.max(u, 0));
        if (d < 1) {
          const i = (y * N + x) * 4;
          data[i] = br * (0.8 + 0.2 * (1 - Math.abs(v)));
          data[i + 1] = ye;
          data[i + 3] = 255;
        }
      }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ───────────────────────── 铁塔的格构 ─────────────────────────

export function makeLatticeTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#fff';
  g.lineCap = 'square';
  // 两侧的主弦杆
  g.lineWidth = 30;
  g.beginPath();
  g.moveTo(8, 0); g.lineTo(8, S);
  g.moveTo(S - 8, 0); g.lineTo(S - 8, S);
  g.stroke();
  // 横杆
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(0, 4); g.lineTo(S, 4);
  g.moveTo(0, S / 2); g.lineTo(S, S / 2);
  g.moveTo(0, S - 4); g.lineTo(S, S - 4);
  g.stroke();
  // 交叉斜撑
  g.lineWidth = 11;
  g.beginPath();
  for (const y of [0, S / 2]) {
    g.moveTo(8, y); g.lineTo(S - 8, y + S / 2);
    g.moveTo(S - 8, y); g.lineTo(8, y + S / 2);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  finish(t, false, 8);
  return t;
}

/** 灯的光晕 */
export function makeGlowTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.08, 'rgba(255,255,255,0.75)');
  grd.addColorStop(0.22, 'rgba(255,255,255,0.26)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

/** 柳条篮子的编织纹 */
export function makeWickerTexture() {
  const S = 128;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#7a5a34';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const on = (x + y) % 2 === 0;
      g.fillStyle = on ? '#b58e56' : '#94703f';
      g.fillRect(x * 16 + 1, y * 16 + (on ? 2 : 5), 14, on ? 12 : 6);
    }
  return finish(new THREE.CanvasTexture(c), true, 4);
}
