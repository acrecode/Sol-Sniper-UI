import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type TransactionInstruction,
} from '@solana/web3.js';
import type { Position } from '../types.js';
import type { StrategyConfig } from '../config/schema.js';

/**
 * Builds sell instructions for a (partial) exit. Sells prefer the best route
 * (Jupiter post-graduation). Same wiring caveat as buy.ts: the swap instruction
 * is program-specific and must be verified on mainnet before live use.
 *
 * `fast` raises the CU price for the dump-on-green fast-exit path (§4.6).
 */
export async function buildSellInstructions(opts: {
  conn: Connection;
  signer: Keypair;
  position: Position;
  tokenAmount: number;
  cfg: StrategyConfig;
  cuPriceMicroLamports: number;
  fast: boolean;
}): Promise<TransactionInstruction[]> {
  const cuPrice = opts.fast
    ? opts.cuPriceMicroLamports * 3
    : opts.cuPriceMicroLamports;

  const ixs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: cuPrice }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
  ];

  // TODO(live): append the real sell/swap instruction (Jupiter route preferred
  // post-graduation; PumpSwap swap otherwise) with min-out from cfg.maxSlippage.
  throw new Error(
    `sell-instruction-builder-not-wired for mint=${opts.position.mint} (verify route on mainnet first)`,
  );
}
