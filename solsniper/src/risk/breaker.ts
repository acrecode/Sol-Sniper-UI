import { logger } from '../util/logger.js';

/**
 * Circuit breaker (instructions.md §4.7). Trips on a consecutive-loss streak or
 * an elevated tx-error rate, pausing new entries until manually reset.
 */
export class CircuitBreaker {
  private tripped = false;
  private reason = '';
  private lossStreak = 0;
  private recentErrors: number[] = []; // timestamps

  constructor(
    private maxLossStreak = 4,
    private maxErrorsPerMin = 6,
  ) {}

  recordTrade(pnlSol: number): void {
    if (pnlSol < 0) this.lossStreak++;
    else this.lossStreak = 0;
    if (this.lossStreak >= this.maxLossStreak) {
      this.trip(`loss streak ${this.lossStreak}`);
    }
  }

  recordError(): void {
    const now = Date.now();
    this.recentErrors.push(now);
    this.recentErrors = this.recentErrors.filter((t) => now - t < 60_000);
    if (this.recentErrors.length >= this.maxErrorsPerMin) {
      this.trip(`error rate ${this.recentErrors.length}/min`);
    }
  }

  private trip(reason: string): void {
    if (this.tripped) return;
    this.tripped = true;
    this.reason = reason;
    logger.error({ reason }, 'circuit breaker tripped — pausing entries');
  }

  reset(): void {
    this.tripped = false;
    this.reason = '';
    this.lossStreak = 0;
    this.recentErrors = [];
  }

  get isTripped(): boolean {
    return this.tripped;
  }
  get tripReason(): string {
    return this.reason;
  }
}
