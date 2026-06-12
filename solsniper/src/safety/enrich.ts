import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, getMint } from '@solana/spl-token';
import type { LaunchEvent, TokenState } from '../types.js';
import { KNOWN_NON_HOLDER_ADDRESSES } from '../util/constants.js';
import { logger } from '../util/logger.js';

/**
 * Builds the TokenState the safety chain operates on.
 *  - With a Connection: reads mint authorities, token program, and holder
 *    distribution on-chain. Anything it can't resolve sets `incomplete` so the
 *    chain can fail-closed in live mode (instructions.md §10).
 *  - Without a Connection (dry-run, no RPC): synthesizes deterministic but
 *    varied state from the mint so the pipeline yields realistic buy/skip mixes.
 */
export class Enricher {
  constructor(private conn: Connection | null) {}

  async enrich(ev: LaunchEvent): Promise<TokenState> {
    if (!this.conn) return synthesize(ev);
    try {
      return await this.onChain(ev);
    } catch (err) {
      logger.warn(
        { mint: ev.mint, err: String(err) },
        'enrich: on-chain read failed; returning incomplete state',
      );
      const s = synthesize(ev);
      s.incomplete = true;
      return s;
    }
  }

  private async onChain(ev: LaunchEvent): Promise<TokenState> {
    const conn = this.conn!;
    const mintPk = new PublicKey(ev.mint);
    const acct = await conn.getParsedAccountInfo(mintPk);
    const owner = acct.value?.owner?.toBase58();
    const isToken2022 = owner === TOKEN_2022_PROGRAM_ID.toBase58();

    const mintInfo = await getMint(
      conn,
      mintPk,
      'processed',
      isToken2022 ? TOKEN_2022_PROGRAM_ID : undefined,
    );

    // Token-2022 extensions of concern
    const extensions: string[] = [];
    const parsed: any = acct.value?.data;
    if (isToken2022 && parsed?.parsed?.info?.extensions) {
      for (const x of parsed.parsed.info.extensions) {
        if (
          ['transferHook', 'transferFeeConfig', 'permanentDelegate'].includes(
            x.extension,
          )
        )
          extensions.push(x.extension);
      }
    }

    // holder distribution from largest token accounts
    let top10Pct = 0;
    let largestNonPoolPct = 0;
    let holderCount = 0;
    let incomplete = false;
    try {
      const largest = await conn.getTokenLargestAccounts(mintPk);
      const supply = Number(mintInfo.supply);
      if (supply > 0 && largest.value.length) {
        const amounts = largest.value.map((a) => Number(a.amount));
        const top10 = amounts.slice(0, 10).reduce((s, a) => s + a, 0);
        top10Pct = (top10 / supply) * 100;
        const nonPool = largest.value.filter(
          (a) => !KNOWN_NON_HOLDER_ADDRESSES.has(a.address.toBase58()),
        );
        largestNonPoolPct = nonPool.length
          ? (Number(nonPool[0]!.amount) / supply) * 100
          : 0;
        holderCount = largest.value.length; // lower-bound; full count needs an indexer
      } else {
        incomplete = true;
      }
    } catch {
      incomplete = true;
    }

    return {
      mint: ev.mint,
      creator: ev.creator,
      source: ev.source,
      name: ev.name,
      symbol: ev.symbol,
      isToken2022,
      mintAuthorityNull: mintInfo.mintAuthority === null,
      freezeAuthorityNull: mintInfo.freezeAuthority === null,
      // metadata authority needs a Metaplex read; mark unresolved -> incomplete
      updateAuthorityNull: false,
      mutableMetadata: true,
      token2022Extensions: extensions,
      // dev %, bundle %, liquidity, taxes need indexer / pool reads (not yet wired)
      devHoldingPct: 0,
      top10Pct,
      largestNonPoolPct,
      bundlePct: 0,
      holderCount,
      lpBurnedOrLocked: ev.source !== 'pumpfun_curve',
      liquidityUsd: ev.initialLiquiditySol ? ev.initialLiquiditySol * 150 : 0,
      liquiditySol: ev.initialLiquiditySol ?? 0,
      buyTaxPct: 0,
      sellTaxPct: 0,
      buys: 0,
      sells: 0,
      ageSec: 0,
      hasSocials: false,
      incomplete: true || incomplete, // metadata + dev%/bundle not yet resolved on-chain
    };
  }
}

/** Deterministic pseudo-random in [0,1) from a string+salt. */
function rand(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function synthesize(ev: LaunchEvent): TokenState {
  const m = ev.mint;
  const isT22 = rand(m, 1) < 0.12;
  const dev = +(rand(m, 2) * 14).toFixed(1);
  const top10 = +(15 + rand(m, 3) * 45).toFixed(1);
  const single = +(5 + rand(m, 4) * 25).toFixed(1);
  const bundle = +(rand(m, 5) * 45).toFixed(1);
  const holders = Math.round(3 + rand(m, 6) * 120);
  const liqSol = ev.source === 'pumpfun_curve' ? 0 : +(rand(m, 7) * 120).toFixed(1);
  const honeypot = rand(m, 8) < 0.12;
  const graduated = ev.source !== 'pumpfun_curve';

  return {
    mint: m,
    creator: ev.creator,
    source: ev.source,
    name: ev.name ?? `Mock ${m.slice(0, 4)}`,
    symbol: ev.symbol ?? m.slice(0, 4).toUpperCase(),
    isToken2022: isT22,
    mintAuthorityNull: rand(m, 9) > 0.05, // pump.fun usually null
    freezeAuthorityNull: rand(m, 10) > 0.05,
    updateAuthorityNull: rand(m, 11) > 0.5,
    mutableMetadata: rand(m, 12) > 0.5,
    token2022Extensions: isT22
      ? rand(m, 13) < 0.5
        ? ['transferFeeConfig']
        : ['transferHook']
      : [],
    devHoldingPct: dev,
    top10Pct: top10,
    largestNonPoolPct: single,
    bundlePct: bundle,
    holderCount: holders,
    lpBurnedOrLocked: graduated ? rand(m, 14) > 0.2 : false,
    liquidityUsd: Math.round(liqSol * 150),
    liquiditySol: liqSol,
    buyTaxPct: isT22 ? Math.round(rand(m, 15) * 8) : 0,
    sellTaxPct: isT22 ? Math.round(rand(m, 16) * 10) : 0,
    buys: Math.round(rand(m, 17) * 200),
    sells: honeypot ? 0 : Math.round(rand(m, 18) * 120),
    ageSec: Math.round(rand(m, 19) * 600),
    hasSocials: rand(m, 20) > 0.5,
    incomplete: false,
  };
}
