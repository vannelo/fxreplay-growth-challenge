import { describe, expect, it, vi } from 'vitest';
import { createUser, readVisitorId } from '../../src/components/signup/signup-client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const fakeFetch = (res: Response | Error) =>
  vi.fn<typeof fetch>(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
const payload = { email: 'ada@example.com' };
const KEY = '11111111-1111-4111-8111-111111111111';
const VISITOR = '22222222-2222-4222-8222-222222222222';

describe('createUser: request', () => {
  it('POSTs JSON to /api/users with Idempotency-Key and X-Visitor-Id', async () => {
    const f = fakeFetch(json(201, { data: {} }));
    await createUser({ email: 'ada@example.com', name: 'Ada' }, KEY, VISITOR, f);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/users');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json', 'Idempotency-Key': KEY, 'X-Visitor-Id': VISITOR });
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'ada@example.com', name: 'Ada' });
  });

  it('omits X-Visitor-Id when there is no visitor id (analytics never blocks signup)', async () => {
    const f = fakeFetch(json(201, { data: {} }));
    await createUser(payload, KEY, undefined, f);
    expect(f.mock.calls[0]![1]?.headers).not.toHaveProperty('X-Visitor-Id');
  });
});

describe('createUser: classification', () => {
  it('201 → created', async () => {
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(json(201, { data: {} })))).toEqual({ kind: 'created' });
  });

  it('409 email_taken → email_taken; any other 409 → unavailable', async () => {
    const taken = json(409, { error: { code: 'email_taken', message: 'x' } });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(taken))).toEqual({ kind: 'email_taken' });
    const other = json(409, { error: { code: 'request_in_progress', message: 'x' } });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(other))).toEqual({ kind: 'unavailable' });
  });

  it('422 validation_error → validation with the server fields', async () => {
    const res = json(422, { error: { code: 'validation_error', message: 'x', fields: { email: ['bad'] } } });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(res))).toEqual({ kind: 'validation', fields: { email: ['bad'] } });
  });

  it('422 idempotency_key_reuse is not a field problem → unavailable', async () => {
    const res = json(422, { error: { code: 'idempotency_key_reuse', message: 'x' } });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(res))).toEqual({ kind: 'unavailable' });
  });

  it('429 → rate_limited, with Retry-After when valid', async () => {
    const withHeader = json(429, { error: { code: 'rate_limited', message: 'x' } }, { 'Retry-After': '30' });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(withHeader))).toEqual({ kind: 'rate_limited', retryAfter: 30 });
    const without = json(429, { error: { code: 'rate_limited', message: 'x' } });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(without))).toEqual({ kind: 'rate_limited' });
    const junk = json(429, {}, { 'Retry-After': 'soon' });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(junk))).toEqual({ kind: 'rate_limited' });
  });

  it('5xx JSON, 5xx HTML and unexpected 4xx → unavailable (never throws on a non-JSON body)', async () => {
    const cases = [
      json(500, { error: { code: 'internal_error', message: 'x' } }),
      new Response('<html>Bad gateway</html>', { status: 502 }),
      new Response('', { status: 413 }),
    ];
    for (const res of cases) expect(await createUser(payload, KEY, VISITOR, fakeFetch(res))).toEqual({ kind: 'unavailable' });
  });

  it('a rejected fetch (offline, DNS, timeout/abort) → network', async () => {
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(new TypeError('Failed to fetch')))).toEqual({ kind: 'network' });
    expect(await createUser(payload, KEY, VISITOR, fakeFetch(new DOMException('timed out', 'TimeoutError')))).toEqual({ kind: 'network' });
  });
});

describe('readVisitorId', () => {
  it('finds fxr_vid among other cookies', () => {
    expect(readVisitorId(`a=1; fxr_vid=${VISITOR}; fxr_variant=control`)).toBe(VISITOR);
  });
  it('returns undefined when absent', () => {
    expect(readVisitorId('a=1; fxr_variant=control')).toBeUndefined();
    expect(readVisitorId('')).toBeUndefined();
  });
});
