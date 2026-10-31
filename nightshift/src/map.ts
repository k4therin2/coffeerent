import type { ObjectState } from './types';

/**
 * House layouts. Every map provides the same object ids (glass1-4, mug, water,
 * pens, cabinet, rug, tp, window, vent, zoomies, pillow, mousepad, snackspot,
 * drawer1-4) so objectives, specials and the human's errands work everywhere.
 * `tools/validate-maps.mjs` checks reachability, routes and spawns for all of them.
 */

export interface Room { name: string; x: number; y: number; w: number; h: number; floor: string; floorAlt: string }
export interface Furniture {
  kind: 'couch' | 'table' | 'counter' | 'fridge' | 'bed' | 'nightstand' | 'toilet' | 'tub'
      | 'washer' | 'dryer' | 'desk' | 'chair' | 'shelf' | 'plant' | 'litter' | 'catbed' | 'tv' | 'lamp';
  x: number; y: number; w: number; h: number; solid: boolean;
  /** furniture a cat can hide behind: blocks line of sight for the human and for the fog */
  tall?: boolean;
}
export interface Waypoint { x: number; y: number; wait?: number }
export interface Pt { x: number; y: number }
export interface MapDef {
  id: string;
  name: string;
  blurb: string;
  rows: string[];
  rooms: Room[];
  furniture: Furniture[];
  objects: ObjectState[];
  catBed: Pt;
  spawns: Pt[];
  mouseSpawn: Pt;
  humanBed: Pt;
  litter: Pt;
  routes: Record<'hallway' | 'kitchen' | 'living' | 'bathroom' | 'snack', Waypoint[]>;
  snackSpots: Pt[];
}

const F = (kind: Furniture['kind'], x: number, y: number, w = 1, h = 1, opts: { solid?: boolean; tall?: boolean } = {}): Furniture =>
  ({ kind, x, y, w, h, solid: opts.solid ?? !['catbed', 'litter'].includes(kind), tall: opts.tall ?? ['couch', 'table', 'bed', 'desk', 'tub', 'fridge', 'shelf', 'plant', 'washer', 'dryer'].includes(kind) });
const O = (id: string, kind: ObjectState['kind'], x: number, y: number, label: string, value?: number): ObjectState =>
  ({ id, kind, x: x + 0.5, y: y + 0.5, label, done: false, cooldownUntil: 0, value });
const P = (x: number, y: number): Pt => ({ x, y });
const W = (x: number, y: number, wait?: number): Waypoint => wait ? { x, y, wait } : { x, y };
const FLOORS = {
  living: ['#4a3b2f', '#45372c'], kitchen: ['#6f7a80', '#66717a'], bedroom: ['#4b3550', '#45304a'], hall: ['#5a4a3c', '#544538'],
  bath: ['#6b8a8c', '#638184'], laundry: ['#707070', '#686868'], office: ['#3e4a3a', '#394535'], loft: ['#5c4a3a', '#564536'],
};
const R = (name: string, x: number, y: number, w: number, h: number, f: keyof typeof FLOORS): Room => ({ name, x, y, w, h, floor: FLOORS[f][0], floorAlt: FLOORS[f][1] });

// ---------------------------------------------------------------- The Flat
const FLAT_OUT = [W(29.5, 4.5), W(29.5, 6.5), W(23.5, 6.5), W(23.5, 11.5)];
const FLAT_BACK = [W(23.5, 11.5), W(23.5, 6.5), W(29.5, 6.5), W(29.5, 4.5)];
const FLAT: MapDef = {
  id: 'flat', name: 'The Flat', blurb: 'Three rooms up top, three down, one long hallway. The classic.',
  rows: [
    '####################################',
    '#..........#.........#.............#',
    '#..........#.........#.............#',
    '#..........#.........#.............#',
    '#..........#.........#.............#',
    '#..........+.........#.............#',
    '#..........#.........+.............#',
    '#..........#.........#.............#',
    '#..........#.........#.............#',
    '#####+############+####+############',
    '#..................................#',
    '#..................................#',
    '#..................................#',
    '####+#########+##########+##########',
    '#.........#...........#............#',
    '#.........#...........#............#',
    '#.........#...........#............#',
    '#.........#...........#............#',
    '#.........#...........#............#',
    '####################################',
  ],
  rooms: [
    R('Living Room', 1, 1, 10, 8, 'living'), R('Kitchen', 12, 1, 9, 8, 'kitchen'), R('Bedroom', 22, 1, 13, 8, 'bedroom'),
    R('Hallway', 1, 10, 34, 3, 'hall'), R('Bathroom', 1, 14, 9, 5, 'bath'), R('Laundry', 11, 14, 11, 5, 'laundry'), R('Office', 23, 14, 12, 5, 'office'),
  ],
  furniture: [
    F('couch', 4, 6, 4, 1), F('table', 5, 3, 2, 1), F('tv', 8, 1, 2, 1), F('plant', 10, 1), F('catbed', 1, 7), F('lamp', 1, 1),
    F('counter', 12, 1, 8, 1), F('fridge', 20, 1), F('shelf', 20, 3), F('table', 15, 5, 2, 1),
    F('bed', 28, 1, 4, 3), F('nightstand', 32, 1), F('nightstand', 27, 1), F('shelf', 23, 1, 2, 1),
    F('toilet', 1, 14), F('tub', 6, 14, 3, 1),
    F('washer', 11, 14), F('dryer', 12, 14), F('litter', 20, 17), F('shelf', 21, 14),
    F('desk', 28, 14, 3, 1), F('chair', 29, 15), F('shelf', 23, 14, 2, 1), F('plant', 34, 14),
  ],
  objects: [
    O('glass1', 'knock', 13, 1, 'wine glass', 15), O('glass2', 'knock', 15, 1, 'coffee mug', 15), O('glass3', 'knock', 17, 1, 'spice jar', 15), O('glass4', 'knock', 19, 1, 'cereal bowl', 15),
    O('mug', 'knock', 6, 3, 'tea cup', 15), O('water', 'knock', 32, 1, 'bedside water', 20), O('pens', 'knock', 30, 14, 'pen cup', 20),
    O('cabinet', 'cabinet', 20, 3, 'treat cabinet'), O('rug', 'rug', 6, 4, 'the good rug'), O('tp', 'tp', 2, 14, 'toilet paper'),
    O('window', 'window', 3, 1, 'the window'), O('vent', 'vent', 9, 7, 'heating vent'), O('zoomies', 'zoomies', 2, 11, 'hallway runway'),
    O('pillow', 'pillow', 29, 3, "the human's pillow"), O('mousepad', 'mouse', 15, 17, 'toy mouse'), O('snackspot', 'snack', 8, 4, "the human's snack"),
    O('drawer1', 'drawer', 12, 1, 'kitchen drawer'), O('drawer2', 'drawer', 27, 1, 'nightstand drawer'), O('drawer3', 'drawer', 28, 14, 'desk drawer'), O('drawer4', 'drawer', 21, 14, 'laundry drawer'),
  ],
  catBed: P(1.5, 7.5), spawns: [0, 1, 2, 3].map(i => P(1.5 + i * 0.9, 5.5)), mouseSpawn: P(15.5, 17.5), humanBed: P(29.5, 2.5), litter: P(20.5, 17.5),
  routes: {
    hallway: [...FLAT_OUT, W(18.5, 11.5), W(18.5, 6.5), W(18.5, 11.5), W(5.5, 11.5), W(5.5, 7.5), W(5.5, 11.5), ...FLAT_BACK],
    kitchen: [...FLAT_OUT, W(18.5, 11.5), W(18.5, 3.5), W(16.5, 3.5, 1.5), W(18.5, 3.5), W(18.5, 11.5), W(10.5, 11.5), W(18.5, 11.5), ...FLAT_BACK],
    living: [...FLAT_OUT, W(5.5, 11.5), W(5.5, 7.5), W(8.5, 7.5), W(8.5, 4.5, 1), W(8.5, 7.5), W(5.5, 7.5), W(5.5, 11.5), W(4.5, 11.5), W(4.5, 14.5, 1), W(4.5, 11.5), ...FLAT_BACK],
    bathroom: [...FLAT_OUT, W(4.5, 11.5), W(4.5, 15.5, 5), W(4.5, 11.5), ...FLAT_BACK],
    snack: [...FLAT_OUT, W(18.5, 11.5), W(18.5, 2.5), W(19.5, 2.5, 4), W(18.5, 2.5), W(18.5, 11.5), ...FLAT_BACK],
  },
  snackSpots: [P(8.5, 4.5), P(16.5, 6.5), P(20.5, 11.5), P(30.5, 16.5), P(33.5, 3.5), P(2.5, 4.5), P(13.5, 17.5)],
};

// ------------------------------------------------------------ The Bungalow
const BUN_OUT = [W(10.5, 14.5), W(7.5, 14.5), W(7.5, 8.5)];
const BUN_BACK = [W(7.5, 8.5), W(7.5, 14.5), W(10.5, 14.5)];
const BUNGALOW: MapDef = {
  id: 'bungalow', name: 'The Bungalow', blurb: 'Kitchen, living room and office across the top; the bedroom is downstairs by the hallway.',
  rows: [
    '####################################',
    '#............#.........#...........#',
    '#............#.........#...........#',
    '#............+.........+...........#',
    '#............#.........#...........#',
    '#............#.........#...........#',
    '#............#.........#...........#',
    '######+#############+#######+#######',
    '#..................................#',
    '#..................................#',
    '#######+#########+##########+#######',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '#.............#.....#..............#',
    '####################################',
  ],
  rooms: [
    R('Kitchen', 1, 1, 12, 6, 'kitchen'), R('Living Room', 14, 1, 9, 6, 'living'), R('Office', 24, 1, 11, 6, 'office'),
    R('Hallway', 1, 8, 34, 2, 'hall'), R('Bedroom', 1, 11, 13, 8, 'bedroom'), R('Bathroom', 15, 11, 5, 8, 'bath'), R('Laundry', 21, 11, 14, 8, 'laundry'),
  ],
  furniture: [
    F('counter', 2, 1, 8, 1), F('fridge', 10, 1), F('shelf', 11, 1), F('table', 3, 4, 2, 1), F('lamp', 1, 1),
    F('tv', 14, 1, 2, 1), F('plant', 22, 1), F('couch', 16, 5, 4, 1), F('table', 21, 3), F('catbed', 14, 6),
    F('desk', 27, 1, 3, 1), F('chair', 28, 2), F('shelf', 33, 1), F('plant', 24, 1),
    F('bed', 9, 11, 4, 3), F('nightstand', 8, 11), F('nightstand', 13, 11), F('lamp', 1, 11), F('plant', 1, 18),
    F('toilet', 15, 11), F('tub', 18, 11, 2, 1),
    F('washer', 21, 11), F('dryer', 22, 11), F('shelf', 34, 11), F('litter', 33, 17),
  ],
  objects: [
    O('glass1', 'knock', 3, 1, 'wine glass', 15), O('glass2', 'knock', 5, 1, 'coffee mug', 15), O('glass3', 'knock', 7, 1, 'spice jar', 15), O('glass4', 'knock', 9, 1, 'cereal bowl', 15),
    O('mug', 'knock', 21, 3, 'tea cup', 15), O('water', 'knock', 8, 11, 'bedside water', 20), O('pens', 'knock', 29, 1, 'pen cup', 20),
    O('cabinet', 'cabinet', 11, 1, 'treat cabinet'), O('rug', 'rug', 18, 3, 'the good rug'), O('tp', 'tp', 16, 11, 'toilet paper'),
    O('window', 'window', 18, 1, 'the window'), O('vent', 'vent', 22, 6, 'heating vent'), O('zoomies', 'zoomies', 2, 8, 'hallway runway'),
    O('pillow', 'pillow', 10, 13, "the human's pillow"), O('mousepad', 'mouse', 27, 16, 'toy mouse'), O('snackspot', 'snack', 16, 2, "the human's snack"),
    O('drawer1', 'drawer', 2, 1, 'kitchen drawer'), O('drawer2', 'drawer', 13, 11, 'nightstand drawer'), O('drawer3', 'drawer', 27, 1, 'desk drawer'), O('drawer4', 'drawer', 34, 11, 'laundry drawer'),
  ],
  catBed: P(14.5, 6.5), spawns: [0, 1, 2, 3].map(i => P(16.5 + i, 6.5)), mouseSpawn: P(27.5, 16.5), humanBed: P(10.5, 12.5), litter: P(33.5, 17.5),
  routes: {
    hallway: [...BUN_OUT, W(20.5, 8.5), W(20.5, 6.5), W(20.5, 8.5), W(28.5, 8.5), W(28.5, 5.5), W(28.5, 8.5), W(6.5, 8.5), W(6.5, 6.5), W(6.5, 8.5), ...BUN_BACK],
    kitchen: [...BUN_OUT, W(6.5, 8.5), W(6.5, 2.5), W(2.5, 2.5, 1.5), W(8.5, 2.5, 1), W(6.5, 2.5), W(6.5, 8.5), ...BUN_BACK],
    living: [...BUN_OUT, W(20.5, 8.5), W(20.5, 2.5, 1), W(16.5, 2.5), W(20.5, 2.5), W(20.5, 8.5), W(17.5, 8.5), W(17.5, 12.5, 1), W(17.5, 8.5), ...BUN_BACK],
    bathroom: [...BUN_OUT, W(17.5, 8.5), W(17.5, 14.5, 5), W(17.5, 8.5), ...BUN_BACK],
    snack: [...BUN_OUT, W(6.5, 8.5), W(6.5, 2.5), W(9.5, 2.5, 4), W(6.5, 2.5), W(6.5, 8.5), ...BUN_BACK],
  },
  snackSpots: [P(16.5, 2.5), P(3.5, 5.5), P(31.5, 4.5), P(5.5, 16.5), P(26.5, 13.5), P(18.5, 8.5), P(2.5, 14.5)],
};

// ---------------------------------------------------------------- The Loft
const LOFT_OUT = [W(7.5, 4.5), W(11.5, 4.5), W(13.5, 4.5)];
const LOFT_BACK = [W(13.5, 4.5), W(11.5, 4.5), W(7.5, 4.5)];
const LOFT: MapDef = {
  id: 'loft', name: 'The Loft', blurb: 'One big open floor: kitchen and living room share the space, so there is nowhere the human cannot wander.',
  rows: [
    '####################################',
    '#..........#.......................#',
    '#..........#.......................#',
    '#..........#.......................#',
    '#..........+.......................#',
    '#..........#.......................#',
    '#####+######.......................#',
    '#..........#.......................#',
    '#..........+.......................#',
    '#..........#.......................#',
    '############.......................#',
    '#..................................#',
    '#..................................#',
    '#......##########........###########',
    '#......#........#........#.........#',
    '#......#........+........+.........#',
    '#......#........#........#.........#',
    '#......#........#........#.........#',
    '#......#........#........#.........#',
    '####################################',
  ],
  rooms: [
    R('Bedroom', 1, 1, 10, 5, 'bedroom'), R('Bathroom', 1, 7, 10, 3, 'bath'), R('Loft', 12, 1, 23, 12, 'loft'),
    R('Hallway', 1, 11, 11, 2, 'hall'), R('Nook', 1, 13, 6, 6, 'living'), R('Landing', 17, 13, 8, 6, 'hall'),
    R('Laundry', 8, 14, 8, 5, 'laundry'), R('Office', 26, 14, 9, 5, 'office'),
  ],
  furniture: [
    F('bed', 6, 1, 4, 3), F('nightstand', 5, 1), F('nightstand', 10, 1), F('lamp', 1, 1),
    F('toilet', 1, 7), F('tub', 8, 7, 3, 1),
    F('counter', 13, 1, 8, 1), F('fridge', 21, 1), F('shelf', 22, 1), F('table', 16, 5, 2, 1),
    F('tv', 29, 1, 2, 1), F('plant', 34, 1), F('couch', 28, 6, 4, 1), F('table', 29, 8, 2, 1), F('catbed', 3, 16), F('plant', 34, 11),
    F('washer', 8, 14), F('dryer', 9, 14), F('shelf', 15, 14), F('litter', 15, 17),
    F('desk', 30, 14, 3, 1), F('chair', 31, 15), F('plant', 34, 14), F('shelf', 26, 14),
    F('plant', 1, 13), F('lamp', 6, 18),
  ],
  objects: [
    O('glass1', 'knock', 14, 1, 'wine glass', 15), O('glass2', 'knock', 16, 1, 'coffee mug', 15), O('glass3', 'knock', 18, 1, 'spice jar', 15), O('glass4', 'knock', 20, 1, 'cereal bowl', 15),
    O('mug', 'knock', 30, 8, 'tea cup', 15), O('water', 'knock', 5, 1, 'bedside water', 20), O('pens', 'knock', 31, 14, 'pen cup', 20),
    O('cabinet', 'cabinet', 22, 1, 'treat cabinet'), O('rug', 'rug', 29, 4, 'the good rug'), O('tp', 'tp', 2, 7, 'toilet paper'),
    O('window', 'window', 33, 1, 'the window'), O('vent', 'vent', 26, 11, 'heating vent'), O('zoomies', 'zoomies', 2, 11, 'hallway runway'),
    O('pillow', 'pillow', 7, 3, "the human's pillow"), O('mousepad', 'mouse', 12, 17, 'toy mouse'), O('snackspot', 'snack', 26, 2, "the human's snack"),
    O('drawer1', 'drawer', 13, 1, 'kitchen drawer'), O('drawer2', 'drawer', 10, 1, 'nightstand drawer'), O('drawer3', 'drawer', 30, 14, 'desk drawer'), O('drawer4', 'drawer', 15, 14, 'laundry drawer'),
  ],
  catBed: P(3.5, 16.5), spawns: [0, 1, 2, 3].map(i => P(2.5 + i, 14.5)), mouseSpawn: P(12.5, 17.5), humanBed: P(7.5, 2.5), litter: P(15.5, 17.5),
  routes: {
    hallway: [...LOFT_OUT, W(13.5, 11.5), W(24.5, 11.5), W(24.5, 8.5), W(24.5, 11.5), W(13.5, 11.5), ...LOFT_BACK],
    kitchen: [...LOFT_OUT, W(13.5, 2.5), W(19.5, 2.5, 1.5), W(19.5, 4.5), W(23.5, 4.5), W(13.5, 4.5), ...LOFT_BACK],
    living: [...LOFT_OUT, W(13.5, 11.5), W(24.5, 11.5), W(24.5, 3.5, 1), W(24.5, 11.5), W(13.5, 11.5), W(12.5, 11.5), W(12.5, 8.5), W(9.5, 8.5, 1), W(12.5, 8.5), W(12.5, 11.5), W(13.5, 11.5), ...LOFT_BACK],
    bathroom: [...LOFT_OUT, W(13.5, 8.5), W(12.5, 8.5), W(9.5, 8.5, 5), W(12.5, 8.5), W(13.5, 8.5), ...LOFT_BACK],
    snack: [...LOFT_OUT, W(13.5, 2.5), W(20.5, 2.5, 4), W(13.5, 2.5), ...LOFT_BACK],
  },
  snackSpots: [P(4.5, 17.5), P(20.5, 16.5), P(30.5, 10.5), P(3.5, 12.5), P(28.5, 16.5), P(26.5, 2.5), P(22.5, 7.5)],
};

export const MAPS: Record<string, MapDef> = { flat: FLAT, bungalow: BUNGALOW, loft: LOFT };
export const MAP_IDS = Object.keys(MAPS);

// ---------------------------------------------------------------- active map
/** the map everything below reads from; the host sets it at round start, clients from the snapshot */
export let M: MapDef = FLAT;
let TALL = new Set<string>();
let CLIMB = new Set<string>();
const CLIMBABLE_KINDS = new Set<Furniture['kind']>(['counter', 'table', 'desk']);
function index() {
  TALL = new Set(); CLIMB = new Set();
  for (const f of M.furniture) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) {
    if (f.tall) TALL.add(x + ',' + y);
    if (CLIMBABLE_KINDS.has(f.kind)) CLIMB.add(x + ',' + y);
  }
}
index();
export function setMap(id: string): MapDef {
  M = MAPS[id] ?? FLAT;
  index();
  return M;
}
export function mapW() { return M.rows[0].length; }
export function mapH() { return M.rows.length; }

export function isWall(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= mapW() || ty >= mapH()) return true;
  return M.rows[ty][tx] === '#';
}
export function roomAt(tx: number, ty: number): Room | undefined {
  return M.rooms.find(r => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
}
/** walls and tall furniture block sight */
export function blocksSight(tx: number, ty: number): boolean { return isWall(tx, ty) || TALL.has(tx + ',' + ty); }
/** surfaces Dorian may stand on (counters, tables, the desk) */
export function isClimbable(tx: number, ty: number): boolean { return CLIMB.has(tx + ',' + ty); }
export function isSolid(tx: number, ty: number, canClimb = false): boolean {
  if (isWall(tx, ty)) return true;
  if (canClimb && isClimbable(tx, ty)) return false;
  for (const f of M.furniture) {
    if (f.solid && tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) return true;
  }
  return false;
}
/** fresh copies of the active map's interactables */
export function makeObjects(): ObjectState[] { return M.objects.map(o => ({ ...o })); }

/** Bresenham line of sight on the tile grid. Walls and tall furniture block; the end tiles never do. */
export function hasLOS(x0: number, y0: number, x1: number, y1: number): boolean {
  let ax = Math.floor(x0), ay = Math.floor(y0);
  const bx = Math.floor(x1), by = Math.floor(y1);
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (ax === bx && ay === by) return true;
    if (blocksSight(ax, ay) && !(ax === Math.floor(x0) && ay === Math.floor(y0))) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}
