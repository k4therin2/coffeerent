// Creates build-tuned/ from build/: same compiled sim, with balance literals routed through T (tuning.js).
// Never touches the game source. Every replacement asserts the original text occurs exactly once.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
const SRC = new URL('./build/', import.meta.url).pathname, DST = new URL('./build-tuned/', import.meta.url).pathname;
mkdirSync(DST, { recursive: true });
for (const f of ['map.js', 'types.js', 'package.json']) copyFileSync(SRC + f, DST + f);
let lines = readFileSync(SRC + 'sim.js', 'utf8').split('\n');
function repLine(ln, oldS, newS) {
  const i = ln - 1;
  if (!lines[i].includes(oldS)) throw new Error(`line ${ln} does not contain ${JSON.stringify(oldS)}: ${lines[i]}`);
  lines[i] = lines[i].replace(oldS, newS);
}
repLine(2, `from './map.js';`, `from './map.js';\nimport { T } from './tuning.js';`);
repLine(14, `ROUND_SECONDS`, `T.roundSeconds`);
repLine(77, `ROUND_SECONDS`, `T.roundSeconds`);
repLine(470, `ROUND_SECONDS`, `T.roundSeconds`);
repLine(471, `1.2 * dt`, `T.decay(this.players.size) * dt`);
repLine(519, `>= 35`, `>= T.stirAt`);
repLine(526, `< 25`, `< T.calmAt`);
repLine(530, `>= 60`, `>= T.patrolAt`);
repLine(548, `< 45`, `< T.bedAt`);
repLine(542, `speed = 2.6`, `speed = T.patrolSpeed`);
repLine(568, `<= 3.2`, `<= T.sprayRange`);
repLine(570, `h.sprayCd = 1.5`, `h.sprayCd = T.sprayCd`);
repLine(579, `this.time + 3`, `this.time + T.sprayStun`);
repLine(581, `this.chaos - 15`, `this.chaos - T.sprayPenalty`);
repLine(597, `* 0.5`, `* T.bustMult`);
repLine(503, `2 * dt`, `T.ventPerSec * dt`);
repLine(504, `2 * dt`, `T.ventPerSec * dt`);
repLine(220, `+= 25`, `+= T.objectiveBonus`);
repLine(223, `+= 50`, `+= T.allDoneBonus`);
repLine(179, `25, 12`, `T.c.groomOk, 12`);
repLine(185, `8, 2`, `T.c.groomSquirm, 2`);
repLine(189, `3, -2`, `T.c.groomBap, -2`);
repLine(190, `noise(3)`, `noise(T.n.bap)`);
repLine(280, `40, 10`, `T.c.pillow, 10`);
repLine(281, `noise(12)`, `noise(T.n.pillow)`);
repLine(363, `noise(2)`, `noise(T.n.swipeTimeout)`);
repLine(367, `this.time + 50`, `this.time + T.cd.knock`);
repLine(370, `15, 4`, `T.c.swipeOk, 4`);
repLine(371, `noise(5)`, `noise(T.n.swipeOk)`);
repLine(375, `6, 1`, `T.c.smash, 1`);
repLine(376, `noise(20)`, `noise(T.n.smash)`);
repLine(385, `this.time + 60`, `this.time + T.cd.cabinet`);
repLine(386, `30, 8`, `T.c.pickOk, 8`);
repLine(387, `noise(8)`, `noise(T.n.pickOk)`);
repLine(392, `noise(5)`, `noise(T.n.pickFail)`);
repLine(400, `this.time + 20`, `this.time + T.cd.rug`);
repLine(401, `5 + 20 * quality`, `T.c.rugBase + T.c.rugQ * quality`);
repLine(403, `noise(3)`, `noise(T.n.rug)`);
repLine(414, `this.time + 60`, `this.time + T.cd.tp`);
repLine(415, `20, 5`, `T.c.tpOk, 5`);
repLine(416, `noise(4)`, `noise(T.n.tpOk)`);
repLine(422, `score(p, 4)`, `score(p, T.c.tpFail)`);
repLine(423, `noise(2)`, `noise(T.n.tpFail)`);
repLine(431, `this.time + 25`, `this.time + T.cd.window`);
repLine(433, `20, 10`, `T.c.stareOk, 10`);
repLine(438, `noise(6)`, `noise(T.n.stareFail)`);
repLine(446, `this.time + 10`, `this.time + T.cd.zoomies`);
repLine(448, `30 * quality`, `T.c.zoom * quality`);
repLine(450, `2 + 10 * quality`, `T.n.zoomBase + T.n.zoomQ * quality`);
repLine(619, `target: 3`, `target: T.knockTarget(playerCount)`);
repLine(625, `target: 2`, `target: T.zoomTarget(playerCount)`);
repLine(626, `target: 20`, `target: T.ventTarget(playerCount)`);
repLine(629, `target: 1`, `target: T.lickTarget(playerCount)`);
repLine(634, `pool.slice(0, 3)`, `pool.slice(0, T.objectiveCount(playerCount))`);
const s = lines.join('\n');
writeFileSync(DST + 'sim.js', s);

writeFileSync(DST + 'tuning.js', `// Balance constants; defaults reproduce the shipped game exactly.
export const DEFAULTS = {
  roundSeconds: 240,
  decayBase: 1.2, decayPerExtra: 0, decayFn: null,
  stirAt: 35, calmAt: 25, patrolAt: 60, bedAt: 45, patrolSpeed: 2.6,
  sprayRange: 3.2, sprayCd: 1.5, sprayStun: 3, sprayPenalty: 15, bustMult: 0.5,
  ventPerSec: 2, objectiveBonus: 25, allDoneBonus: 50,
  n: { swipeTimeout: 2, swipeOk: 5, smash: 20, pickOk: 8, pickFail: 5, rug: 3, tpOk: 4, tpFail: 2, stareFail: 6, zoomBase: 2, zoomQ: 10, pillow: 12, bap: 3 },
  c: { swipeOk: 15, smash: 6, pickOk: 30, rugBase: 5, rugQ: 20, tpOk: 20, tpFail: 4, stareOk: 20, zoom: 30, pillow: 40, groomOk: 25, groomSquirm: 8, groomBap: 3 },
  cd: { knock: 50, cabinet: 60, rug: 20, tp: 60, window: 25, zoomies: 10 },
  knockBase: 3, knockPerExtra: 0, zoomBase: 2, zoomPerExtra: 0, ventBase: 20, ventPerExtra: 0, lickBase: 1, lickPerExtra: 0, objCountBase: 3, objCountPerExtra: 0,
};
export const T = {
  decay(n) { return T.decayFn ? T.decayFn(n) : T.decayBase + T.decayPerExtra * (n - 1); },
  knockTarget(n) { return Math.floor(T.knockBase + T.knockPerExtra * (n - 1)); },
  zoomTarget(n) { return Math.floor(T.zoomBase + T.zoomPerExtra * (n - 1)); },
  ventTarget(n) { return Math.floor(T.ventBase + T.ventPerExtra * (n - 1)); },
  lickTarget(n) { return Math.floor(T.lickBase + T.lickPerExtra * (n - 1)); },
  objectiveCount(n) { return Math.floor(T.objCountBase + T.objCountPerExtra * (n - 1)); },
};
export function applyTuning(over) {
  const d = structuredClone(DEFAULTS);
  for (const [k, v] of Object.entries(over || {})) { if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(d[k], v); else d[k] = v; }
  Object.assign(T, d);
}
applyTuning({});
`);
console.log('ok: build-tuned written');
