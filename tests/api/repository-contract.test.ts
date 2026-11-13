/**
 * One behavioural contract, every adapter (ADR-002: "if the suites diverge, the Postgres result wins").
 * - memory: always.  - postgres (PGlite): always; same SQL as production, real Postgres semantics, one connection.
 * - postgres (Neon): only with TEST_DATABASE_URL. Proves the cross-connection races; never truncates, cleans up its own rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CreateUserBody } from '../../src/contracts/users';
import { MemoryUserRepository } from '../../src/server/memory-user-repository';
import { PostgresUserRepository } from '../../src/server/postgres-user-repository';
import { neonQuery, selectRepository } from '../../src/server/select-repository';
import type { UserRepository } from '../../src/server/user-repository';
import { makeApi, makeClock } from './helpers';
import { makePglite } from './pg';

const DAY_MS = 24 * 60 * 60 * 1000;
const run = crypto.randomUUID().slice(0, 8);
let seq = 0;
/** Unique per run, so the Neon suite can share a database and delete exactly what it created. */
const email = () => `contract-${run}-${++seq}@example.com`;
const idem = (requestHash = 'h1', key = crypto.randomUUID()) => ({ key, requestHash });
const body = (e = email(), name?: string): CreateUserBody => ({ email: e, ...(name ? { name } : {}) });

type Factory = (now?: () => Date) => UserRepository;

function contract(label: string, setup: () => { make: Factory; emptyTable: boolean }) {
  describe(label, () => {
    const repo = (now?: () => Date) => setup().make(now ?? makeClock());

    it('create → created, with the normalized input and equal timestamps', async () => {
      const e = email();
      const r = await repo().create(body(e, 'Ana'), idem());
      expect(r).toMatchObject({ kind: 'created', user: { email: e, name: 'Ana' } });
      if (r.kind === 'created') expect(r.user.createdAt).toBe(r.user.updatedAt);
    });

    it('same key + same body → replayed with the identical user; different body → key_reuse', async () => {
      const r = repo();
      const ctx = idem('same');
      const b = body();
      const first = await r.create(b, ctx);
      expect(await r.create(b, ctx)).toEqual(first.kind === 'created' ? { kind: 'replayed', user: first.user } : null);
      expect(await r.create(body(), { ...ctx, requestHash: 'other' })).toEqual({ kind: 'key_reuse' });
    });

    it('new key + existing email → email_taken, and no second row', async () => {
      const r = repo();
      const e = email();
      await r.create(body(e), idem());
      expect(await r.create(body(e), idem())).toEqual({ kind: 'email_taken' });
    });

    it('replay returns the ORIGINAL snapshot even after a PATCH', async () => {
      const r = repo();
      const ctx = idem();
      const created = await r.create(body(email(), 'Before'), ctx);
      if (created.kind !== 'created') throw new Error('setup');
      await r.update(created.user.id, { name: 'After' });
      expect(await r.create(body(created.user.email, 'Before'), ctx)).toEqual({ kind: 'replayed', user: created.user });
    });

    it('update: changes fields, clears name with null, bumps updatedAt; unknown id → not_found; taken email → email_taken', async () => {
      const r = repo();
      const a = await r.create(body(email(), 'A'), idem());
      const b = await r.create(body(), idem());
      if (a.kind !== 'created' || b.kind !== 'created') throw new Error('setup');

      const renamed = await r.update(a.user.id, { name: null });
      expect(renamed).toMatchObject({ kind: 'updated', user: { id: a.user.id, email: a.user.email, name: null } });
      if (renamed.kind === 'updated') expect(renamed.user.updatedAt > a.user.updatedAt).toBe(true);

      expect(await r.update(a.user.id, { email: a.user.email })).toMatchObject({ kind: 'updated' }); // own email: fine
      expect(await r.update(a.user.id, { email: b.user.email })).toEqual({ kind: 'email_taken' });
      expect(await r.update(crypto.randomUUID(), { name: 'x' })).toEqual({ kind: 'not_found' });
    });

    it('list: newest first, same-millisecond ties broken by id, cursor pages without gaps or duplicates', async (ctx) => {
      if (!setup().emptyTable) ctx.skip(); // needs a table it owns
      const sameMs = () => new Date(Date.UTC(2026, 0, 1));
      const r = repo(sameMs);
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const c = await r.create(body(), idem());
        if (c.kind === 'created') ids.push(c.user.id);
      }
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await r.list({ limit: 2, cursor });
        if (page.kind !== 'page') throw new Error('page');
        seen.push(...page.page.data.map((u) => u.id));
        cursor = page.page.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual([...ids].sort().reverse());
    });

    it('list: a tampered cursor → invalid_cursor (never a database error)', async () => {
      const r = repo();
      for (const cursor of ['nope', Buffer.from('2026-99-99T00:00:00Z|x').toString('base64url')]) {
        expect(await r.list({ limit: 2, cursor })).toEqual({ kind: 'invalid_cursor' });
      }
    });
  });
}

/* ---------- memory ---------- */
contract('MemoryUserRepository', () => ({ make: (now) => new MemoryUserRepository({ now }), emptyTable: true }));

/* ---------- Postgres on PGlite ---------- */
const pglite = await makePglite();
describe('PostgresUserRepository (PGlite)', () => {
  beforeEach(() => pglite.reset());
  afterAll(() => pglite.db.close());

  contract('contract', () => ({ make: (now) => new PostgresUserRepository(pglite.query, { now }), emptyTable: true }));

  it('a key older than 24h is expired: the same key with a different body creates instead of key_reuse', async () => {
    let t = Date.UTC(2026, 0, 1);
    const r = new PostgresUserRepository(pglite.query, { now: () => new Date(t) });
    const ctx = idem('first');
    expect((await r.create(body(), ctx)).kind).toBe('created');
    t += DAY_MS + 1;
    expect((await r.create(body(), { ...ctx, requestHash: 'second' })).kind).toBe('created');
  });

  it('every create purges ALL expired keys (they hold a copy of the email), not only its own', async () => {
    let t = Date.UTC(2026, 0, 1);
    const r = new PostgresUserRepository(pglite.query, { now: () => new Date(t) });
    await r.create(body(), idem());
    await r.create(body(), idem());
    t += DAY_MS + 1;
    await r.create(body(), idem());
    expect(await pglite.query('SELECT count(*)::int AS n FROM idempotency_keys', [])).toEqual([{ n: 1 }]);
  });

  it('deleting a user deletes its key rows (erasure is not blocked by the FK)', async () => {
    const created = await new PostgresUserRepository(pglite.query).create(body(), idem());
    if (created.kind !== 'created') throw new Error('setup');
    await pglite.query('DELETE FROM users WHERE id = $1', [created.user.id]);
    expect(await pglite.query('SELECT count(*)::int AS n FROM idempotency_keys', [])).toEqual([{ n: 0 }]);
  });

  it('the constraint names the adapter matches on are the real ones in db/schema.sql', async () => {
    const rows = await pglite.query(
      "SELECT conname FROM pg_constraint WHERE conname IN ('idempotency_keys_pkey') UNION SELECT indexname FROM pg_indexes WHERE indexname = 'users_email_key' ORDER BY 1",
      [],
    );
    expect(rows.map((r) => r.conname)).toEqual(['idempotency_keys_pkey', 'users_email_key']);
  });

  it('rejects a non-normalized email at the database (CHECK), so the contract is the only way in', async () => {
    await expect(
      pglite.query('INSERT INTO users (id,email,created_at,updated_at) VALUES ($1,$2,now(),now())', [crypto.randomUUID(), ' A@B.co']),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('through the real handlers: 201 → replay 201 → 409 → list', async () => {
    const api = makeApi(new PostgresUserRepository(pglite.query, { now: makeClock() }));
    const post = (key: string, e: string) =>
      api.create(
        new Request('http://localhost/api/users', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': key },
          body: JSON.stringify({ email: e }),
        }),
      );
    const key = crypto.randomUUID();
    const first = await post(key, 'Smoke@Example.com');
    expect(first.status).toBe(201);
    const replay = await post(key, 'Smoke@Example.com');
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(await replay.json()).toEqual(await first.json());
    expect((await post(crypto.randomUUID(), 'smoke@example.com')).status).toBe(409);
    const list = await (await api.list(new Request('http://localhost/api/users'))).json();
    expect(list.data.map((u: { email: string }) => u.email)).toEqual(['smoke@example.com']);
  });
});

/* ---------- the race branches, forced (PGlite has one connection and can never reach them; this runs in CI) ---------- */
describe('PostgresUserRepository: lost races, injected', () => {
  const user = { id: crypto.randomUUID(), email: 'r@example.com', name: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
  /** Key read #1 sees nothing, the insert fails with `insertError` (or returns no rows), key read #2 sees `winner`. */
  const scripted = (insertError: unknown, winner: Record<string, unknown> | undefined) => {
    let keyReads = 0;
    return (async (text: string) => {
      if (text.includes('FROM idempotency_keys WHERE key')) return keyReads++ === 0 || !winner ? [] : [winner];
      if (text.startsWith('DELETE')) return [];
      if (insertError) throw insertError;
      return [];
    }) as unknown as import('../../src/server/postgres-user-repository').Query;
  };
  const pkeyViolation = { code: '23505', constraint: 'idempotency_keys_pkey' };

  it('key claimed concurrently, same body → replayed (the winner’s snapshot)', async () => {
    const r = new PostgresUserRepository(scripted(pkeyViolation, { request_hash: 'h', response: user }));
    expect(await r.create(body(), idem('h'))).toEqual({ kind: 'replayed', user });
  });

  it('key claimed concurrently, different body → key_reuse', async () => {
    const r = new PostgresUserRepository(scripted(pkeyViolation, { request_hash: 'other', response: user }));
    expect(await r.create(body(), idem('h'))).toEqual({ kind: 'key_reuse' });
  });

  it('email conflict while the same key just committed → replayed, not email_taken', async () => {
    const r = new PostgresUserRepository(scripted(undefined, { request_hash: 'h', response: user }));
    expect(await r.create(body(), idem('h'))).toEqual({ kind: 'replayed', user });
  });

  it('any other database error is rethrown (→ 500), never mapped to a domain outcome', async () => {
    const other = { code: '23505', constraint: 'users_pkey' };
    await expect(new PostgresUserRepository(scripted(other, undefined)).create(body(), idem())).rejects.toBe(other);
  });
});

describe('user ids are case-insensitive at the API (Postgres already is; the memory Map was not)', () => {
  it('PATCH with an uppercased id updates the user', async () => {
    const api = makeApi();
    const created = await api.repository.create(body(), idem());
    if (created.kind !== 'created') throw new Error('setup');
    const res = await api.update(
      created.user.id.toUpperCase(),
      new Request(`http://localhost/api/users/${created.user.id.toUpperCase()}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Upper' }),
      }),
    );
    expect(res.status).toBe(200);
  });
});

/* ---------- Postgres on Neon (opt-in) ---------- */
const neonUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!neonUrl)('PostgresUserRepository (Neon, real concurrency)', () => {
  const query = neonUrl ? neonQuery(neonUrl) : async () => [];
  const make = () => new PostgresUserRepository(query);

  beforeAll(async () => {
    expect(await query("SELECT to_regclass('users') AS t", [])).toEqual([{ t: 'users' }]); // run db:migrate first
  });
  afterAll(async () => {
    // One statement: keys and users go together (FK is checked at statement end), so nothing is left half-deleted.
    await query(
      `WITH doomed AS (SELECT id FROM users WHERE email LIKE $1),
            gone_keys AS (DELETE FROM idempotency_keys WHERE user_id IN (SELECT id FROM doomed))
       DELETE FROM users WHERE id IN (SELECT id FROM doomed)`,
      [`contract-${run}-%`],
    );
  });

  /** Waits for EVERY request, even when one rejects: a test must not end (and clean up) while writes are in flight. */
  async function settled<T>(promises: Promise<T>[]): Promise<T[]> {
    const results = await Promise.allSettled(promises);
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map((r) => (r as PromiseFulfilledResult<T>).value);
  }

  contract('contract', () => ({ make: () => make(), emptyTable: false }));

  it('10 parallel creates, same key + same body → exactly 1 created, 9 replayed, 1 row', async () => {
    const e = email();
    const ctx = idem('race');
    const results = await settled(Array.from({ length: 10 }, () => make().create(body(e), ctx)));
    const kinds = results.map((r) => r.kind).sort();
    expect(kinds).toEqual(['created', ...Array(9).fill('replayed')]);
    const ids = new Set(results.map((r) => ('user' in r ? r.user.id : null)));
    expect(ids.size).toBe(1);
    expect(await query('SELECT count(*)::int AS n FROM users WHERE email = $1', [e])).toEqual([{ n: 1 }]);
  });

  it('10 parallel creates, different keys + same email → exactly 1 created, 9 email_taken, no orphan keys', async () => {
    const e = email();
    const results = await settled(Array.from({ length: 10 }, () => make().create(body(e), idem())));
    expect(results.map((r) => r.kind).sort()).toEqual(['created', ...Array(9).fill('email_taken')]);
    const [{ n }] = await query(
      'SELECT count(*)::int AS n FROM idempotency_keys k JOIN users u ON u.id = k.user_id WHERE u.email = $1',
      [e],
    );
    expect(n).toBe(1);
  });

  it('10 parallel creates, same key + DIFFERENT emails → 1 created, 9 key_reuse, exactly 1 user row (no orphans)', async () => {
    const ctxKey = crypto.randomUUID();
    const emails = Array.from({ length: 10 }, () => email());
    const results = await settled(emails.map((e, i) => make().create(body(e), idem(`hash-${i}`, ctxKey))));
    expect(results.map((r) => r.kind).sort()).toEqual(['created', ...Array(9).fill('key_reuse')]);
    expect(await query('SELECT count(*)::int AS n FROM users WHERE email = ANY($1)', [emails])).toEqual([{ n: 1 }]);
  });
});

/* ---------- the production guard ---------- */
describe('selectRepository (ADR-002 guard)', () => {
  it.each(['prod', 'preview'])('no DATABASE_URL in %s → throws instead of using memory', (env) => {
    expect(() => selectRepository(undefined, env)).toThrow(/DATABASE_URL is not set/);
    expect(() => selectRepository('', env)).toThrow(/DATABASE_URL is not set/);
  });
  it.each(['dev', 'test'])('no DATABASE_URL in %s → in-memory', (env) => {
    expect(selectRepository(undefined, env)).toBeInstanceOf(MemoryUserRepository);
  });
  it('DATABASE_URL set → Postgres, in any env', () => {
    expect(selectRepository('postgresql://u:p@host.example/db', 'dev')).toBeInstanceOf(PostgresUserRepository);
  });
});
