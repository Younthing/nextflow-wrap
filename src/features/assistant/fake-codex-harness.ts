import type { CodexEvent, CodexHarness, CodexSession, OpenSessionOptions, ProbeResult } from "@/features/codex-harness";

/**
 * In-memory Codex harness for route tests. It never looks up or spawns `codex`.
 *
 * Pass one script per `open()` via `turns`. Each script is a list of steps:
 * - `{ type: "text", text }` — assistant prose, streamed as one delta
 * - `{ type: "tool", name, arguments }` — a whole-message tool reply
 * - `{ type: "hold" }` — wait until `release()` or until cancel (`interrupt` / `close`)
 * - `{ type: "fail", message }` — end the turn with an error
 *
 * A script should hold once. `release()` lets it continue into the following
 * steps; cancel ends the iterator without `turn.end`. To add a step, extend
 * `FakeCodexStep` and handle it in `play`. `probe` sets discovery (`hangProbe`
 * waits until `releaseProbe()`). `failOpen` makes `open()` throw.
 *
 * `prompts`, `opens`, `probeCalls`, `interrupts`, `closes`, and `holds` record
 * what the route did. `turns` may also be a function of the zero-based open
 * index when the next script depends on earlier prompts (`prompts` already
 * holds those; the current prompt is recorded in `startTurn`, after `open`).
 */
export type FakeCodexStep =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; arguments: Record<string, unknown> }
  | { type: "hold" }
  | { type: "fail"; message: string };

export interface FakeCodexHarnessOptions {
  /** Result of `probe()`. Ignored while `hangProbe` is set. Default: installed and authenticated. */
  probe?: ProbeResult | (() => Promise<ProbeResult>);
  /** `probe()` stays pending until `releaseProbe()`. */
  hangProbe?: boolean;
  /** Thrown from `open()` instead of starting a session. */
  failOpen?: Error | string;
  /** One script per `open()`, or a function of the zero-based open index. */
  turns?: readonly (readonly FakeCodexStep[])[] | ((openIndex: number) => readonly FakeCodexStep[]);
}

export class FakeCodexHarness implements CodexHarness {
  readonly opens: OpenSessionOptions[] = [];
  readonly prompts: string[] = [];
  probeCalls = 0;
  interrupts = 0;
  closes = 0;
  holds = 0;

  private readonly sessions: FakeCodexSession[] = [];
  private readonly probeWaiters: ((result: ProbeResult) => void)[] = [];

  constructor(private readonly options: FakeCodexHarnessOptions = {}) {}

  async probe(): Promise<ProbeResult> {
    this.probeCalls += 1;
    if (this.options.hangProbe) {
      return new Promise((resolve) => {
        this.probeWaiters.push(resolve);
      });
    }
    const probe = this.options.probe ?? { installed: true, authed: true };
    return typeof probe === "function" ? probe() : probe;
  }

  /** Settle every `probe()` that is waiting because `hangProbe` is set. */
  releaseProbe(result: ProbeResult = { installed: true, authed: false }): void {
    const waiters = this.probeWaiters.splice(0);
    for (const resolve of waiters) resolve(result);
  }

  async open(options: OpenSessionOptions): Promise<CodexSession> {
    const index = this.opens.length;
    this.opens.push(options);
    if (this.options.failOpen !== undefined) {
      throw typeof this.options.failOpen === "string" ? new Error(this.options.failOpen) : this.options.failOpen;
    }
    const session = new FakeCodexSession(this, this.scriptFor(index), index);
    this.sessions.push(session);
    return session;
  }

  /** Continue the newest held turn. A cancelled turn stays cancelled. */
  release(): void {
    this.sessions.at(-1)?.release();
  }

  private scriptFor(index: number): readonly FakeCodexStep[] {
    const { turns } = this.options;
    if (typeof turns === "function") return turns(index);
    if (turns && index < turns.length) return turns[index];
    throw new Error(
      `FakeCodexHarness has no script for open() #${index + 1}. Add another turn script to \`turns\`.`,
    );
  }
}

class Gate {
  private opened = false;
  private readonly waiting: (() => void)[] = [];

  wait(): Promise<void> {
    if (this.opened) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    const waiting = this.waiting.splice(0);
    for (const resolve of waiting) resolve();
  }
}

class FakeCodexSession implements CodexSession {
  readonly events: AsyncIterable<CodexEvent>;
  readonly turnId: string;
  readonly threadId: string;
  private cancelled = false;
  private readonly gate = new Gate();
  private item = 0;

  constructor(
    private readonly harness: FakeCodexHarness,
    private readonly steps: readonly FakeCodexStep[],
    index: number,
  ) {
    this.turnId = `turn_${index + 1}`;
    this.threadId = `thread_${index + 1}`;
    this.events = { [Symbol.asyncIterator]: () => this.play() };
  }

  async ensureThread(): Promise<{ threadId: string }> {
    return { threadId: this.threadId };
  }

  async startTurn(input: string): Promise<{ turnId: string }> {
    this.harness.prompts.push(input);
    return { turnId: this.turnId };
  }

  async interrupt(): Promise<void> {
    this.harness.interrupts += 1;
    this.cancelled = true;
    this.gate.open();
  }

  async respondToApproval(): Promise<void> {
    return undefined;
  }

  async close(): Promise<void> {
    this.harness.closes += 1;
    this.cancelled = true;
    this.gate.open();
  }

  release(): void {
    this.gate.open();
  }

  private async *play(): AsyncGenerator<CodexEvent> {
    for (const step of this.steps) {
      if (this.cancelled) return;
      if (step.type === "hold") {
        this.harness.holds += 1;
        await this.gate.wait();
        if (this.cancelled) return;
        continue;
      }
      if (step.type === "fail") {
        yield { type: "error", message: step.message, turnId: this.turnId };
        yield { type: "turn.end", turnId: this.turnId, status: "failed" };
        return;
      }
      const delta = step.type === "text"
        ? step.text
        : JSON.stringify({ tool: step.name, arguments: step.arguments });
      yield { type: "text.delta", itemId: `item_${this.item}`, delta, turnId: this.turnId };
      this.item += 1;
    }
    if (!this.cancelled) yield { type: "turn.end", turnId: this.turnId, status: "completed" };
  }
}
