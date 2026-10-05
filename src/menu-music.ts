/**
 * The main-menu theme, played live from code (no audio files): a slow A-minor loop over Am - F - C - G with a warm pad,
 * a soft bass, a plucked arpeggio through an echo, a half-time beat that comes in on the second pass and a sparse lead
 * on every other pass. `stepEvents` is the score (pure data, testable); `MenuMusic` turns it into Web Audio nodes.
 */
export const BPM = 78;
export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = 64;

export type MusicVoice = 'pad' | 'bass' | 'arp' | 'lead' | 'kick' | 'snare' | 'hat';
/** One note or hit starting on a 16th-note step; `steps` is how long it lasts in 16th notes. */
export interface MusicEvent { voice: MusicVoice; midi: number; steps: number; gain: number }

interface Chord { root: number; tones: number[] }
const CHORDS: Chord[] = [
  { root: 45, tones: [0, 3, 7, 10] }, // Am7
  { root: 41, tones: [0, 4, 7, 11] }, // Fmaj7
  { root: 48, tones: [0, 4, 7, 11] }, // Cmaj7
  { root: 43, tones: [0, 4, 7, 10] }, // G7
];
/** [step in the loop, midi note, length in steps] */
const MELODY: Array<[number, number, number]> = [
  [0, 76, 6], [8, 74, 2], [10, 72, 5],
  [16, 72, 6], [24, 69, 4], [28, 72, 3],
  [32, 76, 6], [40, 79, 2], [42, 76, 5],
  [48, 74, 6], [56, 71, 4], [60, 69, 4],
];
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 1];

export const midiToHz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

/** Everything that starts on this step of the (endlessly repeating) song. */
export function stepEvents(step: number): MusicEvent[] {
  const events: MusicEvent[] = [];
  const loop = Math.floor(step / LOOP_STEPS), inLoop = step % LOOP_STEPS;
  const bar = Math.floor(inLoop / STEPS_PER_BAR), beat = inLoop % STEPS_PER_BAR;
  const chord = CHORDS[bar];
  const driving = loop >= 1;
  if (beat === 0) {
    for (const [index, tone] of chord.tones.entries()) events.push({ voice: 'pad', midi: chord.root + (index === 3 ? 24 : 12) + tone, steps: 19, gain: 0.05 });
  }
  if (beat === 0) events.push({ voice: 'bass', midi: chord.root, steps: 8, gain: 0.2 });
  if (driving && beat === 10) events.push({ voice: 'bass', midi: chord.root, steps: 3, gain: 0.15 });
  if (driving && beat === 14) events.push({ voice: 'bass', midi: chord.root + 7, steps: 2, gain: 0.12 });
  if (beat % 2 === 0) events.push({ voice: 'arp', midi: chord.root + 24 + chord.tones[ARP_ORDER[beat / 2]], steps: 3, gain: beat === 0 ? 0.09 : 0.06 });
  if (driving) {
    if (beat === 0 || beat === 10) events.push({ voice: 'kick', midi: 0, steps: 2, gain: 0.5 });
    if (beat === 8) events.push({ voice: 'snare', midi: 0, steps: 2, gain: 0.22 });
    if (beat % 4 === 2) events.push({ voice: 'hat', midi: 0, steps: 1, gain: 0.11 });
    else if (beat === 4 || beat === 12) events.push({ voice: 'hat', midi: 0, steps: 1, gain: 0.06 });
  }
  if (loop % 2 === 1) {
    for (const [at, midi, steps] of MELODY) if (at === inLoop) events.push({ voice: 'lead', midi, steps, gain: 0.07 });
  }
  return events;
}

/** Plays the theme on an audio context; connect `destination` to wherever music should go. */
export class MenuMusic {
  private readonly out: GainNode;
  private readonly bus: GainNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly noise: AudioBuffer;
  private readonly stepSeconds = 60 / BPM / 4;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextStep = 0;
  private nextTime = 0;

  constructor(private readonly context: BaseAudioContext, destination: AudioNode) {
    const out = context.createGain();
    out.gain.value = 0;
    out.connect(destination);
    this.out = out;
    this.bus = context.createGain();
    this.bus.connect(out);
    // A small synthetic room: decaying noise as the impulse response.
    const length = Math.ceil(context.sampleRate * 2.6);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
    const reverb = context.createConvolver();
    reverb.buffer = impulse;
    this.reverbSend = context.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(reverb);
    reverb.connect(out);
    // A dotted-eighth echo that fades into the dark.
    const delay = context.createDelay(2);
    delay.delayTime.value = this.stepSeconds * 3;
    const feedback = context.createGain();
    feedback.gain.value = 0.38;
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2200;
    this.delaySend = context.createGain();
    this.delaySend.gain.value = 0.5;
    this.delaySend.connect(delay);
    delay.connect(tone); tone.connect(feedback); feedback.connect(delay);
    tone.connect(out);
    this.noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.6), context.sampleRate);
    const noise = this.noise.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = Math.random() * 2 - 1;
  }

  get running(): boolean { return this.timer !== null; }

  /** Fade in and play from the top of the song. */
  start(): void {
    if (this.timer !== null) return;
    const now = this.context.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0.85, now, 0.7);
    this.nextStep = 0;
    this.nextTime = now + 0.15;
    this.schedule(now + 1.5);
    // Schedule well ahead: timers slow down in background tabs, audio time does not.
    this.timer = setInterval(() => this.schedule(this.context.currentTime + 1.5), 250);
  }

  /** Fade out; notes already scheduled die away with the fade. */
  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
    const now = this.context.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setTargetAtTime(0, now, 0.3);
  }

  /** Queue every note that starts before `horizon` (audio-clock seconds). Public so tests can render offline. */
  schedule(horizon: number): void {
    while (this.nextTime < horizon) {
      for (const event of stepEvents(this.nextStep)) this.play(event, this.nextTime);
      this.nextStep++;
      this.nextTime += this.stepSeconds;
    }
  }

  private play(event: MusicEvent, at: number): void {
    const seconds = event.steps * this.stepSeconds;
    switch (event.voice) {
      case 'pad':
        for (const detune of [-7, 7]) this.tone('sawtooth', midiToHz(event.midi), at, seconds, event.gain, { attack: 0.9, release: 1.3, detune, filter: 950, reverb: 0.8 });
        break;
      case 'bass':
        this.tone('sine', midiToHz(event.midi), at, seconds, event.gain, { attack: 0.02, release: 0.25 });
        this.tone('sawtooth', midiToHz(event.midi), at, seconds, event.gain * 0.35, { attack: 0.02, release: 0.2, filter: 380 });
        break;
      case 'arp':
        this.tone('triangle', midiToHz(event.midi), at, 0.02, event.gain, { attack: 0.004, release: seconds * 1.6, reverb: 0.5, delay: 1 });
        break;
      case 'lead':
        this.tone('sine', midiToHz(event.midi), at, seconds, event.gain, { attack: 0.06, release: 0.7, reverb: 0.9, delay: 0.8, vibrato: true });
        break;
      case 'kick': {
        const osc = this.context.createOscillator(), gain = this.context.createGain();
        osc.frequency.setValueAtTime(125, at); osc.frequency.exponentialRampToValueAtTime(42, at + 0.16);
        gain.gain.setValueAtTime(event.gain, at); gain.gain.exponentialRampToValueAtTime(0.001, at + 0.32);
        osc.connect(gain); gain.connect(this.bus);
        osc.start(at); osc.stop(at + 0.35);
        break;
      }
      case 'snare':
        this.burst(at, 0.2, event.gain, 'bandpass', 1900, 0.9, true);
        this.tone('triangle', 190, at, 0.01, event.gain * 0.5, { attack: 0.002, release: 0.1 });
        break;
      case 'hat':
        this.burst(at, 0.05, event.gain, 'highpass', 7500, 0.7, false);
        break;
    }
  }

  private tone(type: OscillatorType, hz: number, at: number, hold: number, peak: number, options: { attack?: number; release?: number; detune?: number; filter?: number; reverb?: number; delay?: number; vibrato?: boolean } = {}): void {
    const context = this.context;
    const attack = options.attack ?? 0.01, release = options.release ?? 0.2;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = type;
    osc.frequency.value = hz;
    if (options.detune) osc.detune.value = options.detune;
    const end = at + Math.max(attack, hold);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + attack);
    gain.gain.setValueAtTime(peak, end);
    gain.gain.exponentialRampToValueAtTime(0.0001, end + release);
    let node: AudioNode = osc;
    if (options.filter) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = options.filter;
      node.connect(filter); node = filter;
    }
    node.connect(gain);
    gain.connect(this.bus);
    if (options.reverb) { const send = context.createGain(); send.gain.value = options.reverb; gain.connect(send); send.connect(this.reverbSend); }
    if (options.delay) { const send = context.createGain(); send.gain.value = options.delay; gain.connect(send); send.connect(this.delaySend); }
    if (options.vibrato) {
      const lfo = context.createOscillator(), depth = context.createGain();
      lfo.frequency.value = 5.2; depth.gain.value = 6;
      lfo.connect(depth); depth.connect(osc.detune);
      lfo.start(at); lfo.stop(end + release + 0.05);
    }
    osc.start(at);
    osc.stop(end + release + 0.05);
  }

  /** A filtered burst of noise (snare body, hi-hat). */
  private burst(at: number, seconds: number, peak: number, filterType: BiquadFilterType, hz: number, q: number, reverb: boolean): void {
    const context = this.context;
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    source.buffer = this.noise;
    filter.type = filterType; filter.frequency.value = hz; filter.Q.value = q;
    gain.gain.setValueAtTime(peak, at); gain.gain.exponentialRampToValueAtTime(0.001, at + seconds);
    source.connect(filter); filter.connect(gain); gain.connect(this.bus);
    if (reverb) { const send = context.createGain(); send.gain.value = 0.5; gain.connect(send); send.connect(this.reverbSend); }
    source.start(at, Math.random() * 0.3);
    source.stop(at + seconds + 0.02);
  }
}
