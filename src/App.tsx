import { useLittleApp, useLittleEnter, useLittlePaused, useLittleTool, useLittleVisible } from "@kabletv/little-react";
import { createMotionSession } from "@kabletv/little-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CATEGORIES, CATEGORY_STYLE, COLORS, CursorMapper, HandSmoother, HoldSelect, otherSide, PenGesture, readPenArm, StillnessTracker, isCorrect, pickFromTile, randomRoster, ROUNDS, sillyName, TIERS,
  BRUSH_SIZES, ERASER_SCALE, TIMER_OPTIONS, TURN_SECONDS, wordArtKey, type BrushSize, type Side, type Stroke,
} from "./game";
import { Art, hasArt } from "./art/Art";
import { audio, type Mood } from "./audio";

const REMOTE_SPEED = 0.45; // canvas widths per second at full speed
const REVEAL_MS = 4500; // long enough to enjoy the popping, wiggling answer
const COUNTDOWN_S = 5; // everyone but the artist looks away
const MEMORIZE_S = 5; // the artist sees the word
const MAX_NAME = 18;
const TOOLS_ZONE_Y = 0.9; // with the pen up, a hand in the bottom tenth of the canvas is reaching for the tools
const CONFETTI = ["#ef476f", "#ff9f1c", "#ffd23f", "#06d6a0", "#118ab2", "#9b5de5", "#f15bb5"];

type Phase = "start" | "setup" | "board" | "countdown" | "memorize" | "drawing" | "award" | "reveal" | "over";
type Mode = "versus" | "team";

interface Roster {
  players: number;
  drawHand: Side; // which hand draws; the other arm raises to put the pen down
  hand: boolean; // draw with your hand: the only thing that uses the camera, off unless someone turns it on
  mode: Mode; // versus: everyone plays for points; team: one shared score
  seconds: number; // drawing time per turn
  names: string[];
  avatars: string[];
}

interface Game {
  phase: Phase;
  players: number;
  names: string[];
  avatars: string[];
  scores: number[];
  turnPoints: number[]; // points each player earned this turn
  turn: number;
  word: string;
  category: string;
  tierIdx: number;
  used: Set<string>; // "Category:tierIdx" tiles already played
  guessed: Set<number>;
  guesses: string[];
  startedAt: number;
  mode: Mode;
  teamScore: number; // the shared score in team mode
  solvedCount: number; // words solved so far
  solved: boolean; // whether this turn's word was guessed
  awardLeft: number; // seconds left on the clock while waiting to hear who got it
  lastAward: { p: number; pts: number; artistPts: number } | null;
  timeLeft: number;
  turnSeconds: number; // how long each artist gets to draw
  paused: boolean; // the exit confirmation is open and the clock is stopped
  exitOpen: boolean;
  welcome: "resumed" | "restored" | null; // the "welcome back" card is up and the clock is stopped
  phaseAt: number;
  phaseLeft: number;
  message: string;
}

const newGame = (r: Roster): Game => ({
  phase: "board",
  players: r.players,
  names: [...r.names],
  avatars: [...r.avatars],
  scores: Array(r.players).fill(0),
  turnPoints: Array(r.players).fill(0),
  turn: 0,
  word: "",
  category: "",
  tierIdx: 0,
  used: new Set(),
  guessed: new Set(),
  guesses: [],
  startedAt: 0,
  mode: r.mode,
  teamScore: 0,
  solvedCount: 0,
  solved: false,
  awardLeft: 0,
  lastAward: null,
  timeLeft: r.seconds,
  turnSeconds: r.seconds,
  paused: false,
  exitOpen: false,
  welcome: null,
  phaseAt: performance.now(),
  phaseLeft: COUNTDOWN_S,
  message: "",
});

function Confetti({ count = 40 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.5,
        dur: 1.8 + Math.random() * 1.4,
        color: CONFETTI[i % CONFETTI.length],
        rot: Math.floor(Math.random() * 360),
        size: 8 + Math.random() * 10,
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden>
      {pieces.map((p, i) => (
        <i key={i} style={{
          left: `${p.left}%`, background: p.color, width: p.size, height: p.size * 1.6,
          animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)`,
        }} />
      ))}
    </div>
  );
}

const DECOR = ["decor-balloon-red", "decor-star", "decor-palette", "decor-cloud", "decor-crayon", "decor-rainbow", "decor-balloon-blue", "decor-pencil", "decor-balloon-yellow", "decor-party"];
function Decor() {
  return (
    <div className="decor" aria-hidden>
      {DECOR.map((e, i) => (
        <span key={i} style={{ left: `${(i * 10 + 4) % 96}%`, animationDelay: `${-i * 1.7}s`, animationDuration: `${9 + (i % 4) * 2}s`, width: `${4.5 + (i % 3) * 1.6}rem`, height: `${4.5 + (i % 3) * 1.6}rem` }}>
          <Art name={e} />
        </span>
      ))}
    </div>
  );
}

const PAUSED_REPLY = { detail: "paused", say: "We're paused. Press OK or say continue." };

// Every tool lowers the music briefly, because most replies are spoken by the TV's voice.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useTool(name: string, handler: (args: any) => any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useLittleTool(name, (args: any) => {
    audio.duck();
    return handler(args);
  });
}

// A Little app: perception via data-little-* attributes, actuation via useLittleTool.
// Each tool name matches one in public/little/manifest.json.
export default function App() {
  const app = useLittleApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const roster = useRef<Roster>({ players: 2, hand: false, drawHand: "right", mode: "versus", seconds: TURN_SECONDS, ...randomRoster(2) });
  const game = useRef<Game>({ ...newGame(roster.current), phase: "start" });
  const [, setTick] = useState(0);
  const render = () => setTick((t) => t + 1);
  const timers = useRef<number[]>([]);

  const strokes = useRef<Stroke[]>([]);
  const lastStrokes = useRef<Stroke[]>([]); // the drawing from the turn that just ended
  const cursor = useRef({ x: 0.5, y: 0.5 });
  const penDownRef = useRef(false);
  const colorRef = useRef("black");
  const toolRef = useRef<"pen" | "eraser">("pen");
  const brushRef = useRef<BrushSize>("medium");
  const mapper = useRef(new CursorMapper());
  const smoother = useRef(new HandSmoother()); // steadies the hand so the pen does not shake
  const gesture = useRef(new PenGesture()); // when the pen goes down and up, from hand movements
  const still = useRef(new StillnessTracker()); // how long the drawing hand has stayed put
  const hold = useRef(new HoldSelect()); // pressing buttons by holding still on them
  const hoverEl = useRef<HTMLElement | null>(null); // the button the hand is pointing at
  const pointerRef = useRef<HTMLDivElement>(null); // the on-screen hand pointer
  const zoneRef = useRef<HTMLDivElement>(null); // the "tools" strip at the bottom of the canvas
  const lastHandAt = useRef(0); // when the hand was last seen, to hide the pointer when it is lost
  const keys = useRef(new Set<string>());
  const videoRef = useRef<HTMLVideoElement>(null);
  const mirrorCanvasRef = useRef<HTMLCanvasElement>(null);
  const dwell = useRef(0); // 0..1 progress of the hold-still gesture that toggles the pen
  const camStream = useRef<MediaStream | null>(null);

  const [penDown, setPenDownState] = useState(false);
  const [color, setColorState] = useState("black");
  const [tool, setToolState] = useState<"pen" | "eraser">("pen");
  const [brush, setBrushState] = useState<BrushSize>("medium");
  const [source, setSource] = useState("remote or mouse");
  const [motionState, setMotionState] = useState("starting");
  const [motionReason, setMotionReason] = useState<string | null>(null);
  const [cameraOk, setCameraOk] = useState<boolean | null>(null);
  const [handSeen, setHandSeen] = useState(false);
  const [penArmUp, setPenArmUp] = useState(false);
  const [results, setResults] = useState(0);
  const [popup, setPopup] = useState<{ kind: "wrong" | "right"; text: string; n: number } | null>(null);
  const popupTimer = useRef(0);

  const visible = useLittleVisible();
  const g = game.current;
  const r = roster.current;
  const handOn = r.hand;
  const drawHand = r.drawHand;
  const penArm = otherSide(drawHand);
  const artist = g.turn % g.players;
  const round = Math.floor(g.turn / g.players) + 1;
  const inMatch = g.phase !== "start" && g.phase !== "setup";

  const showPopup = (kind: "wrong" | "right", text: string) => {
    window.clearTimeout(popupTimer.current);
    setPopup({ kind, text, n: Date.now() });
    audio.sfx(kind === "right" ? "correct" : "wrong");
    popupTimer.current = window.setTimeout(() => setPopup(null), kind === "right" ? 2600 : 1800);
  };

  const newStroke = (): Stroke => ({
    color: colorRef.current,
    size: BRUSH_SIZES[brushRef.current],
    erase: toolRef.current === "eraser",
    points: [{ ...cursor.current }],
  });

  const setPen = (down: boolean) => {
    if (down === penDownRef.current) return;
    if (down && (game.current.phase !== "drawing" || game.current.paused)) return;
    penDownRef.current = down;
    setPenDownState(down);
    audio.sfx(down ? "pen" : "penUp");
    if (down) strokes.current.push(newStroke());
  };

  // Changing the tool mid-stroke starts a new stroke so the old one keeps its look.
  const setTool = (t: "pen" | "eraser") => {
    toolRef.current = t;
    setToolState(t);
    if (penDownRef.current) strokes.current.push(newStroke());
  };

  const setBrush = (b: BrushSize) => {
    brushRef.current = b;
    setBrushState(b);
    if (penDownRef.current) strokes.current.push(newStroke());
  };

  const setColor = (c: string) => {
    colorRef.current = c;
    setColorState(c);
    if (toolRef.current === "eraser") setTool("pen"); // picking a color means you want to draw
    else if (penDownRef.current) strokes.current.push(newStroke());
  };

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  const resetCanvasPen = () => {
    penDownRef.current = false;
    setPenDownState(false);
  };

  const resetCanvas = () => {
    strokes.current = [];
    penDownRef.current = false;
    setPenDownState(false);
  };

  const clearTimers = () => {
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
  };

  // ---- roster (start screen and setup) ----
  const setPlayers = (n: number, renderNow = true) => {
    const count = Math.min(4, Math.max(2, Math.round(n)));
    const cur = roster.current;
    const fresh = randomRoster(4);
    const names = Array.from({ length: count }, (_, i) => cur.names[i] ?? fresh.names[i]);
    const avatars = Array.from({ length: count }, (_, i) => cur.avatars[i] ?? fresh.avatars[i]);
    roster.current = { ...cur, players: count, names, avatars };
    if (renderNow) render();
  };

  const goSetup = (players?: number) => {
    if (players) setPlayers(players, false);
    game.current.phase = "setup";
    render();
  };

  const setName = (i: number, name: string) => {
    if (i < 0 || i >= roster.current.players) return;
    roster.current.names[i] = name.slice(0, MAX_NAME);
    render();
  };

  const shuffleName = (i?: number) => {
    const cur = roster.current;
    if (i === undefined) {
      roster.current = { ...cur, ...randomRoster(cur.players) };
    } else if (i >= 0 && i < cur.players) {
      cur.names[i] = sillyName(cur.names.filter((_, j) => j !== i));
    }
    audio.sfx("dice");
    render();
  };

  const setHand = (on: boolean) => {
    roster.current.hand = on;
    audio.sfx("blip");
    render();
  };

  // The camera was asked for and refused (or this profile can't answer), so go back to the remote.
  const handFailed = () => {
    if (import.meta.env.DEV && (window as unknown as { __keepHand?: boolean }).__keepHand) return; // automated UI checks have no camera
    roster.current.hand = false;
    setCameraOk(false);
    showPopup("wrong", "No camera, so draw with the remote");
    render();
  };

  const setDrawHand = (h: Side) => {
    roster.current.drawHand = h;
    mapper.current = new CursorMapper(); // each hand is measured separately
    smoother.current.reset();
    gesture.current.reset();
    still.current.reset();
    hold.current.reset();
    audio.sfx("blip");
    render();
  };

  const setMode = (m: Mode) => {
    roster.current.mode = m;
    audio.sfx("blip");
    render();
  };

  const setTimerSeconds = (n: number): number => {
    const best = TIMER_OPTIONS.reduce((x, y) => (Math.abs(y - n) < Math.abs(x - n) ? y : x));
    roster.current.seconds = best;
    render();
    return best;
  };

  const displayName = (i: number) => roster.current.names[i]?.trim() || `Player ${i + 1}`;

  // ---- match flow ----
  const beginMatch = () => {
    clearTimers();
    resetCanvas();
    const rr = roster.current;
    rr.names = rr.names.map((_, i) => displayName(i));
    game.current = newGame(rr);
    audio.sfx("start");
    render();
  };

  const nextTurn = () => {
    const s = game.current;
    s.turn += 1;
    resetCanvas();
    if (s.turn >= s.players * ROUNDS) {
      s.phase = "over";
    } else {
      s.phase = "board";
      s.solved = false;
      s.lastAward = null;
      s.turnPoints = Array(s.players).fill(0);
      s.category = "";
      s.guesses = [];
      s.guessed = new Set();
    }
    render();
  };

  const endTurn = (message: string) => {
    const s = game.current;
    s.phase = "reveal";
    s.message = message;
    lastStrokes.current = strokes.current;
    resetCanvas();
    render();
    later(nextTurn, REVEAL_MS);
  };

  // ---- scoring ----
  // Versus: the guesser gets the tile's points and the artist gets half, flat. Speed does not matter.
  const awardTo = (p: number) => {
    const s = game.current;
    const a = s.turn % s.players;
    const pts = TIERS[s.tierIdx];
    const artistPts = Math.round(pts / 2);
    s.scores[p] += pts;
    s.scores[a] += artistPts;
    s.turnPoints[p] += pts;
    s.turnPoints[a] += artistPts;
    s.guessed.add(p);
    s.lastAward = { p, pts, artistPts };
    s.solved = true;
    s.solvedCount += 1;
    showPopup("right", `${s.names[p]} +${pts}`);
    endTurn(`${s.names[p]} got it!`); // the round ends on the first correct guess
  };

  // Team: everyone shares one score, so no one needs to say who guessed.
  const teamSolved = () => {
    const s = game.current;
    const pts = TIERS[s.tierIdx];
    s.teamScore += pts;
    s.turnPoints = Array(s.players).fill(0);
    s.solved = true;
    s.solvedCount += 1;
    showPopup("right", `Team +${pts}`);
    endTurn("You solved it together!");
  };

  // The word was guessed but we can't tell who said it: stop the clock and ask.
  const askWho = () => {
    const s = game.current;
    s.awardLeft = s.timeLeft;
    keys.current.clear();
    resetCanvasPen();
    s.phase = "award";
    render();
  };

  // "Not right after all": back to drawing with the time that was left.
  const resumeFromAward = () => {
    const s = game.current;
    s.phase = "drawing";
    s.timeLeft = s.awardLeft;
    s.startedAt = performance.now() - (s.turnSeconds - s.awardLeft) * 1000;
    render();
  };

  // Picked the wrong player? Take the points back and ask again, with the drawing restored.
  const reopenAward = (): boolean => {
    const s = game.current;
    if (s.phase !== "reveal" || !s.lastAward || s.mode === "team") return false;
    const { p, pts, artistPts } = s.lastAward;
    const a = s.turn % s.players;
    s.scores[p] -= pts;
    s.scores[a] -= artistPts;
    s.turnPoints[p] -= pts;
    s.turnPoints[a] -= artistPts;
    s.guessed.delete(p);
    s.lastAward = null;
    s.solved = false;
    s.solvedCount -= 1;
    clearTimers(); // cancel the move to the next turn
    strokes.current = lastStrokes.current;
    s.awardLeft = s.timeLeft; // the clock was frozen when the turn ended
    s.phase = "award";
    render();
    return true;
  };

  // ---- pointing with your hand ----
  // Wherever the game asks a question (the board, who said it, welcome back, leave, play again), the drawing hand
  // points at a button and a hold-still presses it. While drawing, a hand in the bottom strip of the canvas (with the
  // pen up) points at the toolbar instead: colors, brush size, eraser, undo, clear. Drawing itself stays separate.
  const pointerMode = (): boolean => {
    const st = game.current;
    return st.welcome !== null || st.exitOpen || st.phase === "board" || st.phase === "award" || st.phase === "reveal" || st.phase === "over";
  };

  const toolsZone = (): boolean => {
    const st = game.current;
    return st.phase === "drawing" && !st.paused && !penDownRef.current && cursor.current.y >= TOOLS_ZONE_Y;
  };

  // Where on the screen the hand is pointing, and which part of the page it may press.
  const pointerTarget = (): { x: number; y: number; scope: HTMLElement } | null => {
    const box = boxRef.current;
    if (!box) return null;
    const c = cursor.current;
    if (toolsZone()) {
      const tb = document.querySelector<HTMLElement>(".toolbar");
      if (tb) {
        // Sweep the hand across its whole range and it slides along the whole toolbar.
        const t = tb.getBoundingClientRect();
        return { x: t.left + c.x * t.width, y: t.top + t.height / 2, scope: tb };
      }
    }
    const rect = box.getBoundingClientRect();
    return { x: rect.left + c.x * rect.width, y: rect.top + c.y * rect.height, scope: box };
  };

  const clearHover = () => {
    hoverEl.current?.classList.remove("hand-hover");
    hoverEl.current = null;
  };

  const updateHover = () => {
    const target = pointerTarget();
    if (!target) return;
    const hit = document
      .elementsFromPoint(target.x, target.y)
      .map((e) => (e as HTMLElement).closest?.("button:not(:disabled)") as HTMLElement | null)
      .find((b) => b && target.scope.contains(b));
    const el = hit ?? null;
    if (el === hoverEl.current) return;
    hoverEl.current?.classList.remove("hand-hover");
    el?.classList.add("hand-hover");
    hoverEl.current = el;
  };

  const pointerSelect = () => {
    const el = hoverEl.current;
    if (!el || (el as HTMLButtonElement).disabled) return;
    clearHover();
    el.click();
  };

  // One frame of the drawing hand. `p` is where the hand points (null if it was lost), already smoothed.
  // While drawing it starts and stops the pen; while asking a question or reaching for the tools it points and presses.
  const handFrame = (p: { x: number; y: number } | null, penArmUp: boolean, now: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    let stillMs = 0;
    if (p && rect) {
      cursor.current = p;
      setSource("hand");
      setHandSeen(true);
      lastHandAt.current = performance.now();
      stillMs = still.current.update(p.x * rect.width, p.y * rect.height, now);
    } else {
      still.current.reset(); // hand lost: start counting again when it comes back
    }
    setPenArmUp(penArmUp);
    if (pointerMode() || toolsZone()) {
      updateHover();
      const press = hold.current.update(stillMs, hoverEl.current !== null);
      dwell.current = hold.current.ring;
      if (press) pointerSelect();
    } else {
      clearHover();
      hold.current.reset();
      const act = gesture.current.update({ now, penDown: penDownRef.current, stillMs, penArmUp });
      dwell.current = gesture.current.ring;
      if (act) setPen(act === "down");
    }
  };

  // ---- leaving a game ----
  const openExit = (): boolean => {
    const s = game.current;
    if (s.phase === "start" || s.phase === "setup" || s.phase === "over") return false;
    s.exitOpen = true;
    s.paused = true; // the clock stops while the dialog is up
    keys.current.clear();
    resetCanvasPen();
    render();
    return true;
  };

  const closeExit = () => {
    game.current.exitOpen = false;
    game.current.paused = game.current.welcome !== null;
    render();
  };

  const closeWelcome = () => {
    const s = game.current;
    s.welcome = null;
    s.paused = s.exitOpen;
    render();
  };

  const leaveGame = () => {
    clearTimers();
    resetCanvas();
    keys.current.clear();
    game.current = { ...newGame(roster.current), phase: "setup" };
    audio.sfx("swish");
    render();
  };

  // ---- saved game: what the TV hands back if it closes the app while the viewer is away ----
  const buildSaved = () => {
    const s = game.current;
    const r = roster.current;
    if (s.phase === "start") return null;
    const base = { v: 1, roster: r };
    if (s.phase === "setup") return base;
    return {
      ...base,
      game: {
        phase: s.phase, turn: s.turn, scores: s.scores, turnPoints: s.turnPoints, teamScore: s.teamScore, solvedCount: s.solvedCount,
        used: [...s.used], category: s.category, tierIdx: s.tierIdx, word: s.word, solved: s.solved, awardLeft: s.awardLeft,
        timeLeft: s.timeLeft, message: s.message,
      },
    };
  };

  const saveGame = () => {
    try {
      void app.saveState(buildSaved()).catch(() => {});
    } catch {
      /* no host: nothing to save to */
    }
  };

  const isNums = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && Number.isFinite(x));
  const isStrs = (v: unknown, min: number): v is string[] => Array.isArray(v) && v.length >= min && v.every((x) => typeof x === "string");

  // Returns true if a saved game was put back. Anything that doesn't look right is ignored.
  const restoreFrom = (saved: unknown): boolean => {
    const sv = saved as { v?: number; roster?: Partial<Roster>; game?: Record<string, unknown> } | null;
    const r = sv?.roster;
    if (!sv || sv.v !== 1 || !r || typeof r.players !== "number" || r.players < 2 || r.players > 4) return false;
    if (!isStrs(r.names, r.players) || !isStrs(r.avatars, r.players) || (r.mode !== "versus" && r.mode !== "team")) return false;
    const seconds = TIMER_OPTIONS.includes(r.seconds as (typeof TIMER_OPTIONS)[number]) ? (r.seconds as number) : TURN_SECONDS;
    roster.current = { players: r.players, hand: r.hand === true, drawHand: r.drawHand === "left" ? "left" : "right", mode: r.mode, seconds, names: r.names.slice(0, r.players), avatars: r.avatars.slice(0, r.players) };
    const g0 = sv.game;
    if (!g0) {
      game.current = { ...newGame(roster.current), phase: "setup" };
      render();
      return true;
    }
    const n = r.players;
    const phase = g0.phase as Phase;
    if (!isNums(g0.scores, n) || !isNums(g0.turnPoints, n) || typeof g0.turn !== "number" || !Array.isArray(g0.used)) return false;
    const st = newGame(roster.current);
    st.turn = g0.turn;
    st.scores = g0.scores;
    st.turnPoints = g0.turnPoints;
    st.teamScore = Number(g0.teamScore) || 0;
    st.solvedCount = Number(g0.solvedCount) || 0;
    st.used = new Set((g0.used as unknown[]).filter((x): x is string => typeof x === "string"));
    st.category = typeof g0.category === "string" ? g0.category : "";
    st.tierIdx = Math.min(2, Math.max(0, Number(g0.tierIdx) || 0));
    st.word = typeof g0.word === "string" ? g0.word : "";
    st.solved = g0.solved === true;
    st.awardLeft = Number(g0.awardLeft) || 0;
    st.message = typeof g0.message === "string" ? g0.message : "";
    game.current = st;
    resetCanvas();
    if (phase === "board" || phase === "over") {
      st.phase = phase;
    } else if (phase === "award" && st.word) {
      st.phase = "award";
    } else if (phase === "reveal") {
      st.phase = "reveal";
      nextTurn(); // the points were already counted, so go on to the next turn
    } else if (st.word && (phase === "countdown" || phase === "memorize" || phase === "drawing")) {
      // The drawing is gone, so this turn starts again with the same word and a full clock.
      st.phase = "countdown";
      st.phaseAt = performance.now();
      st.phaseLeft = COUNTDOWN_S;
      st.timeLeft = st.turnSeconds;
    } else {
      st.phase = "board";
    }
    if (game.current.phase !== "over") {
      game.current.welcome = "restored";
      game.current.paused = true;
    }
    render();
    return true;
  };

  // The artist picks a tile; the word is random within it.
  const pickTile = (category: string, tierIdx: number): string => {
    const s = game.current;
    if (s.phase !== "board") return "not picking";
    if (!CATEGORIES[category] || !TIERS[tierIdx]) return "no such tile";
    const key = `${category}:${tierIdx}`;
    if (s.used.has(key)) return "already played";
    s.used.add(key);
    s.category = category;
    s.tierIdx = tierIdx;
    s.word = pickFromTile(category, tierIdx, s.word);
    s.phase = "countdown";
    s.phaseAt = performance.now();
    s.phaseLeft = COUNTDOWN_S;
    audio.sfx("tile");
    render();
    return "ok";
  };

  const winners = () => {
    const best = Math.max(...g.scores);
    return g.names.filter((_, i) => g.scores[i] === best);
  };

  useLittleEnter(({ state, restored }: { state?: unknown; restored?: boolean }) => {
    if (restored && state) restoreFrom(state);
  });

  // Going Home: stop the clock and have the "welcome back" card waiting. The TV keeps the page alive, so nothing is lost.
  const awayPaused = useLittlePaused();
  const wasPaused = useRef(false);
  useEffect(() => {
    if (awayPaused) {
      wasPaused.current = true;
      const s = game.current;
      if (["countdown", "memorize", "drawing", "award"].includes(s.phase) && s.welcome === null) {
        s.welcome = "resumed";
        s.paused = true;
        keys.current.clear();
        resetCanvasPen();
        render();
      }
      saveGame(); // the TV may close a paused app without warning
    }
  }, [awayPaused]);

  // Save the game whenever something that matters changes, so a close or a reboot can bring it back.
  const saveKey = [g.phase, g.turn, g.scores.join(), g.teamScore, g.solvedCount, g.used.size, g.mode, g.turnSeconds, r.players, r.hand, r.drawHand, r.mode, r.seconds, r.names.join("|"), r.avatars.join("")].join("~");
  useEffect(() => {
    saveGame();
  }, [saveKey]);

  // ---- sound and music ----
  useEffect(() => {
    audio.onChange = render;
    const unlock = () => audio.unlock(); // browsers keep audio locked until the first tap or key
    const onClick = (e: Event) => {
      const b = (e.target as HTMLElement).closest?.("button");
      if (b && !b.disabled && !b.closest(".audio-ctl")) audio.sfx("click");
    };
    const onFocus = (e: FocusEvent) => {
      if ((e.target as HTMLElement).closest?.("button")) audio.sfx("hover");
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("click", onClick);
    document.addEventListener("focusin", onFocus);
    audio.unlock();
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      document.removeEventListener("click", onClick);
      document.removeEventListener("focusin", onFocus);
    };
  }, []);

  // Development builds only: lets automated UI checks reach screens that need the hidden word.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__drawit = { guess: guessWord, game: () => game.current, roster: () => roster.current, render,
      point: (x: number, y: number) => { cursor.current = { x, y }; updateHover(); },
      feed: handFrame, pen: () => penDownRef.current, ring: () => dwell.current, strokes: () => strokes.current.length, press: pointerSelect, hovered: () => hoverEl.current?.getAttribute("data-little-label") ?? null };
  });

  // When the viewer sends the app to the background, stop making noise.
  useEffect(() => {
    if (visible) audio.resume();
    else audio.suspend();
  }, [visible]);

  // One-off sounds on each change of phase.
  const prevPhase = useRef<Phase | null>(null);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = g.phase;
    if (prev === g.phase) return;
    if (g.phase === "memorize") audio.sfx("reveal");
    if (g.phase === "drawing") audio.sfx("go");
    if (g.phase === "award") audio.sfx("tile");
    if (g.phase === "reveal") audio.sfx(g.solved ? "reveal" : "timeup");
    if (g.phase === "over") audio.sfx("fanfare");
  }, [g.phase]);

  // Background music follows the game: bouncy menus, quiet suspense, calm drawing, tense last ten seconds, party at the end.
  useEffect(() => {
    const moods: Record<Phase, Mood> = {
      start: "menu", setup: "menu", board: "menu", countdown: "off", memorize: "off",
      drawing: g.timeLeft <= 10 ? "tense" : "play", award: "off", reveal: "off", over: "win",
    };
    audio.mood(moods[g.phase]);
  }, [g.phase, g.timeLeft]);

  // Countdown ticks before the drawing starts, and in the last ten seconds.
  useEffect(() => {
    if ((g.phase === "countdown" || g.phase === "memorize") && g.phaseLeft > 0) audio.sfx(g.phaseLeft === 1 ? "tickLast" : "tick");
    if (g.phase === "drawing" && g.timeLeft > 0 && g.timeLeft <= 10) audio.sfx(g.timeLeft <= 3 ? "tickLast" : "tick");
  }, [g.phase, g.phaseLeft, g.timeLeft]);

  // Focus the primary button on each new screen so the remote's OK works right away.
  useEffect(() => {
    (document.querySelector<HTMLElement>(".exit-dialog [data-autofocus]") ?? document.querySelector<HTMLElement>("[data-autofocus]"))?.focus();
  }, [g.phase, g.exitOpen, g.welcome]);

  // The turn clock: countdown, word reveal, then the 60 second drawing timer.
  useEffect(() => {
    let lastTick = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTick;
      lastTick = now;
      const s = game.current;
      if (s.paused) {
        // Stopped for the exit dialog: slide the start times forward so no time is lost.
        s.startedAt += dt;
        s.phaseAt += dt;
        return;
      }
      if (s.phase === "countdown" || s.phase === "memorize") {
        const total = s.phase === "countdown" ? COUNTDOWN_S : MEMORIZE_S;
        s.phaseLeft = Math.max(0, Math.ceil(total - (performance.now() - s.phaseAt) / 1000));
        if (s.phaseLeft === 0) {
          if (s.phase === "countdown") {
            s.phase = "memorize";
            s.phaseAt = performance.now();
            s.phaseLeft = MEMORIZE_S;
          } else {
            s.phase = "drawing";
            s.startedAt = performance.now();
            s.timeLeft = s.turnSeconds;
          }
        }
        render();
        return;
      }
      if (s.phase !== "drawing") return;
      const elapsed = (performance.now() - s.startedAt) / 1000;
      s.timeLeft = Math.max(0, Math.ceil(s.turnSeconds - elapsed));
      if (s.timeLeft === 0) endTurn(`Time's up! It was ${s.word}.`);
      else render();
    }, 250);
    return () => {
      window.clearInterval(id);
      clearTimers();
    };
  }, []);

  // ---- tools ----
  useTool("start_game", ({ players }: { players?: number }) => {
    const s = game.current;
    if (s.phase === "start") {
      goSetup(players);
      return { detail: "setup", say: "Great! Pick your players and names." };
    }
    if (s.phase === "setup") {
      if (players) setPlayers(players);
      beginMatch();
      return { detail: "match started", say: `${displayName(0)} picks a category first.` };
    }
    if (s.phase === "over") {
      beginMatch();
      return { detail: "new match, same players", say: `Round one! ${displayName(0)} picks a category.` };
    }
    return { detail: "a game is already running", say: "We're already playing!" };
  });

  useTool("set_players", ({ count }: { count: number }) => {
    if (game.current.phase !== "setup" && game.current.phase !== "start") return { detail: "not in setup", say: "You can change players on the setup screen." };
    setPlayers(count);
    return { detail: `${roster.current.players} players`, say: `${roster.current.players} players.` };
  });

  useTool("set_name", ({ player, name }: { player: number; name: string }) => {
    if (game.current.phase !== "setup") return { detail: "not in setup", say: "Names can be changed on the setup screen." };
    if (!name?.trim()) return { detail: "empty name", say: "I didn't catch the name." };
    setName(player - 1, name.trim());
    return { detail: `player ${player} is ${name}`, say: `Player ${player} is now ${name.trim()}.` };
  });

  useTool("shuffle_names", ({ player }: { player?: number }) => {
    if (game.current.phase !== "setup") return { detail: "not in setup", say: "I can shuffle names on the setup screen." };
    shuffleName(player ? player - 1 : undefined);
    return { detail: "names shuffled", say: player ? `New name for player ${player}!` : "Fresh silly names!" };
  });

  useTool("change_players", () => {
    if (game.current.phase !== "over") return { detail: "game not over", say: "Finish the game first." };
    clearTimers();
    goSetup();
    return { detail: "setup", say: "New players, new names!" };
  });

  useTool("set_audio", ({ sound, music }: { sound?: boolean; music?: boolean }) => {
    const next = { sound: sound ?? audio.prefs.sound, music: music ?? audio.prefs.music };
    audio.setPrefs(next);
    audio.sfx("blip");
    const say = !next.sound && !next.music ? "All quiet." : next.sound && next.music ? "Sound and music are on." : next.music ? "Music on, sound effects off." : "Sound effects on, music off.";
    return { detail: `sound ${next.sound ? "on" : "off"}, music ${next.music ? "on" : "off"}`, say };
  });

  useTool("pick_tile", ({ category, points }: { category: string; points: number }) => {
    if (game.current.paused) return PAUSED_REPLY;
    const tierIdx = TIERS.indexOf(points as (typeof TIERS)[number]);
    const result = pickTile(category, tierIdx);
    if (result !== "ok") return { detail: result, say: result === "already played" ? "That one's taken. Pick another." : "I can't pick that right now." };
    const s = game.current;
    return { detail: `${category} for ${points}`, say: `${category} for ${points}. Everyone except ${s.names[s.turn % s.players]}, close your eyes!` };
  });

  const guessWord = (text: string, player?: number) => {
    const s = game.current;
    if (s.paused) return PAUSED_REPLY;
    if (s.phase === "award") return { detail: "waiting to hear who got it", say: "First tell me who got it." };
    if (s.phase !== "drawing") return { detail: "no round running", say: "There's no drawing to guess right now." };
    if (!isCorrect(text, s.word)) {
      s.guesses = [text, ...s.guesses].slice(0, 6);
      showPopup("wrong", `"${text}" is not it`);
      render();
      return { detail: "wrong", say: `Not ${text}. Try again!` };
    }
    const pts = TIERS[s.tierIdx];
    if (s.mode === "team") {
      teamSolved();
      return { detail: `team solved it, ${pts} points`, say: `Yes! You got it! ${pts} points for the team!` };
    }
    // Versus: who said it? The agent only passes a player when a name was spoken; with two players there is only one guesser.
    const a = s.turn % s.players;
    const guessers = Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== a);
    const named = player ? player - 1 : -1;
    const p = named >= 0 && named < s.players && named !== a ? named : guessers.length === 1 ? guessers[0] : -1;
    if (p >= 0) {
      awardTo(p);
      return { detail: `${s.names[p]} correct, ${pts} points`, say: `Yes! ${s.names[p]} gets ${pts} points!` };
    }
    askWho();
    return { detail: "correct, waiting to hear who got it", say: "Yes, that's right! Who said it?" };
  };
  useTool("guess", ({ word, player }: { word: string; player?: number }) => guessWord(word, player));

  useTool("award_point", ({ player }: { player: number }) => {
    const s = game.current;
    if (s.paused) return PAUSED_REPLY;
    if (s.phase !== "award") return { detail: "nothing to award", say: "There's nothing to award right now." };
    if (player === 0) {
      resumeFromAward();
      return { detail: "not correct after all", say: "Okay, keep guessing!" };
    }
    const a = s.turn % s.players;
    const p = player - 1;
    if (!(p >= 0 && p < s.players) || p === a) return { detail: "invalid player", say: "Pick one of the guessers." };
    awardTo(p);
    return { detail: `${s.names[p]} awarded ${TIERS[s.tierIdx]}`, say: `${s.names[p]} gets ${TIERS[s.tierIdx]} points!` };
  });

  useTool("change_winner", () => {
    if (!reopenAward()) return { detail: "nothing to change", say: "There's no award to change right now." };
    return { detail: "reopened", say: "Okay, who got it?" };
  });

  useTool("set_mode", ({ mode }: { mode: Mode }) => {
    const ph = game.current.phase;
    if (ph !== "setup" && ph !== "start") return { detail: "not in setup", say: "You can change the game mode on the setup screen." };
    if (mode !== "versus" && mode !== "team") return { detail: `unknown mode ${mode}`, say: "Compete or team up." };
    setMode(mode);
    return { detail: `mode ${mode}`, say: mode === "team" ? "Team mode! Everyone plays together." : "Compete mode! Everyone plays for points." };
  });

  useTool("pen", ({ down }: { down: boolean }) => {
    if (game.current.paused) return PAUSED_REPLY;
    setPen(down);
    return { detail: down ? "pen down" : "pen up", say: down ? "Drawing." : "Pen up." };
  });
  useTool("set_color", ({ color: c }: { color: string }) => {
    if (!(c in COLORS)) return { detail: `unknown color ${c}`, say: "I don't have that color." };
    setColor(c);
    return { detail: `color ${c}`, say: `${c}.` };
  });
  useTool("set_brush", ({ size }: { size: BrushSize }) => {
    if (!(size in BRUSH_SIZES)) return { detail: `unknown size ${size}`, say: "Small, medium or large." };
    setBrush(size);
    return { detail: `brush ${size}`, say: `${size} brush.` };
  });
  useTool("set_tool", ({ tool: t }: { tool: "pen" | "eraser" }) => {
    if (t !== "pen" && t !== "eraser") return { detail: `unknown tool ${t}`, say: "Pen or eraser." };
    setTool(t);
    return { detail: t, say: t === "eraser" ? "Eraser." : "Pen." };
  });
  useTool("set_timer", ({ seconds }: { seconds: number }) => {
    const p = game.current.phase;
    if (p !== "setup" && p !== "start") return { detail: "not in setup", say: "The timer can be changed on the setup screen." };
    const n = setTimerSeconds(seconds);
    return { detail: `${n} seconds`, say: n >= 120 ? "Two minutes to draw." : `${n} seconds to draw.` };
  });
  useTool("set_hand_drawing", ({ on }: { on: boolean }) => {
    setHand(on === true);
    return { detail: on ? "hand drawing on" : "hand drawing off", say: on ? "Hand drawing is on. The TV may ask to use the camera." : "Drawing with the remote." };
  });
  useTool("set_drawing_hand", ({ hand }: { hand: Side }) => {
    if (hand !== "left" && hand !== "right") return { detail: `unknown hand ${hand}`, say: "Left or right." };
    setDrawHand(hand);
    return { detail: `${hand} hand draws`, say: `${hand === "left" ? "Left" : "Right"} hand draws. Raise your ${otherSide(hand)} arm to put the pen down.` };
  });
  useTool("continue_game", () => {
    const s = game.current;
    if (!s.welcome) return { detail: "nothing paused", say: "We're already playing." };
    closeWelcome();
    return { detail: "continued", say: "Welcome back! Here we go." };
  });
  useTool("exit_game", ({ confirm }: { confirm?: boolean }) => {
    const s = game.current;
    if (confirm === false) {
      if (s.welcome && !s.exitOpen) {
        closeWelcome();
        return { detail: "continued", say: "Welcome back! Here we go." };
      }
      if (!s.exitOpen) return { detail: "nothing to cancel", say: "We're still playing." };
      closeExit();
      return { detail: "kept playing", say: "Back to the game!" };
    }
    if (confirm === true && s.exitOpen) {
      leaveGame();
      return { detail: "left the game", say: "Okay, back to setup. Pick your players for a new game." };
    }
    if (!openExit()) return { detail: "nothing to exit", say: "There's no game running." };
    return { detail: "asked to confirm", say: "Leave this game? Say leave to quit, or keep playing." };
  });
  useTool("undo", () => {
    strokes.current.pop();
    audio.sfx("swish");
    setPen(false);
    return { detail: "undone", say: "Undone." };
  });
  useTool("clear", () => {
    audio.sfx("swish");
    resetCanvas();
    return { detail: "cleared", say: "Clean slate." };
  });
  useTool("skip_turn", () => {
    const s = game.current;
    if (s.phase === "board") {
      nextTurn();
      return { detail: "passed", say: "Passing to the next player." };
    }
    if (s.phase !== "drawing" && s.phase !== "countdown" && s.phase !== "memorize" && s.phase !== "award") return { detail: "nothing to skip", say: "Nothing to skip." };
    endTurn("Skipped!");
    return { detail: "skipped", say: "Skipping this turn." };
  });

  // ---- input: camera mirror, hand tracking, mouse, remote ----
  // The host feeds hand tracking from the same camera, and only opens it while the app holds media.camera.
  useEffect(() => {
    let stopCam: (() => void) | null = null;
    let cancelled = false;
    setCameraOk(null);
    // The camera is only used when players turn on hand drawing, so no permission card appears otherwise.
    // The TV also releases it while we are away; ask again on return.
    if (!handOn || awayPaused) return;
    if (!app.can("media.camera")) {
      handFailed();
      return;
    }
    app.media.camera({ facing: "user", width: 640, height: 480 }).then((cam) => {
      if (cancelled) {
        if (cam.ok) cam.stop();
        return;
      }
      if (!cam.ok) return handFailed();
      stopCam = cam.stop;
      camStream.current = cam.stream;
      if (videoRef.current) videoRef.current.srcObject = cam.stream;
      setCameraOk(true);
    });
    return () => {
      cancelled = true;
      stopCam?.();
    };
  }, [app, awayPaused, handOn]);

  // The mirror only exists on the game screens, so attach the stream whenever it mounts.
  useEffect(() => {
    if (videoRef.current && camStream.current) videoRef.current.srcObject = camStream.current;
  }, [inMatch, cameraOk]);

  // The right hand moves the cursor. Holding it still fills a ring around the cursor, and
  // completing the ring toggles the pen down or up.
  useEffect(() => {
    if (!handOn || cameraOk !== true || awayPaused) return; // only with hand drawing on and the camera granted; the TV ends pose streams while away
    const motion = createMotionSession(app, {
      controls: [drawHand === "left" ? "left-hand-cursor" : "right-hand-cursor"],
      held: ["arm-raised"], // raising the other arm also puts the pen down; everything else we measure ourselves
    });
    gesture.current.reset();
    still.current.reset();
    hold.current.reset();
    motion.onStatus(({ state, reason }) => {
      setMotionState(state);
      setMotionReason(reason ?? null);
    });
    const stop = motion.onResult(({ controls, held }) => {
      setResults((n) => n + 1);
      let point: { x: number; y: number } | null = null;
      for (const c of controls) {
        if (!("component" in c) || c.component !== "vector2") continue;
        if (c.state !== "active") {
          smoother.current.reset(); // hand lost: start fresh when it comes back instead of sliding in from the old spot
          continue;
        }
        point = smoother.current.filter(mapper.current.map(c.value.x, c.value.y), performance.now());
      }
      handFrame(point, readPenArm(held, drawHand), performance.now());
    });
    return () => {
      stop();
      motion.close();
    };
  }, [app, cameraOk, awayPaused, handOn, drawHand]);

  // Mouse (testing) and remote (d-pad moves, Enter toggles the pen) while drawing.
  useEffect(() => {
    const box = boxRef.current!;
    const move = (e: PointerEvent) => {
      const rect = box.getBoundingClientRect();
      cursor.current = { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
      setSource("mouse");
    };
    const down = () => setPen(true);
    const up = () => setPen(false);
    const keydown = (e: KeyboardEvent) => {
      const st = game.current;
      if (st.phase !== "drawing" || st.paused) return; // menus keep the remote's normal focus behavior
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.closest?.(".toolbar")) {
        // On the toolbar: left and right move between tools, up goes back to the canvas, OK presses the tool.
        const btns = Array.from(document.querySelectorAll<HTMLElement>(".toolbar button"));
        const at = btns.indexOf(focused);
        if (e.key === "ArrowRight") { btns[Math.min(btns.length - 1, at + 1)]?.focus(); e.preventDefault(); }
        else if (e.key === "ArrowLeft") { btns[Math.max(0, at - 1)]?.focus(); e.preventDefault(); }
        else if (e.key === "ArrowUp") { focused.blur(); e.preventDefault(); }
        return;
      }
      if (e.key === "ArrowDown" && cursor.current.y >= 0.97 && !penDownRef.current) {
        document.querySelector<HTMLElement>(".toolbar button")?.focus(); // down at the bottom edge opens the tools
        e.preventDefault();
        return;
      }
      if (e.key === "Enter") {
        if (!e.repeat) setPen(!penDownRef.current);
        e.preventDefault();
      } else if (e.key.startsWith("Arrow")) {
        keys.current.add(e.key);
        setSource("remote");
        e.preventDefault();
      }
    };
    const keyup = (e: KeyboardEvent) => keys.current.delete(e.key);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", keydown);
    window.addEventListener("keyup", keyup);
    return () => {
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("keyup", keyup);
    };
  }, [inMatch]);

  // Render loop: move the cursor from held keys, extend the active stroke, draw everything.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = boxRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let held = 0; // seconds the d-pad has been held, for acceleration

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = box.clientWidth * dpr;
      canvas.height = box.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const w = box.clientWidth;
      const h = box.clientHeight;
      if (canvas.width !== Math.round(w * (window.devicePixelRatio || 1))) resize();
      const inZone = toolsZone(); // the hand is reaching for the tools, so the canvas cursor steps aside

      const k = keys.current;
      const dx = (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
      const dy = (k.has("ArrowDown") ? 1 : 0) - (k.has("ArrowUp") ? 1 : 0);
      if (dx || dy) {
        held += dt;
        const speed = REMOTE_SPEED * (0.25 + Math.min(held / 0.6, 1) * 0.75);
        const c = cursor.current;
        cursor.current = {
          x: Math.min(1, Math.max(0, c.x + dx * speed * dt)),
          y: Math.min(1, Math.max(0, c.y + dy * speed * dt * (w / h))),
        };
      } else {
        held = 0;
      }

      if (penDownRef.current) {
        const s = strokes.current[strokes.current.length - 1];
        const lastPt = s?.points[s.points.length - 1];
        const c = cursor.current;
        if (s && (!lastPt || Math.hypot((c.x - lastPt.x) * w, (c.y - lastPt.y) * h) > 2)) s.points.push({ ...c });
      }

      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strokes.current) {
        const width = s.erase ? s.size * ERASER_SCALE : s.size;
        ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over"; // erasers remove what is beneath
        ctx.lineWidth = width;
        ctx.strokeStyle = COLORS[s.color];
        ctx.fillStyle = COLORS[s.color];
        if (s.points.length === 1) {
          ctx.beginPath();
          ctx.arc(s.points[0].x * w, s.points[0].y * h, width / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        // Curve through the midpoints of neighbouring points so lines look smooth, not jagged.
        ctx.moveTo(s.points[0].x * w, s.points[0].y * h);
        for (let i = 1; i < s.points.length - 1; i++) {
          const a = s.points[i];
          const b = s.points[i + 1];
          ctx.quadraticCurveTo(a.x * w, a.y * h, ((a.x + b.x) / 2) * w, ((a.y + b.y) / 2) * h);
        }
        const end = s.points[s.points.length - 1];
        ctx.lineTo(end.x * w, end.y * h);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      if (game.current.phase === "drawing" && !inZone) {
        const c = cursor.current;
        const px = c.x * w;
        const py = c.y * h;
        const down = penDownRef.current;
        const erasing = toolRef.current === "eraser";
        const brushPx = BRUSH_SIZES[brushRef.current] * (erasing ? ERASER_SCALE : 1);
        const dotR = Math.max(7, brushPx / 2 + 2);
        // A friendly crayon-tip cursor: a white-rimmed dot in the pen color.
        ctx.beginPath();
        ctx.arc(px, py, down ? dotR : dotR + 6, 0, Math.PI * 2);
        ctx.fillStyle = down && !erasing ? COLORS[colorRef.current] : "rgba(255,255,255,0.85)";
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = erasing ? "#8a8fa3" : down ? "#fff" : COLORS[colorRef.current];
        ctx.stroke();
        if (!down) {
          ctx.lineWidth = 3;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.arc(px, py, dotR + 15 + Math.sin(now / 250) * 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // The on-screen hand pointer and loading circle, in screen coordinates so it can reach the toolbar below the canvas.
      // It shows when the hand asks questions or reaches for the tools, and while drawing whenever a hold is filling.
      const pe = pointerRef.current;
      if (pe) {
        const target = pointerTarget();
        const drawing = game.current.phase === "drawing" && !inZone;
        const live = handOn && now - lastHandAt.current < 1500;
        const show = !!target && live && (pointerMode() || inZone || (drawing && dwell.current > 0));
        pe.style.display = show ? "block" : "none";
        if (show && target) {
          pe.style.transform = `translate(${target.x}px, ${target.y}px)`;
          pe.style.setProperty("--p", String(dwell.current));
          pe.dataset.mode = drawing ? (penDownRef.current ? "stop" : "start") : "point";
          const label = pe.querySelector<HTMLElement>(".hp-label");
          if (label) label.textContent = drawing ? (penDownRef.current ? "lifting the pen..." : "getting ready to draw...") : "";
        } else if (hoverEl.current) {
          clearHover();
        }
      }
      const zone = zoneRef.current;
      if (zone) {
        zone.style.display = handOn && game.current.phase === "drawing" && !penDownRef.current ? "flex" : "none";
        zone.classList.toggle("hot", inZone);
      }

      const mc = mirrorCanvasRef.current;
      const mctx = mc?.getContext("2d");
      if (mc && mctx) {
        mctx.clearRect(0, 0, mc.width, mc.height);
        if (game.current.phase === "drawing") {
          mctx.strokeStyle = penDownRef.current ? "#ef476f" : "#ffd23f";
          mctx.lineWidth = 4;
          mctx.beginPath();
          mctx.arc(cursor.current.x * mc.width, cursor.current.y * mc.height, 12, 0, Math.PI * 2);
          mctx.stroke();
        }
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [inMatch]);

  const dataFor = (extra: object = {}) => JSON.stringify(extra);
  const solvedRatio = g.solvedCount / Math.max(1, g.players * ROUNDS);
  const teamStars = solvedRatio >= 0.9 ? 3 : solvedRatio >= 0.6 ? 2 : solvedRatio >= 0.3 ? 1 : 0;
  const ranked = g.scores.map((s, i) => ({ i, s, rank: g.scores.filter((o) => o > s).length })).sort((a, b) => b.s - a.s);
  // A classic podium: the runner-up on the left, the winner in the middle, then third and fourth.
  const podiumOrder = ranked.length >= 3 ? [ranked[1], ranked[0], ...ranked.slice(2)] : ranked.length === 2 ? [ranked[1], ranked[0]] : ranked;
  const revealArt = wordArtKey(g.word, g.category, hasArt);

  return (
    <div className="app">
      <Decor />
      {handOn && <div className="hand-pointer" ref={pointerRef} aria-hidden><span className="hp-label" /></div>}

      <div className="audio-ctl" data-little="region" data-little-label="Audio"
        data-little-data={dataFor({ sound: audio.prefs.sound, music: audio.prefs.music, audio: audio.state, track: audio.playing })}>
        <button className={`ctl${audio.prefs.sound ? "" : " off"}`} aria-pressed={audio.prefs.sound} aria-label={audio.prefs.sound ? "Mute sound effects" : "Unmute sound effects"}
          data-little="control" data-little-label={audio.prefs.sound ? "Mute sound effects" : "Unmute sound effects"} data-little-action="set_audio"
          data-little-data={dataFor({ sound: !audio.prefs.sound })} onClick={() => { audio.setPrefs({ sound: !audio.prefs.sound }); audio.sfx("blip"); }}>
          <Art name={audio.prefs.sound ? "icon-sound-on" : "icon-sound-off"} />
          <span>Sound</span>
        </button>
        <button className={`ctl${audio.prefs.music ? "" : " off"}`} aria-pressed={audio.prefs.music} aria-label={audio.prefs.music ? "Mute music" : "Unmute music"}
          data-little="control" data-little-label={audio.prefs.music ? "Mute music" : "Unmute music"} data-little-action="set_audio"
          data-little-data={dataFor({ music: !audio.prefs.music })} onClick={() => { audio.setPrefs({ music: !audio.prefs.music }); audio.sfx("blip"); }}>
          <Art name={audio.prefs.music ? "icon-music-on" : "icon-music-off"} />
          <span>Music</span>
        </button>
      </div>

      {/* ---------- Start screen ---------- */}
      {g.phase === "start" && (
        <main className="screen">
          <h1 className="logo" aria-label="Draw It!">
            {"Draw It!".split("").map((ch, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s`, color: CONFETTI[i % CONFETTI.length] }}>{ch === " " ? " " : ch}</span>
            ))}
          </h1>
          <p className="tagline">Draw it. Guess it. Giggle!</p>
          <button className="btn big primary pulse" data-autofocus data-little="control" data-little-label="Start game"
            data-little-action="start_game" onClick={() => goSetup()}>
            Start game
          </button>
          <p className="small">Say "start game" or press OK</p>
        </main>
      )}

      {/* ---------- Setup screen ---------- */}
      {g.phase === "setup" && (
        <main className="screen setup">
          <h2 className="title">Who's playing?</h2>
          <div className="counts" data-little="region" data-little-label="Game mode" data-little-data={dataFor({ mode: r.mode })}>
            <button className={`btn pill${r.mode === "versus" ? " on" : ""}`} data-little="control" data-little-label="Compete" data-little-action="set_mode"
              data-little-data={dataFor({ mode: "versus" })} onClick={() => setMode("versus")}>
              <Art className="ico" name="icon-trophy" /> Compete
            </button>
            <button className={`btn pill${r.mode === "team" ? " on" : ""}`} data-little="control" data-little-label="Team up" data-little-action="set_mode"
              data-little-data={dataFor({ mode: "team" })} onClick={() => setMode("team")}>
              <Art className="ico" name="icon-team" /> Team up
            </button>
          </div>
          <p className="small">{r.mode === "team" ? "Everyone shares one score. How many words can you solve together?" : "Everyone plays for points. Guess the most words to win!"}</p>
          <div className="counts" data-little="region" data-little-label="Number of players" data-little-data={dataFor({ players: r.players })}>
            {[2, 3, 4].map((n) => (
              <button key={n} className={`btn pill${r.players === n ? " on" : ""}`} data-little="control" data-little-label={`${n} players`}
                data-little-action="set_players" data-little-data={dataFor({ count: n })} onClick={() => setPlayers(n)}>
                {n} players
              </button>
            ))}
          </div>
          <p className="small label">How do you want to draw?</p>
          <div className="counts" data-little="region" data-little-label="Hand drawing" data-little-data={dataFor({ on: handOn, camera: cameraOk })}>
            <button className={`btn pill${!handOn ? " on" : ""}`} data-little="control" data-little-label="Remote or mouse" data-little-action="set_hand_drawing"
              data-little-data={dataFor({ on: false })} onClick={() => setHand(false)}>
              Remote
            </button>
            <button className={`btn pill${handOn ? " on" : ""}`} data-little="control" data-little-label="Hand (uses the camera)" data-little-action="set_hand_drawing"
              data-little-data={dataFor({ on: true })} onClick={() => setHand(true)}>
              <Art className="ico" name="icon-hand" /> Hand (camera)
            </button>
          </div>
          {handOn && (
            <>
              <div className="counts" data-little="region" data-little-label="Drawing hand" data-little-data={dataFor({ hand: drawHand, penArm })}>
                {(["right", "left"] as Side[]).map((h) => (
                  <button key={h} className={`btn pill${drawHand === h ? " on" : ""}`} data-little="control" data-little-label={`${h} hand draws`}
                    data-little-action="set_drawing_hand" data-little-data={dataFor({ hand: h })} onClick={() => setDrawHand(h)}>
                    {h === "right" ? "Right hand draws" : "Left hand draws"}
                  </button>
                ))}
              </div>
              <p className="small">Hold your {drawHand} hand still to start, or raise your {penArm} arm to draw. The TV will ask to use the camera. Nothing is recorded or sent anywhere.</p>
            </>
          )}
          <p className="small label">Drawing time for each turn</p>
          <div className="counts" data-little="region" data-little-label="Drawing time" data-little-data={dataFor({ seconds: r.seconds })}>
            {TIMER_OPTIONS.map((n) => (
              <button key={n} className={`btn pill${r.seconds === n ? " on" : ""}`} data-little="control" data-little-label={`${n} seconds`}
                data-little-action="set_timer" data-little-data={dataFor({ seconds: n })} onClick={() => setTimerSeconds(n)}>
                {n === 120 ? "2 min" : `${n}s`}
              </button>
            ))}
          </div>
          <div className={`roster${r.players > 2 ? " two" : ""}`} data-little="region" data-little-label="Players" data-little-data={dataFor({ names: r.names.slice(0, r.players) })}>
            {Array.from({ length: r.players }, (_, i) => (
              <div className="row-player" key={i} style={{ animationDelay: `${i * 0.08}s` }}>
                <span className="avatar"><Art name={`avatar-${r.avatars[i]}`} /></span>
                <input value={r.names[i]} maxLength={MAX_NAME} aria-label={`Player ${i + 1} name`} data-little="control"
                  data-little-label={`Player ${i + 1} name`} onChange={(e) => setName(i, e.target.value)} />
                <button className="btn dice" aria-label={`New silly name for player ${i + 1}`} data-little="control"
                  data-little-label={`Shuffle player ${i + 1} name`} data-little-action="shuffle_names" data-little-data={dataFor({ player: i + 1 })}
                  onClick={() => shuffleName(i)}>
                  <Art className="ico" name="icon-dice" />
                </button>
              </div>
            ))}
          </div>
          <p className="small">Type your own name, tap the dice for a silly one, or say "call player 2 Captain Banana".</p>
          <div className="row">
            <button className="btn ghost" data-little="control" data-little-label="Shuffle all names" data-little-action="shuffle_names"
              onClick={() => shuffleName()}>
              <Art className="ico" name="icon-dice" /> Shuffle all
            </button>
            <button className="btn big primary pulse" data-autofocus data-little="control" data-little-label="Let's draw"
              data-little-action="start_game" onClick={beginMatch}>
              Let's draw!
            </button>
          </div>
        </main>
      )}

      {/* ---------- The game ---------- */}
      {inMatch && (
        <>
          <header>
            {g.phase !== "over" && (
              <button className="exit-btn" data-little="control" data-little-label="Exit game" data-little-action="exit_game" onClick={() => openExit()}>
                <Art className="ico" name="icon-exit" /> Exit
              </button>
            )}
            <div className="scores" data-little="readout" data-little-label="Scoreboard"
              data-little-data={dataFor({ phase: g.phase, mode: g.mode, names: g.names, scores: g.scores, teamScore: g.teamScore, solved: g.solvedCount, artist: g.phase === "over" ? null : artist + 1, round, rounds: ROUNDS })}>
              {g.mode === "team" ? (
                <>
                  <span key={`team-${g.teamScore}`} className="chip team bump">
                    <span className="faces">
                      {g.avatars.map((av, i) => <span key={i} className="avatar sm"><Art name={`avatar-${av}`} /></span>)}
                    </span>
                    Team <b>{g.teamScore}</b>
                  </span>
                  {g.phase !== "over" && (
                    <span className="chip artist">
                      <span className="avatar sm"><Art name={`avatar-${g.avatars[artist]}`} /></span> Drawing: {g.names[artist]}
                    </span>
                  )}
                </>
              ) : (
                g.names.map((n, i) => (
                  <span key={`${i}-${g.scores[i]}`} className={`chip bump${i === artist && g.phase !== "over" ? " artist" : ""}`}>
                    <span className="avatar sm"><Art name={`avatar-${g.avatars[i]}`} /></span> {n} <b>{g.scores[i]}</b>
                  </span>
                ))
              )}
            </div>

            <output className="cat" data-little="readout" data-little-label="Category"
              data-little-data={dataFor({ category: g.category, points: TIERS[g.tierIdx] })}>
              {g.category && ["countdown", "memorize", "drawing"].includes(g.phase)
                ? <><Art className="ico" name={`cat-${g.category}`} /> {g.category} · {TIERS[g.tierIdx]} pts</> : ""}
            </output>

            <output className={`timer${g.timeLeft <= 10 && g.phase === "drawing" ? " low" : ""}`} data-little="readout"
              data-little-label="Time left" data-little-data={dataFor({ seconds: g.timeLeft })}>
              {g.phase === "drawing" && (
                <>
                  <span className="bar"><i style={{ width: `${(g.timeLeft / g.turnSeconds) * 100}%` }} /></span>
                  <b>{g.timeLeft}</b>
                </>
              )}
            </output>
          </header>

          <div className="canvasbox" ref={boxRef}>
            <canvas ref={canvasRef} />
            {handOn && (
              <div className="tools-zone" ref={zoneRef} aria-hidden>
                <Art className="ico" name="icon-hand" /> hand down here for tools
              </div>
            )}

            {g.phase === "board" && (
              <div className="overlay">
                <div className="card wide">
                  <h2 className="title sm"><span className="avatar sm"><Art name={`avatar-${g.avatars[artist]}`} /></span> {g.names[artist]}, pick a category!</h2>
                  <div className="board" data-little="region" data-little-label="Board"
                    data-little-data={dataFor({ artist: artist + 1, used: [...g.used] })}>
                    {Object.keys(CATEGORIES).map((cat, ci) => (
                      <div key={cat} className="col" style={{ ["--c" as string]: CATEGORY_STYLE[cat].color, animationDelay: `${ci * 0.07}s` }}>
                        <div className="catname"><span><Art name={`cat-${cat}`} /></span>{cat}</div>
                        {TIERS.map((pts, ti) => {
                          const used = g.used.has(`${cat}:${ti}`);
                          return (
                            <button key={pts} className="tile" disabled={used} data-autofocus={ci === 0 && ti === 0 ? "" : undefined}
                              data-little="control" data-little-label={`${cat} ${pts}`} data-little-action="pick_tile"
                              data-little-data={dataFor({ category: cat, points: pts, used })} onClick={() => pickTile(cat, ti)}>
                              {used ? <Art className="ico" name="icon-check" /> : pts}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <p className="small">Bigger tiles are harder and score more: 100, 200 or 300 points.{handOn ? ` Point with your ${drawHand} hand and hold still to pick.` : ""}</p>
                </div>
              </div>
            )}

            {g.phase === "countdown" && (
              <div className="overlay" data-little="region" data-little-label="Look away countdown"
                data-little-data={dataFor({ artist: artist + 1, seconds: g.phaseLeft })}>
                <div className="card">
                  <div className="emoji-big"><Art name="icon-lookaway" /></div>
                  <h2 className="title sm">Everyone except {g.names[artist]}: close your eyes!</h2>
                  <div className="big-num" key={g.phaseLeft}>{g.phaseLeft}</div>
                </div>
              </div>
            )}

            {g.phase === "memorize" && (
              <div className="overlay" data-little="region" data-little-label="Artist word reveal"
                data-little-data={dataFor({ artist: artist + 1, seconds: g.phaseLeft })}>
                <div className="card">
                  <p className="lead">{g.names[artist]}, you're drawing...</p>
                  <h2 className="secret">{g.word.toUpperCase()}</h2>
                  <p className="small">{g.phaseLeft}s · no writing letters or the word!</p>
                </div>
              </div>
            )}

            {g.phase === "award" && (
              <div className="overlay" data-little="region" data-little-label="Who got it"
                data-little-data={dataFor({ choices: g.names.map((n, i) => ({ player: i + 1, name: n })).filter((_, i) => i !== artist) })}>
                <div className="card">
                  <div className="emoji-big"><Art name="icon-correct" /></div>
                  <h2 className="title sm">That's right! Who said it?</h2>
                  <div className="row">
                    {g.names.map((n, i) => i === artist ? null : (
                      <button key={i} className="btn who" data-autofocus={i === (artist === 0 ? 1 : 0) ? "" : undefined} data-little="control"
                        data-little-label={n} data-little-action="award_point" data-little-data={dataFor({ player: i + 1 })} onClick={() => awardTo(i)}>
                        <span className="avatar"><Art name={`avatar-${g.avatars[i]}`} /></span>
                        <span>{n}</span>
                      </button>
                    ))}
                  </div>
                  <button className="btn ghost" data-little="control" data-little-label="Not right after all" data-little-action="award_point"
                    data-little-data={dataFor({ player: 0 })} onClick={resumeFromAward}>
                    Not right after all
                  </button>
                </div>
              </div>
            )}

            {g.phase === "reveal" && (
              <div className="overlay" data-little="region" data-little-label="Turn points"
                data-little-data={dataFor({ word: g.word, turnPoints: g.turnPoints, scores: g.scores })}>
                {g.solved && <Confetti />}
                <div className="card">
                  <h2 className="title sm">{g.message}</h2>
                  <div className="reveal-stage" aria-hidden>
                    <span className="spark s1"><Art name="icon-sparkle" /></span>
                    <span className="spark s2"><Art name="icon-sparkle" /></span>
                    <span className="spark s3"><Art name="icon-sparkle" /></span>
                    <div className="reveal-emoji" key={g.word}><Art name={revealArt} /></div>
                  </div>
                  <h3 className="reveal-word">It was <b>{g.word.toUpperCase()}</b>!</h3>
                  {g.mode === "team" ? (
                    <div className="row">
                      <span className={`chip lg${g.solved ? " gain" : ""}`}>
                        <span className="faces">{g.avatars.map((av, i) => <span key={i} className="avatar sm"><Art name={`avatar-${av}`} /></span>)}</span>
                        Team {g.solved ? `+${TIERS[g.tierIdx]}` : "+0"} <b>{g.teamScore}</b>
                      </span>
                    </div>
                  ) : (
                    <div className="row">
                      {g.turnPoints.map((n, i) => (
                        <span key={i} className={`chip lg${n ? " gain" : ""}`} style={{ animationDelay: `${0.9 + i * 0.15}s` }}>
                          <span className="avatar sm"><Art name={`avatar-${g.avatars[i]}`} /></span> {g.names[i]} {n ? `+${n}` : "+0"} <b>{g.scores[i]}</b>
                        </span>
                      ))}
                    </div>
                  )}
                  {g.mode === "versus" && g.lastAward && g.players > 2 && (
                    <button className="btn ghost small-btn" data-little="control" data-little-label="Wrong player?" data-little-action="change_winner"
                      data-little-data={dataFor({})} onClick={() => reopenAward()}>
                      Wrong player?
                    </button>
                  )}
                </div>
              </div>
            )}

            {g.phase === "over" && (
              <div className="overlay" data-little="region" data-little-label="Final results"
                data-little-data={dataFor({ mode: g.mode, winners: g.mode === "team" ? [] : winners(), scores: g.scores, teamScore: g.teamScore, solved: g.solvedCount, stars: teamStars })}>
                <Confetti count={80} />
                <div className="card wide">
{g.mode === "team" ? (
                  <>
                  <h2 className="title"><Art className="ico lg" name="icon-trophy" /> {teamStars === 3 ? "Amazing teamwork!" : teamStars === 2 ? "Great teamwork!" : teamStars === 1 ? "Nice teamwork!" : "Good try, team!"}</h2>
                  <div className="teamstage">
                    {g.avatars.map((av, i) => (
                      <div key={i} className="mate" style={{ animationDelay: `${i * 0.12}s` }}>
                        <span className="avatar big"><Art name={`avatar-${av}`} /></span>
                        <span className="pname">{g.names[i]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="stars" aria-hidden>
                    {[0, 1, 2].map((i) => <span key={i} className={`star${i < teamStars ? " lit" : ""}`} style={{ animationDelay: `${0.4 + i * 0.25}s` }}><Art name="decor-star" /></span>)}
                  </div>
                  <p className="teamscore"><b>{g.teamScore}</b> points · solved <b>{g.solvedCount}</b> of {g.players * ROUNDS} words</p>
                  </>
                ) : (
                  <>
                  <h2 className="title"><Art className="ico lg" name="icon-trophy" /> {winners().join(" & ")} {winners().length > 1 ? "win" : "wins"}!</h2>
                  <div className="podium">
                    {podiumOrder.map(({ i, s: pts, rank }) => (
                      <div key={i} className={`step place${Math.min(rank, 3)}`} style={{ ["--d" as string]: `${(3 - Math.min(rank, 3)) * 0.35}s` }}>
                        <div className="who">
                          {rank === 0 && <Art className="crown" name="icon-crown" />}
                          <span className="avatar big"><Art name={`avatar-${g.avatars[i]}`} /></span>
                          <span className="pname">{g.names[i]}</span>
                        </div>
                        <div className="pillar">
                          <span className="medal">{rank + 1}</span>
                          <b>{pts}</b>
                          <small>points</small>
                        </div>
                      </div>
                    ))}
                  </div>
                  </>
                )}
                  <div className="row">
                    <button className="btn big primary pulse" data-autofocus data-little="control" data-little-label="Play again"
                      data-little-action="start_game" onClick={beginMatch}>
                      Play again
                    </button>
                    <button className="btn ghost" data-little="control" data-little-label="New players"
                      data-little-action="change_players" onClick={() => { clearTimers(); goSetup(); }}>
                      New players
                    </button>
                  </div>
                </div>
              </div>
            )}

            {g.welcome && !g.exitOpen && (
              <div className="overlay dim exit-dialog" data-little="region" data-little-label="Welcome back" data-little-data={dataFor({ kind: g.welcome })}>
                <div className="card">
                  <div className="emoji-big"><Art name="decor-star" /></div>
                  <h2 className="title sm">Welcome back!</h2>
                  <p className="small">
                    {g.welcome === "restored"
                      ? "We saved your game. This turn starts over, and everyone's points are safe."
                      : "Your game was paused, and the clock is stopped. Ready?"}
                  </p>
                  <div className="row">
                    <button className="btn big primary" data-autofocus data-little="control" data-little-label="Continue"
                      data-little-action="continue_game" onClick={closeWelcome}>
                      Continue
                    </button>
                    {g.welcome === "restored" && (
                      <button className="btn ghost" data-little="control" data-little-label="Start over" data-little-action="exit_game"
                        data-little-data={dataFor({ confirm: true })} onClick={leaveGame}>
                        Start over
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {g.exitOpen && (
              <div className="overlay dim exit-dialog" data-little="region" data-little-label="Exit confirmation" data-little-data={dataFor({ paused: true })}>
                <div className="card">
                  <div className="emoji-big"><Art name="icon-exit" /></div>
                  <h2 className="title sm">Leave this game?</h2>
                  <p className="small">The clock is paused. Leaving goes back to player setup, where you can start a new game.</p>
                  <div className="row">
                    <button className="btn big primary" data-autofocus data-little="control" data-little-label="Keep playing"
                      data-little-action="exit_game" data-little-data={dataFor({ confirm: false })} onClick={closeExit}>
                      Keep playing
                    </button>
                    <button className="btn ghost" data-little="control" data-little-label="Leave game"
                      data-little-action="exit_game" data-little-data={dataFor({ confirm: true })} onClick={leaveGame}>
                      Leave game
                    </button>
                  </div>
                </div>
              </div>
            )}

            {popup && (
              <div key={popup.n} className={`popup ${popup.kind}`} role="status" data-little="readout"
                data-little-label="Guess result" data-little-data={dataFor({ result: popup.kind, text: popup.text })}>
                <Art className="ico" name={popup.kind === "right" ? "icon-correct" : "icon-oops"} /> {popup.kind === "right" ? "Correct! " : "Oops! "}{popup.text}
              </div>
            )}
            {popup?.kind === "right" && <Confetti key={`c${popup.n}`} count={50} />}

            {g.phase === "drawing" && strokes.current.length === 0 && (
              <p className={`hint${handOn ? " above-zone" : ""}`}><Art className="ico" name="icon-crayon-pen" /> {handOn
                ? `${g.names[artist]}: move your ${drawHand} hand. Hold it still to start, or raise your ${penArm} arm to draw. Hold still longer to stop. Move down to the bottom edge for colors and tools.`
                : `${g.names[artist]}: use the remote arrows and OK to draw (down at the bottom edge opens the tools).`}</p>
            )}
          </div>

          <footer>
            {g.phase === "drawing" && (
              <div className="toolbar" data-little="region" data-little-label="Drawing tools"
                data-little-data={dataFor({ tool, brush, color, down: penDown, source, hands: motionState, handDrawing: handOn, drawingHand: drawHand, penArmUp, camera: cameraOk })}>
                <div className="colors" data-little="region" data-little-label="Colors">
                  {Object.keys(COLORS).map((c) => (
                    <button key={c} className={`swatch${c === color && tool === "pen" ? " on" : ""}`} style={{ background: COLORS[c] }}
                      aria-label={c} data-little="control" data-little-label={c} data-little-action="set_color"
                      data-little-data={dataFor({ color: c })} onClick={() => setColor(c)} />
                  ))}
                </div>
                <div className="sizes" data-little="region" data-little-label="Brush size">
                  {(["small", "medium", "large"] as BrushSize[]).map((sz) => (
                    <button key={sz} className={`size${brush === sz ? " on" : ""}`} aria-label={`${sz} brush`} data-little="control"
                      data-little-label={`${sz} brush`} data-little-action="set_brush" data-little-data={dataFor({ size: sz })} onClick={() => setBrush(sz)}>
                      <i style={{ width: BRUSH_SIZES[sz] + 6, height: BRUSH_SIZES[sz] + 6 }} />
                    </button>
                  ))}
                </div>
                <button className={`tool${tool === "eraser" ? " on" : ""}`} data-little="control" data-little-label="Eraser" data-little-action="set_tool"
                  data-little-data={dataFor({ tool: tool === "eraser" ? "pen" : "eraser" })} onClick={() => setTool(tool === "eraser" ? "pen" : "eraser")}>
                  <Art name="icon-eraser" /><span>Eraser</span>
                </button>
                <button className="tool" data-little="control" data-little-label="Undo" data-little-action="undo"
                  onClick={() => { strokes.current.pop(); setPen(false); audio.sfx("swish"); }}>
                  <Art name="icon-undo" /><span>Undo</span>
                </button>
                <button className="tool" data-little="control" data-little-label="Clear" data-little-action="clear"
                  onClick={() => { audio.sfx("swish"); resetCanvas(); }}>
                  <Art name="icon-trash" /><span>Clear</span>
                </button>
                <button className={`tool${handOn ? " on" : ""}`} aria-pressed={handOn} data-little="control" data-little-label={handOn ? "Hand drawing on" : "Hand drawing off"}
                  data-little-action="set_hand_drawing" data-little-data={dataFor({ on: !handOn })} onClick={() => setHand(!handOn)}>
                  <Art name="icon-hand" /><span>Hand</span>
                </button>
                {handOn && (
                  <button className="tool" data-little="control" data-little-label={`Switch to ${penArm} hand`} data-little-action="set_drawing_hand"
                    data-little-data={dataFor({ hand: penArm })} onClick={() => setDrawHand(penArm)}>
                    <Art name="icon-hand" /><span>{drawHand === "right" ? "Right" : "Left"}</span>
                  </button>
                )}
                <output className="status" data-little="readout" data-little-label="Pen"
                  data-little-data={dataFor({ down: penDown, color, tool, source, hands: motionState })}>
                  <Art className="ico" name={penDown ? "icon-crayon-pen" : "icon-hand"} /> {penDown ? "drawing" : "pen up"}{handOn && penArmUp ? ` · ${penArm} arm up` : ""}
                </output>
              </div>
            )}
            <output className="guesses" data-little="readout" data-little-label="Wrong guesses" data-little-data={dataFor({ guesses: g.guesses })}>
              {g.guesses.length ? `Guesses: ${g.guesses.join(", ")}` : g.phase === "drawing" ? "No guesses yet" : ""}
            </output>

            {handOn && cameraOk === true && (
              <div className={`mirror ${motionState}`} data-little="region" data-little-label="Camera mirror"
                data-little-data={dataFor({ camera: cameraOk, motion: motionState, reason: motionReason, handSeen, results })}>
                <video ref={videoRef} autoPlay muted playsInline />
                <canvas ref={mirrorCanvasRef} width={320} height={240} />
                                <span className="badge">{motionState === "ready" ? (handSeen ? "tracking" : "calibrated") : motionState}</span>
                {import.meta.env.DEV && <span className="diag">{motionReason ?? "-"} · {results}</span>}
              </div>
            )}
          </footer>
        </>
      )}

      {/* The canvas box must always exist for input wiring, even on menu screens. */}
      {!inMatch && <div className="canvasbox" ref={boxRef} style={{ display: "none" }}><canvas ref={canvasRef} /></div>}
    </div>
  );
}
