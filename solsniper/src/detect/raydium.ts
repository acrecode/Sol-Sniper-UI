import type { RawEvent } from '../ingestion/types.js';
import type { LaunchEvent } from '../types.js';
import { PROGRAM_IDS } from '../util/constants.js';
import { matchFromLogsOrAccounts } from './pumpfun.js';

const MINT_RE = /mint=([1-9A-HJ-NP-Za-km-z]{32,44})/;

/**
 * Detect Raydium pool init / migration (legacy pump→Raydium route and
 * Raydium-native launches, e.g. LaunchLab). instructions.md §4.2.
 */
export function detectRaydium(e: RawEvent): LaunchEvent | null {
  if (
    e.programId !== PROGRAM_IDS.RAYDIUM_AMM_V4 &&
    e.programId !== PROGRAM_IDS.RAYDIUM_CPMM
  )
    return null;
  const isInit = e.logs.some(
    (l) => /initialize2?/i.test(l) || /Instruction: Initialize/.test(l),
  );
  if (!isInit) return null;

  const mint = matchFromLogsOrAccounts(e, MINT_RE, 0);
  if (!mint) return null;

  return {
    source: 'raydium_pool',
    mint,
    creator: 'unknown',
    signature: e.signature,
    slot: e.slot,
    detectedAt: e.receivedAt,
    poolAddress: e.accounts?.[2],
    curveProgressPct: 100,
  };
}
