import type { Connection } from '@solana/web3.js';
import type { LaunchEvent, SafetyCheck, SafetyReport, TokenState } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';
import { Enricher } from './enrich.js';
import { checkAuthorities } from './authorities.js';
import { checkTokenProgram } from './token-program.js';
import { checkHolders } from './holders.js';
import { checkLiquidity } from './liquidity.js';
import { checkHoneypot } from './honeypot.js';
import { checkDevReputation } from './dev-reputation.js';
import { scoreReport } from './score.js';

export interface SafetyResult {
  state: TokenState;
  report: SafetyReport;
}

/** Runs the full filter chain and produces a SafetyReport. */
export class SafetyEngine {
  private enricher: Enricher;

  constructor(
    conn: Connection | null,
    private failClosed: boolean, // true in devnet/live
  ) {
    this.enricher = new Enricher(conn);
  }

  async evaluate(ev: LaunchEvent, cfg: StrategyConfig): Promise<SafetyResult> {
    const state = await this.enricher.enrich(ev);

    const checks: Record<string, SafetyCheck> = {
      ...checkAuthorities(state, cfg),
      ...checkTokenProgram(state, cfg),
      ...checkHolders(state, cfg),
      ...checkLiquidity(state, cfg),
      ...checkHoneypot(state, cfg),
      ...checkDevReputation(state, cfg),
    };

    // Fail-closed: unresolved enrichment counts as a failing high-severity
    // check in devnet/live (instructions.md §10). In dry-run it's informational.
    if (state.incomplete) {
      checks.dataComplete = {
        pass: !this.failClosed,
        value: false,
        severity: 'high',
        note: 'enrichment incomplete (RPC/indexer gap)',
      };
    }

    const report = scoreReport(
      ev.mint,
      checks,
      cfg.maxRugScore,
      this.failClosed,
    );
    return { state, report };
  }
}

export { Enricher };
