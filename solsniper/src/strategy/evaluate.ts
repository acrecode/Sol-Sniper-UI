import type { Decision, LaunchEvent, SafetyReport, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';
import { applyStructuralFilters, isCopyTradeHit } from './filters.js';

/**
 * Final decision: structural filters → safety verdict → size.
 * (instructions.md §4.4). Returns buy/skip with a human reason for the feed.
 */
export function evaluate(
  ev: LaunchEvent,
  state: TokenState,
  report: SafetyReport,
  cfg: StrategyConfig,
): Decision {
  const structural = applyStructuralFilters(ev, state, cfg);
  if (structural) return { action: 'skip', sizeSol: 0, reason: structural.reason };

  if (report.verdict === 'block') {
    const failed = Object.entries(report.checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    const why = failed.length
      ? `${failed[0]} failed`
      : `rug ${report.rugScore} > max ${cfg.maxRugScore}`;
    return { action: 'skip', sizeSol: 0, reason: `${why} (rug ${report.rugScore})` };
  }

  const copy = isCopyTradeHit(ev, cfg);
  const size = cfg.solPerToken;
  if (size <= 0) return { action: 'skip', sizeSol: 0, reason: 'size is 0' };

  const tags: string[] = [
    `rug ${report.rugScore}`,
    `dev ${state.devHoldingPct}%`,
  ];
  if (state.liquidityUsd > 0) tags.push(`liq $${Math.round(state.liquidityUsd / 1000)}k`);
  if (copy) tags.push('copy-trade hit');
  if (report.verdict === 'warn') tags.push('warn');

  return {
    action: 'buy',
    sizeSol: size,
    reason: `passed · ${tags.join(' · ')}`,
    copyTrade: copy,
  };
}
