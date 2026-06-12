import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { SniperEngine } from '../engine.js';
import { bus } from '../util/bus.js';
import { logger } from '../util/logger.js';
import { configRoutes } from './routes/config.js';
import { positionRoutes } from './routes/positions.js';
import { controlRoutes } from './routes/control.js';
import type { EngineEvent } from '../types.js';

export async function buildServer(engine: SniperEngine): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get('/health', async () => ({ ok: true }));

  configRoutes(app, engine);
  positionRoutes(app, engine);
  controlRoutes(app, engine);

  // persist every engine event to the ledger's events table (audit trail)
  const insertEvent = engine.db.prepare(
    'INSERT INTO events (type, data_json, ts) VALUES (?,?,?)',
  );
  bus.onEvent((ev: EngineEvent) => {
    try {
      insertEvent.run(ev.type, JSON.stringify(ev.data), ev.ts);
    } catch {
      /* never let logging break the pipeline */
    }
  });

  // live event stream to the UI
  app.register(async (scoped) => {
    scoped.get('/ws', { websocket: true }, (socket) => {
      // send a snapshot on connect
      socket.send(
        JSON.stringify({ type: 'state', ts: Date.now(), data: engine.getState() }),
      );
      const unsub = bus.onEvent((ev) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
      });
      socket.on('close', unsub);
    });
  });

  return app;
}

export async function startServer(engine: SniperEngine, port: number): Promise<FastifyInstance> {
  const app = await buildServer(engine);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'API listening');
  return app;
}
