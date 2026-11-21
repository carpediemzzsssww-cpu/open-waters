import { clamp, rng, smoothstep } from '../core/util';

interface AudioState {
  speed: number;
  throttle: number;
  dusk: number;
  under: number; // 在桥洞里的程度
  x: number;
  z: number;
  kick: number;
  facing: number; // 脸朝的方向（弧度，0 = -Z）
  parts: { boats?: { x: number; z: number; heading: number; speed: number; length: number }[]; music?: { x: number; z: number } }[];
}

/**
 * 环境声全部用 Web Audio 现场合成，没有一个音频文件：
 * 水拍船舷、船头分水的沙沙声、很轻的电机、远处的城市底噪、树叶、雨燕、
 * 日落时左岸传来的钟、别的船经过时的低鸣；进了桥洞，声音会闷下来并带上回响。
 * 天黑以后，停在左岸的那条驳船上有人弹几句很慢的三拍子。
 */
export class Ambience {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode;
  private tone!: BiquadFilterNode;
  private send!: GainNode;
  private white!: AudioBuffer;
  private brown!: AudioBuffer;
  private lapA!: GainNode;
  private lapB!: GainNode;
  private hiss!: GainNode;
  private motor!: GainNode;
  private motorOsc: OscillatorNode[] = [];
  private leaves!: GainNode;
  private city!: GainNode;
  private other!: GainNode;
  private otherPan!: StereoPannerNode;
  private musicGain!: GainNode;
  private musicPan!: StereoPannerNode;
  private muted = false;
  private r = rng(2026);
  private tSlap = 1;
  private tSwift = 5;
  private tLap = 0;
  private tBeat = 0;
  private beat = 0;
  private bellDone = false;
  private lastDusk = 0;

  constructor(private citySounds: boolean) {}

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const now = ctx.currentTime;
    this.master = ctx.createGain();
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.85, now + 4);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 16000;
    this.bus = ctx.createGain();
    this.bus.connect(this.tone).connect(this.master);
    // 混响：一段衰减的噪声当脉冲响应
    const conv = ctx.createConvolver();
    conv.buffer = this.impulse(2.6);
    this.send = ctx.createGain();
    this.send.gain.value = 0.12;
    this.bus.connect(this.send).connect(conv).connect(this.master);

    this.white = this.noise(4, false);
    this.brown = this.noise(7, true);

    const loop = (buf: AudioBuffer, type: BiquadFilterType, f: number, q: number, pan: number, dest: AudioNode = this.bus) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = this.r() * 1.5;
      const flt = ctx.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = f;
      flt.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      src.connect(flt).connect(g).connect(p).connect(dest);
      src.start(now + this.r() * 0.3);
      return g;
    };
    this.lapA = loop(this.white, 'bandpass', 480, 0.8, -0.45);
    this.lapB = loop(this.white, 'bandpass', 1050, 1.1, 0.5);
    this.hiss = loop(this.white, 'highpass', 2200, 0.5, 0);
    this.leaves = loop(this.white, 'bandpass', 3400, 0.6, 0.15);
    this.city = loop(this.brown, 'lowpass', 190, 0.4, 0);

    // 电机：两个很低的音，几乎只是一点体感
    this.motor = ctx.createGain();
    this.motor.gain.value = 0;
    const mlp = ctx.createBiquadFilter();
    mlp.type = 'lowpass';
    mlp.frequency.value = 170;
    for (const [f, type] of [[46, 'triangle'], [92.6, 'sine'], [139, 'sine']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(mlp);
      o.start();
      this.motorOsc.push(o);
    }
    mlp.connect(this.motor).connect(this.bus);

    // 别的船的低鸣
    this.other = ctx.createGain();
    this.other.gain.value = 0;
    this.otherPan = ctx.createStereoPanner();
    const osrc = ctx.createBufferSource();
    osrc.buffer = this.brown;
    osrc.loop = true;
    const obp = ctx.createBiquadFilter();
    obp.type = 'lowpass';
    obp.frequency.value = 140;
    osrc.connect(obp).connect(this.other).connect(this.otherPan).connect(this.bus);
    osrc.start();

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicPan = ctx.createStereoPanner();
    const mlow = ctx.createBiquadFilter();
    mlow.type = 'lowpass';
    mlow.frequency.value = 2400;
    this.musicGain.connect(mlow).connect(this.musicPan).connect(this.bus);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, this.ctx.currentTime, 0.2);
    return this.muted;
  }

  setSuspended(s: boolean) {
    if (!this.ctx) return;
    if (s) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  private noise(seconds: number, brown: boolean) {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    // 首尾交叉淡化，循环处不咔哒
    const n = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      d[i] = d[i] * k + d[d.length - n + i] * (1 - k);
    }
    return buf;
  }

  private impulse(seconds: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        lp += (Math.random() * 2 - 1 - lp) * (0.5 - 0.35 * t);
        d[i] = lp * Math.pow(1 - t, 2.6);
      }
    }
    return buf;
  }

  /** 一下水拍船舷的声音 */
  private slap(gain: number, pan: number) {
    const ctx = this.ctx!, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2 + this.r() * 2;
    const f0 = 260 + this.r() * 260;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f0 * (2 + this.r() * 1.4), t + 0.09);
    f.frequency.exponentialRampToValueAtTime(f0 * 1.2, t + 0.32);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0004, t + 0.3 + this.r() * 0.25);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(g).connect(p).connect(this.bus);
    src.start(t, this.r() * 3, 0.7);
    src.onended = () => p.disconnect();
  }

  /** 雨燕：很高、很尖、往下滑的一声 */
  private swift(gain: number) {
    const ctx = this.ctx!;
    let t = ctx.currentTime + 0.02;
    const pan = this.r() * 1.6 - 0.8;
    const n = 2 + Math.floor(this.r() * 4);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.bus);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200 + this.r() * 2500;
    lp.connect(p);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f0 = 5400 + this.r() * 1300, dur = 0.16 + this.r() * 0.14;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.74, t + dur);
      // 每个音自带一个颤音，跟着音一起停
      const vib = ctx.createOscillator(), vg = ctx.createGain();
      vib.frequency.value = 34 + this.r() * 12;
      vg.gain.value = 190;
      vib.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * (0.6 + this.r() * 0.4), t + 0.03);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(lp);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.02);
      vib.stop(t + dur + 0.02);
      if (i === n - 1) o.onended = () => p.disconnect();
      t += dur + 0.05 + this.r() * 0.12;
    }
  }

  /** 钟：几个不成倍数的泛音叠在一起，衰减很长 */
  private bell(when: number, gain: number) {
    const ctx = this.ctx!;
    const f0 = 311;
    const parts: [number, number, number][] = [[0.5, 0.5, 7], [1, 1, 5.5], [1.19, 0.6, 4.2], [1.5, 0.35, 3.4], [2, 0.5, 2.8], [2.74, 0.22, 1.8], [3.0, 0.16, 1.5], [4.1, 0.08, 1.0]];
    const p = ctx.createStereoPanner();
    p.pan.value = -0.4;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1500;
    lp.connect(p).connect(this.bus);
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    p.connect(wet).connect(this.send);
    parts.forEach(([ratio, amp, dec], i) => {
      const o = ctx.createOscillator();
      o.frequency.value = f0 * ratio * (1 + (this.r() - 0.5) * 0.002);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(gain * amp, when + 0.012);
      g.gain.exponentialRampToValueAtTime(0.00008, when + dec);
      o.connect(g).connect(lp);
      o.start(when);
      o.stop(when + dec + 0.1);
      if (i === 0) o.onended = () => { p.disconnect(); wet.disconnect(); };
    });
  }

  /** 驳船上的那几句：一把很软的拨弦，三拍子 */
  private pluck(freq: number, when: number, gain: number, len = 1.8) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), o2 = ctx.createOscillator();
    o.type = 'triangle';
    o2.type = 'sine';
    o.frequency.value = freq;
    o2.frequency.value = freq * 2.003;
    const g = ctx.createGain(), g2 = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0002, when + len);
    g2.gain.setValueAtTime(0, when);
    g2.gain.linearRampToValueAtTime(gain * 0.3, when + 0.008);
    g2.gain.exponentialRampToValueAtTime(0.0001, when + len * 0.45);
    o.connect(g).connect(this.musicGain);
    o2.connect(g2).connect(this.musicGain);
    o.start(when);
    o2.start(when);
    o.stop(when + len + 0.05);
    o2.stop(when + len + 0.05);
  }

  private stepMusic() {
    const ctx = this.ctx!;
    // A 大调上一个很慢的回旋：每小节三拍，低音 + 两下和弦，偶尔带一句旋律
    const bars = [
      { bass: 110.0, ch: [277.18, 329.63, 440.0], mel: [659.25, 0, 554.37] },
      { bass: 92.5, ch: [277.18, 369.99, 440.0], mel: [493.88, 554.37, 0] },
      { bass: 146.83, ch: [293.66, 369.99, 440.0], mel: [587.33, 0, 554.37] },
      { bass: 164.81, ch: [246.94, 329.63, 415.3], mel: [493.88, 0, 0] },
      { bass: 110.0, ch: [277.18, 329.63, 440.0], mel: [0, 659.25, 739.99] },
      { bass: 123.47, ch: [293.66, 369.99, 493.88], mel: [880.0, 0, 739.99] },
      { bass: 164.81, ch: [246.94, 329.63, 415.3], mel: [659.25, 587.33, 493.88] },
      { bass: 110.0, ch: [277.18, 329.63, 440.0], mel: [554.37, 0, 0] },
    ];
    const bar = bars[Math.floor(this.beat / 3) % bars.length], b = this.beat % 3;
    const when = ctx.currentTime + 0.05 + (this.r() - 0.5) * 0.02;
    if (b === 0) this.pluck(bar.bass, when, 0.5, 2.6);
    else bar.ch.forEach((f, i) => this.pluck(f, when + i * 0.018, 0.2, 1.3));
    if (bar.mel[b]) this.pluck(bar.mel[b], when + 0.01, 0.34, 2.2);
    this.beat++;
  }

  update(dt: number, s: AudioState) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const sp = Math.abs(s.speed);
    const set = (g: GainNode, v: number, tc = 0.4) => g.gain.setTargetAtTime(v, now, tc);
    const nearBank = smoothstep(18, 50, Math.abs(s.x));

    // 水声：两层缓慢起伏的底 + 零星的拍击
    this.tLap -= dt;
    if (this.tLap <= 0) {
      this.tLap = 0.5 + this.r() * 1.1;
      set(this.lapA, (0.012 + this.r() * 0.03) * (1 + sp * 0.25 + s.kick * 2), 0.5);
      set(this.lapB, (0.006 + this.r() * 0.02) * (1 + sp * 0.3 + s.kick * 2), 0.4);
      set(this.leaves, (0.0018 + this.r() * 0.0045) * (0.5 + nearBank) * (1 - s.under * 0.8), 1.2);
    }
    this.tSlap -= dt * (1 + sp * 0.5 + s.kick * 3);
    if (this.tSlap <= 0) {
      this.tSlap = 0.7 + this.r() * 2.4;
      this.slap(0.035 + this.r() * 0.06 + s.kick * 0.08, this.r() < 0.5 ? -0.3 - this.r() * 0.5 : 0.3 + this.r() * 0.5);
    }
    set(this.hiss, sp * sp * 0.0034, 0.6);
    set(this.motor, clamp(Math.abs(s.throttle), 0, 1) * 0.05, 0.5);
    this.motorOsc.forEach((o, i) => o.frequency.setTargetAtTime([46, 92.6, 139][i] * (0.85 + Math.abs(s.throttle) * 0.4), now, 0.6));
    set(this.city, (this.citySounds ? 0.085 : 0) * (1 - s.under * 0.4), 1);

    // 桥洞：闷一点，回声多一点
    this.tone.frequency.setTargetAtTime(16000 - s.under * 11500, now, 0.25);
    this.send.gain.setTargetAtTime(0.12 + s.under * 0.75, now, 0.25);

    // 雨燕：天亮着的时候才叫
    this.tSwift -= dt;
    if (this.tSwift <= 0) {
      this.tSwift = 3.5 + this.r() * 9;
      const vol = (1 - smoothstep(0.55, 0.85, s.dusk)) * (1 - s.under);
      if (vol > 0.05) this.swift(0.011 * vol);
    }

    // 日落那一刻的钟
    if (this.citySounds && !this.bellDone && s.dusk >= 0.5 && this.lastDusk < 0.5 && this.lastDusk > 0.4) {
      this.bellDone = true;
      for (let i = 0; i < 5; i++) this.bell(now + 0.3 + i * 2.9, 0.05);
    }
    this.lastDusk = s.dusk;

    // 最近的一条开着的船
    let og = 0, opan = 0;
    let music: { x: number; z: number } | undefined;
    for (const p of s.parts) {
      if (p.music) music = p.music;
      for (const b of p.boats ?? []) {
        if (b.speed < 0.3) continue;
        const dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz);
        const g = clamp(b.length / 50, 0.2, 1) * 0.5 / (1 + (d / 26) * (d / 26));
        if (g > og) {
          og = g;
          opan = Math.sin(Math.atan2(-dx, -dz) - s.facing) * -0.8;
        }
      }
    }
    set(this.other, og, 0.5);
    this.otherPan.pan.setTargetAtTime(clamp(opan, -1, 1), now, 0.3);

    // 驳船上的琴声：天色暗下来才有，离得近才听得见
    if (music) {
      const dx = music.x - s.x, dz = music.z - s.z, d = Math.hypot(dx, dz);
      const vol = smoothstep(0.6, 0.85, s.dusk) * 0.5 / (1 + (d / 55) * (d / 55));
      set(this.musicGain, vol, 0.8);
      this.musicPan.pan.setTargetAtTime(clamp(Math.sin(Math.atan2(-dx, -dz) - s.facing) * -0.75, -1, 1), now, 0.3);
      this.tBeat -= dt;
      if (this.tBeat <= 0) {
        this.tBeat += 0.74;
        if (vol > 0.004) this.stepMusic();
      }
    }
  }
}
