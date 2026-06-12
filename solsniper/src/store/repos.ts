import type { DB } from './db.js';
import type {
  Position,
  SafetyReport,
  TokenState,
  LaunchEvent,
} from '../types.js';
import { StrategySchema, type StrategyConfig } from '../config/schema.js';

const ACTIVE_CONFIG_KEY = 'active_strategy';

export class ConfigRepo {
  constructor(private db: DB) {}

  getStrategy(): StrategyConfig {
    const row = this.db
      .prepare('SELECT value_json FROM configs WHERE key = ?')
      .get(ACTIVE_CONFIG_KEY) as { value_json: string } | undefined;
    if (!row) return StrategySchema.parse({});
    // re-validate so schema changes heal old rows
    return StrategySchema.parse(JSON.parse(row.value_json));
  }

  setStrategy(cfg: StrategyConfig): StrategyConfig {
    const parsed = StrategySchema.parse(cfg);
    this.db
      .prepare(
        `INSERT INTO configs (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at`,
      )
      .run(ACTIVE_CONFIG_KEY, JSON.stringify(parsed), Date.now());
    return parsed;
  }
}

export class TokenRepo {
  constructor(private db: DB) {}

  upsertFromLaunch(ev: LaunchEvent): void {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO tokens (mint, creator, source, name, symbol, status, first_seen, last_update)
         VALUES (@mint,@creator,@source,@name,@symbol,'seen',@now,@now)
         ON CONFLICT(mint) DO UPDATE SET last_update=@now`,
      )
      .run({
        mint: ev.mint,
        creator: ev.creator,
        source: ev.source,
        name: ev.name ?? null,
        symbol: ev.symbol ?? null,
        now,
      });
  }

  setStatus(mint: string, status: string, state?: TokenState): void {
    this.db
      .prepare(
        `UPDATE tokens SET status=?, last_update=?, state_json=COALESCE(?, state_json) WHERE mint=?`,
      )
      .run(status, Date.now(), state ? JSON.stringify(state) : null, mint);
  }

  list(status?: string, limit = 200): any[] {
    if (status) {
      return this.db
        .prepare(
          'SELECT * FROM tokens WHERE status = ? ORDER BY last_update DESC LIMIT ?',
        )
        .all(status, limit);
    }
    return this.db
      .prepare('SELECT * FROM tokens ORDER BY last_update DESC LIMIT ?')
      .all(limit);
  }
}

export class SafetyRepo {
  constructor(private db: DB) {}

  save(report: SafetyReport): void {
    this.db
      .prepare(
        `INSERT INTO safety_reports (mint, rug_score, verdict, checks_json, ts)
         VALUES (?,?,?,?,?)`,
      )
      .run(
        report.mint,
        Math.round(report.rugScore),
        report.verdict,
        JSON.stringify(report.checks),
        Date.now(),
      );
  }
}

export class PositionRepo {
  constructor(private db: DB) {}

  save(p: Position): void {
    this.db
      .prepare(
        `INSERT INTO positions
          (id, mint, source, entry_price, current_price, size_sol, token_amount, opened_at,
           status, realized_pnl_sol, high_water_price, breakeven_armed, first_tp_hit, exit_snapshot_json)
         VALUES
          (@id,@mint,@source,@entryPrice,@currentPrice,@sizeSol,@tokenAmount,@openedAt,
           @status,@realizedPnlSol,@highWaterPrice,@breakevenArmed,@firstTpHit,@exitSnapshot)
         ON CONFLICT(id) DO UPDATE SET
           current_price=excluded.current_price,
           token_amount=excluded.token_amount,
           status=excluded.status,
           realized_pnl_sol=excluded.realized_pnl_sol,
           high_water_price=excluded.high_water_price,
           breakeven_armed=excluded.breakeven_armed,
           first_tp_hit=excluded.first_tp_hit`,
      )
      .run({
        ...p,
        breakevenArmed: p.breakevenArmed ? 1 : 0,
        firstTpHit: p.firstTpHit ? 1 : 0,
        exitSnapshot: JSON.stringify(p.exitSnapshot),
      });
  }

  open(): Position[] {
    return this.db
      .prepare(`SELECT * FROM positions WHERE status IN ('open','closing')`)
      .all()
      .map(rowToPosition);
  }

  all(limit = 200): Position[] {
    return this.db
      .prepare('SELECT * FROM positions ORDER BY opened_at DESC LIMIT ?')
      .all(limit)
      .map(rowToPosition);
  }
}

function rowToPosition(r: any): Position {
  return {
    id: r.id,
    mint: r.mint,
    source: r.source,
    entryPrice: r.entry_price,
    currentPrice: r.current_price,
    sizeSol: r.size_sol,
    tokenAmount: r.token_amount,
    openedAt: r.opened_at,
    status: r.status,
    realizedPnlSol: r.realized_pnl_sol,
    highWaterPrice: r.high_water_price,
    breakevenArmed: !!r.breakeven_armed,
    firstTpHit: !!r.first_tp_hit,
    exitSnapshot: JSON.parse(r.exit_snapshot_json),
  };
}
