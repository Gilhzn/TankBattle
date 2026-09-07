import { settings } from '../app/settings.js';

type SfxName = 'shot' | 'hit' | 'explosion' | 'bigExplosion' | 'pickup' | 'stageClear' | 'gameOver' | 'brick' | 'spawn' | 'freeze' | 'click';

/** WebAudio-synthesised sound effects. Unlocked on the first user gesture; respects the sound setting. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private lastPlayed = new Map<SfxName, number>();
  private unlocked = false;

  constructor() {
    const unlock = (): void => void this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return this.ctx;
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      this.unlocked = ctx.state === 'running';
    } catch {
      /* ignore */
    }
  }

  private get enabled(): boolean {
    return settings.get().sound && this.unlocked && !!this.ctx && this.ctx.state === 'running';
  }

  private tone(freq: number, type: OscillatorType, dur: number, gain = 0.5, endFreq?: number, delay = 0): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master!);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private burst(dur: number, gain: number, filterHz: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterHz;
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name: SfxName): void {
    if (!this.enabled) return;
    const now = performance.now();
    const last = this.lastPlayed.get(name) ?? 0;
    const minGap = name === 'shot' ? 40 : name === 'hit' || name === 'brick' ? 30 : 60;
    if (now - last < minGap) return;
    this.lastPlayed.set(name, now);
    switch (name) {
      case 'shot':
        this.tone(520, 'square', 0.07, 0.25, 180);
        break;
      case 'brick':
        this.burst(0.08, 0.35, 1800);
        break;
      case 'hit':
        this.burst(0.12, 0.5, 3000, 0, 'bandpass');
        this.tone(200, 'triangle', 0.08, 0.2, 90);
        break;
      case 'explosion':
        this.burst(0.35, 0.7, 700);
        this.tone(160, 'sine', 0.35, 0.5, 40);
        break;
      case 'bigExplosion':
        this.burst(0.6, 0.9, 500);
        this.tone(120, 'sine', 0.6, 0.7, 30);
        this.tone(60, 'triangle', 0.5, 0.4, 25, 0.05);
        break;
      case 'pickup':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', 0.12, 0.2, undefined, i * 0.07));
        break;
      case 'spawn':
        this.tone(300, 'sine', 0.2, 0.15, 900);
        break;
      case 'freeze':
        this.tone(900, 'sine', 0.5, 0.25, 200);
        this.tone(1200, 'triangle', 0.4, 0.15, 300, 0.1);
        break;
      case 'stageClear':
        [523, 659, 784, 659, 784, 1047].forEach((f, i) => this.tone(f, 'square', 0.16, 0.22, undefined, i * 0.12));
        break;
      case 'gameOver':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 'sawtooth', 0.35, 0.2, undefined, i * 0.25));
        break;
      case 'click':
        this.tone(1200, 'sine', 0.04, 0.12, 800);
        break;
    }
  }
}

export const sfx = new Sfx();
