import type { SafetyCheck, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * SPL vs Token-2022. If Token-2022, transfer hooks / fee config / permanent
 * delegate are high severity — they can block or redirect sells or hide taxes
 * (instructions.md §4.3 #2).
 */
export function checkTokenProgram(
  s: TokenState,
  cfg: StrategyConfig,
): Record<string, SafetyCheck> {
  const out: Record<string, SafetyCheck> = {};

  if (cfg.tokenProgram === 'spl_only') {
    out.tokenProgram = {
      pass: !s.isToken2022,
      value: s.isToken2022 ? 'token-2022' : 'spl',
      severity: 'high',
      note: s.isToken2022 ? 'Token-2022 rejected (spl_only policy)' : undefined,
    };
    return out;
  }

  // allow_t22: permitted but inspect dangerous extensions
  out.tokenProgram = {
    pass: true,
    value: s.isToken2022 ? 'token-2022' : 'spl',
    severity: 'low',
  };
  if (s.isToken2022) {
    const dangerous = s.token2022Extensions.filter((x) =>
      ['transferHook', 'permanentDelegate'].includes(x),
    );
    out.t22Extensions = {
      pass: dangerous.length === 0,
      value: s.token2022Extensions.join(',') || 'none',
      severity: dangerous.length ? 'critical' : 'low',
      note: dangerous.length ? `dangerous: ${dangerous.join(',')}` : undefined,
    };
  }
  return out;
}
