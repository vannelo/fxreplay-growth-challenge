/** Persistence port (ADR-002). Outcomes are returned, not thrown, so handlers map them 1:1 to contract error codes. */
import type { CreateUserBody, ListUsersQuery, ListUsersResponse, UpdateUserBody, User } from '../contracts/users';

export interface IdempotencyContext {
  key: string;
  /** sha256 of the normalized create body: same key + different hash = key reuse. */
  requestHash: string;
}

export type CreateResult =
  | { kind: 'created'; user: User }
  | { kind: 'replayed'; user: User } // same key + same payload
  | { kind: 'key_reuse' } // same key, different payload
  | { kind: 'email_taken' };

export type UpdateResult = { kind: 'updated'; user: User } | { kind: 'not_found' } | { kind: 'email_taken' };

export type ListResult = { kind: 'page'; page: ListUsersResponse } | { kind: 'invalid_cursor' };

export interface UserRepository {
  create(input: CreateUserBody, idempotency: IdempotencyContext): Promise<CreateResult>;
  update(id: string, patch: UpdateUserBody): Promise<UpdateResult>;
  list(query: ListUsersQuery): Promise<ListResult>;
}
