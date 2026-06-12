# SolSniper — Implementation Instructions

*(internal id: solana_launch__meme_sniper)*

**Status:** planned
**Stack:** TypeScript · Solana · Helius · Jito
**For:** Claude Code (build this end to end from the spec below)

---

## 0. What this is

A Solana memecoin sniper. It watches new launches on **pump.fun** (bonding curve) and the AMMs where those tokens trade (**PumpSwap** by default in 2026, plus **Raydium**), runs each candidate through a safety/rug filter chain, applies the user's strategy filters, and — if a candidate passes — builds and lands a buy with configurable slippage and priority/Jito fees. Every open position is then managed automatically with take-profit, stop-loss, and trailing logic until it exits.

A web UI sits on top for configuration and monitoring: strategy filters (including address whitelists/blacklists and copy-trade lists), SOL-per-token sizing, and live position/PnL view.

**Critical 2026 context — read before coding:**
- pump.fun tokens mint on a bonding curve, then **graduate at ~$69k market cap (~85 SOL on the curve)**. Graduation now goes to pump.fun's **own AMM, PumpSwap** (constant-product, Uniswap-v2 style, 0.25% fee), *not* Raydium by default. Older tokens and some launchpads still route to Raydium, so support both.
- On graduation, **LP tokens are burned**, so migration liquidity can't be pulled — but it's thin (~$10–15k). Migration-liquidity rugs are mostly solved; the real risk moved elsewhere.
- pump.fun auto-sets **mint authority = null and freeze authority = null**. So for native pump.fun tokens those two classic checks pass by default. Do **not** treat "mint/freeze revoked" as sufficient. The live risk surface is now: **dev/creator holdings, block-0 bundle concentration, sniper-wallet clustering, Token-2022 transfer hooks / fee extensions, mutable metadata, thin liquidity, and dev wallets linked to prior rugs.** Build the filter chain around those.
- Pro-grade detection uses **Yellowstone gRPC (Geyser) streams** for ~400ms-pre-confirm visibility into mint/create txns. Helius provides this plus enhanced RPC. WebSocket `logsSubscribe`/`blockSubscribe` is the slower fallback.

This is high-risk capital deployment in an adversarial environment. The architecture below treats risk gates (kill switch, circuit breaker, daily cap, reconciliation, dry-run mode) as first-class, not afterthoughts.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Language | TypeScript (Node 20+), strict mode |
| Solana SDK | `@solana/web3.js` (v1.x) + `@solana/spl-token`; consider `@solana/kit` if preferred |
| Data stream | Helius Yellowstone gRPC (`@triton-one/yellowstone-grpc`) primary; Helius WS RPC fallback |
| RPC | Helius (dedicated/staked endpoint for low latency) |
| Landing | Jito block-engine (bundles + tips) via `jito-ts`; standard priority fees as fallback |
| Quotes/routing | Jupiter API (for non-curve swaps, sells, and price); direct pump.fun/PumpSwap program calls for on-curve and graduation snipes |
| Persistence | SQLite (via `better-sqlite3`) for single-node; Postgres if scaling |
| Backend API | Fastify (REST + WebSocket) to serve the UI |
| Frontend | React + Vite (control panel — see `/ui`) |
| Config | `.env` + a typed config loader (zod-validated) |
| Logging | `pino` (structured JSON logs) + a trade ledger table |

---

## 2. Architecture

```
            ┌────────────────────────────────────────────────────────┐
            │                     CONTROL PLANE                        │
            │   React UI  ◄──REST/WS──►  Fastify API server            │
            └───────────────┬────────────────────────────────────────┘
                            │ config, commands (start/stop/kill), live state
                            ▼
┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐   ┌───────────────────┐
│  INGESTION   │──►│ LAUNCH DETECTOR │──►│ SAFETY / RUG     │──►│  STRATEGY/FILTER  │
│ Yellowstone  │   │ pump.fun mint   │   │ ENGINE           │   │  ENGINE           │
│ gRPC + WS    │   │ PumpSwap grad   │   │ (filter chain +  │   │ (user filters,    │
│              │   │ Raydium pool    │   │  rug score)      │   │  whitelist, copy) │
└──────────────┘   └─────────────────┘   └──────────────────┘   └─────────┬─────────┘
                                                                           │ passes
                                                                           ▼
┌──────────────┐   ┌─────────────────┐   ┌──────────────────┐   ┌───────────────────┐
│  RISK GATES  │◄─►│ EXECUTION       │   │ POSITION MANAGER │   │  PERSISTENCE      │
│ kill switch  │   │ ENGINE          │──►│ TP / SL / trail  │──►│  + LEDGER + LOGS  │
│ daily cap    │   │ build/sign/land │   │ time/liq exits   │   │  (SQLite)         │
│ breaker      │   │ (priority+Jito) │   │                  │   │                   │
└──────────────┘   └─────────────────┘   └──────────────────┘   └───────────────────┘
```

**Data flow:** stream event → detect launch → enrich token state → safety chain → strategy filter → risk-gate check → execute buy → open position → manage → exit → record. Each stage emits structured events the UI subscribes to.

---

## 3. Project structure

```
solsniper/
├─ package.json
├─ tsconfig.json
├─ .env.example
├─ src/
│  ├─ index.ts                  # bootstrap, wires everything, graceful shutdown
│  ├─ config/
│  │  ├─ schema.ts              # zod schema for env + strategy config
│  │  └─ load.ts
│  ├─ ingestion/
│  │  ├─ yellowstone.ts         # gRPC subscribe to program accounts/txns
│  │  ├─ ws-fallback.ts         # logsSubscribe/blockSubscribe fallback
│  │  └─ types.ts
│  ├─ detect/
│  │  ├─ pumpfun.ts             # decode pump.fun create/mint instr
│  │  ├─ pumpswap.ts            # decode PumpSwap pool-create (graduation)
│  │  ├─ raydium.ts             # decode Raydium pool init / migration acct
│  │  └─ index.ts               # unified LaunchEvent emitter
│  ├─ safety/
│  │  ├─ authorities.ts         # mint/freeze/update authority checks
│  │  ├─ token-program.ts       # SPL vs Token-2022, transfer hooks, fee ext
│  │  ├─ holders.ts             # top-holder concentration, dev %, bundle %
│  │  ├─ liquidity.ts           # LP burned/locked, depth
│  │  ├─ honeypot.ts            # sell-simulation, buy/sell tax, sell-block
│  │  ├─ dev-reputation.ts      # serial-scammer / linked-wallet lookup
│  │  ├─ score.ts               # composite rug score (0-100) + verdict
│  │  └─ index.ts               # runs chain, returns SafetyReport
│  ├─ strategy/
│  │  ├─ filters.ts             # all user-configurable filters (see §6)
│  │  ├─ presets.ts             # Conservative/Balanced/Degen/Copy/Grad
│  │  └─ evaluate.ts            # token + SafetyReport + strategy -> decision
│  ├─ execution/
│  │  ├─ buy.ts                 # build buy (curve / PumpSwap / Jupiter)
│  │  ├─ sell.ts
│  │  ├─ priority-fee.ts        # congestion-based CU price estimator
│  │  ├─ jito.ts                # bundle assembly + tip + submit
│  │  ├─ wallet.ts              # keypair mgmt (env / file / multi-wallet)
│  │  └─ submit.ts              # send + confirm + retry policy
│  ├─ positions/
│  │  ├─ manager.ts             # open positions, polling price, exit rules
│  │  ├─ exits.ts               # TP ladder, SL, trailing, time, liq-drop
│  │  └─ pnl.ts
│  ├─ risk/
│  │  ├─ gates.ts               # daily cap, max concurrent, per-token cap
│  │  ├─ breaker.ts             # circuit breaker on loss streak / error rate
│  │  └─ killswitch.ts          # hard stop: cancel new entries, optional flush
│  ├─ store/
│  │  ├─ db.ts                  # sqlite init + migrations
│  │  ├─ ledger.ts              # immutable trade ledger
│  │  └─ repos.ts               # positions, tokens, configs
│  ├─ api/
│  │  ├─ server.ts              # Fastify REST + WS
│  │  └─ routes/                # /config /positions /events /control
│  └─ util/
│     ├─ logger.ts
│     └─ retry.ts
└─ ui/                          # React control panel (see §7 + the .jsx file)
```

---

## 4. Module specs

### 4.1 Ingestion (`src/ingestion`)
- Primary path: Yellowstone gRPC subscription filtered to the relevant program IDs (pump.fun program, PumpSwap program, Raydium AMM program, and the pump→Raydium migration account `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg` for legacy routes). Subscribe to transactions/account updates, not full blocks, to minimize latency.
- Fallback path: Helius WS `logsSubscribe` on the same program IDs, decoding logs to reconstruct events. Auto-failover if gRPC drops, with backoff + alert.
- Emit a normalized `RawEvent` to the detector. Tag each event with a monotonic receive timestamp for latency telemetry.

### 4.2 Launch detector (`src/detect`)
Produce a unified `LaunchEvent`:
```ts
type LaunchSource = 'pumpfun_curve' | 'pumpswap_pool' | 'raydium_pool';
interface LaunchEvent {
  source: LaunchSource;
  mint: string;
  creator: string;            // dev/creator wallet
  signature: string;
  slot: number;
  detectedAt: number;         // ms
  poolAddress?: string;       // for AMM sources
  curveProgressPct?: number;  // for pumpfun_curve
  initialLiquiditySol?: number;
}
```
- `pumpfun.ts`: decode the create/mint instruction; track bonding-curve state so progress % can be derived later.
- `pumpswap.ts`: detect pool creation = graduation moment. This is the highest-signal entry for "graduation snipe" strategies.
- `raydium.ts`: decode pool init / migration account txns for the legacy route and Raydium-native launches (LaunchLab, etc.).
- Deduplicate the same mint across sources within a short window.

### 4.3 Safety / rug engine (`src/safety`)
Runs a **filter chain**; each check returns `{ pass, value, severity }`. The composite score function combines them. Default to **fail-closed** (reject on inconclusive) for anything but explicit dry-run.

Checks (each individually toggleable + thresholded from strategy config):
1. **Authorities** — mint authority null, freeze authority null, update/metadata authority null or flagged mutable. (Note: native pump.fun = null by default; treat a *non-null* here on a "pump.fun" token as a strong anomaly.)
2. **Token program** — SPL vs Token-2022. If Token-2022, inspect extensions: transfer hooks (can block/redirect sells), transfer-fee config (hidden tax), permanent-delegate (can move user tokens). Any of these = high severity.
3. **Honeypot simulation** — simulate a sell of a dust amount immediately after (or instead of) buy; if it fails or returns near-zero out, flag honeypot. Also derive effective buy/sell tax.
4. **Holder concentration** — top-10 holders %, single largest non-pool wallet %, dev/creator wallet %. Exclude known program/pool/burn addresses.
5. **Bundle / block-0 detection** — count tokens acquired by clustered wallets in the creation slot(s); high bundle % means insiders control supply.
6. **Liquidity** — LP burned/locked status; absolute depth (SOL/USD); reserve ratio sanity.
7. **Dev reputation** — has the creator wallet (or funder graph) launched prior tokens that rugged? Maintain a local blacklist + heuristic (rapid serial mints, funded by a known-scammer wallet).
8. **Activity sanity** — buy/sell ratio (many buys, ~no sells = honeypot signal), tx count, holder count, token age.

Output:
```ts
interface SafetyReport {
  mint: string;
  checks: Record<string, { pass: boolean; value: number | string | boolean; severity: 'low'|'med'|'high'|'critical' }>;
  rugScore: number;     // 0 (safe) .. 100 (certain rug)
  verdict: 'pass' | 'warn' | 'block';
}
```

### 4.4 Strategy / filter engine (`src/strategy`)
Takes `LaunchEvent + token state + SafetyReport + active StrategyConfig` and returns a `Decision { action: 'buy' | 'skip'; sizeSol: number; reason: string }`. All thresholds come from the UI-editable config (§6). This is where address whitelist/blacklist, copy-trade lists, curve-progress windows, and source selection are applied. Ship the presets in §6.5.

### 4.5 Execution engine (`src/execution`)
- **Buy path selection:** on-curve buy via pump.fun program for `pumpfun_curve`; PumpSwap swap for graduated; Jupiter route otherwise. Sells go through the same logic in reverse, preferring Jupiter for best route post-graduation.
- **Slippage:** per-strategy max slippage bps applied to min-out.
- **Priority fee:** `priority-fee.ts` estimates compute-unit price from recent fee percentiles (Helius priority-fee API or local sampling) and scales by a user "aggressiveness" multiplier.
- **Jito:** when enabled, wrap the buy in a bundle with a tip transfer to a Jito tip account; submit to the block engine. Fall back to normal send if the bundle doesn't land within N slots.
- **Wallet:** the execution engine needs a key it can sign with autonomously, so the loop has two distinct roles — do **not** treat them as interchangeable:
  - **Bot hot wallet (private key, backend):** the only thing that can sign snipes *and* auto-sells with zero prompts. Load from env (base58) or a keypair file; support a wallet pool for multi-wallet entries (stretch). Use a dedicated wallet funded with only the deploy bankroll, never the user's main wallet. Keys never touch logs, the ledger, or API responses.
  - **Phantom (UI only, optional):** a browser wallet requires a manual click per transaction, so it **cannot** drive autonomous sniping. Wire it via wallet-adapter for funding/withdrawing the bot wallet, viewing balances, and signing one-off manual sells. Arming the bot requires the bot key (or an explicitly connected signer); the UI must block ARM until a signer is loaded.
- **Submit/confirm:** bounded retries, slot-expiry awareness, idempotency by client-side dedup so the same launch never double-buys.
- **Pre-warming:** pre-build and pre-sign the buy template the instant a launch is detected to shave latency; finalize amounts/blockhash at send.

### 4.6 Position manager (`src/positions`)
- On fill, open a `Position` with entry price, size, and the strategy's exit config snapshot.
- Poll/subscribe to price (PumpSwap/Jupiter quote) on a tight interval.
- Exit rules, evaluated in priority order: **stop-loss**, **liquidity-drop auto-exit**, **aggressive take-profit (fast dump-on-green)**, **trailing stop**, **take-profit ladder**, **time-based max-hold**, **move-stop-to-breakeven** after first TP.
- **Aggressive take-profit:** when enabled, the instant a position crosses a low profit trigger (e.g. +40%) market-sell a large chunk (e.g. 80%) immediately, leaving a runner on the ladder. This must use the **fast exit path** — elevated priority fee + Jito bundle on the *sell* — so the order actually lands during a dump (memecoins round-trip in seconds; a slow exit gives the gain back). Drive it off the tight price loop / stream, not a lazy poll.
- Support partial exits (e.g., sell 50% at 2×, 25% at 5×, runner with trailing stop).
- Reconcile on-chain balances vs internal state every cycle; alert on drift.

### 4.7 Risk gates (`src/risk`)
- **Daily SOL cap** — hard ceiling on total spend per rolling 24h; stop new entries when hit.
- **Max concurrent positions** and **per-token max size**.
- **Circuit breaker** — trip on consecutive losses, drawdown %, or elevated tx-error rate; pauses entries and surfaces to UI.
- **Kill switch** — UI button + API: immediately stop new entries; optional "flush" mode to market-sell all open positions.
- Gates are checked *before* execution and continuously; tripping any updates the UI state.

### 4.8 Persistence & API (`src/store`, `src/api`)
- SQLite tables: `tokens`, `safety_reports`, `positions`, `ledger` (append-only fills/exits with signatures), `configs`, `events`.
- Fastify exposes: `GET/PUT /config`, `GET /positions`, `GET /tokens?status=`, `POST /control/{start|stop|kill|flush}`, and a `/ws` channel streaming live events (detections, decisions, fills, exits, gate trips) to the UI.

---

## 5. Operating modes (build these from day one)

- **`dry-run` / paper:** run the full pipeline, log decisions and simulated fills, place **no** real transactions. This is the default until explicitly switched.
- **`devnet`:** real txns against devnet for execution-path testing.
- **`live`:** mainnet. Requires the kill switch, daily cap, and circuit breaker to be wired and a confirmation flag.

---

## 6. Filter reference (the strategy surface the UI controls)

All of these are persisted per strategy and editable in the UI. Defaults shown are starting points, not gospel.

### 6.1 Source & discovery
- **Sources enabled:** pump.fun (on-curve), PumpSwap (graduated), Raydium / LaunchLab. (multi-select)
- **Snipe phase:** new mint (block 0–3) · mid-curve (progress window) · at-graduation · post-migration. (multi-select)
- **Bonding-curve progress window:** min % / max % (e.g., only 0–5% for earliest, or 90–100% for graduation plays).
- **Creator/dev whitelist** — *"only show / only buy from these addresses."* (the requested feature)
- **Creator/dev blacklist** — known ruggers / your own do-not-touch list.
- **Copy-trade wallets** — mirror buys from these "smart money" wallets (with own size/slippage).

### 6.2 Safety / rug gates
- Require mint authority revoked (default on)
- Require freeze authority revoked (default on)
- Require update/metadata authority revoked or flag-only (default flag)
- Token program policy: SPL only · allow Token-2022 but flag hooks/fees (default SPL-only for live)
- Require LP burned/locked (default on for graduated)
- Max dev/creator holding % (default 5%)
- Max top-10 holder concentration % (default 30%)
- Max single non-pool wallet % (default 15%)
- Max bundle / block-0 cluster % (default 20%)
- Min holder count (default 25)
- Min liquidity (SOL or USD; default $8k for post-grad, n/a on early curve)
- Honeypot sell-simulation required to pass (default on for live)
- Max buy tax % / Max sell tax % (default 0/0 for SPL; e.g. 5/5 if allowing Token-2022)
- Max rug score to allow buy (default 35)

### 6.3 Social / metadata
- Require any of: Twitter/X · website · Telegram (default off; high false-negative)
- Name/symbol keyword blocklist
- Reject duplicate name/ticker of an existing live token

### 6.4 Sizing & execution (per strategy)
- **SOL per token (buy size)** — fixed amount, or % of a configured bankroll. (the requested feature)
- Max slippage % (default 10–15% for early curve, tighter post-grad)
- Priority fee mode: auto (congestion-scaled) with aggressiveness multiplier · or fixed lamports
- Jito bundle + tip: on/off, tip amount or auto
- Max concurrent positions (default 5)
- Daily SOL spend cap (default e.g. 2 SOL)

### 6.5 Exit management (per strategy)
- **Aggressive take-profit (dump-on-green):** on/off · trigger % (low, e.g. +40%) · sell % instantly (high, e.g. 80%) · fast-exit path toggle (priority + Jito on the sell). Fires the moment the trigger is hit; remainder rides the ladder.
- Take-profit: single target % or **ladder** (e.g. sell 50% @ +100%, 25% @ +400%, runner trails)
- Stop-loss % (default −35%)
- Trailing stop % (default off; e.g. 20% once in profit)
- Time-based max hold (e.g. exit after 30 min if flat)
- Liquidity-drop auto-exit (exit if pool liquidity falls > X%)
- Move stop to breakeven after first TP (default on)

### 6.6 Presets (ship these)
- **Conservative:** post-graduation only, all safety gates strict, low rug-score cap, small size, tight SL, single TP.
- **Balanced:** mid-curve + graduation, moderate gates, TP ladder, trailing on runner.
- **Degen:** early curve, looser gates (but keep honeypot sim + bundle cap), larger slippage, aggressive priority/Jito, TP ladder.
- **Copy-trade:** driven by copy-trade wallet list; safety chain still runs; size mirrors or fixed.
- **Graduation snipe:** PumpSwap pool-create trigger only, require LP burned, thin-liquidity-aware sizing, fast TP.

---

## 7. UI (`/ui`)

A React control panel (a starting reference implementation is provided alongside this file). Required surfaces:

1. **Run bar:** mode toggle (dry-run / devnet / live), Arm / Stop, **Kill Switch** and **Flush** buttons, live status (connected, gate states, daily-cap usage). **Arm is disabled until a signer is loaded.**
2. **Wallet panel:** two tabs — *Bot key* (paste base58 for the autonomous signer; password-masked) and *Phantom* (connect for funding/manual sells). Shows loaded address + balance and makes the auto-vs-manual distinction explicit.
3. **Strategy editor:** preset selector + every filter in §6, grouped (Source · Safety · Social · Sizing · Exits). Address whitelist/blacklist and copy-trade lists are multi-line address inputs with validation. SOL-per-token is a prominent numeric input.
4. **Live feed:** stream of detections → decisions (buy/skip + reason + rug score) so the user sees *why* things were taken or skipped.
5. **Positions table:** open positions with entry, current price, PnL %, exit config, and a manual-sell button.
6. **Ledger / history:** closed trades with realized PnL, signatures (link to explorer).

Wire the UI to the Fastify API: `PUT /config` on save, `/ws` for the live feed/positions, `POST /control/*` for the buttons.

---

## 8. Build order (milestones for Claude Code)

1. Scaffold repo, config schema, logger, SQLite + migrations, `.env.example`.
2. Ingestion (WS fallback first — simplest), then the detector for `pumpfun_curve` and `pumpswap_pool`. Verify it prints real launches in dry-run.
3. Safety engine with the full filter chain + rug score. Validate against known-rug and known-clean mints.
4. Strategy engine + presets + config persistence.
5. Fastify API + the React UI, wired in dry-run so the whole pipeline is observable end to end with **no** real trades.
6. Execution engine: priority-fee estimator, buy/sell on PumpSwap + Jupiter, then Jito bundles. Test on devnet.
7. Position manager + exits.
8. Risk gates: daily cap, concurrent/per-token limits, circuit breaker, kill switch/flush.
9. Reconciliation, latency telemetry, and the trade ledger.
10. Upgrade ingestion to Yellowstone gRPC for latency. Go live only after dry-run + devnet pass and all gates are verified.

---

## 9. Environment variables (`.env.example`)

```
SOLANA_RPC_URL=                 # Helius dedicated endpoint
SOLANA_WS_URL=
HELIUS_API_KEY=
YELLOWSTONE_GRPC_URL=
YELLOWSTONE_GRPC_TOKEN=
JITO_BLOCK_ENGINE_URL=
WALLET_PRIVATE_KEY=             # base58; load securely, never log
MODE=dry-run                    # dry-run | devnet | live
DB_PATH=./data/sniper.db
API_PORT=8787
```

---

## 10. Safety, correctness, and compliance notes

- **Default to dry-run.** Live mode must require an explicit flag plus a working kill switch, daily cap, and circuit breaker.
- **Idempotency:** never double-buy a launch; dedup by mint+slot.
- **No key leakage:** private keys never touch logs, the ledger, or the API responses.
- **Fail-closed safety:** if a safety check can't resolve (RPC timeout, unknown program), treat as block in live mode.
- **Reconcile** on-chain balances against internal state every position cycle; halt on unexplained drift.
- This bot deploys real capital into an adversarial, high-loss-rate market. No filter chain catches every rug — risk gates exist to bound the damage when a check misses, not to eliminate loss. Sizing should assume total loss of any single position is possible.
- The operator is responsible for compliance with applicable laws/regulations in their jurisdiction (securities, tax, market-conduct rules) and with the terms of service of pump.fun, Helius, Jito, and any other provider used. Build it to be auditable: the append-only ledger and structured logs exist partly for that.

---

## 11. Useful constants / references

- pump.fun → Raydium legacy migration account: `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg`
- pump.fun graduation: ~$69k mcap / ~85 SOL on curve → PumpSwap pool (LP burned).
- PumpSwap: constant-product AMM, 0.25% fee (0.2% LP / 0.05% protocol).
- Confirm all current program IDs against Helius/Solscan at build time — they change.
