/**
 * Hard stop (instructions.md §4.7). When engaged: no new entries. Optional
 * "flush" requests a market-sell of all open positions, handled by the engine.
 */
export class KillSwitch {
  private killed = false;
  private flushRequested = false;

  engage(flush = false): void {
    this.killed = true;
    if (flush) this.flushRequested = true;
  }

  reset(): void {
    this.killed = false;
    this.flushRequested = false;
  }

  get isKilled(): boolean {
    return this.killed;
  }

  /** Consume the flush request (one-shot). */
  takeFlush(): boolean {
    if (!this.flushRequested) return false;
    this.flushRequested = false;
    return true;
  }
}
