/**
 * DATABASE_URL set → Postgres (Neon over HTTP). Unset → in-memory, but ONLY outside prod/preview: a deploy without a
 * database fails loudly here instead of silently "succeeding" into per-instance memory (ADR-002 guard).
 */
import { neon } from '@neondatabase/serverless';
import { MemoryUserRepository } from './memory-user-repository';
import { PostgresUserRepository, type Query } from './postgres-user-repository';
import type { UserRepository } from './user-repository';

export const neonQuery = (url: string): Query => {
  const sql = neon(url);
  return (text, params) => sql.query(text, [...params]) as Promise<Record<string, unknown>[]>;
};

export function selectRepository(databaseUrl: string | undefined, appEnv: string): UserRepository {
  if (databaseUrl) return new PostgresUserRepository(neonQuery(databaseUrl));
  if (appEnv === 'prod' || appEnv === 'preview') {
    throw new Error(`DATABASE_URL is not set (PUBLIC_APP_ENV=${appEnv}). Refusing to store users in per-instance memory.`);
  }
  return new MemoryUserRepository();
}
