import { loadEnv } from './config/load.js';
import { SniperEngine } from './engine.js';
import { startServer } from './api/server.js';
import { logger } from './util/logger.js';

async function main(): Promise<void> {
  const env = loadEnv();

  logger.info(
    { mode: env.MODE, rpc: !!env.SOLANA_RPC_URL },
    'SolSniper booting',
  );
  if (env.MODE === 'live') {
    logger.warn(
      'LIVE MODE: real capital at risk. Kill switch, daily cap, and circuit breaker are active.',
    );
  }

  const engine = new SniperEngine(env);
  await engine.start();
  const app = await startServer(engine, env.API_PORT);

  const shutdown = async (sig: string) => {
    logger.warn({ sig }, 'shutting down');
    try {
      await app.close();
      await engine.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err: String(err) }, 'fatal boot error');
  process.exit(1);
});
