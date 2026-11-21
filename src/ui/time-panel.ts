import { SEASONS, seasonState, clockLabel, type Season } from '../core/seasons';

interface Controls {
  state: { flow: boolean; duskTarget: number; timeScale: number };
  readonly dusk: number;
  goToDusk(d: number): void;
  scrubDusk(d: number): void;
  setSeason(s: Season): void;
  toggleFlow(): void;
  onTick(fn: () => void): void;
}

/** 两个版本共用的时刻面板，触摸和键盘均使用原生控件。 */
export class TimePanel {
  readonly element = document.createElement('section');
  private slider: HTMLInputElement;
  private readout: HTMLElement;
  private status: HTMLElement;
  private flow: HTMLButtonElement;
  private last = '';

  constructor(private api: Controls, private trigger: HTMLElement, root: HTMLElement, mini = false) {
    const p = this.element;
    p.className = 'time-panel' + (mini ? ' mt-times' : '');
    p.id = mini ? 'mini-time-panel' : 'time-panel';
    p.hidden = true;
    p.setAttribute('aria-label', '时刻与季节');
    p.innerHTML = `
      <header><span>留住这一刻</span><button type="button" class="time-close" aria-label="收起时刻面板">×</button></header>
      <div class="time-readout"><b></b><span></span></div>
      <label class="time-slider-label">黄昏进度<input type="range" min="0" max="105" step="1" aria-label="黄昏进度"></label>
      <div class="time-presets">${[['金色', .03], ['日落', .34], ['暮色', .62], ['蓝调', 1]].map(([s,d]) => `<button type="button" class="time-preset" data-dusk="${d}">${s}</button>`).join('')}</div>
      <div class="time-seasons" role="group" aria-label="季节">${Object.entries(SEASONS).map(([id,s]) => `<button type="button" data-season="${id}" aria-label="${s.name}">${s.label}</button>`).join('')}</div>
      <div class="time-bottom"><button class="time-flow" type="button"></button><select aria-label="时间流速"><option value="0.5">慢慢走 · ½×</option><option value="1" selected>原速 · 1×</option><option value="2">快一些 · 2×</option></select></div>
      <p class="time-note">拖动即停住 · 季节钟点为氛围示意</p>`;
    this.slider = p.querySelector('input')!;
    this.readout = p.querySelector('.time-readout b')!;
    this.status = p.querySelector('.time-readout span')!;
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
      if (!p.hidden) { this.refresh(); this.slider.focus({ preventScroll: true }); }
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
    if (focus) this.trigger.focus({ preventScroll: true });
  }
  private refresh() {
    const { api } = this;
    const d = api.state.duskTarget >= 0 ? api.state.duskTarget : api.dusk;
    const key = [Math.round(d * 105), seasonState.current, api.state.flow, api.state.duskTarget >= 0, api.state.timeScale].join(':');
    if (key === this.last) return;
    this.last = key;
    this.slider.value = String(Math.round(d * 105));
    this.slider.setAttribute('aria-valuetext', clockLabel(d));
    this.readout.textContent = clockLabel(d);
    this.status.textContent = `${SEASONS[seasonState.current].name} · ${api.state.duskTarget >= 0 ? '正在拨动' : api.state.flow ? '时间在走' : '时间停着'}`;
    this.flow.textContent = api.state.flow ? 'Ⅱ 暂停时间' : d >= .999 ? '↺ 再看一次' : '▷ 继续时间';
    this.element.querySelectorAll<HTMLButtonElement>('[data-season]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.season === seasonState.current)));
    this.element.querySelectorAll<HTMLButtonElement>('[data-dusk]').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(Number(b.dataset.dusk) - d) < .025)));
    this.element.querySelector('select')!.value = String(api.state.timeScale);
  }
}
