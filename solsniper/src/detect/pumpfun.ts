import type { RawEvent } from '../ingestion/types.js';
import type { LaunchEvent } from '../types.js';
import { PROGRAM_IDS } from '../util/constants.js';

const MINT_RE = /mint=([1-9A-HJ-NP-Za-km-z]{32,44})/;
const CREATOR_RE = /creator=([1-9A-HJ-NP-Za-km-z]{32,44})/;

/**
 * Detect a pump.fun bonding-curve create/mint. WS path decodes from logs;
 * the gRPC upgrade should decode the `create` instruction's account list and
 * the bonding-curve account directly for exact mint/creator/progress.
 */
export function detectPumpfun(e: RawEvent): LaunchEvent | null {
  if (e.programId !== PROGRAM_IDS.PUMPFUN) return null;
  const isCreate = e.logs.some(
    (l) => /Instruction: Create\b/.test(l) || /InitializeMint/.test(l),
  );
  if (!isCreate) return null;

  const mint = matchFromLogsOrAccounts(e, MINT_RE, 0);
  const creator = matchFromLogsOrAccounts(e, CREATOR_RE, 1);
  if (!mint) return null;

  return {
    source: 'pumpfun_curve',
    mint,
    creator: creator ?? 'unknown',
    signature: e.signature,
    slot: e.slot,
    detectedAt: e.receivedAt,
    curveProgressPct: 0,
  };
}

export function matchFromLogsOrAccounts(
  e: RawEvent,
  re: RegExp,
  accountIdx: number,
): string | null {
  for (const l of e.logs) {
    const m = l.match(re);
    if (m) return m[1]!;
  }
  return e.accounts?.[accountIdx] ?? null;
}
