// Draw It's sound and music, synthesized live with the Web Audio API: no audio files to ship or license.
// The synthesis functions take any BaseAudioContext, so they can be rendered offline and checked in tests.

export type Mood = "off" | "menu" | "play" | "tense" | "win";
export type Sfx =
  | "click" | "hover" | "blip" | "tile" | "tick" | "tickLast" | "go" | "reveal" | "correct" | "wrong"
  | "timeup" | "fanfare" | "pen" | "penUp" | "swish" | "dice" | "start";
export interface Prefs { sound: boolean; music: boolean }

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// ---------- building blocks ----------
const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseBuffers.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, b);
  }
  return b;
}

interface ToneOpts { type?: OscillatorType; gain?: number; attack?: number; release?: number; lp?: number; freqEnd?: number }

function tone(ctx: BaseAudioContext, dest: AudioNode, freq: number, t: number, dur: number, o: ToneOpts = {}) {
  const osc = ctx.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(freq, t);
  if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
  const g = ctx.createGain();
  const peak = o.gain ?? 0.3;
  const a = Math.min(o.attack ?? 0.006, dur / 2);
  const r = Math.min(o.release ?? 0.12, dur * 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.setValueAtTime(peak, t + Math.max(a, dur - r));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node: AudioNode = osc;
  if (o.lp) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = o.lp;
    osc.connect(f);
    node = f;
  }
  node.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

interface NoiseOpts { gain?: number; hp?: number; lp?: number; bp?: number; bpEnd?: number }

function noise(ctx: BaseAudioContext, dest: AudioNode, t: number, dur: number, o: NoiseOpts = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  let node: AudioNode = src;
  const chain = (type: BiquadFilterType, f: number, fEnd?: number) => {
    const bq = ctx.createBiquadFilter();
    bq.type = type;
    bq.frequency.setValueAtTime(f, t);
    if (fEnd) bq.frequency.exponentialRampToValueAtTime(fEnd, t + dur);
    if (type === "bandpass") bq.Q.value = 1.1;
    node.connect(bq);
    node = bq;
  };
  if (o.hp) chain("highpass", o.hp);
  if (o.lp) chain("lowpass", o.lp);
  if (o.bp) chain("bandpass", o.bp, o.bpEnd);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + Math.min(0.006, dur / 2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  node.connect(g);
  g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.03);
}

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number, gain = 0.5) {
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  o.connect(g);
  g.connect(dest);
  o.start(t);
  o.stop(t + 0.2);
}

// ---------- sound effects ----------
type SfxFn = (ctx: BaseAudioContext, dest: AudioNode, t: number) => void;

const SFX: Record<Sfx, SfxFn> = {
  click: (c, d, t) => {
    tone(c, d, 660, t, 0.05, { type: "square", gain: 0.11, lp: 3000 });
    tone(c, d, 990, t + 0.035, 0.06, { type: "square", gain: 0.08, lp: 3000 });
  },
  hover: (c, d, t) => tone(c, d, 520, t, 0.04, { gain: 0.07 }),
  blip: (c, d, t) => tone(c, d, 880, t, 0.09, { gain: 0.16 }),
  tile: (c, d, t) => {
    tone(c, d, 523, t, 0.1, { type: "triangle", gain: 0.26 });
    tone(c, d, 784, t + 0.08, 0.16, { type: "triangle", gain: 0.26 });
    noise(c, d, t + 0.08, 0.12, { hp: 6000, gain: 0.04 });
  },
  tick: (c, d, t) => tone(c, d, 1000, t, 0.06, { type: "triangle", gain: 0.22, release: 0.05 }),
  tickLast: (c, d, t) => tone(c, d, 1400, t, 0.1, { type: "triangle", gain: 0.3, release: 0.08 }),
  go: (c, d, t) => {
    noise(c, d, t, 0.5, { bp: 300, bpEnd: 3200, gain: 0.22 });
    tone(c, d, 160, t, 0.45, { gain: 0.24, freqEnd: 640 });
  },
  reveal: (c, d, t) => {
    tone(c, d, 220, t, 0.2, { gain: 0.3, freqEnd: 660 });
    [72, 76, 79, 84].forEach((n, i) => tone(c, d, hz(n), t + 0.13 + i * 0.07, 0.14, { type: "triangle", gain: 0.2 }));
  },
  correct: (c, d, t) => {
    [72, 76, 79, 84].forEach((n, i) => tone(c, d, hz(n), t + i * 0.08, 0.16, { type: "square", gain: 0.14, lp: 2600 }));
    tone(c, d, hz(96), t + 0.34, 0.3, { gain: 0.1 });
    noise(c, d, t + 0.3, 0.3, { hp: 7000, gain: 0.05 });
  },
  wrong: (c, d, t) => {
    tone(c, d, 233, t, 0.22, { type: "sawtooth", gain: 0.2, lp: 900, freqEnd: 165 });
    tone(c, d, 196, t + 0.2, 0.3, { type: "sawtooth", gain: 0.2, lp: 900, freqEnd: 130 });
  },
  timeup: (c, d, t) => {
    [392, 370, 349].forEach((f, i) => tone(c, d, f, t + i * 0.2, 0.2, { type: "triangle", gain: 0.25 }));
    tone(c, d, 330, t + 0.6, 0.6, { type: "triangle", gain: 0.25, freqEnd: 262 });
  },
  fanfare: (c, d, t) => {
    const brass = (n: number, at: number, dur: number, g = 0.13) => tone(c, d, hz(n), at, dur, { type: "sawtooth", gain: g, lp: 2200 });
    brass(60, t, 0.14); brass(64, t + 0.15, 0.14); brass(67, t + 0.3, 0.14);
    brass(72, t + 0.45, 0.6); brass(64, t + 0.45, 0.6, 0.08); brass(67, t + 0.45, 0.6, 0.08);
    kick(c, d, t + 0.45, 0.4);
    noise(c, d, t + 0.45, 0.5, { hp: 6000, gain: 0.05 });
  },
  pen: (c, d, t) => tone(c, d, 330, t, 0.04, { gain: 0.1 }),
  penUp: (c, d, t) => tone(c, d, 247, t, 0.04, { gain: 0.08 }),
  swish: (c, d, t) => noise(c, d, t, 0.22, { bp: 6000, bpEnd: 800, gain: 0.2 }),
  dice: (c, d, t) => {
    for (let i = 0; i < 6; i++) tone(c, d, 500 + Math.random() * 500, t + i * 0.06, 0.04, { type: "square", gain: 0.07, lp: 3500 });
  },
  start: (c, d, t) => [60, 64, 67, 72, 76].forEach((n, i) => tone(c, d, hz(n), t + i * 0.07, 0.12, { type: "triangle", gain: 0.22 })),
};

export function renderSfx(ctx: BaseAudioContext, dest: AudioNode, name: Sfx, t: number) {
  SFX[name](ctx, dest, t);
}

// ---------- music ----------
// Each track loops over `bars` bars of 16 sixteenth-note steps. Everything is generated from the
// chord progression, so the loops stay in key and sound friendly.
interface Track {
  bpm: number;
  bars: number;
  step: (ctx: BaseAudioContext, dest: AudioNode, bar: number, s: number, t: number, stepDur: number) => void;
}

const MENU_MELODY = [
  [72, 0, 76, 0, 79, 0, 76, 0, 72, 0, 76, 79, 0, 76, 0, 0],
  [69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 76, 0, 72, 0, 0],
  [65, 0, 69, 0, 72, 0, 69, 0, 65, 0, 69, 72, 0, 69, 0, 0],
  [67, 0, 71, 0, 74, 0, 71, 0, 67, 71, 74, 0, 79, 0, 74, 0],
];
const MENU_ROOTS = [48, 45, 41, 43]; // C A F G
const PLAY_TRIADS = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]; // Am F C G
const TENSE_TRIADS = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]; // Am F Dm E
const WIN_TRIADS = [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]]; // C G Am F

const hat = (c: BaseAudioContext, d: AudioNode, t: number, g = 0.05) => noise(c, d, t, 0.04, { hp: 7000, gain: g });
const snare = (c: BaseAudioContext, d: AudioNode, t: number, g = 0.12) => noise(c, d, t, 0.1, { bp: 1800, gain: g });

const TRACKS: Record<Exclude<Mood, "off">, Track> = {
  // Bouncy and bright for menus and the board.
  menu: {
    bpm: 112, bars: 4,
    step: (c, d, bar, s, t, sd) => {
      const root = MENU_ROOTS[bar];
      if ([0, 6, 8, 14].includes(s)) tone(c, d, hz(root), t, sd * 2.4, { type: "triangle", gain: 0.2 });
      if ([3, 11].includes(s)) tone(c, d, hz(root + 7), t, sd * 2, { type: "triangle", gain: 0.16 });
      const m = MENU_MELODY[bar][s];
      if (m) tone(c, d, hz(m), t, sd * 1.7, { type: "square", gain: 0.07, lp: 2400 });
      if (s === 0 || s === 8) kick(c, d, t, 0.32);
      if (s === 4 || s === 12) snare(c, d, t, 0.08);
      if (s % 4 === 2) hat(c, d, t, 0.04);
    },
  },
  // Calm and thinky while someone draws.
  play: {
    bpm: 92, bars: 4,
    step: (c, d, bar, s, t, sd) => {
      const tri = PLAY_TRIADS[bar];
      if (s === 0) tone(c, d, hz(tri[0] - 12), t, sd * 7, { gain: 0.2 });
      if (s === 8) tone(c, d, hz(tri[0] - 5), t, sd * 6, { gain: 0.15 });
      if (s % 2 === 0) {
        const n = tri[[0, 1, 2, 1][(s / 2) % 4]] + 12;
        tone(c, d, hz(n), t, sd * 1.9, { type: "triangle", gain: 0.09, release: 0.14 });
      }
      if (s % 4 === 2) noise(c, d, t, 0.05, { hp: 8000, gain: 0.018 });
    },
  },
  // Faster and minor for the last ten seconds.
  tense: {
    bpm: 150, bars: 4,
    step: (c, d, bar, s, t, sd) => {
      const tri = TENSE_TRIADS[bar];
      if (s % 2 === 0) tone(c, d, hz(tri[0] - (s % 4 === 0 ? 12 : 0)), t, sd * 1.6, { type: "square", gain: 0.09, lp: 700 });
      tone(c, d, hz(tri[s % 3] + 12), t, sd * 0.9, { type: "sawtooth", gain: 0.035, lp: 1800 });
      if (s % 4 === 0) kick(c, d, t, 0.34);
      if (s === 4 || s === 12) snare(c, d, t, 0.09);
      hat(c, d, t, 0.035);
    },
  },
  // Celebration for the podium.
  win: {
    bpm: 126, bars: 4,
    step: (c, d, bar, s, t, sd) => {
      const tri = WIN_TRIADS[bar];
      if (s === 0 || s === 8) tone(c, d, hz(tri[0] - 12), t, sd * 4, { type: "triangle", gain: 0.2 });
      if (s === 4 || s === 12) tone(c, d, hz(tri[0] - 5), t, sd * 3, { type: "triangle", gain: 0.15 });
      if (s % 2 === 0) tone(c, d, hz(tri[(s / 2) % 3] + 12 + (s >= 8 ? 12 : 0)), t, sd * 1.7, { type: "square", gain: 0.07, lp: 2800 });
      if (s === 0 || s === 8) kick(c, d, t, 0.34);
      if (s === 4 || s === 12) snare(c, d, t, 0.1);
      if (s % 2 === 1) hat(c, d, t, 0.04);
    },
  },
};

export const stepSeconds = (mood: Exclude<Mood, "off">) => 60 / TRACKS[mood].bpm / 4;

export function scheduleStep(ctx: BaseAudioContext, dest: AudioNode, mood: Exclude<Mood, "off">, stepIdx: number, t: number) {
  const tr = TRACKS[mood];
  const s = stepIdx % 16;
  const bar = Math.floor(stepIdx / 16) % tr.bars;
  tr.step(ctx, dest, bar, s, t, 60 / tr.bpm / 4);
}

// ---------- the live engine ----------
const STORAGE_KEY = "draw-it.audio";
const MUSIC_LEVEL = 0.34;
const SFX_LEVEL = 0.9;

export class AudioEngine {
  ctx: AudioContext | null = null;
  prefs: Prefs = { sound: true, music: true };
  onChange: () => void = () => {};

  private sfxGain!: GainNode;
  private musicGain!: GainNode;
  private duckGain!: GainNode;
  private moodNode: GainNode | null = null;
  private current: Mood = "off";
  private timer = 0;
  private stepIdx = 0;
  private nextT = 0;
  private duckTimer = 0;
  private lastHover = 0;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved.sound === "boolean" && typeof saved.music === "boolean") this.prefs = saved;
    } catch {
      /* no storage: use defaults */
    }
  }

  /** The music track that should be playing right now ("off" for silence). */
  get playing(): Mood {
    return this.prefs.music && this.timer ? this.current : "off";
  }

  /** "running", "suspended" (the browser is waiting for a first tap or key), or "none". */
  get state(): string {
    return this.ctx?.state ?? "none";
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.duckGain = ctx.createGain();
    this.sfxGain.connect(master);
    this.musicGain.connect(this.duckGain);
    this.duckGain.connect(master);
    ctx.onstatechange = () => {
      if (ctx.state === "running") this.refreshMusic();
      this.onChange();
    };
    this.ctx = ctx;
    this.applyGains();
    this.refreshMusic(); // a track may have been requested before the context existed
    return ctx;
  }

  private applyGains() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.prefs.sound ? SFX_LEVEL : 0, now, 0.03);
    this.musicGain.gain.setTargetAtTime(this.prefs.music ? MUSIC_LEVEL : 0, now, 0.05);
  }

  /** Call from any tap or key press: browsers keep audio locked until then. */
  unlock() {
    const c = this.ensure();
    if (c && c.state === "suspended") void c.resume().catch(() => {});
  }

  setPrefs(p: Partial<Prefs>) {
    this.prefs = { ...this.prefs, ...p };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* ignore */
    }
    this.applyGains();
    this.refreshMusic();
    this.onChange();
  }

  suspend() {
    void this.ctx?.suspend().catch(() => {});
  }

  resume() {
    void this.ctx?.resume().catch(() => {});
  }

  sfx(name: Sfx) {
    if (!this.prefs.sound) return;
    if (name === "hover") {
      const n = performance.now();
      if (n - this.lastHover < 70) return;
      this.lastHover = n;
    }
    const c = this.ensure();
    if (!c || c.state !== "running") return;
    SFX[name](c, this.sfxGain, c.currentTime + 0.005);
  }

  mood(m: Mood) {
    if (m === this.current) return;
    this.current = m;
    this.refreshMusic();
    this.onChange();
  }

  /** Lower the music for a moment so the TV's voice is easy to hear. */
  duck(ms = 2600) {
    const c = this.ctx;
    if (!c) return;
    this.duckGain.gain.setTargetAtTime(0.3, c.currentTime, 0.05);
    window.clearTimeout(this.duckTimer);
    this.duckTimer = window.setTimeout(() => this.duckGain.gain.setTargetAtTime(1, c.currentTime, 0.4), ms);
  }

  private stopScheduler() {
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  private refreshMusic() {
    const c = this.ctx;
    if (!c) return;
    // Fade out whatever is playing; its already-scheduled notes go quiet with it.
    const old = this.moodNode;
    if (old) {
      old.gain.setTargetAtTime(0, c.currentTime, 0.12);
      window.setTimeout(() => old.disconnect(), 900);
      this.moodNode = null;
    }
    if (!this.prefs.music || this.current === "off") {
      this.stopScheduler();
      return;
    }
    const node = c.createGain();
    node.gain.setValueAtTime(0.0001, c.currentTime);
    node.gain.setTargetAtTime(1, c.currentTime + 0.05, 0.2);
    node.connect(this.musicGain);
    this.moodNode = node;
    this.stepIdx = 0;
    this.nextT = c.currentTime + 0.08;
    if (!this.timer) this.timer = window.setInterval(() => this.pump(), 80);
    this.pump();
  }

  private pump() {
    const c = this.ctx;
    const node = this.moodNode;
    const mood = this.current;
    if (!c || !node || mood === "off" || c.state !== "running") return;
    const sd = stepSeconds(mood);
    if (this.nextT < c.currentTime) this.nextT = c.currentTime + 0.02; // we fell behind (tab was busy)
    while (this.nextT < c.currentTime + 0.3) {
      scheduleStep(c, node, mood, this.stepIdx, this.nextT);
      this.nextT += sd;
      this.stepIdx += 1;
    }
  }
}

export const audio = new AudioEngine();
