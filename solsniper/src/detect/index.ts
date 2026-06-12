import type { RawEvent } from '../ingestion/types.js';
import type { LaunchEvent } from '../types.js';
import { detectPumpfun } from './pumpfun.js';
import { detectPumpswap } from './pumpswap.js';
import { detectRaydium } from './raydium.js';

const DEDUP_WINDOW_MS = 30_000;

/**
 * Unified launch detector: runs source-specific decoders and dedups the same
 * mint across sources within a short window (instructions.md §4.2).
 */
export class LaunchDetector {
  private seen = new Map<string, number>(); // mint -> last detectedAt

  detect(e: RawEvent): LaunchEvent | null {
    const ev =
      detectPumpswap(e) ?? detectPumpfun(e) ?? detectRaydium(e) ?? null;
    if (!ev) return null;

    const now = ev.detectedAt;
    const prev = this.seen.get(ev.mint);
    if (prev && now - prev < DEDUP_WINDOW_MS) return null;
    this.seen.set(ev.mint, now);

    // opportunistic GC of the dedup map
    if (this.seen.size > 5000) {
      for (const [m, t] of this.seen) {
        if (now - t > DEDUP_WINDOW_MS) this.seen.delete(m);
      }
    }
    return ev;
  }
}
