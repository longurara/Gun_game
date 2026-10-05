import type { GameEvent, Vec3, WeaponType } from './types';
import { WEAPONS } from './game/weapons';

/** Short procedural effects: no downloaded assets, loops, or audio before a user gesture. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private sources = new Set<AudioScheduledSourceNode>();
  private volume = 0.65;
  private unavailable = false;
  private disposed = false;
  private lastStep = -Infinity;
  private lastDamage = -Infinity;
  private lastReload = -Infinity;
  private lastHeal = -Infinity;
  private stepSide = false;

  /** Call directly from Start/Continue or another click/keyboard gesture. */
  async unlock(): Promise<void> {
    if (this.disposed || this.unavailable || typeof window === 'undefined') return;
    if (!this.context) {
      const audioWindow = window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      };
      const Context = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
      if (!Context) {
        this.unavailable = true;
        return;
      }
      try {
        const context = new Context({ latencyHint: 'interactive' });
        this.context = context;
        const master = context.createGain();
        master.gain.value = this.volume * 0.7;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -16;
        compressor.knee.value = 18;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.16;
        master.connect(compressor);
        compressor.connect(context.destination);
        this.master = master;
        const noise = context.createBuffer(1, Math.ceil(context.sampleRate * 1.2), context.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noiseBuffer = noise;
      } catch {
        this.unavailable = true;
        this.dispose();
        return;
      }
    }
    // A rejected resume (browser policy/device state) must never break the game.
    try {
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      // A later user gesture may successfully resume this same context.
    }
  }

  setVolume(volume: number): void {
    this.volume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.65;
    if (!this.context || !this.master || this.context.state === 'closed') return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.volume * 0.7, now, 0.025);
  }

  handle(event: GameEvent, playerPosition: Vec3): void {
    if (!this.ready()) return;
    switch (event.type) {
      case 'shot': {
        const distance = Math.hypot(
          event.from.x - playerPosition.x,
          event.from.y - playerPosition.y,
          event.from.z - playerPosition.z,
        );
        // Keep nearby fire punchy while letting distant bot battles remain audible.
        if (distance > 170) return;
        const attenuation = 1 / (1 + Math.pow(distance / 22, 1.55));
        this.gunshot(event.weapon, attenuation, distance);
        if (event.actorId === 'player' && event.hitId) this.hit();
        break;
      }
      case 'damage':
        if (event.actorId === 'player') this.damage();
        break;
      case 'pickup':
        this.tone(620, 0.09, 0.07, 'sine');
        this.tone(event.kind === 'medkit' ? 930 : 1240, 0.12, 0.05, 'sine', 0.075);
        break;
      case 'kill':
        if (event.killerId === 'player') {
          this.tone(780, 0.09, 0.055, 'triangle');
          this.tone(1040, 0.13, 0.055, 'triangle', 0.075);
        }
        break;
      case 'end':
        if (event.won) {
          [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
            this.tone(frequency, index === 3 ? 0.6 : 0.23, 0.085, 'triangle', index * 0.15);
          });
          this.tone(261.63, 0.75, 0.065, 'sine', 0.45);
        } else {
          [330, 277.18, 220].forEach((frequency, index) => {
            this.tone(frequency, index === 2 ? 0.7 : 0.27, 0.075, 'triangle', index * 0.2);
          });
        }
        break;
      case 'message':
        break;
    }
  }

  footstep(sprint: boolean): void {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    if (now - this.lastStep < (sprint ? 0.23 : 0.34)) return;
    this.lastStep = now;
    this.stepSide = !this.stepSide;
    this.noise(0.075, sprint ? 0.085 : 0.055, 'lowpass', this.stepSide ? 480 : 620);
    this.tone(this.stepSide ? 76 : 88, 0.065, sprint ? 0.07 : 0.045, 'sine', 0, 42);
  }

  reload(): void {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    if (now - this.lastReload < 0.4) return;
    this.lastReload = now;
    this.noise(0.06, 0.09, 'bandpass', 1700);
    this.tone(220, 0.045, 0.08, 'square', 0, 90);
    this.noise(0.09, 0.11, 'bandpass', 2600, 0.22);
    this.tone(470, 0.035, 0.055, 'triangle', 0.25, 230);
  }

  heal(): void {
    if (!this.ready()) return;
    const now = this.context!.currentTime;
    if (now - this.lastHeal < 0.8) return;
    this.lastHeal = now;
    this.noise(0.12, 0.045, 'highpass', 3400);
    this.tone(440, 0.18, 0.055, 'sine', 0.1);
    this.tone(660, 0.22, 0.045, 'sine', 0.26);
  }

  /** Cancel even future scheduled notes immediately when gameplay is paused. */
  pause(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* An ended source is already silent. */ }
    }
    this.sources.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
    this.master?.disconnect();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }

  private ready(): boolean {
    return !this.disposed && this.volume > 0 && this.context?.state === 'running' && !!this.master;
  }

  private gunshot(weapon: WeaponType, gain: number, distance: number): void {
    // Distance rolls off high frequencies as well as volume.
    const brightness = Math.max(650, 4500 - distance * 25);
    switch (weapon) {
      case 'rifle':
        this.noise(0.14, 0.43 * gain, 'lowpass', brightness);
        this.tone(180, 0.105, 0.24 * gain, 'triangle', 0, 48);
        this.tone(980, 0.024, 0.11 * gain, 'triangle', 0, 150);
        this.noise(0.12, 0.055 * gain, 'bandpass', 1100, 0.045);
        break;
      case 'shotgun':
        this.noise(0.29, 0.62 * gain, 'lowpass', brightness * 0.7);
        this.tone(135, 0.23, 0.36 * gain, 'triangle', 0, 34);
        this.tone(360, 0.07, 0.11 * gain, 'sawtooth', 0, 65);
        this.noise(0.22, 0.1 * gain, 'lowpass', 700, 0.08);
        break;
      case 'smg':
        this.noise(0.075, 0.26 * gain, 'lowpass', brightness * 0.7);
        this.tone(255, 0.055, 0.16 * gain, 'triangle', 0, 105);
        this.tone(720, 0.018, 0.065 * gain, 'square', 0, 260);
        this.noise(0.025, 0.08 * gain, 'bandpass', 1700, 0.025);
        break;
      case 'pistol':
        this.noise(0.11, 0.34 * gain, 'lowpass', brightness * 1.15);
        this.tone(310, 0.085, 0.18 * gain, 'triangle', 0, 75);
        this.tone(1600, 0.018, 0.07 * gain, 'square', 0, 380);
        this.noise(0.035, 0.08 * gain, 'bandpass', 2400, 0.025);
        break;
      case 'dmr':
        this.noise(0.20, 0.53 * gain, 'lowpass', brightness);
        this.tone(170, 0.18, 0.29 * gain, 'triangle', 0, 39);
        this.tone(1330, 0.035, 0.13 * gain, 'triangle', 0, 170);
        this.noise(0.16, 0.08 * gain, 'bandpass', 1300, 0.06);
        break;
      case 'sniper':
        this.noise(0.34, 0.68 * gain, 'lowpass', brightness);
        this.tone(125, 0.30, 0.40 * gain, 'triangle', 0, 30);
        this.tone(1750, 0.042, 0.15 * gain, 'sawtooth', 0, 150);
        this.noise(0.26, 0.12 * gain, 'bandpass', 850, 0.10);
        break;
      case 'heavySniper':
        this.noise(0.50, 0.84 * gain, 'lowpass', brightness * 0.75);
        this.tone(92, 0.46, 0.52 * gain, 'triangle', 0, 23);
        this.tone(1100, 0.055, 0.20 * gain, 'sawtooth', 0, 70);
        this.noise(0.40, 0.18 * gain, 'lowpass', 900, 0.13);
        break;
      case 'lmg':
        this.noise(0.17, 0.47 * gain, 'lowpass', brightness * 0.85);
        this.tone(155, 0.12, 0.28 * gain, 'triangle', 0, 40);
        this.tone(550, 0.030, 0.13 * gain, 'square', 0, 110);
        this.noise(0.045, 0.12 * gain, 'bandpass', 1400, 0.035);
        break;
    }
    if (WEAPONS[weapon].fireMode === 'bolt') {
      // Only a nearby rifle's bolt is audible; its report travels much farther.
      const actionGain = gain / (1 + distance / 10);
      const delay = weapon === 'heavySniper' ? 0.64 : 0.45;
      this.noise(0.045, 0.15 * actionGain, 'bandpass', 2200, delay);
      this.tone(285, 0.025, 0.09 * actionGain, 'triangle', delay, 130);
      this.noise(0.08, 0.12 * actionGain, 'bandpass', 1550, delay + 0.16);
      this.tone(470, 0.035, 0.08 * actionGain, 'square', delay + 0.20, 190);
    }
  }

  private hit(): void {
    this.tone(1450, 0.045, 0.075, 'triangle', 0.025, 1050);
    this.noise(0.025, 0.055, 'bandpass', 2400, 0.025);
  }

  private damage(): void {
    const now = this.context!.currentTime;
    if (now - this.lastDamage < 0.18) return;
    this.lastDamage = now;
    this.noise(0.09, 0.2, 'lowpass', 900);
    this.tone(100, 0.17, 0.22, 'sine', 0, 38);
  }

  private tone(
    frequency: number,
    duration: number,
    gain: number,
    type: OscillatorType,
    delay = 0,
    endFrequency = frequency,
  ): void {
    const context = this.context!;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
    this.envelope(envelope.gain, start, duration, gain);
    oscillator.connect(envelope);
    envelope.connect(this.master!);
    this.track(oscillator, [envelope]);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.015);
  }

  private noise(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    frequency: number,
    delay = 0,
  ): void {
    const context = this.context!;
    const start = context.currentTime + delay;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    filter.Q.value = 0.7;
    const envelope = context.createGain();
    this.envelope(envelope.gain, start, duration, gain);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master!);
    this.track(source, [filter, envelope]);
    source.start(start, Math.random() * 0.3);
    source.stop(start + duration + 0.015);
  }

  private envelope(parameter: AudioParam, start: number, duration: number, gain: number): void {
    parameter.setValueAtTime(0.0001, start);
    parameter.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.003);
    parameter.exponentialRampToValueAtTime(0.0001, start + duration);
  }

  private track(source: AudioScheduledSourceNode, nodes: AudioNode[]): void {
    // Bound the graph even if a game/event bug creates too many effects at once.
    if (this.sources.size >= 96) {
      const oldest = this.sources.values().next().value as AudioScheduledSourceNode | undefined;
      if (oldest) {
        try { oldest.stop(); } catch { /* Already ended. */ }
        this.sources.delete(oldest);
      }
    }
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    };
  }
}
