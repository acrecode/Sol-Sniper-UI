import {
  type Connection,
  type Keypair,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { withRetry } from '../util/retry.js';

/**
 * Build → sign → send → confirm a v0 transaction with bounded retries and
 * slot-expiry awareness (instructions.md §4.5). Used by the live execution path.
 */
export async function sendAndConfirm(opts: {
  conn: Connection;
  signer: Keypair;
  instructions: TransactionInstruction[];
}): Promise<string> {
  const { conn, signer, instructions } = opts;

  return withRetry(
    async () => {
      const { blockhash, lastValidBlockHeight } =
        await conn.getLatestBlockhash('confirmed');
      const msg = new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([signer]);

      const sig = await conn.sendTransaction(tx, {
        skipPreflight: true,
        maxRetries: 0,
      });
      const conf = await conn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (conf.value.err) {
        throw new Error(`tx failed: ${JSON.stringify(conf.value.err)}`);
      }
      return sig;
    },
    { retries: 2, label: 'sendAndConfirm', minDelayMs: 150 },
  );
}
