import { Connection, PublicKey } from '@solana/web3.js';
import type { IngestionSource, RawEvent } from './types.js';
import { PROGRAM_IDS } from '../util/constants.js';
import { logger } from '../util/logger.js';

/**
 * Helius WS `logsSubscribe` fallback (instructions.md §4.1). Subscribes to the
 * relevant program IDs and forwards each matching tx as a RawEvent. Slower than
 * Yellowstone gRPC but needs only a standard RPC endpoint.
 */
export class WsIngestion implements IngestionSource {
  readonly kind = 'ws' as const;
  private conn: Connection | null = null;
  private subIds: number[] = [];
  private connected = false;

  constructor(
    private wsUrl: string,
    private httpUrl: string,
  ) {}

  async start(onEvent: (e: RawEvent) => void): Promise<void> {
    this.conn = new Connection(this.httpUrl, {
      wsEndpoint: this.wsUrl,
      commitment: 'processed',
    });

    const programs = [
      PROGRAM_IDS.PUMPFUN,
      PROGRAM_IDS.PUMPSWAP,
      PROGRAM_IDS.RAYDIUM_AMM_V4,
    ];

    for (const pid of programs) {
      const subId = this.conn.onLogs(
        new PublicKey(pid),
        (log, ctx) => {
          if (log.err) return; // skip failed txns
          onEvent({
            programId: pid,
            signature: log.signature,
            slot: ctx.slot,
            receivedAt: Date.now(),
            logs: log.logs,
            source: 'ws',
          });
        },
        'processed',
      );
      this.subIds.push(subId);
      logger.info({ program: pid, subId }, 'ws: subscribed to program logs');
    }

    this.connected = true;
  }

  async stop(): Promise<void> {
    if (this.conn) {
      for (const id of this.subIds) {
        try {
          await this.conn.removeOnLogsListener(id);
        } catch {
          /* ignore */
        }
      }
    }
    this.subIds = [];
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
