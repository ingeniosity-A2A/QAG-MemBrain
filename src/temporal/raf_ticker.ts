export class RAFLikeTicker {
  private timer: NodeJS.Timeout | undefined;

  start(callback: (time: number) => void, intervalMs = 16): void {
    this.stop();
    this.timer = setInterval(() => callback(Date.now()), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
