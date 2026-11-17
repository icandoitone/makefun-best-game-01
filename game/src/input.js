// Neon Streets — keyboard input. One job: track keys and edge-triggered presses.

export class Input {
  constructor() {
    this.down = new Set();
    this.pressedSet = new Set();
    this.onKey = null; // optional callback(code) for first-press actions
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.down.has(e.code)) this.pressedSet.add(e.code);
      this.down.add(e.code);
      if (this.onKey) this.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => { this.down.clear(); });
  }

  isDown(code) { return this.down.has(code); }

  // True once, on the frame the key went down. Consumed by the caller.
  pressed(code) {
    if (this.pressedSet.has(code)) { this.pressedSet.delete(code); return true; }
    return false;
  }

  endFrame() { this.pressedSet.clear(); }

  // Driving axes, -1..1. Works with WASD and with arrow keys.
  drive() {
    const up = this.isDown('KeyW') || this.isDown('ArrowUp');
    const dn = this.isDown('KeyS') || this.isDown('ArrowDown');
    const lf = this.isDown('KeyA') || this.isDown('ArrowLeft');
    const rt = this.isDown('KeyD') || this.isDown('ArrowRight');
    return {
      throttle: up ? 1 : 0,
      brake: dn ? 1 : 0,
      steer: (lf ? 1 : 0) - (rt ? 1 : 0),
      handbrake: this.isDown('Space') ? 1 : 0,
    };
  }

  // On-foot movement axes.
  walk() {
    const up = this.isDown('KeyW') || this.isDown('ArrowUp');
    const dn = this.isDown('KeyS') || this.isDown('ArrowDown');
    const lf = this.isDown('KeyA') || this.isDown('ArrowLeft');
    const rt = this.isDown('KeyD') || this.isDown('ArrowRight');
    return { fwd: (up ? 1 : 0) - (dn ? 1 : 0), strafe: (rt ? 1 : 0) - (lf ? 1 : 0) };
  }
}
