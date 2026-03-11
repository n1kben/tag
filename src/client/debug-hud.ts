export class DebugHUD {
  private el: HTMLDivElement;
  private visible = true;
  private fps = 0;
  private frames = 0;
  private lastFpsTime = 0;

  constructor() {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      top: '8px',
      right: '8px',
      background: 'rgba(0,0,0,0.7)',
      color: '#0f0',
      fontFamily: 'monospace',
      fontSize: '12px',
      padding: '6px 10px',
      borderRadius: '4px',
      lineHeight: '1.6',
      pointerEvents: 'none',
      zIndex: '9999',
      display: 'block',
    });
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  update(stats: {
    ping: number;
    pendingInputs: number;
    interpBuffer: number;
    serverTickMs: number;
  }): void {
    this.frames++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.fps = this.frames;
      this.frames = 0;
      this.lastFpsTime = now;
    }

    if (!this.visible) return;

    const tickHz = stats.serverTickMs > 0 ? (1000 / stats.serverTickMs).toFixed(0) : '--';
    this.el.innerHTML = [
      `FPS: ${this.fps}`,
      `Ping: ${stats.ping.toFixed(0)}ms`,
      `Predict queue: ${stats.pendingInputs}`,
      `Interp buffer: ${stats.interpBuffer}`,
      `Server tick: ${tickHz}Hz`,
    ].join('<br>');
  }
}
