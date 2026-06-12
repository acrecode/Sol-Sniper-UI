import { randomUUID } from 'node:crypto';
import type { Executor } from '../execution/index.js';
import type { PositionRepo } from '../store/repos.js';
import type { Ledger } from '../store/ledger.js';
import type { RiskGates } from '../risk/gates.js';
import type { EventBus } from '../util/bus.js';
import type {
  ExitConfigSnapshot,
  LaunchEvent,
  Position,
  TokenState,
} from '../types.js';
import type { StrategyConfig } from '../config/schema.js';
import type { BuyFill } from '../execution/index.js';
import { evaluateExit } from './exits.js';
import { totalPnlSol, gainPct } from './pnl.js';
import { parseTpLadder } from '../strategy/filters.js';
import { logger } from '../util/logger.js';

/**
 * Manages open positions: tight price loop, exit-rule evaluation, partial/full
 * exits, breakeven-after-TP, and balance reconciliation (instructions.md §4.6).
 */
export class PositionManager {
  private positions = new Map<string, Position>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private executor: Executor,
    private repo: PositionRepo,
    private ledger: Ledger,
    private gates: RiskGates,
    private bus: EventBus,
    private getCfg: () => StrategyConfig,
    private pollMs = 1500,
  ) {
    // rehydrate open positions from disk on startup
    for (const p of repo.open()) this.positions.set(p.id, p);
  }

  get openCount(): number {
    return this.positions.size;
  }

  list(): Position[] {
    return [...this.positions.values()];
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Open a position from a confirmed buy fill. */
  open(
    ev: LaunchEvent,
    state: TokenState,
    fill: BuyFill,
    cfg: StrategyConfig,
  ): Position {
    const snapshot: ExitConfigSnapshot = {
      tpLadder: parseTpLadder(cfg.tpLadder),
      stopLoss: cfg.stopLoss,
      trailing: cfg.trailing,
      maxHoldMin: cfg.maxHoldMin,
      liqDropExit: cfg.liqDropExit,
      breakeven: cfg.breakeven,
      aggrTP: cfg.aggrTP,
      aggrTrigger: cfg.aggrTrigger,
      aggrSellPct: cfg.aggrSellPct,
      fastExit: cfg.fastExit,
      entryLiquidityUsd: state.liquidityUsd,
    };
    const p: Position = {
      id: randomUUID(),
      mint: ev.mint,
      source: ev.source,
      entryPrice: fill.price,
      currentPrice: fill.price,
      sizeSol: fill.sizeSol,
      tokenAmount: fill.tokenAmount,
      openedAt: Date.now(),
      status: 'open',
      realizedPnlSol: 0,
      highWaterPrice: fill.price,
      breakevenArmed: false,
      firstTpHit: false,
      exitSnapshot: snapshot,
    };
    this.positions.set(p.id, p);
    this.repo.save(p);

    this.ledger.append({
      id: randomUUID(),
      positionId: p.id,
      mint: p.mint,
      side: 'buy',
      sizeSol: fill.sizeSol,
      tokenAmount: fill.tokenAmount,
      price: fill.price,
      signature: fill.signature,
      reason: 'entry',
      mode: fill.simulated ? 'paper' : 'live',
      ts: Date.now(),
    });

    this.bus.emitEvent('fill', {
      mint: p.mint,
      side: 'buy',
      sizeSol: fill.sizeSol,
      price: fill.price,
      signature: fill.signature,
      simulated: fill.simulated,
    });
    this.bus.emitEvent('position', this.toView(p));
    return p;
  }

  /** Manual sell of a single position (UI "SELL NOW"). */
  async manualSell(id: string): Promise<boolean> {
    const p = this.positions.get(id);
    if (!p) return false;
    const price = await this.executor.oracle.price(p.mint);
    await this.exit(p, 1, price, 'manual sell', true);
    return true;
  }

  /** Flush: market-sell every open position now (kill-switch flush mode). */
  async flushAll(): Promise<void> {
    for (const p of [...this.positions.values()]) {
      const price = await this.executor.oracle.price(p.mint);
      await this.exit(p, 1, price, 'flush', true);
    }
  }

  private async tick(): Promise<void> {
    const cfg = this.getCfg();
    for (const p of [...this.positions.values()]) {
      if (p.status !== 'open') continue;
      try {
        const price = await this.executor.oracle.price(p.mint);
        if (price <= 0) continue;
        p.currentPrice = price;
        if (price > p.highWaterPrice) p.highWaterPrice = price;

        const action = evaluateExit(p, {
          now: Date.now(),
          currentPrice: price,
          // liquidity tracking would read the pool live; reuse entry value here
          currentLiquidityUsd: p.exitSnapshot.entryLiquidityUsd,
        });

        if (action) {
          await this.exit(p, action.sellFraction, price, action.reason, action.fast);
        } else {
          this.repo.save(p);
          this.bus.emitEvent('position', this.toView(p));
        }
      } catch (err) {
        logger.warn({ mint: p.mint, err: String(err) }, 'position tick failed');
        this.gates.breaker.recordError();
      }
    }
  }

  private async exit(
    p: Position,
    fraction: number,
    price: number,
    reason: string,
    fast: boolean,
  ): Promise<void> {
    const cfg = this.getCfg();
    const sellTokens = Math.min(p.tokenAmount, p.tokenAmount * fraction);
    if (sellTokens <= 0) return;

    p.status = 'closing';
    let fill;
    try {
      fill = await this.executor.sell(p, sellTokens, price, cfg, fast);
    } catch (err) {
      logger.error({ mint: p.mint, err: String(err) }, 'sell failed');
      this.gates.breaker.recordError();
      p.status = 'open';
      return;
    }

    const costBasis = sellTokens * p.entryPrice;
    const pnl = fill.sizeSolOut - costBasis;
    p.realizedPnlSol += pnl;
    p.tokenAmount -= sellTokens;
    p.firstTpHit = true;
    if (p.exitSnapshot.breakeven) p.breakevenArmed = true;

    this.ledger.append({
      id: randomUUID(),
      positionId: p.id,
      mint: p.mint,
      side: 'sell',
      sizeSol: fill.sizeSolOut,
      tokenAmount: sellTokens,
      price,
      signature: fill.signature,
      pnlSol: pnl,
      reason,
      mode: fill.simulated ? 'paper' : 'live',
      ts: Date.now(),
    });

    const closed = p.tokenAmount <= 1e-9;
    if (closed) {
      p.status = 'closed';
      this.positions.delete(p.id);
      this.gates.breaker.recordTrade(p.realizedPnlSol);
    } else {
      p.status = 'open';
    }
    this.repo.save(p);

    this.bus.emitEvent('exit', {
      mint: p.mint,
      reason,
      pnlSol: pnl,
      gainPct: gainPct(p.entryPrice, price),
      fraction,
      closed,
      signature: fill.signature,
      simulated: fill.simulated,
    });
    this.bus.emitEvent('position', this.toView(p));
  }

  toView(p: Position) {
    return {
      id: p.id,
      mint: p.mint,
      source: p.source,
      entry: p.entryPrice,
      price: p.currentPrice,
      pnlPct: gainPct(p.entryPrice, p.currentPrice),
      totalPnlSol: totalPnlSol(p, p.currentPrice),
      sizeSol: p.sizeSol,
      status: p.status,
      exit: this.describeExit(p),
    };
  }

  private describeExit(p: Position): string {
    const x = p.exitSnapshot;
    const parts: string[] = [];
    if (x.tpLadder.length)
      parts.push('TP ' + x.tpLadder.map((r) => `${r.gainPct}:${r.sellPct}`).join('/'));
    parts.push(`SL -${x.stopLoss}%`);
    if (x.trailing > 0) parts.push(`trail ${x.trailing}%`);
    if (p.breakevenArmed) parts.push('BE armed');
    return parts.join(' · ');
  }
}
