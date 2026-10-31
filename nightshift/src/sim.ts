import {
  type CatId, type ClientMsg, type Decal, type Departed, type HostMsg, type LogEvent, type MinigameSpec, type Objective,
  type ObjectState, type Phase, type PlayerState, type Snapshot, type HumanState, CAT_IDS, CAT_NAMES, ROUND_SECONDS,
} from './types';
import { CAT_BED, HUMAN_BED, HUMAN_ROUTES, LITTER, MOUSE_SPAWN, SNACK_SPOTS, SPAWNS, type Waypoint, hasLOS, isClimbable, makeObjects, roomAt } from './map';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Every tunable number in one place. "N" below means the number of cats
 * connected right now (at least 1). Rationale for the shape of these lives in
 * the balance review in the repo history: pressure scales sublinearly with N,
 * nothing may pay well with zero noise and zero risk, and a bust is a scare
 * before it is a game over.
 */
export const BAL = {
  /** suspicion drain per second; shared meter fed by N cats, so drain grows with sqrt(N) */
  drain: (n: number) => 1.2 * Math.sqrt(n),
  deepSleepSeconds: 15,          // after the human lies back down the drain doubles for this long
  deepSleepResetTo: 20,          // and the meter drops to at most this
  stirAt: 35, patrolAt: 60, sleepBelow: 25, keepPatrollingAbove: 45,
  errand: { firstWindow: [60, 120] as [number, number], gap: [40, 80] as [number, number], max: 3, snackChance: 0.5 }, // midnight trips regardless of noise
  human: { walk: 2.6, hunt: 3.4, sprayRange: 3.2, huntSprayRange: 4.5, sprayCooldown: 1.5 },
  spray: { chaos: 20, huntChaos: 25, dominance: 5, stun: 3, suspicionFloor: 50 },
  bust: { chaosMultiplier: 0.8, resetTo: 85, afterHunt: 40 },
  swipe: { hit: 15, crashQuality: 0.3, crashChaos: 10, hitNoise: 5, crashNoise: 15, missNoise: 3, missRetry: 3, cooldown: 50, speedMin: 0.9, speedSpan: 0.5, zone: 0.22 },
  cabinet: { chaos: 30, dom: 8, noise: 8, failNoise: 5, cooldown: 60, pinsSolo: 3, pinsHelped: 2, speed: 1.3, helperRange: 2.5, helperChaos: 5 },
  rug: { base: 5, perQuality: 20, dom: 4, noise: 3, cooldown: 25 },
  tp: { chaos: 15, dom: 5, noise: 4, cooldown: 60, failChaos: 4, failNoise: 2, failRetry: 8 },
  stare: { chaos: 8, dom: 10, cooldown: 40, failNoise: 6, failDom: 3 },
  zoomies: { chaos: 30, dom: 6, noiseBase: 4, noisePerQuality: 12, cooldown: 25, objectiveQuality: 0.5 },
  vent: { warmChaosPerSec: 0.4, warmSeconds: 20, coldChaosPerSec: 0.1, domPerSec: 1 },
  shove: { dom: 3, victimDom: 1, cooldown: 3, pairCooldown: 12 },
  groom: { chaos: 12, dom: 12, lickeeChaos: 5, partialChaos: 8, partialDom: 2, bapChaos: 3, bapDom: -2, bapNoise: 3, pairCooldown: 15, playerCooldown: 20, stillFor: 1.0, humanNear: 8 },
  mouse: { chaos: 45, dom: 10, noise: 12, respawn: 20, droppedRespawn: 40 },
  objective: { complete: 25, boardClear: 50, boardSize: (n: number) => Math.min(5, 2 + n) },
  // cat specials
  present: { chaos: 10, rugOrBedChaos: 20, noise: 2, cooldown: 30, steppedBonus: 15, steppedNoise: 10 },
  drawer: { chaos: 12, dom: 3, noise: 4 },
  counter: { chaosPerSec: 0.5, domPerSec: 0.3, pawprintEvery: 2.5 },
  snack: { chaos: 30, dom: 8, noise: 3, humanNoticesNoise: 15 },
  maxDecals: 80,
};

interface Pending { token: number; pid: string; spec: MinigameSpec; deadline: number; pairId?: number }
interface Pair { id: number; licker: string; lickee: string; results: Record<string, boolean | undefined> }

export class Sim {
  phase: Phase = 'lobby';
  players = new Map<string, PlayerState>();
  objects: ObjectState[] = makeObjects();
  objectives: Objective[] = [];
  board = 0;
  busts = 0;
  time = 0;
  timeLeft = ROUND_SECONDS;
  suspicion = 0;
  chaos = 0;
  human: HumanState & { idx: number; sprayCd: number; route: Waypoint[]; waitUntil: number } =
    { phase: 'asleep', x: HUMAN_BED.x, y: HUMAN_BED.y, dir: 'down', idx: 0, sprayCd: 0, route: HUMAN_ROUTES.hallway, waitUntil: 0 };
  mouse = { x: MOUSE_SPAWN.x, y: MOUSE_SPAWN.y, carrier: null as string | null, visible: true, respawnAt: 0 };
  snack = { x: SNACK_SPOTS[0].x, y: SNACK_SPOTS[0].y, visible: true, eaten: false };
  decals: Decal[] = [];
  ventOccupant: string | null = null;
  log: LogEvent[] = [];
  departed: Departed[] = [];
  endReason?: string;
  private dropped = new Map<string, PlayerState>();
  private pending = new Map<number, Pending>();
  private pairs = new Map<number, Pair>();
  private tokenSeq = 1;
  private shoveCd = new Map<string, number>();
  private lickCd = new Map<string, number>();
  private usedObjectives = new Set<string>();
  private ventSince = 0;
  private deepSleepUntil = 0;
  private nextErrandAt = 0;
  private errandAnnounced = false;
  private errands = 0;
  private lastMoved = new Map<string, number>();
  private presentCd = new Map<string, number>();
  private pawprintAt = new Map<string, number>();
  private counterTime = new Map<string, number>();

  constructor(private send: (pid: string, m: HostMsg) => void, private broadcast: (m: HostMsg) => void) {}

  get n() { return Math.max(1, this.players.size); }

  // ---------- lobby ----------
  addPlayer(id: string, name: string, wantCat: CatId, key: string): { p: PlayerState; rejoined: boolean } | null {
    if (this.players.size >= 4) return null;
    const cleanName = name.slice(0, 14);
    const prev = this.dropped.get(key) ?? [...this.dropped.values()].find(d => d.name === cleanName && cleanName);
    const taken = new Set([...this.players.values()].map(p => p.cat));
    if (prev && !taken.has(prev.cat)) {
      this.dropped.delete(prev.key);
      this.departed = this.departed.filter(d => d.name !== prev.name);
      const p: PlayerState = { ...prev, id, key, connected: true, busy: false, onVent: false, carryingMouse: false, stunnedUntil: 0, ignorePosUntil: 0, x: CAT_BED.x, y: CAT_BED.y };
      this.players.set(id, p);
      if (this.phase === 'playing') { this.logEv(`${p.name} is back.`, 'good'); this.warp(p, CAT_BED.x, CAT_BED.y); }
      this.sendLobby();
      return { p, rejoined: true };
    }
    const cat = taken.has(wantCat) ? CAT_IDS.find(c => !taken.has(c))! : wantCat;
    const slot = this.players.size;
    const p: PlayerState = {
      id, key, name: cleanName || CAT_NAMES[cat], cat, x: SPAWNS[slot].x, y: SPAWNS[slot].y,
      dir: 'down', moving: false, stunnedUntil: 0, onVent: false, carryingMouse: false, busy: false, ignorePosUntil: 0,
      dominance: 0, chaos: 0, sprays: 0, connected: true,
    };
    this.players.set(id, p);
    if (this.phase === 'playing') { this.logEv(`${p.name} snuck in through the cat flap.`, 'info'); this.warp(p, CAT_BED.x, CAT_BED.y); }
    this.sendLobby();
    return { p, rejoined: false };
  }
  removePlayer(id: string, reason = 'disconnected') {
    const p = this.players.get(id);
    if (!p) return;
    if (this.phase === 'lobby') { this.players.delete(id); this.sendLobby(); return; }
    p.connected = false;
    if (this.ventOccupant === id) this.ventOccupant = null;
    if (this.mouse.carrier === id) this.dropMouse(p);
    this.cancelPendingFor(id);
    this.players.delete(id);
    this.dropped.set(p.key, p);
    this.departed.push({ name: p.name, cat: p.cat, chaos: Math.round(p.chaos), dominance: Math.round(p.dominance), sprays: p.sprays, reason });
    this.logEv(`${p.name} wandered off (${reason}).`, 'info');
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
    this.time = 0; this.timeLeft = ROUND_SECONDS; this.suspicion = 0; this.chaos = 0; this.busts = 0;
    this.objects = makeObjects();
    this.human = { phase: 'asleep', x: HUMAN_BED.x, y: HUMAN_BED.y, dir: 'down', idx: 0, sprayCd: 0, route: HUMAN_ROUTES.hallway, waitUntil: 0 };
    this.mouse = { x: MOUSE_SPAWN.x, y: MOUSE_SPAWN.y, carrier: null, visible: true, respawnAt: 0 };
    this.decals = []; this.presentCd.clear(); this.pawprintAt.clear(); this.counterTime.clear();
    this.placeSnack();
    this.ventOccupant = null; this.log = []; this.endReason = undefined;
    this.departed = []; this.dropped.clear(); this.usedObjectives.clear(); this.board = 0;
    this.pending.clear(); this.pairs.clear(); this.shoveCd.clear(); this.lickCd.clear(); this.lastMoved.clear();
    this.deepSleepUntil = 0; this.errandAnnounced = false; this.errands = 0;
    this.nextErrandAt = rnd(BAL.errand.firstWindow[0], BAL.errand.firstWindow[1]);
    let i = 0;
    for (const p of this.players.values()) {
      Object.assign(p, { stunnedUntil: 0, onVent: false, carryingMouse: false, busy: false, dominance: 0, chaos: 0, sprays: 0 });
      this.warp(p, SPAWNS[i].x, SPAWNS[i].y);
      i++;
    }
    this.dealBoard();
    this.logEv('The humans are asleep. Night shift begins.', 'info');
  }
  backToLobby() { this.phase = 'lobby'; this.sendLobby(); }

  private placeSnack() {
    const spot = SNACK_SPOTS[Math.floor(Math.random() * SNACK_SPOTS.length)];
    this.snack = { x: spot.x, y: spot.y, visible: true, eaten: false };
    const o = this.objects.find(o => o.kind === 'snack'); if (o) { o.x = spot.x; o.y = spot.y; o.done = false; }
  }
  private decal(kind: Decal['kind'], x: number, y: number, r = 0.35) {
    this.decals.push({ kind, x: x + rnd(-0.15, 0.15), y: y + rnd(-0.15, 0.15), r, seed: Math.floor(Math.random() * 1e6) });
    if (this.decals.length > BAL.maxDecals) this.decals.shift();
  }
  private hasCat(cat: CatId) { return [...this.players.values()].some(p => p.cat === cat); }

  /** Deal a fresh objective board sized and targeted for the current cat count. */
  private dealBoard() {
    this.board++;
    const tier = this.board - 1;
    const cats = new Set([...this.players.values()].map(p => p.cat));
    let pool = objectivePool(this.n, tier, cats).filter(o => !this.usedObjectives.has(o.id));
    if (pool.length < BAL.objective.boardSize(this.n)) { this.usedObjectives.clear(); pool = objectivePool(this.n, tier, cats); }
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    this.objectives = pool.slice(0, BAL.objective.boardSize(this.n));
    for (const o of this.objectives) this.usedObjectives.add(o.id);
  }

  // ---------- messages ----------
  handle(pid: string, m: ClientMsg) {
    const p = this.players.get(pid);
    if (!p) return;
    switch (m.t) {
      case 'pos':
        if (this.phase !== 'playing') return;
        if (p.busy || this.time < p.stunnedUntil || this.time < p.ignorePosUntil) return;
        if (m.moving || dist(p.x, p.y, m.x, m.y) > 0.05) this.lastMoved.set(pid, this.time);
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
        this.finishMinigame(p, m.token, m.success, clamp(Number(m.quality) || 0, 0, 1), !!m.timedOut);
        return;
      case 'pickcat':
        this.setCat(pid, m.cat);
        return;
    }
  }

  private obj(id: string): ObjectState { return this.objects.find(o => o.id === id)!; }
  private dropMouse(p: PlayerState) {
    p.carryingMouse = false;
    this.mouse.carrier = null; this.mouse.visible = true; this.mouse.x = p.x; this.mouse.y = p.y;
    this.mouse.respawnAt = this.time + BAL.mouse.droppedRespawn;
  }
  private cancelPendingFor(pid: string) {
    for (const pend of [...this.pending.values()]) {
      if (pend.pid !== pid) continue;
      this.pending.delete(pend.token);
      if (pend.spec.objectId) this.obj(pend.spec.objectId).busyBy = undefined;
      this.send(pid, { t: 'mgcancel', token: pend.token });
      if (pend.pairId !== undefined) this.pairResult(pend.pairId, pid, false);
    }
    const p = this.players.get(pid);
    if (p) p.busy = false;
  }
  private pairResult(pairId: number, pid: string, success: boolean) {
    const pair = this.pairs.get(pairId);
    if (!pair) return;
    pair.results[pid] = success;
    const a = pair.results[pair.licker], b = pair.results[pair.lickee];
    if (a === undefined || b === undefined) return;
    this.pairs.delete(pair.id);
    const licker = this.players.get(pair.licker), lickee = this.players.get(pair.lickee);
    if (!licker) return;
    const G = BAL.groom;
    const lickeeName = lickee?.name ?? 'the other cat';
    if (a && b && lickee) {
      this.score(licker, G.chaos, G.dom); lickee.chaos += G.lickeeChaos; this.chaos += G.lickeeChaos;
      this.progress('lick'); this.logEv(`${licker.name} groomed ${lickee.name}. ${lickee.name} allowed it.`, 'dom');
    } else if (a && !b) { this.score(licker, G.partialChaos, G.partialDom); this.logEv(`${lickeeName} squirmed away from ${licker.name}.`, 'info'); }
    else { this.score(licker, G.bapChaos, G.bapDom); this.noise(G.bapNoise); this.logEv(`${licker.name} tried to groom ${lickeeName} and got bapped.`, 'bad'); }
  }
  private warp(p: PlayerState, x: number, y: number) {
    p.x = x; p.y = y; p.moving = false; p.ignorePosUntil = this.time + 0.7;
    this.lastMoved.set(p.id, this.time);
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
      this.chaos += BAL.objective.complete;
      if (this.objectives.every(x => x.done)) {
        this.chaos += BAL.objective.boardClear;
        this.dealBoard();
        this.logEv(`BOARD CLEARED. +${BAL.objective.boardClear}. The night is young: new objectives.`, 'good');
        this.broadcast({ t: 'toast', text: 'Board cleared! New objectives.', kind: 'good' });
      }
    }
  }

  private use(p: PlayerState, target: string) {
    if (p.busy || this.time < p.stunnedUntil) return;
    if (target.startsWith('player:')) return this.tryLick(p, target.slice(7));
    if (target === 'present') return this.leavePresent(p);
    const o = this.objects.find(o => o.id === target);
    if (!o) return;
    const tx = o.kind === 'mouse' ? this.mouse.x : o.x, ty = o.kind === 'mouse' ? this.mouse.y : o.y;
    if (dist(p.x, p.y, tx, ty) > 1.6) return;
    if (o.busyBy || this.time < o.cooldownUntil) return;
    switch (o.kind) {
      case 'knock':
        if (o.done) return;
        return this.startMinigame(p, { kind: 'swipe', title: `Knock the ${o.label} off`, time: 6, params: { speed: BAL.swipe.speedMin + Math.random() * BAL.swipe.speedSpan, zone: BAL.swipe.zone, crash: BAL.swipe.crashQuality }, objectId: o.id });
      case 'cabinet': {
        if (o.done) return;
        const helped = this.helpersNear(p, o) > 0;
        return this.startMinigame(p, { kind: 'pick', title: 'Pick the treat cabinet', time: 14, params: { pins: helped ? BAL.cabinet.pinsHelped : BAL.cabinet.pinsSolo, speed: BAL.cabinet.speed }, objectId: o.id });
      }
      case 'rug':
        return this.startMinigame(p, { kind: 'mash', title: 'Hairball on the good rug', time: 7, params: { label: 'HACK', target: 0.75, width: 0.15 }, objectId: o.id });
      case 'tp':
        if (o.done) return;
        return this.startMinigame(p, { kind: 'mash', title: 'Unroll the toilet paper', time: 7, params: { label: 'PAW', target: 0.85, width: 0.2 }, objectId: o.id });
      case 'window':
        return this.startMinigame(p, { kind: 'stare', title: 'Staring contest: the neighbor cat', time: 7, params: { hold: 6 }, objectId: o.id });
      case 'zoomies':
        return this.startMinigame(p, { kind: 'zoomies', title: 'ZOOMIES', time: 8, params: { count: 9 }, objectId: o.id });
      case 'vent':
        return this.useVent(p, o);
      case 'mouse':
        if (this.mouse.carrier || !this.mouse.visible) return;
        this.mouse.carrier = p.id; this.mouse.respawnAt = 0; this.mouse.visible = false; p.carryingMouse = true;
        this.logEv(`${p.name} picked up the toy mouse.`, 'info');
        return;
      case 'drawer':
        if (p.cat !== 'ginny' || o.done) return;
        return this.startMinigame(p, { kind: 'pick', title: `Open the ${o.label}`, time: 8, params: { pins: 1, speed: 1.1 }, objectId: o.id });
      case 'snack':
        if (p.cat !== 'bean' || !this.snack.visible) return;
        return this.startMinigame(p, { kind: 'mash', title: "Eat the human's snack", time: 7, params: { label: 'NOM', target: 0.8, width: 0.3 }, objectId: o.id });
      case 'pillow':
        if (!p.carryingMouse) return;
        p.carryingMouse = false; this.mouse.carrier = null; this.mouse.visible = false; this.mouse.respawnAt = this.time + BAL.mouse.respawn;
        this.score(p, BAL.mouse.chaos, BAL.mouse.dom); this.noise(BAL.mouse.noise); this.progress('mouse');
        this.logEv(`${p.name} left a gift on the pillow. The human murmurs.`, 'good');
        return;
    }
  }
  /** Melon only: leave a present wherever she stands. */
  private leavePresent(p: PlayerState) {
    if (p.cat !== 'melon' || p.onVent) return;
    if ((this.presentCd.get(p.id) ?? 0) > this.time) return;
    const P = BAL.present;
    this.presentCd.set(p.id, this.time + P.cooldown);
    const room = roomAt(Math.floor(p.x), Math.floor(p.y))?.name;
    const onRug = dist(p.x, p.y, this.obj('rug').x, this.obj('rug').y) < 1.2;
    const fancy = onRug || room === 'Bedroom';
    this.decal('present', p.x, p.y, 0.3);
    this.score(p, fancy ? P.rugOrBedChaos : P.chaos, 3); this.noise(P.noise); this.progress('present');
    this.logEv(fancy ? `${p.name} left a present ${onRug ? 'on the good rug' : 'in the bedroom'}. Bold.` : `${p.name} left a present in the ${room ?? 'house'}.`, fancy ? 'good' : 'info');
  }
  private helpersNear(p: PlayerState, o: ObjectState) {
    return [...this.players.values()].filter(q => q.id !== p.id && dist(q.x, q.y, o.x, o.y) < BAL.cabinet.helperRange).length;
  }

  private useVent(p: PlayerState, v: ObjectState) {
    if (this.ventOccupant === p.id) return;
    if (this.ventOccupant) {
      const victim = this.players.get(this.ventOccupant);
      if ((this.shoveCd.get(p.id) ?? 0) > this.time) return;
      if (victim && (this.shoveCd.get(p.id + '>' + victim.id) ?? 0) > this.time) return;
      this.shoveCd.set(p.id, this.time + BAL.shove.cooldown);
      if (victim) {
        this.shoveCd.set(p.id + '>' + victim.id, this.time + BAL.shove.pairCooldown);
        victim.onVent = false; victim.stunnedUntil = this.time + 1.2;
        const ox = victim.x < v.x ? -1 : 1;
        this.warp(victim, v.x + ox, v.y);
        this.send(victim.id, { t: 'toast', text: `${p.name} shoved you off the vent.`, kind: 'dom' });
        this.score(p, 0, BAL.shove.dom); victim.dominance -= BAL.shove.victimDom;
        this.logEv(`${p.name} shoved ${victim.name} off the vent.`, 'dom');
      }
    }
    this.ventOccupant = p.id; p.onVent = true; this.ventSince = this.time;
    this.warp(p, v.x, v.y);
  }

  private tryLick(p: PlayerState, otherId: string) {
    const q = this.players.get(otherId);
    if (!q || q.id === p.id || q.busy || this.time < q.stunnedUntil || q.carryingMouse) return;
    if (dist(p.x, p.y, q.x, q.y) > 1.6) return;
    // consent by stillness: the other cat has to have been standing still for a moment
    if (this.time - (this.lastMoved.get(q.id) ?? -99) < BAL.groom.stillFor) return;
    // never while the human is about
    if (this.human.phase === 'patrol' || this.human.phase === 'hunt') {
      if (dist(this.human.x, this.human.y, q.x, q.y) < BAL.groom.humanNear) return;
    }
    const key = [p.id, q.id].sort().join('|');
    if ((this.lickCd.get(key) ?? 0) > this.time) return;
    if ((this.lickCd.get(p.id) ?? 0) > this.time || (this.lickCd.get(q.id) ?? 0) > this.time) return;
    this.lickCd.set(key, this.time + BAL.groom.pairCooldown);
    this.lickCd.set(p.id, this.time + BAL.groom.playerCooldown);
    this.lickCd.set(q.id, this.time + BAL.groom.playerCooldown);
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

  private finishMinigame(p: PlayerState, token: number, success: boolean, quality: number, timedOut = false) {
    const pend = this.pending.get(token);
    if (!pend || pend.pid !== p.id) return;
    this.pending.delete(token);
    p.busy = false;
    const spec = pend.spec;
    const o = spec.objectId ? this.obj(spec.objectId) : undefined;
    if (o) o.busyBy = undefined;
    if (this.phase !== 'playing') return;
    switch (spec.kind) {
      case 'swipe': {
        if (!o) break;
        const S = BAL.swipe;
        if (timedOut) { o.cooldownUntil = this.time + 4; this.noise(2); break; }           // walked away, nothing fell
        if (!success) { o.cooldownUntil = this.time + S.missRetry; this.noise(S.missNoise); this.logEv(`${p.name} swiped at the ${o.label} and missed.`, 'info'); break; }
        // if it counts, it fell: a clean hit is quiet, an edge hit is a crash
        o.done = true; o.cooldownUntil = this.time + S.cooldown;
        this.progress('knock');
        this.decal('shards', o.x, o.y + 1, 0.4);
        if (quality >= S.crashQuality) { this.score(p, o.value ?? S.hit, 4); this.noise(S.hitNoise); this.logEv(`${p.name} nudged the ${o.label} off. Thunk.`, 'good'); }
        else { this.score(p, S.crashChaos, 2); this.noise(S.crashNoise); this.logEv(`${p.name} sent the ${o.label} flying. CRASH.`, 'bad'); }
        break;
      }
      case 'pick': {
        if (!o) break;
        if (o.kind === 'drawer') {
          const D = BAL.drawer;
          if (success) { o.done = true; o.cooldownUntil = 0; this.score(p, D.chaos, D.dom); this.noise(D.noise); this.progress('drawer'); this.logEv(`${p.name} opened the ${o.label}. It stays open.`, 'good'); }
          else { this.noise(2); this.logEv(`${p.name} pawed at the ${o.label}.`, 'info'); }
          break;
        }
        const C = BAL.cabinet;
        if (success) {
          o.done = true; o.cooldownUntil = this.time + C.cooldown; this.score(p, C.chaos, C.dom); this.noise(C.noise); this.progress('cabinet');
          const helpers = [...this.players.values()].filter(q => q.id !== p.id && dist(q.x, q.y, o.x, o.y) < C.helperRange);
          for (const h of helpers) { h.chaos += C.helperChaos; this.chaos += C.helperChaos; }
          this.logEv(`${p.name} opened the treat cabinet${helpers.length ? ' with ' + helpers.map(h => h.name).join(' and ') : ''}. Treats for everyone.`, 'good');
        } else { this.noise(C.failNoise); this.logEv(`${p.name} rattled the cabinet and gave up.`, 'info'); }
        break;
      }
      case 'mash':
        if (!o) break;
        if (o.kind === 'rug') {
          const R = BAL.rug;
          o.cooldownUntil = this.time + R.cooldown;
          this.score(p, Math.round(R.base + R.perQuality * quality), success ? R.dom : 0); this.noise(R.noise);
          this.decal(success ? 'hairball' : 'puddle', success ? o.x + rnd(-0.6, 0.6) : p.x, success ? o.y + rnd(-0.3, 0.3) : p.y, 0.28);
          if (success) { this.progress('hairball'); this.logEv(`${p.name} produced a perfect hairball on the good rug.`, 'good'); }
          else this.logEv(`${p.name} coughed up something near the rug. Close enough.`, 'info');
        } else if (o.kind === 'snack') {
          const K = BAL.snack;
          if (success) {
            this.snack.visible = false; this.snack.eaten = true; o.done = true;
            this.decal('crumbs', o.x, o.y, 0.45);
            this.score(p, K.chaos, K.dom); this.noise(K.noise); this.progress('snack');
            this.logEv(`${p.name} ate the human's snack. Every crumb.`, 'good');
          } else { this.noise(1); this.logEv(`${p.name} sniffed the snack and walked off.`, 'info'); }
        } else {
          const T = BAL.tp;
          if (success) { o.done = true; o.cooldownUntil = this.time + T.cooldown; this.score(p, T.chaos, T.dom); this.noise(T.noise); this.progress('tp'); this.logEv(`${p.name} unrolled the entire toilet paper.`, 'good'); }
          else { o.cooldownUntil = this.time + T.failRetry; this.score(p, T.failChaos); this.noise(T.failNoise); this.logEv(`${p.name} shredded a bit of toilet paper.`, 'info'); }
        }
        break;
      case 'stare': {
        if (!o) break;
        const S = BAL.stare;
        o.cooldownUntil = this.time + S.cooldown;
        if (success) { this.score(p, S.chaos, S.dom); this.progress('stare'); this.logEv(`${p.name} out-stared the neighbor cat. Dominance asserted.`, 'dom'); }
        else { this.noise(S.failNoise); p.dominance -= S.failDom; this.logEv(`${p.name} blinked first and hissed at the window.`, 'bad'); }
        break;
      }
      case 'zoomies': {
        if (!o) break;
        const Z = BAL.zoomies;
        o.cooldownUntil = this.time + Z.cooldown;
        this.score(p, Math.round(Z.chaos * quality), Math.round(Z.dom * quality)); this.noise(Z.noiseBase + Z.noisePerQuality * quality);
        if (quality >= Z.objectiveQuality) this.progress('zoomies');
        this.logEv(quality >= 0.9 ? `${p.name} did PERFECT zoomies. The floor shook.` : `${p.name} did zoomies (${Math.round(quality * 100)}%).`, quality >= 0.9 ? 'good' : 'info');
        break;
      }
      case 'rhythm':
      case 'balance':
        if (pend.pairId !== undefined) this.pairResult(pend.pairId, p.id, success);
        break;
    }
  }

  // ---------- tick ----------
  tick(dt: number) {
    if (this.phase !== 'playing') return;
    if (this.suspicion >= 100) this.bust();
    if (this.phase !== 'playing') return;
    this.time += dt;
    this.timeLeft = Math.max(0, ROUND_SECONDS - this.time);
    const drain = BAL.drain(this.n) * (this.time < this.deepSleepUntil ? 2 : 1);
    this.suspicion = clamp(this.suspicion - drain * dt, 0, 100);

    for (const pend of [...this.pending.values()]) {
      if (this.time > pend.deadline) {
        this.pending.delete(pend.token);
        const p = this.players.get(pend.pid);
        if (p) p.busy = false;
        if (pend.spec.objectId) this.obj(pend.spec.objectId).busyBy = undefined;
        this.send(pend.pid, { t: 'mgcancel', token: pend.token });
        if (pend.pairId !== undefined) this.pairResult(pend.pairId, pend.pid, false);
      }
    }
    for (const o of this.objects) if (o.done && o.cooldownUntil && this.time > o.cooldownUntil) { o.done = false; o.cooldownUntil = 0; }
    if (!this.mouse.carrier && this.mouse.respawnAt && this.time > this.mouse.respawnAt) {
      this.mouse.visible = true; this.mouse.x = MOUSE_SPAWN.x; this.mouse.y = MOUSE_SPAWN.y; this.mouse.respawnAt = 0;
    }
    if (this.ventOccupant) {
      const p = this.players.get(this.ventOccupant);
      if (p && p.onVent) {
        const V = BAL.vent;
        const rate = this.time - this.ventSince < V.warmSeconds ? V.warmChaosPerSec : V.coldChaosPerSec;
        this.chaos += rate * dt; p.chaos += rate * dt; p.dominance += V.domPerSec * dt; this.progress('vent', dt);
      } else this.ventOccupant = null;
    }
    // Dorian on the counters
    for (const p of this.players.values()) {
      if (p.cat !== 'dorian' || p.busy || this.time < p.stunnedUntil) continue;
      if (!isClimbable(Math.floor(p.x), Math.floor(p.y))) continue;
      const C = BAL.counter;
      this.chaos += C.chaosPerSec * dt; p.chaos += C.chaosPerSec * dt; p.dominance += C.domPerSec * dt;
      this.progress('counter', dt);
      if (p.moving && this.time - (this.pawprintAt.get(p.id) ?? -99) > C.pawprintEvery) { this.pawprintAt.set(p.id, this.time); this.decal('pawprints', p.x, p.y, 0.3); }
    }
    this.tickHuman(dt);
    if (this.timeLeft <= 0) return this.end('The sun came up. Shift over.');
  }

  private wake(routeName: keyof typeof HUMAN_ROUTES, phase: 'patrol' | 'hunt', line: string) {
    const h = this.human;
    h.phase = phase; h.route = HUMAN_ROUTES[routeName]; h.idx = 0; h.waitUntil = 0;
    h.x = HUMAN_BED.x; h.y = HUMAN_BED.y;
    this.logEv(line, 'bad');
    this.broadcast({ t: 'toast', text: line, kind: 'bad' });
  }
  private backToBed(afterHunt: boolean) {
    const h = this.human;
    if (h.route === HUMAN_ROUTES.snack && this.hasCat('bean')) { this.placeSnack(); this.logEv('The human left a plate out somewhere. Bean?', 'info'); }
    (h as any).snackChecked = false;
    h.phase = 'asleep'; h.x = HUMAN_BED.x; h.y = HUMAN_BED.y;
    if (afterHunt) { this.suspicion = Math.min(this.suspicion, BAL.bust.afterHunt); this.logEv('The lights go off. The human grumbles back to bed.', 'good'); }
    else {
      this.suspicion = Math.min(this.suspicion, BAL.deepSleepResetTo); this.deepSleepUntil = this.time + BAL.deepSleepSeconds;
      this.logEv('The human is snoring. Go.', 'good');
      this.broadcast({ t: 'toast', text: 'The human is snoring. Go go go.', kind: 'good' });
    }
    // maybe another errand later in the night
    if (this.errands < BAL.errand.max && this.nextErrandAt === 0) {
      const at = this.time + rnd(BAL.errand.gap[0], BAL.errand.gap[1]);
      if (at < ROUND_SECONDS - 25) this.nextErrandAt = at;
    }
  }
  private pickRoute(): keyof typeof HUMAN_ROUTES {
    const r = Math.random();
    return r < 0.4 ? 'hallway' : r < 0.7 ? 'kitchen' : 'living';
  }

  private tickHuman(dt: number) {
    const h = this.human;
    h.sprayCd = Math.max(0, h.sprayCd - dt);
    const B = BAL;
    // midnight errands: the first is guaranteed, later ones are random, none depend on noise
    if ((h.phase === 'asleep' || h.phase === 'stirring') && this.nextErrandAt > 0) {
      if (!this.errandAnnounced && this.time >= this.nextErrandAt - 5) { this.errandAnnounced = true; this.logEv('You hear the bed creak…', 'bad'); }
      if (this.time >= this.nextErrandAt) {
        this.nextErrandAt = 0; this.errandAnnounced = false; this.errands++;
        const snack = Math.random() < BAL.errand.snackChance;
        this.wake(snack ? 'snack' : 'bathroom', 'patrol', snack ? 'FOOTSTEPS. The human wants a midnight snack. Stay out of the kitchen.' : 'FOOTSTEPS. The human is up for a pee break. Hide.');
        return;
      }
    }
    if (h.phase === 'asleep') {
      if (this.suspicion >= B.stirAt) { h.phase = 'stirring'; this.logEv('You hear the bed creak…', 'bad'); }
      return;
    }
    if (h.phase === 'stirring') {
      if (this.suspicion < B.sleepBelow) { h.phase = 'asleep'; this.logEv('The human rolls over. Phew.', 'info'); }
      else if (this.suspicion >= B.patrolAt) this.wake(this.pickRoute(), 'patrol', 'FOOTSTEPS. The human is up. Hide.');
      return;
    }
    // patrol or hunt
    const hunting = h.phase === 'hunt';
    const speed = hunting ? B.human.hunt : B.human.walk;
    const target = h.route[h.idx];
    const dx = target.x - h.x, dy = target.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.1) {
      if (target.wait && h.waitUntil === 0) h.waitUntil = this.time + target.wait;
      if (h.waitUntil === 0 || this.time >= h.waitUntil) {
        h.waitUntil = 0; h.idx++;
        if (h.idx >= h.route.length) {
          if (hunting) this.backToBed(true);
          else if (this.suspicion < B.keepPatrollingAbove) this.backToBed(false);
          else { h.route = HUMAN_ROUTES[this.pickRoute()]; h.idx = 4; this.logEv('The human is still prowling.', 'bad'); }
        }
      }
    } else {
      const step = Math.min(d, speed * dt);
      h.x += dx / d * step; h.y += dy / d * step;
      h.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      // presents underfoot
      const i = this.decals.findIndex(dc => dc.kind === 'present' && dist(dc.x, dc.y, h.x, h.y) < 0.5);
      if (i >= 0) {
        this.decals.splice(i, 1); this.noise(BAL.present.steppedNoise); this.chaos += BAL.present.steppedBonus;
        const melon = [...this.players.values()].find(q => q.cat === 'melon'); if (melon) { melon.chaos += BAL.present.steppedBonus; melon.dominance += 5; }
        this.logEv('The human stepped in a present. Barefoot. +' + BAL.present.steppedBonus, 'good');
        this.broadcast({ t: 'toast', text: 'The human stepped in it. Barefoot.', kind: 'good' });
      }
    }
    // reaching the fridge on a snack run: notice the missing snack, and leave a new one out later
    if (d < 0.1 && target.wait && h.waitUntil !== 0 && h.route === HUMAN_ROUTES.snack && !(h as any).snackChecked) {
      (h as any).snackChecked = true;
      if (this.snack.eaten) { this.noise(BAL.snack.humanNoticesNoise); this.logEv('The human notices the snack is gone. Suspicion.', 'bad'); }
    }
    if (h.sprayCd <= 0 && h.idx > 1) {
      const range = hunting ? B.human.huntSprayRange : B.human.sprayRange;
      for (const p of this.players.values()) {
        if (this.time < p.stunnedUntil) continue;
        if (dist(p.x, p.y, h.x, h.y) <= range && hasLOS(h.x, h.y, p.x, p.y)) { this.spray(p, hunting); h.sprayCd = B.human.sprayCooldown; break; }
      }
    }
  }

  private spray(p: PlayerState, hunting: boolean) {
    const S = BAL.spray;
    const cost = hunting ? S.huntChaos : S.chaos;
    p.sprays++; p.stunnedUntil = this.time + S.stun; p.dominance -= S.dominance;
    this.chaos = Math.max(0, this.chaos - cost); p.chaos -= cost;
    if (p.onVent) { p.onVent = false; if (this.ventOccupant === p.id) this.ventOccupant = null; }
    if (p.carryingMouse) this.dropMouse(p);
    this.cancelPendingFor(p.id);
    if (!hunting) this.suspicion = Math.max(this.suspicion, S.suspicionFloor);
    this.warp(p, LITTER.x, LITTER.y);
    this.send(p.id, { t: 'toast', text: `SPRAYED. -${cost}. Dumped by the litter box.`, kind: 'bad' });
    this.logEv(`${p.name} got the spray bottle. -${cost}.`, 'bad');
  }

  /** Suspicion hit 100. First time: lights on and a fast, angry lap. Second time: shift over. */
  private bust() {
    this.busts++;
    if (this.busts >= 2) return this.end('THE HUMANS ARE AWAKE. Lights on for good. Everyone scatter.');
    this.chaos = Math.round(this.chaos * BAL.bust.chaosMultiplier);
    this.suspicion = BAL.bust.resetTo;
    this.wake('hallway', 'hunt', 'LIGHTS ON. The human is furious. HIDE.');
    this.logEv(`Chaos -${Math.round((1 - BAL.bust.chaosMultiplier) * 100)}%. One more and the shift is over.`, 'bad');
  }

  private end(reason: string) {
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
      objects: this.objects, objectives: this.objectives, board: this.board, busts: this.busts,
      human: { phase: this.human.phase, x: this.human.x, y: this.human.y, dir: this.human.dir },
      mouse: { x: this.mouse.x, y: this.mouse.y, carrier: this.mouse.carrier, visible: this.mouse.visible },
      snack: { x: this.snack.x, y: this.snack.y, visible: this.snack.visible }, decals: this.decals,
      log: this.log, ventOccupant: this.ventOccupant, endReason: this.endReason, departed: this.departed,
    };
  }
}

/** Objective pool with targets as a function of cat count and board tier (later boards ask for one more). */
export function objectivePool(n: number, tier: number, cats: Set<CatId> = new Set()): Objective[] {
  const mk = (id: string, text: string, target: number): Objective => ({ id, text, target, progress: 0, done: false });
  const knock = Math.min(7, 2 + n + tier);
  const zoom = 1 + Math.ceil(n / 2) + tier;
  const hair = (n >= 3 ? 2 : 1) + tier;
  const stare = (n >= 4 ? 2 : 1) + tier;
  const mouse = (n >= 4 ? 2 : 1) + (tier > 0 ? 1 : 0);
  const pool = [
    mk('knock', `Knock ${knock} things off (kitchen, bedroom, office)`, knock),
    mk('cabinet', 'Open the treat cabinet (kitchen)', 1),
    mk('mouse', mouse > 1 ? `Toy mouse onto the human's pillow, ${mouse} times (laundry → bedroom)` : "Toy mouse onto the human's pillow (laundry → bedroom)", mouse),
    mk('tp', 'Unroll the toilet paper (bathroom)', 1),
    mk('stare', stare > 1 ? `Win ${stare} staring contests at the window (living room)` : 'Win a staring contest at the window (living room)', stare),
    mk('hairball', hair > 1 ? `${hair} perfect hairballs on the good rug (living room)` : 'Perfect hairball on the good rug (living room)', hair),
    mk('zoomies', `${zoom} zoomies runs down the hallway`, zoom),
    mk('vent', `Hold the heating vent ${20 + 10 * tier}s total (living room)`, 20 + 10 * tier),
  ];
  if (n >= 2) { const l = Math.ceil(n / 2) + tier; pool.push(mk('lick', l > 1 ? `Groom teammates ${l} times (they must hold still)` : 'Groom a teammate (they must hold still)', l)); }
  if (cats.has('melon')) pool.push(mk('present', `Melon: leave ${2 + tier} presents around the house`, 2 + tier));
  if (cats.has('ginny')) pool.push(mk('drawer', `Ginny: open ${Math.min(4, 2 + tier)} drawers`, Math.min(4, 2 + tier)));
  if (cats.has('dorian')) pool.push(mk('counter', `Dorian: ${20 + 10 * tier}s up on the counters`, 20 + 10 * tier));
  if (cats.has('bean')) pool.push(mk('snack', "Bean: eat the human's snack", 1));
  return pool;
}
