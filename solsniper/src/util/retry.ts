import { logger } from './logger.js';

export interface RetryOpts {
  retries?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  label?: string;
  /** Return false to stop retrying a specific error (treat as fatal). */
  shouldRetry?: (err: unknown) => boolean;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const {
    retries = 4,
    minDelayMs = 200,
    maxDelayMs = 5000,
    factor = 2,
    label = 'op',
    shouldRetry = () => true,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries || !shouldRetry(err)) throw err;
      const base = Math.min(maxDelayMs, minDelayMs * factor ** (attempt - 1));
      const delay = base / 2 + Math.random() * (base / 2);
      logger.warn(
        { label, attempt, retries, delay: Math.round(delay), err: String(err) },
        'retrying after failure',
      );
      await sleep(delay);
    }
  }
}
