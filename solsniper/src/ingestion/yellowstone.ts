import type { IngestionSource, RawEvent } from './types.js';
import { logger } from '../util/logger.js';

/**
 * Yellowstone gRPC (Geyser) ingestion — the low-latency primary path
 * (instructions.md §4.1, milestone 10). Implemented as a guarded stub: wiring
 * `@triton-one/yellowstone-grpc` requires a real Helius gRPC endpoint+token to
 * verify, so we keep the interface and fail over to WS when unavailable.
 *
 * To enable: add `@triton-one/yellowstone-grpc`, subscribe to transactions for
 * the program IDs in constants.ts, and map each update into a RawEvent below.
 */
export class YellowstoneIngestion implements IngestionSource {
  readonly kind = 'grpc' as const;
  private connected = false;

  constructor(
    private url: string,
    private token: string | undefined,
  ) {}

  async start(_onEvent: (e: RawEvent) => void): Promise<void> {
    logger.warn(
      { url: this.url },
      'yellowstone gRPC not yet wired — caller should fall back to WS',
    );
    // Intentionally throw so the manager fails over cleanly.
    throw new Error('yellowstone-grpc-not-implemented');
  }

  async stop(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
