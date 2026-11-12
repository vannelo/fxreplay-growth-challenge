/**
 * Typed event registry = the property allow-list (CLAUDE.md rule 5). Mirrors docs/analytics-plan.md; a unit test
 * parses that file and fails on any drift. Nothing outside this registry can be sent.
 */
import type { ErrorCode } from '../contracts/users';

export type FieldName = 'email' | 'name';
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type AppEnv = 'prod' | 'preview' | 'dev' | 'test';

export interface EventMap {
  landing_viewed: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
    referrer_origin?: string;
    device_class: DeviceClass;
  };
  signup_started: { fields_shown: FieldName[] };
  signup_submitted: { attempt: number; name_provided: boolean };
  signup_failed: {
    source: 'client_validation' | 'server' | 'network';
    error_code: ErrorCode | 'network_error';
    failed_fields?: FieldName[];
    retryable: boolean;
  };
  signup_succeeded: { user_id: string; name_provided: boolean };
}

export type EventName = keyof EventMap;
/** The conversion is emitted by the server only: the browser type cannot even name it. */
export type ClientEventName = Exclude<EventName, 'signup_succeeded'>;
export type ServerEventName = Extract<EventName, 'signup_succeeded' | 'signup_failed'>;

export type AnalyticsEvent = { [K in EventName]: { name: K; props: EventMap[K] } }[EventName];

/** Runtime allow-list. The two type assertions below fail compilation if it ever disagrees with `EventMap`. */
export const EVENT_PROPS = {
  landing_viewed: ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer_origin', 'device_class'],
  signup_started: ['fields_shown'],
  signup_submitted: ['attempt', 'name_provided'],
  signup_failed: ['source', 'error_code', 'failed_fields', 'retryable'],
  signup_succeeded: ['user_id', 'name_provided'],
} as const satisfies { [K in EventName]: readonly (keyof EventMap[K])[] };

type AssertTrue<T extends true> = T;
// Every key of EventMap[K] must appear in EVENT_PROPS[K] (completeness; `satisfies` above covers validity).
export type _AllPropsListed = AssertTrue<{ [K in EventName]: Exclude<keyof EventMap[K], (typeof EVENT_PROPS)[K][number]> extends never ? true : false }[EventName]>;

export const MAX_STRING_LENGTH = 100;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

export const looksLikeEmail = (value: string) => EMAIL_LIKE.test(value);

export class AnalyticsViolation extends Error {}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

/**
 * Validates an event before it can leave the process: only allow-listed properties, no email-like value anywhere,
 * strings within bounds. A violation THROWS in dev/test (so it is caught immediately) and DROPS the event with a
 * warning in production (analytics must never break a signup). Returns null when dropped.
 */
export function sanitize<K extends EventName>(name: K, props: EventMap[K], strict: boolean): EventMap[K] | null {
  const allowed: readonly string[] = EVENT_PROPS[name];
  const problems: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (!allowed.includes(key)) problems.push(`property "${key}" is not allowed on "${name}"`);
    for (const text of strings(value)) {
      if (looksLikeEmail(text)) problems.push(`property "${key}" contains an email-like value`);
      if (text.length > MAX_STRING_LENGTH) problems.push(`property "${key}" exceeds ${MAX_STRING_LENGTH} characters`);
    }
  }
  if (problems.length === 0) return props;
  const message = `analytics: ${problems.join('; ')}`;
  if (strict) throw new AnalyticsViolation(message);
  console.warn(`${message} (event dropped)`);
  return null;
}
