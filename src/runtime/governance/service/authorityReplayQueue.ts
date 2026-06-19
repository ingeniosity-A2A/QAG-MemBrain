export class AuthorityReplayQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueueReplay(decisionId: string): void;
  enqueueReplay<T>(decisionId: string, task: () => Promise<T>): Promise<T>;
  enqueueReplay<T>(decisionId: string, task?: () => Promise<T>): Promise<T> | void {
    if (!task) {
      this.enqueue(`decision:${decisionId}`, async () => undefined);
      return;
    }

    return this.enqueue(`decision:${decisionId}`, task);
  }

  enqueueSessionReplay(sessionId: string): void;
  enqueueSessionReplay<T>(sessionId: string, task: () => Promise<T>): Promise<T>;
  enqueueSessionReplay<T>(sessionId: string, task?: () => Promise<T>): Promise<T> | void {
    if (!task) {
      this.enqueue(`session:${sessionId}`, async () => undefined);
      return;
    }

    return this.enqueue(`session:${sessionId}`, task);
  }

  enqueueRangeReplay(start: string, end: string): void;
  enqueueRangeReplay<T>(start: string, end: string, task: () => Promise<T>): Promise<T>;
  enqueueRangeReplay<T>(start: string, end: string, task?: () => Promise<T>): Promise<T> | void {
    if (!task) {
      this.enqueue(`range:${start}:${end}`, async () => undefined);
      return;
    }

    return this.enqueue(`range:${start}:${end}`, task);
  }

  enqueueLineageReplay(lineageId: string): void;
  enqueueLineageReplay<T>(lineageId: string, task: () => Promise<T>): Promise<T>;
  enqueueLineageReplay<T>(lineageId: string, task?: () => Promise<T>): Promise<T> | void {
    if (!task) {
      this.enqueue(`lineage:${lineageId}`, async () => undefined);
      return;
    }

    return this.enqueue(`lineage:${lineageId}`, task);
  }

  private enqueue<T>(_key: string, task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}