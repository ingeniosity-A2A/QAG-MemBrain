export interface TweenAtom {
  id: string;
  target: string;
  property: string;
  from: number;
  to: number;
  start: number;
  end: number;
}

export class GSAPEngine {
  private readonly tweens: TweenAtom[] = [];

  add(tween: TweenAtom): void {
    this.tweens.push(tween);
  }

  reconstruct(time: number): Record<string, Record<string, number>> {
    const state: Record<string, Record<string, number>> = {};
    for (const tween of this.tweens) {
      const duration = Math.max(1, tween.end - tween.start);
      const progress = Math.min(1, Math.max(0, (time - tween.start) / duration));
      state[tween.target] ??= {};
      state[tween.target][tween.property] = tween.from + (tween.to - tween.from) * progress;
    }
    return state;
  }
}
