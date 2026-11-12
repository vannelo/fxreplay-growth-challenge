import { describe, expect, it, vi } from 'vitest';
import type { ServerAnalytics, ServerEvent } from '../../src/analytics/server';
import { MemoryUserRepository } from '../../src/server/memory-user-repository';
import type { UserRepository } from '../../src/server/user-repository';
import { expectCreated, get, makeApi, makeClock, patch, post, uniqueEmail } from './helpers';

/** Records what the handlers ask analytics to capture. The API behaviour is asserted elsewhere; this is only "what is emitted, when". */
function recorder() {
  const events: { event: ServerEvent; visitor: string | null }[] = [];
  const analytics: ServerAnalytics = { capture: (event, request) => events.push({ event, visitor: request.headers.get('x-visitor-id') }) };
  return { analytics, events, names: () => events.map((e) => e.event.name) };
}

describe('server-side analytics emitted by POST /api/users', () => {
  it('first-time 201 ⇒ exactly one signup_succeeded carrying the created user id (not the email, not the name)', async () => {
    const { analytics, events } = recorder();
    const api = makeApi(undefined, analytics);
    const user = await expectCreated(await api.create(post({ email: 'ada@example.com', name: 'Ada' }, { headers: { 'X-Visitor-Id': crypto.randomUUID() } })));
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toEqual({ name: 'signup_succeeded', props: { user_id: user.id, name_provided: true } });
    expect(JSON.stringify(events)).not.toContain('ada@example.com');
    expect(JSON.stringify(events)).not.toContain('Ada');
  });

  it('name omitted ⇒ name_provided is false', async () => {
    const { analytics, events } = recorder();
    await makeApi(undefined, analytics).create(post({ email: uniqueEmail() }));
    expect(events[0]!.event.props).toMatchObject({ name_provided: false });
  });

  it('idempotent REPLAY (same key + body) ⇒ still exactly one conversion', async () => {
    const { analytics, names } = recorder();
    const api = makeApi(undefined, analytics);
    const key = crypto.randomUUID();
    const first = await api.create(post({ email: 'ada@example.com' }, { key }));
    const replay = await api.create(post({ email: 'ada@example.com' }, { key }));
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(names()).toEqual(['signup_succeeded']);
  });

  it('409 email_taken ⇒ one signup_failed (server, not retryable) and NO conversion', async () => {
    const { analytics, events, names } = recorder();
    const api = makeApi(undefined, analytics);
    await api.create(post({ email: 'ada@example.com' }));
    events.length = 0;
    const res = await api.create(post({ email: 'ada@example.com' }));
    expect(res.status).toBe(409);
    expect(events.map((e) => e.event)).toEqual([{ name: 'signup_failed', props: { source: 'server', error_code: 'email_taken', retryable: false } }]);
    expect(names()).not.toContain('signup_succeeded');
  });

  it('422 validation ⇒ signup_failed listing only field NAMES (never values or messages)', async () => {
    const { analytics, events } = recorder();
    await makeApi(undefined, analytics).create(post({ email: 'not-an-email', name: 'x'.repeat(81) }));
    expect(events).toHaveLength(1);
    expect(events[0]!.event.props).toEqual({ source: 'server', error_code: 'validation_error', retryable: false, failed_fields: ['email', 'name'] });
  });

  it('a repository crash (500) ⇒ signup_failed, retryable, no conversion', async () => {
    const { analytics, events } = recorder();
    const boom = (): never => { throw new Error('db down postgres://secret'); };
    const repo: UserRepository = { create: boom, update: boom, list: boom };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await makeApi(repo, analytics).create(post({ email: uniqueEmail() }));
    log.mockRestore();
    expect(res.status).toBe(500);
    expect(events.map((e) => e.event)).toEqual([{ name: 'signup_failed', props: { source: 'server', error_code: 'internal_error', retryable: true } }]);
    expect(JSON.stringify(events)).not.toContain('secret');
  });

  it.each([
    ['malformed JSON (400)', () => post(null, { raw: '{' })],
    ['wrong content type (415)', () => post(null, { raw: '{}', contentType: 'text/plain' })],
    ['oversized body (413)', () => post({ email: uniqueEmail(), name: 'x'.repeat(5000) })],
  ])('%s ⇒ no event (the form cannot cause it, and it would only be noise)', async (_l, request) => {
    const { analytics, events } = recorder();
    await makeApi(undefined, analytics).create(request());
    expect(events).toHaveLength(0);
  });

  it('PATCH and GET emit nothing', async () => {
    const { analytics, events } = recorder();
    const api = makeApi(new MemoryUserRepository({ now: makeClock() }), analytics);
    const user = await expectCreated(await api.create(post({ email: uniqueEmail() })));
    events.length = 0;
    await api.update(user.id, patch(user.id, { name: 'New' }));
    await api.update(crypto.randomUUID(), patch('x', { name: 'x' }));
    await api.list(get());
    expect(events).toHaveLength(0);
  });
});
