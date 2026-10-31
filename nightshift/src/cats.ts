import type { CatId, Dir } from './types';

interface CatLook {
  body: string; belly: string; stripes?: string; socks?: boolean; blaze?: boolean;
  eyes: string; fat?: boolean; nose: string;
}
export const LOOKS: Record<CatId, CatLook> = {
  dorian: { body: '#6f7f94', belly: '#7e8da3', eyes: '#7fd37a', nose: '#5a5a6a' },
  bean:   { body: '#d98a3a', belly: '#f0c48a', stripes: '#5a2f12', eyes: '#f2d14f', nose: '#c4604a' },
  melon:  { body: '#8b6b4a', belly: '#d9c7ad', stripes: '#5a4330', socks: true, fat: true, eyes: '#8fd16a', nose: '#d58a8a' },
  ginny:  { body: '#8a8d93', belly: '#e9eaee', socks: true, blaze: true, eyes: '#d9b44a', nose: '#e0a0a8' },
};

/**
 * Draw a cat centered at (cx, cy) in pixels. size = tile px.
 * Procedural, top-down-ish three quarter view. Good enough and cute enough.
 */
export function drawCat(ctx: CanvasRenderingContext2D, cat: CatId, cx: number, cy: number, size: number,
                        dir: Dir, walkPhase: number, opts: { stunned?: boolean; carrying?: boolean; ghost?: boolean } = {}) {
  const L = LOOKS[cat];
  const s = size / 32;
  const fat = L.fat ? 1.18 : 1;
  const bw = 11 * s * fat, bh = 8 * s * fat;
  const bob = Math.sin(walkPhase) * 1.2 * s;
  ctx.save();
  ctx.translate(cx, cy + bob);
  if (opts.ghost) ctx.globalAlpha = 0.45;
  const flip = dir === 'left' ? -1 : 1;
  ctx.scale(flip, 1);

  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 7 * s, bw, 3 * s, 0, 0, Math.PI * 2); ctx.fill();

  // tail
  ctx.strokeStyle = L.body; ctx.lineWidth = 3 * s; ctx.lineCap = 'round';
  const tw = Math.sin(walkPhase * 0.7) * 3 * s;
  ctx.beginPath(); ctx.moveTo(-bw + 2 * s, 1 * s);
  ctx.quadraticCurveTo(-bw - 6 * s, -2 * s + tw, -bw - 3 * s, -9 * s + tw); ctx.stroke();

  // legs
  ctx.fillStyle = L.socks ? '#f2f2f2' : L.body;
  const lp = Math.sin(walkPhase) * 2 * s;
  for (const [lx, ph] of [[-6, lp], [-2, -lp], [3, lp], [7, -lp]] as [number, number][]) {
    ctx.fillRect(lx * s * fat - 1.5 * s, 3 * s + ph * 0.5, 3 * s, 5 * s);
  }

  // body
  ctx.fillStyle = L.body;
  ctx.beginPath(); ctx.ellipse(0, 1 * s, bw, bh, 0, 0, Math.PI * 2); ctx.fill();
  // belly
  ctx.fillStyle = L.belly;
  ctx.beginPath(); ctx.ellipse(1 * s, 3.5 * s, bw * 0.5, bh * 0.45, 0, 0, Math.PI * 2); ctx.fill();
  // stripes
  if (L.stripes) {
    ctx.strokeStyle = L.stripes; ctx.lineWidth = 1.6 * s;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath(); ctx.moveTo(i * 3.2 * s * fat, -bh + 1 * s);
      ctx.lineTo(i * 3.2 * s * fat + 1 * s, -1 * s); ctx.stroke();
    }
  }

  // head
  const hx = 8 * s * fat, hy = -4 * s;
  const hr = 6.5 * s;
  if (dir === 'up') ctx.translate(-hx * 0.8, 0);
  // ears
  ctx.fillStyle = L.body;
  ctx.beginPath(); ctx.moveTo(hx - 5 * s, hy - 3 * s); ctx.lineTo(hx - 4 * s, hy - 10 * s); ctx.lineTo(hx, hy - 5 * s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hx + 5 * s, hy - 3 * s); ctx.lineTo(hx + 4.5 * s, hy - 10 * s); ctx.lineTo(hx + 0.5 * s, hy - 5 * s); ctx.fill();
  ctx.fillStyle = '#e9a0a8';
  ctx.beginPath(); ctx.moveTo(hx - 4 * s, hy - 4 * s); ctx.lineTo(hx - 3.6 * s, hy - 8 * s); ctx.lineTo(hx - 1.5 * s, hy - 5 * s); ctx.fill();
  ctx.beginPath(); ctx.moveTo(hx + 4 * s, hy - 4 * s); ctx.lineTo(hx + 3.8 * s, hy - 8 * s); ctx.lineTo(hx + 1.5 * s, hy - 5 * s); ctx.fill();
  ctx.fillStyle = L.body;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  if (L.blaze) {
    ctx.fillStyle = L.belly;
    ctx.beginPath(); ctx.moveTo(hx, hy - 5 * s); ctx.lineTo(hx + 3 * s, hy + 5 * s); ctx.lineTo(hx - 3 * s, hy + 5 * s); ctx.fill();
  }
  if (L.stripes) {
    ctx.strokeStyle = L.stripes; ctx.lineWidth = 1.2 * s;
    ctx.beginPath(); ctx.moveTo(hx, hy - 6 * s); ctx.lineTo(hx, hy - 2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx - 2.5 * s, hy - 5.5 * s); ctx.lineTo(hx - 1.5 * s, hy - 2 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(hx + 2.5 * s, hy - 5.5 * s); ctx.lineTo(hx + 1.5 * s, hy - 2 * s); ctx.stroke();
  }
  if (dir !== 'up') {
    // eyes
    if (opts.stunned) {
      ctx.strokeStyle = '#222'; ctx.lineWidth = 1.2 * s;
      for (const ex of [-2.5, 2.5]) {
        ctx.beginPath(); ctx.moveTo(hx + (ex - 1) * s, hy - 1.5 * s); ctx.lineTo(hx + (ex + 1) * s, hy + 0.5 * s);
        ctx.moveTo(hx + (ex + 1) * s, hy - 1.5 * s); ctx.lineTo(hx + (ex - 1) * s, hy + 0.5 * s); ctx.stroke();
      }
    } else {
      ctx.fillStyle = L.eyes;
      ctx.beginPath(); ctx.ellipse(hx - 2.5 * s, hy - 0.5 * s, 1.6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + 2.5 * s, hy - 0.5 * s, 1.6 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#111';
      ctx.fillRect(hx - 2.9 * s, hy - 2 * s, 0.8 * s, 3 * s);
      ctx.fillRect(hx + 2.1 * s, hy - 2 * s, 0.8 * s, 3 * s);
    }
    // nose + mouth
    ctx.fillStyle = L.nose;
    ctx.beginPath(); ctx.moveTo(hx - 1 * s, hy + 2 * s); ctx.lineTo(hx + 1 * s, hy + 2 * s); ctx.lineTo(hx, hy + 3.2 * s); ctx.fill();
    // whiskers
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 0.7 * s;
    for (const wy of [1.5, 3]) {
      ctx.beginPath(); ctx.moveTo(hx - 2 * s, hy + wy * s); ctx.lineTo(hx - 8 * s, hy + (wy - 0.5) * s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(hx + 2 * s, hy + wy * s); ctx.lineTo(hx + 8 * s, hy + (wy - 0.5) * s); ctx.stroke();
    }
  }
  if (opts.carrying) {
    // toy mouse in mouth
    ctx.fillStyle = '#9a9a9a';
    ctx.beginPath(); ctx.ellipse(hx + 2 * s, hy + 5 * s, 3 * s, 2 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d88'; ctx.lineWidth = s;
    ctx.beginPath(); ctx.moveTo(hx - 1 * s, hy + 5 * s); ctx.lineTo(hx - 5 * s, hy + 6 * s); ctx.stroke();
  }
  ctx.restore();
}

export function drawHuman(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, dir: Dir, phase: number, awake: boolean) {
  const s = size / 32;
  ctx.save(); ctx.translate(cx, cy);
  if (!awake) {
    // lump under the blanket, with a little arm sticking out
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(2 * s, 4 * s, 17 * s, 28 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#9a86c4';
    ctx.beginPath(); ctx.ellipse(0, 2 * s, 17 * s, 28 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#6b5a8a'; ctx.lineWidth = 1.5 * s; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1 * s;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(-14 * s, i * 9 * s + 4 * s); ctx.quadraticCurveTo(0, i * 9 * s, 14 * s, i * 9 * s + 4 * s); ctx.stroke(); }
    ctx.fillStyle = '#f0c8a8';
    ctx.beginPath(); ctx.arc(0, -26 * s, 7.5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath(); ctx.arc(0, -29 * s, 7.5 * s, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#f0c8a8';
    ctx.beginPath(); ctx.ellipse(16 * s, -4 * s, 4 * s, 9 * s, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `${10 * s}px monospace`;
    ctx.fillText('z', 10 * s + Math.sin(phase) * 2 * s, -30 * s - (phase % 3) * 4 * s);
    ctx.restore(); return;
  }
  const bob = Math.sin(phase * 2) * 1.5 * s;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 12 * s, 9 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  ctx.fillStyle = '#334';
  ctx.fillRect(-6 * s, 2 * s + Math.sin(phase * 2) * 2 * s, 5 * s, 10 * s);
  ctx.fillRect(1 * s, 2 * s - Math.sin(phase * 2) * 2 * s, 5 * s, 10 * s);
  // body (bathrobe)
  ctx.fillStyle = '#8a4a5a';
  ctx.fillRect(-8 * s, -12 * s + bob, 16 * s, 16 * s);
  ctx.fillStyle = '#f0c8a8';
  ctx.beginPath(); ctx.arc(0, -18 * s + bob, 7 * s, 0, Math.PI * 2); ctx.fill();
  // hair
  ctx.fillStyle = '#3a2a22';
  ctx.beginPath(); ctx.arc(0, -21 * s + bob, 7 * s, Math.PI, 0); ctx.fill();
  // spray bottle
  const sx = dir === 'left' ? -11 : 11;
  ctx.fillStyle = '#4ad';
  ctx.fillRect(sx * s - 2 * s, -8 * s + bob, 4 * s, 7 * s);
  ctx.restore();
}
