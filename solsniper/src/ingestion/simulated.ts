import type { IngestionSource, RawEvent } from './types.js';
import { PROGRAM_IDS } from '../util/constants.js';
import { logger } from '../util/logger.js';

/**
 * Synthetic launch generator for dry-run with no RPC configured. Lets the whole
 * pipeline (detect → safety → strategy → paper execution → positions) be
 * exercised and observed in the UI without touching the chain.
 */
export class SimulatedIngestion implements IngestionSource {
  readonly kind = 'ws' as const; // reported as ws-class for UI purposes
  private timer: NodeJS.Timeout | null = null;
  private connected = false;
  private n = 0;

  constructor(private intervalMs = 6000) {}

  async start(onEvent: (e: RawEvent) => void): Promise<void> {
    this.connected = true;
    logger.warn(
      'ingestion: no RPC configured — emitting SIMULATED launches for dry-run',
    );
    const programs = [PROGRAM_IDS.PUMPSWAP, PROGRAM_IDS.PUMPFUN];
    this.timer = setInterval(() => {
      const pid = programs[this.n % programs.length]!;
      const mint = fakeBase58(`mint${this.n}`);
      onEvent({
        programId: pid,
        signature: fakeBase58(`sig${this.n}`),
        slot: 300_000_000 + this.n,
        receivedAt: Date.now(),
        logs: [
          `Program ${pid} invoke [1]`,
          this.n % 2 === 0 ? 'Program log: Instruction: CreatePool' : 'Program log: Instruction: Create',
          `Program log: mint=${mint} creator=${fakeBase58('dev' + (this.n % 4))}`,
          `Program ${pid} success`,
        ],
        accounts: [mint, fakeBase58('dev' + (this.n % 4))],
        source: 'ws',
      });
      this.n++;
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** Deterministic pseudo-base58 string ~44 chars, for readable mock mints. */
function fakeBase58(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 44; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    out += B58[h % B58.length];
  }
  return out;
}
