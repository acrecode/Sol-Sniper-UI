import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { LaunchEvent } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Builds the buy instructions for a launch (instructions.md §4.5):
 *   pumpfun_curve → pump.fun on-curve buy
 *   pumpswap_pool → PumpSwap swap
 *   else          → Jupiter route
 *
 * The compute-budget instructions are real; the swap instruction itself is the
 * program-specific wiring point. It must be verified against live mainnet
 * program layouts before live trading, so it throws until implemented.
 */
export async function buildBuyInstructions(opts: {
  conn: Connection;
  signer: Keypair;
  ev: LaunchEvent;
  sizeSol: number;
  cfg: StrategyConfig;
  cuPriceMicroLamports: number;
}): Promise<TransactionInstruction[]> {
  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: opts.cuPriceMicroLamports,
    }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ];

  // TODO(live): append the real swap instruction per source.
  //   - pumpfun_curve: pump.fun `buy` (bonding curve PDA, associated bonding
  //     curve, global, fee recipient, slippage min-out from cfg.maxSlippage)
  //   - pumpswap_pool: PumpSwap `swap` against the graduated pool
  //   - raydium_pool : Raydium swap or Jupiter route
  throw new Error(
    `buy-instruction-builder-not-wired for source=${opts.ev.source} (verify program layout on mainnet first)`,
  );
}
