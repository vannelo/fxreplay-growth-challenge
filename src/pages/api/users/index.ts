import type { APIRoute } from 'astro';
import { usersRepository } from '../../../server/repository';
import { createUsersHandlers } from '../../../server/users-handlers';

export const prerender = false;

const { collection } = createUsersHandlers(usersRepository);

export const GET: APIRoute = collection.GET;
export const POST: APIRoute = collection.POST;
export const ALL: APIRoute = collection.ALL;
