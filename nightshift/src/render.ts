import { TILE, VISION_TILES, type Snapshot, type PlayerState, type Dir } from './types';
import { FURNITURE, MAP_H, MAP_W, ROOMS, isWall, hasLOS, type Furniture } from './map';
import { drawCat, drawHuman } from './cats';
import { roundRect } from './minigames';

export interface LocalView {
  me: PlayerState | null;      // local player (authoritative pos)
  x: number; y: number;        // local pos
  dir: Dir; moving: boolean; walkPhase: number;
  others: Map<string, { x: number; y: number; dir: Dir; moving: boolean; phase: number }>;
  prompt: string | null;
  toasts: { text: string; kind: string; until: number }[];
  now: number;
}

const FURN_COLORS: Record<Furniture['kind'], string> = {
  couch: '#7a4f3a', table: '#8a6a44', counter: '#b9b2a4', fridge: '#d8dde0', bed: '#6b5a8a', nightstand: '#7a5a3a',
  toilet: '#e8ecee', tub: '#dfe6ea', washer: '#cfd6da', dryer: '#c4ccd0', desk: '#5a4a3a', chair: '#333a44',
  shelf: '#6a4a30', plant: '#2f7a3a', litter: '#9a8d78', catbed: '#b04a5a', tv: '#1a1a22', lamp: '#f0d080',
};

export class Renderer {
  ctx: CanvasRenderingContext2D;
  fog: HTMLCanvasElement = document.createElement('canvas');
  world: HTMLCanvasElement = document.createElement('canvas');
  zoom = 1.6;
  fogPad = 80;
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.world.width = MAP_W * TILE; this.world.height = MAP_H * TILE;
    this.paintWorld();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(innerWidth * dpr); this.canvas.height = Math.floor(innerHeight * dpr);
    this.canvas.style.width = innerWidth + 'px'; this.canvas.style.height = innerHeight + 'px';
    this.fog.width = this.canvas.width + 2 * this.fogPad; this.fog.height = this.canvas.height + 2 * this.fogPad;
    this.zoom = Math.max(1.1, Math.min(2.6, this.canvas.width / (24 * TILE)));
  }

  /** static layer: floors, walls, furniture */
  private paintWorld() {
    const c = this.world.getContext('2d')!;
    c.fillStyle = '#15121c'; c.fillRect(0, 0, this.world.width, this.world.height);
    for (const r of ROOMS) {
      for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
        c.fillStyle = (tx + ty) % 2 ? r.floor : r.floorAlt;
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    // walls
    for (let ty = 0; ty < MAP_H; ty++) for (let tx = 0; tx < MAP_W; tx++) {
      if (!isWall(tx, ty)) continue;
      c.fillStyle = '#2b2436'; c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      c.fillStyle = '#3a3148'; c.fillRect(tx * TILE, ty * TILE, TILE, 6);
    }
    // furniture
    for (const f of FURNITURE) {
      const x = f.x * TILE, y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(x + 3, y + 5, w, h);
      c.fillStyle = FURN_COLORS[f.kind];
      roundRect(c, x + 2, y + 2, w - 4, h - 4, 6); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(x + 4, y + 4, w - 8, 4);
      switch (f.kind) {
        case 'bed':
          c.fillStyle = '#e8e4f0'; roundRect(c, x + 6, y + 6, w - 12, 18, 6); c.fill();
          c.fillStyle = '#5a4a7a'; c.fillRect(x + 4, y + 28, w - 8, h - 34); break;
        case 'couch':
          c.fillStyle = '#935f45'; c.fillRect(x + 4, y + 4, w - 8, 10);
          for (let i = 0; i < f.w; i++) { c.fillStyle = '#a06a4c'; roundRect(c, x + i * TILE + 6, y + 14, TILE - 12, 12, 4); c.fill(); }
          break;
        case 'tv': c.fillStyle = '#334'; c.fillRect(x + 6, y + 8, w - 12, h - 16); break;
        case 'fridge': c.fillStyle = '#bbb'; c.fillRect(x + 6, y + 14, w - 12, 2); break;
        case 'toilet': c.fillStyle = '#cfd6da'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2 + 4, 9, 0, Math.PI * 2); c.fill(); break;
        case 'tub': c.fillStyle = '#b8d8e8'; roundRect(c, x + 8, y + 8, w - 16, h - 16, 8); c.fill(); break;
        case 'plant': c.fillStyle = '#4a9a4a'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2 - 4, 11, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#8a5a3a'; c.fillRect(x + 10, y + 20, 12, 9); break;
        case 'catbed': c.fillStyle = '#d87a8a'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2, 11, 0, Math.PI * 2); c.fill();
          c.fillStyle = '#f0d0d8'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2, 7, 0, Math.PI * 2); c.fill(); break;
        case 'litter': c.fillStyle = '#c8bca0'; c.fillRect(x + 6, y + 8, w - 12, h - 14); break;
        case 'lamp': c.fillStyle = '#fff6c0'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2, 8, 0, Math.PI * 2); c.fill(); break;
        case 'washer': case 'dryer': c.fillStyle = '#5a6a7a'; c.beginPath(); c.arc(x + TILE / 2, y + TILE / 2 + 2, 9, 0, Math.PI * 2); c.fill(); break;
        case 'desk': c.fillStyle = '#222'; c.fillRect(x + 8, y + 6, 26, 16); c.fillStyle = '#6cf'; c.fillRect(x + 10, y + 8, 22, 12); break;
        case 'shelf': c.fillStyle = '#c0504a'; c.fillRect(x + 6, y + 8, 6, 14); c.fillStyle = '#4a70c0'; c.fillRect(x + 14, y + 6, 6, 16); c.fillStyle = '#d8b040'; c.fillRect(x + 22, y + 10, 5, 12); break;
      }
    }
    // room labels
    c.font = 'bold 12px system-ui, sans-serif'; c.fillStyle = 'rgba(255,255,255,0.18)'; c.textAlign = 'left';
    for (const r of ROOMS) c.fillText(r.name.toUpperCase(), r.x * TILE + 6, r.y * TILE + 16 + (r.name === 'Hallway' ? 0 : 0));
  }

  draw(snap: Snapshot | null, v: LocalView, overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    const ctx = this.ctx, W = this.canvas.width, H = this.canvas.height, z = this.zoom;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0912'; ctx.fillRect(0, 0, W, H);
    // camera
    const camX = v.x * TILE - W / z / 2;
    const camY = v.y * TILE - H / z / 2;
    const toScreen = (wx: number, wy: number) => [(wx * TILE - camX) * z, (wy * TILE - camY) * z] as const;

    ctx.save(); ctx.scale(z, z); ctx.translate(-camX, -camY);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.world, 0, 0);
    ctx.restore(); ctx.imageSmoothingEnabled = true;

    // visibility
    const vis = new Map<string, number>();
    const R = VISION_TILES;
    const px = Math.floor(v.x), py = Math.floor(v.y);
    for (let ty = py - Math.ceil(R); ty <= py + Math.ceil(R); ty++) for (let tx = px - Math.ceil(R); tx <= px + Math.ceil(R); tx++) {
      const d = Math.hypot(tx + 0.5 - v.x, ty + 0.5 - v.y);
      if (d > R) continue;
      if (!hasLOS(v.x, v.y, tx + 0.5, ty + 0.5)) continue;
      const a = d < R - 1.6 ? 1 : Math.max(0, (R - d) / 1.6);
      vis.set(tx + ',' + ty, a);
    }
    const seen = (wx: number, wy: number) => vis.get(Math.floor(wx) + ',' + Math.floor(wy)) ?? 0;

    if (snap) {
      const z32 = TILE * z;
      // objects
      for (const o of snap.objects) {
        if (seen(o.x, o.y) <= 0.02) continue;
        const [sx, sy] = toScreen(o.x, o.y);
        this.drawObject(ctx, o.kind, o.done, sx, sy, z32, v.now, snap.ventOccupant !== null && o.kind === 'vent');
      }
      if (snap.mouse.visible && seen(snap.mouse.x, snap.mouse.y) > 0.02) {
        const [sx, sy] = toScreen(snap.mouse.x, snap.mouse.y);
        ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.ellipse(sx, sy, 7 * z, 4.5 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d88'; ctx.lineWidth = 1.5 * z; ctx.beginPath(); ctx.moveTo(sx - 6 * z, sy); ctx.lineTo(sx - 14 * z, sy + 3 * z); ctx.stroke();
      }
      // human
      const h = snap.human;
      if (h.phase === 'asleep' || h.phase === 'stirring') {
        if (seen(h.x, h.y) > 0.02) { const [sx, sy] = toScreen(h.x, h.y - 0.6); drawHuman(ctx, sx, sy, z32, 'down', v.now, false); }
      } else if (seen(h.x, h.y) > 0.02) {
        const [sx, sy] = toScreen(h.x, h.y);
        // flashlight glow
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, 3.2 * z32);
        g.addColorStop(0, 'rgba(255,240,180,0.25)'); g.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, 3.2 * z32, 0, Math.PI * 2); ctx.fill();
        drawHuman(ctx, sx, sy, z32, h.dir, v.now * 4, true);
      }
      // other cats, sorted by y
      const others = snap.players.filter(p => p.id !== v.me?.id).sort((a, b) => a.y - b.y);
      for (const p of others) {
        const o = v.others.get(p.id);
        const ox = o?.x ?? p.x, oy = o?.y ?? p.y;
        const a = seen(ox, oy);
        if (a <= 0.02) continue;
        const [sx, sy] = toScreen(ox, oy);
        drawCat(ctx, p.cat, sx, sy, z32, o?.dir ?? p.dir, o?.phase ?? 0, { stunned: snap.time < p.stunnedUntil, carrying: p.carryingMouse });
        ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = `${11 * z}px system-ui, sans-serif`; ctx.textAlign = 'center';
        ctx.fillText(p.name, sx, sy - 22 * z);
        if (p.busy) ctx.fillText('…', sx, sy - 34 * z);
      }
    }
    // local cat
    if (v.me) {
      const [sx, sy] = toScreen(v.x, v.y);
      drawCat(ctx, v.me.cat, sx, sy, TILE * z, v.dir, v.walkPhase, { stunned: snap ? snap.time < v.me.stunnedUntil : false, carrying: v.me.carryingMouse });
    }

    // fog
    const fc = this.fog.getContext('2d')!;
    const pad = this.fogPad;
    fc.setTransform(1, 0, 0, 1, pad, pad);
    fc.globalCompositeOperation = 'source-over';
    fc.fillStyle = 'rgba(3,2,10,0.94)'; fc.fillRect(-pad, -pad, W + 2 * pad, H + 2 * pad);
    fc.globalCompositeOperation = 'destination-out';
    for (const [k, a] of vis) {
      const [tx, ty] = k.split(',').map(Number);
      const [sx, sy] = toScreen(tx, ty);
      fc.fillStyle = `rgba(0,0,0,${a})`;
      fc.fillRect(sx - 1, sy - 1, TILE * z + 2, TILE * z + 2);
    }
    ctx.save();
    try { ctx.filter = `blur(${Math.round(7 * z)}px)`; } catch { /* no filter support */ }
    ctx.drawImage(this.fog, -pad, -pad);
    ctx.restore();

    // footsteps indicator when human is up but unseen
    if (snap && (snap.human.phase === 'patrol' || snap.human.phase === 'returning') && seen(snap.human.x, snap.human.y) <= 0.02) {
      const d = Math.hypot(snap.human.x - v.x, snap.human.y - v.y);
      if (d < 12) {
        const ang = Math.atan2(snap.human.y - v.y, snap.human.x - v.x);
        const cx = W / 2 + Math.cos(ang) * Math.min(W, H) * 0.32, cy = H / 2 + Math.sin(ang) * Math.min(W, H) * 0.32;
        const pulse = 0.5 + 0.5 * Math.sin(v.now * 8);
        ctx.fillStyle = `rgba(255,120,120,${0.35 + 0.5 * pulse})`;
        ctx.font = `${22 * z}px serif`; ctx.textAlign = 'center'; ctx.fillText('👣', cx, cy);
        ctx.font = `bold ${11 * z}px system-ui, sans-serif`; ctx.fillText(d < 5 ? 'FOOTSTEPS. CLOSE.' : 'footsteps…', cx, cy + 16 * z);
      }
    }

    if (snap) this.hud(ctx, snap, v, W, H);
    overlay?.(ctx, W, H);
  }

  private drawObject(ctx: CanvasRenderingContext2D, kind: string, done: boolean, sx: number, sy: number, z32: number, now: number, ventBusy: boolean) {
    const s = z32 / 32;
    switch (kind) {
      case 'knock':
        if (done) { ctx.fillStyle = 'rgba(200,220,255,0.5)'; for (let i = 0; i < 4; i++) ctx.fillRect(sx - 8 * s + i * 5 * s, sy + 14 * s + (i % 2) * 3 * s, 3 * s, 3 * s); }
        else { ctx.fillStyle = '#dfe8ff'; roundRect(ctx, sx - 5 * s, sy - 9 * s, 10 * s, 14 * s, 3 * s); ctx.fill(); ctx.fillStyle = '#8ab'; ctx.fillRect(sx - 4 * s, sy - 2 * s, 8 * s, 6 * s); }
        break;
      case 'cabinet':
        ctx.fillStyle = done ? '#3a2a1a' : '#9a6a3a'; roundRect(ctx, sx - 12 * s, sy - 12 * s, 24 * s, 24 * s, 3 * s); ctx.fill();
        ctx.fillStyle = '#f4c95d'; ctx.fillRect(sx - 2 * s, sy - 2 * s, 4 * s, 4 * s);
        if (done) { ctx.font = `${12 * s}px serif`; ctx.textAlign = 'center'; ctx.fillText('🍗', sx, sy + 4 * s); }
        break;
      case 'rug':
        ctx.fillStyle = 'rgba(180,60,70,0.85)'; roundRect(ctx, sx - 30 * s, sy - 18 * s, 60 * s, 36 * s, 6 * s); ctx.fill();
        ctx.strokeStyle = 'rgba(255,220,150,0.6)'; ctx.lineWidth = 2 * s; roundRect(ctx, sx - 24 * s, sy - 12 * s, 48 * s, 24 * s, 4 * s); ctx.stroke();
        break;
      case 'tp':
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(sx, sy, 8 * s, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ccc'; ctx.beginPath(); ctx.arc(sx, sy, 3 * s, 0, Math.PI * 2); ctx.fill();
        if (done) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 5 * s; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 20 * s, sy + 30 * s); ctx.lineTo(sx + 60 * s, sy + 45 * s); ctx.stroke(); }
        break;
      case 'window':
        ctx.fillStyle = '#1a2a4a'; ctx.fillRect(sx - 14 * s, sy - 14 * s, 28 * s, 24 * s);
        ctx.fillStyle = '#f2d14f'; ctx.beginPath(); ctx.arc(sx - 4 * s, sy - 2 * s, 2 * s, 0, Math.PI * 2); ctx.arc(sx + 4 * s, sy - 2 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2 * s; ctx.strokeRect(sx - 14 * s, sy - 14 * s, 28 * s, 24 * s);
        break;
      case 'vent': {
        ctx.fillStyle = '#555'; roundRect(ctx, sx - 13 * s, sy - 9 * s, 26 * s, 18 * s, 3 * s); ctx.fill();
        ctx.fillStyle = '#222'; for (let i = 0; i < 4; i++) ctx.fillRect(sx - 10 * s, sy - 6 * s + i * 4 * s, 20 * s, 2 * s);
        const heat = 0.3 + 0.2 * Math.sin(now * 3);
        ctx.fillStyle = `rgba(255,170,80,${ventBusy ? 0.15 : heat})`; ctx.beginPath(); ctx.arc(sx, sy, 18 * s, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'zoomies':
        ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.font = `${14 * s}px serif`; ctx.textAlign = 'center'; ctx.fillText('💨', sx, sy + 5 * s);
        break;
      case 'pillow': break;
      case 'mouse': break;
    }
  }

  private hud(ctx: CanvasRenderingContext2D, snap: Snapshot, v: LocalView, W: number, H: number) {
    const z = Math.max(1, Math.min(2, W / 1100));
    ctx.textAlign = 'left';
    // top bar
    ctx.fillStyle = 'rgba(8,6,16,0.75)'; roundRect(ctx, 14 * z, 14 * z, 330 * z, 92 * z, 12 * z); ctx.fill();
    const mm = Math.floor(snap.timeLeft / 60), ss = Math.floor(snap.timeLeft % 60).toString().padStart(2, '0');
    ctx.fillStyle = '#fff'; ctx.font = `bold ${26 * z}px system-ui, sans-serif`; ctx.fillText(`${mm}:${ss}`, 28 * z, 48 * z);
    ctx.fillStyle = '#f4c95d'; ctx.font = `bold ${18 * z}px system-ui, sans-serif`; ctx.fillText(`CHAOS ${snap.chaos}`, 130 * z, 46 * z);
    // suspicion
    ctx.fillStyle = '#bbb'; ctx.font = `${12 * z}px system-ui, sans-serif`; ctx.fillText('HUMAN SUSPICION', 28 * z, 70 * z);
    ctx.fillStyle = '#333'; roundRect(ctx, 28 * z, 78 * z, 300 * z, 14 * z, 6 * z); ctx.fill();
    const sus = snap.suspicion / 100;
    ctx.fillStyle = sus > 0.6 ? '#ff5e5e' : sus > 0.35 ? '#ffb347' : '#8be28b';
    roundRect(ctx, 28 * z, 78 * z, 300 * z * sus, 14 * z, 6 * z); ctx.fill();
    for (const th of [0.35, 0.6]) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(28 * z + 300 * z * th, 76 * z, 2 * z, 18 * z); }
    const hp = snap.human.phase;
    ctx.fillStyle = hp === 'asleep' ? '#8be28b' : hp === 'stirring' ? '#ffb347' : '#ff5e5e'; ctx.font = `bold ${12 * z}px system-ui, sans-serif`;
    ctx.textAlign = 'right'; ctx.fillText(hp === 'asleep' ? 'zzz' : hp === 'stirring' ? 'STIRRING' : 'AWAKE', 330 * z, 70 * z);

    // objectives (right)
    const ow = 300 * z, ox = W - ow - 14 * z;
    const oh = (34 + snap.objectives.length * 22) * z;
    ctx.fillStyle = 'rgba(8,6,16,0.75)'; roundRect(ctx, ox, 14 * z, ow, oh, 12 * z); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = '#f4c95d'; ctx.font = `bold ${13 * z}px system-ui, sans-serif`; ctx.fillText('TONIGHT\'S OBJECTIVES', ox + 14 * z, 36 * z);
    ctx.font = `${13 * z}px system-ui, sans-serif`;
    snap.objectives.forEach((o, i) => {
      ctx.fillStyle = o.done ? '#8be28b' : '#eee';
      const prog = o.target > 1 ? ` (${Math.floor(o.progress)}/${o.target})` : '';
      ctx.fillText(`${o.done ? '☑' : '☐'} ${o.text}${prog}`, ox + 14 * z, (58 + i * 22) * z);
    });
    // my stats under objectives
    if (v.me) {
      const me = snap.players.find(p => p.id === v.me!.id);
      if (me) {
        ctx.fillStyle = 'rgba(8,6,16,0.6)'; roundRect(ctx, ox, 14 * z + oh + 8 * z, ow, 26 * z, 8 * z); ctx.fill();
        ctx.fillStyle = '#ccc'; ctx.font = `${12 * z}px system-ui, sans-serif`;
        ctx.fillText(`${me.name} · chaos ${me.chaos} · dominance ${me.dominance}${me.carryingMouse ? ' · 🐭 carrying mouse' : ''}`, ox + 14 * z, 14 * z + oh + 26 * z);
      }
    }

    // log (bottom left)
    ctx.font = `${13 * z}px system-ui, sans-serif`;
    const recent = snap.log.slice(-5);
    recent.forEach((e, i) => {
      const age = snap.time - e.t;
      const alpha = Math.max(0, Math.min(1, 1 - (age - 8) / 4));
      if (alpha <= 0) return;
      ctx.fillStyle = `rgba(8,6,16,${0.7 * alpha})`;
      const tw = ctx.measureText(e.text).width + 20 * z;
      roundRect(ctx, 14 * z, H - (30 + (recent.length - 1 - i) * 24) * z, tw, 20 * z, 6 * z); ctx.fill();
      ctx.fillStyle = { info: `rgba(230,230,230,${alpha})`, good: `rgba(139,226,139,${alpha})`, bad: `rgba(255,123,123,${alpha})`, dom: `rgba(244,201,93,${alpha})` }[e.kind];
      ctx.fillText(e.text, 24 * z, H - (16 + (recent.length - 1 - i) * 24) * z);
    });

    // prompt
    if (v.prompt) {
      ctx.font = `bold ${15 * z}px system-ui, sans-serif`; ctx.textAlign = 'center';
      const tw = ctx.measureText(v.prompt).width + 28 * z;
      ctx.fillStyle = 'rgba(8,6,16,0.85)'; roundRect(ctx, W / 2 - tw / 2, H - 70 * z, tw, 30 * z, 8 * z); ctx.fill();
      ctx.fillStyle = '#f4c95d'; ctx.fillText(v.prompt, W / 2, H - 49 * z);
    }
    // toasts
    v.toasts.forEach((t, i) => {
      const a = Math.min(1, (t.until - v.now) / 0.5);
      ctx.font = `bold ${18 * z}px system-ui, sans-serif`; ctx.textAlign = 'center';
      const tw = ctx.measureText(t.text).width + 32 * z;
      ctx.fillStyle = `rgba(8,6,16,${0.9 * a})`; roundRect(ctx, W / 2 - tw / 2, (120 + i * 40) * z, tw, 34 * z, 8 * z); ctx.fill();
      ctx.fillStyle = t.kind === 'bad' ? `rgba(255,123,123,${a})` : t.kind === 'dom' ? `rgba(244,201,93,${a})` : `rgba(255,255,255,${a})`;
      ctx.fillText(t.text, W / 2, (143 + i * 40) * z);
    });
    // stunned overlay
    if (v.me && snap.time < v.me.stunnedUntil) {
      ctx.fillStyle = 'rgba(80,140,255,0.12)'; ctx.fillRect(0, 0, W, H);
    }
  }
}
