import type { MinigameSpec } from './types';
import type { Input } from './input';

export interface MgResult { success: boolean; quality: number; timedOut?: boolean }

/** seconds of "GET READY" with the controls on screen before a minigame's clock starts */
export const READY = 1.4;
export interface KeyCap { kb: string; touch: string; what: string }

export abstract class Minigame {
  /** seconds since the minigame became active (after the ready beat) */
  elapsed = 0;
  /** seconds since the panel appeared */
  shown = 0;
  result: MgResult | null = null;
  flash = 0; // feedback flash timer
  flashColor = '#fff';
  constructor(public spec: MinigameSpec) {}
  get ready() { return this.shown < READY; }
  update(dt: number, input: Input) {
    this.shown += dt; this.flash = Math.max(0, this.flash - dt);
    if (this.ready) return;
    this.elapsed += dt;
    if (this.result) return;
    this.step(dt, input);
    if (!this.result && this.elapsed >= this.spec.time) { this.result = this.timeout(); this.result.timedOut = true; }
  }
  protected abstract step(dt: number, input: Input): void;
  protected timeout(): MgResult { return { success: false, quality: 0 }; }
  abstract draw(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  /** the controls, shown as key caps during GET READY and under the title */
  abstract keys(): KeyCap[];
  get timeLeft() { return Math.max(0, this.spec.time - this.elapsed); }
  protected ping(c: string) { this.flash = 0.25; this.flashColor = c; }
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
/** set by main.ts so hints can name the right control */
export const hints = { touch: false };
const K = (kb: string, touch: string) => hints.touch ? touch : kb;
/** touch adds 60-100 ms of latency, so timing windows get a little wider on phones */
const LENIENCY = () => hints.touch ? 1.3 : 1;

// ---- shared drawing helpers ----
function keycap(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, size = 15): number {
  ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
  const w = Math.max(size * 1.9, ctx.measureText(label).width + size * 0.9), h = size * 1.75;
  ctx.fillStyle = '#2a2340'; roundRect(ctx, x, y - h * 0.72, w, h, 6); ctx.fill();
  ctx.strokeStyle = '#6b5f8a'; ctx.lineWidth = 1.5; roundRect(ctx, x, y - h * 0.72, w, h, 6); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(label, x + w / 2, y + size * 0.1);
  return w;
}
/** draws "[KEY] what   [KEY] what" centred at (cx, y); returns nothing */
function keyRow(ctx: CanvasRenderingContext2D, cx: number, y: number, keys: KeyCap[], size: number) {
  // measure
  const parts = keys.map(k => { const label = hints.touch ? k.touch : k.kb; ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`; const kw = Math.max(size * 1.9, ctx.measureText(label).width + size * 0.9); ctx.font = `${size}px system-ui, sans-serif`; const tw = ctx.measureText(k.what).width; return { label, kw, tw, what: k.what }; });
  const gap = size * 0.6, sep = size * 1.6;
  const total = parts.reduce((a, p) => a + p.kw + gap + p.tw, 0) + sep * (parts.length - 1);
  let x = cx - total / 2;
  for (const p of parts) {
    keycap(ctx, x, y, p.label, size); x += p.kw + gap;
    ctx.fillStyle = '#ddd'; ctx.font = `${size}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillText(p.what, x, y); x += p.tw + sep;
  }
  ctx.textAlign = 'center';
}
function panel(ctx: CanvasRenderingContext2D, w: number, h: number, mg: Minigame, hint: string) {
  const pw = Math.min(560, w - 40), ph = 280;
  const x = (w - pw) / 2, y = (h - ph) / 2;
  ctx.fillStyle = 'rgba(10,8,20,0.94)';
  roundRect(ctx, x, y, pw, ph, 14); ctx.fill();
  ctx.strokeStyle = '#f4c95d'; ctx.lineWidth = 2; roundRect(ctx, x, y, pw, ph, 14); ctx.stroke();
  ctx.fillStyle = '#f4c95d'; ctx.font = 'bold 20px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(mg.spec.title, w / 2, y + 32);
  // controls row under the title, always visible
  keyRow(ctx, w / 2, y + 62, mg.keys(), 13);
  ctx.fillStyle = '#bbb'; ctx.font = '13px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(hint, w / 2, y + ph - 16);
  // timer bar
  ctx.fillStyle = '#333'; ctx.fillRect(x + 20, y + 76, pw - 40, 4);
  ctx.fillStyle = '#e66'; ctx.fillRect(x + 20, y + 76, (pw - 40) * Math.max(0, mg.ready ? 1 : mg.timeLeft / mg.spec.time), 4);
  return { x, y: y + 30, pw, ph };
}
/** big GET READY card over the panel body during the lead-in */
function readyOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, mg: Minigame) {
  if (!mg.ready) return false;
  const pw = Math.min(560, w - 40), ph = 280;
  const x = (w - pw) / 2, y = (h - ph) / 2;
  ctx.fillStyle = 'rgba(10,8,20,0.97)'; roundRect(ctx, x + 12, y + 92, pw - 24, ph - 124, 10); ctx.fill();
  const t = READY - mg.shown;
  ctx.fillStyle = '#f4c95d'; ctx.font = 'bold 30px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(t > 0.5 ? 'GET READY' : 'GO!', w / 2, y + 140);
  keyRow(ctx, w / 2, y + 190, mg.keys(), 18);
  ctx.fillStyle = '#333'; ctx.fillRect(x + 40, y + 215, pw - 80, 6);
  ctx.fillStyle = '#8be28b'; ctx.fillRect(x + 40, y + 215, (pw - 80) * (1 - t / READY), 6);
  return true;
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
  keys() { return [{ kb: 'SPACE', touch: 'TAP', what: 'when the paw is in the green' }]; }
  step(dt: number, input: Input) {
    const sp = Number(this.spec.params.speed);
    this.pos += this.dirn * sp * dt;
    if (this.pos > 1) { this.pos = 1; this.dirn = -1; } if (this.pos < 0) { this.pos = 0; this.dirn = 1; }
    if (input.action) {
      const half = Number(this.spec.params.zone) * LENIENCY() / 2;
      const d = Math.abs(this.pos - this.zone);
      const ok = d <= half;
      this.result = { success: ok, quality: ok ? 1 - d / half : 0 };
      this.ping(ok ? '#8be28b' : '#ff7b7b');
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this, 'Dead centre is quiet. The yellow edges are a crash. Miss and nothing falls.');
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    const half = Number(this.spec.params.zone) * LENIENCY() / 2;
    const crash = Number(this.spec.params.crash ?? 0.3);
    ctx.fillStyle = '#b8a040'; ctx.fillRect(bx + (this.zone - half) * bw, by, half * 2 * bw, 26);
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (this.zone - half * (1 - crash)) * bw, by, half * 2 * (1 - crash) * bw, 26);
    ctx.fillStyle = '#f4c95d'; ctx.fillRect(bx + this.pos * bw - 4, by - 8, 8, 42);
    ctx.font = '26px serif'; ctx.textAlign = 'center'; ctx.fillText('🐾', bx + this.pos * bw, by - 14);
    if (this.result) {
      ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'center';
      if (!this.result.success) { ctx.fillStyle = '#ff7b7b'; ctx.fillText(this.result.timedOut ? 'WALKED AWAY' : 'MISS', w / 2, by + 80); }
      else if (this.result.quality < crash) { ctx.fillStyle = '#f4c95d'; ctx.fillText('CRASH!', w / 2, by + 80); }
      else { ctx.fillStyle = '#8be28b'; ctx.fillText(this.result.quality > 0.8 ? 'PURRFECT' : 'THUNK', w / 2, by + 80); }
    }
    readyOverlay(ctx, w, h, this);
  }
}

// ---- mash: fill then release ----
export class Mash extends Minigame {
  v = 0;
  keys() { const label = String(this.spec.params.label); return [{ kb: 'SPACE', touch: 'MASH', what: `mash to ${label}` }, { kb: 'E', touch: 'LET GO', what: 'let go in the green' }]; }
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
    const { x, y, pw } = panel(ctx, w, h, this, 'The bar sinks on its own. Fill it, then let go while it sits in the green.');
    const bx = x + 40, bw = pw - 80, by = y + 110;
    const t = Number(this.spec.params.target), wd = Number(this.spec.params.width);
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 40, 10); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (t - wd / 2) * bw, by, wd * bw, 40);
    ctx.fillStyle = this.flash > 0 ? this.flashColor : '#e0a060'; ctx.fillRect(bx, by + 6, this.v * bw, 28);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(label + (this.v > 0.95 ? '!!!' : this.v > 0.6 ? '!!' : '!'), w / 2, by + 80);
    resultBanner(ctx, w, by + 115, this.result);
    readyOverlay(ctx, w, h, this);
  }
}

// ---- pick: sequential pins ----
export class Pick extends Minigame {
  pin = 0; pos = 0; dirn = 1; zone = rnd(0.25, 0.75); total = Number(this.spec.params.pins);
  keys() { return [{ kb: 'SPACE', touch: 'TAP', what: `in the green, ${this.total} latch${this.total > 1 ? 'es' : ''}` }]; }
  step(dt: number, input: Input) {
    const sp = Number(this.spec.params.speed) * (1 + this.pin * 0.15);
    this.pos += this.dirn * sp * dt;
    if (this.pos > 1) { this.pos = 1; this.dirn = -1; } if (this.pos < 0) { this.pos = 0; this.dirn = 1; }
    if (input.action) {
      if (Math.abs(this.pos - this.zone) <= 0.1 * LENIENCY()) {
        this.pin++; this.zone = rnd(0.2, 0.8); this.pos = 0; this.dirn = 1; this.ping('#8be28b');
        if (this.pin >= this.total) this.result = { success: true, quality: 1 };
      } else { this.pin = Math.max(0, this.pin - 1); this.ping('#ff7b7b'); }
    }
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this, 'A miss loses a latch. A teammate standing nearby makes it easier.');
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + (this.zone - 0.1 * LENIENCY()) * bw, by, 0.2 * LENIENCY() * bw, 26);
    ctx.fillStyle = this.flash > 0 ? this.flashColor : '#f4c95d'; ctx.fillRect(bx + this.pos * bw - 4, by - 8, 8, 42);
    for (let i = 0; i < this.total; i++) {
      ctx.fillStyle = i < this.pin ? '#8be28b' : '#555';
      ctx.beginPath(); ctx.arc(w / 2 + (i - (this.total - 1) / 2) * 30, by - 40, 9, 0, Math.PI * 2); ctx.fill();
    }
    resultBanner(ctx, w, by + 80, this.result);
    readyOverlay(ctx, w, h, this);
  }
}

// ---- zoomies: arrow sequence ----
const ARROWS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'] as const;
const ARROW_GLYPH: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' };
const WASD: Record<string, string> = { w: 'arrowup', s: 'arrowdown', a: 'arrowleft', d: 'arrowright' };
export class Zoomies extends Minigame {
  seq = Array.from({ length: Number(this.spec.params.count) }, () => ARROWS[Math.floor(Math.random() * 4)]);
  idx = 0; hits = 0;
  keys() { return [{ kb: '↑ ↓ ← →', touch: 'ARROWS', what: 'press each arrow in order' }, { kb: 'W A S D', touch: '', what: 'also works' }].filter(k => k.touch !== '' || !hints.touch); }
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
    const { y, pw } = panel(ctx, w, h, this, 'Fast. A wrong press skips that step. Every step wakes the house a little.');
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
    readyOverlay(ctx, w, h, this);
  }
}

// ---- stare: don't touch anything ----
const BAITS = ['PRESS SPACE NOW', '[E] continue', 'press any key', 'QUICK! SPACE!', 'tap W to win', 'DO IT. PRESS IT.'];
export class Stare extends Minigame {
  bait = ''; baitT = 0; nextBait = 0.8;
  keys() { return [{ kb: 'NOTHING', touch: 'NO TOUCH', what: 'press nothing for 6 seconds' }]; }
  step(dt: number, input: Input) {
    if (input.anyPressed && this.elapsed > 0.4) { this.result = { success: false, quality: 0 }; this.ping('#ff7b7b'); return; }
    this.baitT -= dt; this.nextBait -= dt;
    if (this.nextBait <= 0) { this.bait = BAITS[Math.floor(Math.random() * BAITS.length)]; this.baitT = 0.9; this.nextBait = rnd(1.2, 2.2); }
    if (this.elapsed >= Number(this.spec.params.hold)) this.result = { success: true, quality: 1 };
  }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { y, x, pw } = panel(ctx, w, h, this, K('Any key at all and you blink first. The neighbor cat will try to bait you.', 'Any touch at all and you blink first. The neighbor cat will try to bait you.'));
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
    readyOverlay(ctx, w, h, this);
  }
}

// ---- rhythm: licker ----
let audio: AudioContext | null = null;
function tick(freq: number) {
  try {
    audio ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.type = 'triangle';
    g.gain.setValueAtTime(0.12, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.08);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.09);
  } catch { /* no audio */ }
}
export class Rhythm extends Minigame {
  beats = Number(this.spec.params.beats); period = 60 / Number(this.spec.params.bpm); lead = 1.0;
  hits = 0; judged = new Set<number>(); misses = 0; ticked = -1;
  keys() { return [{ kb: 'SPACE', touch: 'TAP', what: 'on each beat as it crosses the line' }]; }
  step(_dt: number, input: Input) {
    const t = this.elapsed - this.lead;
    const beatNow = Math.floor(t / this.period + 0.5);
    if (t >= -this.period && beatNow !== this.ticked && beatNow < this.beats && Math.abs(t - beatNow * this.period) < 0.03) { this.ticked = beatNow; tick(beatNow < 0 ? 440 : 660); }
    if (input.was(' ') || input.was('e')) {
      const n = Math.round(t / this.period);
      if (n >= 0 && n < this.beats && !this.judged.has(n) && Math.abs(t - n * this.period) < 0.13 * LENIENCY()) { this.judged.add(n); this.hits++; this.ping('#8be28b'); }
      else { this.misses++; this.ping('#ff7b7b'); }
    }
    if (t > (this.beats - 1) * this.period + 0.3) { const q = this.hits / this.beats; this.result = { success: q >= 0.7, quality: q }; }
  }
  protected timeout() { const q = this.hits / this.beats; return { success: q >= 0.7, quality: q }; }
  draw(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const { x, y, pw } = panel(ctx, w, h, this, 'Listen for the tick. Six of eight licks need to land.');
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
    readyOverlay(ctx, w, h, this);
  }
}

// ---- balance: lickee ----
export class Balance extends Minigame {
  pos = 0; vel = 0; inZone = 0; sampled = 0;
  keys() { return [{ kb: 'A', touch: '◀', what: 'lean left' }, { kb: 'D', touch: '▶', what: 'lean right' }]; }
  step(dt: number, input: Input) {
    const drift = Number(this.spec.params.drift) / LENIENCY();
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
    const { x, y, pw } = panel(ctx, w, h, this, 'Your head drifts. Tap against the drift to keep it in the green for most of the time.');
    const bx = x + 40, bw = pw - 80, by = y + 120;
    ctx.fillStyle = '#444'; roundRect(ctx, bx, by, bw, 26, 8); ctx.fill();
    ctx.fillStyle = '#4caf50'; ctx.fillRect(bx + bw * (0.5 - 0.14), by, bw * 0.28, 26);
    const hx = bx + bw * (0.5 + this.pos * 0.5);
    ctx.font = '30px serif'; ctx.textAlign = 'center'; ctx.fillText('🐱', hx, by + 10);
    const q = this.inZone / Math.max(0.01, this.sampled);
    ctx.fillStyle = '#aaa'; ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${Math.round(q * 100)}% still`, w / 2, by + 70);
    resultBanner(ctx, w, by + 105, this.result);
    readyOverlay(ctx, w, h, this);
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
