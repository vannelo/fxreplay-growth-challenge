/** Process-wide repository for the route modules (ADR-002). Selection and the production guard: `select-repository.ts`. */
import { PUBLIC_APP_ENV } from 'astro:env/client';
import { DATABASE_URL } from 'astro:env/server';
import { selectRepository } from './select-repository';

export const usersRepository = selectRepository(DATABASE_URL, PUBLIC_APP_ENV);
