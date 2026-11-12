import { waitUntil } from '@vercel/functions';

/**
 * Keep the invocation alive for a background promise without delaying the response (Vercel `waitUntil`).
 * Off Vercel (local, Node adapter) it falls back to letting the promise run on its own.
 */
export function defer(promise: Promise<unknown>): void {
  try {
    waitUntil(promise);
  } catch {
    void promise;
  }
}
