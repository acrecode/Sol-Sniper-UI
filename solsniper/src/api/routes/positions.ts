import type { FastifyInstance } from 'fastify';
import type { SniperEngine } from '../../engine.js';

export function positionRoutes(app: FastifyInstance, engine: SniperEngine): void {
  app.get('/positions', async () =>
    engine.positions.list().map((p) => engine.positions.toView(p)),
  );

  app.get('/ledger', async (req) => {
    const { limit } = req.query as { limit?: string };
    return engine.ledger.recent(limit ? Number(limit) : 100);
  });

  app.get('/tokens', async (req) => {
    const { status } = req.query as { status?: string };
    return engine.tokenRepo.list(status);
  });

  // manual sell of an open position (UI "SELL NOW")
  app.post('/positions/:id/sell', async (req, reply) => {
    const { id } = req.params as { id: string };
    const ok = await engine.positions.manualSell(id);
    if (!ok) {
      reply.code(404);
      return { error: 'position not found' };
    }
    return { ok: true };
  });
}
