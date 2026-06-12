import type { Connection } from '@solana/web3.js';
import type { Env } from '../config/schema.js';
import type { StrategyConfig } from '../config/schema.js';
import type { Decision, LaunchEvent, Position, TokenState } from '../types.js';
import { WalletManager } from './wallet.js';
import { PriceOracle } from './pricing.js';
import { PriorityFeeEstimator } from './priority-fee.js';
import { autoTipSol } from './jito.js';
import { buildBuyInstructions } from './buy.js';
import { buildSellInstructions } from './sell.js';
import { sendAndConfirm } from './submit.js';
import { logger } from '../util/logger.js';

export interface BuyFill {
  price: number; // SOL per token
  tokenAmount: number;
  sizeSol: number; // SOL actually deployed
  signature: string;
  simulated: boolean;
}

export interface SellFill {
  price: number;
  tokenAmount: number; // tokens sold
  sizeSolOut: number; // SOL received
  signature: string;
  simulated: boolean;
}

/**
 * Execution engine. Dry-run simulates fills so the whole pipeline is observable
 * with zero on-chain risk (the default, instructions.md §5). devnet/live build
 * and submit real transactions via the (program-specific) instruction builders.
 * Idempotent: the same launch (mint+slot) never double-buys.
 */
export class Executor {
  private bought = new Set<string>(); // `${mint}:${slot}` dedup
  readonly oracle: PriceOracle;
  private fees: PriorityFeeEstimator;

  constructor(
    private env: Env,
    private conn: Connection | null,
    private wallet: WalletManager,
  ) {
    this.oracle = new PriceOracle(conn);
    this.fees = new PriorityFeeEstimator(conn);
  }

  private get isPaper(): boolean {
    return this.env.MODE === 'dry-run';
  }

  async buy(
    ev: LaunchEvent,
    state: TokenState,
    decision: Decision,
    cfg: StrategyConfig,
  ): Promise<BuyFill | null> {
    const key = `${ev.mint}:${ev.slot}`;
    if (this.bought.has(key)) {
      logger.debug({ key }, 'execution: dedup, skipping double-buy');
      return null;
    }
    this.bought.add(key);

    const entryPrice = this.oracle.seed(ev.mint, state);
    const tokenAmount = entryPrice > 0 ? decision.sizeSol / entryPrice : 0;

    if (this.isPaper) {
      return {
        price: entryPrice,
        tokenAmount,
        sizeSol: decision.sizeSol,
        signature: `PAPER-${key}`,
        simulated: true,
      };
    }

    // ── live / devnet ─────────────────────────────────────────────
    if (!this.conn) throw new Error('no RPC connection for live execution');
    if (!this.wallet.loaded) throw new Error('no signer loaded');

    const cuPrice = await this.fees.estimate(cfg);
    const ixs = await buildBuyInstructions({
      conn: this.conn,
      signer: this.wallet.signer(),
      ev,
      sizeSol: decision.sizeSol,
      cfg,
      cuPriceMicroLamports: cuPrice,
    });
    if (cfg.jito) {
      // tip handled inside the bundle path; autoTipSol(cfg.feeAggr) when wired
      void autoTipSol(cfg.feeAggr);
    }
    const sig = await sendAndConfirm({
      conn: this.conn,
      signer: this.wallet.signer(),
      instructions: ixs,
    });
    return {
      price: entryPrice,
      tokenAmount,
      sizeSol: decision.sizeSol,
      signature: sig,
      simulated: false,
    };
  }

  async sell(
    position: Position,
    tokenAmount: number,
    price: number,
    cfg: StrategyConfig,
    fast: boolean,
  ): Promise<SellFill> {
    const sizeSolOut = tokenAmount * price;

    if (this.isPaper) {
      return {
        price,
        tokenAmount,
        sizeSolOut,
        signature: `PAPER-SELL-${position.mint}-${Date.now()}`,
        simulated: true,
      };
    }

    if (!this.conn) throw new Error('no RPC connection for live execution');
    if (!this.wallet.loaded) throw new Error('no signer loaded');

    const cuPrice = await this.fees.estimate(cfg);
    const ixs = await buildSellInstructions({
      conn: this.conn,
      signer: this.wallet.signer(),
      position,
      tokenAmount,
      cfg,
      cuPriceMicroLamports: cuPrice,
      fast,
    });
    const sig = await sendAndConfirm({
      conn: this.conn,
      signer: this.wallet.signer(),
      instructions: ixs,
    });
    return { price, tokenAmount, sizeSolOut, signature: sig, simulated: false };
  }
}

export { WalletManager, PriceOracle };
