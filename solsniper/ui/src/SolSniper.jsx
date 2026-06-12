import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { api, openWs } from "./api.js";

/*
  SolSniper — Control Panel (wired to the Fastify backend, instructions.md §7).
    GET/PUT /config          -> load / auto-save the active strategy
    GET     /ws              -> stream detections / decisions / fills / exits / state
    POST    /control/{start|stop|kill|flush}
    POST    /wallet          -> load the bot signer (base58, never echoed back)
*/

const C = {
  bg: "#0b0a09", panel: "#131110", panel2: "#191614", border: "#2b2622",
  borderHot: "#4a3a28", text: "#ece5da", muted: "#8a8077", faint: "#5c544c",
  accent: "#f2660a", accentDeep: "#c2410c", accentSoft: "#1f1409",
  green: "#5fd38a", red: "#f0584f", yellow: "#e8b339",
};

const FONTS = `
@import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
* { box-sizing: border-box; }
.bn { font-family: 'Bebas Neue', sans-serif; letter-spacing: .04em; }
.mn { font-family: 'IBM Plex Mono', monospace; }
input, textarea, select, button { font-family: 'IBM Plex Mono', monospace; }
input:focus, textarea:focus, select:focus { outline: none; border-color: ${C.accent} !important; }
::placeholder { color: ${C.faint}; }
textarea::-webkit-scrollbar, .scroll::-webkit-scrollbar { width: 8px; height: 8px; }
textarea::-webkit-scrollbar-thumb, .scroll::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
@keyframes flash { from { background:${C.accentSoft} } to { background:transparent } }
.live-row { animation: flash 1.2s ease-out; }
`;

const SOURCES = [
  { id: "pumpfun_curve", label: "pump.fun (curve)" },
  { id: "pumpswap_pool", label: "PumpSwap (graduated)" },
  { id: "raydium_pool", label: "Raydium / LaunchLab" },
];
const PHASES = [
  { id: "new_mint", label: "New mint (block 0–3)" },
  { id: "mid_curve", label: "Mid-curve" },
  { id: "at_grad", label: "At graduation" },
  { id: "post_grad", label: "Post-migration" },
];

const SOURCE_LABEL = {
  pumpfun_curve: "pump.fun", pumpswap_pool: "PumpSwap", raydium_pool: "Raydium",
};

const shortMint = (m) => (m && m.length > 9 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m);
const hhmmss = (ts) => new Date(ts).toLocaleTimeString("en-GB", { hour12: false });

export default function SolSniper() {
  const [cfg, setCfg] = useState(null);
  const [preset, setPreset] = useState("");
  const [presetNames, setPresetNames] = useState([]);
  const [state, setState] = useState(null);
  const [feed, setFeed] = useState([]);
  const [positions, setPositions] = useState([]);
  const [open, setOpen] = useState({ src: true, safety: true, social: false, size: true, exits: true });
  const [wTab, setWTab] = useState("key");
  const [keyInput, setKeyInput] = useState("");
  const [phantom, setPhantom] = useState(false);
  const [wsUp, setWsUp] = useState(false);
  const [toast, setToast] = useState("");

  const saveTimer = useRef(null);
  const balance = "—"; // on-chain balance lookup is a backend enhancement

  /* ── initial load + ws ──────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const [c, p, s, pos] = await Promise.all([
          api.getConfig(), api.presets(), api.getState(), api.positions(),
        ]);
        setCfg(c); setPresetNames(p); setState(s); setPositions(pos);
      } catch (e) { setToast("backend offline — start `npm run dev`"); }
    })();

    let ws;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      ws = openWs(onEvent, () => setWsUp(true), () => {
        setWsUp(false);
        if (!stopped) setTimeout(connect, 1500); // only reconnect if not torn down
      });
    };
    connect();
    return () => { stopped = true; if (ws) ws.close(); };
  }, []);

  const onEvent = useCallback((ev) => {
    const { type, ts, data } = ev;
    if (type === "state") { setState(data); return; }
    if (type === "position") {
      setPositions((prev) => {
        const rest = prev.filter((p) => p.id !== data.id);
        return data.status === "closed" ? rest : [data, ...rest];
      });
      return;
    }
    if (["decision", "fill", "exit", "gate"].includes(type)) {
      setFeed((prev) => [{ id: `${ts}-${Math.random()}`, type, ts, data }, ...prev].slice(0, 60));
    }
  }, []);

  /* ── config helpers (auto-save) ─────────────────────────────── */
  const scheduleSave = useCallback((next) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.putConfig(next).catch(() => setToast("save failed"));
    }, 600);
  }, []);

  const set = (k, v) => setCfg((c) => { const n = { ...c, [k]: v }; scheduleSave(n); return n; });
  const toggleArr = (k, id) =>
    setCfg((c) => {
      const arr = c[k].includes(id) ? c[k].filter((x) => x !== id) : [...c[k], id];
      const n = { ...c, [k]: arr }; scheduleSave(n); return n;
    });
  const applyPreset = async (name) => {
    setPreset(name);
    try { const p = await api.preset(name); setCfg(p); await api.putConfig(p); }
    catch { setToast("preset load failed"); }
  };

  /* ── control actions ────────────────────────────────────────── */
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2500); };
  const armToggle = async () => {
    try {
      if (state?.armed) { const r = await api.stop(); setState(r.state); }
      else { const r = await api.start(); setState(r.state); }
    } catch (e) { flash(String(e.message || e)); }
  };
  const doKill = async () => { try { const r = await api.kill(); setState(r.state); flash("kill engaged"); } catch (e) { flash(String(e)); } };
  const doFlush = async () => { try { const r = await api.flush(); setState(r.state); flash("flushing positions"); } catch (e) { flash(String(e)); } };
  const loadKey = async () => {
    try { const r = await api.loadWallet(keyInput.trim()); flash(`wallet ${shortMint(r.pubkey)} loaded`); }
    catch (e) { flash("invalid key"); }
  };
  const sellNow = async (id) => { try { await api.sellPosition(id); } catch (e) { flash(String(e)); } };

  if (!cfg || !state) {
    return (
      <div className="mn" style={{ background: C.bg, color: C.muted, minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <style>{FONTS}</style>
        <div>{toast || "connecting to backend…"}</div>
      </div>
    );
  }

  const botReady = state.signerLoaded;
  const botPub = state.signerPubkey ? shortMint(state.signerPubkey) : null;
  const mode = state.mode;
  const running = state.armed;
  const capUsed = state.gates.dailyCapUsedSol;
  const capPct = Math.min(100, (capUsed / (state.gates.dailyCapSol || 1)) * 100);
  const wlCount = cfg.whitelist.split(/\s+/).filter(Boolean).length;
  const ctCount = cfg.copyTrade.split(/\s+/).filter(Boolean).length;
  const streamLabel = state.streamConnected ? `${state.streamKind} ●` : "down";
  const gatesOk = !state.gates.killed && !state.gates.breakerTripped;

  return (
    <div className="mn" style={{ background: C.bg, color: C.text, minHeight: "100vh", fontSize: 13 }}>
      <style>{FONTS}</style>

      {/* ── RUN BAR ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.panel, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", gap: 18, padding: "12px 20px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span className="bn" style={{ fontSize: 30, color: C.accent, lineHeight: 1 }}>SOLSNIPER</span>
          <span style={{ color: C.faint, fontSize: 11 }}>solana new-launch sniper</span>
        </div>

        <Dot on={running} label={running ? "ARMED" : "IDLE"} />
        <Pill label="STREAM" value={wsUp ? streamLabel : "ws…"} valColor={state.streamConnected ? C.green : C.red} />
        <Pill label="GATES" value={gatesOk ? "OK" : state.gates.killed ? "KILLED" : "BREAKER"} valColor={gatesOk ? C.green : C.red} />

        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 150 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.muted }}>
            <span>DAILY CAP</span><span>{capUsed.toFixed(2)}◎ / {state.gates.dailyCapSol}◎</span>
          </div>
          <div style={{ height: 5, background: C.panel2, borderRadius: 3, overflow: "hidden" }}>
            <div style={{ width: `${capPct}%`, height: "100%", background: capPct > 85 ? C.red : C.accent }} />
          </div>
        </div>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}
          title="Mode is set by the MODE env var on the backend">
          {["dry-run", "devnet", "live"].map((m) => (
            <span key={m} style={{
              background: mode === m ? (m === "live" ? C.red : C.accentDeep) : "transparent",
              color: mode === m ? "#fff" : C.faint, padding: "7px 12px",
              fontSize: 11, textTransform: "uppercase" }}>{m}</span>
          ))}
        </div>

        <button onClick={armToggle} disabled={!botReady && mode !== "dry-run"}
          title={botReady || mode === "dry-run" ? "" : "Load the bot wallet first"}
          style={{ ...btn(running ? C.panel2 : ((botReady || mode === "dry-run") ? C.accent : C.panel2), running ? C.text : ((botReady || mode === "dry-run") ? "#160c03" : C.faint)),
            opacity: (botReady || mode === "dry-run") ? 1 : 0.5, cursor: (botReady || mode === "dry-run") ? "pointer" : "not-allowed" }}>
          {running ? "■ STOP" : "▶ ARM"}
        </button>
        <button onClick={doKill} style={btn("transparent", C.red, C.red)}>⏻ KILL</button>
        <button onClick={doFlush} style={btn("transparent", C.muted, C.border)}>⇩ FLUSH</button>
      </div>

      {toast && (
        <div style={{ background: C.accentSoft, borderBottom: `1px solid ${C.borderHot}`, color: C.accent,
          padding: "7px 20px", fontSize: 12 }}>{toast}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 1fr) minmax(420px, 1.15fr)", gap: 16, padding: 16, alignItems: "start" }}>

        {/* ── STRATEGY EDITOR ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <H>Wallet</H>
              {botReady
                ? <span style={{ fontSize: 11, color: C.green }}>● {botPub}&nbsp;·&nbsp;{balance}◎</span>
                : <span style={{ fontSize: 11, color: C.red }}>○ not loaded</span>}
            </div>
            <div style={{ display: "flex", border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden", marginBottom: 10 }}>
              {[["key", "Bot key (auto-trades)"], ["phantom", "Phantom (fund / manual)"]].map(([id, lab]) => (
                <button key={id} onClick={() => setWTab(id)} style={{ flex: 1, background: wTab === id ? C.accentDeep : "transparent",
                  color: wTab === id ? "#fff" : C.muted, border: "none", padding: "8px 10px", cursor: "pointer", fontSize: 11 }}>{lab}</button>
              ))}
            </div>
            {wTab === "key" ? (
              <>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="password" value={keyInput} onChange={(e) => setKeyInput(e.target.value)}
                    placeholder="paste base58 private key (dedicated bot wallet)" style={inp} />
                  <button onClick={loadKey} disabled={keyInput.trim().length < 40} style={btn(C.accent, "#160c03")}>LOAD</button>
                </div>
                <div style={{ fontSize: 10, color: C.faint, marginTop: 7, lineHeight: 1.5 }}>
                  Signs snipes <b style={{ color: C.muted }}>and</b> auto-sells with no prompts. Use a throwaway wallet funded only
                  with what you'll deploy — never your main wallet. Key stays server-side, never logged or echoed back.
                </div>
              </>
            ) : (
              <>
                <button onClick={() => setPhantom((p) => !p)} style={{ ...btn(phantom ? C.panel2 : C.accent, phantom ? C.text : "#160c03"), width: "100%" }}>
                  {phantom ? "✓ Phantom connected — disconnect" : "Connect Phantom"}
                </button>
                <div style={{ fontSize: 10, color: C.faint, marginTop: 7, lineHeight: 1.5 }}>
                  Phantom needs a click per transaction, so it can't drive autonomous sniping. Use it to fund the bot wallet,
                  watch balances, and sign one-off manual sells. For hands-off auto-trading, load a bot key.
                </div>
              </>
            )}
          </Panel>

          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <H>Strategy</H>
              <span style={{ fontSize: 10, color: C.faint }}>auto-saves → PUT /config</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {presetNames.map((p) => (
                <button key={p} onClick={() => applyPreset(p)} style={{
                  background: preset === p ? C.accent : C.panel2, color: preset === p ? "#160c03" : C.muted,
                  border: `1px solid ${preset === p ? C.accent : C.border}`, borderRadius: 5, padding: "6px 11px",
                  cursor: "pointer", fontSize: 11 }}>{p}</button>
              ))}
            </div>
          </Panel>

          <Section title="Source & Discovery" open={open.src} onToggle={() => setOpen((o) => ({ ...o, src: !o.src }))}>
            <Label>Sources</Label>
            <Chips items={SOURCES} active={cfg.sources} onTap={(id) => toggleArr("sources", id)} />
            <Label>Snipe phase</Label>
            <Chips items={PHASES} active={cfg.phases} onTap={(id) => toggleArr("phases", id)} />
            <Row>
              <Num label="Curve progress min %" v={cfg.curveMin} on={(v) => set("curveMin", v)} />
              <Num label="Curve progress max %" v={cfg.curveMax} on={(v) => set("curveMax", v)} />
            </Row>
            <Label hot>Only buy from these addresses (whitelist){wlCount ? ` · ${wlCount}` : ""}</Label>
            <Area v={cfg.whitelist} on={(v) => set("whitelist", v)} ph={"one dev/creator address per line\nleave blank = allow all"} />
            <Label>Blacklist (never buy)</Label>
            <Area v={cfg.blacklist} on={(v) => set("blacklist", v)} ph={"known rugger / do-not-touch addresses"} />
            <Label hot>Copy-trade wallets{ctCount ? ` · ${ctCount}` : ""}</Label>
            <Area v={cfg.copyTrade} on={(v) => set("copyTrade", v)} ph={"mirror buys from these smart-money wallets"} />
          </Section>

          <Section title="Safety / Rug Gates" open={open.safety} onToggle={() => setOpen((o) => ({ ...o, safety: !o.safety }))}>
            <Toggle label="Require mint authority revoked" v={cfg.reqMintRevoked} on={(v) => set("reqMintRevoked", v)} />
            <Toggle label="Require freeze authority revoked" v={cfg.reqFreezeRevoked} on={(v) => set("reqFreezeRevoked", v)} />
            <Toggle label="Require update authority revoked" v={cfg.reqUpdateRevoked} on={(v) => set("reqUpdateRevoked", v)} />
            <Label>Token program</Label>
            <Select v={cfg.tokenProgram} on={(v) => set("tokenProgram", v)}
              opts={[["spl_only", "SPL only (safest)"], ["allow_t22", "Allow Token-2022 (flag hooks/fees)"]]} />
            <Toggle label="Require LP burned / locked" v={cfg.reqLpBurned} on={(v) => set("reqLpBurned", v)} />
            <Toggle label="Honeypot sell-simulation must pass" v={cfg.reqHoneypotSim} on={(v) => set("reqHoneypotSim", v)} />
            <Row>
              <Num label="Max dev/creator %" v={cfg.maxDevPct} on={(v) => set("maxDevPct", v)} />
              <Num label="Max top-10 %" v={cfg.maxTop10Pct} on={(v) => set("maxTop10Pct", v)} />
            </Row>
            <Row>
              <Num label="Max single wallet %" v={cfg.maxSinglePct} on={(v) => set("maxSinglePct", v)} />
              <Num label="Max bundle / block-0 %" v={cfg.maxBundlePct} on={(v) => set("maxBundlePct", v)} />
            </Row>
            <Row>
              <Num label="Min holders" v={cfg.minHolders} on={(v) => set("minHolders", v)} />
              <Num label="Min liquidity $" v={cfg.minLiqUsd} on={(v) => set("minLiqUsd", v)} step={500} />
            </Row>
            <Row>
              <Num label="Max buy tax %" v={cfg.maxBuyTax} on={(v) => set("maxBuyTax", v)} />
              <Num label="Max sell tax %" v={cfg.maxSellTax} on={(v) => set("maxSellTax", v)} />
            </Row>
            <Slider label="Max rug score to buy" v={cfg.maxRugScore} on={(v) => set("maxRugScore", v)} />
          </Section>

          <Section title="Social / Metadata" open={open.social} onToggle={() => setOpen((o) => ({ ...o, social: !o.social }))}>
            <Toggle label="Require X / website / Telegram" v={cfg.reqSocial} on={(v) => set("reqSocial", v)} />
            <Toggle label="Reject duplicate name / ticker" v={cfg.rejectDup} on={(v) => set("rejectDup", v)} />
            <Label>Name / symbol keyword blocklist</Label>
            <Area v={cfg.keywordBlock} on={(v) => set("keywordBlock", v)} ph={"comma or newline separated"} />
          </Section>

          <Section title="Sizing & Execution" open={open.size} onToggle={() => setOpen((o) => ({ ...o, size: !o.size }))}>
            <div style={{ background: C.accentSoft, border: `1px solid ${C.borderHot}`, borderRadius: 7, padding: 12, marginBottom: 10 }}>
              <Label hot>SOL per token (buy size)</Label>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input type="number" step="0.05" value={cfg.solPerToken} onChange={(e) => set("solPerToken", +e.target.value)}
                  style={{ ...inp, fontSize: 22, color: C.accent, fontWeight: 600, width: 130 }} />
                <span className="bn" style={{ fontSize: 26, color: C.accent }}>◎ SOL</span>
                <span style={{ color: C.faint, fontSize: 11, marginLeft: "auto" }}>per qualifying launch</span>
              </div>
            </div>
            <Row>
              <Num label="Max slippage %" v={cfg.maxSlippage} on={(v) => set("maxSlippage", v)} />
              <div style={{ flex: 1 }}>
                <Label>Priority fee mode</Label>
                <Select v={cfg.feeMode} on={(v) => set("feeMode", v)} opts={[["auto", "Auto (congestion)"], ["fixed", "Fixed"]]} />
              </div>
            </Row>
            <Slider label={`Fee aggressiveness ×${cfg.feeAggr}`} v={cfg.feeAggr} on={(v) => set("feeAggr", v)} min={1} max={6} />
            <Toggle label="Jito bundle + tip" v={cfg.jito} on={(v) => set("jito", v)} />
            <Row>
              <Num label="Max concurrent positions" v={cfg.maxConcurrent} on={(v) => set("maxConcurrent", v)} />
              <Num label="Daily SOL cap" v={cfg.dailyCapSol} on={(v) => set("dailyCapSol", v)} step={0.5} />
            </Row>
          </Section>

          <Section title="Exit Management" open={open.exits} onToggle={() => setOpen((o) => ({ ...o, exits: !o.exits }))}>
            <div style={{ background: cfg.aggrTP ? C.accentSoft : C.panel2, border: `1px solid ${cfg.aggrTP ? C.borderHot : C.border}`,
              borderRadius: 7, padding: 12, marginBottom: 12 }}>
              <Toggle label="⚡ Aggressive take-profit (dump on green)" v={cfg.aggrTP} on={(v) => set("aggrTP", v)} />
              {cfg.aggrTP && (
                <>
                  <Row>
                    <Num label="Trigger at +%" v={cfg.aggrTrigger} on={(v) => set("aggrTrigger", v)} />
                    <Num label="Sell % instantly" v={cfg.aggrSellPct} on={(v) => set("aggrSellPct", v)} />
                  </Row>
                  <Toggle label="Fast exit path (priority + Jito on sell)" v={cfg.fastExit} on={(v) => set("fastExit", v)} />
                  <div style={{ fontSize: 10, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
                    The moment a position hits +{cfg.aggrTrigger}%, market-sell {cfg.aggrSellPct}% immediately
                    {cfg.fastExit ? " with an elevated-fee Jito exit so it lands during the dump" : ""}; the rest rides the ladder below.
                  </div>
                </>
              )}
            </div>
            <Label>Take-profit ladder &nbsp;<span style={{ color: C.faint }}>gain%:sell% , …</span></Label>
            <input value={cfg.tpLadder} onChange={(e) => set("tpLadder", e.target.value)} style={inp} placeholder="100:50, 400:25" />
            <Row>
              <Num label="Stop-loss %" v={cfg.stopLoss} on={(v) => set("stopLoss", v)} />
              <Num label="Trailing stop % (0=off)" v={cfg.trailing} on={(v) => set("trailing", v)} />
            </Row>
            <Row>
              <Num label="Max hold (min)" v={cfg.maxHoldMin} on={(v) => set("maxHoldMin", v)} />
              <Num label="Liquidity-drop exit %" v={cfg.liqDropExit} on={(v) => set("liqDropExit", v)} />
            </Row>
            <Toggle label="Move stop to breakeven after first TP" v={cfg.breakeven} on={(v) => set("breakeven", v)} />
          </Section>
        </div>

        {/* ── LIVE + POSITIONS ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 80 }}>
          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <H>Live feed</H>
              <span style={{ fontSize: 10, color: C.faint }}>detections → decisions · /ws</span>
            </div>
            <div className="scroll" style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
              {feed.length === 0 && <div style={{ color: C.faint, fontSize: 11, padding: "10px 4px" }}>waiting for stream events…</div>}
              {feed.map((f, i) => <FeedRow key={f.id} f={f} first={i === 0} />)}
            </div>
          </Panel>

          <Panel>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <H>Open positions</H>
              <span style={{ fontSize: 10, color: C.faint }}>{positions.length} / {cfg.maxConcurrent} slots</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr .7fr .8fr", fontSize: 10, color: C.muted,
              padding: "0 6px 8px", borderBottom: `1px solid ${C.border}` }}>
              <span>TOKEN</span><span>ENTRY → NOW</span><span>SIZE</span><span style={{ textAlign: "right" }}>PnL</span>
            </div>
            {positions.length === 0 && <div style={{ color: C.faint, fontSize: 11, padding: "10px 6px" }}>no open positions</div>}
            {positions.map((p) => (
              <div key={p.id} style={{ padding: "10px 6px", borderBottom: `1px solid ${C.panel2}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr .7fr .8fr", alignItems: "center" }}>
                  <span style={{ color: C.text }}>{shortMint(p.mint)}</span>
                  <span style={{ color: C.muted, fontSize: 11 }}>{fmtPrice(p.entry)}→{fmtPrice(p.price)}</span>
                  <span style={{ color: C.muted }}>{p.sizeSol.toFixed(2)}◎</span>
                  <span style={{ textAlign: "right", fontWeight: 600, color: p.pnlPct >= 0 ? C.green : C.red }}>
                    {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(0)}%
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span style={{ color: C.faint, fontSize: 10 }}>{p.exit}</span>
                  <button onClick={() => sellNow(p.id)} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.muted,
                    borderRadius: 4, padding: "3px 10px", cursor: "pointer", fontSize: 10 }}>SELL NOW</button>
                </div>
              </div>
            ))}
          </Panel>

          <div style={{ fontSize: 10, color: C.faint, lineHeight: 1.6, padding: "0 4px" }}>
            Mode <b style={{ color: mode === "live" ? C.red : C.accent }}>{mode}</b>.
            Live trading deploys real capital in an adversarial market — no filter chain catches every rug;
            the gates bound the damage, they don't remove it.
          </div>
        </div>
      </div>
    </div>
  );
}

function FeedRow({ f, first }) {
  const { type, ts, data } = f;
  let act, good, reason, mint, src, size;
  mint = data.mint ? shortMint(data.mint) : "—";
  src = data.source ? SOURCE_LABEL[data.source] || data.source : "";
  if (type === "decision") {
    act = data.action === "buy" ? "BUY" : "SKIP"; good = data.action === "buy";
    reason = data.reason; size = data.action === "buy" ? `${(data.sizeSol || 0).toFixed(2)}◎` : null;
  } else if (type === "fill") {
    act = "FILL"; good = true; size = `${(data.sizeSol || 0).toFixed(2)}◎`;
    reason = `${data.simulated ? "paper " : ""}entry @ ${fmtPrice(data.price)}`;
  } else if (type === "exit") {
    act = "EXIT"; good = (data.pnlSol || 0) >= 0;
    reason = `${data.reason} · ${(data.gainPct >= 0 ? "+" : "")}${(data.gainPct || 0).toFixed(0)}% (${(data.pnlSol >= 0 ? "+" : "")}${(data.pnlSol || 0).toFixed(3)}◎)`;
  } else { act = "GATE"; good = false; reason = data.blocked || data.gate || "gate"; }

  const col = good ? C.green : C.muted;
  return (
    <div className={first ? "live-row" : ""} style={{ display: "flex", alignItems: "center", gap: 10,
      padding: "8px 6px", borderBottom: `1px solid ${C.panel2}` }}>
      <span style={{ color: C.faint, fontSize: 11 }}>{hhmmss(ts)}</span>
      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 4,
        color: col, background: good ? "rgba(95,211,138,.1)" : C.panel2,
        border: `1px solid ${good ? "rgba(95,211,138,.3)" : C.border}` }}>{act}</span>
      <span style={{ color: C.text, fontSize: 12 }}>{mint}</span>
      <span style={{ color: C.faint, fontSize: 10 }}>{src}</span>
      <span style={{ flex: 1 }} />
      <span style={{ color: good ? C.text : C.muted, fontSize: 11, textAlign: "right" }}>
        {size ? <b style={{ color: C.accent }}>{size} · </b> : null}{reason}
      </span>
    </div>
  );
}

function fmtPrice(p) {
  if (p == null) return "—";
  if (p === 0) return "0";
  if (p < 1e-6) return p.toExponential(2);
  return p.toPrecision(3);
}

/* ── primitives ── */
const inp = { width: "100%", background: "#0c0a09", border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "8px 10px", fontSize: 13 };
const btn = (bg, color, border) => ({ background: bg, color, border: `1px solid ${border || bg}`, borderRadius: 6, padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" });

function Panel({ children }) { return <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16 }}>{children}</div>; }
function H({ children }) { return <span className="bn" style={{ fontSize: 21, color: C.text }}>{children}</span>; }
function Section({ title, open, onToggle, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", justifyContent: "space-between",
        alignItems: "center", background: "transparent", border: "none", cursor: "pointer", padding: "14px 16px" }}>
        <span className="bn" style={{ fontSize: 19, color: C.text }}>{title}</span>
        <span style={{ color: C.accent, transform: open ? "rotate(90deg)" : "none", transition: ".15s" }}>›</span>
      </button>
      {open && <div style={{ padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>}
    </div>
  );
}
function Label({ children, hot }) { return <div style={{ fontSize: 11, color: hot ? C.accent : C.muted, marginTop: 10, marginBottom: 5 }}>{children}</div>; }
function Row({ children }) { return <div style={{ display: "flex", gap: 10 }}>{children}</div>; }
function Num({ label, v, on, step = 1 }) {
  return (<div style={{ flex: 1 }}><Label>{label}</Label>
    <input type="number" step={step} value={v} onChange={(e) => on(+e.target.value)} style={inp} /></div>);
}
function Area({ v, on, ph }) {
  return <textarea value={v} onChange={(e) => on(e.target.value)} placeholder={ph} rows={3}
    style={{ ...inp, resize: "vertical", fontSize: 12, lineHeight: 1.5 }} />;
}
function Select({ v, on, opts }) {
  return (<select value={v} onChange={(e) => on(e.target.value)} style={{ ...inp, cursor: "pointer" }}>
    {opts.map(([val, lab]) => <option key={val} value={val} style={{ background: C.panel }}>{lab}</option>)}</select>);
}
function Toggle({ label, v, on }) {
  return (
    <button onClick={() => on(!v)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
      width: "100%", background: "transparent", border: "none", cursor: "pointer", padding: "7px 0" }}>
      <span style={{ color: v ? C.text : C.muted, fontSize: 12 }}>{label}</span>
      <span style={{ width: 38, height: 20, borderRadius: 11, background: v ? C.accent : C.panel2,
        border: `1px solid ${v ? C.accent : C.border}`, position: "relative", transition: ".15s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: v ? 19 : 2, width: 14, height: 14, borderRadius: "50%",
          background: v ? "#160c03" : C.muted, transition: ".15s" }} />
      </span>
    </button>
  );
}
function Slider({ label, v, on, min = 0, max = 100 }) {
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Label>{label}</Label><span style={{ color: C.accent, fontSize: 12, marginTop: 10 }}>{v}</span>
      </div>
      <input type="range" min={min} max={max} value={v} onChange={(e) => on(+e.target.value)}
        style={{ width: "100%", accentColor: C.accent }} />
    </div>
  );
}
function Chips({ items, active, onTap }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((it) => {
        const on = active.includes(it.id);
        return (
          <button key={it.id} onClick={() => onTap(it.id)} style={{
            background: on ? C.accentSoft : C.panel2, color: on ? C.accent : C.muted,
            border: `1px solid ${on ? C.accent : C.border}`, borderRadius: 5, padding: "6px 10px",
            cursor: "pointer", fontSize: 11 }}>{on ? "✓ " : ""}{it.label}</button>
        );
      })}
    </div>
  );
}
function Pill({ label, value, valColor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
      <span style={{ fontSize: 9, color: C.faint }}>{label}</span>
      <span style={{ fontSize: 12, color: valColor || C.text }}>{value}</span>
    </div>
  );
}
function Dot({ on, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", background: on ? C.green : C.faint,
        animation: on ? "pulse 1.4s infinite" : "none" }} />
      <span style={{ fontSize: 12, color: on ? C.green : C.muted }}>{label}</span>
    </div>
  );
}
