import * as THREE from 'three';
import './style.css';
import strings from '../content/strings.json';
import { atmo, env, patchFogChunks, setAtmosphereProfile, setDusk } from './core/atmosphere';
import { TimePanel } from './ui/time-panel';
import { clockLabel, seasonState, selectSeason, type Season } from './core/seasons';
import { colliders } from './world/collide';
import { MINI } from './core/env';
import { visibleBatches } from './minitool/visible-batches';
import { releaseGraphics } from './minitool/release-world';
import { activeVoyage, selectVoyage, type Voyage } from './destinations/catalog';
import { clamp, damp, DEG, lerp, nextFrame } from './core/util';
import { Post } from './post/post';
import { buildStages, type Part } from './world/build';
import { makeKit } from './world/materials';
import { Player, type Input, type Obstacle } from './world/player';
import { build as buildBoat, setPlayer } from './world/boat';
import { treePass } from './world/trees';
import { Sky, SkyEnvironment } from './world/sky';
import { Water, type WakeSource } from './world/water';
import { Hud } from './ui/hud';
import { Ambience } from './audio/ambience';

patchFogChunks();

// ───────────────────────── 画质档位 ─────────────────────────
const params = new URLSearchParams(location.search);
const num = (k: string, d: number) => (params.has(k) ? Number(params.get(k)) : d);
const coarse = matchMedia('(pointer: coarse)').matches;
interface Tier { tier: string; maxDpr: number; budget: number; msaa: number; refl: number; shadow: number; wake: number; trees: number; people: number }
const TIERS: Record<string, Tier> = {
  high: { tier: 'high', maxDpr: 2, budget: 2.3e6, msaa: 4, refl: 0.5, shadow: 2048, wake: 256, trees: 1, people: 1 },
  medium: { tier: 'medium', maxDpr: 1.5, budget: 1.5e6, msaa: 4, refl: 0.4, shadow: 1024, wake: 256, trees: 0.8, people: 0.8 },
  low: { tier: 'low', maxDpr: 1.25, budget: 0.9e6, msaa: 0, refl: 0.33, shadow: 0, wake: 0, trees: 0.55, people: 0.5 },
};
const miniTier: Tier = {tier: 'portable', maxDpr: 1.25, budget: 0.64e6, msaa: 0, refl: 0.30, shadow: 0, wake: 96, trees: 0.55, people: 0.5};
const Q = MINI ? miniTier : TIERS[params.get('q') ?? (coarse ? 'medium' : 'high')] ?? TIERS.high;

function fallback(kind: keyof typeof strings.fallback) {
  document.body.classList.add('fallback');
  const boot = document.getElementById('boot');
  const text = strings.fallback[kind];
  if (boot) {
    boot.classList.add('final');
    const s = boot.querySelector('.boot-status');
    if (s) s.textContent = text;
  } else document.getElementById('hud')!.innerHTML = `<p class="fallback-note">${text}</p>`;
}

const canvas = document.getElementById('stage') as HTMLCanvasElement;
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance' });
} catch (err) {
  fallback('nogl');
  throw err;
}
// 半浮点渲染目标（HDR、泛光、尾迹）要这两个扩展之一；没有就不硬撑
const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
if (!hdr) {
  fallback('nohdr');
  throw new Error('no float render targets');
}
renderer.toneMapping = THREE.NoToneMapping;
renderer.shadowMap.enabled = Q.shadow > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.setClearColor(0x000000, 0);
renderer.info.autoReset = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 1, 2); // 只是为了打开 USE_FOG；真正的雾在 atmosphere.ts
scene.environmentIntensity = 0.72; // 天光压一点，直射光和背光面的反差才出得来
const camera = new THREE.PerspectiveCamera(43, 1, 0.2, 14000);
camera.layers.enable(2); // 第 2 层：不进水面倒影的东西

const kit = makeKit();
const sky = new Sky(kit.noise);
scene.add(sky.mesh);
const skyEnv = new SkyEnvironment(renderer, kit.noise);
const water = new Water(kit.noise, kit.slope, Q.wake);
scene.add(water.mesh);
const post = new Post(Q.msaa);

// 太阳：一盏平行光 + 一张跟着船走的阴影贴图。太阳很低，所以阴影视锥是又宽又扁的一条。
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = Q.shadow > 0;
if (Q.shadow > 0) {
  sun.shadow.mapSize.set(Q.shadow, Q.shadow / 2);
  const c = sun.shadow.camera;
  c.left = -230; c.right = 230; c.bottom = -45; c.top = 75; c.near = 10; c.far = 2400;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.35;
  sun.shadow.radius = 2.5;
}
scene.add(sun, sun.target);

const player = new Player(activeVoyage.navigation);
scene.add(player.group);
setPlayer(player);

// ───────────────────────── 状态 ─────────────────────────
export const state = {
  started: false,
  time: 0,
  timeScale: 1,
  flow: true, // 时间是否在流动
  duskRate: MINI ? 1 / 300 : 1 / 420,
  duskTarget: -1, // ≥0 时：正在被拨到某个时刻
  paused: false,
  lost: false, // WebGL context 丢了
  stopped: false, // 兜底以后不再渲染
  renderScale: 1,
  fps: 60,
  fade: 0,
};
player.x = num('x', player.x);
player.z = num('z', player.z);
player.heading = num('hdg', 0) * DEG;
player.lookYaw = num('yaw', 0) * DEG;
player.lookPitch = num('pitch', 2) * DEG;
player.fov = player.fovTarget = num('fov', 43);
if (params.has('auto')) player.auto = params.get('auto') !== '0';
if (params.has('thr')) player.throttle = num('thr', 0.5);
if (params.has('speed')) player.speed = num('speed', 0);
selectSeason(params.get('season') ?? 'summer');
setAtmosphereProfile(activeVoyage);
setDusk(num('dusk', 0.03));
if (params.has('flow')) state.flow = params.get('flow') !== '0';
const manual = params.has('perf'); // ?perf：不跑 rAF，由 __openWaters.step(ms) 手动推进

const input: Input = { fwd: 0, turn: 0 };
const keys = new Set<string>();
let parts: Part[] = [];
const destination = MINI ? new THREE.Scene() : scene;
if (MINI) scene.add(destination);
let boatParts: Part[] = [];
let changingVoyage = false;
let leaveVoyage: (() => void) | undefined;
let obstacles: Obstacle[] = [];
const hud = new Hud(document.getElementById('hud')!, params.get('ui') === '0');
const audio = new Ambience(activeVoyage.citySounds ?? false);

// ───────────────────────── 尺寸 ─────────────────────────
let bufW = 0, bufH = 0, rtW = 0, rtH = 0, baseFov = 43;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (w < 2 || h < 2) return; // 页面隐藏时量到 0：等可见了再量
  const dpr = Math.min(window.devicePixelRatio || 1, Q.maxDpr, MINI ? Math.sqrt(1e6 / (w * h)) : Infinity);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  bufW = Math.floor(w * dpr);
  bufH = Math.floor(h * dpr);
  camera.aspect = w / h;
  if (!params.has('fov')) {
    // 竖屏时把竖向视场角放大，让横向至少有 ~38°，桥和两岸才放得下
    const want = (2 * Math.atan(Math.tan(17 * DEG) / Math.min(camera.aspect, 1))) / DEG;
    const next = clamp(want, 43, 60);
    player.fovTarget = clamp(player.fovTarget + (next - baseFov), 16, next + 14);
    player.fovMin = 16;
    player.fovMax = next + 14;
    if (!state.started) player.fov = player.fovTarget;
    baseFov = next;
  }
  camera.updateProjectionMatrix();
  applyScale();
}
function applyScale(force = false) {
  // 画布保持原生分辨率（颗粒是按屏幕像素撒的），内部渲染分辨率按预算和帧率缩放
  const fit = Math.min(1, Math.sqrt(Q.budget / (bufW * bufH)));
  const s = fit * state.renderScale;
  const w = Math.max(64, Math.round(bufW * s)), h = Math.max(64, Math.round(bufH * s));
  if (!force && w === rtW && h === rtH) return;
  rtW = w;
  rtH = h;
  post.setSize(w, h);
  water.setSize(w, h, Q.refl);
}
window.addEventListener('resize', resize);
resize();

// ───────────────────────── 输入 ─────────────────────────
window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (e.metaKey || e.ctrlKey || target.closest('input, select, dialog, .time-panel')) return;
  if (target.closest('button, a') && ['Enter', ' '].includes(e.key)) return;
  if (e.repeat && [' ', 't', 'm', 'h', 'c'].includes(e.key.toLowerCase())) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!state.started) {
    if (document.body.classList.contains('ready') && (k === 'enter' || k === ' ')) begin();
    return;
  }
  if (k === ' ') {
    toggleCruise();
    e.preventDefault();
  } else if (k === 't') {
    toggleFlow();
    hud.toast(state.flow ? 'flow_on' : 'flow_off');
  } else if (k === 'm') {
    hud.toast(audio.toggleMute() ? 'mute_on' : 'mute_off');
  } else if (k === 'h') hud.toggleHidden();
  else if (k === 'c') document.body.classList.toggle('cine');
  else if (k === 'r') {
    player.lookYaw = 0;
    player.lookPitch = 2 * DEG;
    player.fovTarget = baseFov;
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); padFwd = padTurn = 0; });
window.addEventListener('focusin', e => { if ((e.target as HTMLElement).closest('dialog, .time-panel')) { keys.clear(); padFwd = padTurn = 0; } });

let dragging = false, lastX = 0, lastY = 0, pinch = 0;
const pointers = new Map<number, { x: number; y: number }>();
canvas.addEventListener('pointerdown', (e) => {
  if (!state.started) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  document.body.classList.add('dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging || !pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = Array.from(pointers.values());
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) player.zoom((pinch - d) * 0.08);
    pinch = d;
    return;
  }
  const k = (player.fov * DEG) / window.innerHeight; // 拖过一屏高 ≈ 转过一个视场角
  player.look((e.clientX - lastX) * k * 1.15, (e.clientY - lastY) * k * 1.15);
  lastX = e.clientX;
  lastY = e.clientY;
});
const endDrag = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
  if (pointers.size === 0) {
    dragging = false;
    document.body.classList.remove('dragging');
  } else {
    const p = Array.from(pointers.values())[0];
    lastX = p.x;
    lastY = p.y;
  }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  if (!state.started) return;
  e.preventDefault();
  player.zoom(clamp(e.deltaY, -60, 60) * 0.03);
}, { passive: false });
hud.onPad = (fwd, turn) => {
  padFwd = fwd;
  padTurn = turn;
};
let padFwd = 0, padTurn = 0;

function readInput() {
  const has = (...k: string[]) => k.some((x) => keys.has(x));
  input.fwd = (has('w', 'arrowup') ? 1 : 0) - (has('s', 'arrowdown') ? 1 : 0) + padFwd;
  input.turn = (has('a', 'arrowleft') ? 1 : 0) - (has('d', 'arrowright') ? 1 : 0) + padTurn;
  if (has(']')) scrubDusk(env.dusk + 0.004);
  if (has('[')) scrubDusk(env.dusk - 0.004);
}

// ───────────────────────── 每一帧 ─────────────────────────
const Lr = new THREE.Vector3(), Lu = new THREE.Vector3(), focus = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const shadowDir = new THREE.Vector3();
let shadowTick = 0;
function updateSun() {
  sun.color.copy(env.sunLight);
  sun.intensity = env.sunIntensity;
  const on = Q.shadow > 0 && env.sunIntensity > 0.02;
  sun.castShadow = on;
  if (!on) {
    sun.position.copy(env.sunDir).multiplyScalar(1500);
    sun.target.position.set(0, 0, 0);
    return;
  }
  // 阴影用的太阳不能太贴地平线，否则影子长到没有意义
  shadowDir.copy(env.sunDir);
  shadowDir.y = Math.max(shadowDir.y, Math.sin(2.2 * DEG));
  shadowDir.normalize();
  // 阴影视锥跟着相机走，但按阴影贴图的像素取整，影子的边才不会游动
  Lr.crossVectors(up, shadowDir).normalize();
  Lu.crossVectors(shadowDir, Lr).normalize();
  const tx = 460 / Math.max(Q.shadow, 1), ty = 120 / Math.max(Q.shadow / 2, 1);
  focus.set(camera.position.x, 0, camera.position.z).addScaledVector(player.forward3, 60);
  const cx = Math.round(focus.dot(Lr) / tx) * tx, cy = Math.round(focus.dot(Lu) / ty) * ty, cz = focus.dot(shadowDir);
  sun.target.position.set(0, 0, 0).addScaledVector(Lr, cx).addScaledVector(Lu, cy).addScaledVector(shadowDir, cz);
  sun.position.copy(sun.target.position).addScaledVector(shadowDir, 1500);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
}

const wakeSources: WakeSource[] = [];
const fwd2 = new THREE.Vector2();
function update(dt: number) {
  state.time += dt;
  const t = state.time;
  atmo.uTime.value = t;
  readInput();
  if (state.duskTarget >= 0) {
    // 被拨到某个时刻：三秒左右缓缓过去
    const d = state.duskTarget - env.dusk;
    if (Math.abs(d) < 0.002) {
      setDusk(state.duskTarget);
      state.duskTarget = -1;
    } else setDusk(env.dusk + Math.sign(d) * Math.min(Math.abs(d), Math.max(0.0015, Math.abs(d) * 2.2 * dt)));
  } else if (state.started && state.flow) {
    setDusk(env.dusk + dt * state.duskRate * state.timeScale);
    if (env.dusk >= 1) state.flow = false;
  }

  // 移动物体先走，再解玩家碰撞，避免渲染那一帧游船又进入船体。
  for (const p of parts) if (p.boats) p.update?.(dt, t, camera);
  player.update(state.started ? dt : 0, t, input, obstacles);
  player.applyCamera(camera, t);
  for (const p of parts) if (!p.boats) p.update?.(dt, t, camera);

  // 别的船：尾波进水面着色器；离得近时把我们的船晃几下
  const boats = water.uniforms.uBoats.value as THREE.Vector4[];
  let bi = 0;
  for (const p of parts)
    for (const b of p.boats ?? []) {
      if (bi < 4) boats[bi++].set(b.x, b.z, b.heading, b.speed > 0.3 ? clamp(b.length / 30, 0.3, 1.6) : 0);
      const dx = player.x - b.x, dz = player.z - b.z;
      const bf = -Math.sin(b.heading) * dx + -Math.cos(b.heading) * dz; // 我们在它前方多远
      const lat = Math.abs(Math.cos(b.heading) * dx - Math.sin(b.heading) * dz);
      if (b.speed > 0.5 && bf < -4 && bf > -90 && Math.abs(lat - -bf * 0.354) < 5) player.kick = Math.max(player.kick, clamp(b.length / 45, 0.2, 1) * (1 - -bf / 110));
    }
  for (; bi < 4; bi++) boats[bi].set(0, 0, 0, 0);

  // 自己船的尾迹：船头把水推开，船尾留下一道被搅动的水
  const f = fwd2.copy(player.forward);
  const sp = player.speed;
  wakeSources.length = 0;
  const push = clamp(Math.abs(sp), 0, 3.4) * 0.0016;
  wakeSources.push({ x: player.x + f.x * 3.1, z: player.z + f.y * 3.1, radius: 0.55, strength: push, foam: 0 });
  wakeSources.push({ x: player.x - f.x * 2.3, z: player.z - f.y * 2.3, radius: 0.7, strength: -push * 0.55, foam: Math.abs(sp) * 0.005 });
  wakeSources.push({ x: player.x + f.x * 0.4 + f.y * 0.95, z: player.z + f.y * 0.4 - f.x * 0.95, radius: 0.4, strength: Math.sin(t * 1.7) * 0.0007, foam: 0 });
  wakeSources.push({ x: player.x + f.x * 0.4 - f.y * 0.95, z: player.z + f.y * 0.4 + f.x * 0.95, radius: 0.4, strength: Math.sin(t * 1.7 + 2) * 0.0007, foam: 0 });

  // 桥洞
  const shade = activeVoyage.bridgeShade;
  const under = shade && Math.abs(player.z - shade.z) < shade.halfSpan;
  player.underBridge = damp(player.underBridge, under ? 1 : 0, 3, dt);

  sky.update();
  hud.update(dt, { dusk: env.dusk, x: player.x, z: player.z, speed: player.speed, throttle: player.throttle, auto: player.auto, flow: state.flow, atEnd: player.atEnd, started: state.started });
  audio.update(dt, { speed: player.speed, throttle: player.throttle, dusk: env.dusk, under: player.underBridge, x: player.x, z: player.z, kick: player.kick, facing: player.heading + player.lookYaw, parts });
  for (const fn of tickers) fn(dt);
}

function render() {
  renderer.info.reset();
  skyEnv.update(scene);
  updateSun();
  water.stepWake(renderer, player.x, player.z, wakeSources, 1 / 60, Math.abs(player.speed));
  const shade = activeVoyage.bridgeShade;
  water.uniforms.uShade.value.set(shade?.z ?? 0, shade?.halfSpan ?? 1, shade ? 0.85 : 0, 0);
  treePass.value = 0;
  const liveReflection = !MINI || state.renderScale > .66;
  water.uniforms.uLiveReflection.value = liveReflection ? 1 : 0;
  if (liveReflection) water.renderReflection(renderer, scene, camera, sky.uniforms.uSunDisc);
  treePass.value = 1;
  if (sun.castShadow && shadowTick++ % 2 === 0) renderer.shadowMap.needsUpdate = true;
  renderer.setRenderTarget(post.scene);
  renderer.clear();
  renderer.render(scene, camera);
  state.fade = params.get('ui') === '0' ? 1 : damp(state.fade, 1, 1.2, 1 / 60);
  post.mFinal.uniforms.uFade.value = state.fade;
  post.render(renderer, state.time, env.exposure, bufW, bufH, !MINI || state.renderScale > .76);
}

// 帧率自适应：只缩放内部渲染分辨率，不动画布（动画布会清空画面）。
let slow = 0, fast = 0, warm = 0;
function adapt(dt: number) {
  state.fps = damp(state.fps, 1 / Math.max(dt, 1e-3), 1.5, dt);
  if (!state.started || manual) return;
  if (MINI && state.renderScale <= 0.61 && state.fps < 15 && slow > 2.3) {
    state.stopped = true; audio.setSuspended(true); fallback('slow'); return;
  }
  warm += dt;
  if (warm < 3) return; // 刚开始那几秒在编译着色器、上传贴图，不算
  const lo = MINI ? 30 : 44;
  if (state.fps < lo) slow += dt; else slow = 0;
  if (state.fps > 57) fast += dt; else fast = 0;
  const minScale = 0.6;
  if (slow > 2.5) {
    slow = 0;
    if (state.renderScale > minScale + 0.01) {
      state.renderScale = Math.max(minScale, state.renderScale * 0.88);
      applyScale();
    }
  } else if (fast > 8) {
    fast = 0;
    if (state.renderScale < 1) {
      state.renderScale = Math.min(1, state.renderScale * 1.07);
      applyScale();
    }
  }
}

let last = performance.now();
let animation = 0;
function schedule() {
  if (!manual && !animation && !state.stopped && !state.paused && !state.lost) animation = requestAnimationFrame(frame);
}
function frame(now: number) {
  animation = 0;
  schedule();
  if (state.paused || state.lost || state.stopped || changingVoyage) {
    last = now;
    return;
  }
  const elapsed = (now - last) / 1000;
  const dt = Math.min(elapsed, 0.05);
  last = now;
  update(dt);
  render();
  adapt(Math.max(elapsed, 0.001));
}
document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden;
  audio.setSuspended(document.hidden);
  if (document.hidden) {
    cancelAnimationFrame(animation);
    animation = 0;
  } else {
    schedule();
    last = performance.now(); // 回来时不补算
    slow = fast = 0;
    resize();
  }
});

// context 丢了：停下来等恢复；恢复后降一档重画；第二次丢就不再重建，留海报
let lostCount = 0;
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  state.lost = true;
  if (MINI) {
    audio.setSuspended(true);
    cancelAnimationFrame(animation);
    animation = 0;
    releaseGraphics(scene);
    renderer.renderLists.dispose();
    post.setSize(2,2);
    water.rt.setSize(2,2);
    water.wake?.releaseTargets();
    skyEnv.releaseTargets();
    scene.environment = null;
  }
  lostCount++;
  document.body.classList.add('gl-lost');
  if (lostCount >= 2) {
    state.stopped = true;
    fallback('lost');
  }
});
canvas.addEventListener('webglcontextrestored', () => {
  if (state.stopped) return;
  document.body.classList.remove('gl-lost');
  if (MINI) state.renderScale = Math.max(0.6, state.renderScale * 0.8);
  applyScale(true);
  skyEnv.update(scene, true);
  state.lost = false;
  if (MINI && !document.hidden) audio.setSuspended(false);
  schedule();
});

function begin() {
  if (state.started) return;
  state.started = true;
  hud.begin();
  audio.start();
  for (const fn of beginners) fn();
}
hud.onBegin = begin;

function toggleCruise() {
  player.auto = !player.auto;
  if (player.auto && player.throttle < 0.1) player.throttle = 0.5;
  hud.toast(player.auto ? 'auto_on' : 'auto_off');
}
hud.onToggleCruise = toggleCruise;

// Browsers may suspend audio when a voyage is opened via a direct link.
window.addEventListener('pointerdown', () => { if (state.started) audio.setSuspended(false); });

// ───────────────────────── 拍照 ─────────────────────────
/**
 * 临时把画布放大到长边约 longSide 像素，满分辨率渲一帧，立刻拷进 2D 画布（同一个任务里拷，
 * 不用 preserveDrawingBuffer），再缩回去。返回那张 2D 画布。
 */
function capture(longSide = 1600) {
  const w = window.innerWidth, h = window.innerHeight;
  const requested = clamp(longSide / Math.max(w, h), MINI ? .1 : 1, 3);
  const dpr = MINI ? Math.min(requested, Math.sqrt(1e6 / (w*h))) : requested;
  try {
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
    bufW = Math.floor(w * dpr);
    bufH = Math.floor(h * dpr);
    post.setSize(bufW, bufH);
    water.setSize(bufW, bufH, Q.refl);
    render();
    const out = document.createElement('canvas');
    out.width = bufW;
    out.height = bufH;
    out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    return out;
  } finally {
    resize();
    applyScale(true);
    if (MINI) render();
  }
}

function scrubDusk(d: number) {
  if (!Number.isFinite(d)) return;
  state.flow = false;
  state.duskTarget = -1;
  setDusk(d);
}
function toggleFlow() {
  state.duskTarget = -1;
  state.flow = !state.flow;
  if (state.flow && env.dusk >= 1) setDusk(0);
}
function changeSeason(s: Season) {
  selectSeason(s);
  setDusk(env.dusk);
  renderer.shadowMap.needsUpdate = true;
}

// ───────────────────────── 对外 ─────────────────────────
const tickers: ((dt: number) => void)[] = [];
const beginners: (() => void)[] = [];
let readyResolve: () => void = () => {};
const ready = new Promise<void>((r) => (readyResolve = r));

/** Controls shared by the HUD and the preview tools. */
export const api = {
  state, player, env, camera, renderer, hud, audio, strings,
  ready,
  get tier() {
    return Q.tier;
  },
  get dusk() {
    return env.dusk;
  },
  scrubDusk, toggleFlow, setSeason: changeSeason,
  goToDusk(d: number) {
    if (!Number.isFinite(d)) return;
    state.flow = false;
    state.duskTarget = clamp(d, 0, 1);
  },
  look(dYaw: number, dPitch: number) {
    player.look(-dYaw, -dPitch);
  },
  capture,
  onTick(fn: (dt: number) => void) {
    tickers.push(fn);
  },
  onBegin(fn: () => void) {
    if (state.started) fn();
    else beginners.push(fn);
  },
  begin,
  switchVoyage,
  get baseFov() {
    return baseFov;
  },
  lerp,
};

new TimePanel(api, document.querySelector('.clock')!, document.getElementById('hud')!);

declare global {
  interface Window {
    __openWaters: any;
    render_game_to_text: () => string;
    advanceTime: (ms: number) => void;
  }
}

async function switchVoyage(voyage: Voyage) {
  if (!MINI || changingVoyage || voyage === activeVoyage || state.stopped || state.lost) return;
  changingVoyage = true;
  try {
    const route = await voyage.loadWorld();
    parts = [];
    obstacles = [];
    colliders.length = 0;
    leaveVoyage?.();
    leaveVoyage = route.release;
    water.wake?.releaseTargets();
    releaseGraphics(destination, player.group, kit);
    destination.clear();
    selectVoyage(voyage);
    setAtmosphereProfile(voyage);
    audio.changeLocation(!!voyage.citySounds);
    player.startAt(voyage.navigation);
    player.fov = player.fovTarget = baseFov;
    keys.clear();
    padFwd = padTurn = 0;
    setDusk(env.dusk);
    parts = await route.build({scene: destination, kit, quality: Q, playerGroup: player.group}, async () => { await nextFrame(); });
    parts.push(visibleBatches(destination), ...boatParts);
    obstacles = parts.reduce<Obstacle[]>((items, p) => items.concat(p.obstacles ?? []), []);
    window.__openWaters.parts = parts;
    skyEnv.update(scene, true);
    renderer.shadowMap.needsUpdate = true;
    state.fade = 0.75;
    update(0);
    render();
  } catch (error) {
    state.stopped = true;
    fallback('lost');
    throw error;
  } finally {
    changingVoyage = false;
    last = performance.now();
  }
}

async function boot() {
  update(0);
  render();
  const ctx = { scene: destination, kit, quality: Q, playerGroup: player.group };
  const progress = async (label: string, p: number) => {
    hud.progress(label, p);
    await nextFrame();
  };
  const route = await activeVoyage.loadWorld();
  if (MINI) leaveVoyage = route.release;
  parts = await route.build(ctx, (label, p) => progress(label, p * 0.9));
  boatParts = await buildStages({ ...ctx, scene }, (label, p) => progress(label, 0.9 + p * 0.1), [['boat', buildBoat]]);
  if (MINI) parts.push(visibleBatches(destination));
  parts.push(...boatParts);
  obstacles = parts.reduce<Obstacle[]>((items, p) => items.concat(p.obstacles ?? []), []);
  skyEnv.update(scene, true);
  renderer.shadowMap.needsUpdate = true;
  // 先在后台把一帧画完（着色器在这时编译），开场画面就不会卡一下
  update(1 / 60);
  render();
  hud.ready();
  document.body.classList.add('ready');
  window.__openWaters = {
    state, player, env, camera, scene, renderer, water, post, sun, parts, api, colliders,
    get Q() {
      return Q;
    },
    setDusk,
    step(ms = 16.7) {
      const n = Math.max(1, Math.round(ms / 16.7));
      for (let i = 0; i < n; i++) update(ms / n / 1000);
      render();
    },
    begin,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, fps: Math.round(state.fps), scale: state.renderScale, tier: Q.tier, rt: [rtW, rtH], buf: [bufW, bufH], programs: renderer.info.programs?.length }),
    ready: true,
  };
  window.render_game_to_text = () => JSON.stringify({
    voyage: activeVoyage.id, coordinates: 'metres; +Y up; heading 0 faces -Z',
    started: state.started, player: { x: player.x, z: player.z, heading: player.heading, speed: player.speed, auto: player.auto },
    time: { dusk: env.dusk, target: state.duskTarget, clock: clockLabel(env.dusk), flow: state.flow, scale: state.timeScale, season: seasonState.current },
    nearby: colliders.filter(c => Math.hypot(c.x - player.x, c.z - player.z) < 60),
  });
  window.advanceTime = ms => window.__openWaters.step(ms);
  readyResolve();
  if (params.get('ui') === '0' || params.has('go')) begin();
  if (manual) {
    update(1 / 60);
    render();
  } else schedule();
}
if (MINI) renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
  console.error('WebGL shader',gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment));
  state.stopped = true;
  audio.setSuspended(true);
  fallback('nogl');
};
boot().catch((err) => {
  console.error(err);
  hud.fail(String(err?.message ?? err));
});
