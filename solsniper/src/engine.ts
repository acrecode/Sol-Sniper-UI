import { Connection } from '@solana/web3.js';
import type { Env, StrategyConfig } from './config/schema.js';
import type { EngineState } from './types.js';
import { openDb, type DB } from './store/db.js';
import { Ledger } from './store/ledger.js';
import { ConfigRepo, TokenRepo, SafetyRepo, PositionRepo } from './store/repos.js';
import { IngestionManager } from './ingestion/index.js';
import type { RawEvent } from './ingestion/types.js';
import { LaunchDetector } from './detect/index.js';
import { SafetyEngine } from './safety/index.js';
import { evaluate } from './strategy/evaluate.js';
import { WalletManager, Executor } from './execution/index.js';
import { RiskGates } from './risk/gates.js';
import { PositionManager } from './positions/manager.js';
import { bus } from './util/bus.js';
import { logger } from './util/logger.js';

/**
 * Top-level orchestrator. Wires ingestion → detect → safety → strategy →
 * risk gates → execution → positions, and exposes control + state for the API.
 */
export class SniperEngine {
  readonly db: DB;
  readonly conn: Connection | null;
  readonly wallet = new WalletManager();
  readonly configRepo: ConfigRepo;
  readonly tokenRepo: TokenRepo;
  readonly safetyRepo: SafetyRepo;
  readonly positionRepo: PositionRepo;
  readonly ledger: Ledger;
  readonly gates: RiskGates;
  readonly positions: PositionManager;

  private ingestion: IngestionManager;
  private detector = new LaunchDetector();
  private safety: SafetyEngine;
  private executor: Executor;
  private armed = false;

  constructor(private env: Env) {
    this.db = openDb(env.DB_PATH);
    this.conn = env.SOLANA_RPC_URL
      ? new Connection(env.SOLANA_RPC_URL, 'processed')
      : null;

    this.configRepo = new ConfigRepo(this.db);
    this.tokenRepo = new TokenRepo(this.db);
    this.safetyRepo = new SafetyRepo(this.db);
    this.positionRepo = new PositionRepo(this.db);
    this.ledger = new Ledger(this.db);

    const failClosed = env.MODE !== 'dry-run';
    this.safety = new SafetyEngine(this.conn, failClosed);
    this.executor = new Executor(env, this.conn, this.wallet);
    this.gates = new RiskGates(this.ledger);
    this.ingestion = new IngestionManager(env);
    this.positions = new PositionManager(
      this.executor,
      this.positionRepo,
      this.ledger,
      this.gates,
      bus,
      () => this.configRepo.getStrategy(),
    );

    // seed wallet from env if provided
    if (env.WALLET_PRIVATE_KEY) this.wallet.loadFromEnv(env.WALLET_PRIVATE_KEY);
  }

  async start(): Promise<void> {
    this.positions.start();
    await this.ingestion.start((e) => void this.onRaw(e));
    bus.emitEvent('state', this.getState());
    logger.info({ mode: this.env.MODE }, 'engine started (ingestion live, disarmed)');
  }

  async shutdown(): Promise<void> {
    this.positions.stop();
    await this.ingestion.stop();
    this.db.close();
  }

  /* ── control ────────────────────────────────────────────────── */

  arm(): void {
    if (this.env.MODE !== 'dry-run' && !this.wallet.loaded)
      throw new Error('cannot arm: no signer loaded');
    if (this.gates.killSwitch.isKilled) this.gates.killSwitch.reset();
    if (this.gates.breaker.isTripped) this.gates.breaker.reset();
    this.armed = true;
    bus.emitEvent('state', this.getState());
    logger.info('ARMED');
  }

  disarm(): void {
    this.armed = false;
    bus.emitEvent('state', this.getState());
    logger.info('disarmed');
  }

  async kill(flush: boolean): Promise<void> {
    this.armed = false;
    this.gates.killSwitch.engage(flush);
    bus.emitEvent('gate', { gate: 'killswitch', flush });
    if (flush) {
      logger.warn('FLUSH: market-selling all open positions');
      await this.positions.flushAll();
    }
    bus.emitEvent('state', this.getState());
    logger.warn({ flush }, 'KILL switch engaged');
  }

  loadWallet(base58: string): boolean {
    const ok = this.wallet.loadFromBase58(base58);
    bus.emitEvent('state', this.getState());
    return ok;
  }

  getStrategy(): StrategyConfig {
    return this.configRepo.getStrategy();
  }
  setStrategy(cfg: StrategyConfig): StrategyConfig {
    const saved = this.configRepo.setStrategy(cfg);
    bus.emitEvent('state', this.getState());
    return saved;
  }

  getState(): EngineState {
    const cfg = this.configRepo.getStrategy();
    return {
      mode: this.env.MODE,
      armed: this.armed,
      streamConnected: this.ingestion.isConnected(),
      streamKind: this.ingestion.streamKind,
      signerLoaded: this.wallet.loaded,
      signerPubkey: this.wallet.pubkey,
      gates: {
        killed: this.gates.killSwitch.isKilled,
        breakerTripped: this.gates.breaker.isTripped,
        dailyCapUsedSol: this.gates.dailyCapUsed(),
        dailyCapSol: cfg.dailyCapSol,
        openPositions: this.positions.openCount,
        maxConcurrent: cfg.maxConcurrent,
      },
    };
  }

  /* ── pipeline ───────────────────────────────────────────────── */

  private async onRaw(e: RawEvent): Promise<void> {
    const launch = this.detector.detect(e);
    if (!launch) return;

    this.tokenRepo.upsertFromLaunch(launch);
    const latencyMs = Date.now() - e.receivedAt;
    bus.emitEvent('detection', {
      mint: launch.mint,
      source: launch.source,
      creator: launch.creator,
      slot: launch.slot,
      signature: launch.signature,
      latencyMs,
    });

    const cfg = this.configRepo.getStrategy();
    try {
      const { state, report } = await this.safety.evaluate(launch, cfg);
      this.safetyRepo.save(report);

      const decision = evaluate(launch, state, report, cfg);
      bus.emitEvent('decision', {
        mint: launch.mint,
        source: launch.source,
        action: decision.action,
        reason: decision.reason,
        rugScore: report.rugScore,
        verdict: report.verdict,
        sizeSol: decision.sizeSol,
        copyTrade: decision.copyTrade ?? false,
      });

      if (decision.action !== 'buy') {
        this.tokenRepo.setStatus(launch.mint, 'skipped', state);
        return;
      }

      if (!this.armed) {
        bus.emitEvent('decision', {
          mint: launch.mint,
          source: launch.source,
          action: 'skip',
          reason: 'would buy — engine not armed',
          rugScore: report.rugScore,
        });
        return;
      }

      // risk gates
      const gate = this.gates.check(cfg, {
        openPositions: this.positions.openCount,
        sizeSol: decision.sizeSol,
      });
      if (!gate.allowed) {
        bus.emitEvent('gate', { mint: launch.mint, blocked: gate.reason });
        return;
      }

      const fill = await this.executor.buy(launch, state, decision, cfg);
      if (!fill) return; // dedup
      this.positions.open(launch, state, fill, cfg);
      this.tokenRepo.setStatus(launch.mint, 'bought', state);
      bus.emitEvent('state', this.getState());
    } catch (err) {
      logger.error({ mint: launch.mint, err: String(err) }, 'pipeline error');
      this.gates.breaker.recordError();
    }
  }
}
