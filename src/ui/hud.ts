import { clockLabel } from '../core/seasons';
import { activeVoyage, voyages } from '../destinations/catalog';
import strings from '../../content/strings.json';
import { icon } from './icons';

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
  for (const voyage of voyages) {
    const url = new URL(location.href);
    url.searchParams.set('voyage', voyage.id);
    for (const key of ['x', 'z', 'yaw', 'pitch', 'hdg', 'speed', 'auto', 'fov', 'thr', 'only']) url.searchParams.delete(key);
    if (sailing) url.searchParams.set('go', '1');
    else url.searchParams.delete('go');
    const link = element('a', 'voyage-link', voyage.name);
    link.href = url.href;
    link.dataset.voyage = voyage.id;
    if (voyage === activeVoyage) {
      link.setAttribute('aria-current', 'page');
      link.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        e.preventDefault();
        link.closest('dialog')?.close();
      });
    }
    nav.append(link);
  }
  return nav;
}

function iconButton(className: string, label: string, glyph: Parameters<typeof icon>[0]) {
  const b = element('button', className);
  b.type = 'button';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = icon(glyph);
  return b;
}

export class Hud {
  onBegin: () => void = () => {};
  onToggleCruise: () => void = () => {};
  onPad: (fwd: number, turn: number) => void = () => {};
  private title = element('section', 'title');
  private bar = element('i', '');
  private loadLabel = element('span', 'load-label sr-only', '正在加载航区');
  private beginBtn = element('button', 'begin', '登船');
  private clock = iconButton('clock', '时刻与季节', 'dusk');
  private mode = iconButton('mode', '自动巡航', 'helm');
  private toastEl = element('div', 'toast');
  private dialog = element('dialog', 'atlas');
  private toastTimer = 0;
  private endTold = false;

  constructor(private root: HTMLElement, silent: boolean) {
    const voyage = activeVoyage;
    document.title = voyage.name + ' · Open Waters';
    document.getElementById('stage')?.setAttribute('aria-label', voyage.name + ' · 第一人称游船');
    this.title.setAttribute('aria-label', '选择航区与登船');
    const intro = element('div', 'departure');
    const heading = element('h1', '', voyage.localName);
    const gate = element('div', 'gate');
    const loading = element('div', 'loading');
    loading.append(this.bar);
    const status = element('div', 'load-status');
    status.setAttribute('role', 'status');
    status.append(loading, this.loadLabel);
    this.beginBtn.type = 'button';
    this.beginBtn.disabled = true;
    this.beginBtn.insertAdjacentHTML('beforeend', icon('board'));
    this.beginBtn.setAttribute('aria-label', '登船出发');
    this.beginBtn.addEventListener('click', () => this.onBegin());
    gate.append(status, this.beginBtn);
    intro.append(heading, gate);
    this.title.append(intro, voyageLinks(false));

    const atlas = iconButton('atlas-trigger', '选择航区', 'atlas');
    this.dialog.id = 'voyage-atlas';
    this.dialog.setAttribute('aria-labelledby', 'atlas-title');
    atlas.setAttribute('aria-controls', this.dialog.id);
    atlas.setAttribute('aria-haspopup', 'dialog');
    const header = element('header', '');
    const dialogTitle = element('h2', '', '航区');
    dialogTitle.id = 'atlas-title';
    const close = iconButton('atlas-close', '收起航区目录', 'close');
    close.addEventListener('click', () => this.dialog.close());
    header.append(dialogTitle, close);
    this.dialog.append(header, voyageLinks(true));
    atlas.addEventListener('click', () => this.dialog.showModal());
    this.dialog.addEventListener('click', e => {
      if (e.target !== this.dialog) return;
      const box = this.dialog.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) this.dialog.close();
    });

    this.mode.addEventListener('click', () => this.onToggleCruise());
    const dock = element('div', 'sailing-controls');
    dock.setAttribute('role', 'group');
    dock.setAttribute('aria-label', '航行控制');
    dock.append(atlas, this.mode, this.clock);
    const pad = element('div', 'pad');
    // Each finger owns its own axis. Releasing throttle must leave a held rudder intact.
    const held = new Map<number, [number, number]>();
    const updatePad = () => {
      let fwd = 0, turn = 0;
      for (const v of held.values()) { fwd += v[0]; turn += v[1]; }
      this.onPad(Math.sign(fwd), Math.sign(turn));
    };
    const addPad = (cls: string, glyph: string, label: string, fwd: number, turn: number) => {
      const button = element('button', cls, glyph);
      button.type = 'button';
      button.setAttribute('aria-label', label);
      button.addEventListener('pointerdown', e => {
        e.preventDefault();
        button.setPointerCapture(e.pointerId);
        held.set(e.pointerId, [fwd, turn]);
        updatePad();
      });
      button.addEventListener('lostpointercapture', e => {
        held.delete(e.pointerId);
        updatePad();
      });
      pad.append(button);
    };
    addPad('l', '‹', '向左转舵', 0, 1);
    addPad('u', '+', '加速', 1, 0);
    addPad('d', '−', '减速或倒船', -1, 0);
    addPad('r', '›', '向右转舵', 0, -1);

    this.toastEl.setAttribute('role', 'status');
    root.append(this.title, dock, this.dialog, this.toastEl, pad);
    if (silent) root.classList.add('silent');
  }

  progress(_label: string, p: number) {
    this.bar.style.transform = `scaleX(${Math.max(0.02, p)})`;
  }
  ready() {
    this.root.classList.add('ready');
    this.beginBtn.disabled = false;
  }
  fail(msg: string) {
    this.loadLabel.classList.remove('sr-only');
    this.loadLabel.textContent = '航区加载失败：' + msg;
    this.root.classList.add('load-failed');
  }
  begin() {
    this.root.classList.add('started');
    this.title.inert = true;
    this.beginBtn.blur();
    setTimeout(() => this.title.remove(), 850);
  }
  toggleHidden() {
    if (this.dialog.open) this.dialog.close();
    this.root.classList.toggle('hidden');
  }
  toast(key: keyof typeof strings.toast) {
    this.toastEl.textContent = strings.toast[key];
    this.toastEl.classList.add('on');
    this.toastTimer = 1.8;
  }
  update(dt: number, s: HudState) {
    if (!s.started) return;
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('on');
    if (s.atEnd > 0.5 && !s.auto && !this.endTold) {
      this.endTold = true;
      this.toast('end');
    }
    if (!s.atEnd) this.endTold = false;
    const pressed = String(s.auto);
    if (this.mode.getAttribute('aria-pressed') !== pressed) {
      this.mode.setAttribute('aria-pressed', pressed);
      this.mode.title = s.auto ? '切换为掌舵' : '切换为巡航';
    }
    const title = clockLabel(s.dusk) + ' · 时刻与季节';
    if (this.clock.title !== title) this.clock.title = title;
  }
}
