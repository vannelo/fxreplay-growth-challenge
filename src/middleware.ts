import { defineMiddleware } from 'astro:middleware';
import { UUID_PATTERN, VARIANT_COOKIE, VISITOR_COOKIE, assignVariant, isVariant } from './lib/experiment';

const NINETY_DAYS = 60 * 60 * 24 * 90;

/**
 * Landing page only (ADR-004/007): ensure a visitor id and a sticky variant, expose them to the page via `locals`.
 * API routes are untouched. Cookies are set only when missing/invalid, so the 90-day lifetime is not extended on every visit.
 */
export const onRequest = defineMiddleware(async (context, next) => {
  if (context.url.pathname !== '/') return next();

  const { cookies } = context;
  const cookieOptions = {
    path: '/',
    maxAge: NINETY_DAYS,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
    httpOnly: false, // the client uses the id as the analytics distinct id (ADR-007)
  } as const;

  let visitorId = cookies.get(VISITOR_COOKIE)?.value;
  if (!visitorId || !UUID_PATTERN.test(visitorId)) {
    visitorId = crypto.randomUUID();
    cookies.set(VISITOR_COOKIE, visitorId, cookieOptions);
  }

  const storedVariant = cookies.get(VARIANT_COOKIE)?.value;
  const variant = isVariant(storedVariant) ? storedVariant : assignVariant(visitorId);
  if (variant !== storedVariant) cookies.set(VARIANT_COOKIE, variant, cookieOptions);

  context.locals.visitorId = visitorId;
  context.locals.variant = variant;

  const response = await next();
  response.headers.set('Cache-Control', 'private, no-store'); // never let a shared cache serve one visitor's variant or Set-Cookie
  return response;
});
