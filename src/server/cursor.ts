/** Keyset cursor shared by both repository adapters, so a cursor means the same thing whichever one issued it. */
import * as z from 'zod/mini';

export interface Position {
  createdAt: string;
  id: string;
}

const CURSOR_PATTERN = /^([^|]+)\|([^|]+)$/;
const CursorParts = z.object({ createdAt: z.iso.datetime(), id: z.uuid() });

export const encodeCursor = ({ createdAt, id }: Position) =>
  Buffer.from(`${createdAt}|${id}`, 'utf8').toString('base64url');

export function decodeCursor(cursor: string): Position | undefined {
  const match = CURSOR_PATTERN.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  // Both halves must be real values (a date that exists, a UUID), not just the right shape: otherwise the Postgres
  // adapter would turn "2026-99-99" into a database error and a 500 (audit finding).
  const parts = match && CursorParts.safeParse({ createdAt: match[1], id: match[2] });
  return parts?.success ? parts.data : undefined;
}
