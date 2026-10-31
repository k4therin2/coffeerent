import type Peer from 'peerjs';
import { CAT_BLURB, CAT_IDS, CAT_NAMES, CAT_SPECIAL, type CatId, type ClientMsg, type Dir, type HostMsg, type Snapshot } from './types';
import { Sim } from './sim';
import { hostRoom, joinRoom, loopback, randomCode, type ClientLink, type HostLink } from './net';
import { Renderer, type LocalView } from './render';
import { Input } from './input';
import { makeMinigame, hints, type Minigame } from './minigames';
import { TouchControls, type TouchMode } from './touch';
import { drawCat } from './cats';
import { isSolid, setMap, M, MAPS, MAP_IDS } from './map';
import { diag, diagText, diagLines, clearDiag, onDiag } from './diag';

const ui = document.getElementById('ui')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const input = new Input();
const touch = new TouchControls(canvas, input);
const onResize = () => renderer.resize();
addEventListener('resize', onResize);
addEventListener('orientationchange', () => setTimeout(onResize, 100));
visualViewport?.addEventListener('resize', onResize);
renderer.resize();

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

// =====================================================================
// HOST
// =====================================================================
const HEARTBEAT_TIMEOUT_MS = 20000;
/** stable per tab, so a dropped player can be matched back to their cat */
const CLIENT_KEY = (() => { try { let k = sessionStorage.getItem('ns-key'); if (!k) { k = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('ns-key', k); } return k; } catch { return Math.random().toString(36).slice(2, 10); } })();

class Host {
  sim: Sim;
  links = new Map<string, ClientLink>();
  lastSeen = new Map<string, number>();
  peer: Peer | null = null;
  offline = false;
  private timer = 0;
  private snapAcc = 0;
  constructor(public code: string) {
    this.sim = new Sim((pid, m) => this.links.get(pid)?.send(m), (m) => { for (const l of this.links.values()) l.send(m); });
  }
  async listen() {
    try { this.peer = await hostRoom(this.code, (c) => this.attach(c)); }
    catch (e) { diag('host: matchmaking unavailable, offline solo mode: ' + e, 'error'); this.offline = true; }
    let last = performance.now();
    const STEP = 1 / 30;
    this.timer = window.setInterval(() => {
      const now = performance.now();
      let elapsed = Math.min(2, (now - last) / 1000); last = now;
      // fixed steps with catch-up, so a throttled background tab does not slow the whole game
      let dt = 0;
      while (elapsed >= STEP) { this.sim.tick(STEP); elapsed -= STEP; dt += STEP; }
      last -= elapsed * 1000;
      // drop players whose connection went silent (closed tabs are not always reported by WebRTC)
      for (const [id, seen] of this.lastSeen) {
        if (id !== 'host' && now - seen > HEARTBEAT_TIMEOUT_MS) {
          const l = this.links.get(id); this.links.delete(id); this.lastSeen.delete(id);
          const name = this.sim.players.get(id)?.name ?? id.slice(-6);
          diag(`host: ${name} silent for ${Math.round((now - seen) / 1000)}s (phone asleep or network gone), removing`, 'warn');
          l?.close(); this.sim.removePlayer(id, 'no signal for ' + Math.round(HEARTBEAT_TIMEOUT_MS / 1000) + 's');
          for (const o of this.links.values()) o.send({ t: 'toast', text: `${name} lost connection. They can rejoin with the room code.`, kind: 'bad' });
        }
      }
      this.snapAcc += dt;
      if (this.sim.phase !== 'lobby' && this.snapAcc >= 1 / 12) {
        this.snapAcc = 0;
        const m: HostMsg = { t: 'snap', s: this.sim.snapshot() };
        for (const l of this.links.values()) l.send(m);
      }
    }, 1000 / 30);
  }
  attach(link: ClientLink) {
    link.onMessage = (m: ClientMsg) => {
      this.lastSeen.set(link.id, performance.now());
      if (m.t === 'ping') return;
      if (m.t === 'hello') {
        if (this.sim.phase === 'results') { diag(`host: rejected ${m.name} (results screen)`, 'warn'); link.send({ t: 'reject', reason: 'That shift just ended. Try again once the host is back in the lobby.' }); setTimeout(() => link.close(), 300); return; }
        this.links.set(link.id, link);
        link.send({ t: 'welcome', id: link.id, code: this.code });
        const res = this.sim.addPlayer(link.id, m.name, m.cat, m.key || link.id);
        if (!res) { this.links.delete(link.id); diag(`host: rejected ${m.name} (room full)`, 'warn'); link.send({ t: 'reject', reason: 'Room is full (4 cats max).' }); setTimeout(() => link.close(), 300); return; }
        diag(`host: ${res.p.name} ${res.rejoined ? 'rejoined' : 'joined'} as ${res.p.cat} (${link.id.slice(-6)}) during ${this.sim.phase}`);
        if (this.sim.phase === 'playing') link.send({ t: 'snap', s: this.sim.snapshot() });
        return;
      }
      if (m.t === 'start') { if (link.id === 'host' && this.sim.phase === 'lobby' && this.sim.players.size > 0) this.sim.start(); return; }
      if (m.t === 'again') { if (link.id === 'host' && this.sim.phase === 'results') this.sim.backToLobby(); return; }
      this.sim.handle(link.id, m);
    };
    link.onClose = (reason) => {
      if (!this.links.has(link.id)) return;
      const name = this.sim.players.get(link.id)?.name ?? link.id.slice(-6);
      diag(`host: ${name} left (${reason})`, 'warn');
      this.links.delete(link.id); this.lastSeen.delete(link.id); this.sim.removePlayer(link.id, reason);
      for (const o of this.links.values()) o.send({ t: 'toast', text: `${name} dropped (${reason}). They can rejoin with the code.`, kind: 'bad' });
    };
  }
}

// =====================================================================
// CLIENT
// =====================================================================
interface Other { x: number; y: number; tx: number; ty: number; dir: Dir; moving: boolean; phase: number }

class Client {
  id = '';
  snap: Snapshot | null = null;
  lobby: { id: string; name: string; cat: CatId; host: boolean }[] = [];
  mapChoice = 'random';
  screen: 'connecting' | 'lobby' | 'playing' | 'results' = 'connecting';
  x = 3; y = 6; dir: Dir = 'down'; moving = false; walkPhase = 0;
  others = new Map<string, Other>();
  minigame: Minigame | null = null;
  toasts: { text: string; kind: string; until: number }[] = [];
  now = 0;
  private posAcc = 0;
  private pingTimer = 0;
  private lastSnapAt = 0;
  error = '';

  reconnecting = false;
  constructor(public link: HostLink, public name: string, public cat: CatId, public isHost: boolean, public code: string, public offline: boolean) {
    this.bind(link);
    this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 2000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && client === this) { diag('tab visible again, pinging host'); this.send({ t: 'ping' }); } });
  }
  private bind(link: HostLink) {
    this.link = link;
    link.onMessage = (m) => this.onMessage(m);
    link.onClose = (r) => {
      if (client !== this || this.reconnecting) return; // a newer session replaced this one
      diag(`client: link to host lost (${r})`, 'warn');
      if (this.isHost) { clearInterval(this.pingTimer); client = null; this.error = 'Lost connection (' + r + ').'; renderMenu(this.error); return; }
      void this.reconnect(r);
    };
    link.send({ t: 'hello', name: this.name, cat: this.cat, key: CLIENT_KEY });
  }
  /** Try to get back into the same room for about a minute. */
  private async reconnect(why: string) {
    this.reconnecting = true;
    this.toast('Connection lost. Reconnecting…', 'bad');
    const delays = [1500, 3000, 5000, 8000, 12000, 15000, 15000];
    for (let i = 0; i < delays.length && client === this; i++) {
      await new Promise(r => setTimeout(r, delays[i]));
      if (client !== this) return;
      try {
        diag(`client: reconnect attempt ${i + 1}`);
        const { link } = await joinRoom(this.code);
        this.lastSnapAt = this.now; this.reconnecting = false;
        this.bind(link);
        this.toast('Reconnected.', 'good');
        diag('client: reconnected');
        return;
      } catch (e: any) { diag(`client: reconnect attempt ${i + 1} failed: ${e?.message ?? e}`, 'warn'); }
    }
    if (client !== this) return;
    clearInterval(this.pingTimer); client = null;
    this.error = `Lost connection to the host (${why}) and could not get back in. The room code still works if the host is up.`;
    renderMenu(this.error);
  }
  send(m: ClientMsg) { this.link.send(m); }
  dispose() { clearInterval(this.pingTimer); this.link.onClose = null; this.link.close(); }

  onMessage(m: HostMsg) {
    switch (m.t) {
      case 'welcome': this.id = m.id; diag(`client: welcomed as ${m.id.slice(-6)} in room ${m.code}`); break;
      case 'reject':
        diag(`client: rejected: ${m.reason}`, 'warn');
        this.error = m.reason; this.dispose();
        if (client === this) { client = null; renderMenu(m.reason); }
        break;
      case 'lobby':
        this.lobby = m.players; this.mapChoice = m.mapChoice;
        if (this.screen !== 'playing') { this.screen = 'lobby'; renderLobby(this); }
        break;
      case 'snap': {
        const prev = this.snap;
        this.snap = m.s; this.lastSnapAt = this.now;
        if (m.s.mapId !== M.id) setMap(m.s.mapId);
        for (const p of m.s.players) {
          if (p.id === this.id) continue;
          const o = this.others.get(p.id);
          if (o) { o.tx = p.x; o.ty = p.y; o.dir = p.dir; o.moving = p.moving; }
          else this.others.set(p.id, { x: p.x, y: p.y, tx: p.x, ty: p.y, dir: p.dir, moving: p.moving, phase: 0 });
        }
        for (const id of [...this.others.keys()]) if (!m.s.players.some(p => p.id === id)) this.others.delete(id);
        if (m.s.phase === 'playing' && this.screen !== 'playing') {
          this.screen = 'playing'; ui.innerHTML = ''; this.minigame = null;
          let seen = false; try { seen = !!localStorage.getItem('ns-help-seen'); } catch { /* ignore */ }
          if (!seen) showHelp(true);
        }
        if (m.s.phase === 'results' && this.screen !== 'results') { this.screen = 'results'; this.minigame = null; renderResults(this); }
        if (prev && m.s.log.length) {
          // surface new log lines as toasts only for important ones
        }
        break;
      }
      case 'mgstart': this.minigame = makeMinigame(m.spec); this.moving = false; break;
      case 'mgcancel': if (this.minigame?.spec.token === m.token) this.minigame = null; break;
      case 'warp': this.x = m.x; this.y = m.y; this.moving = false; this.posAcc = 0; break;
      case 'toast': this.toast(m.text, m.kind); if (m.kind === 'bad') diag('event: ' + m.text); break;
    }
  }
  toast(text: string, kind = 'info') { this.toasts.push({ text, kind, until: this.now + 3 }); if (this.toasts.length > 3) this.toasts.shift(); }

  get me() { return this.snap?.players.find(p => p.id === this.id) ?? null; }

  update(dt: number) {
    this.now += dt;
    this.toasts = this.toasts.filter(t => t.until > this.now);
    for (const o of this.others.values()) {
      const k = Math.min(1, dt * 14);
      o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
      if (o.moving) o.phase += dt * 14;
    }
    if (this.screen !== 'playing' || !this.snap) return;
    if (helpOpen) { this.moving = false; return; }
    if (!this.isHost && !this.reconnecting && this.lastSnapAt && this.now - this.lastSnapAt > 10) { this.link.onClose?.('no updates from host for 10s'); return; }
    const me = this.me;
    const stunned = me ? this.snap.time < me.stunnedUntil : false;

    if (this.minigame) {
      this.minigame.update(dt, input);
      if (this.minigame.result) {
        const r = this.minigame.result;
        if (this.minigame.flash <= 0 || this.minigame.elapsed > this.minigame.spec.time + 1) {
          this.send({ t: 'mgdone', token: this.minigame.spec.token, success: r.success, quality: r.quality, timedOut: !!r.timedOut });
          this.minigame = null;
        }
      }
      return;
    }
    if (stunned || me?.busy) { this.moving = false; return; }

    // movement (client authoritative over own position)
    let dx = input.dirX, dy = input.dirY;
    const len = Math.hypot(dx, dy);
    if (len > 0) { dx /= len; dy /= len; }
    const speed = 4.6;
    this.moving = len > 0;
    if (this.moving) {
      this.tryMove(dx * speed * dt, dy * speed * dt);
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      this.walkPhase += dt * 14;
    }
    this.posAcc += dt;
    if ((this.moving && this.posAcc >= 1 / 20) || this.posAcc >= 0.5) { this.posAcc = 0; this.send({ t: 'pos', x: this.x, y: this.y, dir: this.dir, moving: this.moving }); }

    if (input.action) {
      const t = this.findTarget();
      if (t && t.target) this.send({ t: 'use', target: t.target });
    }
  }

  private tryMove(dx: number, dy: number) {
    const r = 0.28;
    const climb = this.me?.cat === 'dorian';
    const free = (x: number, y: number) => !isSolid(Math.floor(x - r), Math.floor(y - r), climb) && !isSolid(Math.floor(x + r), Math.floor(y - r), climb)
      && !isSolid(Math.floor(x - r), Math.floor(y + r), climb) && !isSolid(Math.floor(x + r), Math.floor(y + r), climb);
    if (free(this.x + dx, this.y)) this.x += dx;
    if (free(this.x, this.y + dy)) this.y += dy;
  }

  findTarget(): { target: string; prompt: string } | null {
    const s = this.snap; const me = this.me;
    if (!s || !me) return null;
    const cands: { d: number; target: string; prompt: string }[] = [];
    for (const o of s.objects) {
      let px = o.x, py = o.y;
      if (o.kind === 'mouse') { if (!s.mouse.visible || s.mouse.carrier) continue; px = s.mouse.x; py = s.mouse.y; }
      if (o.kind === 'snack') { if (!s.snack.visible || me.cat !== 'bean') continue; px = s.snack.x; py = s.snack.y; }
      if (o.kind === 'drawer' && (me.cat !== 'ginny' || o.done)) continue;
      const d = dist(this.x, this.y, px, py);
      if (d > 1.5) continue;
      if (o.busyBy || o.cooldownUntil > s.time) continue;
      let prompt = '';
      switch (o.kind) {
        case 'knock': if (o.done) continue; prompt = `Knock the ${o.label} off`; break;
        case 'cabinet': if (o.done) continue; prompt = 'Pick the treat cabinet'; break;
        case 'rug': prompt = 'Hairball on the good rug'; break;
        case 'tp': if (o.done) continue; prompt = 'Unroll the toilet paper'; break;
        case 'window': prompt = 'Stare down the neighbor cat'; break;
        case 'zoomies': prompt = 'ZOOMIES down the hallway'; break;
        case 'vent': {
          if (s.ventOccupant === this.id) continue;
          const occ = s.players.find(p => p.id === s.ventOccupant);
          prompt = occ ? `Shove ${occ.name} off the vent` : 'Curl up on the warm vent'; break;
        }
        case 'mouse': prompt = 'Grab the toy mouse'; break;
        case 'snack': prompt = "Eat the human's snack (Bean only)"; break;
        case 'drawer': prompt = `Open the ${o.label} (Ginny only)`; break;
        case 'pillow': if (!me.carryingMouse) continue; prompt = "Leave the mouse on the human's pillow"; break;
        default: continue;
      }
      cands.push({ d, target: o.id, prompt });
    }
    for (const p of s.players) {
      if (p.id === this.id || p.busy || s.time < p.stunnedUntil) continue;
      const o = this.others.get(p.id);
      const d = dist(this.x, this.y, o?.x ?? p.x, o?.y ?? p.y);
      if (d <= 1.5) cands.push({ d: d + 0.2, target: 'player:' + p.id, prompt: `Groom ${p.name}'s head` });
    }
    cands.sort((a, b) => a.d - b.d);
    if (!cands.length && me.cat === 'melon' && !me.onVent) {
      const cd = (me.specialReadyAt ?? 0) - s.time;
      if (cd > 0) return { target: '', prompt: `Nothing to paw here. Present ready in ${Math.ceil(cd)}s` };
      return { target: 'present', prompt: 'Nothing to paw here. Leave a present?' };
    }
    return cands[0] ?? null;
  }

  view(): LocalView {
    const t = this.screen === 'playing' && !this.minigame ? this.findTarget() : null;
    return {
      me: this.me, x: this.x, y: this.y, dir: this.dir, moving: this.moving, walkPhase: this.walkPhase,
      others: this.others, prompt: t ? (input.touch ? t.prompt : `[E]  ${t.prompt}`) : null, touch: input.touch, toasts: this.toasts, now: this.now,
    };
  }
}

// =====================================================================
// SCREENS (DOM)
// =====================================================================
let client: Client | null = null;
let host: Host | null = null;
const saved = { name: localStorage.getItem('ns-name') ?? '', cat: (localStorage.getItem('ns-cat') as CatId) ?? 'dorian' };

function catCard(cat: CatId, selected: boolean, taken: boolean, onPick: () => void) {
  const el = document.createElement('div');
  el.className = 'cat' + (selected ? ' selected' : '') + (taken ? ' taken' : '');
  const c = document.createElement('canvas'); c.width = 144; c.height = 112;
  drawCat(c.getContext('2d')!, cat, 72, 60, 96, 'right', 0);
  el.append(c);
  const b = document.createElement('b'); b.textContent = CAT_NAMES[cat];
  const sp = document.createElement('span'); sp.textContent = CAT_BLURB[cat];
  el.append(b, sp);
  if (!taken) el.onclick = onPick;
  return el;
}

function renderMenu(error = '') {
  const params = new URLSearchParams(location.search);
  const room = (params.get('room') ?? '').toUpperCase();
  ui.innerHTML = `
    <div class="panel">
      <h1>NIGHT SHIFT <small>The humans are asleep. Four cats. One house. Cause problems.</small></h1>
      <h2>Your name</h2>
      <input type="text" id="name" maxlength="14" placeholder="what the humans call you" value="${escapeHtml(saved.name)}" />
      <h2>Your cat</h2>
      <div class="cats" id="cats"></div>
      <p class="hint" id="special"></p>
      <h2>Play</h2>
      <div class="row">
        <button id="host">Host a shift</button>
        <input type="text" class="code" id="code" maxlength="4" placeholder="CODE" value="${room}" />
        <button id="join" class="secondary">Join</button>
      </div>
      <div class="error" id="err">${escapeHtml(error)}</div>
      <h2>How it works</h2>
      <p class="hint">Co-op, 1 to 4 players. Rack up <b>Chaos</b> as a team before the sun comes up, without waking the human.
      Noise raises <b>Suspicion</b>. Past the red line the human gets up with a spray bottle. You can only see what's near you,
      so keep talking on voice chat. Shove teammates off the vent and groom their heads for <b>Dominance</b>, which counts for nothing except being Top Cat.</p>
      <div class="controls">
        <div><span class="kbd">WASD</span> / arrows move</div><div><span class="kbd">E</span> or <span class="kbd">Space</span> interact</div>
        <div><span class="kbd">H</span> how to play, any time</div><div>Phones: thumbstick + PAW button</div>
      </div>
      <details class="faq"><summary>FAQ: the minigames, hiding, and the cats</summary>${faqHtml()}</details>
    </div>`;
  const catsEl = ui.querySelector('#cats')!;
  const special = ui.querySelector('#special')!;
  const draw = () => { catsEl.innerHTML = ''; for (const c of CAT_IDS) catsEl.append(catCard(c, saved.cat === c, false, () => { saved.cat = c; draw(); })); special.textContent = CAT_SPECIAL[saved.cat]; };
  draw();
  const nameEl = ui.querySelector('#name') as HTMLInputElement;
  const codeEl = ui.querySelector('#code') as HTMLInputElement;
  const err = ui.querySelector('#err')!;
  const getName = () => { saved.name = nameEl.value.trim() || CAT_NAMES[saved.cat]; localStorage.setItem('ns-name', saved.name); localStorage.setItem('ns-cat', saved.cat); return saved.name; };
  const hostBtn = ui.querySelector('#host') as HTMLButtonElement, joinBtn = ui.querySelector('#join') as HTMLButtonElement;
  const busy = (b: boolean) => { hostBtn.disabled = b; joinBtn.disabled = b; };
  hostBtn.onclick = async () => {
    const name = getName();
    busy(true); err.textContent = 'Opening the cat flap…';
    diag(`menu: hosting as ${name} (${saved.cat})`);
    host = new Host(randomCode());
    await host.listen();
    const lb = loopback();
    host.attach(lb.server);
    client = new Client(lb.client, name, saved.cat, true, host.code, host.offline);
  };
  joinBtn.onclick = async () => {
    const name = getName();
    const code = codeEl.value.trim().toUpperCase();
    if (code.length !== 4) { err.textContent = 'Room codes are 4 letters.'; return; }
    busy(true); err.textContent = 'Sniffing around for the host…';
    diag(`menu: joining ${code} as ${name} (${saved.cat})`);
    try {
      const { link } = await joinRoom(code);
      client = new Client(link, name, saved.cat, false, code, false);
    } catch (e: any) { err.textContent = e?.message ?? String(e); busy(false); }
  };
  codeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') joinBtn.click(); });
  if (room) codeEl.focus(); else nameEl.focus();
}

function renderLobby(c: Client) {
  const link = `${location.origin}${location.pathname}?room=${c.code}`;
  const taken = new Set(c.lobby.filter(p => p.id !== c.id).map(p => p.cat));
  ui.innerHTML = `
    <div class="panel">
      <h1>LOBBY <small>${c.isHost ? 'You are hosting. Send friends the code or the link.' : 'Waiting for the host to start the shift.'}</small></h1>
      ${c.offline ? '<div class="error">Could not reach the matchmaking server, so this is a solo offline shift. Friends cannot join this room.</div>' : ''}
      <div class="code-big">${c.code}</div>
      <div class="share" id="share">${link}</div>
      <h2>Cats in the house (${c.lobby.length}/4)</h2>
      <div class="players" id="players"></div>
      <h2>Tonight's house</h2>
      <div class="row">
        ${c.isHost
          ? `<select id="map">${['random', ...MAP_IDS].map(id => `<option value="${id}" ${c.mapChoice === id ? 'selected' : ''}>${id === 'random' ? 'Surprise me (random)' : MAPS[id].name}</option>`).join('')}</select>`
          : `<div class="share">${c.mapChoice === 'random' ? 'Surprise me (random)' : escapeHtml(MAPS[c.mapChoice]?.name ?? c.mapChoice)}</div>`}
      </div>
      <p class="hint">${c.mapChoice === 'random' ? 'A different layout each shift.' : escapeHtml(MAPS[c.mapChoice]?.blurb ?? '')}</p>
      <h2>Switch cat</h2>
      <div class="cats" id="cats"></div>
      <div class="row" style="margin-top:18px">
        ${c.isHost ? '<button id="start">Start the night shift</button>' : '<button disabled>Host starts the shift</button>'}
        <button id="howto" class="secondary">How to play</button>
        <button id="leave" class="secondary">Leave</button>
      </div>
      ${logPanel()}
    </div>`;
  wireLogPanel();
  (ui.querySelector('#howto') as HTMLButtonElement).onclick = () => showHelp(false);
  const pl = ui.querySelector('#players')!;
  for (const p of c.lobby) {
    const el = document.createElement('div'); el.className = 'player';
    const cv = document.createElement('canvas'); cv.width = 96; cv.height = 80;
    drawCat(cv.getContext('2d')!, p.cat, 48, 44, 64, 'right', 0);
    const d = document.createElement('div'); d.innerHTML = `<b>${escapeHtml(p.name)}</b><small>${CAT_NAMES[p.cat]}${p.host ? ' · host' : ''}${p.id === c.id ? ' · you' : ''}</small>`;
    el.append(cv, d); pl.append(el);
  }
  const catsEl = ui.querySelector('#cats')!;
  const mine = c.lobby.find(p => p.id === c.id)?.cat ?? c.cat;
  for (const cat of CAT_IDS) catsEl.append(catCard(cat, mine === cat, taken.has(cat), () => c.send({ t: 'pickcat', cat })));
  (ui.querySelector('#share') as HTMLElement).onclick = () => { navigator.clipboard?.writeText(link); c.toast('Link copied'); (ui.querySelector('#share') as HTMLElement).textContent = 'Copied! ' + link; };
  const start = ui.querySelector('#start') as HTMLButtonElement | null;
  if (start) start.onclick = () => c.send({ t: 'start' });
  const mapSel = ui.querySelector('#map') as HTMLSelectElement | null;
  if (mapSel) mapSel.onchange = () => c.send({ t: 'setmap', id: mapSel.value });
  (ui.querySelector('#leave') as HTMLButtonElement).onclick = () => location.href = location.pathname;
}

function renderResults(c: Client) {
  const s = c.snap!;
  const players = [...s.players.map(p => ({ ...p, left: '' })), ...s.departed.map(d => ({ ...d, left: d.reason }))]
    .sort((a, b) => b.dominance - a.dominance);
  const top = players[0];
  const busted = s.suspicion >= 100;
  ui.innerHTML = `
    <div class="panel">
      <h1>SHIFT OVER <small>${escapeHtml(s.endReason ?? '')}${busted ? ' Chaos halved.' : ''}</small></h1>
      <div class="row" style="align-items:center">
        <div><div class="big">${s.chaos}</div><div class="hint">team chaos</div></div>
        <div><div class="big" style="font-size:28px">${s.objectives.filter(o => o.done).length}/${s.objectives.length}</div><div class="hint">objectives</div></div>
        ${top ? `<div><div class="big" style="font-size:28px"><span class="crown">👑</span> ${escapeHtml(top.name)}</div><div class="hint">Top Cat (${top.dominance} dominance)</div></div>` : ''}
      </div>
      <h2>Objectives</h2>
      ${s.objectives.map(o => `<div class="${o.done ? 'ok' : 'bad'}">${o.done ? '☑' : '☐'} ${o.text}${o.target > 1 ? ` (${Math.floor(o.progress)}/${o.target})` : ''}</div>`).join('')}
      <h2>Cats</h2>
      <table><tr><th>Cat</th><th>Chaos caused</th><th>Dominance</th><th>Sprayed</th></tr>
      ${players.map((p, i) => `<tr><td>${i === 0 ? '👑 ' : ''}<b>${escapeHtml(p.name)}</b> <span class="hint">${CAT_NAMES[p.cat]}${p.left ? ` · left (${escapeHtml(p.left)})` : ''}</span></td><td>${p.chaos}</td><td>${p.dominance}</td><td>${p.sprays}</td></tr>`).join('')}
      </table>
      ${logPanel()}
      <div class="row" style="margin-top:18px">
        ${c.isHost ? '<button id="again">Back to lobby</button>' : '<button disabled>Waiting for host</button>'}
        <button id="leave" class="secondary">Leave</button>
      </div>
    </div>`;
  wireLogPanel();
  const again = ui.querySelector('#again') as HTMLButtonElement | null;
  if (again) again.onclick = () => c.send({ t: 'again' });
  (ui.querySelector('#leave') as HTMLButtonElement).onclick = () => location.href = location.pathname;
}

function faqHtml() {
  const k = (t: string) => `<span class="kbd">${t}</span>`;
  const touch = input.touch;
  return `
    <div class="faqlist">
      <div><b>How do I knock things off the counter?</b> Stand next to a glass, press ${touch ? 'PAW' : k('E')}, then ${touch ? 'TAP' : k('Space')} when the paw is in the green. Dead centre is a quiet thunk, the yellow edges are a loud crash, a miss drops nothing and you can try again in 3 seconds.</div>
      <div><b>Hairball, toilet paper, the snack?</b> ${touch ? 'MASH to fill the bar, then LET GO' : 'Mash ' + k('Space') + ' to fill the bar, then press ' + k('E')} while the bar sits in the green. The bar sinks on its own.</div>
      <div><b>Treat cabinet and drawers?</b> ${touch ? 'TAP' : k('Space')} when the marker is in the green, once per latch. A miss loses a latch. A teammate standing nearby halves the latches and earns a cut.</div>
      <div><b>Zoomies?</b> Press the arrows ${touch ? '' : '(or WASD) '}in the order shown, fast. A wrong press skips that step.</div>
      <div><b>Staring contest?</b> Press nothing at all for six seconds. The neighbour cat will flash fake "PRESS SPACE" prompts. Ignore them.</div>
      <div><b>How do I groom / get groomed? What is "wiggle"?</b> Stand next to a teammate who is holding still and press ${touch ? 'PAW' : k('E')}. The groomer ${touch ? 'TAPS' : 'taps ' + k('Space')} on each beat as it crosses the line. The groomed cat's head drifts: ${touch ? 'hold ◀ or ▶' : 'tap ' + k('A') + ' or ' + k('D')} against the drift to keep it in the green for most of six seconds. Both must do well for full points.</div>
      <div><b>What does each cat do?</b> Dorian is the only cat who can walk on counters, tables and the desk (points while up there, paw prints behind). Ginny is the only cat who can open drawers; they stay open. Melon can leave a present anywhere: with nothing else nearby, press ${touch ? 'PAW' : k('E')}, then ${touch ? 'HOLD and let go' : 'hold ' + k('Space') + ' and let go'} in the green. Bean is the only cat who can eat the snack the human left out.</div>
      <div><b>How do I hide?</b> The human sprays what they can see within about three tiles. Walls and big furniture (couch, tables, bed, desk, fridge, shelves) block their view. Duck behind something and stay out of the hallway when you hear footsteps. The footsteps marker on screen points toward them.</div>
      <div><b>What wakes the human?</b> Noise fills the suspicion bar. Past the first line they stir, past the second they patrol one of three routes, then go back to bed and snore for a bit (quiet window, go wild). They also get up on their own for a pee break or a midnight snack once or twice a night. If the bar fills completely the lights come on and they hunt. Twice and the shift is over.</div>
      <div><b>What is dominance?</b> Bragging rights only. Shoving a cat off the vent, winning the stare, grooming, Dorian's counter time. The Top Cat is crowned on the results screen. It never adds to the team score.</div>
      <div><b>Someone dropped out?</b> They can rejoin with the room code and get their cat and points back. Their scores stay on the results screen either way. The connection log at the bottom of the lobby says what happened.</div>
    </div>`;
}
function helpHtml(touch: boolean) {
  const k = (t: string) => `<span class="kbd">${t}</span>`;
  return `
    <h1>HOW TO PLAY <small>Four cats. One sleeping human. Cause problems together.</small></h1>
    <h2>Goal</h2>
    <p class="hint">Rack up <b>Chaos</b> as a team before the sun comes up. Finish the objectives on the right for bonus points. Noise fills the
    <b>Suspicion</b> bar; past the second line the human gets up with a spray bottle. Being sprayed costs points and dumps you by the litter box.
    If the bar fills completely the lights come on and the human hunts. Twice, and the shift is over.</p>
    <h2>Controls</h2>
    <div class="controls">
      ${touch ? '<div>Left thumb: drag the stick to move</div><div>PAW button: interact with whatever the prompt names</div>'
             : `<div>${k('W')} ${k('A')} ${k('S')} ${k('D')} or arrows: move</div><div>${k('E')} or ${k('Space')}: interact with whatever the prompt names</div>`}
      <div>${touch ? 'Buttons appear for each minigame' : k('H') + ': this screen'}</div><div>Each minigame shows its keys under its title</div>
    </div>
    <h2>FAQ</h2>
    ${faqHtml()}`;
}
let helpOpen = false;
function showHelp(fromGame: boolean) {
  helpOpen = true;
  ui.innerHTML = `<div class="panel">${helpHtml(input.touch)}<div class="row" style="margin-top:18px"><button id="help-close">${fromGame ? 'Back to the shift' : 'Got it'}</button></div></div>`;
  (ui.querySelector('#help-close') as HTMLButtonElement).onclick = hideHelp;
  try { localStorage.setItem('ns-help-seen', '1'); } catch { /* ignore */ }
}
function hideHelp() {
  helpOpen = false;
  if (!client) { renderMenu(); return; }
  if (client.screen === 'lobby') renderLobby(client);
  else if (client.screen === 'results') renderResults(client);
  else ui.innerHTML = '';
}
addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'h' || e.repeat) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
  if (helpOpen) hideHelp(); else showHelp(client?.screen === 'playing');
});

function logPanel() {
  return `<details class="diag" id="diag"><summary>Connection log (${diagLines().length} lines)</summary>
    <div class="row" style="margin:8px 0"><button class="secondary" id="diag-copy">Copy log</button><button class="secondary" id="diag-clear">Clear</button></div>
    <pre id="diag-pre"></pre></details>`;
}
let diagUnsub: (() => void) | null = null;
function wireLogPanel() {
  const pre = ui.querySelector('#diag-pre') as HTMLElement | null;
  if (!pre) return;
  const paint = () => { pre.innerHTML = diagLines().slice(-120).map(l => `<span class="${l.level}">${escapeHtml(l.t)} ${escapeHtml(l.msg)}</span>`).join('\n'); pre.scrollTop = pre.scrollHeight; };
  paint();
  diagUnsub?.(); diagUnsub = onDiag(paint);
  (ui.querySelector('#diag-copy') as HTMLButtonElement).onclick = () => { navigator.clipboard?.writeText(diagText()); (ui.querySelector('#diag-copy') as HTMLButtonElement).textContent = 'Copied'; };
  (ui.querySelector('#diag-clear') as HTMLButtonElement).onclick = () => clearDiag();
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!)); }

// =====================================================================
// LOOP
// =====================================================================
const MG_TOUCH: Record<string, TouchMode> = { swipe: 'tap', pick: 'tap', rhythm: 'tap', mash: 'mash', zoomies: 'zoomies', balance: 'balance', stare: 'stare', hold: 'hold' };
let last = performance.now();
let idlePhase = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  hints.touch = input.touch;
  if (client) {
    client.update(dt);
    const mg = client.minigame;
    const view = client.view();
    touch.mode = client.screen !== 'playing' ? 'none' : mg ? MG_TOUCH[mg.spec.kind] : 'move';
    renderer.draw(client.snap, view, (ctx, w, h) => {
      if (mg) {
        const k = renderer.dpr * Math.max(0.75, Math.min(1.2, innerWidth / 1280));
        // keep the panel clear of the stacked HUD on phones and the touch buttons below
        const top = renderer.narrow ? 300 * renderer.ui : 0, bottom = input.touch ? (renderer.narrow ? 300 : 150) * renderer.ui : 0;
        ctx.save(); ctx.translate(0, top); ctx.scale(k, k); mg.draw(ctx, w / k, Math.max(300 * k, h - top - bottom) / k); ctx.restore();
      }
      touch.draw(ctx, w, h, renderer.ui, view.prompt);
    });
  } else {
    touch.mode = 'none';
    // idle backdrop: wander the camera a little over the dark house
    idlePhase += dt * 0.15;
    renderer.draw(null, { me: null, x: 18 + Math.sin(idlePhase) * 10, y: 10, dir: 'down', moving: false, walkPhase: 0, others: new Map(), prompt: null, touch: input.touch, toasts: [], now });
  }
  input.endFrame();
  requestAnimationFrame(frame);
}
(window as any).__ns = () => ({ client, host });
renderMenu();
requestAnimationFrame(frame);
