import { CodexHarnessError } from "./errors";

/** In-order async iterator with a single active consumer. */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private closed = false;
  private consuming = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.items.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.drainWaiters();
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.consuming) throw new CodexHarnessError("CodexSession.events already has a consumer");
    this.consuming = true;
    return {
      next: () => this.next(),
      return: () => {
        this.consuming = false;
        for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
        return Promise.resolve({ value: undefined as T, done: true });
      },
    };
  }

  private next(): Promise<IteratorResult<T>> {
    const buffered = this.items.shift();
    if (buffered !== undefined) return Promise.resolve({ value: buffered, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as T, done: true });
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private drainWaiters(): void {
    while (this.waiters.length > 0 && this.items.length > 0) {
      this.waiters.shift()?.({ value: this.items.shift() as T, done: false });
    }
    if (!this.closed) return;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined as T, done: true });
  }
}
