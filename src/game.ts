export const COLORS: Record<string, string> = {
  black: "#2b2d42",
  red: "#ef476f",
  orange: "#ff9f1c",
  yellow: "#ffd23f",
  green: "#06d6a0",
  blue: "#118ab2",
  purple: "#9b5de5",
  pink: "#f15bb5",
};

export interface Stroke {
  color: string; // key of COLORS
  size: number; // line width in px
  erase?: boolean; // an eraser stroke removes what is under it
  points: { x: number; y: number }[]; // 0..1 of the canvas
}

export const BRUSH_SIZES = { small: 6, medium: 11, large: 22 } as const;
export type BrushSize = keyof typeof BRUSH_SIZES;
export const ERASER_SCALE = 2.4; // the eraser is wider than the pen of the same size name

// How long each artist has to draw, chosen on the setup screen.
export const TIMER_OPTIONS = [30, 60, 90, 120] as const;

const WORDS = [
  "cat", "dog", "house", "tree", "car", "sun", "moon", "star", "fish", "bird",
  "flower", "boat", "pizza", "apple", "banana", "guitar", "robot", "rocket",
  "umbrella", "snowman", "rainbow", "bicycle", "castle", "dragon", "elephant",
  "ice cream", "butterfly", "airplane", "mountain", "pirate",
];

export function pickWord(previous?: string): string {
  let w = previous;
  while (w === previous) w = WORDS[Math.floor(Math.random() * WORDS.length)];
  return w!;
}

const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

// A guess is right if it is the word, or a sentence containing it as whole words.
export function isCorrect(guess: string, word: string): boolean {
  const g = ` ${norm(guess)} `;
  const w = norm(word);
  return g.includes(` ${w} `) || g.includes(` ${w}s `);
}

// "ice cream" -> "_ _ _   _ _ _ _ _"
export const blanks = (word: string) =>
  word.split("").map((c) => (c === " " ? "  " : "_")).join(" ");

// Maps a hand's raw normalized { x, y } into 0..1. The cursor range is relative to the
// viewer's shoulders and not fixed, so learn it as the viewer moves.
export class CursorMapper {
  private minX = -0.5;
  private maxX = 0.5;
  private minY = -0.5;
  private maxY = 0.5;

  map(x: number, y: number): { x: number; y: number } {
    this.minX = Math.min(this.minX, x);
    this.maxX = Math.max(this.maxX, x);
    this.minY = Math.min(this.minY, y);
    this.maxY = Math.max(this.maxY, y);
    return {
      x: (x - this.minX) / (this.maxX - this.minX), // not flipped: the hand's right is the screen's right
      y: (y - this.minY) / (this.maxY - this.minY),
    };
  }
}

export const TURN_SECONDS = 60;
export const ROUNDS = 3; // each player is the artist this many times
export const PEEK_MS = 4000;

export const pickChoices = (previous: string[] = []): string[] => {
  const out: string[] = [];
  while (out.length < 3) {
    const w = pickWord();
    if (!out.includes(w) && !previous.includes(w)) out.push(w);
  }
  return out;
};

// The word with only the revealed letters shown, e.g. "_ a _   _ r _ _ m".
export const hintPattern = (word: string, revealed: Set<number>) =>
  word.split("").map((c, i) => (c === " " ? "  " : revealed.has(i) ? c : "_")).join(" ");

// Reveal one more random letter. Returns the new set (never reveals all of them).
export function revealMore(word: string, revealed: Set<number>): Set<number> {
  const hidden = word.split("").map((c, i) => (c !== " " && !revealed.has(i) ? i : -1)).filter((i) => i >= 0);
  if (hidden.length <= 1) return revealed;
  const next = new Set(revealed);
  next.add(hidden[Math.floor(Math.random() * hidden.length)]);
  return next;
}

// Jeopardy-style board: each category has three difficulty tiers. Harder tiers are worth more.
export const TIERS = [100, 200, 300] as const;

export const CATEGORIES: Record<string, [string[], string[], string[]]> = {
  Animals: [
    ["cat", "dog", "fish", "bird", "cow", "pig"],
    ["elephant", "butterfly", "snake", "penguin", "giraffe", "turtle"],
    ["octopus", "kangaroo", "flamingo", "scorpion", "peacock", "hedgehog"],
  ],
  Food: [
    ["pizza", "apple", "banana", "egg", "cake", "bread"],
    ["ice cream", "hamburger", "popcorn", "pancake", "sandwich", "cookie"],
    ["spaghetti", "sushi", "pineapple", "watermelon", "taco", "lasagna"],
  ],
  Things: [
    ["car", "house", "boat", "chair", "clock", "key"],
    ["umbrella", "guitar", "bicycle", "scissors", "telescope", "lamp"],
    ["microscope", "chandelier", "compass", "hourglass", "typewriter", "parachute"],
  ],
  Places: [
    ["tree", "sun", "moon", "mountain", "beach", "river"],
    ["castle", "volcano", "igloo", "lighthouse", "waterfall", "island"],
    ["pyramid", "skyscraper", "windmill", "stadium", "haunted house", "bridge"],
  ],
  Actions: [
    ["sleep", "run", "jump", "swim", "eat", "cry"],
    ["dancing", "fishing", "sneezing", "painting", "skiing", "juggling"],
    ["babysitting", "sunbathing", "hiccuping", "eavesdropping", "daydreaming", "surfing"],
  ],
};

export function pickFromTile(category: string, tierIdx: number, previous?: string): string {
  const list = CATEGORIES[category][tierIdx];
  let w = previous;
  while (w === previous) w = list[Math.floor(Math.random() * list.length)];
  return w!;
}

// ---- Players: silly names and avatars ----
const ADJECTIVES = [
  "Wobbly", "Giggly", "Captain", "Sneaky", "Fuzzy", "Bouncy", "Sparkly", "Grumpy", "Dizzy", "Super",
  "Sleepy", "Silly", "Zippy", "Crunchy", "Squishy", "Professor", "Mighty", "Jolly", "Goofy", "Cosmic",
];
const NOUNS = [
  "Noodle", "Pickles", "Waffle", "Banana", "Pancake", "Penguin", "Llama", "Muffin", "Pudding", "Taco",
  "Potato", "Bubbles", "Pretzel", "Walrus", "Sprinkles", "Meatball", "Kazoo", "Biscuit", "Turnip", "Cupcake",
];
export const AVATARS = ["unicorn", "octopus", "frog", "dino", "panda", "fox", "tiger", "monkey", "koala", "lion", "penguin", "bee"];

const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

export function sillyName(taken: string[] = []): string {
  for (let i = 0; i < 50; i++) {
    const n = `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
    if (!taken.includes(n)) return n;
  }
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`;
}

export function randomRoster(count: number): { names: string[]; avatars: string[] } {
  const names: string[] = [];
  const avatars: string[] = [];
  for (let i = 0; i < count; i++) {
    names.push(sillyName(names));
    let a = pick(AVATARS);
    while (avatars.includes(a)) a = pick(AVATARS);
    avatars.push(a);
  }
  return { names, avatars };
}

export const CATEGORY_STYLE: Record<string, { color: string }> = {
  Animals: { color: "#ff9f1c" },
  Food: { color: "#ef476f" },
  Things: { color: "#118ab2" },
  Places: { color: "#06d6a0" },
  Actions: { color: "#9b5de5" },
};

// Every word has a hand-built drawing under the same key in src/art; fall back to the category icon.
export const wordArtKey = (word: string, category: string, has: (k: string) => boolean) =>
  has(word) ? word : `cat-${category}`;

// ---- Steadying the drawing hand ----
// A "One Euro" filter: very smooth while the hand is nearly still (so tremor and tracking jitter vanish),
// and quickly less smooth as the hand speeds up (so a fast stroke does not lag behind).
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  // Defaults tuned on simulated tracker jitter: about 4x less shake for roughly 60 to 75 ms of lag.
  constructor(private minCutoff = 0.4, private beta = 1.5, private dCutoff = 0.3) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }

  filter(v: number, tMs: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = tMs;
      return v;
    }
    const dt = Math.max((tMs - this.t) / 1000, 0.001);
    this.t = tMs;
    this.dx += this.alpha(this.dCutoff, dt) * ((v - this.x) / dt - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }
}

export class HandSmoother {
  private fx: OneEuro;
  private fy: OneEuro;
  constructor() {
    this.fx = new OneEuro();
    this.fy = new OneEuro();
  }
  reset() {
    this.fx.reset();
    this.fy.reset();
  }
  filter(p: { x: number; y: number }, tMs: number) {
    return { x: this.fx.filter(p.x, tMs), y: this.fy.filter(p.y, tMs) };
  }
}

// ---- Starting and stopping the pen, and pressing buttons, with your hand ----
// The game measures "holding still" itself, from where the pointer is, instead of relying on the motion kit's
// hold detection. The same rule drives drawing, the toolbar, and every menu, and it drives the loading circle.
export type Side = "left" | "right";
export const otherSide = (s: Side): Side => (s === "right" ? "left" : "right");

export const START_HOLD_MS = 1000; // hold still this long to put the pen down
export const STOP_HOLD_MS = 1200; // a bit longer to lift it, so a pause mid-line does not
export const SELECT_HOLD_MS = 1000; // hold still on a button to press it
export const STILL_RADIUS_PX = 24; // the pointer counts as still while it stays inside a circle this big

// How long the pointer has stayed inside a small circle, in ms. Moving out of the circle starts a new count.
export class StillnessTracker {
  private ax = 0;
  private ay = 0;
  private since = 0;
  private started = false;

  reset() {
    this.started = false;
  }

  update(xPx: number, yPx: number, nowMs: number): number {
    if (!this.started || Math.hypot(xPx - this.ax, yPx - this.ay) > STILL_RADIUS_PX) {
      this.ax = xPx;
      this.ay = yPx;
      this.since = nowMs;
      this.started = true;
      return 0;
    }
    return nowMs - this.since;
  }
}

export interface GestureInput {
  now: number; // ms
  penDown: boolean;
  stillMs: number; // how long the drawing hand has been still
  penArmUp: boolean; // the other arm (not the drawing hand) is raised
}

export class PenGesture {
  ring = 0; // 0..1 progress of the loading circle
  private needMove = false; // after any change the hand must move once, so one hold cannot trigger two changes
  private prevStill = 0;
  private armWas = false;
  private startedBy: "arm" | "hold" | null = null;

  reset() {
    this.ring = 0;
    this.needMove = false;
    this.prevStill = 0;
    this.armWas = false;
    this.startedBy = null;
  }

  // Returns "down" or "up" when the pen should change, otherwise null.
  update(i: GestureInput): "down" | "up" | null {
    if (!i.penDown) this.startedBy = null; // a line started some other way (voice, remote) is never ended by the arm
    // Raising or lowering the other arm: only the moment of change counts, so it works alongside hold-still.
    const raised = i.penArmUp && !this.armWas;
    const lowered = !i.penArmUp && this.armWas;
    this.armWas = i.penArmUp;
    if (raised && !i.penDown) return this.change("down", "arm");
    if (lowered && i.penDown && this.startedBy === "arm") return this.change("up", null);

    if (i.stillMs < this.prevStill) this.needMove = false; // the hand moved: stillness restarted
    this.prevStill = i.stillMs;
    if (this.needMove) {
      this.ring = 0;
      return null;
    }
    this.ring = Math.min(1, i.stillMs / (i.penDown ? STOP_HOLD_MS : START_HOLD_MS));
    if (this.ring >= 1) return i.penDown ? this.change("up", null) : this.change("down", "hold");
    return null;
  }

  private change(to: "down" | "up", by: "arm" | "hold" | null) {
    this.ring = 0;
    this.needMove = true;
    this.startedBy = to === "down" ? by : null;
    return to;
  }
}

// Pressing a button: point at it and hold still. After a press the hand must move before it can press again.
export class HoldSelect {
  ring = 0;
  private needMove = false;
  private prevStill = 0;

  reset() {
    this.ring = 0;
    this.needMove = false;
    this.prevStill = 0;
  }

  // Returns true when the button under the pointer should be pressed.
  update(stillMs: number, hasTarget: boolean): boolean {
    if (stillMs < this.prevStill) this.needMove = false;
    this.prevStill = stillMs;
    if (this.needMove || !hasTarget) {
      this.ring = 0;
      return false;
    }
    this.ring = Math.min(1, stillMs / SELECT_HOLD_MS);
    if (this.ring >= 1) {
      this.ring = 0;
      this.needMove = true;
      return true;
    }
    return false;
  }
}

// Reads one frame of motion-kit output for whether the arm opposite the drawing hand is raised.
interface HeldLike { id: string; phase: string; side?: Side }

export function readPenArm(held: readonly HeldLike[], drawHand: Side): boolean {
  const penSide = otherSide(drawHand);
  return held.some((h) => h.id === "arm-raised" && h.side === penSide && h.phase === "active");
}
