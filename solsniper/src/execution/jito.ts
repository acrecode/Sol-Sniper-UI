import { PublicKey, SystemProgram, type TransactionInstruction } from '@solana/web3.js';
import { JITO_TIP_ACCOUNTS, LAMPORTS_PER_SOL } from '../util/constants.js';

/**
 * Jito bundle helpers (instructions.md §4.5). Building the tip instruction is
 * real; submitting the bundle to the block engine requires `jito-ts` + a
 * configured endpoint and is left as the wiring point (`submitBundle`).
 */
export function pickTipAccount(): PublicKey {
  const a = JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]!;
  return new PublicKey(a);
}

export function tipInstruction(
  from: PublicKey,
  tipSol: number,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: from,
    toPubkey: pickTipAccount(),
    lamports: Math.max(1000, Math.round(tipSol * LAMPORTS_PER_SOL)),
  });
}

/** Default tip when "auto": small, scales with fee aggressiveness. */
export function autoTipSol(feeAggr: number): number {
  return 0.0001 * feeAggr;
}

/**
 * Submit a signed bundle to the Jito block engine.
 * TODO(live): implement via jito-ts SearcherClient against JITO_BLOCK_ENGINE_URL,
 * then poll bundle status; fall back to normal send if it doesn't land in N slots.
 */
export async function submitBundle(_serializedTxs: Uint8Array[]): Promise<string> {
  throw new Error('jito-bundle-submit-not-wired');
}
