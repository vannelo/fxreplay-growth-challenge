import type { APIRoute } from 'astro';
import { serverAnalytics } from '../../../server/analytics';
import { usersRepository } from '../../../server/repository';
import { createUsersHandlers } from '../../../server/users-handlers';

export const prerender = false;

const { item } = createUsersHandlers(usersRepository, serverAnalytics);

export const PATCH: APIRoute = item.PATCH;
export const ALL: APIRoute = item.ALL;
