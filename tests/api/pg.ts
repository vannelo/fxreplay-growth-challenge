/** Test-only Postgres: PGlite (real Postgres compiled to WASM, in-process) loaded with the production schema. */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import type { Query } from '../../src/server/postgres-user-repository';

const SCHEMA = readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');

export async function makePglite() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  const query: Query = async (text, params) => (await db.query<Record<string, unknown>>(text, [...params])).rows;
  return { db, query, reset: () => db.exec('TRUNCATE idempotency_keys, users') };
}
