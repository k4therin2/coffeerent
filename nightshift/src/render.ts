import { TILE, VISION_TILES, type Snapshot, type PlayerState, type Dir, type Decal } from './types';
import { M, mapW, mapH, isWall, hasLOS, type Furniture } from './map';
import { drawCat, drawHuman } from './cats';
import { roundRect } from './minigames';

export interface LocalView {
  me: PlayerState | null;      // local player (authoritative pos)
  x: number; y: number;        // local pos
  dir: Dir; moving: boolean; walkPhase: number;
  others: Map<string, { x: number; y: number; dir: Dir; moving: boolean; phase: number }>;
  prompt: string | null;
  touch: boolean;
  toasts: { text: string; kind: string; until: number }[];
  now: number;
}

const FURN_COLORS: Record<Furniture['kind'], string> = {
  couch: '#7a4f3a', table: '#8a6a44', counter: '#b9b2a4', fridge: '#d8dde0', bed: '#6b5a8a', nightstand: '#7a5a3a',
  toilet: '#e8ecee', tub: '#dfe6ea', washer: '#cfd6da', dryer: '#c4ccd0', desk: '#5a4a3a', chair: '#333a44',
  shelf: '#6a4a30', plant: '#2f7a3a', litter: '#9a8d78', catbed: '#b04a5a', tv: '#1a1a22', lamp: '#f0d080',
};

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
  return text.slice(0, lo).trimEnd() + '…';
}

export class Renderer {
  ctx: CanvasRenderingContext2D;
  fog: HTMLCanvasElement = document.createElement('canvas');
  world: HTMLCanvasElement = document.createElement('canvas');
  zoom = 1.6;
  fogPad = 80;
  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.paintWorld();
  }
  private paintedFor = '';
  /** repaint the static layer if the active map changed */
  ensureMap() { if (this.paintedFor !== M.id) this.paintWorld(); }

  dpr = 1;
  /** UI scale in device pixels: keeps HUD text readable on phones */
  ui = 1;
  narrow = false;
  resize() {
    const dpr = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = innerWidth, ch = innerHeight;
    this.canvas.width = Math.floor(cw * dpr); this.canvas.height = Math.floor(ch * dpr);
    this.canvas.style.width = cw + 'px'; this.canvas.style.height = ch + 'px';
    this.fog.width = this.canvas.width + 2 * this.fogPad; this.fog.height = this.canvas.height + 2 * this.fogPad;
    // about 14 tiles across the short side, so the vision circle fills a phone screen
    this.zoom = dpr * Math.max(0.9, Math.min(2.2, Math.min(cw, ch) / (14 * TILE)));
    this.ui = dpr * Math.max(0.8, Math.min(1.25, cw / 1100));
    this.narrow = cw < 700;
  }

  /** static layer: floors, walls, furniture */
  private paintWorld() {
    this.paintedFor = M.id;
    this.world.width = mapW() * TILE; this.world.height = mapH() * TILE;
    const c = this.world.getContext('2d')!;
    c.fillStyle = '#15121c'; c.fillRect(0, 0, this.world.width, this.world.height);
    for (const r of M.rooms) {
      for (let ty = r.y; ty < r.y + r.h; ty++) for (let tx = r.x; tx < r.x + r.w; tx++) {
        c.fillStyle = (tx + ty) % 2 ? r.floor : r.floorAlt;
        c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
    // walls
    for (let ty = 0; ty < mapH(); ty++) for (let tx = 0; tx < mapW(); tx++) {
      if (!isWall(tx, ty)) continue;
      c.fillStyle = '#2b2436'; c.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      c.fillStyle = '#3a3148'; c.fillRect(tx * TILE, ty * TILE, TILE, 6);
    }
    // furniture
    for (const f of M.furniture) {
      const x = f.x * TILE, y = f.y * TILE, w = f.w * TILE, h = f.h * TILE;
      c.fillStyle = f.tall ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)'; c.fillRect(x + (f.tall ? 5 : 3), y + (f.tall ? 8 : 5), w, h);
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
    for (const r of M.rooms) c.fillText(r.name.toUpperCase(), r.x * TILE + 6, r.y * TILE + 16 + (r.name === 'Hallway' ? 0 : 0));
  }

  draw(snap: Snapshot | null, v: LocalView, overlay?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) {
    this.ensureMap();
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
      // persistent mess
      for (const dc of snap.decals) {
        if (seen(dc.x, dc.y) <= 0.02) continue;
        const [sx, sy] = toScreen(dc.x, dc.y);
        this.drawDecal(ctx, dc, sx, sy, z32);
      }
      if (snap.snack.visible && seen(snap.snack.x, snap.snack.y) > 0.02) {
        const [sx, sy] = toScreen(snap.snack.x, snap.snack.y);
        ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.ellipse(sx, sy, 11 * z, 7 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d9a441'; ctx.beginPath(); ctx.ellipse(sx - 3 * z, sy - 1 * z, 5 * z, 3.5 * z, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c0504a'; ctx.beginPath(); ctx.arc(sx + 4 * z, sy, 3 * z, 0, Math.PI * 2); ctx.fill();
      }
      if (snap.mouse.visible && seen(snap.mouse.x, snap.mouse.y) > 0.02) {
        const [sx, sy] = toScreen(snap.mouse.x, snap.mouse.y);
        ctx.fillStyle = '#9a9a9a'; ctx.beginPath(); ctx.ellipse(sx, sy, 7 * z, 4.5 * z, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#d88'; ctx.lineWidth = 1.5 * z; ctx.beginPath(); ctx.moveTo(sx - 6 * z, sy); ctx.lineTo(sx - 14 * z, sy + 3 * z); ctx.stroke();
      }
      // human
      const h = snap.human;
      if (h.phase === 'asleep' || h.phase === 'stirring') {
        if (seen(h.x, h.y) > 0.02) { const [sx, sy] = toScreen(h.x, h.y); drawHuman(ctx, sx, sy, z32, "down", v.now, false); }
      } else if (seen(h.x, h.y) > 0.02) {
        const [sx, sy] = toScreen(h.x, h.y);
        // flashlight glow (red and wider when the lights are on and the human is hunting)
        const hunting = h.phase === 'hunt';
        const r = (hunting ? 4.5 : 3.2) * z32;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, hunting ? 'rgba(255,120,100,0.3)' : 'rgba(255,240,180,0.25)'); g.addColorStop(1, 'rgba(255,240,180,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
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
    if (snap && snap.human.phase === 'hunt') { ctx.fillStyle = `rgba(255,80,60,${0.06 + 0.05 * Math.sin(v.now * 6)})`; ctx.fillRect(0, 0, W, H); }
    if (snap && (snap.human.phase === 'patrol' || snap.human.phase === 'hunt') && seen(snap.human.x, snap.human.y) <= 0.02) {
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

  private drawDecal(ctx: CanvasRenderingContext2D, dc: Decal, sx: number, sy: number, z32: number) {
    const s = z32 / 32, r = dc.r * z32;
    const rng = (k: number) => { const v = Math.sin(dc.seed * 12.9898 + k * 78.233) * 43758.5453; return v - Math.floor(v); };
    switch (dc.kind) {
      case 'hairball':
        ctx.fillStyle = '#5a4030'; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.6, rng(1) * Math.PI, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#8a6a50'; ctx.lineWidth = 1.2 * s;
        for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.moveTo(sx + (rng(i) - 0.5) * r, sy + (rng(i + 9) - 0.5) * r * 0.6); ctx.lineTo(sx + (rng(i + 3) - 0.5) * r * 2.2, sy + (rng(i + 7) - 0.5) * r * 1.4); ctx.stroke(); }
        break;
      case 'puddle':
        ctx.fillStyle = 'rgba(160,140,90,0.55)'; ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.3, r * 0.8, rng(2) * Math.PI, 0, Math.PI * 2); ctx.fill();
        break;
      case 'present':
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(sx + 1 * s, sy + 3 * s, r, r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#5b3a1e';
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(sx, sy - i * 3.5 * s, r * (1 - i * 0.25), r * (0.55 - i * 0.1), 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#7a5230'; ctx.beginPath(); ctx.arc(sx - 2 * s, sy - 9 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(180,220,120,0.5)'; ctx.lineWidth = 1 * s;
        for (let i = 0; i < 3; i++) { const ox = (i - 1) * 5 * s; ctx.beginPath(); ctx.moveTo(sx + ox, sy - 12 * s); ctx.quadraticCurveTo(sx + ox + 3 * s, sy - 16 * s, sx + ox, sy - 20 * s); ctx.stroke(); }
        break;
      case 'crumbs':
        ctx.fillStyle = '#d9a441';
        for (let i = 0; i < 14; i++) { ctx.beginPath(); ctx.arc(sx + (rng(i) - 0.5) * r * 2.4, sy + (rng(i + 20) - 0.5) * r * 1.6, (0.8 + rng(i + 40)) * 1.3 * s, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.ellipse(sx, sy, 10 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'shards':
        ctx.fillStyle = 'rgba(200,225,255,0.75)';
        for (let i = 0; i < 7; i++) { const ax = sx + (rng(i) - 0.5) * r * 2.6, ay = sy + (rng(i + 11) - 0.5) * r * 1.4; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + 4 * s, ay + 2 * s); ctx.lineTo(ax + 1 * s, ay + 5 * s); ctx.fill(); }
        break;
      case 'pawprints':
        ctx.fillStyle = 'rgba(60,40,30,0.45)';
        for (let i = 0; i < 2; i++) { const ax = sx + (i - 0.5) * 7 * s, ay = sy + (rng(i) - 0.5) * 6 * s; ctx.beginPath(); ctx.ellipse(ax, ay, 2.6 * s, 3.2 * s, 0, 0, Math.PI * 2); ctx.fill(); for (let t = 0; t < 3; t++) { ctx.beginPath(); ctx.arc(ax + (t - 1) * 2.4 * s, ay - 4 * s, 1.1 * s, 0, Math.PI * 2); ctx.fill(); } }
        break;
    }
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
      case 'drawer':
        ctx.fillStyle = '#5a3a1e'; roundRect(ctx, sx - 11 * s, sy - 5 * s, 22 * s, 10 * s, 2 * s); ctx.fill();
        if (done) { ctx.fillStyle = '#3a2410'; ctx.fillRect(sx - 10 * s, sy + 5 * s, 20 * s, 9 * s); ctx.fillStyle = '#c0a060'; ctx.fillRect(sx - 7 * s, sy + 7 * s, 5 * s, 4 * s); ctx.fillStyle = '#8ab'; ctx.fillRect(sx + 1 * s, sy + 8 * s, 6 * s, 3 * s); }
        ctx.fillStyle = '#f4c95d'; ctx.fillRect(sx - 3 * s, sy - 1 * s, 6 * s, 2 * s);
        break;
      case 'pillow': break;
      case 'mouse': break;
      case 'snack': break;
    }
  }

  private hud(ctx: CanvasRenderingContext2D, snap: Snapshot, v: LocalView, W: number, H: number) {
    const z = this.ui;
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
    ctx.textAlign = 'right'; ctx.fillText(hp === 'asleep' ? 'zzz' : hp === 'stirring' ? 'STIRRING' : hp === 'hunt' ? 'LIGHTS ON' : 'AWAKE', 330 * z, 70 * z);
    if (snap.busts > 0 && hp !== 'hunt') { ctx.fillStyle = '#ff7b7b'; ctx.font = `bold ${11 * z}px system-ui, sans-serif`; ctx.fillText('one more bust ends the shift', 330 * z, 104 * z); }

    // objectives (right on wide screens, under the top bar on phones)
    const ow = this.narrow ? Math.min(340 * z, W - 28 * z) : 360 * z;
    const ox = this.narrow ? 14 * z : W - ow - 14 * z;
    const oy = this.narrow ? 114 * z : 14 * z;
    const lineH = this.narrow ? 19 : 22;
    const oh = (34 + snap.objectives.length * lineH) * z;
    ctx.fillStyle = 'rgba(8,6,16,0.75)'; roundRect(ctx, ox, oy, ow, oh, 12 * z); ctx.fill();
    ctx.textAlign = 'left'; ctx.fillStyle = '#f4c95d'; ctx.font = `bold ${12 * z}px system-ui, sans-serif`; ctx.fillText(snap.board > 1 ? `OBJECTIVES · BOARD ${snap.board}` : 'TONIGHT\'S OBJECTIVES', ox + 14 * z, oy + 22 * z);
    ctx.font = `${this.narrow ? 12 : 13}px system-ui, sans-serif`.replace(/^(\d+)px/, (_, n) => `${Number(n) * z}px`);
    snap.objectives.forEach((o, i) => {
      ctx.fillStyle = o.done ? '#8be28b' : '#eee';
      const prog = o.target > 1 ? ` (${Math.floor(o.progress)}/${o.target})` : '';
      ctx.fillText(fitText(ctx, `${o.done ? '☑' : '☐'} ${o.text}${prog}`, ow - 28 * z), ox + 14 * z, oy + (44 + i * lineH) * z);
    });
    // my stats under objectives
    if (v.me) {
      const me = snap.players.find(p => p.id === v.me!.id);
      if (me) {
        ctx.fillStyle = 'rgba(8,6,16,0.6)'; roundRect(ctx, ox, oy + oh + 8 * z, ow, 26 * z, 8 * z); ctx.fill();
        ctx.fillStyle = '#ccc'; ctx.font = `${12 * z}px system-ui, sans-serif`;
        ctx.fillText(`${me.name} · chaos ${me.chaos} · dominance ${me.dominance}${me.carryingMouse ? ' · 🐭 carrying mouse' : ''}`, ox + 14 * z, oy + oh + 26 * z);
      }
    }

    // log (bottom left)
    ctx.font = `${13 * z}px system-ui, sans-serif`;
    const recent = snap.log.slice(v.touch ? -3 : -5);
    const logBase = v.touch ? 290 : 0;
    recent.forEach((e, i) => {
      const age = snap.time - e.t;
      const alpha = Math.max(0, Math.min(1, 1 - (age - 8) / 4));
      if (alpha <= 0) return;
      ctx.fillStyle = `rgba(8,6,16,${0.7 * alpha})`;
      const tw = ctx.measureText(e.text).width + 20 * z;
      roundRect(ctx, 14 * z, H - (logBase + 30 + (recent.length - 1 - i) * 24) * z, Math.min(tw, W - 28 * z), 20 * z, 6 * z); ctx.fill();
      ctx.fillStyle = { info: `rgba(230,230,230,${alpha})`, good: `rgba(139,226,139,${alpha})`, bad: `rgba(255,123,123,${alpha})`, dom: `rgba(244,201,93,${alpha})` }[e.kind];
      ctx.fillText(e.text, 24 * z, H - (logBase + 16 + (recent.length - 1 - i) * 24) * z);
    });

    // key legend (keyboard players)
    if (!v.touch) {
      const items: [string, string][] = [['WASD', 'move'], ['E', 'paw / interact'], ['H', 'how to play']];
      ctx.font = `${11 * z}px system-ui, sans-serif`;
      let total = 0; const widths = items.map(([k, t]) => { const kw = Math.max(26 * z, ctx.measureText(k).width + 12 * z); const tw = ctx.measureText(t).width; total += kw + 6 * z + tw + 16 * z; return [kw, tw]; });
      let x = W - 14 * z - total;
      const y = H - 22 * z;
      ctx.fillStyle = 'rgba(8,6,16,0.7)'; roundRect(ctx, x - 10 * z, y - 16 * z, total + 14 * z, 26 * z, 8 * z); ctx.fill();
      items.forEach(([k, t], i) => {
        const [kw, tw] = widths[i];
        ctx.fillStyle = '#2a2340'; roundRect(ctx, x, y - 12 * z, kw, 18 * z, 4 * z); ctx.fill();
        ctx.strokeStyle = '#6b5f8a'; ctx.lineWidth = 1 * z; roundRect(ctx, x, y - 12 * z, kw, 18 * z, 4 * z); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `bold ${10 * z}px ui-monospace, Menlo, monospace`; ctx.fillText(k, x + kw / 2, y + 1 * z);
        x += kw + 6 * z;
        ctx.fillStyle = '#bbb'; ctx.textAlign = 'left'; ctx.font = `${11 * z}px system-ui, sans-serif`; ctx.fillText(t, x, y + 1 * z);
        x += tw + 16 * z;
      });
      ctx.textAlign = 'left';
    }
    // prompt
    if (v.prompt) {
      const py = v.touch ? H - 150 * z : H - 70 * z;
      ctx.font = `bold ${15 * z}px system-ui, sans-serif`; ctx.textAlign = 'center';
      const tw = Math.min(W - 20 * z, ctx.measureText(v.prompt).width + 28 * z);
      ctx.fillStyle = 'rgba(8,6,16,0.85)'; roundRect(ctx, W / 2 - tw / 2, py, tw, 30 * z, 8 * z); ctx.fill();
      ctx.fillStyle = '#f4c95d'; ctx.fillText(v.prompt, W / 2, py + 21 * z);
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
