import type { Input } from './input';
import { roundRect } from './minigames';

export type TouchMode = 'none' | 'move' | 'tap' | 'mash' | 'zoomies' | 'balance' | 'stare';

interface Btn { x: number; y: number; w: number; h: number; label: string; key: string; hold?: boolean; color?: string }

/**
 * On-screen controls for phones. Left half of the screen is a floating stick,
 * the right side holds context buttons. Everything is drawn on the game canvas
 * in device pixels and feeds the shared Input object.
 */
export class TouchControls {
  mode: TouchMode = 'none';
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickPos = { x: 0, y: 0 };
  private held = new Map<number, Btn>();
  private btns: Btn[] = [];
  private W = 0; private H = 0; private s = 1;
  private flashes = new Map<string, number>();

  constructor(private canvas: HTMLCanvasElement, private input: Input) {
    canvas.style.touchAction = 'none';
    const dpr = () => this.W / canvas.clientWidth;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.input.touch) return;
      this.input.touch = true;
      e.preventDefault();
      const x = e.offsetX * dpr(), y = e.offsetY * dpr();
      const b = this.hit(x, y);
      if (b) {
        this.flashes.set(b.key + b.label, performance.now());
        if (b.hold) { this.held.set(e.pointerId, b); this.input.vhold(b.key, true); }
        else this.input.vpress(b.key);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      if (this.mode === 'stare') { this.input.vpress('touch'); return; }
      if (this.mode === 'move' && this.stickId === null && x < this.W * 0.55) {
        this.stickId = e.pointerId; this.stickOrigin = { x, y }; this.stickPos = { x, y };
        canvas.setPointerCapture(e.pointerId);
      } else if (this.mode === 'tap') {
        this.input.vpress(' ');
      }
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const x = e.offsetX * dpr(), y = e.offsetY * dpr();
      const dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
      const r = 60 * this.s;
      const d = Math.hypot(dx, dy);
      const k = d > r ? r / d : 1;
      this.stickPos = { x: this.stickOrigin.x + dx * k, y: this.stickOrigin.y + dy * k };
      const dead = 0.18;
      const nx = dx * k / r, ny = dy * k / r;
      const m = Math.hypot(nx, ny);
      if (m < dead) { this.input.axisX = 0; this.input.axisY = 0; }
      else { this.input.axisX = nx / m; this.input.axisY = ny / m; }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.stickId) { this.stickId = null; this.input.axisX = 0; this.input.axisY = 0; }
      const b = this.held.get(e.pointerId);
      if (b) { this.held.delete(e.pointerId); this.input.vhold(b.key, false); }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  private hit(x: number, y: number): Btn | null {
    for (const b of this.btns) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  }

  /** Lay out and draw. s = UI scale in device px. prompt = current interaction text, if any. */
  draw(ctx: CanvasRenderingContext2D, W: number, H: number, s: number, prompt: string | null) {
    this.W = W; this.H = H; this.s = s;
    this.btns = [];
    if (!this.input.touch || this.mode === 'none') { if (this.stickId !== null) { this.stickId = null; this.input.axisX = 0; this.input.axisY = 0; } return; }
    const safe = 18 * s;
    const big = 86 * s, gap = 12 * s;
    const right = W - safe, bottom = H - safe;
    switch (this.mode) {
      case 'move':
        if (prompt) this.btns.push({ x: right - big * 1.6, y: bottom - big, w: big * 1.6, h: big, label: 'PAW', key: 'e', color: '#f4c95d' });
        break;
      case 'tap':
        this.btns.push({ x: right - big * 1.8, y: bottom - big, w: big * 1.8, h: big, label: 'TAP', key: ' ', color: '#f4c95d' });
        break;
      case 'mash':
        this.btns.push({ x: right - big * 1.6, y: bottom - big, w: big * 1.6, h: big, label: 'MASH', key: ' ', color: '#e0a060' });
        this.btns.push({ x: right - big * 1.6, y: bottom - big * 2 - gap, w: big * 1.6, h: big * 0.8, label: 'LET GO', key: 'e', color: '#8be28b' });
        break;
      case 'zoomies': {
        const b = big * 0.9, cx = right - b * 1.5, cy = bottom - b * 1.5;
        this.btns.push({ x: cx - b / 2, y: cy - b * 1.5, w: b, h: b, label: '↑', key: 'arrowup' });
        this.btns.push({ x: cx - b / 2, y: cy + b / 2, w: b, h: b, label: '↓', key: 'arrowdown' });
        this.btns.push({ x: cx - b * 1.5, y: cy - b / 2, w: b, h: b, label: '←', key: 'arrowleft' });
        this.btns.push({ x: cx + b / 2, y: cy - b / 2, w: b, h: b, label: '→', key: 'arrowright' });
        break;
      }
      case 'balance':
        this.btns.push({ x: safe, y: bottom - big, w: big * 1.5, h: big, label: '◀', key: 'a', hold: true });
        this.btns.push({ x: right - big * 1.5, y: bottom - big, w: big * 1.5, h: big, label: '▶', key: 'd', hold: true });
        break;
      case 'stare':
        break;
    }
    // stick
    if (this.mode === 'move') {
      const o = this.stickId !== null ? this.stickOrigin : { x: safe + 70 * s, y: bottom - 70 * s };
      const p = this.stickId !== null ? this.stickPos : o;
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(o.x, o.y, 60 * s, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 2 * s; ctx.stroke();
      ctx.fillStyle = 'rgba(244,201,93,0.55)'; ctx.beginPath(); ctx.arc(p.x, p.y, 26 * s, 0, Math.PI * 2); ctx.fill();
    }
    const now = performance.now();
    for (const b of this.btns) {
      const f = now - (this.flashes.get(b.key + b.label) ?? -1e9) < 120;
      const heldNow = [...this.held.values()].includes(b);
      ctx.fillStyle = f || heldNow ? 'rgba(255,255,255,0.45)' : 'rgba(10,8,20,0.6)';
      roundRect(ctx, b.x, b.y, b.w, b.h, 16 * s); ctx.fill();
      ctx.strokeStyle = b.color ?? 'rgba(255,255,255,0.5)'; ctx.lineWidth = 2.5 * s; ctx.stroke();
      ctx.fillStyle = b.color ?? '#fff'; ctx.font = `bold ${(b.label.length > 2 ? 18 : 30) * s}px system-ui, sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2);
      ctx.textBaseline = 'alphabetic';
    }
  }
}
