/**
 * Postgres adapter (ADR-002). Runs on Neon's HTTP driver in production and on PGlite in tests, through `Query`.
 *
 * No interactive transactions (Neon over HTTP can't hold one open): every write is ONE statement, which Postgres
 * runs atomically. `create` inserts the user and claims the idempotency key in a single CTE, so a user is never
 * stored without its key. Races are settled by the unique indexes, and the loser re-reads the key (see `create`).
 * Ids and timestamps come from the app, like the memory adapter: same cursor format, same millisecond precision.
 */
import { User, type CreateUserBody, type ListUsersQuery, type UpdateUserBody } from '../contracts/users';
import { decodeCursor, encodeCursor } from './cursor';
import type { CreateResult, IdempotencyContext, ListResult, UpdateResult, UserRepository } from './user-repository';

type Row = Record<string, unknown>;
/** A parameterized query returning rows: Neon's `sql.query` and PGlite's `db.query` both fit behind this. */
export type Query = (text: string, params: readonly unknown[]) => Promise<Row[]>;

export interface PostgresUserRepositoryOptions {
  now?: () => Date;
  newId?: () => string;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const USER_COLUMNS = 'id, email, name, created_at, updated_at';

const CREATE_SQL = `
  WITH new_user AS (
    INSERT INTO users (id, email, name, created_at, updated_at)
    VALUES ($1::uuid, $2::text, $3::text, $4::timestamptz, $4::timestamptz)
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  )
  INSERT INTO idempotency_keys (key, request_hash, user_id, response, expires_at)
  SELECT $5::text, $6::text, new_user.id, $7::jsonb, $8::timestamptz FROM new_user
  RETURNING user_id`;

const isUniqueViolation = (error: unknown, constraint: string) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === '23505' &&
  (error as { constraint?: unknown }).constraint === constraint;

const iso = (value: unknown) => new Date(value as string | Date).toISOString();

const toUser = (row: Row): User => ({
  id: String(row.id),
  email: String(row.email),
  name: row.name === null ? null : String(row.name),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

export class PostgresUserRepository implements UserRepository {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(
    private readonly query: Query,
    { now = () => new Date(), newId = () => crypto.randomUUID() }: PostgresUserRepositoryOptions = {},
  ) {
    this.now = now;
    this.newId = newId;
  }

  async create(input: CreateUserBody, { key, requestHash }: IdempotencyContext): Promise<CreateResult> {
    const timestamp = this.now().toISOString();
    const seen = await this.findKey(key, requestHash, timestamp);
    if (seen) return seen;

    const user: User = { id: this.newId(), email: input.email, name: input.name ?? null, createdAt: timestamp, updatedAt: timestamp };
    const expiresAt = new Date(Date.parse(timestamp) + IDEMPOTENCY_TTL_MS).toISOString();
    // Purge every expired key (indexed): this one, so it can't block the insert below, and the rest, because each holds
    // a copy of a user's email and clients send a fresh key per submit (they would otherwise never be deleted).
    await this.query('DELETE FROM idempotency_keys WHERE expires_at <= $1::timestamptz', [timestamp]);

    try {
      const rows = await this.query(CREATE_SQL, [user.id, user.email, user.name, timestamp, key, requestHash, JSON.stringify(user), expiresAt]);
      if (rows.length === 1) return { kind: 'created', user };
      // Zero rows: the email exists. A concurrent request with this key may have just created it, so ask the key first.
    } catch (error) {
      // A concurrent request claimed this key first. The whole statement rolled back (no orphan user); read its result.
      if (!isUniqueViolation(error, 'idempotency_keys_pkey')) throw error;
    }
    return (await this.findKey(key, requestHash, timestamp)) ?? { kind: 'email_taken' };
  }

  async update(id: string, patch: UpdateUserBody): Promise<UpdateResult> {
    try {
      const rows = await this.query(
        `UPDATE users
            SET email = COALESCE($2::text, email),
                name = CASE WHEN $3::boolean THEN $4::text ELSE name END,
                updated_at = $5::timestamptz
          WHERE id = $1::uuid
         RETURNING ${USER_COLUMNS}`,
        [id, patch.email ?? null, patch.name !== undefined, patch.name ?? null, this.now().toISOString()],
      );
      const row = rows[0];
      return row ? { kind: 'updated', user: toUser(row) } : { kind: 'not_found' };
    } catch (error) {
      if (isUniqueViolation(error, 'users_email_key')) return { kind: 'email_taken' };
      throw error;
    }
  }

  async list({ limit, cursor }: ListUsersQuery): Promise<ListResult> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    if (cursor !== undefined && !after) return { kind: 'invalid_cursor' };

    const rows = await this.query(
      `SELECT ${USER_COLUMNS} FROM users
        WHERE $1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid)
        ORDER BY created_at DESC, id DESC
        LIMIT $3::int`,
      [after?.createdAt ?? null, after?.id ?? null, limit + 1],
    );
    const data = rows.slice(0, limit).map(toUser);
    const last = data.at(-1);
    return { kind: 'page', page: { data, nextCursor: rows.length > limit && last ? encodeCursor(last) : null } };
  }

  private async findKey(key: string, requestHash: string, at: string): Promise<CreateResult | undefined> {
    const [row] = await this.query(
      'SELECT request_hash, response FROM idempotency_keys WHERE key = $1 AND expires_at > $2::timestamptz',
      [key, at],
    );
    if (!row) return undefined;
    if (row.request_hash !== requestHash) return { kind: 'key_reuse' };
    // Stored by this adapter, but parsed anyway: a malformed snapshot must fail loudly, not replay garbage.
    return { kind: 'replayed', user: User.parse(typeof row.response === 'string' ? JSON.parse(row.response) : row.response) };
  }
}
