import {
  type CatId, type ClientMsg, type HostMsg, type LogEvent, type MinigameSpec, type Objective,
  type ObjectState, type Phase, type PlayerState, type Snapshot, type HumanState, CAT_IDS, CAT_NAMES, ROUND_SECONDS,
} from './types';
import { CAT_BED, HUMAN_BED, HUMAN_PATROL, MOUSE_SPAWN, hasLOS, makeObjects } from './map';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Pending {
  token: number;
  pid: string;
  spec: MinigameSpec;
  deadline: number;
  pairId?: number;
}
interface Pair {
  id: number;
  licker: string;
  lickee: string;
  results: Record<string, boolean | undefined>;
}

export class Sim {
  phase: Phase = 'lobby';
  players = new Map<string, PlayerState>();
  objects: ObjectState[] = makeObjects();
  objectives: Objective[] = [];
  time = 0;
  timeLeft = ROUND_SECONDS;
  suspicion = 0;
  chaos = 0;
  human: HumanState & { idx: number; sprayCd: number } = { phase: 'asleep', x: HUMAN_BED.x, y: HUMAN_BED.y, dir: 'down', idx: 0, sprayCd: 0 };
  mouse = { x: MOUSE_SPAWN.x, y: MOUSE_SPAWN.y, carrier: null as string | null, visible: true, respawnAt: 0 };
  ventOccupant: string | null = null;
  log: LogEvent[] = [];
  endReason?: string;
  private pending = new Map<number, Pending>();
  private pairs = new Map<number, Pair>();
  private tokenSeq = 1;
  private shoveCd = new Map<string, number>();
  private lickCd = new Map<string, number>();
  private allDoneBonus = false;

  constructor(private send: (pid: string, m: HostMsg) => void, private broadcast: (m: HostMsg) => void) {}

  // ---------- lobby ----------
  addPlayer(id: string, name: string, wantCat: CatId): PlayerState | null {
    if (this.players.size >= 4) return null;
    const taken = new Set([...this.players.values()].map(p => p.cat));
    const cat = taken.has(wantCat) ? CAT_IDS.find(c => !taken.has(c))! : wantCat;
    const p: PlayerState = {
      id, name: name.slice(0, 14) || CAT_NAMES[cat], cat, x: CAT_BED.x + 1 + this.players.size * 0.8, y: CAT_BED.y - 1,
      dir: 'down', moving: false, stunnedUntil: 0, onVent: false, carryingMouse: false, busy: false, ignorePosUntil: 0,
      dominance: 0, chaos: 0, sprays: 0, connected: true,
    };
    this.players.set(id, p);
    this.sendLobby();
    return p;
  }
  removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby') this.players.delete(id);
    else {
      p.connected = false;
      if (this.ventOccupant === id) this.ventOccupant = null;
      if (this.mouse.carrier === id) { this.mouse.carrier = null; this.mouse.visible = true; this.mouse.x = p.x; this.mouse.y = p.y; }
      this.players.delete(id);
      this.logEv(`${p.name} wandered off (disconnected).`, 'info');
    }
    this.sendLobby();
  }
  setCat(id: string, cat: CatId) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'lobby') return;
    if ([...this.players.values()].some(o => o.id !== id && o.cat === cat)) return;
    p.cat = cat;
    this.sendLobby();
  }
  private sendLobby() {
    this.broadcast({ t: 'lobby', players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, cat: p.cat, host: p.id === 'host' })) });
  }

  // ---------- round ----------
  start() {
    this.phase = 'playing';
    this.time = 0; this.timeLeft = ROUND_SECONDS; this.suspicion = 0; this.chaos = 0;
    this.objects = makeObjects();
    this.human = { phase: 'asleep', x: HUMAN_BED.x, y: HUMAN_BED.y, dir: 'down', idx: 0, sprayCd: 0 };
    this.mouse = { x: MOUSE_SPAWN.x, y: MOUSE_SPAWN.y, carrier: null, visible: true, respawnAt: 0 };
    this.ventOccupant = null; this.log = []; this.endReason = undefined; this.allDoneBonus = false;
    this.pending.clear(); this.pairs.clear(); this.shoveCd.clear(); this.lickCd.clear();
    let i = 0;
    for (const p of this.players.values()) {
      Object.assign(p, { stunnedUntil: 0, onVent: false, carryingMouse: false, busy: false, dominance: 0, chaos: 0, sprays: 0 });
      this.warp(p, CAT_BED.x + 1 + i * 0.9, CAT_BED.y - 1.5 + (i % 2));
      i++;
    }
    this.objectives = pickObjectives(this.players.size);
    this.logEv('The humans are asleep. Night shift begins.', 'info');
  }
  backToLobby() {
    this.phase = 'lobby';
    this.sendLobby();
  }

  // ---------- messages ----------
  handle(pid: string, m: ClientMsg) {
    const p = this.players.get(pid);
    if (!p) return;
    switch (m.t) {
      case 'pos':
        if (this.phase !== 'playing') return;
        if (p.busy || this.time < p.stunnedUntil || this.time < p.ignorePosUntil) return;
        p.x = m.x; p.y = m.y; p.dir = m.dir; p.moving = m.moving;
        if (p.onVent) {
          const v = this.obj('vent');
          if (dist(p.x, p.y, v.x, v.y) > 0.7) { p.onVent = false; if (this.ventOccupant === pid) this.ventOccupant = null; }
        }
        return;
      case 'use':
        if (this.phase === 'playing') this.use(p, m.target);
        return;
      case 'mgdone':
        this.finishMinigame(p, m.token, m.success, clamp(m.quality, 0, 1));
        return;
      case 'pickcat':
        this.setCat(pid, m.cat);
        return;
    }
  }

  private obj(id: string): ObjectState { return this.objects.find(o => o.id === id)!; }
  private warp(p: PlayerState, x: number, y: number) {
    p.x = x; p.y = y; p.moving = false; p.ignorePosUntil = this.time + 0.7;
    this.send(p.id, { t: 'warp', x, y });
  }
  private logEv(text: string, kind: LogEvent['kind']) {
    this.log.push({ t: this.time, text, kind });
    if (this.log.length > 8) this.log.shift();
  }
  private noise(n: number) { this.suspicion = clamp(this.suspicion + n, 0, 100); }
  private score(p: PlayerState, chaos: number, dom = 0) {
    this.chaos = Math.max(0, this.chaos + chaos);
    p.chaos += chaos; p.dominance += dom;
  }
  private progress(id: string, n = 1) {
    const o = this.objectives.find(o => o.id === id);
    if (!o || o.done) return;
    o.progress = Math.min(o.target, o.progress + n);
    if (o.progress >= o.target) {
      o.done = true;
      this.logEv(`Objective complete: ${o.text}`, 'good');
      this.chaos += 25;
      if (!this.allDoneBonus && this.objectives.every(x => x.done)) {
        this.allDoneBonus = true; this.chaos += 50;
        this.logEv('ALL OBJECTIVES DONE. +50 bonus. Keep causing problems.', 'good');
      }
    }
  }

  private use(p: PlayerState, target: string) {
    if (p.busy || this.time < p.stunnedUntil) return;
    if (target.startsWith('player:')) return this.tryLick(p, target.slice(7));
    const o = this.objects.find(o => o.id === target);
    if (!o) return;
    if (dist(p.x, p.y, o.x, o.y) > 1.6) return;
    if (o.busyBy || this.time < o.cooldownUntil) return;
    switch (o.kind) {
      case 'knock':
        if (o.done) return;
        return this.startMinigame(p, { kind: 'swipe', title: `Knock the ${o.label} off`, time: 6, params: { speed: 1.0 + Math.random() * 0.6, zone: 0.22 }, objectId: o.id });
      case 'cabinet': {
        if (o.done) return;
        const helpers = [...this.players.values()].filter(q => q.id !== p.id && dist(q.x, q.y, o.x, o.y) < 2.5).length;
        return this.startMinigame(p, { kind: 'pick', title: 'Pick the treat cabinet', time: 14, params: { pins: helpers > 0 ? 2 : 4, speed: 1.6 }, objectId: o.id });
      }
      case 'rug':
        return this.startMinigame(p, { kind: 'mash', title: 'Hairball on the good rug', time: 7, params: { label: 'HACK', target: 0.75, width: 0.15 }, objectId: o.id });
      case 'tp':
        if (o.done) return;
        return this.startMinigame(p, { kind: 'mash', title: 'Unroll the toilet paper', time: 7, params: { label: 'PAW', target: 0.9, width: 0.3 }, objectId: o.id });
      case 'window':
        return this.startMinigame(p, { kind: 'stare', title: 'Staring contest: the neighbor cat', time: 7, params: { hold: 6 }, objectId: o.id });
      case 'zoomies':
        return this.startMinigame(p, { kind: 'zoomies', title: 'ZOOMIES', time: 8, params: { count: 9 }, objectId: o.id });
      case 'vent':
        return this.useVent(p, o);
      case 'mouse':
        if (this.mouse.carrier || !this.mouse.visible) return;
        if (dist(p.x, p.y, this.mouse.x, this.mouse.y) > 1.6) return;
        this.mouse.carrier = p.id; this.mouse.visible = false; p.carryingMouse = true;
        this.logEv(`${p.name} picked up the toy mouse.`, 'info');
        return;
      case 'pillow':
        if (!p.carryingMouse) return;
        p.carryingMouse = false; this.mouse.carrier = null; this.mouse.visible = false; this.mouse.respawnAt = this.time + 30;
        this.score(p, 40, 10); this.noise(12); this.progress('mouse');
        this.logEv(`${p.name} left a gift on the pillow. The human murmurs.`, 'good');
        return;
    }
  }

  private useVent(p: PlayerState, v: ObjectState) {
    if (this.ventOccupant === p.id) return;
    if (this.ventOccupant) {
      const victim = this.players.get(this.ventOccupant);
      if ((this.shoveCd.get(p.id) ?? 0) > this.time) return;
      this.shoveCd.set(p.id, this.time + 3);
      if (victim) {
        victim.onVent = false; victim.stunnedUntil = this.time + 1.2;
        const ox = victim.x < v.x ? -1 : 1;
        this.warp(victim, v.x + ox, v.y);
        this.send(victim.id, { t: 'toast', text: `${p.name} shoved you off the vent.`, kind: 'dom' });
        this.score(p, 0, 6); victim.dominance -= 2;
        this.logEv(`${p.name} shoved ${victim.name} off the vent.`, 'dom');
      }
    }
    this.ventOccupant = p.id; p.onVent = true;
    this.warp(p, v.x, v.y);
  }

  private tryLick(p: PlayerState, otherId: string) {
    const q = this.players.get(otherId);
    if (!q || q.busy || this.time < q.stunnedUntil) return;
    if (dist(p.x, p.y, q.x, q.y) > 1.6) return;
    const key = [p.id, q.id].sort().join('|');
    if ((this.lickCd.get(key) ?? 0) > this.time) return;
    this.lickCd.set(key, this.time + 15);
    const pairId = this.tokenSeq++;
    this.pairs.set(pairId, { id: pairId, licker: p.id, lickee: q.id, results: {} });
    if (q.onVent) { q.onVent = false; if (this.ventOccupant === q.id) this.ventOccupant = null; }
    if (p.onVent) { p.onVent = false; if (this.ventOccupant === p.id) this.ventOccupant = null; }
    this.startMinigame(p, { kind: 'rhythm', title: `Groom ${q.name}'s head`, time: 6, params: { beats: 8, bpm: 100 }, partner: q.id }, pairId);
    this.startMinigame(q, { kind: 'balance', title: `${p.name} is grooming you. Hold still.`, time: 6, params: { drift: 0.9 }, partner: p.id }, pairId);
  }

  private startMinigame(p: PlayerState, spec: Omit<MinigameSpec, 'token'>, pairId?: number) {
    const token = this.tokenSeq++;
    const full: MinigameSpec = { token, ...spec };
    p.busy = true; p.moving = false;
    if (spec.objectId) this.obj(spec.objectId).busyBy = p.id;
    this.pending.set(token, { token, pid: p.id, spec: full, deadline: this.time + spec.time + 4, pairId });
    this.send(p.id, { t: 'mgstart', spec: full });
  }

  private finishMinigame(p: PlayerState, token: number, success: boolean, quality: number) {
    const pend = this.pending.get(token);
    if (!pend || pend.pid !== p.id) return;
    this.pending.delete(token);
    p.busy = false;
    const spec = pend.spec;
    const o = spec.objectId ? this.obj(spec.objectId) : undefined;
    if (o) o.busyBy = undefined;
    if (this.phase !== 'playing') return;
    switch (spec.kind) {
      case 'swipe':
        if (!o) break;
        o.done = true; o.cooldownUntil = this.time + 50;
        this.progress('knock3');
        if (success) { this.score(p, 15, 4); this.noise(5); this.logEv(`${p.name} nudged the ${o.label} off. Thunk.`, 'good'); }
        else { this.score(p, 6, 1); this.noise(20); this.logEv(`${p.name} SMASHED the ${o.label}.`, 'bad'); }
        break;
      case 'pick':
        if (!o) break;
        if (success) { o.done = true; o.cooldownUntil = this.time + 60; this.score(p, 30, 8); this.noise(8); this.progress('cabinet'); this.logEv(`${p.name} opened the treat cabinet. Treats for everyone.`, 'good'); }
        else { this.noise(5); this.logEv(`${p.name} rattled the cabinet and gave up.`, 'info'); }
        break;
      case 'mash':
        if (!o) break;
        if (o.kind === 'rug') {
          o.cooldownUntil = this.time + 20;
          const pts = Math.round(5 + 20 * quality);
          this.score(p, pts, success ? 4 : 0); this.noise(3);
          if (success) { this.progress('hairball'); this.logEv(`${p.name} produced a perfect hairball on the good rug.`, 'good'); }
          else this.logEv(`${p.name} coughed up something near the rug. Close enough.`, 'info');
        } else {
          if (success) { o.done = true; o.cooldownUntil = this.time + 60; this.score(p, 20, 5); this.noise(4); this.progress('tp'); this.logEv(`${p.name} unrolled the entire toilet paper.`, 'good'); }
          else { o.cooldownUntil = this.time + 8; this.score(p, 4); this.noise(2); this.logEv(`${p.name} shredded a bit of toilet paper.`, 'info'); }
        }
        break;
      case 'stare':
        if (!o) break;
        o.cooldownUntil = this.time + 25;
        if (success) { this.score(p, 20, 10); this.progress('stare'); this.logEv(`${p.name} out-stared the neighbor cat. Dominance asserted.`, 'dom'); }
        else { this.noise(6); p.dominance -= 3; this.logEv(`${p.name} blinked first and hissed at the window.`, 'bad'); }
        break;
      case 'zoomies':
        if (!o) break;
        o.cooldownUntil = this.time + 10;
        { const pts = Math.round(30 * quality); this.score(p, pts, Math.round(6 * quality)); this.noise(2 + 10 * quality);
          if (quality >= 0.5) this.progress('zoomies2');
          this.logEv(quality >= 0.9 ? `${p.name} did PERFECT zoomies. The floor shook.` : `${p.name} did zoomies (${Math.round(quality * 100)}%).`, quality >= 0.9 ? 'good' : 'info'); }
        break;
      case 'rhythm':
      case 'balance': {
        const pair = pend.pairId !== undefined ? this.pairs.get(pend.pairId) : undefined;
        if (!pair) break;
        pair.results[p.id] = success;
        const a = pair.results[pair.licker], b = pair.results[pair.lickee];
        if (a === undefined || b === undefined) break;
        this.pairs.delete(pair.id);
        const licker = this.players.get(pair.licker), lickee = this.players.get(pair.lickee);
        if (!licker || !lickee) break;
        if (a && b) { this.score(licker, 25, 12); lickee.chaos += 0; lickee.dominance -= 3; this.progress('lick'); this.logEv(`${licker.name} groomed ${lickee.name}. ${lickee.name} allowed it.`, 'dom'); }
        else if (a && !b) { this.score(licker, 8, 2); this.logEv(`${lickee.name} squirmed away from ${licker.name}.`, 'info'); }
        else { this.score(licker, 3, -2); this.noise(3); this.logEv(`${licker.name} tried to groom ${lickee.name} and got bapped.`, 'bad'); }
        break;
      }
    }
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (this.phase !== 'playing') return;
    this.time += dt;
    this.timeLeft = Math.max(0, ROUND_SECONDS - this.time);
    this.suspicion = clamp(this.suspicion - 1.2 * dt, 0, 100);

    // minigame timeouts
    for (const pend of [...this.pending.values()]) {
      if (this.time > pend.deadline) {
        this.pending.delete(pend.token);
        const p = this.players.get(pend.pid);
        if (p) p.busy = false;
        if (pend.spec.objectId) this.obj(pend.spec.objectId).busyBy = undefined;
        this.send(pend.pid, { t: 'mgcancel', token: pend.token });
      }
    }
    // object respawns
    for (const o of this.objects) if (o.done && o.cooldownUntil && this.time > o.cooldownUntil) { o.done = false; o.cooldownUntil = 0; }
    // mouse respawn
    if (!this.mouse.visible && !this.mouse.carrier && this.mouse.respawnAt && this.time > this.mouse.respawnAt) {
      this.mouse.visible = true; this.mouse.x = MOUSE_SPAWN.x; this.mouse.y = MOUSE_SPAWN.y; this.mouse.respawnAt = 0;
    }
    // vent
    if (this.ventOccupant) {
      const p = this.players.get(this.ventOccupant);
      if (p && p.onVent) { this.chaos += 2 * dt; p.chaos += 2 * dt; p.dominance += 1 * dt; this.progress('vent', dt); }
      else this.ventOccupant = null;
    }
    this.tickHuman(dt);

    if (this.suspicion >= 100) return this.end('THE HUMANS ARE AWAKE. Lights on. Everyone scatter.', true);
    if (this.timeLeft <= 0) return this.end('The sun came up. Shift over.', false);
  }

  private tickHuman(dt: number) {
    const h = this.human;
    h.sprayCd = Math.max(0, h.sprayCd - dt);
    if (h.phase === 'asleep') {
      if (this.suspicion >= 35) { h.phase = 'stirring'; this.logEv('You hear the bed creak…', 'bad'); }
      return;
    }
    if (h.phase === 'stirring') {
      if (this.suspicion < 25) { h.phase = 'asleep'; this.logEv('The human rolls over. Phew.', 'info'); }
      else if (this.suspicion >= 60) { h.phase = 'patrol'; h.idx = 0; h.x = HUMAN_PATROL[0].x; h.y = HUMAN_PATROL[0].y; this.logEv('FOOTSTEPS. The human is up. Hide.', 'bad'); this.broadcast({ t: 'toast', text: 'The human is up. HIDE.', kind: 'bad' }); }
      return;
    }
    if (h.phase === 'patrol' || h.phase === 'returning') {
      const target = HUMAN_PATROL[h.idx];
      const speed = 2.6;
      const dx = target.x - h.x, dy = target.y - h.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.1) {
        h.idx++;
        if (h.idx >= HUMAN_PATROL.length) {
          if (this.suspicion < 45) { h.phase = 'asleep'; h.x = HUMAN_BED.x; h.y = HUMAN_BED.y; this.logEv('The human went back to bed.', 'good'); }
          else h.idx = 1;
        }
      } else {
        const step = Math.min(d, speed * dt);
        h.x += dx / d * step; h.y += dy / d * step;
        h.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      }
      if (h.sprayCd <= 0) {
        for (const p of this.players.values()) {
          if (this.time < p.stunnedUntil) continue;
          if (dist(p.x, p.y, h.x, h.y) <= 3.2 && hasLOS(h.x, h.y, p.x, p.y)) {
            this.spray(p); h.sprayCd = 1.5;
            break;
          }
        }
      }
    }
  }

  private spray(p: PlayerState) {
    p.sprays++; p.stunnedUntil = this.time + 3; p.dominance -= 5;
    this.chaos = Math.max(0, this.chaos - 15); p.chaos -= 15;
    if (p.onVent) { p.onVent = false; if (this.ventOccupant === p.id) this.ventOccupant = null; }
    if (p.carryingMouse) { p.carryingMouse = false; this.mouse.carrier = null; this.mouse.visible = true; this.mouse.x = p.x; this.mouse.y = p.y; }
    // cancel any minigame
    for (const pend of [...this.pending.values()]) if (pend.pid === p.id) { this.pending.delete(pend.token); if (pend.spec.objectId) this.obj(pend.spec.objectId).busyBy = undefined; this.send(p.id, { t: 'mgcancel', token: pend.token }); }
    p.busy = false;
    this.warp(p, CAT_BED.x, CAT_BED.y);
    this.send(p.id, { t: 'toast', text: 'SPRAYED. Back to the cat bed with you.', kind: 'bad' });
    this.logEv(`${p.name} got the spray bottle. -15.`, 'bad');
  }

  private end(reason: string, busted: boolean) {
    if (busted) this.chaos = Math.round(this.chaos * 0.5);
    this.endReason = reason;
    this.phase = 'results';
    for (const p of this.players.values()) p.busy = false;
    for (const pend of this.pending.values()) this.send(pend.pid, { t: 'mgcancel', token: pend.token });
    this.pending.clear();
  }

  snapshot(): Snapshot {
    return {
      phase: this.phase, time: this.time, timeLeft: this.timeLeft, suspicion: this.suspicion, chaos: Math.round(this.chaos),
      players: [...this.players.values()].map(p => ({ ...p, chaos: Math.round(p.chaos), dominance: Math.round(p.dominance) })),
      objects: this.objects, objectives: this.objectives,
      human: { phase: this.human.phase, x: this.human.x, y: this.human.y, dir: this.human.dir },
      mouse: { x: this.mouse.x, y: this.mouse.y, carrier: this.mouse.carrier, visible: this.mouse.visible },
      log: this.log, ventOccupant: this.ventOccupant, endReason: this.endReason,
    };
  }
}

function pickObjectives(playerCount: number): Objective[] {
  const pool: Objective[] = [
    { id: 'knock3', text: 'Knock 3 things off counters', target: 3, progress: 0, done: false },
    { id: 'cabinet', text: 'Open the treat cabinet', target: 1, progress: 0, done: false },
    { id: 'mouse', text: "Leave the toy mouse on the human's pillow", target: 1, progress: 0, done: false },
    { id: 'tp', text: 'Unroll the toilet paper', target: 1, progress: 0, done: false },
    { id: 'stare', text: 'Win a staring contest at the window', target: 1, progress: 0, done: false },
    { id: 'hairball', text: 'Perfect hairball on the good rug', target: 1, progress: 0, done: false },
    { id: 'zoomies2', text: 'Two zoomies runs down the hallway', target: 2, progress: 0, done: false },
    { id: 'vent', text: 'Hold the heating vent 20s (team total)', target: 20, progress: 0, done: false },
  ];
  if (playerCount >= 2) pool.push({ id: 'lick', text: 'Groom a teammate (they must hold still)', target: 1, progress: 0, done: false });
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, 3);
}
