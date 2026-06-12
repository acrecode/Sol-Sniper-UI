import type { FastifyInstance } from 'fastify';
import type { SniperEngine } from '../../engine.js';
import { StrategySchema } from '../../config/schema.js';
import { PRESETS } from '../../strategy/presets.js';

export function configRoutes(app: FastifyInstance, engine: SniperEngine): void {
  app.get('/config', async () => engine.getStrategy());

  app.put('/config', async (req, reply) => {
    const parsed = StrategySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid config', issues: parsed.error.issues };
    }
    return engine.setStrategy(parsed.data);
  });

  app.get('/presets', async () => Object.keys(PRESETS));

  app.get('/presets/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const preset = PRESETS[name];
    if (!preset) {
      reply.code(404);
      return { error: 'unknown preset' };
    }
    return preset;
  });
}
