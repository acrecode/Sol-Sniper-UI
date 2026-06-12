import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Local serial-scammer blacklist + heuristics (instructions.md §4.3 #7).
 * Seed the set from your own do-not-touch list and from confirmed rug creators;
 * a real deployment would also walk the funder graph.
 */
const KNOWN_RUGGERS = new Set<string>([
  // add confirmed serial-rugger creator/funder wallets here
]);

export function registerRugger(addr: string): void {
  KNOWN_RUGGERS.add(addr.trim());
}

export function checkDevReputation(
  s: TokenState,
  _cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  const flagged = KNOWN_RUGGERS.has(s.creator);
  return {
    devReputation: {
      pass: !flagged,
      value: flagged ? 'known-rugger' : 'clean',
      severity: 'critical',
      note: flagged ? 'creator on serial-scammer list' : undefined,
    },
  };
}
