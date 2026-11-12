import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/contracts/users';
import type { UserRepository } from '../../src/server/user-repository';
import {
  expectCreated,
  expectError,
  expectPage,
  expectUpdated,
  get,
  json,
  makeApi,
  patch,
  post,
  uniqueEmail,
} from './helpers';

describe('POST /api/users', () => {
  it('creates a user: 201, Location, exact user shape, name null when omitted', async () => {
    const api = makeApi();
    const res = await api.create(post({ email: 'ada@example.com', name: 'Ada' }));
    const user = await expectCreated(res);
    expect(user).toMatchObject({ email: 'ada@example.com', name: 'Ada' });
    expect(res.headers.get('Location')).toBe(`/api/users/${user.id}`);
    expect(res.headers.get('Idempotent-Replayed')).toBeNull();
    expect(user.updatedAt).toBe(user.createdAt);

    const noName = await expectCreated(await api.create(post({ email: uniqueEmail() })));
    expect(noName.name).toBeNull();
  });

  it('normalizes email (trim + lowercase); the normalized address is then taken (409)', async () => {
    const api = makeApi();
    const user = await expectCreated(await api.create(post({ email: '  A@B.CO ' })));
    expect(user.email).toBe('a@b.co');
    await expectError(await api.create(post({ email: 'a@b.co' })), 409, 'email_taken');
  });

  it.each([
    ['no domain tld', { email: 'a@b' }],
    ['empty', { email: '' }],
    ['255 chars', { email: `${'a'.repeat(250)}@b.co` }],
    ['missing', {}],
    ['wrong type', { email: 123 }],
  ])('rejects invalid email (%s): 422 with fields.email', async (_label, body) => {
    const fields = await expectError(await makeApi().create(post(body)), 422, 'validation_error');
    expect(fields.email?.length).toBeGreaterThan(0);
  });

  it.each([
    ['whitespace only', '   '],
    ['empty string', ''],
    ['control character', 'a\u0000b'],
    ['81 chars', 'x'.repeat(81)],
  ])('rejects invalid name (%s): 422 with fields.name', async (_label, name) => {
    const fields = await expectError(
      await makeApi().create(post({ email: uniqueEmail(), name })),
      422,
      'validation_error',
    );
    expect(fields.name?.length).toBeGreaterThan(0);
  });

  it('accepts non-Latin and emoji names', async () => {
    const user = await expectCreated(await makeApi().create(post({ email: uniqueEmail(), name: '李雷 🚀' })));
    expect(user.name).toBe('李雷 🚀');
  });

  it.each([['id'], ['createdAt'], ['variant']])('rejects an unknown/immutable key "%s" in the body: 422 on that key', async (key) => {
    const fields = await expectError(
      await makeApi().create(post({ email: uniqueEmail(), [key]: 'x' })),
      422,
      'validation_error',
    );
    expect(fields[key]?.length).toBeGreaterThan(0);
  });

  describe('Idempotency-Key header', () => {
    it.each([
      ['missing', null],
      ['15 chars', 'a'.repeat(15)],
      ['has spaces', 'abcdefgh ijklmnop'],
    ])('%s → 422 with fields["idempotency-key"]', async (_label, key) => {
      const fields = await expectError(
        await makeApi().create(post({ email: uniqueEmail() }, { key })),
        422,
        'validation_error',
      );
      expect(fields['idempotency-key']?.length).toBeGreaterThan(0);
    });

    it('reports body and header problems together in one 422', async () => {
      const fields = await expectError(await makeApi().create(post({ email: 'nope' }, { key: null })), 422, 'validation_error');
      expect(Object.keys(fields).sort()).toEqual(['email', 'idempotency-key']);
    });

    it('retry with the same key + body returns the same user, flagged as a replay, with one row', async () => {
      const api = makeApi();
      const key = crypto.randomUUID();
      const first = await api.create(post({ email: 'ada@example.com', name: 'Ada' }, { key }));
      const second = await api.create(post({ email: 'ada@example.com', name: 'Ada' }, { key }));
      const a = await expectCreated(first);
      const b = await expectCreated(second);
      expect(b).toEqual(a);
      expect(first.headers.get('Idempotent-Replayed')).toBeNull();
      expect(second.headers.get('Idempotent-Replayed')).toBe('true');
      expect((await expectPage(await api.list(get()))).data).toHaveLength(1);
    });

    it('treats a differently-cased/spaced but equivalent body as the same payload (replay)', async () => {
      const api = makeApi();
      const key = crypto.randomUUID();
      const a = await expectCreated(await api.create(post({ email: 'ada@example.com' }, { key })));
      const second = await api.create(post({ email: '  ADA@example.com ' }, { key }));
      expect((await expectCreated(second)).id).toBe(a.id);
      expect(second.headers.get('Idempotent-Replayed')).toBe('true');
    });

    it('same key with a different payload → 422 idempotency_key_reuse, nothing created', async () => {
      const api = makeApi();
      const key = crypto.randomUUID();
      await expectCreated(await api.create(post({ email: 'ada@example.com' }, { key })));
      await expectError(await api.create(post({ email: 'other@example.com' }, { key })), 422, 'idempotency_key_reuse');
      expect((await expectPage(await api.list(get()))).data).toHaveLength(1);
    });

    it('two simultaneous requests with the same key and body create exactly one user', async () => {
      const api = makeApi();
      const key = crypto.randomUUID();
      const [r1, r2] = await Promise.all([
        api.create(post({ email: 'ada@example.com' }, { key })),
        api.create(post({ email: 'ada@example.com' }, { key })),
      ]);
      const [u1, u2] = [await expectCreated(r1), await expectCreated(r2)];
      expect(u1.id).toBe(u2.id);
      expect([r1, r2].filter((r) => r.headers.get('Idempotent-Replayed') === 'true')).toHaveLength(1);
      expect((await expectPage(await api.list(get()))).data).toHaveLength(1);
    });
  });

  it('race: two simultaneous requests, same email, different keys → exactly one 201 and one 409', async () => {
    const api = makeApi();
    const [r1, r2] = await Promise.all([
      api.create(post({ email: 'race@example.com' })),
      api.create(post({ email: 'race@example.com' })),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    await expectError(loser, 409, 'email_taken');
    expect((await expectPage(await api.list(get()))).data).toHaveLength(1);
  });

  describe('transport errors', () => {
    it('malformed JSON → 400 invalid_json', async () => {
      await expectError(await makeApi().create(post(null, { raw: '{"email":' })), 400, 'invalid_json');
    });

    it.each([
      ['text/plain', 'text/plain'],
      ['form-encoded', 'application/x-www-form-urlencoded'],
      ['missing Content-Type', null],
    ])('%s → 415 unsupported_media_type', async (_label, contentType) => {
      const res = await makeApi().create(post(null, { raw: '{"email":"a@b.co"}', contentType }));
      await expectError(res, 415, 'unsupported_media_type');
    });

    it('accepts application/json with a charset parameter', async () => {
      const res = await makeApi().create(post({ email: uniqueEmail() }, { contentType: 'application/json; charset=utf-8' }));
      await expectCreated(res);
    });

    it.each([['array', '[]'], ['null', 'null'], ['string', '"x"']])('non-object JSON body (%s) → 422', async (_label, raw) => {
      await expectError(await makeApi().create(post(null, { raw })), 422, 'validation_error');
    });

    it('oversized body → 413 payload_too_large, nothing created', async () => {
      const api = makeApi();
      const res = await api.create(post({ email: uniqueEmail(), name: 'x'.repeat(MAX_BODY_BYTES) }));
      await expectError(res, 413, 'payload_too_large');
      expect((await expectPage(await api.list(get()))).data).toHaveLength(0);
    });

    it('a Content-Length header over the limit → 413 even when the body is small', async () => {
      const res = await makeApi().create(
        post({ email: uniqueEmail() }, { headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) } }),
      );
      await expectError(res, 413, 'payload_too_large');
    });
  });

  it.each([
    ['valid uuid', crypto.randomUUID()],
    ['empty', ''],
    ['not a uuid', 'not-a-uuid'],
    ['an email address', 'a@b.co'],
  ])('X-Visitor-Id (%s) never causes an error', async (_label, visitor) => {
    const res = await makeApi().create(post({ email: uniqueEmail() }, { headers: { 'X-Visitor-Id': visitor } }));
    await expectCreated(res);
  });

  it('absent X-Visitor-Id never causes an error', async () => {
    await expectCreated(await makeApi().create(post({ email: uniqueEmail() })));
  });
});

describe('PATCH /api/users/:id', () => {
  async function seeded() {
    const api = makeApi();
    const user = await expectCreated(await api.create(post({ email: 'ada@example.com', name: 'Ada' })));
    return { api, user };
  }

  it('updates name: 200, updatedAt advances, id/createdAt/email unchanged', async () => {
    const { api, user } = await seeded();
    const updated = await expectUpdated(await api.update(user.id, patch(user.id, { name: 'Ada L.' })));
    expect(updated).toMatchObject({ id: user.id, email: user.email, name: 'Ada L.', createdAt: user.createdAt });
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(user.updatedAt));
  });

  it('name: null clears the name', async () => {
    const { api, user } = await seeded();
    expect((await expectUpdated(await api.update(user.id, patch(user.id, { name: null })))).name).toBeNull();
  });

  it('normalizes a new email', async () => {
    const { api, user } = await seeded();
    const updated = await expectUpdated(await api.update(user.id, patch(user.id, { email: ' NEW@Example.com ' })));
    expect(updated.email).toBe('new@example.com');
  });

  it('setting your own current email is fine (200)', async () => {
    const { api, user } = await seeded();
    await expectUpdated(await api.update(user.id, patch(user.id, { email: 'ADA@example.com' })));
  });

  it("changing to another user's email → 409 email_taken, nothing changed", async () => {
    const { api, user } = await seeded();
    await expectCreated(await api.create(post({ email: 'grace@example.com' })));
    await expectError(await api.update(user.id, patch(user.id, { email: 'grace@example.com' })), 409, 'email_taken');
    const page = await expectPage(await api.list(get()));
    expect(page.data.find((u) => u.id === user.id)?.email).toBe('ada@example.com');
  });

  it.each([
    ['id', { id: crypto.randomUUID() }],
    ['createdAt', { createdAt: '2020-01-01T00:00:00.000Z' }],
    ['updatedAt', { updatedAt: '2020-01-01T00:00:00.000Z' }],
  ])('rejects immutable field %s: 422 on that key, record untouched', async (key, body) => {
    const { api, user } = await seeded();
    const fields = await expectError(await api.update(user.id, patch(user.id, body)), 422, 'validation_error');
    expect(fields[key]?.length).toBeGreaterThan(0);
    const stored = (await expectPage(await api.list(get()))).data.find((u) => u.id === user.id);
    expect(stored).toEqual(user);
  });

  it('empty body {} → 422 (nothing to update)', async () => {
    const { api, user } = await seeded();
    const fields = await expectError(await api.update(user.id, patch(user.id, {})), 422, 'validation_error');
    expect(fields._form?.length).toBeGreaterThan(0);
  });

  it('non-UUID id → 422 on fields.id', async () => {
    const { api } = await seeded();
    const fields = await expectError(await api.update('123', patch('123', { name: 'x' })), 422, 'validation_error');
    expect(fields.id?.length).toBeGreaterThan(0);
  });

  it('valid but unknown id → 404 not_found', async () => {
    const { api } = await seeded();
    const id = crypto.randomUUID();
    await expectError(await api.update(id, patch(id, { name: 'x' })), 404, 'not_found');
  });

  it('malformed JSON → 400, text/plain → 415, oversized → 413', async () => {
    const { api, user } = await seeded();
    await expectError(await api.update(user.id, patch(user.id, null, { raw: '{' })), 400, 'invalid_json');
    await expectError(
      await api.update(user.id, patch(user.id, null, { raw: '{"name":"x"}', contentType: 'text/plain' })),
      415,
      'unsupported_media_type',
    );
    await expectError(
      await api.update(user.id, patch(user.id, { name: 'x'.repeat(MAX_BODY_BYTES) })),
      413,
      'payload_too_large',
    );
  });
});

describe('GET /api/users', () => {
  async function seedThree() {
    const api = makeApi();
    const ids: string[] = [];
    for (const n of ['one', 'two', 'three']) {
      ids.push((await expectCreated(await api.create(post({ email: `${n}@example.com` })))).id);
    }
    return { api, ids }; // ids[2] is the newest
  }

  it('empty store → 200 { data: [], nextCursor: null }', async () => {
    const page = await expectPage(await makeApi().list(get()));
    expect(page).toEqual({ data: [], nextCursor: null });
  });

  it('lists newest first with a default limit that fits small sets', async () => {
    const { api, ids } = await seedThree();
    const page = await expectPage(await api.list(get()));
    expect(page.data.map((u) => u.id)).toEqual([...ids].reverse());
    expect(page.nextCursor).toBeNull();
  });

  it('pages with limit=1: every user exactly once, last page has nextCursor null', async () => {
    const { api, ids } = await seedThree();
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page = await expectPage(await api.list(get(`?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)));
      expect(page.data.length).toBeLessThanOrEqual(1);
      seen.push(...page.data.map((u) => u.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual([...ids].reverse());
    expect(cursor).toBeNull();
  });

  it('a user created between pages does not duplicate or skip anyone', async () => {
    const { api, ids } = await seedThree();
    const first = await expectPage(await api.list(get('?limit=2')));
    expect(first.nextCursor).not.toBeNull();
    const newcomer = await expectCreated(await api.create(post({ email: 'late@example.com' })));
    const second = await expectPage(await api.list(get(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`)));
    const all = [...first.data, ...second.data].map((u) => u.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual([ids[2], ids[1], ids[0]]);
    expect(all).not.toContain(newcomer.id);
  });

  it.each([['0'], ['101'], ['abc'], ['1.5']])('limit=%s → 422 on fields.limit', async (limit) => {
    const fields = await expectError(await makeApi().list(get(`?limit=${limit}`)), 422, 'validation_error');
    expect(fields.limit?.length).toBeGreaterThan(0);
  });

  it('a tampered/foreign cursor → 422 on fields.cursor', async () => {
    const { api } = await seedThree();
    const fields = await expectError(await api.list(get('?cursor=garbage')), 422, 'validation_error');
    expect(fields.cursor?.length).toBeGreaterThan(0);
  });
});

describe('method handling', () => {
  it('unsupported method on the collection → 405 method_not_allowed + Allow', async () => {
    const res = await makeApi().collectionAny(new Request('http://localhost:4321/api/users', { method: 'DELETE' }));
    await expectError(res, 405, 'method_not_allowed');
    expect(res.headers.get('Allow')).toBe('GET, POST');
  });

  it('unsupported method on an item → 405 method_not_allowed + Allow', async () => {
    const id = crypto.randomUUID();
    const res = await makeApi().itemAny(id, new Request(`http://localhost:4321/api/users/${id}`, { method: 'PUT' }));
    await expectError(res, 405, 'method_not_allowed');
    expect(res.headers.get('Allow')).toBe('PATCH');
  });
});

describe('failure handling', () => {
  const SECRET = 'postgres://admin:hunter2@db.internal:5432/prod';
  const boom = (): never => {
    throw new Error(`connection failed: ${SECRET}`);
  };
  const throwingRepo: UserRepository = { create: boom, update: boom, list: boom };

  it.each([
    ['POST', (api: ReturnType<typeof makeApi>) => api.create(post({ email: uniqueEmail() }))],
    ['PATCH', (api: ReturnType<typeof makeApi>) => api.update(crypto.randomUUID(), patch('x', { name: 'x' }))],
    ['GET', (api: ReturnType<typeof makeApi>) => api.list(get())],
  ])('%s: a throwing repository → 500 internal_error without leaking internals', async (_m, call) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call(makeApi(throwingRepo));
    await expectError(res, 500, 'internal_error');
    const text = JSON.stringify(await json(res));
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('postgres');
    expect(text).not.toMatch(/\bat .*:\d+:\d+/); // no stack frames
    expect(logged).toHaveBeenCalled(); // the detail goes to server logs, not the client
    logged.mockRestore();
  });

  it('an async-rejecting repository is handled the same way', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const repo: UserRepository = {
      create: () => Promise.reject(new Error('boom')),
      update: () => Promise.reject(new Error('boom')),
      list: () => Promise.reject(new Error('boom')),
    };
    await expectError(await makeApi(repo).list(get()), 500, 'internal_error');
    logged.mockRestore();
  });
});
