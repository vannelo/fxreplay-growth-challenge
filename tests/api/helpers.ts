import { expect } from 'vitest';
import {
  CreateUserResponse,
  ERROR_STATUS,
  ErrorEnvelope,
  ListUsersResponse,
  UpdateUserResponse,
  type ErrorCode,
  type User,
} from '../../src/contracts/users';
import { MemoryUserRepository } from '../../src/server/memory-user-repository';
import { noopAnalytics, type ServerAnalytics } from '../../src/analytics/server';
import { createUsersHandlers } from '../../src/server/users-handlers';
import type { UserRepository } from '../../src/server/user-repository';

const BASE = 'http://localhost:4321/api/users';

/** Deterministic clock: every call advances one second, so ordering/updatedAt assertions are exact. */
export function makeClock(startMs = Date.UTC(2026, 0, 1)) {
  let t = startMs - 1000;
  return () => new Date((t += 1000));
}

export function makeApi(repo?: UserRepository, analytics: ServerAnalytics = noopAnalytics) {
  const repository = repo ?? new MemoryUserRepository({ now: makeClock() });
  const h = createUsersHandlers(repository, analytics);
  return {
    repository,
    create: (req: Request) => h.collection.POST({ request: req, params: {} }),
    list: (req: Request) => h.collection.GET({ request: req, params: {} }),
    collectionAny: (req: Request) => h.collection.ALL({ request: req, params: {} }),
    update: (id: string, req: Request) => h.item.PATCH({ request: req, params: { id } }),
    itemAny: (id: string, req: Request) => h.item.ALL({ request: req, params: { id } }),
  };
}

export interface BodyOptions {
  /** Idempotency-Key header. undefined = fresh random key; null = omit the header. */
  key?: string | null;
  headers?: Record<string, string>;
  /** Send this exact string instead of JSON.stringify(body). */
  raw?: string;
  /** undefined = application/json; null = omit the header. */
  contentType?: string | null;
}

function build(method: string, url: string, body: unknown, opts: BodyOptions, withKey: boolean): Request {
  const headers = new Headers(opts.headers);
  const contentType = opts.contentType === undefined ? 'application/json' : opts.contentType;
  if (contentType !== null) headers.set('Content-Type', contentType);
  if (withKey && opts.key !== null) headers.set('Idempotency-Key', opts.key ?? crypto.randomUUID());
  return new Request(url, { method, headers, body: opts.raw ?? JSON.stringify(body) });
}

export const post = (body: unknown, opts: BodyOptions = {}) => build('POST', BASE, body, opts, true);
export const patch = (id: string, body: unknown, opts: BodyOptions = {}) =>
  build('PATCH', `${BASE}/${id}`, body, opts, false);
export const get = (query = '') => new Request(`${BASE}${query}`, { method: 'GET' });

export async function json(res: Response): Promise<unknown> {
  return JSON.parse(await res.clone().text());
}

/** Asserts status AND envelope shape AND that the code's contract status matches; returns `fields`. */
export async function expectError(res: Response, status: number, code: ErrorCode) {
  expect(res.status).toBe(status); // first, so a failure reads "expected 501 to be 422", not a JSON parse error
  const parsed = ErrorEnvelope.parse(await json(res));
  expect(parsed.error.code).toBe(code);
  expect(ERROR_STATUS[code]).toBe(status);
  expect(Object.keys(parsed.error).filter((k) => !['code', 'message', 'fields'].includes(k))).toEqual([]);
  return parsed.error.fields ?? {};
}

const USER_KEYS = ['createdAt', 'email', 'id', 'name', 'updatedAt'];

export async function expectCreated(res: Response): Promise<User> {
  expect(res.status).toBe(201);
  const raw = (await json(res)) as { data: object };
  expect(Object.keys(raw)).toEqual(['data']);
  expect(Object.keys(raw.data).sort()).toEqual(USER_KEYS); // no extra / leaked fields
  return CreateUserResponse.parse(raw).data;
}

export async function expectUpdated(res: Response): Promise<User> {
  expect(res.status).toBe(200);
  return UpdateUserResponse.parse(await json(res)).data;
}

export async function expectPage(res: Response) {
  expect(res.status).toBe(200);
  return ListUsersResponse.parse(await json(res));
}

export const uniqueEmail = (() => {
  let n = 0;
  return () => `user${++n}@example.com`;
})();
