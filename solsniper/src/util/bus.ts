import { EventEmitter } from 'node:events';
import type { EngineEvent, EngineEventType } from '../types.js';

/**
 * Central in-process event bus. Every pipeline stage emits structured events;
 * the API layer mirrors them to the SQLite `events` table and the /ws channel.
 */
export class EventBus extends EventEmitter {
  emitEvent(type: EngineEventType, data: unknown): EngineEvent {
    const ev: EngineEvent = { type, ts: Date.now(), data };
    this.emit('event', ev);
    return ev;
  }

  onEvent(fn: (ev: EngineEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const bus = new EventBus();
