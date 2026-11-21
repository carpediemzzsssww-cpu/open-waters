import { clockLabel, seasonState, SEASONS } from '../core/seasons';
import { activeVoyage, voyages } from '../destinations/catalog';
import strings from '../../content/strings.json';

interface HudState {
  dusk: number;
  x: number;
  z: number;
  speed: number;
  throttle: number;
  auto: boolean;
  flow: boolean;
  atEnd: number;
  started: boolean;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function voyageLinks(sailing: boolean) {
  const nav = element('nav', 'voyage-links');
  nav.setAttribute('aria-label', '选择航区');
  for (const v of voyages) {
    const url = new URL(window.location.href);
    url.searchParams.set('voyage', v.id);
    for (const key of ['x', 'z', 'yaw', 'pitch', 'fov', 'thr', 'only']) url.searchParams.delete(key);
    if (sailing) url.searchParams.set('go', '1');
    else url.searchParams.delete('go');
    const link = element('a', 'voyage-link');
    link.href = url.href;
    link.dataset.voyage = v.id;
    if (v === activeVoyage) {
      link.setAttribute('aria-current', 'page');
      link.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        link.closest('dialog')?.close();
      });
    }
    link.append(element('strong', '', v.name), element('small', '', v.localName));
    nav.append(link);
  }
  return nav;
}

export class Hud {
  onBegin: () => void = () => {};
  onToggleCruise: () => void = () => {};
  onPad: (fwd: number, turn: number) => void = () => {};
  private title = element('section', 'title');
  private bar = element('i', '');
  private loadLabel = element('span', 'load-label', '正在铺开水面…');
  private beginBtn = element('button', 'begin', '登船出发');
  private caption = element('div', 'caption');
  private clock = element('button', 'clock');
  private mode = element('button', 'mode');
  private hint = element('ul', 'hint');
  private toastEl = element('div', 'toast');
  private dialog = element('dialog', 'atlas');
  private shown = new Set<string>();
  private captionTimer = 0;
  private toastTimer = 0;
  private sinceStart = 0;
  private endTold = false;
  private lastClock = '';

  constructor(private root: HTMLElement, private silent: boolean) {
    const v = activeVoyage;
    document.title = v.name + ' · Open Waters';
    document.getElementById('stage')?.setAttribute('aria-label', v.name + ' · 第一人称游船');
    this.title.setAttribute('aria-label', '选择航区与登船');
    this.title.innerHTML = `
      <header class="mast"><div class="wordmark"><i class="compass" aria-hidden="true"></i>Open Waters</div><span class="mast-cn">开放水域</span></header>
      <div class="departure">
        <div class="region"></div>
        <h1></h1><p class="local-name"></p>
        <p class="description"></p>
        <div class="gate"></div>
      </div>
      <footer class="atlas-strip"><span class="strip-label">航区目录</span></footer>`;
    this.title.querySelector('.region')!.textContent = v.region;
    this.title.querySelector('h1')!.textContent = v.name;
    this.title.querySelector('.local-name')!.textContent = v.localName;
    this.title.querySelector('.description')!.textContent = v.description;
    this.title.querySelector('.atlas-strip')!.append(voyageLinks(false));
    const loading = element('div', 'loading');
    loading.append(this.bar);
    const loadStatus = element('div', 'load-status');
    loadStatus.setAttribute('role', 'status');
    loadStatus.append(loading, this.loadLabel);
    this.beginBtn.type = 'button';
    this.beginBtn.disabled = true;
    this.beginBtn.append(element('span', 'board-arrow', '⟶'));
    this.beginBtn.setAttribute('aria-label', '登船出发');
    this.beginBtn.addEventListener('click', () => this.onBegin());
    this.title.querySelector('.gate')!.append(loadStatus, this.beginBtn);

    const trigger = element('button', 'atlas-trigger');
    trigger.innerHTML = '<i class="compass" aria-hidden="true"></i>航区目录';
    trigger.type = 'button';
    this.dialog.id = 'voyage-atlas';
    trigger.setAttribute('aria-controls', this.dialog.id);
    trigger.setAttribute('aria-haspopup', 'dialog');
    this.dialog.setAttribute('aria-labelledby', 'atlas-title');
    this.dialog.innerHTML = `<header><h2 id="atlas-title">航区目录</h2><button type="button" class="atlas-close" aria-label="收起航区目录">×</button></header>`;
    this.dialog.append(voyageLinks(true));
    trigger.addEventListener('click', () => this.dialog.showModal());
    this.dialog.querySelector('.atlas-close')!.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('click', e => {
      if (e.target !== this.dialog) return;
      const r = this.dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.dialog.close();
    });

    this.clock.type = 'button';
    this.mode.type = 'button';
    this.mode.setAttribute('aria-label', '自动巡航');
    this.mode.title = '切换巡航与手动掌舵';
    this.mode.addEventListener('click', () => this.onToggleCruise());
    for (const [key, label] of strings.keys) {
      const li = element('li', '');
      li.append(element('kbd', '', key), label);
      this.hint.append(li);
    }
    const pad = element('div', 'pad');
    const padButton = (cls: string, glyph: string, label: string, fwd: number, turn: number) => {
      const b = element('button', cls, glyph);
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); this.onPad(fwd, turn); });
      b.addEventListener('lostpointercapture', () => this.onPad(0, 0));
      pad.append(b);
    };
    padButton('l', '‹', '向左转舵', 0, 1);
    padButton('u', '+', '加速', 1, 0);
    padButton('d', '−', '减速或倒船', -1, 0);
    padButton('r', '›', '向右转舵', 0, -1);
    this.toastEl.setAttribute('role', 'status');
    root.append(this.title, trigger, this.dialog, this.caption, this.clock, this.mode, this.hint, this.toastEl, pad);
    if (silent) root.classList.add('silent');
  }

  progress(label: string, p: number) {
    this.bar.style.transform = `scaleX(${Math.max(0.02, p)})`;
    const map = strings.loading as Record<string, string>;
    this.loadLabel.textContent = (map[label] ?? '正在铺开水面') + '…';
  }
  ready() {
    this.root.classList.add('ready');
    this.beginBtn.disabled = false;
  }
  fail(msg: string) {
    this.loadLabel.textContent = '航区加载失败：' + msg;
    this.root.classList.add('load-failed');
  }
  begin() {
    this.root.classList.add('started');
    this.title.inert = true;
    this.beginBtn.blur();
    setTimeout(() => this.title.remove(), 900);
  }
  toggleHidden() {
    if (this.dialog.open) this.dialog.close();
    this.root.classList.toggle('hidden');
  }
  toast(key: keyof typeof strings.toast) {
    this.toastEl.textContent = strings.toast[key];
    this.toastEl.classList.add('on');
    this.toastTimer = 2.6;
  }
  private say(key: string, title: string, subtitle: string) {
    this.shown.add(key);
    this.caption.replaceChildren(element('b', '', title), element('span', '', subtitle));
    this.caption.classList.add('on');
    this.captionTimer = 6.5;
  }
  update(dt: number, s: HudState) {
    if (!s.started) return;
    this.sinceStart += dt;
    if (this.sinceStart > 13) this.root.classList.add('settled');
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0) this.caption.classList.remove('on');
    } else if (this.sinceStart > 2.5) {
      const place = activeVoyage.landmarks?.find(l => s.z >= l.minZ && s.z <= l.maxZ && !this.shown.has(l.name));
      if (!this.shown.has('start')) this.say('start', activeVoyage.localName, activeVoyage.name);
      else if (place) this.say(place.name, place.name, place.subtitle);
      else if (s.dusk > 0.72 && !this.shown.has('blue')) this.say('blue', 'Blue hour', '蓝调时刻');
      else if (s.dusk > 0.36 && s.dusk < 0.5 && !this.shown.has('sunset')) this.say('sunset', 'Sunset', '日落');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
    if (s.atEnd > 0.5 && !s.auto && !this.endTold) {
      this.endTold = true;
      this.toast('end');
    }
    if (!s.atEnd) this.endTold = false;
    const txt = clockLabel(s.dusk);
    const key = `${txt}:${s.flow}:${seasonState.current}`;
    if (key !== this.lastClock) {
      this.lastClock = key;
      this.clock.innerHTML = `<b>${txt}</b><span>${SEASONS[seasonState.current].name} · ${s.flow ? '时刻与季节' : strings.hud.paused} ⌄</span>`;
    }
    const mode = `${s.auto ? '巡航' : strings.hud.manual} · ${(Math.abs(s.speed) * 3.6).toFixed(1)} km/h`;
    if (this.mode.textContent !== mode) {
      this.mode.textContent = mode;
      this.mode.setAttribute('aria-pressed', String(s.auto));
    }
  }
}
