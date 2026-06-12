import type { SafetyCheck, SafetyReport, Severity } from '../types.js';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 4,
  med: 12,
  high: 28,
  critical: 55,
};

/**
 * Composite rug score (0 safe .. 100 certain rug) + verdict.
 * Each failing check contributes its severity weight; the score is the capped
 * sum. Verdict: any failed critical => block; else compare to maxRugScore.
 */
export function scoreReport(
  mint: string,
  checks: Record<string, SafetyCheck>,
  maxRugScore: number,
  failClosed: boolean,
): SafetyReport {
  let score = 0;
  let failedCritical = false;

  for (const c of Object.values(checks)) {
    if (!c.pass) {
      score += SEVERITY_WEIGHT[c.severity];
      if (c.severity === 'critical') failedCritical = true;
    }
  }
  score = Math.min(100, Math.round(score));

  let verdict: SafetyReport['verdict'];
  if (failedCritical) verdict = 'block';
  else if (score > maxRugScore) verdict = 'block';
  else if (score > Math.floor(maxRugScore * 0.6)) verdict = 'warn';
  else verdict = 'pass';

  // fail-closed: if any check was inconclusive (handled by caller injecting an
  // 'incomplete' failing check), this just rolls into the score/critical path.
  if (failClosed && verdict === 'warn') {
    // in live mode, a warn with fail-closed semantics is treated conservatively
    // by the strategy layer; we keep verdict as-is but the score reflects risk.
  }

  return { mint, checks, rugScore: score, verdict };
}
