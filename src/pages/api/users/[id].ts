import type { APIRoute } from 'astro';
import { usersRepository } from '../../../server/repository';
import { createUsersHandlers } from '../../../server/users-handlers';

export const prerender = false;

const { item } = createUsersHandlers(usersRepository);

export const PATCH: APIRoute = item.PATCH;
export const ALL: APIRoute = item.ALL;
