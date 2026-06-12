import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * LP burned/locked + absolute depth (instructions.md §4.3 #6). Liquidity gates
 * are n/a on the early bonding curve where there is no AMM pool yet.
 */
export function checkLiquidity(
  s: TokenState,
  cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  const out: Record<string, SafetyCheck> = {};
  const onCurve = s.source === 'pumpfun_curve';

  if (cfg.reqLpBurned && !onCurve) {
    out.lpBurned = {
      pass: s.lpBurnedOrLocked,
      value: s.lpBurnedOrLocked,
      severity: 'high',
    };
  }

  if (!onCurve && cfg.minLiqUsd > 0) {
    out.liquidity = {
      pass: s.liquidityUsd >= cfg.minLiqUsd,
      value: s.liquidityUsd,
      severity: 'med',
    };
  }

  return out;
}
