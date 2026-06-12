import type { Connection } from '@solana/web3.js';
import type { TokenState } from '../types.js';

/**
 * Price oracle. In live mode this should quote PumpSwap reserves or the Jupiter
 * price API (instructions.md §4.6). For dry-run / no-RPC we model price with a
 * deterministic-seeded random walk so positions move and exits actually fire,
 * making the position manager observable end-to-end.
 */
export class PriceOracle {
  private walks = new Map<string, { price: number; drift: number }>();

  constructor(private conn: Connection | null) {}

  /** Establish the entry price for a fresh fill. */
  seed(mint: string, state: TokenState): number {
    // crude entry price in SOL/token from liquidity if available, else tiny
    const base =
      state.liquiditySol > 0
        ? state.liquiditySol / 1_000_000_000
        : 1e-7 * (1 + (hash(mint) % 50) / 10);
    // memecoins are volatile; bias drift slightly negative (most go to zero)
    const drift = -0.01 + ((hash(mint + 'd') % 100) / 100) * 0.05;
    this.walks.set(mint, { price: base, drift });
    return base;
  }

  /** Next price tick. */
  async price(mint: string): Promise<number> {
    if (this.conn) {
      const live = await this.quoteLive(mint);
      if (live != null) return live;
    }
    const w = this.walks.get(mint);
    if (!w) return 0;
    // geometric random walk with occasional spikes
    const shock = (Math.random() - 0.5) * 0.18 + w.drift;
    const spike = Math.random() < 0.04 ? (Math.random() - 0.3) * 0.8 : 0;
    w.price = Math.max(1e-12, w.price * (1 + shock + spike));
    return w.price;
  }

  /** Live quote stub — wire PumpSwap reserves / Jupiter price here. */
  private async quoteLive(_mint: string): Promise<number | null> {
    return null;
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
