import { SEASONS, seasonState, clockLabel, type Season } from '../core/seasons';
import { icon } from './icons';

interface Controls {
  state: { flow: boolean; duskTarget: number; timeScale: number };
  readonly dusk: number;
  goToDusk(d: number): void;
  scrubDusk(d: number): void;
  setSeason(s: Season): void;
  toggleFlow(): void;
  onTick(fn: () => void): void;
}

export class TimePanel {
  readonly element = document.createElement('section');
  private slider: HTMLInputElement;
  private readout: HTMLElement;
  private flow: HTMLButtonElement;
  private last = '';
  private playback = '';

  constructor(private api: Controls, private trigger: HTMLElement, root: HTMLElement, mini = false) {
    const p = this.element;
    p.className = 'time-panel' + (mini ? ' mt-times' : '');
    p.id = mini ? 'mini-time-panel' : 'time-panel';
    p.hidden = true;
    p.setAttribute('role', 'group');
    p.setAttribute('aria-label', '时刻与季节');
    p.innerHTML = `
      <header><span class="time-readout"></span><button type="button" class="time-close" aria-label="收起时刻面板">${icon('close')}</button></header>
      <input type="range" min="0" max="105" step="1" aria-label="黄昏进度（季节钟点为示意）">
      <div class="time-presets" role="group" aria-label="选择时刻">${[['金色', .03], ['日落', .34], ['暮色', .62], ['蓝调', 1]].map(([s,d]) => `<button type="button" class="time-preset" data-dusk="${d}">${s}</button>`).join('')}</div>
      <div class="time-seasons" role="group" aria-label="季节">${Object.entries(SEASONS).map(([id,s]) => `<button type="button" data-season="${id}" aria-label="${s.name}">${s.label}</button>`).join('')}</div>
      <div class="time-bottom"><button class="time-flow" type="button"></button><select aria-label="时间流速"><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></div>`;
    this.slider = p.querySelector('input')!;
    this.readout = p.querySelector('.time-readout')!;
    this.flow = p.querySelector('.time-flow')!;
    this.slider.addEventListener('input', () => { api.scrubDusk(Number(this.slider.value) / 105); this.refresh(); });
    p.querySelectorAll<HTMLButtonElement>('[data-dusk]').forEach(b => b.addEventListener('click', () => { api.goToDusk(Number(b.dataset.dusk)); this.refresh(); }));
    p.querySelectorAll<HTMLButtonElement>('[data-season]').forEach(b => b.addEventListener('click', () => { api.setSeason(b.dataset.season as Season); this.refresh(); }));
    this.flow.addEventListener('click', () => { api.toggleFlow(); this.refresh(); });
    p.querySelector('select')!.addEventListener('change', e => { api.state.timeScale = Number((e.target as HTMLSelectElement).value); });
    p.querySelector('.time-close')!.addEventListener('click', () => this.close(true));
    trigger.setAttribute('aria-controls', p.id);
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', '调节时刻与季节');
    trigger.addEventListener('click', () => {
      p.hidden = !p.hidden;
      trigger.setAttribute('aria-expanded', String(!p.hidden));
      root.classList.toggle('time-open', !p.hidden);
      if (!p.hidden) { this.refresh(); this.slider.focus(); }
    });
    document.addEventListener('pointerdown', e => { if (!p.hidden && !p.contains(e.target as Node) && !trigger.contains(e.target as Node)) this.close(); });
    p.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.close(true); } });
    root.appendChild(p);
    api.onTick(() => { if (!p.hidden) this.refresh(); });
  }

  close(focus = false) {
    this.element.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.element.parentElement?.classList.remove('time-open');
    if (focus) this.trigger.focus();
  }
  private refresh() {
    const { api } = this;
    const d = api.state.duskTarget >= 0 ? api.state.duskTarget : api.dusk;
    const name = api.state.flow ? 'pause' : d >= .999 ? 'replay' : 'play';
    const key = [Math.round(d * 105), seasonState.current, name, api.state.timeScale].join(':');
    if (key === this.last) return;
    this.last = key;
    this.slider.value = String(Math.round(d * 105));
    this.slider.setAttribute('aria-valuetext', clockLabel(d));
    this.readout.textContent = clockLabel(d);
    if (name !== this.playback) {
      this.playback = name;
      const label = name === 'pause' ? '暂停时间' : name === 'replay' ? '重播黄昏' : '继续时间';
      this.flow.innerHTML = icon(name);
      this.flow.setAttribute('aria-label', label);
      this.flow.title = label;
    }
    this.element.querySelectorAll<HTMLButtonElement>('[data-season]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.season === seasonState.current)));
    this.element.querySelectorAll<HTMLButtonElement>('[data-dusk]').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.dusk) - d) < .025)));
    this.element.querySelector('select')!.value = String(api.state.timeScale);
  }
}
