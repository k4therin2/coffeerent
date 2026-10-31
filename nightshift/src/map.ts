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
}
export const FURNITURE: Furniture[] = [
  // Living room
  { kind: 'couch', x: 4, y: 6, w: 4, h: 1, solid: true },
  { kind: 'table', x: 5, y: 3, w: 2, h: 1, solid: true },
  { kind: 'tv', x: 8, y: 1, w: 2, h: 1, solid: true },
  { kind: 'plant', x: 10, y: 1, w: 1, h: 1, solid: true },
  { kind: 'catbed', x: 1, y: 7, w: 1, h: 1, solid: false },
  { kind: 'lamp', x: 1, y: 1, w: 1, h: 1, solid: true },
  // Kitchen
  { kind: 'counter', x: 12, y: 1, w: 8, h: 1, solid: true },
  { kind: 'fridge', x: 20, y: 1, w: 1, h: 1, solid: true },
  { kind: 'shelf', x: 20, y: 3, w: 1, h: 1, solid: true },
  { kind: 'table', x: 15, y: 5, w: 2, h: 1, solid: true },
  // Bedroom
  { kind: 'bed', x: 28, y: 1, w: 4, h: 3, solid: true },
  { kind: 'nightstand', x: 32, y: 1, w: 1, h: 1, solid: true },
  { kind: 'nightstand', x: 27, y: 1, w: 1, h: 1, solid: true },
  { kind: 'shelf', x: 23, y: 1, w: 2, h: 1, solid: true },
  // Bathroom
  { kind: 'toilet', x: 1, y: 14, w: 1, h: 1, solid: true },
  { kind: 'tub', x: 6, y: 14, w: 3, h: 1, solid: true },
  // Laundry
  { kind: 'washer', x: 11, y: 14, w: 1, h: 1, solid: true },
  { kind: 'dryer', x: 12, y: 14, w: 1, h: 1, solid: true },
  { kind: 'litter', x: 20, y: 17, w: 1, h: 1, solid: false },
  { kind: 'shelf', x: 21, y: 14, w: 1, h: 1, solid: true },
  // Office
  { kind: 'desk', x: 28, y: 14, w: 3, h: 1, solid: true },
  { kind: 'chair', x: 29, y: 15, w: 1, h: 1, solid: true },
  { kind: 'shelf', x: 23, y: 14, w: 2, h: 1, solid: true },
  { kind: 'plant', x: 34, y: 14, w: 1, h: 1, solid: true },
];

export function isSolid(tx: number, ty: number): boolean {
  if (isWall(tx, ty)) return true;
  for (const f of FURNITURE) {
    if (f.solid && tx >= f.x && tx < f.x + f.w && ty >= f.y && ty < f.y + f.h) return true;
  }
  return false;
}

export const CAT_BED = { x: 1.5, y: 7.5 };
export const MOUSE_SPAWN = { x: 15.5, y: 17.5 };
export const HUMAN_BED = { x: 29.5, y: 4.6 };
/** axis-aligned patrol loop for the human, all through doors */
export const HUMAN_PATROL: { x: number; y: number }[] = [
  { x: 29.5, y: 6.5 }, { x: 23.5, y: 6.5 }, { x: 23.5, y: 11.5 },
  { x: 18.5, y: 11.5 }, { x: 18.5, y: 6.5 }, { x: 18.5, y: 11.5 },
  { x: 5.5, y: 11.5 }, { x: 5.5, y: 5.5 }, { x: 5.5, y: 11.5 },
  { x: 23.5, y: 11.5 }, { x: 23.5, y: 6.5 }, { x: 29.5, y: 6.5 },
];

export function makeObjects(): ObjectState[] {
  const o = (id: string, kind: ObjectState['kind'], x: number, y: number, label: string): ObjectState =>
    ({ id, kind, x: x + 0.5, y: y + 0.5, label, done: false, cooldownUntil: 0 });
  return [
    // knockables sit ON furniture; interaction is from the adjacent tile
    o('glass1', 'knock', 13, 1, 'wine glass'),
    o('glass2', 'knock', 15, 1, 'coffee mug'),
    o('glass3', 'knock', 17, 1, 'spice jar'),
    o('glass4', 'knock', 19, 1, 'cereal bowl'),
    o('mug', 'knock', 6, 3, 'tea cup'),
    o('water', 'knock', 32, 1, 'bedside water'),
    o('pens', 'knock', 30, 14, 'pen cup'),
    o('cabinet', 'cabinet', 20, 3, 'treat cabinet'),
    o('rug', 'rug', 6, 4, 'the good rug'),
    o('tp', 'tp', 2, 14, 'toilet paper'),
    o('window', 'window', 3, 1, 'the window'),
    o('vent', 'vent', 9, 7, 'heating vent'),
    o('zoomies', 'zoomies', 2, 11, 'hallway runway'),
    o('pillow', 'pillow', 29, 1, "the human's pillow"),
    o('mousepad', 'mouse', 15, 17, 'toy mouse'),
  ];
}

/** Bresenham line of sight on the tile grid. Walls (not furniture) block. */
export function hasLOS(x0: number, y0: number, x1: number, y1: number): boolean {
  let ax = Math.floor(x0), ay = Math.floor(y0);
  const bx = Math.floor(x1), by = Math.floor(y1);
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (ax === bx && ay === by) return true;
    if (isWall(ax, ay) && !(ax === Math.floor(x0) && ay === Math.floor(y0))) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; ax += sx; }
    if (e2 <= dx) { err += dx; ay += sy; }
  }
}
