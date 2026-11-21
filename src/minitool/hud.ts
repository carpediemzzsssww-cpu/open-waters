import strings from '../../content/strings.json';
import { clockLabel, seasonState, SEASONS } from '../core/seasons';
import { activeVoyage, voyages } from '../destinations/catalog';
import type { api as engine } from '../main';
import { icon } from '../ui/icons';
import { bindGyro } from './gyro';
import { gyroIcon, soundIcon } from './icons';
import { follow, followStatus, haptic, layout, photoActions, sendPhoto } from './platform';
import { composeCard } from './postcard';
import S from './strings.json';

type Engine = typeof engine;
type State = { dusk: number; z: number; auto: boolean; atEnd: number; started: boolean };
const button = (classes: string, label: string, html: string) =>
  `<button class="${classes}" type="button" aria-label="${label}">${html}</button>`;
const directions = [
  ['l', '左转', '0,1', 'M15 6l-6 6 6 6'],
  ['u', '加速', '1,0', 'M6 15l6-6 6 6'],
  ['d', '减速', '-1,0', 'M6 9l6 6 6-6'],
  ['r', '右转', '0,-1', 'M9 6l6 6-6 6'],
];

let instance: Hud;
export function attach(api: Engine) { instance.connect(api); }

export class Hud {
  onBegin = () => {};
  onToggleCruise = () => {};
  onPad = (_forward: number, _turn: number) => {};
  private shown = new Set<string>();
  private captionTimer = 0;
  private age = 0;
  private toastTimer = 0;
  private lastClock = '';
  private lastAuto?: boolean;
  private endTold = false;
  private mode: HTMLButtonElement;
  private time: HTMLElement;
  private pad: HTMLElement;
  private caption: HTMLElement;

  constructor(private root: HTMLElement, silent: boolean) {
    instance = this;
    document.body.classList.add('mini');
    root.classList.toggle('silent', silent);
    const t = strings.title;
    root.innerHTML = `
      <section class="title">
        <p class="eyebrow"></p><h1></h1><p class="sub"></p>
        <div class="gate">
          <div class="loading"><i></i></div><p class="load-label">${t.loading}</p>
          <button class="begin" type="button" disabled>${t.begin}<span>${t.beginFr}</span></button>
        </div>
        <p class="note">${t.note}</p>
      </section>
      <div class="caption"><b></b><span></span></div>
      <div class="mt-bar">
        ${button('mt-helm mode', '手动掌舵', strings.hud.auto)}
        ${button('mt-shutter shutter', '拍一张', '<i></i>')}
        ${button('mt-time clock', '调节时刻', '<b>21 h 05</b><span>夏日 · 时刻</span>')}
      </div>
      <div class="mt-side">
        ${button('mt-sound sound', '静音', soundIcon(true))}
        <button class="mt-gyro gyro" type="button" aria-label="体感环顾" hidden>${gyroIcon()}</button>
        ${button('mt-atlas atlas', '选择航区', icon('atlas'))}
      </div>
      <div class="pad" hidden>${directions.map(([cls, label, dir, d]) =>
        `<button type="button" class="${cls}" data-dir="${dir}" aria-label="${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join('')}</div>
      <ul class="mt-hints">${S.hints.map(([k,v]) => `<li><kbd>${k}</kbd>${v}</li>`).join('')}</ul>
      <section class="routes mt-routes" id="mini-routes" role="dialog" aria-label="选择航区" hidden>
        <header><span>选择航区</span>${button('close-route', '收起航区', '×')}</header>
        <div class="mt-voyages"></div>
      </section>
      <section class="mt-sheet postcard" role="dialog" aria-label="航行明信片" aria-modal="true" hidden>
        <div class="mt-card"><img class="mt-photo" alt="航行明信片"></div>
        <div class="mt-actions">${button('mt-act primary save',S.photo.save,S.photo.save)}${button('mt-act post',S.photo.post,S.photo.post)}${button('mt-act share',S.photo.share,S.photo.share)}</div>
        <div class="mt-foot">${button('mt-link close-photo',S.photo.again,S.photo.again)}<button type="button" class="mt-link mt-follow" hidden>${S.photo.follow}</button></div>
      </section>
      <div class="mt-flash"></div><div class="mt-toast" role="status"></div>`;
    this.caption = this.el('.caption');
    this.mode = this.el('.mode');
    this.time = this.el('.clock');
    this.pad = this.el('.pad');
    this.describeVoyage();
    this.el<HTMLButtonElement>('.begin').onclick = () => this.onBegin();
    this.mode.onclick = () => { this.onToggleCruise(); void haptic(); };
    this.installPad();
    void layout();
    window.addEventListener('resize', layout);
  }

  private el<T extends HTMLElement = HTMLElement>(selector: string): T { return this.root.querySelector<T>(selector)!; }

  private describeVoyage() {
    const v = activeVoyage, t = strings.title, seine = v.id === 'seine';
    document.title = seine ? 'La Seine, l’heure dorée · 塞纳河黄昏' : v.name + ' · Open Waters';
    document.getElementById('stage')?.setAttribute('aria-label', v.name + ' · 第一人称游船');
    const title = this.root.querySelector('.title');
    const eyebrow = seine ? t.eyebrow : v.region;
    const writeHeading = (heading: HTMLElement) => {
      heading.textContent = '';
      if (seine) heading.append(t.line1, document.createElement('br'));
      const emphasis = document.createElement('em');
      emphasis.textContent = seine ? t.line2 : v.localName;
      heading.appendChild(emphasis);
    };
    if (title) {
      title.querySelector('.eyebrow')!.textContent = eyebrow;
      writeHeading(title.querySelector('h1')!);
      title.querySelector('.sub')!.textContent = seine ? t.sub : v.name;
      title.querySelector('.begin span')!.textContent = seine ? t.beginFr : 'Open Waters';
    }
    const boot = document.getElementById('boot');
    if (boot) {
      boot.querySelector('.boot-eyebrow')!.textContent = eyebrow;
      writeHeading(boot.querySelector('h1')!);
      boot.classList.toggle('other-voyage', !seine);
    }
  }

  private installPad() {
    const pressed = new Map<number, number[]>();
    const move = () => {
      let f = 0, t = 0;
      pressed.forEach(([forward, turn]) => { f += forward; t += turn; });
      this.onPad(Math.sign(f), Math.sign(t));
    };
    const reset = () => { pressed.clear(); move(); };
    this.pad.querySelectorAll<HTMLButtonElement>('button').forEach(b => {
      b.onpointerdown = event => {
        event.preventDefault();
        b.setPointerCapture(event.pointerId);
        pressed.set(event.pointerId, b.dataset.dir!.split(',').map(Number));
        move();
      };
      b.onlostpointercapture = event => { pressed.delete(event.pointerId); move(); };
    });
    window.addEventListener('blur', reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  }

  progress(label: string, p: number) {
    this.el('.loading i').style.transform = `scaleX(${Math.max(0.02, p)})`;
    const text = (strings.loading as Record<string,string>)[label];
    if (text && activeVoyage.id === 'seine') this.el('.load-label').textContent = text + '…';
  }
  ready() {
    this.el<HTMLButtonElement>('.begin').disabled = false;
    this.root.classList.add('ready', 'loaded');
    document.body.classList.add('loaded');
    document.getElementById('boot')?.classList.add('gone');
    window.setTimeout(() => document.body.classList.add('boot-done'), 900);
  }
  fail(msg: string) {
    console.error(msg);
    const boot = document.getElementById('boot');
    if (boot) {
      boot.classList.add('final');
      boot.querySelector('.boot-status')!.textContent = '航区暂时无法打开，请稍后再试。';
    }
    document.body.classList.add('fallback');
  }
  begin() {
    this.root.classList.add('started');
    document.body.classList.add('aboard');
    this.el<HTMLButtonElement>('.begin').blur();
    window.setTimeout(() => this.root.querySelector('.title')?.remove(), 2600);
  }
  toggleHidden() { this.root.classList.toggle('hidden'); }
  toast(key: keyof typeof strings.toast) {
    // The helm's label already indicates its current mode.
    if (key !== 'auto_on' && key !== 'auto_off') this.message(strings.toast[key]);
  }
  private message(text: string, duration = 2400) {
    const toast = this.el('.mt-toast');
    toast.textContent = text;
    toast.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => toast.classList.remove('on'), duration);
  }
  private say(key: string, local: string, subtitle: string) {
    this.shown.add(key);
    this.caption.firstElementChild!.textContent = local;
    this.caption.lastElementChild!.textContent = subtitle;
    this.caption.classList.add('on');
    this.captionTimer = 6.5;
  }
  update(dt: number, state: State) {
    if (!state.started) return;
    this.age += dt;
    if (this.age > 13 && !this.root.classList.contains('settled')) this.root.classList.add('settled');
    if (this.captionTimer > 0) {
      this.captionTimer -= dt;
      if (this.captionTimer <= 0) this.caption.classList.remove('on');
    } else if (this.age > 2.5) {
      const v = activeVoyage, seine = v.id === 'seine';
      const landmark = v.landmarks?.find(p => state.z >= p.minZ && state.z <= p.maxZ && !this.shown.has(p.name));
      if (!this.shown.has('start')) this.say('start', v.localName, seine ? strings.captions.start[1] : v.name);
      else if (landmark) this.say(landmark.name, landmark.name, landmark.subtitle);
      else if (state.dusk > .72 && !this.shown.has('blue')) this.say('blue', seine ? strings.captions.blue[0] : 'Blue hour', seine ? strings.captions.blue[1] : '蓝调时刻');
      else if (state.dusk > .36 && state.dusk < .5 && !this.shown.has('sunset')) this.say('sunset', seine ? strings.captions.sunset[0] : 'Sunset', seine ? strings.captions.sunset[1] : '日落');
    }
    if (state.auto !== this.lastAuto) {
      this.lastAuto = state.auto;
      this.mode.textContent = state.auto ? strings.hud.auto : strings.hud.manual;
      this.mode.classList.toggle('on', !state.auto);
      this.mode.setAttribute('aria-pressed', String(!state.auto));
      this.mode.setAttribute('aria-label', state.auto ? '手动掌舵' : '切换顺流');
      document.body.classList.toggle('helm', !state.auto);
      this.pad.hidden = state.auto;
    }
    const clock = clockLabel(state.dusk), label = SEASONS[seasonState.current].name;
    if (this.lastClock !== clock + label) {
      this.lastClock = clock + label;
      this.time.firstElementChild!.textContent = clock;
      this.time.lastElementChild!.textContent = label + ' · 时刻';
    }
    if (state.atEnd > .5 && !state.auto && !this.endTold) { this.endTold = true; this.toast('end'); }
    if (!state.atEnd) this.endTold = false;
  }
  connect(api: Engine) {
    const sound = this.el<HTMLButtonElement>('.sound');
    sound.setAttribute('aria-pressed','false');
    sound.onclick = () => {
      const muted = api.audio.toggleMute();
      sound.innerHTML = soundIcon(!muted);
      sound.classList.toggle('off', muted);
      sound.setAttribute('aria-pressed', String(muted));
      sound.setAttribute('aria-label', muted ? '打开声音' : '静音');
      this.message(muted ? S.sound.off : S.sound.on, 1400);
    };
    const gyro = bindGyro(this.el('.gyro'), api.look, value => this.message(value));
    api.onTick(gyro.tick);
    this.installRoutes(api, gyro.stop);
    this.installPostcard(api);
  }
  private installRoutes(api: Engine, stopGyro: () => Promise<void>) {
    const routes = this.el('.routes'), atlas = this.el<HTMLButtonElement>('.atlas');
    atlas.setAttribute('aria-controls', routes.id);
    atlas.setAttribute('aria-expanded', 'false');
    const close = (focus = false) => {
      routes.hidden = true;
      atlas.setAttribute('aria-expanded', 'false');
      this.root.classList.remove('route-open');
      if (focus) atlas.focus();
    };
    for (const v of voyages) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.voyage = v.id;
      b.innerHTML = '<strong></strong><small></small>';
      b.firstElementChild!.textContent = v.name;
      b.lastElementChild!.textContent = v.localName;
      this.el('.mt-voyages').appendChild(b);
      b.onclick = async () => {
        close(true);
        if (activeVoyage === v || this.root.classList.contains('loading-route')) return;
        this.root.classList.add('loading-route');
        try {
          await stopGyro();
          await api.switchVoyage(v);
          this.describeVoyage();
          this.caption.classList.remove('on');
          this.shown.clear(); this.captionTimer = 0; this.age = 0;
        } catch { this.message('航区暂时无法打开'); }
        finally { this.root.classList.remove('loading-route'); }
      };
    }
    atlas.onclick = () => {
      if (!routes.hidden) { close(true); return; }
      if (this.root.classList.contains('loading-route')) return;
      routes.hidden = false;
      this.root.classList.add('route-open');
      atlas.setAttribute('aria-expanded', 'true');
      for (const b of routes.querySelectorAll<HTMLButtonElement>('[data-voyage]')) {
        const active = b.dataset.voyage === activeVoyage.id;
        b.setAttribute('aria-pressed', String(active));
        if (active) b.focus();
      }
    };
    this.el('.close-route').onclick = () => close(true);
    document.addEventListener('pointerdown', e => {
      if (!routes.hidden && !routes.contains(e.target as Node) && !atlas.contains(e.target as Node)) close();
    });
    routes.addEventListener('keydown', e => { if (e.key === 'Escape') close(true); });
  }
  private installPostcard(api: Engine) {
    const sheet = this.el('.postcard'), flash = this.el('.mt-flash');
    const img = this.el<HTMLImageElement>('.mt-photo');
    const shutter = this.el<HTMLButtonElement>('.shutter'), followButton = this.el<HTMLButtonElement>('.mt-follow');
    const again = this.el<HTMLButtonElement>('.close-photo');
    const actions = ['save', 'post', 'share'] as const;
    let busy = false, revision = 0;
    const close = () => {
      revision++;
      sheet.hidden = true;
      document.body.classList.remove('sheet-open');
      img.removeAttribute('src');
      shutter.focus();
    };
    again.onclick = close;
    sheet.onclick = e => { if (e.target === sheet) close(); };
    sheet.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    shutter.onclick = () => {
      if (busy || !api.state.started || this.root.classList.contains('loading-route')) return;
      busy = true;
      void haptic();
      flash.classList.add('on');
      window.setTimeout(() => {
        try {
          const frame = api.capture(1600);
          try {
            const card = composeCard(frame, api.player.z, api.dusk);
            try { img.src = card.toDataURL('image/jpeg', .9); }
            finally { card.width = card.height = 1; }
          } finally { frame.width = frame.height = 1; }
          img.alt = activeVoyage.name + '航行明信片';
          const available = photoActions();
          for (const action of actions) this.el('.' + action).hidden = !available[action];
          sheet.hidden = false;
          document.body.classList.add('sheet-open');
          again.focus();
          const current = ++revision;
          followButton.hidden = true;
          void followStatus().then(s => { if (revision === current) followButton.hidden = s !== 0; });
        } catch { this.message(S.photo.saveFail); }
        finally { flash.classList.remove('on'); busy = false; }
      }, 60);
    };
    for (const action of actions) {
      const b = this.el<HTMLButtonElement>('.' + action);
      b.onclick = async () => {
        const data = img.getAttribute('src');
        if (!data || busy) return;
        busy = true; b.disabled = true;
        if (action === 'post') this.message(S.photo.posting, 1600);
        try {
          await sendPhoto(data, activeVoyage.id === 'seine' ? S.photo.noteTitle : activeVoyage.name + '上的黄昏', action);
          if (action === 'save') { this.message(S.photo.saved); void haptic('medium'); }
        } catch { this.message(action === 'post' ? S.photo.postFail : S.photo.saveFail); }
        finally { b.disabled = false; busy = false; }
      };
    }
    followButton.onclick = async () => {
      followButton.disabled = true;
      const result = await follow();
      if (result === 1 || result === 2) followButton.textContent = S.photo.followed;
      else followButton.disabled = false;
    };
  }
}
