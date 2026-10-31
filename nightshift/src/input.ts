export class Input {
  down = new Set<string>();
  /** keys pressed since last frame */
  pressed: string[] = [];
  anyPressed = false;
  constructor() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = norm(e.key);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      this.down.add(k); this.pressed.push(k); this.anyPressed = true;
    });
    window.addEventListener('keyup', (e) => this.down.delete(norm(e.key)));
    window.addEventListener('blur', () => this.down.clear());
  }
  endFrame() { this.pressed.length = 0; this.anyPressed = false; }
  was(k: string) { return this.pressed.includes(k); }
  is(k: string) { return this.down.has(k); }
  get action() { return this.was(' ') || this.was('e') || this.was('enter'); }
  get dirX() { return (this.is('d') || this.is('arrowright') ? 1 : 0) - (this.is('a') || this.is('arrowleft') ? 1 : 0); }
  get dirY() { return (this.is('s') || this.is('arrowdown') ? 1 : 0) - (this.is('w') || this.is('arrowup') ? 1 : 0); }
}
function norm(k: string) { return k.length === 1 ? k.toLowerCase() : k.toLowerCase(); }
