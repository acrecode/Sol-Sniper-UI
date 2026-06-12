  Run it: cd solsniper && 
  
  npm install && npm run dev, 
  
  then in another shell cd ui &&
  npm install && npm run dev → http://localhost:5173, click ARM, pick Degen.


# solsniper

a solana memecoin sniper with a control panel. it watches new launches on
pump.fun / pumpswap / raydium, runs each one through a safety + rug filter
chain, applies your strategy filters, and — if something passes and you've
armed it — buys, then manages the position with take-profit / stop-loss /
trailing / aggressive dump-on-green until it exits.

built from the spec in `../instructions.md`.

## important

**it runs in dry-run (paper) mode by default and that's the only mode that
actually does anything end-to-end right now.** the whole pipeline works and you
can watch it happen in the ui — detections, safety verdicts, buy/skip decisions,
simulated fills, positions opening and closing with pnl. but it places **zero
real transactions**. nothing touches the chain until you wire the live execution
code (see "what needs work" below) and explicitly turn live on.

don't point this at a funded mainnet wallet expecting it to trade. it won't yet,
and that's on purpose — better than firing off a broken transaction.

## what works today

- **the full pipeline, observable in real time.** ingest → detect → safety →
  strategy → risk gates → (paper) execution → position management → exit.
- **safety / rug chain** — mint+freeze authority, spl vs token-2022 (hooks/fees),
  holder concentration, dev %, block-0 bundle %, liquidity, honeypot heuristics,
  dev blacklist → a composite rug score + pass/warn/block verdict. fails closed.
- **strategy engine** — every filter from the ui, plus all 5 presets
  (conservative / balanced / degen / copy / graduation snipe).
- **position manager** — tp ladder, stop-loss, trailing, time exit, liquidity-drop
  exit, breakeven-after-first-tp, and the aggressive "+x% → dump y%" fast exit.
- **risk gates** — daily sol cap, max concurrent positions, circuit breaker on a
  loss streak / error rate, and a kill switch with optional flush.
- **the ui** — strategy editor (auto-saves), live feed, positions table, wallet
  panel, arm/stop/kill/flush. wired to the backend over rest + a websocket.
- **persistence** — sqlite with an append-only trade ledger + an events audit log.

with no rpc configured it generates a fake launch stream so you can play with the
whole thing offline. that's what you're seeing in dry-run.

## what needs work

these are stubbed behind clean interfaces. they **throw a clear error instead of
sending a bad transaction**, so live mode fails safe until they're done:

- **the actual swaps** (`src/execution/buy.ts`, `sell.ts`) — building the real
  pump.fun curve buy / pumpswap swap / jupiter route instructions. this is the
  big one. everything around it (compute budget, priority fee, send + confirm +
  retry) is real; the swap instruction itself isn't.
- **jito bundles** (`src/execution/jito.ts`) — the tip instruction is real,
  submitting the bundle to the block engine isn't.
- **real token enrichment** (`src/safety/enrich.ts`) — authorities + token program
  + top holders read from chain, but dev % / bundle % / liquidity / taxes need an
  indexer (helius das) + pool reads. until then those fields are marked
  "incomplete", which **fails closed and blocks every buy in live mode** — so even
  with swaps wired, you need this before live does anything.
- **live prices** (`src/execution/pricing.ts`) — positions use a fake price walk
  in dry-run; needs a real pumpswap/jupiter quote.
- **yellowstone grpc** (`src/ingestion/yellowstone.ts`) — the low-latency stream.
  the slower websocket fallback is real and works; grpc falls back to it for now.

also worth doing eventually: phantom wallet wiring in the ui (currently a stub
toggle), real on-chain balance display, and per-position partial manual sells.

## running it

dry-run, no rpc needed:

```bash
npm install
cp .env.example .env
npm run dev                          # backend on :8787

cd ui && npm install && npm run dev  # ui on :5173
```

open http://localhost:5173, click **arm**, and watch it go. try the **degen**
preset if you want more buys — the default balanced one is strict and skips a lot.

(arm in dry-run needs no wallet. in devnet/live the arm button stays disabled
until you load a bot key in the wallet panel.)

## how live would eventually work

once the swap + enrichment code above is wired:

`.env`:
```
MODE=live
CONFIRM_LIVE=true          # boot refuses live without this
SOLANA_RPC_URL=...         # helius mainnet
SOLANA_WS_URL=...
```
then in the ui: load a **dedicated throwaway** bot key (never your main wallet),
set your sol-per-token + daily cap, and arm. test on `MODE=devnet` first.

## a sober note

this deploys real capital into an adversarial, high-loss market. no filter chain
catches every rug — the risk gates exist to bound the damage when one slips
through, not to stop you losing money. size every position assuming it can go to
zero, because plenty will.
