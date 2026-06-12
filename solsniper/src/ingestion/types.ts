/** Normalized raw event coming off a stream, before launch detection. */
export interface RawEvent {
  programId: string;
  signature: string;
  slot: number;
  /** monotonic local receive time (ms) for latency telemetry */
  receivedAt: number;
  logs: string[];
  /** raw accounts referenced by the tx, when available */
  accounts?: string[];
  source: 'grpc' | 'ws';
}

export interface IngestionSource {
  readonly kind: 'grpc' | 'ws';
  start(onEvent: (e: RawEvent) => void): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
}
