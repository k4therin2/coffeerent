export class Input {
  down = new Set<string>();
  /** keys pressed since last frame */
  pressed: string[] = [];
  anyPressed = false;
  /** true once the player has used a touch screen */
  touch = false;
  /** analog movement from the on-screen stick, -1..1 */
  axisX = 0;
  axisY = 0;
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = norm(e.key);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.down.add(k); this.pressed.push(k); this.anyPressed = true;
    });
    window.addEventListener('keyup', (e) => this.down.delete(norm(e.key)));
    window.addEventListener('blur', () => { this.down.clear(); this.axisX = 0; this.axisY = 0; });
    if (matchMedia('(pointer: coarse)').matches) this.touch = true;
  }
  endFrame() { this.pressed.length = 0; this.anyPressed = false; }
  was(k: string) { return this.pressed.includes(k); }
  is(k: string) { return this.down.has(k); }
  /** virtual press from touch controls */
  vpress(k: string) { this.touch = true; this.pressed.push(k); this.anyPressed = true; }
  vhold(k: string, on: boolean) { this.touch = true; if (on) this.down.add(k); else this.down.delete(k); }
  get action() { return this.was(' ') || this.was('e') || this.was('enter'); }
  get dirX() {
    const k = (this.is('d') || this.is('arrowright') ? 1 : 0) - (this.is('a') || this.is('arrowleft') ? 1 : 0);
    return k !== 0 ? k : this.axisX;
  }
  get dirY() {
    const k = (this.is('s') || this.is('arrowdown') ? 1 : 0) - (this.is('w') || this.is('arrowup') ? 1 : 0);
    return k !== 0 ? k : this.axisY;
  }
}
function norm(k: string) { return k.toLowerCase(); }
