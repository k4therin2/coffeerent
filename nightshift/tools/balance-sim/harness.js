// Headless bot harness for Night Shift. Drives a Sim with N statistical bots.
// Usage: import { runRound } from './harness.js'
import { isSolid, MAP_W, MAP_H, CAT_BED } from './build/map.js';

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// ---------- seeded RNG ----------
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- skill profiles ----------
export const PROFILES = {
  casual:  { swipe: 0.60, pick: 0.70, mashQ: [0.40, 1.00], zoomQ: [0.50, 0.95], stare: 0.75, rhythm: 0.65, balance: 0.60, swipeTimeout: 0.03 },
  skilled: { swipe: 0.90, pick: 0.92, mashQ: [0.65, 1.00], zoomQ: [0.80, 1.00], stare: 0.92, rhythm: 0.90, balance: 0.90, swipeTimeout: 0.01 },
  clumsy:  { swipe: 0.35, pick: 0.45, mashQ: [0.20, 0.85], zoomQ: [0.30, 0.75], stare: 0.40, rhythm: 0.35, balance: 0.35, swipeTimeout: 0.06 },
};

// ---------- grid helpers ----------
const WALK = [];
for (let y = 0; y < MAP_H; y++) { WALK[y] = []; for (let x = 0; x < MAP_W; x++) WALK[y][x] = !isSolid(x, y); }
const walkable = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && WALK[ty][tx];

/** BFS distances from a tile. Returns Int16Array dist (-1 unreachable) and parent array. */
function bfs(sx, sy) {
  const N = MAP_W * MAP_H;
  const d = new Int16Array(N).fill(-1), par = new Int16Array(N).fill(-1);
  const q = new Int16Array(N); let qh = 0, qt = 0;
  const s = sy * MAP_W + sx; d[s] = 0; q[qt++] = s;
  while (qh < qt) {
    const c = q[qh++]; const cx = c % MAP_W, cy = (c / MAP_W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (!walkable(nx, ny)) continue;
      const n = ny * MAP_W + nx;
      if (d[n] >= 0) continue;
      d[n] = d[c] + 1; par[n] = c; q[qt++] = n;
    }
  }
  return { d, par };
}
function pathTo(par, tx, ty) {
  const out = []; let c = ty * MAP_W + tx;
  while (c >= 0) { out.push({ x: (c % MAP_W) + 0.5, y: ((c / MAP_W) | 0) + 0.5 }); c = par[c]; }
  out.reverse(); out.shift(); // drop own tile
  return out;
}
/** walkable tiles whose centre is within `reach` of (px,py) */
function standTiles(px, py, reach = 1.4) {
  const out = [];
  for (let ty = Math.floor(py - reach); ty <= Math.floor(py + reach); ty++)
    for (let tx = Math.floor(px - reach); tx <= Math.floor(px + reach); tx++)
      if (walkable(tx, ty) && dist(tx + 0.5, ty + 0.5, px, py) <= reach) out.push({ tx, ty });
  return out;
}

// Safe spots: far from the patrol path, inside rooms the human never enters, or far corners.
const HIDE_SPOTS = [{ x: 1.5, y: 2.5 }, { x: 12.5, y: 7.5 }, { x: 34.5, y: 2.5 }, { x: 8.5, y: 17.5 }, { x: 13.5, y: 17.5 }, { x: 33.5, y: 17.5 }];

const OBJ_FOR_OBJECTIVE = { knock3: 'knock', cabinet: 'cabinet', mouse: 'mouse', tp: 'tp', stare: 'window', hairball: 'rug', zoomies2: 'zoomies', vent: 'vent', lick: 'lick' };
const BASE_VALUE = { knock: 15, cabinet: 25, rug: 15, tp: 20, window: 18, zoomies: 20, vent: 12, mouse: 30, pillow: 100, lick: 14, shove: 2 };

export const WALK_SPEED = 4.6;
export const REACH = 1.45;

// ---------- bot ----------
export class Bot {
  constructor(id, sim, profile, policy, rng, stats, bots, opts = {}) {
    this.id = id; this.sim = sim; this.prof = PROFILES[profile]; this.policy = policy; this.rng = rng; this.stats = stats; this.bots = bots;
    this.opts = opts;
    const p = sim.players.get(id); this.x = p.x; this.y = p.y;
    this.dir = 'down'; this.path = null; this.intent = null; this.mg = null; this.frozenUntil = 0; this.thinkUntil = 0;
    this.hiding = false; this.failPenalty = new Map(); this.lickCd = new Map(); this.ventUntil = 0; this.gotMgStart = false;
    this.lastPosSend = -1; this.lastLickCheck = 0;
  }
  U(a, b) { return a + this.rng() * (b - a); }
  onMsg(m) {
    const t = this.sim.time;
    if (m.t === 'mgstart') { this.gotMgStart = true; this.mg = this.plan(m.spec); this.path = null; }
    else if (m.t === 'mgcancel') { if (this.mg && this.mg.spec.token === m.token) this.mg = null; }
    else if (m.t === 'warp') { this.x = m.x; this.y = m.y; this.path = null; this.frozenUntil = t + 0.75; if (!(this.intent && this.intent.kind === 'vent')) this.intent = null; }
  }
  /** decide the statistical outcome + duration of a minigame */
  plan(spec) {
    const P = this.prof; const k = spec.kind; let success = false, quality = 0, timedOut = false, dur = spec.time;
    switch (k) {
      case 'swipe':
        if (this.rng() < P.swipeTimeout) { timedOut = true; dur = spec.time; }
        else { success = this.rng() < P.swipe; quality = success ? this.U(0.3, 1) : 0; dur = this.U(0.8, 2.6); }
        break;
      case 'pick': {
        const total = Number(spec.params.pins); let pin = 0, el = 0;
        while (el < spec.time && pin < total) { el += this.U(0.5, 1.1); if (this.rng() < P.pick) pin++; else pin = Math.max(0, pin - 1); }
        if (pin >= total && el <= spec.time) { success = true; quality = 1; dur = el; } else { success = false; timedOut = true; dur = spec.time; }
        break;
      }
      case 'mash': quality = this.U(P.mashQ[0], P.mashQ[1]); success = quality >= 0.5; dur = this.U(3, 6); break;
      case 'zoomies': quality = this.U(P.zoomQ[0], P.zoomQ[1]); success = quality >= 0.5; dur = this.U(2.5, 6); break;
      case 'stare': success = this.rng() < P.stare; quality = success ? 1 : 0; dur = success ? Number(spec.params.hold) : this.U(0.5, 5.5); break;
      case 'rhythm': success = this.rng() < P.rhythm; quality = success ? this.U(0.7, 1) : this.U(0, 0.69); dur = 1 + 7 * 0.6 + 0.3; break;
      case 'balance': success = this.rng() < P.balance; quality = success ? this.U(0.6, 1) : this.U(0, 0.59); dur = spec.time - 0.05; break;
    }
    return { spec, success, quality, timedOut, finishAt: this.sim.time + Math.min(dur, spec.time) + 0.3 };
  }
  sendPos(moving) {
    this.sim.handle(this.id, { t: 'pos', x: this.x, y: this.y, dir: this.dir, moving });
  }
  tile() { return { tx: Math.floor(this.x), ty: Math.floor(this.y) }; }

  // ---- choosing ----
  objectiveActive(kind) { return this.sim.objectives.some(o => !o.done && OBJ_FOR_OBJECTIVE[o.id] === kind); }
  choose() {
    const sim = this.sim, me = sim.players.get(this.id), t = sim.time;
    const { tx, ty } = this.tile();
    const { d, par } = bfs(tx, ty);
    const cands = [];
    const claimed = new Set(); for (const b of this.bots) if (b !== this && b.intent && b.intent.key) claimed.add(b.intent.key);
    const addCand = (key, kind, px, py, value, extra = {}) => {
      let best = null;
      for (const s of standTiles(px, py)) { const dd = d[s.ty * MAP_W + s.tx]; if (dd >= 0 && (!best || dd < best.dd)) best = { ...s, dd }; }
      if (!best) return;
      let score = value + (this.objectiveActive(kind) ? 20 : 0) - 1.2 * best.dd;
      if (claimed.has(key)) score -= 15;
      const fp = this.failPenalty.get(key); if (fp && fp > t) score -= 40;
      score += this.U(-2, 2);
      cands.push({ key, kind, px, py, stand: best, score, ...extra });
    };
    for (const o of sim.objects) {
      if (o.busyBy || t < o.cooldownUntil) continue;
      switch (o.kind) {
        case 'knock': case 'cabinet': case 'tp': if (o.done) continue; addCand(o.id, o.kind, o.x, o.y, BASE_VALUE[o.kind]); break;
        case 'rug': case 'window': case 'zoomies': addCand(o.id, o.kind, o.x, o.y, BASE_VALUE[o.kind]); break;
        case 'vent':
          if (sim.ventOccupant === this.id) continue;
          if (sim.ventOccupant) addCand('shove', 'shove', o.x, o.y, BASE_VALUE.shove, { target: o.id });
          else addCand(o.id, 'vent', o.x, o.y, BASE_VALUE.vent);
          break;
        case 'mouse':
          if (me.carryingMouse || sim.mouse.carrier || !sim.mouse.visible) continue;
          addCand(o.id, 'mouse', sim.mouse.x, sim.mouse.y, BASE_VALUE.mouse); break;
        case 'pillow':
          if (!me.carryingMouse) continue;
          addCand(o.id, 'pillow', o.x, o.y, BASE_VALUE.pillow); break;
      }
    }
    for (const q of sim.players.values()) {
      if (q.id === this.id || q.busy || t < q.stunnedUntil) continue;
      const key = [this.id, q.id].sort().join('|');
      if ((this.lickCd.get(key) ?? 0) > t) continue;
      const dd = d[Math.floor(q.y) * MAP_W + Math.floor(q.x)];
      if (dd < 0 || dd > (this.objectiveActive('lick') ? 14 : 6)) continue;
      addCand('lick:' + q.id, 'lick', q.x, q.y, BASE_VALUE.lick, { target: 'player:' + q.id, player: q.id });
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score);
    const c = cands[0];
    c.path = pathTo(par, c.stand.tx, c.stand.ty);
    return c;
  }
  intentValid() {
    const it = this.intent, sim = this.sim, t = sim.time, me = sim.players.get(this.id);
    if (!it) return false;
    if (it.kind === 'hide') return true;
    if (it.kind === 'lick') { const q = sim.players.get(it.player); if (!q || q.busy || t < q.stunnedUntil) return false; if (dist(q.x, q.y, it.px, it.py) > 1.0) { it.px = q.x; it.py = q.y; it.path = null; } return true; }
    if (it.kind === 'pillow') return me.carryingMouse;
    if (it.kind === 'mouse') return !me.carryingMouse && sim.mouse.visible && !sim.mouse.carrier;
    const o = sim.objects.find(o => o.id === it.key || (it.kind === 'shove' && o.id === 'vent'));
    if (!o) return false;
    if (it.kind === 'vent') { if (me.onVent) return true; return !sim.ventOccupant; }
    if (it.kind === 'shove') return !!sim.ventOccupant && sim.ventOccupant !== this.id;
    if (o.busyBy && o.busyBy !== this.id) return false;
    if (t < o.cooldownUntil) return false;
    if ((o.kind === 'knock' || o.kind === 'cabinet' || o.kind === 'tp') && o.done) return false;
    return true;
  }
  hideIntent() {
    const { tx, ty } = this.tile(); const { d, par } = bfs(tx, ty);
    let best = null;
    for (const h of HIDE_SPOTS) { const dd = d[Math.floor(h.y) * MAP_W + Math.floor(h.x)]; if (dd >= 0 && (!best || dd < best.dd)) best = { ...h, dd }; }
    if (!best) return null;
    return { kind: 'hide', key: null, px: best.x, py: best.y, stand: { tx: Math.floor(best.x), ty: Math.floor(best.y) }, path: pathTo(par, Math.floor(best.x), Math.floor(best.y)) };
  }
  act() {
    const it = this.intent, sim = this.sim, me = sim.players.get(this.id), t = sim.time;
    const S = this.stats;
    const c0 = sim.chaos, s0 = sim.suspicion, d0 = sim.objectives.filter(o => o.done).length, all0 = sim.objectives.every(o => o.done);
    this.gotMgStart = false;
    const target = it.target ?? it.key;
    const wasCarrying = me.carryingMouse, wasOnVent = me.onVent, occBefore = sim.ventOccupant;
    sim.handle(this.id, { t: 'use', target });
    if (it.kind === 'lick') {
      this.lickCd.set([this.id, it.player].sort().join('|'), t + 15.5);
      if (this.gotMgStart) S.counts.groomAttempt++; else this.failPenalty.set(it.key, t + 5);
      this.intent = null; return;
    }
    if (it.kind === 'mouse') { if (me.carryingMouse !== wasCarrying) S.counts.mousePick++; else this.failPenalty.set(it.key, t + 4); this.intent = null; return; }
    if (it.kind === 'pillow') {
      if (me.carryingMouse !== wasCarrying) {
        const d1 = sim.objectives.filter(o => o.done).length, all1 = sim.objectives.every(o => o.done);
        const bonus = (d1 - d0) * 25 + (all1 && !all0 ? 50 : 0);
        S.counts.pillow++; S.chaosBy.pillow += sim.chaos - c0 - bonus; S.chaosBy.objective += bonus; S.noiseBy.pillow += sim.suspicion - s0;
      }
      else this.failPenalty.set(it.key, t + 4);
      this.intent = null; return;
    }
    if (it.kind === 'vent') {
      if (me.onVent && !wasOnVent) { S.counts.vent++; this.ventUntil = t + (this.objectiveActive('vent') ? 25 : this.U(5, 10)); }
      else { this.failPenalty.set(it.key, t + 4); this.intent = null; }
      return;
    }
    if (it.kind === 'shove') {
      if (me.onVent && sim.ventOccupant === this.id && occBefore !== this.id) { S.counts.shove++; this.intent = { ...it, kind: 'vent', key: 'vent' }; this.ventUntil = t + this.U(5, 10); }
      else { this.failPenalty.set('shove', t + 4); this.intent = null; }
      return;
    }
    // object minigame
    if (!this.gotMgStart) { this.failPenalty.set(it.key, t + 4); this.intent = null; }
    else if (it.kind === 'cabinet') { S.counts.pickAttempt++; S.counts.pickHelped += Number(this.mg.spec.params.pins) === 2 ? 1 : 0; }
  }
  finishMg() {
    const sim = this.sim, S = this.stats, m = this.mg; this.mg = null;
    const c0 = sim.chaos, s0 = sim.suspicion, d0 = sim.objectives.filter(o => o.done).length, all0 = sim.objectives.every(o => o.done);
    sim.handle(this.id, { t: 'mgdone', token: m.spec.token, success: m.success, quality: m.quality, timedOut: m.timedOut });
    const d1 = sim.objectives.filter(o => o.done).length, all1 = sim.objectives.every(o => o.done);
    const bonus = (d1 - d0) * 25 + (all1 && !all0 ? 50 : 0);
    const dc = sim.chaos - c0 - bonus, dn = sim.suspicion - s0;
    S.chaosBy.objective += bonus;
    let label;
    const k = m.spec.kind;
    if (k === 'swipe') label = m.timedOut ? 'swipe_timeout' : m.success ? 'swipe_ok' : 'swipe_smash';
    else if (k === 'pick') label = m.success ? 'pick_ok' : 'pick_fail';
    else if (k === 'mash') label = m.spec.objectId === 'rug' ? (m.success ? 'rug_ok' : 'rug_meh') : (m.success ? 'tp_ok' : 'tp_fail');
    else if (k === 'stare') label = m.success ? 'stare_ok' : 'stare_fail';
    else if (k === 'zoomies') label = 'zoomies';
    else { // paired: delta appears on whichever side finishes second
      if (dc === 0 && dn === 0) label = 'groom_pending';
      else if (dc >= 25) label = 'groom_ok';
      else if (dc >= 8) label = 'groom_squirm';
      else label = 'groom_bap';
    }
    S.counts[label] = (S.counts[label] || 0) + 1;
    S.chaosBy[label] = (S.chaosBy[label] || 0) + dc;
    S.noiseBy[label] = (S.noiseBy[label] || 0) + dn;
    this.thinkUntil = sim.time + this.U(0.3, 1.0);
    this.path = null;
  }

  update(dt) {
    const sim = this.sim, me = sim.players.get(this.id), t = sim.time, S = this.stats, T = S.time;
    if (this.mg) { T.mg += dt; if (t >= this.mg.finishAt) this.finishMg(); return; }
    if (t < me.stunnedUntil) { T.stunned += dt; return; }
    if (t < this.frozenUntil) { T.idle += dt; return; }
    // caution policy
    if (this.policy === 'caution') {
      if (!this.hiding && sim.suspicion > 60) { this.hiding = true; this.intent = this.hideIntent(); this.path = null; }
      else if (this.hiding && sim.suspicion < 35) { this.hiding = false; this.intent = null; }
    }
    if (me.onVent && this.intent && this.intent.kind === 'vent') {
      if (t < this.ventUntil && !(this.hiding)) { T.vent += dt; if (t - this.lastPosSend > 0.5) { this.sendPos(false); this.lastPosSend = t; } return; }
      this.intent = null;
    }
    if (this.hiding) {
      if (!this.intent) this.intent = this.hideIntent();
      if (this.intent && dist(this.x, this.y, this.intent.px, this.intent.py) > 0.3) { this.walk(dt); T.walk += dt; }
      else { T.hide += dt; if (t - this.lastPosSend > 0.5) { this.sendPos(false); this.lastPosSend = t; } }
      return;
    }
    if (t < this.thinkUntil) { T.idle += dt; return; }
    if (!this.intentValid()) { this.intent = this.choose(); if (!this.intent) { this.thinkUntil = t + 1; T.idle += dt; return; } }
    const it = this.intent;
    if (dist(this.x, this.y, it.px, it.py) <= REACH) { this.sendPos(false); this.act(); return; }
    this.walk(dt); T.walk += dt;
  }
  walk(dt) {
    const it = this.intent; if (!it) return;
    if (!it.path) {
      const { tx, ty } = this.tile(); const { d, par } = bfs(tx, ty);
      let best = null;
      for (const s of standTiles(it.px, it.py, it.kind === 'hide' ? 0.1 : 1.4)) { const dd = d[s.ty * MAP_W + s.tx]; if (dd >= 0 && (!best || dd < best.dd)) best = { ...s, dd }; }
      if (!best) { this.failPenalty.set(it.key, this.sim.time + 10); this.intent = null; return; }
      it.path = pathTo(par, best.tx, best.ty);
    }
    let budget = WALK_SPEED * dt;
    while (budget > 0 && it.path.length) {
      const w = it.path[0]; const dd = dist(this.x, this.y, w.x, w.y);
      if (dd <= budget) { this.x = w.x; this.y = w.y; budget -= dd; it.path.shift(); }
      else { this.x += (w.x - this.x) / dd * budget; this.y += (w.y - this.y) / dd * budget; budget = 0; }
      const ddx = w.x - this.x, ddy = w.y - this.y;
      if (Math.abs(ddx) + Math.abs(ddy) > 1e-6) this.dir = Math.abs(ddx) > Math.abs(ddy) ? (ddx > 0 ? 'right' : 'left') : (ddy > 0 ? 'down' : 'up');
    }
    this.sendPos(true); this.lastPosSend = this.sim.time;
  }
}

// ---------- round runner ----------
export function newStats() {
  return {
    time: { walk: 0, mg: 0, hide: 0, vent: 0, idle: 0, stunned: 0 },
    counts: { vent: 0, shove: 0, groomAttempt: 0, mousePick: 0, pillow: 0, pickAttempt: 0, pickHelped: 0 },
    chaosBy: { objective: 0, pillow: 0, vent: 0, spray: 0, bust: 0 },
    noiseBy: { pillow: 0 },
  };
}

export function runRound(SimClass, { n, profile, policy, seed, dt = 1 / 30, bucket = 30, botOpts = {} }) {
  const rng = mulberry32(seed);
  const origRandom = Math.random; Math.random = mulberry32(seed ^ 0x9e3779b9);
  try {
    const bots = []; const byId = new Map();
    const sim = new SimClass((pid, m) => { const b = byId.get(pid); if (b) b.onMsg(m); }, () => {});
    const cats = ['dorian', 'bean', 'melon', 'ginny'];
    for (let i = 0; i < n; i++) sim.addPlayer('p' + i, 'Bot' + i, cats[i]);
    sim.start();
    const stats = newStats();
    for (let i = 0; i < n; i++) { const b = new Bot('p' + i, sim, profile, policy, rng, stats, bots, botOpts); bots.push(b); byId.set(b.id, b); }
    const R = { n, profile, policy, seed, firstStir: null, firstPatrol: null, tFirstObj: null, tAll3: null, patrolSeconds: 0, stirSeconds: 0, suspSum: [], suspCnt: [], peakSusp: 0, objectives: sim.objectives.map(o => o.id) };
    let lastPhase = 'asleep';
    let sprays = 0;
    while (sim.phase === 'playing') {
      for (const b of bots) b.update(dt);
      if (sim.phase !== 'playing') break;
      const c0 = sim.chaos, occ = sim.ventOccupant, d0 = sim.objectives.filter(o => o.done).length, all0 = sim.objectives.every(o => o.done);
      const sp0 = [...sim.players.values()].reduce((a, p) => a + p.sprays, 0);
      sim.tick(dt);
      const busted = sim.phase === 'results' && /AWAKE/.test(sim.endReason || '');
      const d1 = sim.objectives.filter(o => o.done).length, all1 = sim.objectives.every(o => o.done);
      const bonus = (d1 - d0) * 25 + (all1 && !all0 ? 50 : 0);
      const ventAdd = (occ && sim.players.get(occ)?.onVent && !busted) ? 2 * dt : 0;
      stats.chaosBy.objective += bonus; stats.chaosBy.vent += ventAdd;
      const resid = sim.chaos - c0 - bonus - ventAdd;
      if (busted) stats.chaosBy.bust += resid; else stats.chaosBy.spray += resid;
      sprays = [...sim.players.values()].reduce((a, p) => a + p.sprays, 0);
      // human phases
      const hp = sim.human.phase;
      if (hp === 'stirring' && R.firstStir === null) R.firstStir = sim.time;
      if (hp === 'patrol' && R.firstPatrol === null) R.firstPatrol = sim.time;
      if (hp === 'patrol' || hp === 'returning') R.patrolSeconds += dt; else if (hp === 'stirring') R.stirSeconds += dt;
      lastPhase = hp;
      { const dn = sim.objectives.filter(o => o.done).length; if (dn >= 1 && R.tFirstObj === null) R.tFirstObj = sim.time; if (dn >= sim.objectives.length && R.tAll3 === null) R.tAll3 = sim.time; }
      const bi = Math.min(Math.floor(sim.time / bucket), 1000);
      R.suspSum[bi] = (R.suspSum[bi] || 0) + sim.suspicion; R.suspCnt[bi] = (R.suspCnt[bi] || 0) + 1;
      if (sim.suspicion > R.peakSusp) R.peakSusp = sim.suspicion;
    }
    R.endTime = sim.time; R.busted = /AWAKE/.test(sim.endReason || ''); R.chaos = sim.chaos; R.sprays = sprays;
    R.objDone = sim.objectives.filter(o => o.done).map(o => o.id);
    R.objProgress = sim.objectives.map(o => ({ id: o.id, progress: o.progress, target: o.target, done: o.done }));
    R.stats = stats;
    R.playerChaos = [...sim.players.values()].map(p => p.chaos);
    return R;
  } finally { Math.random = origRandom; }
}
