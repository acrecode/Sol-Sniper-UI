import type { DB } from './db.js';
import type { LedgerEntry } from '../types.js';

/** Append-only trade ledger. Intentionally no update/delete methods. */
export class Ledger {
  private insertStmt;

  constructor(private db: DB) {
    this.insertStmt = db.prepare(`
      INSERT INTO ledger
        (id, position_id, mint, side, size_sol, token_amount, price, signature, pnl_sol, reason, mode, ts)
      VALUES
        (@id, @positionId, @mint, @side, @sizeSol, @tokenAmount, @price, @signature, @pnlSol, @reason, @mode, @ts)
    `);
  }

  append(e: LedgerEntry): void {
    this.insertStmt.run({
      ...e,
      pnlSol: e.pnlSol ?? null,
    });
  }

  recent(limit = 100): LedgerEntry[] {
    return this.db
      .prepare('SELECT * FROM ledger ORDER BY ts DESC LIMIT ?')
      .all(limit)
      .map(rowToEntry);
  }

  /** Total SOL spent on buys within the rolling window (for the daily cap). */
  spentSince(sinceTs: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(size_sol),0) AS spent FROM ledger WHERE side='buy' AND ts >= ?`,
      )
      .get(sinceTs) as { spent: number };
    return row.spent;
  }

  realizedPnlSince(sinceTs: number): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(pnl_sol),0) AS pnl FROM ledger WHERE side='sell' AND ts >= ?`,
      )
      .get(sinceTs) as { pnl: number };
    return row.pnl;
  }
}

function rowToEntry(r: any): LedgerEntry {
  return {
    id: r.id,
    positionId: r.position_id,
    mint: r.mint,
    side: r.side,
    sizeSol: r.size_sol,
    tokenAmount: r.token_amount,
    price: r.price,
    signature: r.signature,
    pnlSol: r.pnl_sol ?? undefined,
    reason: r.reason,
    mode: r.mode,
    ts: r.ts,
  };
}
