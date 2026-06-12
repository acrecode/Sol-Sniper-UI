import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Honeypot / tax checks (instructions.md §4.3 #3, #8).
 *
 * The real implementation simulates a dust sell immediately after buy and reads
 * the effective out-amount; here we approximate from enriched state: a token
 * with many buys and ~zero sells is the classic sell-blocked signature, and
 * SPL tokens should have 0/0 tax. The execution engine performs the actual
 * sell-simulation before a live buy lands.
 */
export function checkHoneypot(
  s: TokenState,
  cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  const out: Record<string, SafetyCheck> = {};

  if (cfg.reqHoneypotSim) {
    const sellBlocked = s.buys >= 20 && s.sells === 0;
    out.honeypot = {
      pass: !sellBlocked,
      value: `${s.buys}b/${s.sells}s`,
      severity: 'critical',
      note: sellBlocked ? 'many buys, no sells — sells likely blocked' : undefined,
    };
  }

  out.buyTax = {
    pass: s.buyTaxPct <= cfg.maxBuyTax,
    value: s.buyTaxPct,
    severity: 'med',
  };
  out.sellTax = {
    pass: s.sellTaxPct <= cfg.maxSellTax,
    value: s.sellTaxPct,
    severity: 'high',
  };

  return out;
}
