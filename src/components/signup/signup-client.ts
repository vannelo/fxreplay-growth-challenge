import { ErrorEnvelope, IDEMPOTENCY_HEADER, VISITOR_ID_HEADER } from '../../contracts/users';
import type { Outcome, Payload } from './signup-machine';

export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * POST /api/users and classify the result for the state machine. Never throws.
 * A timeout is reported as `network` on purpose: the request may have succeeded, and retrying with the SAME
 * Idempotency-Key is exactly what makes that safe.
 */
export async function createUser(
  payload: Payload,
  idempotencyKey: string,
  visitorId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Outcome> {
  let response: Response;
  try {
    response = await fetchImpl('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [IDEMPOTENCY_HEADER]: idempotencyKey,
        ...(visitorId ? { [VISITOR_ID_HEADER]: visitorId } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { kind: 'network' };
  }

  if (response.status === 201) return { kind: 'created' }; // first create and idempotent replay look the same here

  const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => undefined));
  const code = envelope.success ? envelope.data.error.code : undefined;

  if (response.status === 409 && code === 'email_taken') return { kind: 'email_taken' };
  if (response.status === 422 && code === 'validation_error') {
    return { kind: 'validation', fields: envelope.success ? (envelope.data.error.fields ?? {}) : {} };
  }
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After'));
    return { kind: 'rate_limited', ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) };
  }
  return { kind: 'unavailable' }; // 5xx, HTML error pages, and unexpected 4xx
}

/** `fxr_vid` (ADR-007), if the browser has it. Sent as X-Visitor-Id; the server treats it as optional. */
export function readVisitorId(cookie: string = document.cookie): string | undefined {
  return cookie
    .split('; ')
    .find((entry) => entry.startsWith('fxr_vid='))
    ?.slice('fxr_vid='.length);
}
