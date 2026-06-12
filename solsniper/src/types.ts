import type { Source, StrategyConfig } from './config/schema.js';

/* ── Launch detection ───────────────────────────────────────────── */

export interface LaunchEvent {
  source: Source;
  mint: string;
  creator: string; // dev/creator wallet
  signature: string;
  slot: number;
  detectedAt: number; // ms epoch
  poolAddress?: string; // AMM sources
  curveProgressPct?: number; // pumpfun_curve
  initialLiquiditySol?: number;
  name?: string;
  symbol?: string;
}

/* ── Token enrichment (gathered before / during safety) ─────────── */

export interface TokenState {
  mint: string;
  creator: string;
  source: Source;
  name?: string;
  symbol?: string;
  isToken2022: boolean;
  mintAuthorityNull: boolean;
  freezeAuthorityNull: boolean;
  updateAuthorityNull: boolean;
  mutableMetadata: boolean;
  token2022Extensions: string[]; // e.g. ['transfer_hook','transfer_fee']
  devHoldingPct: number;
  top10Pct: number;
  largestNonPoolPct: number;
  bundlePct: number;
  holderCount: number;
  lpBurnedOrLocked: boolean;
  liquidityUsd: number;
  liquiditySol: number;
  buyTaxPct: number;
  sellTaxPct: number;
  buys: number;
  sells: number;
  ageSec: number;
  hasSocials: boolean;
  /** true when a field could not be resolved (fail-closed in live). */
  incomplete: boolean;
}

/* ── Safety ─────────────────────────────────────────────────────── */

export type Severity = 'low' | 'med' | 'high' | 'critical';

export interface SafetyCheck {
  pass: boolean;
  value: number | string | boolean;
  severity: Severity;
  note?: string;
}

export interface SafetyReport {
  mint: string;
  checks: Record<string, SafetyCheck>;
  rugScore: number; // 0 safe .. 100 certain rug
  verdict: 'pass' | 'warn' | 'block';
}

/* ── Strategy ───────────────────────────────────────────────────── */

export interface Decision {
  action: 'buy' | 'skip';
  sizeSol: number;
  reason: string;
  copyTrade?: boolean;
}

/* ── Positions & ledger ─────────────────────────────────────────── */

export interface Position {
  id: string;
  mint: string;
  source: Source;
  entryPrice: number; // SOL per token
  currentPrice: number;
  sizeSol: number; // SOL deployed
  tokenAmount: number; // tokens held
  openedAt: number;
  status: 'open' | 'closing' | 'closed';
  realizedPnlSol: number;
  highWaterPrice: number; // for trailing
  breakevenArmed: boolean;
  firstTpHit: boolean;
  exitSnapshot: ExitConfigSnapshot;
}

export interface ExitConfigSnapshot {
  tpLadder: Array<{ gainPct: number; sellPct: number }>;
  stopLoss: number;
  trailing: number;
  maxHoldMin: number;
  liqDropExit: number;
  breakeven: boolean;
  aggrTP: boolean;
  aggrTrigger: number;
  aggrSellPct: number;
  fastExit: boolean;
  entryLiquidityUsd: number;
}

export type LedgerSide = 'buy' | 'sell';

export interface LedgerEntry {
  id: string;
  positionId: string;
  mint: string;
  side: LedgerSide;
  sizeSol: number;
  tokenAmount: number;
  price: number;
  signature: string;
  pnlSol?: number;
  reason: string;
  mode: string;
  ts: number;
}

/* ── Live event bus (also streamed to UI over /ws) ──────────────── */

export type EngineEventType =
  | 'detection'
  | 'decision'
  | 'fill'
  | 'exit'
  | 'gate'
  | 'position'
  | 'state'
  | 'log';

export interface EngineEvent {
  type: EngineEventType;
  ts: number;
  data: unknown;
}

/* ── Runtime control state surfaced to the UI ───────────────────── */

export interface EngineState {
  mode: string;
  armed: boolean;
  streamConnected: boolean;
  streamKind: 'grpc' | 'ws' | 'none';
  signerLoaded: boolean;
  signerPubkey: string | null;
  gates: {
    killed: boolean;
    breakerTripped: boolean;
    dailyCapUsedSol: number;
    dailyCapSol: number;
    openPositions: number;
    maxConcurrent: number;
  };
}

export type { StrategyConfig };
