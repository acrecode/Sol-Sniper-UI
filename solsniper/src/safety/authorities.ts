import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Authority checks. Note (instructions.md §4.3 #1): native pump.fun sets
 * mint/freeze authority null by default, so a *non-null* here on a pump.fun
 * token is a strong anomaly, not a routine fail.
 */
export function checkAuthorities(
  s: TokenState,
  cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  const out: Record<string, SafetyCheck> = {};

  if (cfg.reqMintRevoked) {
    const anomaly = s.source === 'pumpfun_curve' && !s.mintAuthorityNull;
    out.mintAuthority = {
      pass: s.mintAuthorityNull,
      value: s.mintAuthorityNull,
      severity: anomaly ? 'critical' : 'high',
      note: anomaly ? 'non-null on pump.fun token (anomaly)' : undefined,
    };
  }

  if (cfg.reqFreezeRevoked) {
    const anomaly = s.source === 'pumpfun_curve' && !s.freezeAuthorityNull;
    out.freezeAuthority = {
      pass: s.freezeAuthorityNull,
      value: s.freezeAuthorityNull,
      severity: anomaly ? 'critical' : 'high',
      note: anomaly ? 'non-null on pump.fun token (anomaly)' : undefined,
    };
  }

  if (cfg.reqUpdateRevoked) {
    out.updateAuthority = {
      pass: s.updateAuthorityNull,
      value: s.updateAuthorityNull,
      severity: 'med',
    };
  } else {
    // flag-only: mutable metadata noted but non-blocking
    out.metadataMutable = {
      pass: true,
      value: s.mutableMetadata,
      severity: 'low',
      note: s.mutableMetadata ? 'metadata mutable (flag only)' : undefined,
    };
  }

  return out;
}
