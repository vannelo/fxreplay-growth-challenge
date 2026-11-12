/**
 * In-memory adapter for local dev and tests (ADR-002). NOT for the serverless deploy: each instance has its own copy
 * and cold starts wipe it. Idempotency keys never expire here (process lifetime); the Postgres adapter expires them at 24h.
 * Every method is synchronous inside (no `await` between check and write), which is what makes create atomic.
 */
import type { CreateUserBody, ListUsersQuery, UpdateUserBody, User } from '../contracts/users';
import type { CreateResult, IdempotencyContext, ListResult, UpdateResult, UserRepository } from './user-repository';

export interface MemoryUserRepositoryOptions {
  now?: () => Date;
  newId?: () => string;
}

interface Position {
  createdAt: string;
  id: string;
}

const CURSOR_PATTERN = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\|([0-9a-f-]{36})$/;

const encodeCursor = ({ createdAt, id }: Position) => Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');

function decodeCursor(cursor: string): Position | undefined {
  const match = CURSOR_PATTERN.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return match ? { createdAt: match[1]!, id: match[2]! } : undefined;
}

/** Newest first; id breaks ties between users created in the same millisecond. 0 only for the same position. */
function compareNewestFirst(a: Position, b: Position): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export class MemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  private readonly idByEmail = new Map<string, string>();
  private readonly keys = new Map<string, { requestHash: string; userId: string }>();
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor({ now = () => new Date(), newId = () => crypto.randomUUID() }: MemoryUserRepositoryOptions = {}) {
    this.now = now;
    this.newId = newId;
  }

  async create(input: CreateUserBody, { key, requestHash }: IdempotencyContext): Promise<CreateResult> {
    const seen = this.keys.get(key);
    if (seen) {
      if (seen.requestHash !== requestHash) return { kind: 'key_reuse' };
      return { kind: 'replayed', user: { ...this.users.get(seen.userId)! } }; // users are never deleted
    }
    if (this.idByEmail.has(input.email)) return { kind: 'email_taken' };

    const timestamp = this.now().toISOString();
    const user: User = {
      id: this.newId(),
      email: input.email,
      name: input.name ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.users.set(user.id, user);
    this.idByEmail.set(user.email, user.id);
    this.keys.set(key, { requestHash, userId: user.id });
    return { kind: 'created', user: { ...user } };
  }

  async update(id: string, patch: UpdateUserBody): Promise<UpdateResult> {
    const user = this.users.get(id);
    if (!user) return { kind: 'not_found' };

    if (patch.email !== undefined && patch.email !== user.email) {
      if (this.idByEmail.has(patch.email)) return { kind: 'email_taken' };
      this.idByEmail.delete(user.email);
      this.idByEmail.set(patch.email, id);
    }
    const next: User = {
      ...user,
      email: patch.email ?? user.email,
      name: patch.name === undefined ? user.name : patch.name,
      updatedAt: this.now().toISOString(),
    };
    this.users.set(id, next);
    return { kind: 'updated', user: { ...next } };
  }

  async list({ limit, cursor }: ListUsersQuery): Promise<ListResult> {
    const after = cursor === undefined ? undefined : decodeCursor(cursor);
    if (cursor !== undefined && !after) return { kind: 'invalid_cursor' };

    const ordered = [...this.users.values()].sort(compareNewestFirst);
    const remaining = after ? ordered.filter((user) => compareNewestFirst(after, user) < 0) : ordered;
    const data = remaining.slice(0, limit);
    const last = data.at(-1);
    return {
      kind: 'page',
      page: { data: data.map((user) => ({ ...user })), nextCursor: remaining.length > limit && last ? encodeCursor(last) : null },
    };
  }
}
