import type { StrategyConfig } from '../config/schema.js';
import type { Ledger } from '../store/ledger.js';
import { KillSwitch } from './killswitch.js';
import { CircuitBreaker } from './breaker.js';

export interface GateContext {
  openPositions: number;
  sizeSol: number;
}

export interface GateDecision {
  allowed: boolean;
  reason?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pre-execution risk gates (instructions.md §4.7). Checked before every entry
 * and surfaced continuously to the UI.
 */
export class RiskGates {
  readonly killSwitch = new KillSwitch();
  readonly breaker = new CircuitBreaker();

  constructor(private ledger: Ledger) {}

  dailyCapUsed(): number {
    return this.ledger.spentSince(Date.now() - DAY_MS);
  }

  /** Evaluate whether a new entry may proceed. */
  check(cfg: StrategyConfig, ctx: GateContext): GateDecision {
    if (this.killSwitch.isKilled)
      return { allowed: false, reason: 'kill switch engaged' };
    if (this.breaker.isTripped)
      return { allowed: false, reason: `breaker: ${this.breaker.tripReason}` };

    if (ctx.openPositions >= cfg.maxConcurrent)
      return {
        allowed: false,
        reason: `max concurrent positions (${cfg.maxConcurrent})`,
      };

    const used = this.dailyCapUsed();
    if (used + ctx.sizeSol > cfg.dailyCapSol)
      return {
        allowed: false,
        reason: `daily cap ${cfg.dailyCapSol}◎ would be exceeded (used ${used.toFixed(2)}◎)`,
      };

    return { allowed: true };
  }
}
