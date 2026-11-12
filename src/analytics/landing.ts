import { looksLikeEmail, MAX_STRING_LENGTH, type DeviceClass, type EventMap } from './events';

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

export interface LandingInput {
  search: string;
  referrer: string;
  pageOrigin: string;
  viewportWidth: number;
}

export const deviceClass = (width: number): DeviceClass => (width < 768 ? 'mobile' : width < 1024 ? 'tablet' : 'desktop');

/**
 * Landing properties from the page URL. Allow-listed UTM keys only (the raw query string is never sent: it can carry
 * click ids, emails, anything), values bounded and dropped if they look like an email; the referrer is reduced to its
 * ORIGIN (a referrer path/query can carry PII) and omitted when it is the site itself.
 */
export function landingProps({ search, referrer, pageOrigin, viewportWidth }: LandingInput): EventMap['landing_viewed'] {
  const params = new URLSearchParams(search);
  const props: EventMap['landing_viewed'] = { device_class: deviceClass(viewportWidth) };
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value && !looksLikeEmail(value)) props[key] = value.slice(0, MAX_STRING_LENGTH);
  }
  try {
    const origin = referrer ? new URL(referrer).origin : '';
    if (origin && origin !== 'null' && origin !== pageOrigin) props.referrer_origin = origin;
  } catch {
    /* unparseable referrer: omit */
  }
  return props;
}

let fired = false;
/** True exactly once per page view (a bfcache restore keeps module state, so it does not fire again). */
export function claimLandingView(): boolean {
  if (fired) return false;
  fired = true;
  return true;
}
