/** One test per finding from the independent API review (docs/ai-judgment-log.md, P6.1). Each reproduces the reported input. */
import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES } from '../../src/contracts/users';
import type { ServerAnalytics } from '../../src/analytics/server';
import { expectCreated, expectError, expectPage, expectUpdated, get, makeApi, patch, post, uniqueEmail } from './helpers';

const PROTOTYPE_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty'];

describe('unknown keys named after Object.prototype members are data, not a crash (was: 500)', () => {
  it.each(PROTOTYPE_KEYS)('POST with "%s" → 422 on that key', async (key) => {
    const res = await makeApi().create(post(null, { raw: `{"email":"${uniqueEmail()}","${key}":1}` }));
    await expectError(res, 422, 'validation_error');
    // Read the raw JSON: a schema-built object (z.record) would itself drop a "__proto__" key, hiding what the server sent.
    const raw = JSON.parse(await res.clone().text()) as { error: { fields: object } };
    expect(Object.getOwnPropertyDescriptor(raw.error.fields, key)?.value).toEqual([`"${key}" is not allowed`]);
  });

  it.each(PROTOTYPE_KEYS)('PATCH with "%s" → 422, and nothing is polluted', async (key) => {
    const api = makeApi();
    const user = await expectCreated(await api.create(post({ email: uniqueEmail() })));
    const res = await api.update(user.id, patch(user.id, null, { raw: `{"name":"x","${key}":{"prototype":{"polluted":1},"isAdmin":true}}` }));
    await expectError(res, 422, 'validation_error');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
  });
});

describe('request bodies are capped while streaming, not after buffering (was: whole body read first)', () => {
  it('a chunked body with NO Content-Length gets 413 and the stream is cancelled early', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode(`{"email":"a@b.co","name":"${'x'.repeat(1000)}`);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close(); // ~1 MB if fully read
        else controller.enqueue(chunk);
      },
    });
    const request = new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(request.headers.get('content-length')).toBeNull();
    await expectError(await makeApi().create(request), 413, 'payload_too_large');
    expect(pulled).toBeLessThan(Math.ceil(MAX_BODY_BYTES / chunk.byteLength) + 3); // stopped right after the cap, not at 1000
  });

  it('invalid UTF-8 is rejected (400), never stored with U+FFFD in it', async () => {
    const api = makeApi();
    const bytes = new Uint8Array([...new TextEncoder().encode(`{"email":"${uniqueEmail()}","name":"a`), 0xff, ...new TextEncoder().encode('b"}')]);
    const request = new Request('http://localhost/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: bytes,
    });
    await expectError(await api.create(request), 400, 'invalid_json');
    expect((await expectPage(await api.list(get()))).data).toHaveLength(0);
  });
});

describe('idempotent replay returns the ORIGINAL 201 body (was: current state after a PATCH)', () => {
  it('replay after a PATCH still returns what the first request returned', async () => {
    const api = makeApi();
    const key = crypto.randomUUID();
    const body = { email: 'orig@example.com', name: 'Orig' };
    const original = await expectCreated(await api.create(post(body, { key })));
    await expectUpdated(await api.update(original.id, patch(original.id, { email: 'changed@example.com', name: null })));
    const replay = await api.create(post(body, { key }));
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true');
    expect(await expectCreated(replay)).toEqual(original);
  });
});

describe('query validation is strict (was: lenient coercion, non-date cursors)', () => {
  it.each(['1e1', '0x2', ' ', '+5', '-1'])('limit=%j → 422', async (limit) => {
    const fields = await expectError(await makeApi().list(get(`?limit=${encodeURIComponent(limit)}`)), 422, 'validation_error');
    expect(fields.limit?.length).toBeGreaterThan(0);
  });

  it('a cursor that decodes to an impossible date / a non-UUID id → 422, not data', async () => {
    const api = makeApi();
    await api.create(post({ email: uniqueEmail() }));
    for (const raw of ['2026-99-99T::.Z|------------------------------------', `2026-01-01T00:00:00.000Z|not-a-uuid`]) {
      const cursor = Buffer.from(raw, 'utf8').toString('base64url');
      await expectError(await api.list(get(`?limit=1&cursor=${cursor}`)), 422, 'validation_error');
    }
  });
});

describe('names: real-world scripts accepted, invisible tricks rejected (was: ZWNJ/ZWJ rejected)', () => {
  it.each([
    ['Persian with ZWNJ', 'می‌روم'],
    ['emoji ZWJ sequence', 'Ana 👨‍👩‍👧'],
    ['Devanagari with ZWJ', 'क्‍ष'],
  ])('%s → 201', async (_l, name) => {
    expect((await expectCreated(await makeApi().create(post({ email: uniqueEmail(), name })))).name).toBe(name);
  });

  it.each([
    ['right-to-left override', 'admin‮gnp.exe'],
    ['zero-width space', 'a​b'],
    ['byte-order mark', 'a﻿b'],
    ['NUL', 'a\u0000b'],
  ])('%s → 422', async (_l, name) => {
    const fields = await expectError(await makeApi().create(post({ email: uniqueEmail(), name })), 422, 'validation_error');
    expect(fields.name?.length).toBeGreaterThan(0);
  });
});

describe('every API response is non-cacheable and non-sniffable (was: list of emails cacheable)', () => {
  it('201, 200, 422, 404, 405 and 500 all carry no-store + nosniff', async () => {
    const api = makeApi();
    const created = await api.create(post({ email: uniqueEmail() }));
    const boom = (): never => {
      throw new Error('x');
    };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const responses = [
      created,
      await api.list(get()),
      await api.create(post({ email: 'nope' })),
      await api.update(crypto.randomUUID(), patch('x', { name: 'x' })),
      await api.collectionAny(new Request('http://localhost/api/users', { method: 'DELETE' })),
      await makeApi({ create: boom, update: boom, list: boom }).list(get()),
    ];
    log.mockRestore();
    expect(responses.map((r) => r.status)).toEqual([201, 200, 422, 404, 405, 500]);
    for (const r of responses) {
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    }
  });
});

describe('analytics can never change the HTTP response (was: a throwing capture turned a created signup into a 500)', () => {
  const throwing: ServerAnalytics = {
    capture() {
      throw new Error('analytics exploded with a@b.co inside');
    },
  };

  it('a valid signup still gets 201 and creates exactly one user', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const api = makeApi(undefined, throwing);
    await expectCreated(await api.create(post({ email: uniqueEmail() })));
    expect((await expectPage(await api.list(get()))).data).toHaveLength(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('a@b.co'); // and the log is redacted
    log.mockRestore();
  });

  it('a failing signup still gets its own error envelope (the failure observer throwing is contained)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expectError(await makeApi(undefined, throwing).create(post({ email: 'nope' })), 422, 'validation_error');
    log.mockRestore();
  });
});
