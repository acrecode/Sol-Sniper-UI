import type { Position } from '../types.js';

export function gainPct(entry: number, current: number): number {
  if (entry <= 0) return 0;
  return ((current - entry) / entry) * 100;
}

/** Unrealized value (SOL) of the tokens still held at the current price. */
export function unrealizedSol(p: Position, current: number): number {
  return p.tokenAmount * current;
}

/** Total PnL = realized + (current value of remaining - cost basis of remaining). */
export function totalPnlSol(p: Position, current: number): number {
  const remainingCostBasis = p.tokenAmount * p.entryPrice;
  const remainingValue = p.tokenAmount * current;
  return p.realizedPnlSol + (remainingValue - remainingCostBasis);
}
