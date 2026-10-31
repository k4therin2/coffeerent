export type CatId = 'dorian' | 'bean' | 'melon' | 'ginny';
export const CAT_IDS: CatId[] = ['dorian', 'bean', 'melon', 'ginny'];
export const CAT_NAMES: Record<CatId, string> = {
  dorian: 'Dorian', bean: 'Bean', melon: 'Melon', ginny: 'Ginny',
};
export const CAT_BLURB: Record<CatId, string> = {
  dorian: 'Russian blue. Silent, judgmental.',
  bean: 'Toyger. Tiny tiger, huge opinions.',
  melon: 'Fat tabby, white socks. Lord of the vent.',
  ginny: 'Grey, white socks, dramatic face.',
};

export type Dir = 'up' | 'down' | 'left' | 'right';

export type MinigameKind =
  | 'swipe'      // timing bar: knock stuff off counters
  | 'mash'       // mash to charge and release (hairball, toilet paper)
  | 'pick'       // cabinet lockpick pins
  | 'zoomies'    // arrow sequence
  | 'stare'      // don't press anything
  | 'rhythm'     // licker half of head lick
  | 'balance';   // lickee half of head lick

export interface MinigameSpec {
  token: number;
  kind: MinigameKind;
  title: string;
  /** seconds allowed */
  time: number;
  /** kind specific knobs */
  params: Record<string, number | string>;
  /** object id this targets, if any */
  objectId?: string;
  /** partner player id for paired minigames */
  partner?: string;
}

export interface PlayerState {
  id: string;
  name: string;
  cat: CatId;
  x: number; // tile units (float)
  y: number;
  dir: Dir;
  moving: boolean;
  stunnedUntil: number; // sim time
  onVent: boolean;
  carryingMouse: boolean;
  busy: boolean; // in a minigame
  /** host ignores client position reports until this sim time (after a warp) */
  ignorePosUntil: number;
  dominance: number;
  chaos: number; // personal contribution
  sprays: number;
  connected: boolean;
  /** stable per-browser-tab key so a player can rejoin after a drop */
  key: string;
}

export interface ObjectState {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  label: string;
  /** knockable: already smashed; cabinet: open; tp: unrolled; etc. */
  done: boolean;
  /** sim time when usable again (0 = now) */
  cooldownUntil: number;
  busyBy?: string;
  /** chaos paid by this object where it varies (knockables) */
  value?: number;
}

export type ObjectKind =
  | 'knock' | 'cabinet' | 'rug' | 'tp' | 'window' | 'vent' | 'zoomies'
  | 'mouse' | 'pillow' | 'bed';

export interface Objective {
  id: string;
  text: string;
  target: number;
  progress: number;
  done: boolean;
}

export interface HumanState {
  phase: 'asleep' | 'stirring' | 'patrol' | 'hunt';
  x: number;
  y: number;
  dir: Dir;
}

export interface LogEvent {
  t: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'dom';
}

export type Phase = 'lobby' | 'playing' | 'results';

export interface Departed { name: string; cat: CatId; chaos: number; dominance: number; sprays: number; reason: string }

export interface Snapshot {
  phase: Phase;
  /** players who left mid-round, kept for the results screen */
  departed: Departed[];
  /** which objective board the team is on (1 = first) */
  board: number;
  /** how many busts so far this round (the second one ends the shift) */
  busts: number;
  time: number;        // sim seconds elapsed
  timeLeft: number;
  suspicion: number;   // 0..100
  chaos: number;       // team score
  players: PlayerState[];
  objects: ObjectState[];
  objectives: Objective[];
  human: HumanState;
  mouse: { x: number; y: number; carrier: string | null; visible: boolean };
  log: LogEvent[];
  ventOccupant: string | null;
  endReason?: string;
}

// ---- network messages ----
export type ClientMsg =
  | { t: 'hello'; name: string; cat: CatId; key: string }
  | { t: 'pickcat'; cat: CatId }
  | { t: 'pos'; x: number; y: number; dir: Dir; moving: boolean }
  | { t: 'use'; target: string } // object id or 'player:<id>' or 'vent'
  | { t: 'mgdone'; token: number; success: boolean; quality: number; timedOut?: boolean }
  | { t: 'ping' }
  | { t: 'start' }       // host only
  | { t: 'again' };      // host only

export type HostMsg =
  | { t: 'welcome'; id: string; code: string }
  | { t: 'reject'; reason: string }
  | { t: 'lobby'; players: { id: string; name: string; cat: CatId; host: boolean }[] }
  | { t: 'snap'; s: Snapshot }
  | { t: 'mgstart'; spec: MinigameSpec }
  | { t: 'mgcancel'; token: number }
  | { t: 'warp'; x: number; y: number }
  | { t: 'toast'; text: string; kind: LogEvent['kind'] };

export const TILE = 32;
export const ROUND_SECONDS = 240;
export const VISION_TILES = 5.5;
