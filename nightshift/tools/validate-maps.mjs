// Validates every house layout in src/map.ts: reachability, routes, spawns, cover.
// Usage: node tools/validate-maps.mjs   (compiles src/map.ts + src/types.ts to a temp dir first)
import { execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const out = mkdtempSync(join(tmpdir(), 'ns-maps-'));
execSync(`npx tsc src/map.ts src/types.ts --outDir ${out} --module es2020 --target es2020 --moduleResolution bundler --skipLibCheck`, { stdio: 'inherit' });
writeFileSync(join(out, 'package.json'), '{"type":"module"}');
for (const f of readdirSync(out)) if (f.endsWith('.js')) writeFileSync(join(out, f), readFileSync(join(out, f), 'utf8').replace(/from '(\.\/[^']+)'/g, (m, p) => p.endsWith('.js') ? m : `from '${p}.js'`));
const map = await import(pathToFileURL(join(out, 'map.js')).href);

const REQUIRED = ['glass1', 'glass2', 'glass3', 'glass4', 'mug', 'water', 'pens', 'cabinet', 'rug', 'tp', 'window', 'vent', 'zoomies', 'pillow', 'mousepad', 'snackspot', 'drawer1', 'drawer2', 'drawer3', 'drawer4'];
const ROUTES = ['hallway', 'kitchen', 'living', 'bathroom', 'snack'];
const R = 0.28;
let failures = 0;
const fail = (id, msg) => { failures++; console.log(`  FAIL [${id}] ${msg}`); };

for (const id of map.MAP_IDS) {
  const m = map.setMap(id);
  console.log(`\n== ${m.name} (${id}) ${map.mapW()}x${map.mapH()}`);
  // grid shape
  if (!m.rows.every(r => r.length === m.rows[0].length)) fail(id, 'ragged rows');
  if (!m.rows[0].split('').every(c => c === '#') || !m.rows.at(-1).split('').every(c => c === '#')) fail(id, 'top/bottom row not all wall');
  for (const r of m.rows) if (r[0] !== '#' || r.at(-1) !== '#') fail(id, 'left/right edge not wall');
  // free-position test used by the client (4 corners)
  const free = (x, y, climb = false) => !map.isSolid(Math.floor(x - R), Math.floor(y - R), climb) && !map.isSolid(Math.floor(x + R), Math.floor(y - R), climb)
    && !map.isSolid(Math.floor(x - R), Math.floor(y + R), climb) && !map.isSolid(Math.floor(x + R), Math.floor(y + R), climb);
  // flood fill of walkable tile centres from the cat bed
  const W = map.mapW(), H = map.mapH();
  const key = (x, y) => x + ',' + y;
  const reach = new Set();
  const start = [Math.floor(m.catBed.x), Math.floor(m.catBed.y)];
  if (!free(m.catBed.x, m.catBed.y)) fail(id, `cat bed ${m.catBed.x},${m.catBed.y} not free`);
  const q = [start]; reach.add(key(...start));
  while (q.length) { const [x, y] = q.shift(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; if (reach.has(key(nx, ny))) continue; if (!free(nx + 0.5, ny + 0.5)) continue; reach.add(key(nx, ny)); q.push([nx, ny]); } }
  console.log(`  reachable tiles: ${reach.size}`);
  // every floor tile reachable (no sealed pockets)
  let sealed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!map.isWall(x, y) && free(x + 0.5, y + 0.5) && !reach.has(key(x, y))) sealed++;
  if (sealed) fail(id, `${sealed} walkable tiles are sealed off from the cat bed`);
  // every floor tile has a room name (presents are described by room)
  let unnamed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!map.isWall(x, y) && m.rows[y][x] !== '+' && !map.roomAt(x, y)) unnamed++;
  if (unnamed) fail(id, `${unnamed} floor tiles belong to no room`);
  // objects: ids present once, and a reachable stand tile within 1.5 of the centre
  const ids = m.objects.map(o => o.id);
  for (const r of REQUIRED) if (!ids.includes(r)) fail(id, `missing object ${r}`);
  if (new Set(ids).size !== ids.length) fail(id, 'duplicate object ids');
  const nearest = (px, py) => { let best = Infinity; for (const k of reach) { const [x, y] = k.split(',').map(Number); best = Math.min(best, Math.hypot(x + 0.5 - px, y + 0.5 - py)); } return best; };
  for (const o of m.objects) {
    const d = nearest(o.x, o.y);
    if (d > 1.5) fail(id, `${o.id} at ${o.x},${o.y}: nearest reachable tile is ${d.toFixed(2)} away (> 1.5)`);
    if (['knock', 'drawer', 'cabinet'].includes(o.kind) && !map.isSolid(Math.floor(o.x), Math.floor(o.y))) fail(id, `${o.id} should sit on furniture`);
    if (['rug', 'vent', 'zoomies', 'window', 'tp', 'mouse', 'snack'].includes(o.kind) && !free(o.x, o.y)) fail(id, `${o.id} at ${o.x},${o.y} must be on a free tile`);
  }
  // spawns, litter, mouse, snack spots free and reachable
  for (const [n, p] of [['litter', m.litter], ['mouseSpawn', m.mouseSpawn], ...m.spawns.map((p, i) => [`spawn${i}`, p]), ...m.snackSpots.map((p, i) => [`snack${i}`, p])]) {
    if (!free(p.x, p.y)) fail(id, `${n} ${p.x},${p.y} not free`);
    else if (!reach.has(key(Math.floor(p.x), Math.floor(p.y)))) fail(id, `${n} ${p.x},${p.y} unreachable`);
  }
  if (new Set(m.spawns.map(p => key(Math.floor(p.x), Math.floor(p.y)))).size < 2) fail(id, 'spawns too bunched');
  // human bed lies on bed furniture
  const bed = m.furniture.find(f => f.kind === 'bed');
  if (!bed || !(m.humanBed.x >= bed.x && m.humanBed.x < bed.x + bed.w && m.humanBed.y >= bed.y && m.humanBed.y < bed.y + bed.h)) fail(id, 'humanBed is not on the bed');
  const pillow = m.objects.find(o => o.id === 'pillow');
  if (bed && pillow && !(pillow.x >= bed.x && pillow.x < bed.x + bed.w && pillow.y >= bed.y && pillow.y < bed.y + bed.h)) fail(id, 'pillow is not on the bed');
  // routes: axis aligned, through floor/doors only (furniture allowed only for the first/last bed step), 4 waypoints shared head/tail
  for (const name of ROUTES) {
    const r = m.routes[name];
    if (!r || r.length < 4) { fail(id, `route ${name} missing`); continue; }
    let len = 0;
    for (let i = 1; i < r.length; i++) {
      const a = r[i - 1], b = r[i];
      if (a.x !== b.x && a.y !== b.y) fail(id, `route ${name} segment ${i} is diagonal (${a.x},${a.y})->(${b.x},${b.y})`);
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 4));
      for (let s = 0; s <= steps; s++) {
        const x = a.x + (b.x - a.x) * s / steps, y = a.y + (b.y - a.y) * s / steps;
        if (map.isWall(Math.floor(x), Math.floor(y))) { fail(id, `route ${name} crosses a wall at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
        const furn = m.furniture.find(f => f.solid && f.kind !== 'bed' && Math.floor(x) >= f.x && Math.floor(x) < f.x + f.w && Math.floor(y) >= f.y && Math.floor(y) < f.y + f.h);
        if (furn) { fail(id, `route ${name} walks through ${furn.kind} at ${x.toFixed(1)},${y.toFixed(1)}`); break; }
      }
      len += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const secs = len / 2.6 + r.reduce((a, w) => a + (w.wait ?? 0), 0);
    if (secs < 15 || secs > 60) fail(id, `route ${name} takes ${secs.toFixed(0)}s (want 15-60)`);
    if (r[0].x !== r.at(-1).x || r[0].y !== r.at(-1).y) fail(id, `route ${name} does not return to where it started`);
    console.log(`  route ${name.padEnd(8)} ${secs.toFixed(0)}s`);
  }
  // the human must threaten some hotspots: count objects within 3.2 + LOS of any route point
  const threatened = new Set();
  for (const name of ROUTES) for (const w of m.routes[name]) for (const o of m.objects) if (Math.hypot(o.x - w.x, o.y - w.y) <= 3.2 && map.hasLOS(w.x, w.y, o.x, o.y)) threatened.add(o.id);
  console.log(`  hotspots in spray range of some route point: ${threatened.size}/${m.objects.length} (${[...threatened].join(' ')})`);
  if (threatened.size < 6) fail(id, 'the human threatens too few hotspots');
  // cover: tall tiles that have free floor on two opposite sides
  let cover = 0;
  for (const f of m.furniture) if (f.tall) for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) { if ((free(x + 0.5, y - 0.5) && free(x + 0.5, y + 1.5)) || (free(x - 0.5, y + 0.5) && free(x + 1.5, y + 0.5))) cover++; }
  console.log(`  hiding cover tiles: ${cover}`);
  if (cover < 6) fail(id, 'not enough furniture to hide behind');
  // Dorian: at least 6 climbable tiles adjacent to free floor
  let climb = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.isClimbable(x, y) && (free(x + 0.5, y + 1.5) || free(x + 0.5, y - 0.5) || free(x - 0.5, y + 0.5) || free(x + 1.5, y + 0.5))) climb++;
  if (climb < 6) fail(id, `only ${climb} climbable tiles`);
  // vent and cat bed must be out of spray range of every route point (no spray camping after respawn)
  const vent = m.objects.find(o => o.id === 'vent');
  for (const name of ROUTES) for (const w of m.routes[name]) {
    if (Math.hypot(m.catBed.x - w.x, m.catBed.y - w.y) <= 3.2 && map.hasLOS(w.x, w.y, m.catBed.x, m.catBed.y)) { fail(id, `cat bed is sprayable from route ${name} at ${w.x},${w.y}`); break; }
  }
  if (!vent) fail(id, 'no vent');
}
console.log(failures ? `\n${failures} problem(s)` : '\nall maps valid');
process.exit(failures ? 1 : 0);
