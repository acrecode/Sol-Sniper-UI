import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Holder concentration + bundle/block-0 cluster + min holders
 * (instructions.md §4.3 #4, #5, #8).
 */
export function checkHolders(
  s: TokenState,
  cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  return {
    devHolding: {
      pass: s.devHoldingPct <= cfg.maxDevPct,
      value: s.devHoldingPct,
      severity: 'high',
    },
    top10: {
      pass: s.top10Pct <= cfg.maxTop10Pct,
      value: s.top10Pct,
      severity: 'high',
    },
    singleWallet: {
      pass: s.largestNonPoolPct <= cfg.maxSinglePct,
      value: s.largestNonPoolPct,
      severity: 'med',
    },
    bundle: {
      pass: s.bundlePct <= cfg.maxBundlePct,
      value: s.bundlePct,
      severity: 'high',
      note: s.bundlePct > cfg.maxBundlePct ? 'block-0 cluster too high' : undefined,
    },
    minHolders: {
      pass: s.holderCount >= cfg.minHolders,
      value: s.holderCount,
      severity: 'med',
    },
  };
}
