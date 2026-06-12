import type { LaunchEvent, TokenState } from '../types.js';
import type { Phase, StrategyConfig } from '../config/schema.js';

/** Parse a multi-line / space / comma separated address list into a Set. */
export function parseAddressList(raw: string): Set<string> {
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((x) => x.trim())
      .filter(Boolean),
  );
}

export function parseKeywords(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/** Parse "100:50, 400:25" into sorted ladder rungs. */
export function parseTpLadder(
  raw: string,
): Array<{ gainPct: number; sellPct: number }> {
  return raw
    .split(',')
    .map((seg) => seg.trim())
    .filter(Boolean)
    .map((seg) => {
      const [g, s] = seg.split(':').map((x) => Number(x.trim()));
      return { gainPct: g ?? 0, sellPct: s ?? 0 };
    })
    .filter((r) => r.gainPct > 0 && r.sellPct > 0)
    .sort((a, b) => a.gainPct - b.gainPct);
}

/** Map a launch's source + curve progress to a discovery phase. */
export function phaseOf(ev: LaunchEvent): Phase {
  if (ev.source === 'pumpfun_curve') {
    const p = ev.curveProgressPct ?? 0;
    if (p <= 5) return 'new_mint';
    return 'mid_curve';
  }
  // AMM pool creation is the graduation moment
  return ev.source === 'pumpswap_pool' || ev.source === 'raydium_pool'
    ? 'at_grad'
    : 'post_grad';
}

export interface FilterFail {
  reason: string;
}

/**
 * Pre-safety, cheap structural filters (source/phase/curve window/lists/
 * social/keywords). Returns null if the launch passes, else the failing reason.
 */
export function applyStructuralFilters(
  ev: LaunchEvent,
  state: TokenState,
  cfg: StrategyConfig,
): FilterFail | null {
  // source
  if (!cfg.sources.includes(ev.source))
    return { reason: `source ${ev.source} not enabled` };

  // blacklist
  const blacklist = parseAddressList(cfg.blacklist);
  if (blacklist.has(ev.creator) || blacklist.has(ev.mint))
    return { reason: 'blacklisted address' };

  // whitelist (if non-empty, only these creators allowed)
  const whitelist = parseAddressList(cfg.whitelist);
  if (whitelist.size > 0 && !whitelist.has(ev.creator))
    return { reason: 'creator not in whitelist' };

  // phase
  const phase = phaseOf(ev);
  if (!cfg.phases.includes(phase))
    return { reason: `phase ${phase} not enabled` };

  // curve progress window (only meaningful on-curve)
  if (ev.source === 'pumpfun_curve' && ev.curveProgressPct != null) {
    const p = ev.curveProgressPct;
    if (p < cfg.curveMin || p > cfg.curveMax)
      return { reason: `curve ${p}% outside [${cfg.curveMin},${cfg.curveMax}]` };
  }

  // social
  if (cfg.reqSocial && !state.hasSocials)
    return { reason: 'no socials (X/site/TG required)' };

  // keyword blocklist on name/symbol
  const kws = parseKeywords(cfg.keywordBlock);
  if (kws.length) {
    const hay = `${state.name ?? ''} ${state.symbol ?? ''}`.toLowerCase();
    const hit = kws.find((k) => hay.includes(k));
    if (hit) return { reason: `keyword blocked: "${hit}"` };
  }

  return null;
}

export function isCopyTradeHit(ev: LaunchEvent, cfg: StrategyConfig): boolean {
  const copy = parseAddressList(cfg.copyTrade);
  return copy.has(ev.creator);
}
