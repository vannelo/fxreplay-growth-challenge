// Applies db/schema.sql to DATABASE_URL in one transaction. Every statement is idempotent, so re-running is safe.
// Usage: npm run db:migrate   (reads .env via node --env-file-if-exists)
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const statements = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
  .replace(/--.*$/gm, '')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

try {
  const sql = neon(url);
  await sql.transaction(statements.map((s) => sql.query(s)));
  console.log(`Applied ${statements.length} statements to ${new URL(url).host}.`);
} catch (error) {
  // Driver messages can echo the whole connection string (password included): print the error name only.
  console.error(`Migration failed: ${error?.name ?? 'Error'}${error?.code ? ` (${error.code})` : ''}`);
  process.exit(1);
}
