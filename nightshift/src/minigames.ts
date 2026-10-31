import type { MinigameSpec } from './types';
import type { Input } from './input';

export interface MgResult { success: boolean; quality: number; timedOut?: boolean }

export abstract class Minigame {
  elapsed = 0;
  result: MgResult | null = null;
  flash = 0; // feedback flash timer
  flashColor = '#fff';
  constructor(public spec: MinigameSpec) {}
  update(dt: number, input: Input) {
    this.elapsed += dt; this.flash = Math.max(0, this.flash - dt);
    if (this.result) return;
    this.step(dt, input);
    if (!this.result && this.elapsed >= this.spec.time) { this.result = this.timeout(); this.result.timedOut = true; }
  }
  protected abstract step(dt: number, input: Input): void;
  protected timeout(): MgResult { return { success: false, quality: 0 }; }
  abstract draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  get timeLeft() { return Math.max(0, this.spec.time - this.elapsed); }
  protected ping(c: string) { this.flash = 0.25; this.flashColor = c; }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** set by main.ts so hints can name the right control */
export const hints = { touch: false };
const K = (kb: string, touch: string) => hints.touch ? touch : kb;

// ---- shared drawing helpers ----
function panel(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, hint: string, timeLeft: number) {
  const pw = Math.min(560, w - 40), ph = 260;
  const x = (w - pw) / 2, y = (h - ph) / 2;
  ctx.fillStyle = 'rgba(10,8,20,0.92)';
  roundRect(ctx, x, y, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = '#f4c95d'; ctx.lineWidth = 2; roundRect(ctx, x, y, pw, ph, 14); ctx.stroke();
  ctx.fillStyle = '#f4c95d'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(title, w / 2, y + 34);
  ctx.fillStyle = '#bbb'; ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(hint, w / 2, y + ph - 18);
  // timer bar
  ctx.fillStyle = '#333'; ctx.fillRect(x + 20, y + 46, pw - 40, 4);
  ctx.fillStyle = '#e66'; ctx.fillRect(x + 20, y + 46, (pw - 40) * Math.max(0, timeLeft), 4);
  return { x, y, pw, ph };
}
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function resultBanner(ctx: CanvasRenderingContext2D, w: number, y: number, r: MgResult | null) {
  if (!r) return;
  ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillStyle = r.success ? '#8be28b' : '#ff7b7b';
  ctx.fillText(r.success ? (r.quality > 0.9 ? 'PURRFECT' : 'NICE') : 'OOPS', w / 2, y);
}

// ---- swipe: timing bar ----
export class Swipe extends Minigame {
  pos = 0; dirn = 1; zone = rnd(0.3, 0.7);
  step(dt: number, input: Input) {
    const sp = Number(this.spec.params.speed);
    this.pos += this.dirn * sp * dt;
    if (this.pos > 1) { this.pos = 1; this.dirn = -1; } if (this.pos < 0) { this.pos = 0; this.dirn = 1; }
    if (input.action) {
      const half = Number(this.spec.params.zone) / 2;
      const d = Math.abs(this.pos - this.zone);
      const ok = d <= half;
      this.result = { success: ok, quality: ok ? 1 - d / half : 0 };
      this.ping(ok ? '#8be28b' : '#ff7b7b');
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this.spec.title, K('SPACE when the paw is in the green. Too hard and it shatters.', 'TAP when the paw is in the green. Too hard and it shatters.'), this.timeLeft / this.spec.time);
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    const half = Number(this.spec.params.zone) / 2;
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (this.zone - half) * bw, by, half * 2 * bw, 26);
    ctx.fillStyle = '#f4c95d'; ctx.fillRect(bx + this.pos * bw - 4, by - 8, 8, 42);
    ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.fillText('🐾', bx + this.pos * bw, by - 14);
    resultBanner(ctx, w, by + 80, this.result);
  }
}

// ---- mash: fill then release ----
export class Mash extends Minigame {
  v = 0;
  step(dt: number, input: Input) {
    this.v = Math.max(0, this.v - 0.35 * dt);
    if (input.was(' ')) this.v = Math.min(1, this.v + 0.09);
    if (input.was('e') || input.was('enter')) this.finish();
  }
  private finish() {
    const t = Number(this.spec.params.target), wd = Number(this.spec.params.width);
    const d = Math.abs(this.v - t);
    const ok = d <= wd / 2;
    this.result = { success: ok, quality: Math.max(0, 1 - d / wd) * (ok ? 1 : 0.6) };
    this.ping(ok ? '#8be28b' : '#ff7b7b');
  }
  protected timeout() { this.finish(); return this.result!; }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const label = String(this.spec.params.label);
    const { x, y, pw } = panel(ctx, w, h, this.spec.title, K(`Mash SPACE to ${label}. Press E to let it go in the green.`, `MASH to ${label}. LET GO while it is in the green.`), this.timeLeft / this.spec.time);
    const bx = x + 40, bw = pw - 80, by = y + 110;
    const t = Number(this.spec.params.target), wd = Number(this.spec.params.width);
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 40, 10); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (t - wd / 2) * bw, by, wd * bw, 40);
    ctx.fillStyle = this.flash > 0 ? this.flashColor : '#e0a060'; ctx.fillRect(bx, by + 6, this.v * bw, 28);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label + (this.v > 0.95 ? '!!!' : this.v > 0.6 ? '!!' : '!'), w / 2, by + 80);
    resultBanner(ctx, w, by + 115, this.result);
  }
}

// ---- pick: sequential pins ----
export class Pick extends Minigame {
  pin = 0; pos = 0; dirn = 1; zone = rnd(0.25, 0.75); total = Number(this.spec.params.pins);
  step(dt: number, input: Input) {
    const sp = Number(this.spec.params.speed) * (1 + this.pin * 0.25);
    this.pos += this.dirn * sp * dt;
    if (this.pos > 1) { this.pos = 1; this.dirn = -1; } if (this.pos < 0) { this.pos = 0; this.dirn = 1; }
    if (input.action) {
      if (Math.abs(this.pos - this.zone) <= 0.1) {
        this.pin++; this.zone = rnd(0.2, 0.8); this.pos = 0; this.dirn = 1; this.ping('#8be28b');
        if (this.pin >= this.total) this.result = { success: true, quality: 1 };
      } else { this.pin = Math.max(0, this.pin - 1); this.ping('#ff7b7b'); }
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this.spec.title, K('SPACE in the green for each latch. A teammate nearby halves the latches.', 'TAP in the green for each latch. A teammate nearby halves the latches.'), this.timeLeft / this.spec.time);
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (this.zone - 0.1) * bw, by, 0.2 * bw, 26);
    ctx.fillStyle = this.flash > 0 ? this.flashColor : '#f4c95d'; ctx.fillRect(bx + this.pos * bw - 4, by - 8, 8, 42);
    for (let i = 0; i < this.total; i++) {
      ctx.fillStyle = i < this.pin ? '#8be28b' : '#555';
      ctx.beginPath(); ctx.arc(w / 2 + (i - (this.total - 1) / 2) * 30, by - 40, 9, 0, Math.PI * 2); ctx.fill();
    }
    resultBanner(ctx, w, by + 80, this.result);
  }
}

// ---- zoomies: arrow sequence ----
const ARROWS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] as const;
const ARROW_GLYPH: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
const WASD: Record<string, string> = { w: 'arrowup', s: 'arrowdown', a: 'arrowleft', d: 'arrowright' };
export class Zoomies extends Minigame {
  seq = Array.from({ length: Number(this.spec.params.count) }, () => ARROWS[Math.floor(Math.random() * 4)]);
  idx = 0; hits = 0;
  step(_dt: number, input: Input) {
    for (const k of input.pressed) {
      const key = WASD[k] ?? k;
      if (!ARROWS.includes(key as any)) continue;
      if (key === this.seq[this.idx]) { this.hits++; this.ping('#8be28b'); } else this.ping('#ff7b7b');
      this.idx++;
      if (this.idx >= this.seq.length) { const q = this.hits / this.seq.length; this.result = { success: q >= 0.5, quality: q }; break; }
    }
  }
  protected timeout() { const q = this.hits / this.seq.length; return { success: q >= 0.5, quality: q }; }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { y, pw } = panel(ctx, w, h, this.spec.title, K('Hit the arrows (or WASD) in order. Fast. Every step wakes the house a little.', 'Tap the arrows in order. Fast. Every step wakes the house a little.'), this.timeLeft / this.spec.time);
    ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'center';
    const start = Math.max(0, this.idx - 1);
    const visible = Math.max(3, Math.floor((pw / 2 - 40) / 56));
    for (let i = start; i < Math.min(this.seq.length, start + visible); i++) {
      const dx = (i - this.idx) * 56;
      ctx.fillStyle = i < this.idx ? '#555' : i === this.idx ? (this.flash > 0 ? this.flashColor : '#f4c95d') : '#ddd';
      ctx.fillText(ARROW_GLYPH[this.seq[i]], w / 2 + dx, y + 140);
    }
    ctx.fillStyle = '#aaa'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${this.hits} / ${this.seq.length}`, w / 2, y + 190);
    resultBanner(ctx, w, y + 225, this.result);
  }
}

// ---- stare: don't touch anything ----
const BAITS = ['PRESS SPACE NOW', '[E] continue', 'press any key', 'QUICK! SPACE!', 'tap W to win', 'DO IT. PRESS IT.'];
export class Stare extends Minigame {
  bait = ''; baitT = 0; nextBait = 0.8;
  step(dt: number, input: Input) {
    if (input.anyPressed) { this.result = { success: false, quality: 0 }; this.ping('#ff7b7b'); return; }
    this.baitT -= dt; this.nextBait -= dt;
    if (this.nextBait <= 0) { this.bait = BAITS[Math.floor(Math.random() * BAITS.length)]; this.baitT = 0.9; this.nextBait = rnd(1.2, 2.2); }
    if (this.elapsed >= Number(this.spec.params.hold)) this.result = { success: true, quality: 1 };
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { y, x, pw } = panel(ctx, w, h, this.spec.title, K('Do NOT press anything. Anything. The neighbor cat is trying to bait you.', 'Do NOT touch the screen. At all. The neighbor cat is trying to bait you.'), this.timeLeft / this.spec.time);
    // eyes
    for (const ex of [-50, 50]) {
      ctx.fillStyle = '#f2d14f'; ctx.beginPath(); ctx.ellipse(w / 2 + ex, y + 120, 34, 22, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.ellipse(w / 2 + ex, y + 120, 6 + Math.sin(this.elapsed * 3) * 2, 20, 0, 0, Math.PI * 2); ctx.fill();
    }
    const held = Math.min(1, this.elapsed / Number(this.spec.params.hold));
    ctx.fillStyle = '#444'; ctx.fillRect(x + 40, y + 165, pw - 80, 10);
    ctx.fillStyle = '#8be28b'; ctx.fillRect(x + 40, y + 165, (pw - 80) * held, 10);
    if (this.baitT > 0 && !this.result) {
      ctx.fillStyle = '#ff7b7b'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(this.bait, w / 2 + rnd(-2, 2), y + 205 + rnd(-2, 2));
    }
    resultBanner(ctx, w, y + 212, this.result);
  }
}

// ---- rhythm: licker ----
export class Rhythm extends Minigame {
  beats = Number(this.spec.params.beats); period = 60 / Number(this.spec.params.bpm); lead = 1.0;
  hits = 0; judged = new Set<number>(); misses = 0;
  step(_dt: number, input: Input) {
    const t = this.elapsed - this.lead;
    if (input.was(' ') || input.was('e')) {
      const n = Math.round(t / this.period);
      if (n >= 0 && n < this.beats && !this.judged.has(n) && Math.abs(t - n * this.period) < 0.13) { this.judged.add(n); this.hits++; this.ping('#8be28b'); }
      else { this.misses++; this.ping('#ff7b7b'); }
    }
    if (t > (this.beats - 1) * this.period + 0.3) { const q = this.hits / this.beats; this.result = { success: q >= 0.7, quality: q }; }
  }
  protected timeout() { const q = this.hits / this.beats; return { success: q >= 0.7, quality: q }; }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this.spec.title, K('SPACE on each beat as it crosses the line. Lick lick lick.', 'TAP on each beat as it crosses the line. Lick lick lick.'), this.timeLeft / this.spec.time);
    const lineX = x + 80, by = y + 125, speed = 120;
    const t = this.elapsed - this.lead;
    ctx.fillStyle = '#333'; ctx.fillRect(x + 30, by - 2, pw - 60, 4);
    ctx.fillStyle = this.flash > 0 ? this.flashColor : '#f4c95d'; ctx.fillRect(lineX - 3, by - 30, 6, 60);
    for (let n = 0; n < this.beats; n++) {
      const bx = lineX + (n * this.period - t) * speed;
      if (bx < x + 20 || bx > x + pw - 20) continue;
      ctx.fillStyle = this.judged.has(n) ? '#8be28b' : '#e9a0a8';
      ctx.beginPath(); ctx.arc(bx, by, 12, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#aaa'; ctx.font = '16px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${this.hits} / ${this.beats} licks landed`, w / 2, by + 60);
    resultBanner(ctx, w, by + 95, this.result);
  }
}

// ---- balance: lickee ----
export class Balance extends Minigame {
  pos = 0; vel = 0; inZone = 0; sampled = 0;
  step(dt: number, input: Input) {
    const drift = Number(this.spec.params.drift);
    this.vel += (Math.random() - 0.5) * drift * dt * 6 + Math.sign(this.pos) * drift * dt * 0.8;
    const push = Math.sign(input.dirX);
    this.vel += push * 2.2 * dt;
    this.vel *= 0.985;
    this.pos += this.vel * dt * 2;
    if (Math.abs(this.pos) > 1) { this.pos = Math.sign(this.pos); this.vel = 0; }
    this.sampled += dt; if (Math.abs(this.pos) < 0.28) this.inZone += dt;
    if (this.elapsed >= this.spec.time - 0.05) { const q = this.inZone / Math.max(0.01, this.sampled); this.result = { success: q >= 0.6, quality: q }; }
  }
  protected timeout() { const q = this.inZone / Math.max(0.01, this.sampled); return { success: q >= 0.6, quality: q }; }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this.spec.title, K('A / D to keep your head in the green. Do not squirm.', 'Hold ◀ ▶ to keep your head in the green. Do not squirm.'), this.timeLeft / this.spec.time);
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + bw * (0.5 - 0.14), by, bw * 0.28, 26);
    const hx = bx + bw * (0.5 + this.pos * 0.5);
    ctx.font = '30px serif'; ctx.textAlign = 'center'; ctx.fillText('🐱', hx, by + 10);
    const q = this.inZone / Math.max(0.01, this.sampled);
    ctx.fillStyle = '#aaa'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${Math.round(q * 100)}% still`, w / 2, by + 70);
    resultBanner(ctx, w, by + 105, this.result);
  }
}

export function makeMinigame(spec: MinigameSpec): Minigame {
  switch (spec.kind) {
    case 'swipe': return new Swipe(spec);
    case 'mash': return new Mash(spec);
    case 'pick': return new Pick(spec);
    case 'zoomies': return new Zoomies(spec);
    case 'stare': return new Stare(spec);
    case 'rhythm': return new Rhythm(spec);
    case 'balance': return new Balance(spec);
  }
}
