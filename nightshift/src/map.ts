import type { ObjectState } from './types';

// 36 x 20 tiles. '#' wall, '.' floor, '+' door (floor).
export const MAP_ROWS = [
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
];
export const MAP_W = MAP_ROWS[0].length;
export const MAP_H = MAP_ROWS.length;

export function isWall(tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return true;
  return MAP_ROWS[ty][tx] === '#';
}

export interface Room {
  name: string;
  x: number; y: number; w: number; h: number;
  floor: string;      // base color
  floorAlt: string;   // checker color
}
export const ROOMS: Room[] = [
  { name: 'Living Room', x: 1, y: 1, w: 10, h: 8, floor: '#4a3b2f', floorAlt: '#45372c' },
  { name: 'Kitchen',     x: 12, y: 1, w: 9, h: 8, floor: '#6f7a80', floorAlt: '#66717a' },
  { name: 'Bedroom',     x: 22, y: 1, w: 13, h: 8, floor: '#4b3550', floorAlt: '#45304a' },
  { name: 'Hallway',     x: 1, y: 10, w: 34, h: 3, floor: '#5a4a3c', floorAlt: '#544538' },
  { name: 'Bathroom',    x: 1, y: 14, w: 9, h: 5, floor: '#6b8a8c', floorAlt: '#638184' },
  { name: 'Laundry',     x: 11, y: 14, w: 11, h: 5, floor: '#707070', floorAlt: '#686868' },
  { name: 'Office',      x: 23, y: 14, w: 12, h: 5, floor: '#3e4a3a', floorAlt: '#394535' },
];

export function roomAt(tx: number, ty: number): Room | undefined {
  return ROOMS.find(r => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
}

/** Decorative furniture: drawn, and blocks movement. */
export interface Furniture {
  kind: 'couch' | 'table' | 'counter' | 'fridge' | 'bed' | 'nightstand' | 'toilet' | 'tub'
      | 'washer' | 'dryer' | 'desk' | 'chair' | 'shelf' | 'plant' | 'litter' | 'catbed' | 'tv' | 'lamp';
  x: number; y: number; w: number; h: number; solid: boolean;
  /** furniture a cat can hide behind: blocks line of sight for the human and for the fog */
  tall?: boolean;
}
export const FURNITURE: Furniture[] = [
  // Living room
  { kind: 'couch', tall: true, x: 4, y: 6, w: 4, h: 1, solid: true },
  { kind: 'table', tall: true, x: 5, y: 3, w: 2, h: 1, solid: true },
  { kind: 'tv', x: 8, y: 1, w: 2, h: 1, solid: true },
  { kind: 'plant', tall: true, x: 10, y: 1, w: 1, h: 1, solid: true },
  { kind: 'catbed', x: 1, y: 7, w: 1, h: 1, solid: false },
  { kind: 'lamp', x: 1, y: 1, w: 1, h: 1, solid: true },
  // Kitchen
  { kind: 'counter', x: 12, y: 1, w: 8, h: 1, solid: true },
  { kind: 'fridge', tall: true, x: 20, y: 1, w: 1, h: 1, solid: true },
  { kind: 'shelf', tall: true, x: 20, y: 3, w: 1, h: 1, solid: true },
  { kind: 'table', tall: true, x: 15, y: 5, w: 2, h: 1, solid: true },
  // Bedroom
  { kind: 'bed', tall: true, x: 28, y: 1, w: 4, h: 3, solid: true },
  { kind: 'nightstand', x: 32, y: 1, w: 1, h: 1, solid: true },
  { kind: 'nightstand', x: 27, y: 1, w: 1, h: 1, solid: true },
  { kind: 'shelf', tall: true, x: 23, y: 1, w: 2, h: 1, solid: true },
  // Bathroom
  { kind: 'toilet', x: 1, y: 14, w: 1, h: 1, solid: true },
  { kind: 'tub', tall: true, x: 6, y: 14, w: 3, h: 1, solid: true },
  // Laundry
  { kind: 'washer', tall: true, x: 11, y: 14, w: 1, h: 1, solid: true },
  { kind: 'dryer', tall: true, x: 12, y: 14, w: 1, h: 1, solid: true },
  { kind: 'litter', x: 20, y: 17, w: 1, h: 1, solid: false },
  { kind: 'shelf', tall: true, x: 21, y: 14, w: 1, h: 1, solid: true },
  // Office
  { kind: 'desk', tall: true, x: 28, y: 14, w: 3, h: 1, solid: true },
  { kind: 'chair', x: 29, y: 15, w: 1, h: 1, solid: true },
  { kind: 'shelf', tall: true, x: 23, y: 14, w: 2, h: 1, solid: true },
  { kind: 'plant', tall: true, x: 34, y: 14, w: 1, h: 1, solid: true },
];

const TALL = new Set<string>();
for (const f of FURNITURE) if (f.tall) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) TALL.add(x + ',' + y);
/** walls and tall furniture block sight */
export function blocksSight(tx: number, ty: number): boolean { return isWall(tx, ty) || TALL.has(tx + ',' + ty); }

export function isSolid(tx: number, ty: number): boolean {
  if (isWall(tx, ty)) return true;
  for (const f of FURNITURE) {
    if (f.solid && tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) return true;
  }
  return false;
}

export const CAT_BED = { x: 1.5, y: 7.5 };
/** spawn row: living room row 5 is clear of furniture */
export const SPAWNS = [0, 1, 2, 3].map(i => ({ x: 1.5 + i * 0.9, y: 5.5 }));
export const MOUSE_SPAWN = { x: 15.5, y: 17.5 };
export const HUMAN_BED = { x: 29.5, y: 2.5 };
/** where a sprayed cat lands: the litter box in the laundry, a real walk from everything */
export const LITTER = { x: 20.5, y: 17.5 };

export interface Waypoint { x: number; y: number; wait?: number }
const OUT_OF_BED: Waypoint[] = [{ x: 29.5, y: 4.5 }, { x: 29.5, y: 6.5 }, { x: 23.5, y: 6.5 }, { x: 23.5, y: 11.5 }];
const BACK_TO_BED: Waypoint[] = [{ x: 23.5, y: 11.5 }, { x: 23.5, y: 6.5 }, { x: 29.5, y: 6.5 }, { x: 29.5, y: 4.5 }];
/**
 * Axis-aligned patrol routes for the human, all through doors. Picked at random
 * per wake-up so the house never feels safe by memory.
 */
export const HUMAN_ROUTES: Record<string, Waypoint[]> = {
  // the classic hallway sweep with kitchen and living room door checks
  hallway: [...OUT_OF_BED,
    { x: 18.5, y: 11.5 }, { x: 18.5, y: 6.5 }, { x: 18.5, y: 11.5 },
    { x: 5.5, y: 11.5 }, { x: 5.5, y: 7.5 }, { x: 5.5, y: 11.5 },
    ...BACK_TO_BED],
  // into the kitchen: puts the counter and the treat cabinet in range
  kitchen: [...OUT_OF_BED,
    { x: 18.5, y: 11.5 }, { x: 18.5, y: 3.5 }, { x: 16.5, y: 3.5, wait: 1.5 }, { x: 18.5, y: 3.5 }, { x: 18.5, y: 11.5 },
    { x: 10.5, y: 11.5 }, { x: 18.5, y: 11.5 },
    ...BACK_TO_BED],
  // into the living room (rug and vent in range) and a glance into the bathroom
  living: [...OUT_OF_BED,
    { x: 5.5, y: 11.5 }, { x: 5.5, y: 7.5 }, { x: 8.5, y: 7.5 }, { x: 8.5, y: 4.5, wait: 1 }, { x: 8.5, y: 7.5 }, { x: 5.5, y: 7.5 }, { x: 5.5, y: 11.5 },
    { x: 4.5, y: 11.5 }, { x: 4.5, y: 14.5, wait: 1 }, { x: 4.5, y: 11.5 },
    ...BACK_TO_BED],
  // midnight errands: a pee break, or a snack from the fridge
  bathroom: [...OUT_OF_BED,
    { x: 4.5, y: 11.5 }, { x: 4.5, y: 15.5, wait: 5 }, { x: 4.5, y: 11.5 },
    ...BACK_TO_BED],
  snack: [...OUT_OF_BED,
    { x: 18.5, y: 11.5 }, { x: 18.5, y: 2.5 }, { x: 19.5, y: 2.5, wait: 4 }, { x: 18.5, y: 2.5 }, { x: 18.5, y: 11.5 },
    ...BACK_TO_BED],
};
/** kept for scripts that import the old name */
export const HUMAN_PATROL = HUMAN_ROUTES.hallway;

export function makeObjects(): ObjectState[] {
  const o = (id: string, kind: ObjectState['kind'], x: number, y: number, label: string, value?: number): ObjectState =>
    ({ id, kind, x: x + 0.5, y: y + 0.5, label, done: false, cooldownUntil: 0, value });
  return [
    // knockables sit ON furniture; interaction is from the adjacent tile.
    // the far ones (bedroom, office) pay more for the walk.
    o('glass1', 'knock', 13, 1, 'wine glass', 15),
    o('glass2', 'knock', 15, 1, 'coffee mug', 15),
    o('glass3', 'knock', 17, 1, 'spice jar', 15),
    o('glass4', 'knock', 19, 1, 'cereal bowl', 15),
    o('mug', 'knock', 6, 3, 'tea cup', 15),
    o('water', 'knock', 32, 1, 'bedside water', 20),
    o('pens', 'knock', 30, 14, 'pen cup', 20),
    o('cabinet', 'cabinet', 20, 3, 'treat cabinet'),
    o('rug', 'rug', 6, 4, 'the good rug'),
    o('tp', 'tp', 2, 14, 'toilet paper'),
    o('window', 'window', 3, 1, 'the window'),
    o('vent', 'vent', 9, 7, 'heating vent'),
    o('zoomies', 'zoomies', 2, 11, 'hallway runway'),
    o('pillow', 'pillow', 29, 3, "the human's pillow"),
    o('mousepad', 'mouse', 15, 17, 'toy mouse'),
  ];
}

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
