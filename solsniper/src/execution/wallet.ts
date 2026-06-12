import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { logger } from '../util/logger.js';

/**
 * Bot hot-wallet signer (instructions.md §4.5). The only thing that can sign
 * snipes AND auto-sells with no prompts. Load from env or at runtime via the UI.
 * The secret key never leaves this object — never logged, serialized, or
 * returned by the API.
 */
export class WalletManager {
  private keypair: Keypair | null = null;

  /** @returns true on success. Accepts base58 secret key (64-byte). */
  loadFromBase58(secret: string): boolean {
    try {
      const bytes = bs58.decode(secret.trim());
      const kp = Keypair.fromSecretKey(bytes);
      this.keypair = kp;
      logger.info({ pubkey: kp.publicKey.toBase58() }, 'bot wallet loaded');
      return true;
    } catch (err) {
      logger.error('failed to load wallet key (decode error)');
      return false;
    }
  }

  loadFromEnv(secret: string | undefined): boolean {
    if (!secret) return false;
    return this.loadFromBase58(secret);
  }

  unload(): void {
    this.keypair = null;
  }

  get loaded(): boolean {
    return this.keypair !== null;
  }

  get pubkey(): string | null {
    return this.keypair?.publicKey.toBase58() ?? null;
  }

  /** Internal use only by the execution engine. */
  signer(): Keypair {
    if (!this.keypair) throw new Error('no signer loaded');
    return this.keypair;
  }
}
