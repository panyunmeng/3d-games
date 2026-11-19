/**
 * 固定步长主循环：模拟以 1/60 秒为最小步长推进，渲染每帧一次。
 * 每帧最多补 5 步，避免切标签页回来时一次跑完几百步。
 */
export class Loop {
  readonly stepSeconds = 1 / 60;

  /** 游戏速度倍率（1 / 2 / 3 倍速） */
  timeScale = 1;
  running = false;

  private acc = 0;
  private last = 0;
  private raf = 0;
  private readonly maxSteps = 5;

  constructor(
    private readonly onStep: () => void,
    private readonly onFrame: (frameDt: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    const tick = (now: number): void => {
      if (!this.running) return;
      const frameDt = Math.min((now - this.last) / 1000, 0.25);
      this.last = now;
      this.acc += frameDt * this.timeScale;
      let steps = 0;
      while (this.acc >= this.stepSeconds && steps < this.maxSteps) {
        this.onStep();
        this.acc -= this.stepSeconds;
        steps++;
      }
      if (steps >= this.maxSteps) this.acc = 0;
      this.onFrame(frameDt);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}
