import type { Position } from '../types.js';
import { gainPct } from './pnl.js';

export interface ExitAction {
  /** fraction of CURRENT holdings to sell (0..1) */
  sellFraction: number;
  reason: string;
  fast: boolean; // use fast-exit path (priority + Jito on the sell)
  full: boolean; // closes the position
}

export interface ExitContext {
  now: number;
  currentPrice: number;
  currentLiquidityUsd: number;
}

/**
 * Evaluate exit rules in priority order (instructions.md §4.6):
 * stop-loss → liquidity-drop → aggressive TP → trailing → TP ladder →
 * time-based → (breakeven handled as a stop adjustment).
 * Returns the first triggered action, or null to hold.
 */
export function evaluateExit(p: Position, ctx: ExitContext): ExitAction | null {
  const x = p.exitSnapshot;
  const g = gainPct(p.entryPrice, ctx.currentPrice);

  // 1) stop-loss (or breakeven stop once armed)
  const stopLevel = p.breakevenArmed ? 0 : -x.stopLoss;
  if (g <= stopLevel) {
    return {
      sellFraction: 1,
      reason: p.breakevenArmed ? 'breakeven stop' : `stop-loss ${x.stopLoss}%`,
      fast: x.fastExit,
      full: true,
    };
  }

  // 2) liquidity-drop auto-exit
  if (
    x.liqDropExit > 0 &&
    x.entryLiquidityUsd > 0 &&
    ctx.currentLiquidityUsd <
      x.entryLiquidityUsd * (1 - x.liqDropExit / 100)
  ) {
    return {
      sellFraction: 1,
      reason: `liquidity dropped >${x.liqDropExit}%`,
      fast: true,
      full: true,
    };
  }

  // 3) aggressive take-profit (dump on green) — fires once
  if (x.aggrTP && !p.firstTpHit && g >= x.aggrTrigger) {
    return {
      sellFraction: x.aggrSellPct / 100,
      reason: `⚡ aggressive TP +${x.aggrTrigger}% → sell ${x.aggrSellPct}%`,
      fast: x.fastExit,
      full: x.aggrSellPct >= 100,
    };
  }

  // 4) trailing stop (only once in profit)
  if (x.trailing > 0 && p.highWaterPrice > p.entryPrice) {
    const dropFromHigh = gainPct(p.highWaterPrice, ctx.currentPrice);
    if (dropFromHigh <= -x.trailing) {
      return {
        sellFraction: 1,
        reason: `trailing stop ${x.trailing}% from high`,
        fast: x.fastExit,
        full: true,
      };
    }
  }

  // 5) take-profit ladder — sell the highest rung reached that's not yet taken
  //    (we track via firstTpHit + breakevenArmed; full ladder bookkeeping uses
  //    realizedPnl. Here we trigger the first unmet rung.)
  for (const rung of x.tpLadder) {
    if (g >= rung.gainPct && !p.firstTpHit) {
      return {
        sellFraction: rung.sellPct / 100,
        reason: `TP ladder +${rung.gainPct}% → sell ${rung.sellPct}%`,
        fast: false,
        full: rung.sellPct >= 100,
      };
    }
  }

  // 6) time-based max hold
  if (x.maxHoldMin > 0 && ctx.now - p.openedAt > x.maxHoldMin * 60_000) {
    return {
      sellFraction: 1,
      reason: `max hold ${x.maxHoldMin}m reached`,
      fast: false,
      full: true,
    };
  }

  return null;
}
