import { MemoryUserRepository } from './memory-user-repository';

/**
 * Process-wide repository for the route modules. In-memory only for now: the Postgres adapter and the
 * "production build without DATABASE_URL fails at startup" guard from ADR-002 land together (not yet built).
 */
export const usersRepository = new MemoryUserRepository();
