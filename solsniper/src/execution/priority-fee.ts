import type { Connection } from '@solana/web3.js';
import type { StrategyConfig } from '../config/schema.js';
import { logger } from '../util/logger.js';

/**
 * Compute-unit price estimator (instructions.md §4.5). Samples recent priority
 * fees and scales by the user's aggressiveness multiplier. Falls back to a
 * sane fixed micro-lamport price when no RPC is available.
 */
export class PriorityFeeEstimator {
  constructor(private conn: Connection | null) {}

  /** @returns micro-lamports per compute unit. */
  async estimate(cfg: StrategyConfig): Promise<number> {
    if (cfg.feeMode === 'fixed') return 50_000 * cfg.feeAggr;

    if (!this.conn) return 25_000 * cfg.feeAggr;

    try {
      const recent = await this.conn.getRecentPrioritizationFees();
      if (!recent.length) return 25_000 * cfg.feeAggr;
      const fees = recent
        .map((r) => r.prioritizationFee)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);
      // 75th percentile, scaled by aggressiveness
      const p75 = fees[Math.floor(fees.length * 0.75)] ?? 10_000;
      return Math.max(1_000, Math.round(p75 * cfg.feeAggr));
    } catch (err) {
      logger.warn({ err: String(err) }, 'priority-fee: estimate failed, using default');
      return 25_000 * cfg.feeAggr;
    }
  }
}
