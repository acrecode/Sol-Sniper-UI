import type { Env } from '../config/schema.js';
import type { IngestionSource, RawEvent } from './types.js';
import { YellowstoneIngestion } from './yellowstone.js';
import { WsIngestion } from './ws-fallback.js';
import { SimulatedIngestion } from './simulated.js';
import { logger } from '../util/logger.js';

export type StreamKind = 'grpc' | 'ws' | 'none';

/**
 * Picks the best available ingestion source and fails over:
 *   Yellowstone gRPC → WS logsSubscribe → simulated (dry-run, no RPC).
 */
export class IngestionManager {
  private active: IngestionSource | null = null;
  private onEvent: ((e: RawEvent) => void) | null = null;

  constructor(private env: Env) {}

  get streamKind(): StreamKind {
    if (!this.active) return 'none';
    return this.active.kind;
  }

  isConnected(): boolean {
    return this.active?.isConnected() ?? false;
  }

  async start(onEvent: (e: RawEvent) => void): Promise<void> {
    this.onEvent = onEvent;

    // 1) gRPC (preferred)
    if (this.env.YELLOWSTONE_GRPC_URL) {
      const ys = new YellowstoneIngestion(
        this.env.YELLOWSTONE_GRPC_URL,
        this.env.YELLOWSTONE_GRPC_TOKEN,
      );
      try {
        await ys.start(onEvent);
        this.active = ys;
        logger.info('ingestion: using Yellowstone gRPC');
        return;
      } catch (err) {
        logger.warn({ err: String(err) }, 'ingestion: gRPC failed, falling back to WS');
      }
    }

    // 2) WS fallback (needs RPC + WS URL)
    if (this.env.SOLANA_WS_URL && this.env.SOLANA_RPC_URL) {
      const ws = new WsIngestion(this.env.SOLANA_WS_URL, this.env.SOLANA_RPC_URL);
      try {
        await ws.start(onEvent);
        this.active = ws;
        logger.info('ingestion: using WS logsSubscribe fallback');
        return;
      } catch (err) {
        logger.error({ err: String(err) }, 'ingestion: WS failed');
      }
    }

    // 3) simulated (dry-run, no chain access)
    if (this.env.MODE === 'dry-run') {
      const sim = new SimulatedIngestion();
      await sim.start(onEvent);
      this.active = sim;
      return;
    }

    throw new Error(
      'No ingestion source available: set SOLANA_RPC_URL + SOLANA_WS_URL (or YELLOWSTONE_GRPC_URL).',
    );
  }

  async stop(): Promise<void> {
    await this.active?.stop();
    this.active = null;
  }
}

export type { RawEvent };
