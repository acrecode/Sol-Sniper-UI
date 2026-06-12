import type { RawEvent } from '../ingestion/types.js';
import type { LaunchEvent } from '../types.js';
import { PROGRAM_IDS } from '../util/constants.js';
import { matchFromLogsOrAccounts } from './pumpfun.js';

const MINT_RE = /mint=([1-9A-HJ-NP-Za-km-z]{32,44})/;
const CREATOR_RE = /creator=([1-9A-HJ-NP-Za-km-z]{32,44})/;

/**
 * Detect a PumpSwap pool creation = graduation moment (instructions.md §4.2).
 * Highest-signal entry for "graduation snipe" strategies.
 */
export function detectPumpswap(e: RawEvent): LaunchEvent | null {
  if (e.programId !== PROGRAM_IDS.PUMPSWAP) return null;
  const isPoolCreate = e.logs.some(
    (l) => /Instruction: CreatePool\b/.test(l) || /create_pool/i.test(l),
  );
  if (!isPoolCreate) return null;

  const mint = matchFromLogsOrAccounts(e, MINT_RE, 0);
  if (!mint) return null;
  const creator = matchFromLogsOrAccounts(e, CREATOR_RE, 1);

  return {
    source: 'pumpswap_pool',
    mint,
    creator: creator ?? 'unknown',
    signature: e.signature,
    slot: e.slot,
    detectedAt: e.receivedAt,
    poolAddress: e.accounts?.[2],
    curveProgressPct: 100,
  };
}
