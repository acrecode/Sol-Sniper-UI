import type { FastifyInstance } from 'fastify';
import type { SniperEngine } from '../../engine.js';

export function controlRoutes(app: FastifyInstance, engine: SniperEngine): void {
  app.get('/state', async () => engine.getState());

  app.post('/control/start', async (_req, reply) => {
    try {
      engine.arm();
      return { ok: true, state: engine.getState() };
    } catch (err) {
      reply.code(409);
      return { ok: false, error: String(err instanceof Error ? err.message : err) };
    }
  });

  app.post('/control/stop', async () => {
    engine.disarm();
    return { ok: true, state: engine.getState() };
  });

  app.post('/control/kill', async () => {
    await engine.kill(false);
    return { ok: true, state: engine.getState() };
  });

  app.post('/control/flush', async () => {
    await engine.kill(true);
    return { ok: true, state: engine.getState() };
  });

  // load the bot signer at runtime (base58). Never echoed back.
  app.post('/wallet', async (req, reply) => {
    const { secret } = (req.body ?? {}) as { secret?: string };
    if (!secret) {
      reply.code(400);
      return { ok: false, error: 'missing secret' };
    }
    const ok = engine.loadWallet(secret);
    if (!ok) {
      reply.code(400);
      return { ok: false, error: 'invalid key' };
    }
    return { ok: true, pubkey: engine.wallet.pubkey };
  });
}
